#!/usr/bin/env node
'use strict';
//
// Google Sheets API writer for Mythos. API-first replacement for the fragile
// clipboard-paste tool at tools/sheet-writer/ (which drives a logged-in browser
// and cannot programmatically clear or create). Values go to the Sheets REST API
// as a JSON 2D array — NO Name Box, NO clipboard TSV, NO browser.
//
// Operations:
//   updateRange(config, id, range, values2D, {valueInputOption})  -> values.update (PUT)
//   appendRows(config, id, range, values2D, {valueInputOption})   -> values.append (POST)
//   clearRange(config, id, range)                                 -> values.clear  (POST)
//   createSpreadsheet(config, title, parentFolderId?)             -> spreadsheets.create (+ optional Drive move)
//
// CLI (creds injected by run-with-op.sh):
//   tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js \
//     --id <spreadsheetId> --range 'Sheet1!A1' --input rows.json [--mode update|append|clear|create]
//
// SAFE-BY-DEFAULT: without --apply this is a DRY RUN — it renders the exact
// request body/URL and exits WITHOUT minting creds or touching the network. Pass
// --apply to perform the live mutation. --dry-run is still accepted (and always
// forces dry-run, overriding --apply).
//
const fs = require('fs');
const path = require('path');
const { loadSheetsConfig } = require('./config');
const { getAccessToken, googleApiRequest } = require('./client');

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';
const VALUE_INPUT_OPTIONS = ['RAW', 'USER_ENTERED'];
const MODES = ['update', 'append', 'clear', 'create'];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested offline in __tests__/)
// ---------------------------------------------------------------------------

/** Coerce a single cell into an API-safe scalar. null/undefined -> '', objects -> JSON. */
function cellToValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v; // string | number | boolean pass through (Sheets accepts these)
}

/** Normalize a row (array) into API-safe cells. */
function normalizeRow(row) {
  if (!Array.isArray(row)) {
    throw new Error(`Each row must be an array of cells (got: ${typeof row})`);
  }
  return row.map(cellToValue);
}

/**
 * Coerce flexible JSON input into a Sheets 2D values array.
 * Accepts:
 *   1. a bare 2D array: [["a","b"],["c","d"]]
 *   2. { "values": [[...], ...] }
 *   3. { "columns": [...], "rows": [ {col: val, ...}, ... ] }  (compat with the
 *      old clipboard tool's rows.json shape; emits header row + body rows)
 */
function coerceValues2D(input) {
  if (input == null) throw new Error('values input is required');
  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    if (input.every((r) => Array.isArray(r))) return input.map(normalizeRow);
    throw new Error(
      'Array input must be a 2D array (array of row-arrays). For row objects, wrap in {columns, rows}.'
    );
  }
  if (typeof input === 'object') {
    if (Array.isArray(input.values)) return input.values.map(normalizeRow);
    if (Array.isArray(input.columns) && Array.isArray(input.rows)) {
      const header = input.columns.map(String);
      const body = input.rows.map((row) => header.map((col) => cellToValue(row[col])));
      return [header, ...body];
    }
  }
  throw new Error('Unrecognized values input; expected a 2D array, {values}, or {columns, rows}.');
}

/**
 * Validate an A1-notation range (optionally sheet-qualified). Permissive enough
 * for the common forms: "A1", "A1:B2", "Sheet1!A1:B2", "'My Sheet'!A1", "A:A".
 */
function isValidA1Range(range) {
  if (typeof range !== 'string' || !range.trim()) return false;
  let r = range.trim();
  const bang = r.lastIndexOf('!');
  if (bang >= 0) {
    const sheet = r.slice(0, bang);
    r = r.slice(bang + 1);
    if (!sheet) return false;
    if (sheet.startsWith("'") && (!sheet.endsWith("'") || sheet.length < 2)) return false;
  }
  if (!r) return false;
  const segs = r.split(':');
  if (segs.length > 2) return false;
  const part = /^\$?[A-Za-z]{0,3}\$?[0-9]*$/;
  for (const s of segs) {
    if (!s || !part.test(s) || !/[A-Za-z0-9]/.test(s)) return false;
  }
  return true;
}

