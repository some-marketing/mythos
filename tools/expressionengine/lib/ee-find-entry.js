'use strict';

/**
 * ee-find-entry.js — Read-only entry-discovery helpers for the EE CP.
 *
 * Two capabilities:
 *
 *   1. searchByTitle(loginUrl, cookies, titleSubstring, channelFilter?)
 *      Authenticates (session already live from loginToCP), GETs the EE CP
 *      entries listing page, and parses rows into:
 *        [{ entry_id, channel_id, title, edit_url }]
 *      Optional channelFilter (number) restricts to one channel.
 *
 *   2. locateField(loginUrl, cookies, entryId, containsString?)
 *      GETs the entry-edit page (reuses getEntryEditPage), lists all field
 *      inputs (field_id_N) with a label excerpt and value preview, and
 *      optionally identifies which field CONTAINS a given string
 *      (entity-decoded, so "&amp;" matches "&").
 *
 * READ-ONLY. Neither function POSTs anything. Neither function prints
 * credentials, cookies, XID/CSRF tokens, or any session material.
 *
 * ── EE CP entries listing URL assumption ──────────────────────────────────
 *
 * EE 6/7 CP entries listing is served at:
 *   GET /admin.php?/cp/publish/edit
 *   with optional query params:  channel_id=N  search[title]=substring
 *
 * Row HTML is ASSUMED to follow EE 6/7 conventions:
 *   <tr data-id="{entry_id}"> (or tr with a td/a containing the edit link)
 *   edit link:  href="...cp/publish/edit/entry/{entry_id}"
 *   title cell: the <a> text or a td near the link
 *
 * ⚠️  PARSER CONFIDENCE: MEDIUM. The EE CP listing markup has not been
 * captured from a real live site yet. This parser was written against EE 6/7
 * source conventions and publicly documented admin HTML structure.
 * THE FIRST LIVE RUN IS THE REAL VALIDATION. If the parser returns empty
 * results, run with --debug-html to capture the listing HTML, then adjust
 * the selectors in parseEntryListingRows() accordingly. One-line tweaks are
 * likely sufficient. See README for details.
 *
 * No external npm dependencies — Node.js built-ins only.
 */

const { getEntryEditPage, extractFieldValue, decodeHtmlEntities, request } = require('./ee-auth');

// ─── S7a: Entry listing ───────────────────────────────────────────────────────

/**
 * Build the EE CP entries listing path + query string.
 *
 * EE 6/7:  /admin.php?/cp/publish/edit
 *   with appended GET params:  &channel_id=N  &search[title]=substring
 *
 * Note: EE uses a URL pattern (/admin.php?/cp/...) where the path after "?"
 * is a path segment, not a query string. Actual GET parameters are appended
 * after an "&" separator, NOT a second "?".
 *
 * Examples:
 *   /admin.php?/cp/publish/edit
 *   /admin.php?/cp/publish/edit&channel_id=7
 *   /admin.php?/cp/publish/edit&search[title]=Nadia
 *   /admin.php?/cp/publish/edit&channel_id=7&search[title]=Nadia
 *
 * @param {object}      loginUrl      — parsed CP URL from parseCpUrl()
 * @param {string}      titleSubstr   — title search substring (may be empty string)
 * @param {number|null} channelFilter — optional channel_id filter
 * @returns {string}  the full path+query for the GET request
 */
function buildListingPath(loginUrl, titleSubstr, channelFilter) {
  let path = `${loginUrl.loginPath}?/cp/publish/edit`;
  const params = [];
  if (channelFilter) params.push(`channel_id=${encodeURIComponent(channelFilter)}`);
  if (titleSubstr)   params.push(`search[title]=${encodeURIComponent(titleSubstr)}`);
  if (params.length) path += '&' + params.join('&');
  return path;
}

