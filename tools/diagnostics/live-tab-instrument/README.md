# live-tab-instrument

Self-contained JavaScript payload that instruments **an already-loaded browser tab** to capture:

- every `window.dataLayer.push(...)` call (after install)
- every outbound network beacon to Google Ads / GA4 / GTM hosts (via `fetch`, `XHR`, `sendBeacon`)
- every WPForms-shaped admin-ajax submit

Designed for the case where you can't drive the browser from headless Playwright — e.g., the tab is already in your authenticated GTM Preview context, or you're working alongside the operator who's about to perform a real action.

Companion to [`datalayer-probe`](../datalayer-probe/) (headless / Playwright-driven). Same data shape, different execution model.

## Usage

```bash
# Copy injectable JS to clipboard
node tools/diagnostics/live-tab-instrument/index.js --copy

# Or pipe to wherever
node tools/diagnostics/live-tab-instrument/index.js | tee /tmp/inject.js

# Or generate a one-click bookmarklet URL
node tools/diagnostics/live-tab-instrument/index.js --bookmarklet
```

Then in the target tab's DevTools console, paste the payload. After it runs:

```js
window.__livProbe.summary()  // quick counts + event names
window.__livProbe.dump()     // full structured capture
window.__livProbe.reset()    // clear captures, keep hooks installed
```

## What it captures

| Source | Shape |
|---|---|
| `dataLayer.push(...)` | `{ ts, args: [...] }` with long-string and unserializable values redacted |
| Network beacons | `{ ts, kind: 'fetch'\|'xhr'\|'sendBeacon', method, host, classify, url, params, body }` — `classify` ∈ `google-ads-conversion`, `ga4-collect`, `gtm-loader`, etc. |
| WPForms submits | `{ ts, url, formId, bodyLen }` |

URL params and POST bodies are decoded but emails, phones, and long tokens are masked.

## Idempotent

Running the payload twice is safe — it preserves existing state and does not double-hook.

## Limits

- Hooks installed AFTER the page loaded — beacons fired before injection are not captured. Refresh the tab if you need from-load coverage.
- Cross-origin iframes are not instrumented.