function assertValidRange(range) {
  if (!isValidA1Range(range)) {
    throw new Error(`Invalid A1 range: ${JSON.stringify(range)} (expected e.g. "Sheet1!A1" or "A1:C10")`);
  }
}

function assertValueInputOption(vio) {
  if (!VALUE_INPUT_OPTIONS.includes(vio)) {
    throw new Error(`valueInputOption must be one of ${VALUE_INPUT_OPTIONS.join('|')} (got: ${vio})`);
  }
}

/** ValueRange request body (Sheets API shape). */
function buildValueRangeBody(range, values) {
  return { range, majorDimension: 'ROWS', values };
}

function buildUpdateUrl(spreadsheetId, range, valueInputOption) {
  return (
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?valueInputOption=${encodeURIComponent(valueInputOption)}`
  );
}

function buildAppendUrl(spreadsheetId, range, valueInputOption) {
  return (
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=${encodeURIComponent(valueInputOption)}&insertDataOption=INSERT_ROWS`
  );
}

function buildClearUrl(spreadsheetId, range) {
  return `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`;
}

/** Minimal `--flag value` / boolean-flag arg parser. */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * Decide dry-run vs live from parsed args. Safe-by-default: a live mutation
 * requires an explicit --apply. --dry-run is accepted and always forces dry-run
 * (it overrides --apply). Returns true for dry-run.
 */
function resolveDryRun(a) {
  const dryRunFlag = !!a['dry-run'];
  const apply = !!a.apply;
  return dryRunFlag || !apply;
}

