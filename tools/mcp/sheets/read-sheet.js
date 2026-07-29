'use strict';
//
// tools/mcp/sheets/read-sheet.js — API-first Google Sheets READER.
//
// The companion to write-sheet.js: authenticates via the same User-OAuth
// refresh-token flow (creds injected by run-with-op.sh from 1Password) and reads
// a range directly from the Sheets REST API — no browser, no clipboard, no
// Playwright. Reading is always safe, so there is no --apply gate.
//
// Operation:
//   readRange(config, id, range) -> values.get (GET) -> { range, majorDimension, values: [[...]] }
//
// CLI:
//   tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/read-sheet.js \
//     --id <spreadsheetId> --range 'Tab Name!A1:K50' [--json] [--no-trailing-fill]
//
// Output: TSV to stdout by default (one row per line, tab-separated cells), or
// the raw JSON values array with --json. Missing trailing cells in a row are
// emitted as empty fields so columns line up (disable with --no-trailing-fill).
//
const { loadSheetsConfig } = require('./config');
const { getAccessToken, googleApiRequest } = require('./client');

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Build the values.get URL for a spreadsheet + A1 range. */
function buildReadUrl(spreadsheetId, range) {
  return (
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}`
  );
}

/**
 * Read a range from a spreadsheet.
 * @param {{clientId,clientSecret,refreshToken}} config
 * @param {string} spreadsheetId
 * @param {string} range  A1 notation, optionally sheet-qualified ("Tab!A1:K50")
 * @returns {Promise<{range:string, majorDimension:string, values:string[][]}>}
 */
async function readRange(config, spreadsheetId, range) {
  const accessToken = await getAccessToken(config);
  const url = buildReadUrl(spreadsheetId, range);
  const json = await googleApiRequest({ accessToken, method: 'GET', url });
  return { range: json.range, majorDimension: json.majorDimension, values: json.values || [] };
}

/** Minimal `--flag value` / boolean-flag arg parser (mirrors write-sheet.js). */
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      a[key] = true;
    } else {
      a[key] = next;
      i += 1;
    }
  }
  return a;
}

/** Pad rows to a uniform column count so TSV columns align. */
function fillRows(values) {
  const width = values.reduce((m, r) => Math.max(m, r.length), 0);
  return values.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push('');
    return out;
  });
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.id) throw new Error('--id <spreadsheetId> is required');
  if (!a.range) throw new Error("--range <A1> is required (e.g. 'Tab!A1:K50')");

  const config = loadSheetsConfig();
  const result = await readRange(config, a.id, a.range);

  if (a.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const rows = a['no-trailing-fill'] ? result.values : fillRows(result.values);
  for (const row of rows) {
    process.stdout.write(`${row.map((c) => String(c ?? '')).join('\t')}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`read-sheet error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { readRange, buildReadUrl, parseArgs, fillRows };
