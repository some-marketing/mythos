# Setting up credentials for `mcp/sheets`

This tool resolves its own credentials at runtime through
`tools/lib/resolve-credential.cjs` — a 4-source chain, first hit wins:

1. **Environment variable** — set it in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh mythos-google-oauth-client-client-id mythos
   tools/boot/keychain-store.sh mythos-google-oauth-client-client-secret mythos
   tools/boot/keychain-store.sh mythos-google-oauth-client-refresh-token mythos
   ```
3. **1Password** — `op read op://Automation/mythos-google-oauth-client/<field>`,
   resolved via a service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var,
   or a Keychain item named `mythos-1p-automation-token`/`mythos`).
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

## This tool's fields

See `creds.config.json` in this directory for the authoritative field list.
Run:

```
node tools/lib/generate-env-example.cjs tools/mcp/sheets/creds.config.json
```

to regenerate `env.example` if the config changes. The refresh token is
minted once via `node tools/mcp/sheets/bootstrap-oauth.js` (see that file's
header for the one-time OAuth consent flow).

## Verify

```
node tools/mcp/sheets/read-sheet.js --sheet-id <id> --range 'A1:A1'
```

A successful verify reads one cell without error. `write-sheet.js` supports
`--dry-run` to preview a write without touching the sheet.