/** Validate the required args for a given mode. Returns an error string or null. */
function requiredArgsError(mode, a) {
  const m = mode || 'update';
  if (!MODES.includes(m)) return `--mode must be ${MODES.join('|')} (got: ${m})`;
  if (m === 'create') {
    if (!a.title) return 'create mode requires --title <title>';
    return null;
  }
  if (!a.id) return '--id <spreadsheetId> is required';
  if (!a.range) return '--range <A1> is required';
  if ((m === 'update' || m === 'append') && !a.input) {
    return `--input <rows.json> is required for ${m} mode`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Operations (network — skipped entirely when config.dryRun is true)
// ---------------------------------------------------------------------------

async function updateRange(config, spreadsheetId, range, values2D, opts = {}) {
  const valueInputOption = opts.valueInputOption || 'RAW';
  assertValidRange(range);
  assertValueInputOption(valueInputOption);
  const values = coerceValues2D(values2D);
  const url = buildUpdateUrl(spreadsheetId, range, valueInputOption);
  const body = buildValueRangeBody(range, values);
  if (config.dryRun) return { dryRun: true, request: { method: 'PUT', url, body } };
  const accessToken = await getAccessToken(config);
  const json = await googleApiRequest({ accessToken, method: 'PUT', url, body });
  return {
    op: 'update',
    updatedRange: json.updatedRange,
    updatedRows: json.updatedRows,
    updatedColumns: json.updatedColumns,
    updatedCells: json.updatedCells,
    raw: json,
  };
}

async function appendRows(config, spreadsheetId, range, values2D, opts = {}) {
  const valueInputOption = opts.valueInputOption || 'RAW';
  assertValidRange(range);
  assertValueInputOption(valueInputOption);
  const values = coerceValues2D(values2D);
  const url = buildAppendUrl(spreadsheetId, range, valueInputOption);
  const body = buildValueRangeBody(range, values);
  if (config.dryRun) return { dryRun: true, request: { method: 'POST', url, body } };
  const accessToken = await getAccessToken(config);
  const json = await googleApiRequest({ accessToken, method: 'POST', url, body });
  return {
    op: 'append',
    tableRange: json.tableRange,
    updates: json.updates,
    raw: json,
  };
}

async function clearRange(config, spreadsheetId, range) {
  assertValidRange(range);
  const url = buildClearUrl(spreadsheetId, range);
  if (config.dryRun) return { dryRun: true, request: { method: 'POST', url, body: {} } };
  const accessToken = await getAccessToken(config);
  const json = await googleApiRequest({ accessToken, method: 'POST', url, body: {} });
  return { op: 'clear', clearedRange: json.clearedRange, raw: json };
}

async function createSpreadsheet(config, title, parentFolderId) {
  if (!title) throw new Error('title is required to create a spreadsheet');
  const url = SHEETS_BASE;
  const body = { properties: { title } };
  if (config.dryRun) {
    return { dryRun: true, request: { method: 'POST', url, body }, parentFolderId: parentFolderId || null };
  }
  const accessToken = await getAccessToken(config);
  const json = await googleApiRequest({ accessToken, method: 'POST', url, body });
  const spreadsheetId = json.spreadsheetId;
  let moved = null;
  if (parentFolderId) {
    // Move into the target Drive folder. drive.file scope covers files this app
    // created. Fetch current parents, then re-parent in one PATCH.
    const meta = await googleApiRequest({
      accessToken,
      method: 'GET',
      url: `${DRIVE_BASE}/${encodeURIComponent(spreadsheetId)}?fields=parents`,
    });
    const removeParents = (meta.parents || []).join(',');
    const moveUrl =
      `${DRIVE_BASE}/${encodeURIComponent(spreadsheetId)}` +
      `?addParents=${encodeURIComponent(parentFolderId)}` +
      (removeParents ? `&removeParents=${encodeURIComponent(removeParents)}` : '') +
      `&fields=id,parents`;
    moved = await googleApiRequest({ accessToken, method: 'PATCH', url: moveUrl, body: {} });
  }
  return {
    op: 'create',
    spreadsheetId,
    spreadsheetUrl: json.spreadsheetUrl,
    parentFolderId: parentFolderId || null,
    moved,
    raw: json,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return (
    'usage: write-sheet.js --mode <update|append|clear|create> [opts]\n' +
    '  update : --id <spreadsheetId> --range <A1> --input <rows.json> [--value-input RAW|USER_ENTERED]\n' +
    '  append : --id <spreadsheetId> --range <A1> --input <rows.json> [--value-input RAW|USER_ENTERED]\n' +
    '  clear  : --id <spreadsheetId> --range <A1>\n' +
    '  create : --title <title> [--parent <driveFolderId>]\n' +
    '  global : --apply   PERFORM the live mutation (default is a safe dry run)\n' +
    '           --dry-run render the request without creds or network (default; overrides --apply)\n\n' +
    'rows.json may be a 2D array, {"values":[[...]]}, or {"columns":[...],"rows":[{..}]}.'
  );
}

async function main() {
  const a = parseArgs(process.argv);
  const mode = a.mode === true || !a.mode ? 'update' : a.mode;
  // Safe-by-default: a live mutation requires an explicit --apply. --dry-run is
  // accepted as an alias and always forces dry-run (overriding --apply).
  const dryRun = resolveDryRun(a);

  const argErr = requiredArgsError(mode, a);
  if (argErr) {
    console.error(`[sheets] ${argErr}\n\n${usage()}`);
    process.exit(2);
  }

  if (dryRun && !a.apply) {
    console.error('[sheets] DRY RUN (default). Re-run with --apply to perform the live mutation.');
  }

  const config = dryRun ? { dryRun: true } : loadSheetsConfig();
  const valueInputOption = a['value-input'] || 'RAW';

  let values2D;
  if (mode === 'update' || mode === 'append') {
    values2D = JSON.parse(fs.readFileSync(path.resolve(a.input), 'utf8'));
  }

  try {
    let result;
    if (mode === 'update') {
      result = await updateRange(config, a.id, a.range, values2D, { valueInputOption });
    } else if (mode === 'append') {
      result = await appendRows(config, a.id, a.range, values2D, { valueInputOption });
    } else if (mode === 'clear') {
      result = await clearRange(config, a.id, a.range);
    } else if (mode === 'create') {
      result = await createSpreadsheet(config, a.title, a.parent);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('[sheets] ERROR:', e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[sheets] ERROR:', e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}

module.exports = {
  // operations
  updateRange,
  appendRows,
  clearRange,
  createSpreadsheet,
  // pure helpers (exported for offline unit tests)
  cellToValue,
  normalizeRow,
  coerceValues2D,
  isValidA1Range,
  assertValidRange,
  assertValueInputOption,
  buildValueRangeBody,
  buildUpdateUrl,
  buildAppendUrl,
  buildClearUrl,
  parseArgs,
  resolveDryRun,
  requiredArgsError,
  MODES,
  VALUE_INPUT_OPTIONS,
};