/**
 * Parse entry rows from an EE CP entry-listing page HTML.
 *
 * Returns an array of:
 *   { entry_id: number, channel_id: number|null, title: string, edit_url: string }
 *
 * Strategy (tolerant — tries multiple patterns):
 *
 *   Pattern A (EE 6/7 standard — most reliable):
 *     <a href="...cp/publish/edit/entry/{N}">…title text…</a>
 *     entry_id extracted from the href.
 *     title = the trimmed text content of the <a> tag (strips inner tags).
 *
 *   Pattern B (EE 7 data-id on <tr>):
 *     <tr ... data-id="{N}"> ... </tr>
 *     Used as a fallback to catch rows where the <a> may not directly hold
 *     the title (e.g. when the title is in a sibling <td>).
 *
 *   channel_id: parsed from a hidden input or data attribute near the row, or
 *     from the href if the listing URL already filters by channel. Falls back
 *     to null when not determinable from static HTML.
 *
 * Rows with no parseable entry_id are silently skipped (tolerant).
 *
 * @param {string}        html           — raw listing page HTML
 * @param {number|null}   channelFilter  — if set, assumed channel for all rows
 * @returns {Array<{entry_id, channel_id, title, edit_url}>}
 */
function parseEntryListingRows(html, channelFilter) {
  const results = [];
  const seen    = new Set(); // deduplicate by entry_id

  // Pattern A: find all CP edit links  href="…/cp/publish/edit/entry/{N}…"
  // Capture the surrounding context (up to 300 chars) to extract title text.
  const linkRe = /<a\s[^>]*href=["']([^"']*\/cp\/publish\/edit\/entry\/(\d+)[^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href    = m[1];
    const entryId = parseInt(m[2], 10);
    if (isNaN(entryId) || seen.has(entryId)) continue;

    // Strip inner tags from the anchor text to get plain title
    const rawText = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rawText) continue; // skip icon-only links (e.g. edit buttons with only <img>)

    seen.add(entryId);

    // Build a fully-qualified edit_url from the href (may be relative)
    const edit_url = href.startsWith('http') ? href : href;

    results.push({
      entry_id:   entryId,
      channel_id: channelFilter || null,
      title:      decodeHtmlEntities(rawText),
      edit_url,
    });
  }

  return results;
}

/**
 * S7a: Search EE CP entries by title substring.
 *
 * Authenticates using the live session from loginToCP(), GETs the entries
 * listing page with an EE title search param, and parses the result rows.
 *
 * READ-ONLY: no POST is issued.
 *
 * @param {object}      loginUrl      — parsed CP URL from loginToCP()
 * @param {object}      cookies       — session cookie jar from loginToCP()
 * @param {string}      titleSubstr   — title substring to search for
 * @param {number|null} channelFilter — optional channel_id to scope the search
 * @param {boolean}     [debug]       — if true, write raw listing HTML to _dev/debug/
 * @returns {Promise<Array<{entry_id, channel_id, title, edit_url}>>}
 */
