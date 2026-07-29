#!/usr/bin/env node
'use strict';

/*
 * sheet-writer / write-sheet.cjs
 *
 * Durable, reusable Google Sheets WRITER.
 *
 * WHY THIS EXISTS
 * ---------------
 * Appending structured rows to an EXISTING Google Sheet had no robust path:
 *   - the Google Drive MCP is create-only (can't edit existing sheets),
 *   - there are no Sheets-API credentials provisioned,
 *   - hand-typing cell-by-cell in the grid lets Sheets autocomplete/overflow
 *     break the block.
 * The fix: paste a whole tab-separated block in ONE clipboard operation
 * (atomic, no per-cell typing) through the operator's logged-in browser
 * profile, conforming to the sheet's existing column schema.
 *
 * AUTH APPROACH (mirrors tools/local/google-home-login.js and
 * tools/mcp/delesign/upload-assets.js):
 *   chromium.launchPersistentContext(userDataDir, {
 *     channel: 'chrome', headless: false,
 *     args: ['--disable-blink-features=AutomationControlled',
 *            '--profile-directory=<profile>']
 *   })
 * The signed-in Google session lives in the persistent user-data-dir; selecting
 * the right profile via --profile-directory is what makes the existing
 * your-account@example.com login take effect. Both the user-data-dir and the
 * profile are configurable via env + config.json.
 *
 * CLIPBOARD-PASTE TECHNIQUE (documented for the coordinator):
 *   1. Grant clipboard-read + clipboard-write permissions on the browser
 *      context for the docs.google.com origin.
 *   2. Write the TSV to the clipboard inside the page:
 *        page.evaluate(t => navigator.clipboard.writeText(t), tsv)
 *   3. Select the anchor cell via the Name Box (click Name Box, type the A1
 *      reference, Enter) — this is the Excel-Online/Sheets-safe way to land on
 *      an exact cell without grid scroll math.
 *   4. Paste with the OS shortcut: Meta+V (darwin) / Control+V (else).
 *   Sheets interprets the pasted TSV: TAB -> next column, NEWLINE -> next row.
 *   That is why lib/tsv.cjs sanitizes embedded tabs/newlines out of every cell.
 *
 * RISK in this technique: navigator.clipboard.writeText requires the page to be
 * focused and the origin permitted; if the window loses focus the write can be
 * rejected. We bring the page to front and grant permissions to mitigate. The
 * verify step (read-back) is the backstop — we never claim success without it.
 *
 * THIS FILE DOES NOT WRITE in unit tests and launches no browser unless invoked
 * as a CLI or via writeBlock(). The live write is gated behind a separate Codex
 * validation pass run by the coordinator.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildTsv } = require('./lib/tsv.cjs');

const CONFIG_PATH = path.join(__dirname, 'config.json');

/** Expand a leading ~ to the user's home directory. */
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    cfg = {};
  }
  return {
    chromeUserDataDir: expandHome(
      process.env.SHEET_WRITER_CHROME_USER_DATA_DIR ||
        cfg.chromeUserDataDir ||
        '~/Library/Application Support/Chrome-Automation'
    ),
    chromeProfile:
      process.env.SHEET_WRITER_CHROME_PROFILE || cfg.chromeProfile || 'Profile 1',
    channel: cfg.channel || 'chrome',
    headless: cfg.headless === true,
    viewport: cfg.viewport || { width: 1440, height: 960 },
  };
}

/**
 * Parse an anchor A1 cell like "A7" into { col, row }. Column must be A
 * (we anchor blocks in column A); row is 1-based.
 */
function parseAnchor(anchorCell) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(anchorCell || '').trim());
  if (!m) throw new Error(`Invalid anchorCell: ${JSON.stringify(anchorCell)} (expected e.g. "A7")`);
  return { col: m[1].toUpperCase(), row: parseInt(m[2], 10) };
}

/** Split a docs.google.com spreadsheet URL + gid into a normalized edit URL. */
function buildEditUrl(spreadsheetUrl, gid) {
  if (!spreadsheetUrl) throw new Error('spreadsheetUrl is required');
  // Strip any existing fragment, then add the gid fragment if provided.
  const base = spreadsheetUrl.split('#')[0];
  if (gid === undefined || gid === null || gid === '') return base;
  return `${base}#gid=${gid}`;
}

/**
 * Read the rendered grid and compute the next empty row in column A.
 * Best-effort: reads the visible/loaded grid cells via the DOM. Returns a
 * 1-based row number (first empty row in column A), or null if it cannot tell.
 *
 * NOTE: Sheets virtualizes the grid, so this only sees loaded rows. For large
 * sheets prefer an explicit anchorCell. Documented as best-effort.
 */
