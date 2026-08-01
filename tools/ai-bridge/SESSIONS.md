# Web/Browser Session Reference (Mythos)

> Principle: **log in once, reuse until expiry; never make the end user repeat it.**
> Every mechanism below saves its session to a stable, absolute, per-user path outside
> the repo (so it survives `git clean`, repo moves, and new Claude Code sessions). None
> of these paths are gitignored *inside* the repo tree — they simply never live there.

Always invoke these scripts with an **absolute path** (or from the repo root). Running
`node tools/ai-bridge/<script>.js` from a different cwd (e.g. `~`) fails with
`Cannot find module '${HOME}/tools/...'` — that is Node resolving the *entry
script path* against `process.cwd()`, not a bug in the script's internal requires
(all internal `require()`s already resolve via the file's own directory, and all
storage paths are built from `os.homedir()`, not cwd). All scripts in this directory
are now executable (`chmod +x`), so `~/dev/Mythos-recovered/tools/ai-bridge/<script>.js`
(absolute) always works regardless of cwd.

## Perplexity (browser, Pro Search)

- One-time login: `node tools/ai-bridge/perplexity-auth.js`
- Session file: `~/.Mythos/browser_profiles/perplexity/storage_state.json`
- Use: `node tools/ai-bridge/perplexity-browser.js --prompt <file> --output <file>`
- Refresh when expired: `perplexity-browser.js` detects a redirect to `/login` and tells
  you to re-run `perplexity-auth.js`. No expiry timer is hardcoded — it's whatever
  Perplexity's own cookie lifetime is.
- API-key alternative (no browser, no session): `tools/ai-bridge/perplexity-api/query.js`
  via `tools/ai-bridge/perplexity-api/run-with-op.sh` — pulls the API key from 1Password
  per-call, nothing to log into.

## Gemini (browser)

- One-time login: `node tools/ai-bridge/gemini-auth.js`
- Session file: `~/.Mythos/browser_profiles/gemini/storage_state.json`
- Use: `node tools/ai-bridge/gemini-browser.js --prompt <file> --output <file>`
- Check session health without sending a prompt:
  `node tools/ai-bridge/gemini-session-check.js`
- Refresh when expired: same redirect-to-login detection pattern; re-run `gemini-auth.js`.

## Google Ads / Google account (browser, used by GAds UI-automation scripts)

- One-time (semi-automated) login: `node tools/mcp/google-ads/scripts/automated-login.js`
  — reads username/password from a locally configured 1Password item reference, opens a headed
  Chrome window, and pauses up to 2 minutes for the operator to clear any MFA challenge.
- Session file: `~/.Mythos/browser_profiles/google-ads/storage_state.json`
- Consumers: `tools/mcp/google-ads/scripts/finish-optimization.js`,
  `tools/mcp/google-ads/scripts/record-ui-optimization.js`
- Refresh: re-run `automated-login.js` when the saved session stops working.
- Prefer the API-based `google-ads-mcp` skill / MCP server over this browser path when
  credentials are configured — see the `google-ads-mcp` skill.

## Google Sheets / Excel Online / Delesign web UI (shared persistent Chrome profile)

- This is **not** a Playwright storage-state mechanism — it's a real, persistently
  signed-in Chrome user-data-dir that Playwright attaches to.
- Profile: `Chrome-Automation` user-data-dir, `Profile 13`, signed into
  `get@example-agency.com`. Config: `tools/sheet-writer/config.json`.
  - `chromeUserDataDir`: `~/Library/Application Support/Chrome-Automation`
  - `chromeProfile`: `Profile 13`
  - Overridable via `SHEET_WRITER_CHROME_USER_DATA_DIR` / `SHEET_WRITER_CHROME_PROFILE`.
- One-time setup: sign into `get@example-agency.com` manually inside that profile (see
  `tools/sheet-writer/README.md`). There is no scripted "auth" step — the profile itself
  IS the saved session, the same way a human's normal Chrome profile stays logged in.
- Use (Sheets): `tools/sheet-writer/write-sheet.cjs` (browser/clipboard-paste tool).
  Prefer the OAuth-based API tool instead when just reading/writing cells —
  `tools/mcp/sheets/{read-sheet.js,write-sheet.js}` (see below) — and reserve the
  browser path for clipboard-paste-shaped writes that the API path can't do robustly.
- Use (Excel Online): same `Chrome-Automation`/`Profile 13` profile, navigated manually
  via Playwright + Name Box (grid renders in a canvas iframe, DOM access fails) — see
  `Mythos-memories/memory/reference_excel-online-playwright-navigation.md`.
- Use (Delesign web UI, human-driven only): same profile when the operator needs to look
  at or act on Delesign's website directly. The Delesign **automation** tooling
  (`tools/mcp/delesign/*`) does NOT use a browser session at all — it authenticates via
  an API key resolved per-call from 1Password through `tools/mcp/delesign/run-with-op.sh`,
  so there is nothing to log into for automated Delesign calls.
- Refresh: if Chrome ever signs this profile out, sign back in manually inside
  `Profile 13` (close any other window that already has that profile open first —
  Playwright cannot attach to a profile that's already running, `ProcessSingleton` lock).

## Google Sheets API tool (OAuth, no browser) — distinct from sheet-writer above

- `tools/mcp/sheets/` is a separate, already-hardened mechanism: a Google OAuth refresh
  token, NOT a browser session.
- One-time bootstrap: `node tools/mcp/sheets/bootstrap-oauth.js` — prints a refresh token
  once; the operator stores it themselves (macOS Keychain `security add-generic-password`
  or 1Password item `mythos-google-oauth-client`), per the script's own printed
  instructions. The token never auto-writes and never appears in argv/logs after that.
- Runtime read: `tools/mcp/sheets/run-with-op.sh` resolves client id/secret/refresh token
  at call time — nothing to log into per session, the refresh token doesn't expire under
  normal use.
- Prefer this tool over the browser-based `sheet-writer` whenever a plain read/write of
  cells (not a clipboard-paste-shaped bulk write) will do.

## Google Tag Assistant (browser, diagnostics only)

- Session file: `~/.Mythos/auth/tagassistant.storage.json`
  (`tools/diagnostics/tag-assistant-driver/record-auth.js`)
- Same durable, home-dir-based, cwd-independent pattern as the above.

## ExpressionEngine (EE) admin API — intentionally NOT session-persisted

- `tools/expressionengine/lib/ee-auth.js` authenticates fresh on every call (POST
  credentials → capture the session cookie → use it only for that process's lifetime).
  This is deliberate, not a gap: EE login is fast, credential-only (no MFA/captcha), and
  the cookie is held in process memory only — there is nothing useful to persist across
  runs. No action needed here.

## Verifying a session script loads correctly from any directory

```
cd /tmp && node {MYTHOS_ROOT}/tools/ai-bridge/perplexity-browser.js --help
cd /tmp && node {MYTHOS_ROOT}/tools/ai-bridge/gemini-browser.js --help
```

Both print usage and exit 0 — confirms `require()` resolution and the storage-state
default path build are both cwd-independent (run 2026-06-30; see
`_dev/reports/analysis/web-session-persistence__20260630.md` for the full verification
record).

## Known gap (not yet hardened — see Dart "Decision Needed" tasks)

- None of the saved `storage_state.json` files (Perplexity, Gemini, Google Ads,
  Tag Assistant) or the `Chrome-Automation`/`Profile 13` user-data-dir are backed up
  anywhere. They're durable against `git clean` / repo moves / new sessions, but not
  against disk loss. See the Dart task: *"DECISION: choose backup mechanism for
  browser-session cookie files"* and the report below for options.
