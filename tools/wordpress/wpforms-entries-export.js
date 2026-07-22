#!/usr/bin/env node
'use strict';

/**
 * wpforms-entries-export.js — Download WPForms entries as CSV from the WP REST API.
 *
 * WPForms exposes a REST endpoint at /wp-json/wpforms/v1/forms/<id>/entries
 * (available in Pro/Elite). We use it to pull entries for a specific form
 * and write them to the tools/bundle/ expected path convention
 * `raw/<form-id>__<run-id>__wpforms_export.csv` so the Playwright runner's
 * dev-handoff bundle generator can consume them automatically.
 *
 * This helper closes the bundle-preflight gap flagged in the Apr 10
 * GTM+WP automation audit: the handoff bundle generator expected CSVs in
 * raw/ before it ran, which forced the operator to manually place files.
 *
 * Auth: WordPress application password per site, loaded by --pass-file path
 * (matches the tools/landing-page/ convention).
 *
 * --- QA FILTER + PII REDACTION (amendment 2026-04-20 D3) ---
 *
 * This exporter REQUIRES one QA filter at invocation:
 *   --email-exact <addr>       exact case-insensitive match on any field value
 *   --test-event-code <code>   match code in any field value OR entry meta
 *   --identity-file <path>     JSON with { email, test_event_code? }
 *
 * PII handling: by default a strict allow-list of columns is emitted. Field
 * values with labels/keys matching phone / address / postal / sin / dob are
 * ALWAYS dropped, even in --include-evidence-mode. Correlation across runs is
 * achieved via a per-run ephemeral salt + sha256 hash (hashForCorrelation()).
 * The salt is generated at runtime start and is NEVER persisted to disk.
 *
 * --include-evidence-mode widens the allow-list to include raw values for
 * non-denied fields, but ONLY when --output-dir resolves under a run-artifact
 * tree (path contains /runs/). Anywhere else it is refused.
 *
 * Usage:
 *   node tools/wordpress/wpforms-entries-export.js \
 *     --site https://your-site.example \
 *     --user your-wp-username \
 *     --pass-file /tmp/.your-site-wp-pass \
 *     --form-id 88775 \
 *     --run-id run_0014 \
 *     --email-exact qa+form61@example.com \
 *     --output-dir /path/to/runs/run_0014
 *
 * Exit codes:
 *   0 success
 *   1 generic error
 *   2 no QA filter supplied
 *   3 no entries matched the QA filter
 *   4 --include-evidence-mode used outside a /runs/ path
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// Ephemeral per-run correlation salt. Generated at module load, never
// persisted to disk, never logged. If you need cross-run correlation, do it
// by re-running with a deterministic identity file; do NOT export this salt.
const RUNTIME_SALT = crypto.randomBytes(8).toString('hex'); // 16 hex chars

function hashForCorrelation(value, salt) {
  if (value == null || value === '') return '';
  const s = salt == null ? RUNTIME_SALT : salt;
  return crypto
    .createHash('sha256')
    .update(s + String(value))
    .digest('hex')
    .slice(0, 16);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      a.help = true;
      continue;
    }
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[key] = v;
    }
  }
  return a;
}

function printHelp() {
  console.log(`
Usage: wpforms-entries-export.js [options]

Required:
  --site <url>            WordPress site URL (e.g., https://your-site.example)
  --user <username>       WP user with application password access to WPForms REST
  --pass-file <path>      Path to a file containing the WP application password
  --form-id <id>          WPForms form ID (e.g. 88775)
  --run-id <id>           Runset ID to embed in the output filename (e.g. run_0014)
  --output-dir <path>     Target directory where raw/<form-id>__<run-id>__wpforms_export.csv will be written

QA filter (exactly one or more REQUIRED — see amendment 2026-04-20 D3):
  --email-exact <addr>        Keep entries where any field value equals addr (case-insensitive)
  --test-event-code <code>    Keep entries whose fields or meta contain this code
  --identity-file <path>      JSON file with { "email": "...", "test_event_code": "..." }

Optional:
  --format <csv|json>         Output format (default: csv). When 'json', emits
                              exports/wpforms-qa-entries__<env>.json under --output-dir.
                              (sent_payload__<env>.json is reserved for CRM flat
                              payload produced by a different tool; this exporter
                              does not write that filename. See amendment v7-D2.)
  --env <A|B|C>               Env label used in the JSON filename (default: A).
                              Only meaningful when --format json.
  --output <path>             Explicit output file path (overrides default).
                              Only meaningful when --format json.
  --since <iso-timestamp>     Only include entries modified after this timestamp
  --page-size <n>             Entries per API page (default: 100)
  --max-pages <n>             Max pages to fetch (default: 50)
  --include-evidence-mode     Widen allow-list to include non-denied raw values.
                              REFUSED unless --output-dir is under a /runs/ tree.
  --help                      Show this help

Exit codes:
  0 success
  1 generic error
  2 refuse: no QA filter supplied
  3 no entries matched the QA filter
  4 refuse: --include-evidence-mode outside a /runs/ path
`.trim());
}

function httpRequest({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ statusCode: res.statusCode, body: parsed, text });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function fetchEntries({ site, user, pass, formId, since, pageSize, maxPages }) {
  const base = site.replace(/\/+$/, '');
  const authHeader =
    'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  const entries = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      form_id: String(formId),
      per_page: String(pageSize),
      page: String(page),
    });
    if (since) params.set('after', since);

    const url = `${base}/wp-json/wpforms/v1/forms/${formId}/entries?${params}`;
    const res = await httpRequest({
      method: 'GET',
      url,
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'User-Agent': 'mythos-tools wpforms-entries-export',
      },
    });

    if (res.statusCode === 404) {
      throw new Error(
        `WPForms REST endpoint not found at ${url}. Is WPForms Pro/Elite installed and is the REST API enabled? (WPForms Lite does not expose REST.)`
      );
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new Error(
        `Auth failed on ${url}: ${res.statusCode}. Check --user / --pass-file and that the user has WPForms access.`
      );
    }
    if (res.statusCode >= 400) {
      throw new Error(
        `HTTP ${res.statusCode} from ${url}: ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`
      );
    }

    const pageEntries = Array.isArray(res.body) ? res.body : (res.body.entries || []);
    if (pageEntries.length === 0) break;
    entries.push(...pageEntries);
    if (pageEntries.length < pageSize) break;
  }

  return entries;
}

// --- PII allow / deny list -------------------------------------------------

const ALLOWED_COLUMNS_DEFAULT = [
  'entry_id',
  'form_id',
  'date',
  'test_identity_email',
  'test_event_code',
  'event_name',
  'event_id',
  'pixel_id',
  'field_label',
  'field_key',
  'field_presence',
  'field_shape',
  'email_hash',
  'phone_hash',
];

const DENIED_FIELD_TOKENS = [
  'phone',
  'phone_number',
  'sin',
  'sin_number',
  'ssn',
  'dob',
  'date_of_birth',
  'street',
  'street_address',
  'address',
  'postal',
  'postal_code',
  'zip',
  'name',
  'first_name',
  'last_name',
  'full_name',
  'middle_name',
  'message',
  'comments',
  'comment',
  'notes',
  'description',
  'additional_info',
  'additional_information',
  'free_text',
  'other',
  'details',
  'employer',
  'employer_name',
  'occupation',
  'income',
  'salary',
  'monthly_housing_payment',
  'rent',
  'mortgage',
];

// Metadata identifiers that legitimately contain deny-token substrings but are
// not themselves PII-bearing field labels/keys. These are structural names of
// columns describing other fields, not user-submitted values.
const METADATA_ALLOWLIST = [
  'event_name',
  'event name',
  'field_name',
  'field name',
  'field_label',
  'field label',
  'field_key',
  'field key',
  'form_name',
  'form name',
  'form_id',
  'form id',
  'pixel_id',
  'pixel id',
  'entry_id',
  'entry id',
  'test_event_code',
];

function isDeniedField(label, key) {
  const normLabel = String(label || '').toLowerCase().trim();
  const normKey = String(key || '').toLowerCase().trim();
  if (METADATA_ALLOWLIST.includes(normLabel) || METADATA_ALLOWLIST.includes(normKey)) {
    return false;
  }
  const hayLabel = ` ${normLabel} `;
  const hayKey = ` ${normKey} `;
  const hay = hayLabel + hayKey;
  // match any deny token bounded by space, _, - or edge. Treat space/_/-
  // as interchangeable inside the token so "additional_info" also matches
  // labels like "Additional info" (space) or "additional-info" (dash).
  return DENIED_FIELD_TOKENS.some((tok) => {
    const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[_\-\s]+/g, '[\\s_\\-]+');
    const re = new RegExp(`(^|[\\s_\\-])${escaped}([\\s_\\-]|$)`);
    return re.test(hay);
  });
}

if (process.env.NODE_DEBUG_DENY_LIST === '1') {
  const mustDeny = [
    ['First Name', 'first_name'],
    ['Customer Name', 'customer_name'],
    ['Additional Info', 'additional_info'],
    ['Employer Name', 'employer_name'],
    ['Full Name', 'full_name'],
    ['Phone', 'phone'],
    ['SIN', 'sin_number'],
    ['Monthly Housing Payment', 'monthly_housing_payment'],
  ];
  const mustAllow = [
    ['Event Name', 'event_name'],
    ['Field Key', 'field_key'],
    ['Field Label', 'field_label'],
    ['Form ID', 'form_id'],
    ['Form Name', 'form_name'],
    ['Field Name', 'field_name'],
  ];
  for (const [label, key] of mustDeny) {
    if (!isDeniedField(label, key)) {
      throw new Error(`NODE_DEBUG_DENY_LIST: expected DENIED for ${label}/${key}`);
    }
  }
  for (const [label, key] of mustAllow) {
    if (isDeniedField(label, key)) {
      throw new Error(`NODE_DEBUG_DENY_LIST: expected ALLOWED for ${label}/${key}`);
    }
  }
}

function fieldShape(value) {
  if (value == null || value === '') return 'empty';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return `len:${s.length}`;
}

function fieldPresence(value) {
  return value != null && String(value).length > 0;
}

// --- QA filter -------------------------------------------------------------

function entryFieldValues(entry) {
  const out = [];
  const fields = entry.fields || {};
  for (const fid of Object.keys(fields)) {
    const f = fields[fid];
    const v = f && typeof f === 'object' ? f.value : f;
    if (v != null) out.push(String(v));
  }
  return out;
}

function entryMatchesEmail(entry, email) {
  const target = String(email).toLowerCase();
  return entryFieldValues(entry).some((v) => v.toLowerCase() === target);
}

function entryMatchesEventCode(entry, code) {
  const target = String(code).toLowerCase();
  const inFields = entryFieldValues(entry).some((v) => v.toLowerCase().includes(target));
  if (inFields) return true;
  const meta = entry.meta || {};
  try {
    return JSON.stringify(meta).toLowerCase().includes(target);
  } catch {
    return false;
  }
}

function applyQaFilter(entries, filter) {
  const { email, testEventCode } = filter;
  return entries.filter((entry) => {
    if (email && entryMatchesEmail(entry, email)) return true;
    if (testEventCode && entryMatchesEventCode(entry, testEventCode)) return true;
    return false;
  });
}

// --- CSV emission (allow-list enforced) -----------------------------------

function csvEscape(v) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Emit a redacted CSV per the allow-list. One row per field per entry so shape
 * can be reported without leaking raw values. If includeEvidenceMode is true,
 * an additional `field_value` column is appended with the raw value BUT only
 * for fields not on the deny-list.
 */