async function detectNextEmptyRowA(page) {
  try {
    return await page.evaluate(() => {
      // Sheets renders cell text into elements with role="gridcell" or into the
      // .cell-input layer. We scan column-A cells (data-col-index 0 where
      // available) for the greatest row index that has text.
      const cells = Array.from(
        document.querySelectorAll('[aria-colindex="1"][aria-rowindex], .grid-table td')
      );
      let maxRow = 0;
      for (const el of cells) {
        const ri = el.getAttribute && el.getAttribute('aria-rowindex');
        const text = (el.textContent || '').trim();
        if (ri && text) {
          const r = parseInt(ri, 10);
          if (!Number.isNaN(r) && r > maxRow) maxRow = r;
        }
      }
      return maxRow > 0 ? maxRow + 1 : null;
    });
  } catch (_) {
    return null;
  }
}

/** Select an A1 cell/range via the Name Box. */
async function selectViaNameBox(page, a1Ref) {
  // The Name Box is the cell-reference field at the top-left of the grid.
  // Selectors are tried in order; the first that exists wins.
  const nameBoxSelectors = [
    '#t-name-box',
    'input.waffle-name-box',
    '[aria-label="Name box"]',
    'input[aria-label*="Name box"]',
  ];
  let box = null;
  for (const sel of nameBoxSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      box = loc;
      break;
    }
  }
  if (!box) throw new Error('Could not locate the Sheets Name Box to select the anchor cell');
  await box.click();
  // Clear any existing reference, type ours, commit with Enter.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(a1Ref);
  await page.keyboard.press('Enter');
  // Give the grid a beat to scroll/select.
  await page.waitForTimeout(400);
}

