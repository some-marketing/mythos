# Setting up credentials for `stock-image-scout`

This tool resolves its own credentials at runtime through
`tools/lib/resolve-credential.cjs` — a 4-source chain, first hit wins:

1. **Environment variable** — set it in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh <KEYCHAIN_SERVICE> <KEYCHAIN_ACCOUNT>
   ```
3. **1Password** — `op read op://<VAULT>/<ITEM>/<FIELD>`, resolved via a
   service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var, or a Keychain
   item named `mythos-1p-automation-token`/`mythos`).
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

## This tool's fields

See `creds.config.json` in this directory for the authoritative field list.
It declares four fields:

- `DP_API_KEY`, `DP_LOGIN_USER`, `DP_LOGIN_PASSWORD` — required for the
  Depositphotos Partner API download path (`download.cjs`'s primary path).
  Depositphotos' API predates OAuth2 bearer tokens: auth is API key +
  account login/password → a short-lived session id. Obtain the API key at
  <https://depositphotos.com/api-program.html>; the login/password are the
  same credentials for the All-In-One (or other) subscription account.
- `UNSPLASH_ACCESS_KEY` — optional. Enables live Unsplash search results in
  `scout.cjs --provider unsplash`; without it, that provider returns mock
  results (useful for offline development, not for production scouting).

Regenerate `env.example` if `creds.config.json` changes:

```
node tools/lib/generate-env-example.cjs tools/stock-image-scout/creds.config.json --out tools/stock-image-scout/env.example
```

## Two credential paths, on purpose

- **`run-with-op.sh`** (this directory) is a thin wrapper that resolves all
  declared fields via the shared resolver and `exec`s the inner command with
  them in env only — this is the primary, recommended path and is what the
  tool's own README examples use.
- **`--use-chrome-profile`** (a `download.cjs` flag, not a separate script)
  is a documented alternative for Depositphotos accounts whose *only* login
  is OAuth ("Continue with Google"), where there is no API key/password to
  resolve at all. It drives a persistent, already-authenticated Chrome
  profile instead of a credential lookup. Use whichever matches how the
  operator's Depositphotos account is actually set up.
- The Playwright saved-session flow (`scout.cjs --login --provider
  depositphotos`, then `download.cjs --use-session-fallback`) is a third,
  opt-in fallback for scouting/downloading without live API credentials at
  all — see `README.md`.

## Verify

```
node tools/stock-image-scout/download.cjs --manifest <manifest.json> --dest <dir> --dry-run
```

`--dry-run` never touches credentials or the network — it only prints the
plan built from the manifest and destination directory, so it is safe to run
with no credentials configured at all.

To verify the credential resolver itself end-to-end (no download performed):

```
tools/stock-image-scout/run-with-op.sh node -e "console.log('DP_API_KEY set:', Boolean(process.env.DP_API_KEY))"
```

A successful resolve prints which source would supply each field via
`tools/lib/resolve-credential.cjs`'s error messages when a field is missing
(never the secret value itself) — if a field is unresolved you'll see the
exact `tools/boot/keychain-store.sh <service> <account>` seed command to run.