function entriesToFilteredCsv(entries, { identity = {}, includeEvidenceMode = false } = {}) {
  const columns = ALLOWED_COLUMNS_DEFAULT.slice();
  if (includeEvidenceMode) columns.push('field_value');

  const rows = [columns.join(',')];
  if (entries.length === 0) return rows.join('\n');

  for (const entry of entries) {
    const fields = entry.fields || {};
    const entryEmail = identity.email || '';
    const entryCode = identity.test_event_code || '';
    for (const fid of Object.keys(fields)) {
      const f = fields[fid];
      const label = (f && typeof f === 'object' && (f.name || f.label)) || '';
      const key = `field_${fid}`;
      const rawValue = f && typeof f === 'object' ? f.value : f;
      const denied = isDeniedField(label, key);

      // Detect obvious email/phone shapes for hashing.
      const looksEmail = typeof rawValue === 'string' && /@/.test(rawValue);
      const looksPhone = typeof rawValue === 'string' && /\d{7,}/.test(rawValue.replace(/\D/g, ''));

      const row = {
        entry_id: entry.entry_id || entry.id || '',
        form_id: entry.form_id || '',
        date: entry.date || entry.date_created || '',
        test_identity_email: entryEmail,
        test_event_code: entryCode,
        event_name: entry.event_name || '',
        event_id: entry.event_id || '',
        pixel_id: entry.pixel_id || '',
        field_label: label,
        field_key: key,
        field_presence: fieldPresence(rawValue) ? 'true' : 'false',
        field_shape: fieldShape(rawValue),
        email_hash: looksEmail ? hashForCorrelation(String(rawValue).toLowerCase(), RUNTIME_SALT) : '',
        phone_hash: looksPhone ? hashForCorrelation(String(rawValue).replace(/\D/g, ''), RUNTIME_SALT) : '',
      };

      if (includeEvidenceMode) {
        row.field_value = denied ? '' : (rawValue == null ? '' : String(rawValue));
      }

      rows.push(columns.map((c) => csvEscape(row[c])).join(','));
    }
  }

  return rows.join('\n');
}

