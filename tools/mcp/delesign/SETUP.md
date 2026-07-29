# Setting up credentials for `mcp/delesign`

This tool resolves its own credentials at runtime through
`tools/lib/resolve-credential.cjs` — a 4-source chain, first hit wins:

1. **Environment variable** — set it in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh mythos-delesign-api-token mythos
   ```
3. **1Password** — `op read op://Employee/Delesign/credential`, resolved via
   a service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var, or a
   Keychain item named `mythos-1p-automation-token`/`mythos`).
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

## This tool's fields

See `creds.config.json` in this directory for the authoritative field list.
Run:

```
node tools/lib/generate-env-example.cjs tools/mcp/delesign/creds.config.json
```

to regenerate `env.example` if the config changes.

## Verify

```
DELESIGN_DRY_RUN=true node tools/mcp/delesign/server.js
```

A successful start with `DELESIGN_DRY_RUN=true` confirms the config loads
and the token resolves, without making a live API call.