/** Put text on the clipboard inside the page context. */
async function setClipboard(page, text) {
  await page.bringToFront();
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

/** Read the current clipboard text from the page context. */
async function readClipboard(page) {
  await page.bringToFront();
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Compare two TSV blocks cell-by-cell. Returns { pass, mismatches }.
 * The read-back from Sheets may differ in trailing-whitespace/empty-trailing
 * cells, so we compare trimmed cells per row up to the expected width.
 */
function diffTsv(expectedTsv, actualTsv, columnCount) {
  const expRows = expectedTsv.split('\n');
  const actRows = actualTsv.replace(/\r/g, '').split('\n');
  const mismatches = [];
  for (let r = 0; r < expRows.length; r++) {
    const expCells = expRows[r].split('\t');
    const actCells = (actRows[r] || '').split('\t');
    for (let c = 0; c < columnCount; c++) {
      const e = (expCells[c] || '').trim();
      const a = (actCells[c] || '').trim();
      if (e !== a) {
        mismatches.push({ row: r, col: c, expected: e, actual: a });
      }
    }
  }
  return { pass: mismatches.length === 0, mismatches };
}

/**
 * Write a tab-separated block into an existing Google Sheet via clipboard paste.
 *
 * @param {Object} args
 * @param {string} args.spreadsheetUrl - https://docs.google.com/spreadsheets/d/<id>/edit
 * @param {string|number} [args.gid] - target tab gid
 * @param {string[]} args.columns - ordered column contract (must match sheet schema)
 * @param {Array<Object>} args.rows - rows keyed by column name
 * @param {string} [args.anchorCell] - explicit A1 anchor (e.g. "A12"); else auto-detect next empty row in A
 * @param {boolean} [args.applyHeaderFormat=false] - best-effort bold the pasted top row
 * @param {boolean} [args.validateHeader=true] - read sheet header row 1 and assert it matches `columns`
 * @returns {Promise<{anchorCell:string, rowsWritten:number, verify:{pass:boolean, mismatches:Array}}>}
 */
async function writeBlock(args) {
  const {
    spreadsheetUrl,
    gid,
    columns,
    rows,
    anchorCell,
    applyHeaderFormat = false,
    validateHeader = true,
  } = args || {};

  // Build + validate the TSV FIRST (fails loud, no browser needed if data is bad).
  const tsv = buildTsv(columns, rows); // throws on key mismatch / bad shape

  // Lazy-require playwright so importing this module (e.g. in tests) never
  // forces a browser dependency or launch.
  const { chromium } = require('playwright');
  const cfg = loadConfig();

  if (!fs.existsSync(cfg.chromeUserDataDir)) {
    throw new Error(
      `Chrome user-data-dir not found: ${cfg.chromeUserDataDir}\n` +
        `Set SHEET_WRITER_CHROME_USER_DATA_DIR or fix config.json.`
    );
  }

  let context;
  try {
    context = await chromium.launchPersistentContext(cfg.chromeUserDataDir, {
      channel: cfg.channel,
      headless: cfg.headless,
      viewport: cfg.viewport,
      args: [
        '--disable-blink-features=AutomationControlled',
        `--profile-directory=${cfg.chromeProfile}`,
      ],
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    // The most common failure: the profile is already open in a running Chrome.
    if (/ProcessSingleton|already (running|in use)|profile.*lock|cannot create/i.test(msg)) {
      throw new Error(
        'Chrome profile is locked / already in use. The signed-in profile ' +
          `("${cfg.chromeProfile}" in ${cfg.chromeUserDataDir}) cannot be opened ` +
          'by Playwright while a normal Chrome window has it open. Quit that ' +
          'Chrome (or use a dedicated automation profile) and re-run.\n' +
          `Underlying error: ${msg}`
      );
    }
    throw e;
  }

  try {
    // Grant clipboard permissions for the Sheets origin so navigator.clipboard
    // read/write succeed without a user gesture prompt.
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: 'https://docs.google.com',
      });
    } catch (_) {
      // Non-fatal: some channels grant implicitly; verify step will catch issues.
    }

    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(30000);

    const editUrl = buildEditUrl(spreadsheetUrl, gid);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
    // Wait for the grid to render (Name Box present).
    await page
      .locator('#t-name-box, input.waffle-name-box, [aria-label="Name box"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60000 });

    // --- Optional header validation: read row 1 and compare to `columns`. ---
    if (validateHeader) {
      await selectViaNameBox(page, `A1:${colLetter(columns.length)}1`);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
      await page.waitForTimeout(300);
      const headerClip = (await readClipboard(page)).replace(/\r/g, '').split('\n')[0] || '';
      const headerCells = headerClip.split('\t').map((s) => s.trim());
      const expectedHeader = columns.map((c) => String(c).trim());
      // Only enforce if the sheet actually has a header (non-empty row 1).
      const sheetHasHeader = headerCells.some((c) => c !== '');
      if (sheetHasHeader) {
        const mismatch = expectedHeader.some((h, i) => (headerCells[i] || '') !== h);
        if (mismatch) {
          throw new Error(
            'Header contract mismatch: sheet row 1 does not match `columns`.\n' +
              `  sheet:    ${JSON.stringify(headerCells.slice(0, expectedHeader.length))}\n` +
              `  expected: ${JSON.stringify(expectedHeader)}`
          );
        }
      }
    }

    // --- Determine anchor cell. ---
    let anchor = anchorCell;
    if (!anchor) {
      const nextRow = await detectNextEmptyRowA(page);
      if (!nextRow) {
        throw new Error(
          'Could not auto-detect the next empty row in column A. ' +
            'Pass an explicit anchorCell (e.g. "A12").'
        );
      }
      anchor = `A${nextRow}`;
    }
    const { row: anchorRow } = parseAnchor(anchor);

    // --- Put TSV on clipboard and paste in ONE operation. ---
    await selectViaNameBox(page, anchor);
    await setClipboard(page, tsv);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await page.waitForTimeout(800);

    const rowsWritten = rows.length;

    // --- Optional best-effort header-format (bold the top pasted row). ---
    if (applyHeaderFormat) {
      try {
        const endCol = colLetter(columns.length);
        await selectViaNameBox(page, `A${anchorRow}:${endCol}${anchorRow}`);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+B' : 'Control+B');
        await page.waitForTimeout(200);
      } catch (_) {
        // Non-fatal by contract.
      }
    }

    // --- VERIFY: re-select the written range, copy, read back, diff. ---
    const endCol = colLetter(columns.length);
    const endRow = anchorRow + rowsWritten - 1;
    await selectViaNameBox(page, `A${anchorRow}:${endCol}${endRow}`);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    await page.waitForTimeout(400);
    const readBack = await readClipboard(page);
    const verify = diffTsv(tsv, readBack, columns.length);

    return { anchorCell: anchor, rowsWritten, verify };
  } finally {
    // Always close the context so the profile lock is released.
    try {
      await context.close();
    } catch (_) {}
  }
}

/** 1-based column count -> spreadsheet column letter(s) (1->A, 27->AA). */
function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv);
  if (!a.url || !a.input) {
    console.error(
      'Usage: node tools/sheet-writer/write-sheet.cjs \\\n' +
        '  --url <spreadsheetUrl> [--gid <gid>] \\\n' +
        '  --input <rows.json>            # { "columns": [...], "rows": [ {..}, .. ] }\n' +
        '  [--anchor A12] [--apply-header-format] [--no-validate-header]\n\n' +
        'Pastes a tab-separated block in ONE clipboard op via the operator profile.\n' +
        'Requires a headed, signed-in Chrome profile (see README; not for CI).'
    );
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(path.resolve(a.input), 'utf8'));
  const result = await writeBlock({
    spreadsheetUrl: a.url,
    gid: a.gid,
    columns: spec.columns,
    rows: spec.rows,
    anchorCell: a.anchor,
    applyHeaderFormat: !!a['apply-header-format'],
    validateHeader: !a['no-validate-header'],
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.verify.pass ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERR', e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}

module.exports = {
  writeBlock,
  // exported for unit testing of pure helpers
  sanitizeAnchor: parseAnchor,
  buildEditUrl,
  diffTsv,
  colLetter,
  expandHome,
};