// --- JSON emission (allow-list enforced) ----------------------------------

/**
 * Build the WPForms-entry evidence envelope consumed by backend-verdict.js
 * via the `backend_entry` lane in the wpqa runner.
 *
 * IMPORTANT: Despite the legacy name `entriesToSentPayload`, this output is
 * NOT the CRM flat-payload artifact and is NOT consumed by
 * validate-payload-diff. validate-payload-diff consumes sent_payload__<env>.json
 * which is written by a separate capture path (see capture-expected-payload +
 * the CRM network-capture tooling). The two artifacts share a similar name for
 * historical reasons but serve different lanes of the backend_verdict schema:
 *   - this envelope (WPForms entries)     -> backend_entry lane
 *   - sent_payload__<env>.json (CRM POST) -> payload_diff lane
 *
 * Redaction policy mirrors entriesToFilteredCsv: deny-list fields emit
 * presence + shape only; non-denied fields emit raw values only when
 * includeEvidenceMode is true AND the caller has already asserted the output
 * path is under a /runs/ tree. Otherwise values are hashed for correlation.
 */
/**
 * Per-entry email-match helper (v7-D1).
 *
 * Returns true iff identity.email is set AND at least one of the entry's
 * field values, when lowercased, equals lowercased identity.email. Never
 * returns true merely because identity.email is supplied; never returns
 * true on a code-only filter that skipped email comparison.
 */
