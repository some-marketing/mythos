# tools/stock-image-scout

Stock-photo tooling split into two clearly separated commands:

- **`scout.cjs`** — credit-conserving **scouting only**. Search providers,
  score/shortlist candidates, save results to JSON. **No download or
  licensing code paths.** Do not add download logic here.
- **`download.cjs`** — credit-**consuming** **licensed download**. Downloads
  a fixed, pre-approved set of images by id under the operator's Depositphotos
  subscription. Separate file, separate invariant, on purpose.

Credential setup: see `SETUP.md` in this directory. `creds.config.json`
declares the exact fields; `env.example` is generated from it.

## `download.cjs` — licensed download CLI

Downloads only images listed in an **approved-image manifest** (JSON file
with `approved: true` per item) — there is no code path to download an
arbitrary id passed on the command line. Safe-by-default: without live
credentials, or with `--dry-run`, it only prints the plan.

### Primary path: Depositphotos Partner API
Confirmed via [api.depositphotos.com/doc](https://api.depositphotos.com/doc/)
→ [`API.Purchase`](https://api.depositphotos.com/doc/classes/API.Purchase.html):
`getMedia` supports `dp_purchase_currency=subscription` — downloading a file
by id under an active subscription (e.g. All-In-One) is a documented API
capability, not just search/browse. This tool calls that API directly
(`lib/depositphotos-api-client.cjs`) rather than driving a browser.

Depositphotos' API predates modern OAuth2 bearer tokens: auth is
`dp_apikey` + account `login`/`password` → `login` call → `dp_session_id`
(session, ~3h TTL per docs), which is then sent on every subsequent call
including `getMedia`. This tool resolves those three values through the
shared `tools/lib/resolve-credential.cjs` chain (env → Keychain →
1Password → env-file) via `run-with-op.sh`, so credential bytes never land
in argv, stdout, or a committed file.

**LIVE-VALIDATION-REQUIRED**: the exact JSON response envelope for `login`
and `getMedia` wasn't directly inspectable from the docs. The response
*parsers* (`parseLoginResponse` / `parseGetMediaResponse` in
`lib/depositphotos-api-client.cjs`) are written defensively against several
common envelope shapes and throw a descriptive error naming the actual
top-level keys if none match — validate/adjust those two functions against a
real account before relying on this in production. Everything else (request
URL builders, manifest loading, plan/idempotency, receipt, arg parsing, CLI
gating) is fully unit-tested offline and does not need live validation.

### Fallback path (documented, opt-in): saved Playwright session
`--use-session-fallback` drives the same saved-session (`lib/auth/session.cjs`
+ `lib/adapters/depositphotos.cjs`) that `scout.cjs --login` populates,
launching a headless browser against the photo page and clicking through the
download flow. Kept as a documented fallback only, not the primary path — its
selectors are also **LIVE-VALIDATION-REQUIRED**.

### Chrome-profile path (documented, opt-in): OAuth "Sign in with Google"
`--use-chrome-profile` is the route for accounts whose only login is OAuth
(no API key / password). It drives the browser download flow inside a
persistent Chrome profile via `chromium.launchPersistentContext`. The
profile (default: `~/Library/Application Support/Chrome-Automation-StockScout`,
`Default`, signed into the operator's Google account) supplies an
already-authenticated Google session, so Depositphotos' "Continue with
Google" completes without a fresh login. Config is env-overridable:
`STOCK_SCOUT_CHROME_USER_DATA_DIR` / `STOCK_SCOUT_CHROME_PROFILE` (or
`--chrome-user-data-dir` / `--chrome-profile`).

**FedCM gotcha (load-bearing):** the "Continue with Google" button is a Google
Identity Services iframe with FedCM enabled, whose account picker is a *native
Chrome dialog* Playwright cannot click — the login stalls silently. The tool
launches with `--disable-features=FedCm`, forcing the classic in-page flow that
completes against the existing Google session. Do not remove that flag. This
path performs subscription downloads only (the "Download Image" button under
"DOWNLOAD USING: All-In-One") and never clicks a purchase control.

```bash
# Log in once in the profile (via Continue with Google), then:
node tools/stock-image-scout/download.cjs \
  --manifest projects/example-campaign/assets/base-images/approved-images-manifest.json \
  --dest projects/example-campaign/assets/base-images \
  --use-chrome-profile --limit 1
```

### Credentials setup (operator, one-time)
See `SETUP.md` for the full walkthrough. Short version:
1. Obtain a Depositphotos API key: <https://depositphotos.com/api-program.html>.
2. Store `DP_API_KEY` / `DP_LOGIN_USER` / `DP_LOGIN_PASSWORD` via any of the
   four sources `tools/lib/resolve-credential.cjs` supports (env var,
   macOS Keychain, 1Password, or an env file) — see `creds.config.json` for
   the exact field names, and `env.example` for the env-var form.
3. `run-with-op.sh` resolves each field independently (first non-empty wins)
   and execs the inner command with the three `DP_*` vars in env only.

For the session fallback, establish a session once via:
```bash
node tools/stock-image-scout/scout.cjs --login --provider depositphotos
```

### Usage
```bash
# Safe dry run — no network, no credentials touched, always run this first:
node tools/stock-image-scout/download.cjs \
  --manifest projects/example-campaign/assets/base-images/approved-images-manifest.json \
  --dest projects/example-campaign/assets/base-images \
  --dry-run

# Live — validate against ONE image first (--limit 1):
tools/stock-image-scout/run-with-op.sh node tools/stock-image-scout/download.cjs \
  --manifest projects/example-campaign/assets/base-images/approved-images-manifest.json \
  --dest projects/example-campaign/assets/base-images \
  --limit 1

# Then the rest:
tools/stock-image-scout/run-with-op.sh node tools/stock-image-scout/download.cjs \
  --manifest projects/example-campaign/assets/base-images/approved-images-manifest.json \
  --dest projects/example-campaign/assets/base-images
```

### Guardrails
- Only ids present in `--manifest` with `approved: true` may be downloaded.
- Idempotent by filename: images already present in `--dest` are skipped and
  reported, not re-downloaded.
- Rate-limited: sequential downloads with a short delay between requests.
- Every completed download is recorded in `<dest>/download-receipt.json`
  (id, filename, size, timestamp, `license: "All-In-One subscription
  download (credit-consuming)"`) — this is the audit trail for credit spend.
  Re-runs merge into the existing receipt rather than overwriting it.
- No credentials, cookies, or session tokens are ever written to a committed
  file or printed. The Playwright session file lives under
  `tools/stock-image-scout/sessions/` (gitignored via a `.gitignore` written
  at first use) — never move or commit it.

### Manifest schema
```json
{
  "client": "example-client",
  "project": "example-campaign",
  "captured_from": "client-approved review sheet",
  "source_sheet": "<sheet id>",
  "provider": "depositphotos",
  "images": [
    {
      "id": "723408108",
      "title": "...",
      "page_url": "https://depositphotos.com/photo/....html",
      "filename_slug": "example-senior-couple-beach-sunset",
      "approved": true
    }
  ]
}
```
Target filename is `<filename_slug>-<id>.<ext>` (extension from the
downloaded content-type when determinable, else `.jpg`).

## Tests
```bash
node --test tools/stock-image-scout/__tests__/*.test.cjs
```
Offline only — covers manifest loading/validation, download-plan/idempotency,
receipt building, API request-URL builders + response parsing, and CLI arg
parsing. No network, no browser, no credentials.
