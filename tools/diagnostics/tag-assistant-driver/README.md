# tag-assistant-driver

Playwright-driven reader for `tagassistant.google.com`. Captures the events the operator's GTM Preview session has recorded, then for each event reads the Data Layer panel and the list of Tags Fired.

Companion to [`datalayer-probe`](../datalayer-probe/) (headless Playwright) and [`live-tab-instrument`](../live-tab-instrument/) (injectable in-page). Use this driver when the canonical source of truth is the Tag Assistant UI — usually because someone with Google login needs to certify what fired.

## Two attach modes

### 1. CDP (recommended)
Operator launches their normal Chrome with debug port exposed, then pairs Tag Assistant once and authenticates.

```bash
# Launch Chrome with CDP exposed (do this once per session)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# In Chrome: pair Tag Assistant + run GTM Preview against your page.
# Trigger the events you care about (form submit, etc.).

# Read the Tag Assistant tab from the outside:
node tools/diagnostics/tag-assistant-driver/cli.js \
  --cdp http://localhost:9222
```

### 2. storageState (one-time interactive recording)
Record a Playwright storage state containing Google auth cookies once via the bundled helper:

```bash
node tools/diagnostics/tag-assistant-driver/record-auth.js
```

A headed Chrome window opens; sign in with the Google account that has GTM container access; press Enter in the terminal to save. The auth file lands at `~/.Mythos/auth/tagassistant.storage.json` (outside repo, chmod 600). Re-record when Google rotates the session.

```bash
node tools/diagnostics/tag-assistant-driver/cli.js \
  --storage-state path/to/auth.json \
  --url 'https://tagassistant.google.com/#/?source=TAG_MANAGER&id=GTM-XXXX&gtm_auth=...&gtm_preview=env-N'
```

## Output

```json
{
  "capturedAt": "2026-05-27T...",
  "container": { "containerId": "{GTM_CONTAINER_ID}", "url": "...", "title": "..." },
  "events": { "count": N, "events": [{ "idx", "text", "selected" }] },
  "perEvent": [
    { "idx": 0, "dataLayer": [...], "tagsFired": { "firedSectionFound": true, "tags": [...] } }
  ]
}
```

Artifacts land in `_dev/reports/tag-assistant/<stamp>__<mode>.json`.

## Fragility

Tag Assistant's DOM is obfuscated Angular Material and Google reshuffles class names regularly. The readers in `lib/reader.js` use layered fallback selectors — if they all fail, run with `--debug-dom` and the live HTML is dumped next to the JSON for re-fitting the selectors.

## When to use which tool

| Need | Tool |
|---|---|
| Ground truth from the wire — conversion beacon values | `datalayer-probe` or `live-tab-instrument` |
| Reproducible, headless, no Google login | `datalayer-probe` |
| Live tab the operator is already authed in | `live-tab-instrument` |
| Google-certified view of which tags fired | `tag-assistant-driver` |