function computeMatchedIdentityEmail(entry, identity) {
  const target = identity && identity.email ? String(identity.email).toLowerCase().trim() : '';
  if (!target) return false;
  const values = entryFieldValues(entry);
  for (const v of values) {
    if (String(v).toLowerCase().trim() === target) return true;
  }
  return false;
}

function entriesToSentPayload(entries, { identity = {}, env = 'A', includeEvidenceMode = false } = {}) {
  const payload = {
    _schema: 'wpqa.wpforms_entries.v1',
    form_id: '',
    env: String(env || 'A'),
    generated_at: new Date().toISOString(),
    // any_entry_matched_identity_email is a root-level convenience rollup
    // reflecting actual per-entry email comparisons. It is derived after
    // entries[] is populated, below.
    any_entry_matched_identity_email: false,
    entries: [],
  };

  for (const entry of entries) {
    const fields = entry.fields || {};
    const fieldOut = {};
    for (const fid of Object.keys(fields)) {
      const f = fields[fid];
      const label = (f && typeof f === 'object' && (f.name || f.label)) || '';
      const key = `field_${fid}`;
      const rawValue = f && typeof f === 'object' ? f.value : f;
      const denied = isDeniedField(label, key);
      const looksEmail = typeof rawValue === 'string' && /@/.test(rawValue);
      const looksPhone = typeof rawValue === 'string' && /\d{7,}/.test(String(rawValue).replace(/\D/g, ''));

      let valueOut;
      if (denied) {
        valueOut = '';
      } else if (includeEvidenceMode) {
        valueOut = rawValue == null ? '' : String(rawValue);
      } else if (looksEmail) {
        valueOut = `sha256:${hashForCorrelation(String(rawValue).toLowerCase(), RUNTIME_SALT)}`;
      } else if (looksPhone) {
        valueOut = `sha256:${hashForCorrelation(String(rawValue).replace(/\D/g, ''), RUNTIME_SALT)}`;
      } else {
        valueOut = `sha256:${hashForCorrelation(String(rawValue == null ? '' : rawValue), RUNTIME_SALT)}`;
      }

      fieldOut[key] = {
        label: String(label || ''),
        presence: fieldPresence(rawValue),
        shape: fieldShape(rawValue),
        value_redacted_or_hashed: valueOut,
      };
    }

    const entryFormId = entry.form_id || '';
    if (!payload.form_id && entryFormId) payload.form_id = String(entryFormId);

    // v7-D1: compute matched_identity_email PER ENTRY by actual email-compare.
    // Also emit a plaintext email field the reader can consume directly.
    const perEntryMatched = computeMatchedIdentityEmail(entry, identity);
    const identityEmailLc = identity && identity.email ? String(identity.email).toLowerCase().trim() : '';

    payload.entries.push({
      entry_id: String(entry.entry_id || entry.id || ''),
      form_id: String(entryFormId || ''),
      date: entry.date || entry.date_created || '',
      event_id: entry.event_id || '',
      event_name: entry.event_name || '',
      test_event_code: identity.test_event_code || entry.test_event_code || '',
      matched_identity_email: perEntryMatched,
      email: perEntryMatched ? identityEmailLc : '',
      fields: fieldOut,
    });
  }

  payload.any_entry_matched_identity_email = payload.entries.some((e) => e.matched_identity_email === true);
  return payload;
}

