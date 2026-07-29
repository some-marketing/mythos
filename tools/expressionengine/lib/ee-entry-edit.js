'use strict';

/**
 * ee-entry-edit.js — S4: Parameterised EE CP field update with dry-run mode.
 *
 * Given a live CP session (cookies + XID from ee-auth.js) and an entry's
 * current edit-page HTML, this module:
 *   - Computes the new field value (find→replace or set-value)
 *   - In DRY-RUN mode: prints a diff and returns without submitting
 *   - In live mode: POSTs the minimal entry-edit form to EE CP
 *   - Appends a JSONL change log entry (no credentials ever logged)
 *
 * Exported functions:
 *   applyEdit(opts)  — main orchestration (dry or live)
 *   computeNewValue(current, find, replace, setValue)
 *   buildDiff(oldVal, newVal)
 *   buildPostPayload(html, fieldName, newValue, xid, entryId, channelId)
 *
 * No external npm dependencies — Node.js built-ins only.
 */

const fs   = require('fs');
const path = require('path');
const { request, urlEncode } = require('./ee-auth');

const LOG_PATH = path.join(__dirname, '..', 'ee-edit-log.jsonl');

// ─── Pure-logic helpers (tested in unit tests) ────────────────────────────────

/**
 * Compute the new field value.
 * - If setValue is provided, returns it directly (overwrite mode).
 * - If find + replace are provided, replaces the FIRST occurrence of find in current.
 *   Throws if find is not found in current.
 */
function computeNewValue(current, find, replace, setValue) {
  if (setValue !== undefined && setValue !== null) {
    return String(setValue);
  }
  if (find === undefined || find === null) {
    throw new Error('Must supply either --find + --replace or --set-value');
  }
  if (!current.includes(find)) {
    throw new Error(
      `Find string not found in current field value.\n` +
      `  Looking for: ${JSON.stringify(find)}\n` +
      `  Current value excerpt: ${JSON.stringify(current.slice(0, 200))}`
    );
  }
  return current.replace(find, replace);
}

/**
 * Build a human-readable diff summary for dry-run and JSONL logging.
 * Returns { removed, added, context } — all strings, never contain the password.
 */
function buildDiff(oldVal, newVal) {
  // Find the shortest changed span for a compact diff
  let start = 0;
  while (start < oldVal.length && start < newVal.length && oldVal[start] === newVal[start]) start++;
  let endOld = oldVal.length - 1;
  let endNew = newVal.length - 1;
  while (endOld >= start && endNew >= start && oldVal[endOld] === newVal[endNew]) { endOld--; endNew--; }

  const CONTEXT = 40;
  const ctxStart = Math.max(0, start - CONTEXT);
  const ctxEndOld = Math.min(oldVal.length, endOld + 1 + CONTEXT);
  const ctxEndNew = Math.min(newVal.length, endNew + 1 + CONTEXT);

  return {
    removed: oldVal.slice(start, endOld + 1),
    added:   newVal.slice(start, endNew + 1),
    context_before: oldVal.slice(ctxStart, start),
    context_after_old: oldVal.slice(endOld + 1, ctxEndOld),
    context_after_new: newVal.slice(endNew + 1, ctxEndNew),
    old_value_excerpt: oldVal.slice(0, 300) + (oldVal.length > 300 ? '…' : ''),
    new_value_excerpt: newVal.slice(0, 300) + (newVal.length > 300 ? '…' : ''),
  };
}

// ─── Hidden-field allowlist for buildPostPayload ─────────────────────────────

/**
 * Known-safe hidden fields that EE always requires for a standard publish/edit
 * form submit. Fields outside this set that are also not the target field are
 * either omitted (unknown but benign) or trigger a fail-closed error if they
 * match the HIGH_RISK_FIELD_PATTERNS list below.
 *
 * Any EE-version-specific fields added here must be reviewed for destructive
 * semantics before inclusion.
 */
const ALLOWED_HIDDEN_FIELDS = new Set([
  'XID',
  'csrf_token',
  'entry_id',
  'channel_id',
  'site_id',
  'revision_post',  // empty string in standard edits; present in EE 6/7 forms
  'submit',
]);

/**
 * Pattern matching hidden field names that could trigger destructive actions
 * on the EE CP. If any hidden input from the TARGET FORM matches one of these
 * and is NOT in ALLOWED_HIDDEN_FIELDS, buildPostPayload() throws rather than
 * silently including the field.
 *
 * Conservative: match on common EE CP destructive-action naming conventions.
 */
const HIGH_RISK_FIELD_PATTERNS = [
  /delete/i,
  /remove/i,
  /revision_action/i,
  /file[_-]?removal/i,
  /return(?:_url)?$/i,     // stale return-URL injection
  /\baction\b/i,           // catch-all action dispatcher fields
];

/**
 * Extract the innerHTML of the FIRST form whose action targets the entry-edit
 * CP path (/cp/publish/edit/entry/{entryId}).
 *
 * Returns null if no matching form is found.
 */
