# tools/mcp/sheets — Google Sheets API writer

API-first Google Sheets writer for Mythos. Authenticates via **User-OAuth** (the
operator's refresh token) and talks directly to the Sheets/Drive REST APIs —
update, append, clear, and create sheets with a JSON 2D array. No browser, no
clipboard, no Name Box.

Built on `google-auth-library` (already a dependency) + the global `fetch` REST
calls — **no `googleapis` package needed**. This mirrors the proven pattern in
`tools/mcp/youtube/`.

## Supersedes
- **`tools/sheet-writer/`** (clipboard-paste through a logged-in Chrome profile):
  fragile, login-expiration-prone, wrong-account risk, cannot programmatically
  clear cells. Kept as a **documented fallback** for the rare case where no
  OAuth refresh token is available and a human is at the headed browser.
- The **service-account** approach: mints a JWT from a downloaded service-account JSON key. This tool instead
  reuses the operator's existing User-OAuth pattern (same credential model as the
  youtube tool), so there is no extra key file to provision or git-ignore.

## Callers / migration
A repo scan for callers of the old clipboard tool
(`grep -rl "sheet-writer" tools/ _dev/ --include=*.js --include=*.cjs --include=*.sh`)
finds **no external callers** — only `tools/sheet-writer/write-sheet.cjs` itself
and this tool's own header comment. There is therefore nothing to migrate, and
the clipboard tool is **not removed**: it remains as the documented headed-browser
fallback (see *Supersedes* above).

## Files
- `write-sheet.js` — CLI + operations: `updateRange`, `appendRows`, `clearRange`,
  `createSpreadsheet`. Pure helpers (value-shaping, A1 validation, arg parsing,
  URL building) are exported for the offline tests.
- `client.js` — access-token mint (from refresh token) + a thin authed-REST helper.
- `config.js` — env loader (`SHEETS_CLIENT_ID` / `SHEETS_CLIENT_SECRET` /
  `SHEETS_REFRESH_TOKEN`, plus `SHEETS_DRY_RUN`).
- `run-with-op.sh` — pulls OAuth creds from 1Password and execs the inner command.
- `bootstrap-oauth.js` — one-time, **operator-run**, mints the refresh token.
- `__tests__/` — offline `node:test` unit tests (no network, no browser, no OAuth).

## Credentials
1Password item **`mythos-google-oauth-client`** in the **`Automation`** vault, with
three OAuth fields:
- `client id`     — OAuth client id (`*.apps.googleusercontent.com`)
- `client secret` — OAuth client secret
- `refresh token` — refresh token (from the bootstrap below)

Claude must not type the account password or grant OAuth consent — the refresh
token is minted once by the operator.

### Runtime resolution order
`run-with-op.sh` resolves **each** field independently, first-non-empty-wins:
1. **1Password** — `op read op://Automation/mythos-google-oauth-client/<field>`
2. **macOS Keychain** — `security find-generic-password -a mythos -s <service> -w`,
   where `<service>` is `mythos-google-oauth-client-client-id`,
   `…-client-secret`, or `…-refresh-token`.
3. **Env** — an already-exported `SHEETS_CLIENT_ID` / `SHEETS_CLIENT_SECRET` /
   `SHEETS_REFRESH_TOKEN`.

So creds may live entirely in 1Password, entirely in the Keychain, or be split
across the two. Resolved values are exported only into the child process env —
never into argv or any file.

## One-time setup (operator)
1. In Google Cloud, enable **Google Sheets API** (and **Google Drive API** for
   sheet creation) and create an **OAuth client → Desktop app** (reuse an
   existing GCP project if you have one).
2. Mint the refresh token, signed in **as the account that owns/edits the sheets**:
   ```bash
   export SHEETS_CLIENT_ID=...  SHEETS_CLIENT_SECRET=...
   node tools/mcp/sheets/bootstrap-oauth.js
   ```
   Scopes requested: `spreadsheets` (read/write existing) + `drive.file`
   (create new sheets / manage only files this app created).
3. The script **prints the bare refresh token once** (and copies it to the
   clipboard via `pbcopy`), then prints store instructions. The operator owns the
   credential write — the script does NOT auto-write. Store it with **one** method.
   **Never put the token on a command line** (argv lands in shell history and
   process listings):
   ```bash
   # A) macOS Keychain — interactive; the token is typed at the prompt, not in argv:
   security add-generic-password -U -a mythos -s mythos-google-oauth-client-refresh-token -w
   #    …then paste the token at the "password:" prompt.
   ```
   ```text
   # B) 1Password — paste into the GUI field:
   #    Open item "mythos-google-oauth-client" → field "refresh token" → paste → save.
   ```
   For the Keychain path, also store the client id/secret so `run-with-op.sh` can
   resolve all three from the Keychain:
   ```bash
   security add-generic-password -U -a mythos -s mythos-google-oauth-client-client-id -w
   security add-generic-password -U -a mythos -s mythos-google-oauth-client-client-secret -w
   ```
   For the 1Password path, paste `client id` / `client secret` into the same item's
   fields via the GUI.

## Usage
**Safe-by-default:** every invocation is a **dry run** unless you pass `--apply`.
Without `--apply` the tool renders the exact request body + URL and exits without
minting creds or touching the network. `--dry-run` is still accepted and always
forces a dry run (it overrides `--apply`). Always review a dry run before the
first live mutation of any sheet — confirm the spreadsheet id, range, and mode.

```bash
# Offline preview (DEFAULT) — no --apply, so no creds and no network:
node tools/mcp/sheets/write-sheet.js \
  --mode update --id <spreadsheetId> --range 'Sheet1!A1' --input rows.json

# Live mutation — requires --apply; creds injected from 1Password/Keychain:
tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js \
  --mode update --id <spreadsheetId> --range 'Sheet1!A1' --input rows.json --value-input USER_ENTERED --apply

tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js \
  --mode append --id <spreadsheetId> --range 'Sheet1!A1' --input rows.json --apply

tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js \
  --mode clear --id <spreadsheetId> --range 'Sheet1!A1:Z' --apply

tools/mcp/sheets/run-with-op.sh node tools/mcp/sheets/write-sheet.js \
  --mode create --title "Mythos Report" --parent <driveFolderId> --apply
```

`run-with-op.sh` defaults (env-overridable, like the youtube tool's
`YTOP_ITEM` / `YTOP_VAULT`):
- `SHEETSOP_VAULT` (default `Automation`)
- `SHEETSOP_ITEM`  (default `mythos-google-oauth-client`)

### `rows.json` accepted shapes
1. Bare 2D array: `[["name","score"],["Ada",9]]`
2. `{ "values": [["name","score"],["Ada",9]] }`
3. `{ "columns": ["name","score"], "rows": [ {"name":"Ada","score":9} ] }`
   (compat with the old clipboard tool — emits a header row + ordered body rows)

`null`/`undefined` cells become `""`; objects are JSON-stringified. Values go to
the API as a JSON 2D array, never as clipboard TSV.

`--value-input` is `RAW` (default) or `USER_ENTERED` (lets Sheets parse numbers,
dates, and formulas).

## Tests
```bash
node --test tools/mcp/sheets/__tests__/*.test.js
```
Offline only — covers value-shaping, A1 validation, arg parsing, mode dispatch,
URL/body builders, and dry-run rendering. (Use the file/glob form, not a bare
directory path — Node v24 treats a bare directory arg as a module to load.)