/**
 * Build the full-filtered entries JSON array consumed as a fallback by
 * computeBackendVerdict. Redaction policy matches entriesToSentPayload.
 */
function entriesToFilteredJson(entries, { identity = {}, includeEvidenceMode = false } = {}) {
  const out = [];
  for (const entry of entries) {
    const fields = entry.fields || {};
    const fieldOut = {};
    for (const fid of Object.keys(fields)) {
      const f = fields[fid];
      const label = (f && typeof f === 'object' && (f.name || f.label)) || '';
      const key = `field_${fid}`;
      const rawValue = f && typeof f === 'object' ? f.value : f;
      const denied = isDeniedField(label, key);
      const looksEmail = typeof rawValue === 'string' && /@/.test(rawValue);
      const looksPhone = typeof rawValue === 'string' && /\d{7,}/.test(String(rawValue).replace(/\D/g, ''));

      let valueOut;
      if (denied) {
        valueOut = '';
      } else if (includeEvidenceMode) {
        valueOut = rawValue == null ? '' : String(rawValue);
      } else if (looksEmail) {
        valueOut = `sha256:${hashForCorrelation(String(rawValue).toLowerCase(), RUNTIME_SALT)}`;
      } else if (looksPhone) {
        valueOut = `sha256:${hashForCorrelation(String(rawValue).replace(/\D/g, ''), RUNTIME_SALT)}`;
      } else {
        valueOut = `sha256:${hashForCorrelation(String(rawValue == null ? '' : rawValue), RUNTIME_SALT)}`;
      }

      fieldOut[key] = {
        label: String(label || ''),
        presence: fieldPresence(rawValue),
        shape: fieldShape(rawValue),
        value_redacted_or_hashed: valueOut,
      };
    }

    // v7-D1: per-entry matched_identity_email from actual email-compare.
    const perEntryMatched = computeMatchedIdentityEmail(entry, identity);
    const identityEmailLc = identity && identity.email ? String(identity.email).toLowerCase().trim() : '';

    out.push({
      entry_id: String(entry.entry_id || entry.id || ''),
      form_id: String(entry.form_id || ''),
      date: entry.date || entry.date_created || '',
      matched_identity_email: perEntryMatched,
      email: perEntryMatched ? identityEmailLc : '',
      event_id: entry.event_id || '',
      event_name: entry.event_name || '',
      test_event_code: identity.test_event_code || entry.test_event_code || '',
      fields: fieldOut,
    });
  }
  return out;
}