function extractTargetFormHtml(html, entryId) {
  // Match <form ... action="...cp/publish/edit/entry/{entryId}..."> ... </form>
  // Uses a non-greedy match; sufficient for well-formed EE CP HTML.
  const formRe = new RegExp(
    `<form[^>]*action=["'][^"']*(?:/cp/publish/edit/entry/${entryId})[^"']*["'][^>]*>([\\s\\S]*?)<\\/form>`,
    'i'
  );
  const m = formRe.exec(html);
  return m ? m[0] : null; // return the full <form>...</form> block
}

/**
 * Build the minimal POST payload for an EE entry-edit form submit.
 *
 * Security model:
 *   1. Scoped to the TARGET entry-edit <form> only (not the whole page).
 *   2. Only includes hidden fields from ALLOWED_HIDDEN_FIELDS plus the
 *      target fieldName.
 *   3. Fails closed if an unrecognised high-risk hidden field is present
 *      in the target form — throws instead of silently including it.
 *
 * EE CP entry-edit POSTs require:
 *   - XID (CSRF token)
 *   - entry_id, channel_id, site_id
 *   - revision_post (empty string for standard edits)
 *   - The field being updated (field_id_N = new_value)
 *   - submit = 'save'
 *
 * @param {string} html       — raw HTML of the entry-edit page
 * @param {string} fieldName  — the field to update (e.g. "field_id_5")
 * @param {string} newValue   — new value for the field
 * @param {string} xid        — extracted XID/CSRF token
 * @param {number} entryId
 * @param {number} channelId
 * @returns {object} payload object ready for urlEncode()
 * @throws  if a high-risk unrecognised hidden field is found in the target form
 */
function buildPostPayload(html, fieldName, newValue, xid, entryId, channelId) {
  // Step 1: Scope to the target form only
  const formHtml = extractTargetFormHtml(html, entryId);
  if (!formHtml) {
    throw new Error(
      `buildPostPayload: could not find the entry-edit form for entry ${entryId} in the page HTML. ` +
      'Expected a <form action="...cp/publish/edit/entry/' + entryId + '...">. ' +
      'The CP page structure may have changed — do not proceed without review.'
    );
  }

  const payload = {};

  // Step 2: Extract hidden inputs from the scoped form only
  const hiddenRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = hiddenRe.exec(formHtml)) !== null) {
    const tag   = m[0];
    const nameM = /name=["']([^"']+)["']/.exec(tag);
    const valM  = /value=["']([^"']*)["']/.exec(tag);
    if (!nameM || !valM) continue;

    const name  = nameM[1];
    const value = valM[1];

    // If it's the target field, skip here — we'll set it explicitly below
    if (name === fieldName) continue;

    if (ALLOWED_HIDDEN_FIELDS.has(name)) {
      // Known-safe field — include it
      payload[name] = value;
    } else {
      // Unknown field: check for high-risk patterns — fail closed if matched
      const isHighRisk = HIGH_RISK_FIELD_PATTERNS.some(re => re.test(name));
      if (isHighRisk) {
        throw new Error(
          `buildPostPayload: unexpected high-risk hidden field "${name}" found in the entry-edit form. ` +
          'This field could trigger a destructive CP action. ' +
          'Add it to ALLOWED_HIDDEN_FIELDS only after confirming it is safe, or remove it from the form.'
        );
      }
      // Unknown but not high-risk: omit silently (conservative — don't include unknown fields)
    }
  }

  // Step 3: Required EE fields — override / ensure present.
  // Use the token field name that EE actually uses in this form:
  //   EE 7 uses 'csrf_token'; older installs use 'XID'.
  // Prefer whichever was already captured from the form by the hidden-field loop;
  // if neither is in payload yet, default to 'csrf_token' (EE 7 standard).
  const tokenFieldName = ('csrf_token' in payload) ? 'csrf_token'
                       : ('XID'        in payload) ? 'XID'
                       : 'csrf_token';
  payload[tokenFieldName] = xid;
  payload['entry_id']     = String(entryId);
  payload['channel_id']   = String(channelId);
  payload['submit']       = 'save';

  // Step 4: The target field update
  payload[fieldName] = newValue;

  return payload;
}

/**
 * POST the entry-edit form to EE CP.
 *
 * @param {object} loginUrl  — parsed CP URL object from ee-auth
 * @param {object} cookies   — session cookie jar
 * @param {number} entryId
 * @param {object} payload   — form payload from buildPostPayload()
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
async function postEntryEdit(loginUrl, cookies, entryId, payload) {
  const formData = urlEncode(payload);
  // EE 6/7 publish/edit POST: action is admin.php?/cp/publish/edit/entry/{id}
  // (same path as the GET, method=POST)
  const postPath = `${loginUrl.loginPath}?/cp/publish/edit/entry/${entryId}`;

  const postOpts = {
    protocol: loginUrl.protocol,
    hostname: loginUrl.hostname,
    port:     loginUrl.port,
    path:     postPath,
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(formData),
      'User-Agent':     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer':        `${loginUrl.baseUrl}${postPath}`,
      'Accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  };

  return request(postOpts, formData, cookies, 5);
}

// ─── JSONL change log ─────────────────────────────────────────────────────────

/**
 * Append one line to the JSONL change log.
 * HARD RULE: never include any credential value in the log entry.
 */
