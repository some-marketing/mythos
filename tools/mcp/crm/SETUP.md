# Setting up credentials for `mcp/crm`

This tool resolves its own credentials at runtime through
`tools/lib/resolve-credential.cjs` — a 4-source chain, first hit wins:

1. **Environment variable** — set it in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh mythos-moxie-api-key mythos
   tools/boot/keychain-store.sh mythos-moxie-base-url mythos
   ```
3. **1Password** — `op read op://Automation/mythos-moxie-api-credentials/<field>`,
   resolved via a service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var,
   or a Keychain item named `mythos-1p-automation-token`/`mythos`). The exact
   field labels on your own 1Password item may differ from the defaults
   (`MOXIE_API_KEY` / `MOXIE_BASE_URL`) — `creds.config.json` lists
   `credential` / `base url` / `hostname` as fallback labels to try.
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

## This tool's fields

See `creds.config.json` in this directory for the authoritative field list.
Run:

```
node tools/lib/generate-env-example.cjs tools/mcp/crm/creds.config.json
```

to regenerate `env.example` if the config changes.

## Verify

```
CRM_DRY_RUN=true node tools/mcp/crm/pull.js
```

A dry-run prints the planned request URLs without making a network call
(still requires `MOXIE_BASE_URL` to be resolvable, since the client builds
the URL before short-circuiting). For a live one-shot read:

```
tools/mcp/crm/run-with-op.sh node tools/mcp/crm/probe.js clients
```