/**
 * Legacy flat CSV (no allow-list). Kept exported for backward-compat only.
 * New callers should use entriesToFilteredCsv.
 */
function entriesToCsv(entries) {
  if (entries.length === 0) return '';

  const fieldKeys = new Set(['entry_id', 'form_id', 'date', 'user_agent', 'ip_address']);
  for (const entry of entries) {
    const fields = entry.fields || {};
    for (const fid of Object.keys(fields)) {
      fieldKeys.add(`field_${fid}`);
    }
  }
  const columns = Array.from(fieldKeys);

  const rows = [columns.join(',')];
  for (const entry of entries) {
    const row = columns.map((col) => {
      if (col === 'entry_id') return csvEscape(entry.entry_id || entry.id);
      if (col === 'form_id') return csvEscape(entry.form_id);
      if (col === 'date') return csvEscape(entry.date || entry.date_created);
      if (col === 'user_agent') return csvEscape(entry.user_agent);
      if (col === 'ip_address') return csvEscape(entry.ip_address);
      if (col.startsWith('field_')) {
        const fid = col.slice(6);
        const f = (entry.fields || {})[fid];
        if (!f) return '';
        return csvEscape(f.value || f);
      }
      return '';
    });
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const required = ['site', 'user', 'pass-file', 'form-id', 'run-id', 'output-dir'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error('Missing required args: ' + missing.join(', '));
    printHelp();
    process.exit(1);
  }

  // ---- QA filter resolution (amendment 2026-04-20 D3) --------------------
  let identity = {};
  let emailFilter = null;
  let eventCodeFilter = null;

  if (args['identity-file']) {
    try {
      identity = JSON.parse(fs.readFileSync(args['identity-file'], 'utf8'));
    } catch (err) {
      console.error(`failed to read --identity-file: ${err.message}`);
      process.exit(1);
    }
    if (identity.email) emailFilter = identity.email;
    if (identity.test_event_code) eventCodeFilter = identity.test_event_code;
  }
  if (typeof args['email-exact'] === 'string') emailFilter = args['email-exact'];
  if (typeof args['test-event-code'] === 'string') eventCodeFilter = args['test-event-code'];

  if (!emailFilter && !eventCodeFilter) {
    console.error(
      'refuse: exporter requires a QA filter (--email-exact | --test-event-code | --identity-file). See amendment 2026-04-20 D3.'
    );
    process.exit(2);
  }

  // ---- Evidence mode gate ------------------------------------------------
  const includeEvidenceMode = !!args['include-evidence-mode'];
  const resolvedOutputDir = path.resolve(args['output-dir']);
  if (includeEvidenceMode && !resolvedOutputDir.includes(`${path.sep}runs${path.sep}`) &&
      !resolvedOutputDir.includes('/runs/')) {
    console.error('refuse: --include-evidence-mode requires output path under a run-artifact tree');
    process.exit(4);
  }

  // ---- Password ----------------------------------------------------------
  let pass;
  try {
    pass = fs.readFileSync(args['pass-file'], 'utf8').trim();
  } catch (err) {
    console.error(`failed to read --pass-file ${args['pass-file']}: ${err.message}`);
    process.exit(1);
  }

  try {
    const allEntries = await fetchEntries({
      site: args.site,
      user: args.user,
      pass,
      formId: args['form-id'],
      since: args.since || null,
      pageSize: parseInt(args['page-size'] || '100', 10),
      maxPages: parseInt(args['max-pages'] || '50', 10),
    });

    // Hashes-and-counts logging only. NEVER log email / phone / raw values.
    console.log(`Fetched ${allEntries.length} entries for form ${args['form-id']}`);
    if (emailFilter) {
      console.log(`QA filter: email_hash=${hashForCorrelation(String(emailFilter).toLowerCase(), RUNTIME_SALT)}`);
    }
    if (eventCodeFilter) {
      console.log(`QA filter: test_event_code_hash=${hashForCorrelation(String(eventCodeFilter), RUNTIME_SALT)}`);
    }

    const filtered = applyQaFilter(allEntries, {
      email: emailFilter,
      testEventCode: eventCodeFilter,
    });

    console.log(`filtered ${filtered.length} of ${allEntries.length} entries matched QA filter`);

    if (filtered.length === 0) {
      console.error(
        'No entries matched the QA filter. Verify the test identity submitted at least one entry within the fetch window.'
      );
      process.exit(3);
    }

    const formatArg = typeof args.format === 'string' ? String(args.format).toLowerCase() : 'csv';
    if (formatArg !== 'csv' && formatArg !== 'json') {
      console.error(`refuse: --format must be 'csv' or 'json' (got ${formatArg})`);
      process.exit(1);
    }

    const identityForEmit = {
      email: emailFilter || identity.email || '',
      test_event_code: eventCodeFilter || identity.test_event_code || '',
    };

    if (formatArg === 'json') {
      const env = typeof args.env === 'string' ? String(args.env) : 'A';
      const sentPayload = entriesToSentPayload(filtered, {
        identity: identityForEmit,
        env,
        includeEvidenceMode,
      });
      if (!sentPayload.form_id) sentPayload.form_id = String(args['form-id']);

      const exportsDir = path.resolve(resolvedOutputDir, 'exports');
      fs.mkdirSync(exportsDir, { recursive: true });

      // v7-D2: WPForms entry envelope is written to wpforms-qa-entries__{env}.json
      // (or the path from --output if supplied). sent_payload__{env}.json is
      // RESERVED for the CRM flat payload emitted by a different tool and MUST
      // NOT be produced here — validate-payload-diff.js reads that path.
      const defaultEntriesPath = path.join(exportsDir, `wpforms-qa-entries__${env}.json`);
      const entriesPath = typeof args.output === 'string' ? path.resolve(args.output) : defaultEntriesPath;
      fs.mkdirSync(path.dirname(entriesPath), { recursive: true });
      const entriesText = JSON.stringify(sentPayload, null, 2);
      fs.writeFileSync(entriesPath, entriesText, 'utf8');

      console.log(`Written: ${entriesPath}`);
      console.log(`Size: ${entriesText.length} bytes`);
      console.log(`Evidence mode: ${includeEvidenceMode ? 'ON (run-artifact tree)' : 'OFF (hashes + shapes only)'}`);
      process.exit(0);
    }

    const csv = entriesToFilteredCsv(filtered, {
      identity: identityForEmit,
      includeEvidenceMode,
    });

    const outputDir = path.resolve(resolvedOutputDir, 'raw');
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = `${args['form-id']}__${args['run-id']}__wpforms_export.csv`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, csv, 'utf8');

    console.log(`Written: ${outputPath}`);
    console.log(`Size: ${csv.length} bytes`);
    console.log(`Evidence mode: ${includeEvidenceMode ? 'ON (run-artifact tree)' : 'OFF (hashes + shapes only)'}`);
    process.exit(0);
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  fetchEntries,
  entriesToCsv, // legacy, kept for backward-compat
  entriesToFilteredCsv,
  entriesToSentPayload,
  entriesToFilteredJson,
  computeMatchedIdentityEmail,
  applyQaFilter,
  hashForCorrelation,
  isDeniedField,
  ALLOWED_COLUMNS_DEFAULT,
  DENIED_FIELD_TOKENS,
  METADATA_ALLOWLIST,
};