function appendLog(entry) {
  const line = JSON.stringify({
    ts:             new Date().toISOString(),
    entry_id:       entry.entry_id,
    channel_id:     entry.channel_id,
    field_name:     entry.field_name,
    dry_run:        entry.dry_run,
    old_excerpt:    entry.old_excerpt,
    new_value:      entry.new_value,
    verify_result:  entry.verify_result || null,
    error:          entry.error || null,
  }) + '\n';
  fs.appendFileSync(LOG_PATH, line, 'utf8');
}

// ─── S4: Main edit orchestration ─────────────────────────────────────────────

/**
 * Apply a field edit (dry-run or live).
 *
 * @param {object} opts
 *   opts.loginUrl   {object}  parsed CP URL from loginToCP()
 *   opts.cookies    {object}  session cookie jar
 *   opts.entryId    {number}  EE entry ID
 *   opts.channelId  {number}  EE channel ID
 *   opts.editPageHtml {string} raw HTML of the entry-edit page
 *   opts.xid        {string}  XID token from the edit page
 *   opts.fieldName  {string}  EE field name, e.g. "field_id_5"
 *   opts.find       {string|null}  substring to replace
 *   opts.replace    {string|null}  replacement string
 *   opts.setValue   {string|null}  full override value
 *   opts.dryRun     {boolean} if true, log diff but do not POST
 *   opts.verbose    {boolean} print diff to stdout
 *
 * @returns {Promise<{ oldValue, newValue, diff, dryRun, postResult? }>}
 */
async function applyEdit(opts) {
  const {
    loginUrl, cookies, entryId, channelId, editPageHtml, xid,
    fieldName, find, replace, setValue, dryRun, verbose,
  } = opts;

  // Extract current field value from the edit page HTML
  const { extractFieldValue } = require('./ee-auth');
  const currentValue = extractFieldValue(editPageHtml, fieldName);
  if (currentValue === null) {
    throw new Error(
      `Field "${fieldName}" not found on the entry-edit page for entry ${entryId}. ` +
      'Check the field name. Use --list-fields to enumerate visible fields (see README).'
    );
  }

  const newValue = computeNewValue(currentValue, find, replace, setValue);
  const diff     = buildDiff(currentValue, newValue);

  if (verbose || dryRun) {
    process.stdout.write(`\n[EE EDIT] Entry ${entryId}, field ${fieldName}\n`);
    process.stdout.write(`  BEFORE: ${JSON.stringify(diff.old_value_excerpt)}\n`);
    process.stdout.write(`  AFTER:  ${JSON.stringify(diff.new_value_excerpt)}\n`);
    process.stdout.write(`  CHANGE: -${JSON.stringify(diff.removed)} +${JSON.stringify(diff.added)}\n`);
    if (dryRun) process.stdout.write('  [DRY RUN — no POST submitted]\n\n');
  }

  if (dryRun) {
    appendLog({
      entry_id:   entryId,
      channel_id: channelId,
      field_name: fieldName,
      dry_run:    true,
      old_excerpt: diff.old_value_excerpt,
      new_value:  newValue,
    });
    return { oldValue: currentValue, newValue, diff, dryRun: true };
  }

  // Live POST
  const payload    = buildPostPayload(editPageHtml, fieldName, newValue, xid, entryId, channelId);
  const postResult = await postEntryEdit(loginUrl, cookies, entryId, payload);

  // EE success: redirects to the same edit page or to the entries list (302)
  // or returns 200 with the updated form.
  const success = postResult.statusCode < 400 &&
    !/error\s+occurred|system\s+error|exception/i.test(postResult.body);

  if (!success) {
    appendLog({
      entry_id:   entryId,
      channel_id: channelId,
      field_name: fieldName,
      dry_run:    false,
      old_excerpt: diff.old_value_excerpt,
      new_value:  newValue,
      error:      `POST failed: HTTP ${postResult.statusCode}`,
    });
    throw new Error(`EE entry-edit POST returned HTTP ${postResult.statusCode}. Check the CP logs.`);
  }

  appendLog({
    entry_id:   entryId,
    channel_id: channelId,
    field_name: fieldName,
    dry_run:    false,
    old_excerpt: diff.old_value_excerpt,
    new_value:  newValue,
  });

  return { oldValue: currentValue, newValue, diff, dryRun: false, postResult };
}

module.exports = {
  applyEdit,
  computeNewValue,
  buildDiff,
  buildPostPayload,
  appendLog,
  LOG_PATH,
  // exported for unit tests
  _extractTargetFormHtml:    extractTargetFormHtml,
  _ALLOWED_HIDDEN_FIELDS:    ALLOWED_HIDDEN_FIELDS,
  _HIGH_RISK_FIELD_PATTERNS: HIGH_RISK_FIELD_PATTERNS,
  _postEntryEdit:            postEntryEdit,
};
