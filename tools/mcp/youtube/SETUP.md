# Setting up credentials for `mcp/youtube`

This tool resolves its own credentials at runtime through
`tools/lib/resolve-credential.cjs` — a 4-source chain, first hit wins:

1. **Environment variable** — set it in your shell or CI config.
2. **macOS Keychain** — seed it once, headless-friendly forever after:
   ```
   tools/boot/keychain-store.sh mythos-youtube-oauth-client-id mythos
   tools/boot/keychain-store.sh mythos-youtube-oauth-client-secret mythos
   tools/boot/keychain-store.sh mythos-youtube-oauth-refresh-token mythos
   ```
3. **1Password** — `op read op://Automation/YouTube Channel/<field>`,
   resolved via a service-account token (`OP_SERVICE_ACCOUNT_TOKEN` env var,
   or a Keychain item named `mythos-1p-automation-token`/`mythos`).
4. **Env file fallback** — `.env.local` or `.env` at the repo root, or
   `~/.mythos/.env`. See `env.example` in this directory for the exact keys.

## This tool's fields

See `creds.config.json` in this directory for the authoritative field list.
Run:

```
node tools/lib/generate-env-example.cjs tools/mcp/youtube/creds.config.json
```

to regenerate `env.example` if the config changes. The refresh token is
minted once via `node tools/mcp/youtube/bootstrap-oauth.js`, signed in as
your target channel account (see that file's header for the full flow).

## Verify

```
node tools/mcp/youtube/upload.js --dry-run --file path/to/your-video.mp4 --title "Test"
```

A successful dry-run validates args and metadata without uploading.