async function searchByTitle(loginUrl, cookies, titleSubstr, channelFilter, debug) {
  const listingPath = buildListingPath(loginUrl, titleSubstr, channelFilter);

  const getOpts = {
    protocol: loginUrl.protocol,
    hostname: loginUrl.hostname,
    port:     loginUrl.port,
    path:     listingPath,
    method:   'GET',
    headers:  {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer':    `${loginUrl.baseUrl}${loginUrl.loginPath}?/cp/`,
    },
  };

  const resp = await request(getOpts, null, cookies, 5);

  if (resp.statusCode >= 400) {
    throw new Error(
      `EE CP entries listing returned HTTP ${resp.statusCode}. ` +
      `Path: ${listingPath}`
    );
  }
  if (/name="password"/i.test(resp.body)) {
    throw new Error(
      'EE session expired — bounced to login page while fetching entries listing. ' +
      'Re-authenticate and retry.'
    );
  }

  if (debug) {
    // Write raw listing HTML (tokens will NOT be present — this is a GET response
    // for a listing page, not an edit form). Still gitignored, still 0o600 like ee-edit.js.
    const fs   = require('fs');
    const path = require('path');
    const debugDir  = path.join(__dirname, '..', '..', '..', '_dev', 'debug');
    try { fs.mkdirSync(debugDir, { recursive: true }); } catch { /* ok */ }
    const debugPath = path.join(debugDir, 'ee-find-listing.html');
    fs.writeFileSync(debugPath, resp.body, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(`[debug] Listing HTML saved to ${debugPath}\n`);
    process.stdout.write('[debug] WARNING: listing HTML may contain private CP content — do not commit.\n');
  }

  return parseEntryListingRows(resp.body, channelFilter || null);
}

// ─── S7b: Field locator ───────────────────────────────────────────────────────

/**
 * Parse all field_id_N inputs and textareas from an EE entry-edit page HTML.
 *
 * Returns an array of:
 *   { field_name: string, type: 'textarea'|'input', value_excerpt: string }
 *
 * The value_excerpt is the first 120 characters of the decoded field value —
 * enough to identify the right field without flooding the terminal.
 *
 * @param {string} html — raw edit page HTML
 * @returns {Array<{field_name, type, value_excerpt}>}
 */
function parseFieldList(html) {
  const fields = [];
  const seen   = new Set();

  // Textareas first: <textarea name="field_id_N">…</textarea>
  const taRe = /<textarea[^>]*name=["'](field_id_\d+)["'][^>]*>([\s\S]*?)<\/textarea>/gi;
  let m;
  while ((m = taRe.exec(html)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const decoded  = decodeHtmlEntities(m[2]);
    fields.push({
      field_name:    name,
      type:          'textarea',
      value_excerpt: decoded.slice(0, 120) + (decoded.length > 120 ? '…' : ''),
    });
  }

  // Input fields: <input ... name="field_id_N" ... value="...">
  const inputRe = /<input\b[^>]*>/gi;
  while ((m = inputRe.exec(html)) !== null) {
    const tag  = m[0];
    const nameM = /name=["'](field_id_\d+)["']/.exec(tag);
    if (!nameM) continue;
    const name = nameM[1];
    if (seen.has(name)) continue;
    seen.add(name);

    // Extract value attribute (may be absent)
    const valM = /value=["']([^"']*)["']/.exec(tag);
    const raw  = valM ? valM[1] : '';
    const decoded = decodeHtmlEntities(raw);
    fields.push({
      field_name:    name,
      type:          'input',
      value_excerpt: decoded.slice(0, 120) + (decoded.length > 120 ? '…' : ''),
    });
  }

  return fields;
}

/**
 * S7b: Locate fields on an entry-edit page; optionally identify which field
 * contains a given string (entity-decoded, so "&" matches "&amp;" in HTML).
 *
 * Reuses getEntryEditPage() from ee-auth.js for the GET + XID extraction.
 * READ-ONLY: no POST is issued.
 *
 * @param {object}      loginUrl      — parsed CP URL from loginToCP()
 * @param {object}      cookies       — session cookie jar from loginToCP()
 * @param {number}      entryId       — EE entry ID
 * @param {string|null} containsStr   — optional: find the field whose decoded
 *                                      value contains this string
 * @returns {Promise<{
 *   entry_id: number,
 *   fields:   Array<{field_name, type, value_excerpt}>,
 *   match:    {field_name, type, value_excerpt}|null
 * }>}
 */
async function locateField(loginUrl, cookies, entryId, containsStr) {
  const { body } = await getEntryEditPage(loginUrl, cookies, entryId, null);

  const fields = parseFieldList(body);

  let match = null;
  if (containsStr) {
    // Compare against decoded values (entity-safe)
    for (const f of fields) {
      // Re-extract the full decoded value for the contains check
      // (value_excerpt is truncated — check the full value via extractFieldValue)
      const fullVal = extractFieldValue(body, f.field_name);
      if (fullVal !== null && fullVal.includes(containsStr)) {
        match = f;
        break;
      }
    }
  }

  return { entry_id: entryId, fields, match };
}

module.exports = {
  searchByTitle,
  locateField,
  // exported for unit tests
  _buildListingPath:        buildListingPath,
  _parseEntryListingRows:   parseEntryListingRows,
  _parseFieldList:          parseFieldList,
};
