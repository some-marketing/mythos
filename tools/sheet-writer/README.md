# Google Sheets Writer (`tools/sheet-writer/`)

Append structured rows to an **existing** Google Sheet by pasting a whole
tab-separated block in **one clipboard operation** through the operator's
logged-in Chrome profile.

## Why this exists

There was no robust path to append rows to an existing sheet:

- the Google Drive MCP is **create-only** (cannot edit existing sheets),
- there are **no Sheets-API credentials** provisioned,
- hand-typing cell-by-cell in the grid lets Sheets autocomplete/overflow break
  the block.

This tool pastes the entire block atomically (no per-cell typing), conforming to
the sheet's existing column schema, through the operator's signed-in browser.

Sibling to `tools/sheet-builder/` (which builds CSV for Drive **create**). This
is the **writer** for **existing** sheets.

## The clipboard-paste rationale

A clipboard paste into the Sheets grid is interpreted as: **TAB → next column,
NEWLINE → next row**. There is **no quoting escape hatch** on paste (unlike a CSV
file). So a cell value containing a raw tab or newline would silently spill
across cells/rows and misalign the whole block.

`lib/tsv.cjs` therefore **sanitizes every cell**:

- embedded `\t` → single space
- embedded `\r?\n` (and bare `\r`) → ` / `
- `null` / `undefined` → `''`

Quotes and commas are **not** special in TSV and pass through literally — that is
why TSV (not CSV) is the correct clipboard format here. `buildTsv` **fails loud**
(throws) on any row whose keys aren't in the declared column contract — never a
silent misalignment.

## The persistent-profile requirement

Auth is the same approach as `tools/local/google-home-login.js` and
`tools/mcp/delesign/upload-assets.js`:

```js
chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  args: ['--disable-blink-features=AutomationControlled',
         '--profile-directory=<profile>'],
})
```

The signed-in Google session lives in a persistent **user-data-dir**; selecting
the right **profile** is what makes the existing `your-account@example.com` login
take effect.

Defaults (overridable via env **and** `config.json`):

| What | Default | Env override |
| --- | --- | --- |
| user-data-dir | `~/Library/Application Support/Chrome-Automation` | `SHEET_WRITER_CHROME_USER_DATA_DIR` |
| profile | `Profile 1` | `SHEET_WRITER_CHROME_PROFILE` |
| channel | `chrome` | (config.json only) |

**Profile lock:** Playwright cannot open a profile that a normal Chrome window
already has open (`ProcessSingleton` lock). If the operator has that profile open
in regular Chrome, the run fails with a clear message — **quit that Chrome first**
(or dedicate an automation-only profile). The tool always `context.close()`s in a
`finally` block so it releases the lock on exit.

`headless` **must** be `false`: a real signed-in profile needs a headed window,
and the clipboard paste depends on a focused, rendered grid.

## Programmatic API

```js
const { writeBlock } = require('./tools/sheet-writer/write-sheet.cjs');

const result = await writeBlock({
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/<ID>/edit',
  gid: '0',
  columns: ['Date', 'Client', 'Note'],   // must match the sheet's header schema
  rows: [{ Date: '2026-06-30', Client: 'Acme Co', Note: 'kickoff' }],
  anchorCell: 'A12',          // optional; else auto-detect next empty row in col A
  applyHeaderFormat: false,   // optional, best-effort bold of the pasted top row
  validateHeader: true,       // read sheet row 1 and assert it equals `columns`
});
// -> { anchorCell: 'A12', rowsWritten: 1, verify: { pass: true, mismatches: [] } }
```

### Behavior

1. `launchPersistentContext` on the configured profile, open `spreadsheetUrl#gid`.
2. If `validateHeader`, copy sheet row 1 and assert it matches `columns`; throw on mismatch.
3. Anchor: caller-supplied `anchorCell`, else best-effort auto-detect of the next
   empty row in column A (reads the **rendered** grid — virtualized, so for large
   sheets pass an explicit anchor).
4. Put TSV on the clipboard, select the anchor via the **Name Box**, paste once.
5. Optional best-effort `applyHeaderFormat` (Cmd/Ctrl+B on the top pasted row; non-fatal).
6. **VERIFY** (always): re-select the written range, copy, read the clipboard
   back, diff against the expected TSV. Returns `verify.pass` + `mismatches`.
   **Never claims success without read-back.**

## Verification technique & its risk

`navigator.clipboard.writeText` / `readText` require the page to be **focused**
and the origin **permitted**. The tool grants `clipboard-read`/`clipboard-write`
for `https://docs.google.com` and `bringToFront()`s the page before each
clipboard op. **Risk:** if the window loses focus mid-run, a clipboard op can be
rejected — the verify read-back is the backstop that catches a partial/failed
paste rather than reporting a false success.

## LIVE-SMOKE (NOT FOR CI — real browser, real sheet)

> Gated behind the coordinator's separate Codex validation pass. Do **not** run
> in CI; it launches a headed Chrome and writes to a live sheet.

Create a spec file `/tmp/sheet-writer-smoke.json`:

```json
{
  "columns": ["Date", "Note"],
  "rows": [{ "Date": "2026-06-30", "Note": "sheet-writer live smoke" }]
}
```

Then, with the target profile **not** already open in Chrome:

```bash
node tools/sheet-writer/write-sheet.cjs \
  --url 'https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit' \
  --gid '<GID>' \
  --input /tmp/sheet-writer-smoke.json \
  --anchor A2
```

Exit code `0` = paste verified (`verify.pass === true`); `1` = read-back
mismatch. The JSON result is printed to stdout.

## Tests

```bash
node --test tools/sheet-writer/__tests__/tsv.test.cjs
```

Unit tests are **offline**: no network, no browser. They cover header-order
preservation, tab→space, newline→` / `, literal quotes/commas, empty/undefined →
`''`, row-key-mismatch throwing, and the pure URL/anchor/diff helpers.
