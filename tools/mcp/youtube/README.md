# tools/mcp/youtube — YouTube upload tool

Headless YouTube uploader for review/ad creative. Uploads a local video file
(default **unlisted**) and returns the `video_id` + URL as JSON, so callers like
the SDAG ads-approval-portal can wire `video_id` into a review bundle.

Built on `google-auth-library` (already a dependency) + the resumable upload
REST endpoint — no `googleapis` package needed.

## Files
- `upload.js` — CLI. `--file --title [--description|--description-file] [--privacy] [--dry-run]`.
- `client.js` — access-token mint + resumable upload.
- `config.js` — env loader.
- `run-with-op.sh` — pulls OAuth creds from 1Password and execs the inner command.
- `bootstrap-oauth.js` — one-time, **operator-run**, mints the channel refresh token.

## Credentials
1Password item **`YouTube Channel`** in the **`Automation`** vault. The item ships
with `username`/`password` (the Google login). API upload additionally needs
three OAuth fields **added to the same item**:
- `client id`     — OAuth client id (`*.apps.googleusercontent.com`)
- `client secret` — OAuth client secret
- `refresh token` — channel refresh token (from the bootstrap)

The login alone cannot drive the API — Claude must not type the account password
or grant OAuth consent, so the refresh token is minted once by the operator.

## One-time setup (operator)
1. In Google Cloud, enable **YouTube Data API v3** and create an **OAuth client →
   Desktop app** (reuse an existing GCP project if you have one).
2. Mint the refresh token, signed in **as the your channel account**:
   ```bash
   export YT_CLIENT_ID=...  YT_CLIENT_SECRET=...
   node tools/mcp/youtube/bootstrap-oauth.js
   ```
3. The script **auto-stores** all three fields (`client id`, `client secret`,
   `refresh token`) on the vault item via `op` — the refresh token is **never
   printed**. (It is handed to `op item edit` as a child-process argument only:
   local, transient, single-machine; it never transits the LLM or the network.)

## Usage
```bash
# Validate without creds or upload:
node tools/mcp/youtube/upload.js --file clip.mp4 --title "Test" --dry-run

# Live (unlisted), creds injected from 1Password:
tools/mcp/youtube/run-with-op.sh node tools/mcp/youtube/upload.js \
  --file "path/to/your-video.mp4" \
  --title "Example Promo Video (9:16)" \
  --description-file desc.txt
```
Default `categoryId` is `2` (Autos & Vehicles). Output JSON is the canonical
result shape: `{ provider, id, url, privacyStatus, portal: { video_id } }` — the
`portal.video_id` is what the ads-approval portal review bundle consumes.
