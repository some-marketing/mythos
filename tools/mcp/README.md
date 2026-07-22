# MCP Tooling

Local MCP-style stdio scaffolds for external service integrations. Every
credential is bring-your-own — see `CREDENTIAL_ACQUISITION.md` and each
lane's own `SETUP.md` / `env.example`.

Current lanes:

- `tools/mcp/shared/` — shared stdio transport, env loading, and HTTP helpers
- `tools/mcp/sheets/` — Google Sheets API writer (complete, OAuth-based)
- `tools/mcp/youtube/` — YouTube upload (complete, OAuth-based)
- `tools/mcp/google-ads/` — Google Ads API scaffold (server + generic read/preflight/budget tools; client-specific mutation scripts excluded)
- `tools/mcp/meta-ads/` — Meta Marketing API scaffold (server + generic ad-lifecycle/compliance tools; client-specific mutation scripts excluded)
- `tools/mcp/crm/` — provider-pluggable agency-CRM lane (Moxie provider working; read lane + billing export)
- `tools/mcp/delesign/` — Delesign design-platform integration (scaffold: server shell + a genericized outbound-leak linter; the client-specific order-lifecycle pipeline is not ported — see its README)

## Design Rules

- Local-only auth: secrets come from environment variables or local env files
- Dry-run first: writes are simulated unless explicitly enabled
- Before/after visibility: every write tool returns the intended target and payload
- No secret logging: helpers redact authorization material by default

## Local Env Files

The shared env loader checks, in order:

1. process environment
2. repo `.env.local`
3. repo `.env`
4. `~/.mythos/.env`

Repo env files should stay gitignored.

## Credential resolution (S1)

Each lane needing credentials ships a `creds.config.json` documenting its
fields in the shared shape (`{envVar, keychainService, keychainAccount,
opVault, opItem, opField}`) that a shared `tools/lib/resolve-credential.cjs`
resolver is designed to consume. Until that resolver exists in your repo,
each lane's `run-with-op.sh` / `config.js` resolves credentials directly
(env var, then 1Password via `run-with-op.sh`, then macOS Keychain for any
automation service-account token) — the `creds.config.json` file documents
the same fields so the lane is ready to wire to the shared resolver later.
