# datalayer-probe

Playwright-based probe that observes `window.dataLayer.push()` calls and tracks form field state across a multi-step web form. Designed for diagnosing tracking issues where conversion events fire but report unexpected values.

## Why

Manual GTM Preview / DevTools sessions are ephemeral. This tool produces a reproducible artifact: every `dataLayer.push` payload, all script-detector counts, field values at each step, and any walk-step errors.

## Usage

```bash
# Run a named config (configs/<name>.json)
node tools/diagnostics/datalayer-probe/cli.js -c {CLIENT_CODE}-apply-form61

# Or pass an explicit config path
node tools/diagnostics/datalayer-probe/cli.js --config path/to/config.json

# Watch it run
node tools/diagnostics/datalayer-probe/cli.js -c {CLIENT_CODE}-apply-form61 --headed
```

Artifacts are written to `_dev/reports/datalayer-probes/<iso-stamp>__<id>.json`.

## Config shape

```json
{
  "id": "unique-slug",
  "url": "https://example.com/form-page",
  "wpformsId": "61",
  "submit": false,
  "captureProbeSelector": "#wpforms-form-61 .wpforms-submit",
  "scriptDetectors": { "name": "regex-source" },
  "fieldProbes": [
    { "selector": "#input-id", "label": "human-name" }
  ],
  "walk": [
    { "action": "click",    "selector": "#wpforms-61-field_25_1" },
    { "action": "wait",     "ms": 500 },
    { "action": "fill",     "selector": "#wpforms-61-field_6", "value": "Test" },
    { "action": "check",    "selector": "#consent" },
    { "action": "select",   "selector": "#dropdown", "value": "option" },
    { "action": "eval",     "script": "window.foo = 1" },
    { "action": "snapshot", "label": "after-step-1", "probes": [ ... ] }
  ]
}
```

### `submit: false`

By default the probe **does not** submit the form. With `captureProbeSelector` set, it simulates a button click so any `captureFormData()` handler runs against current field state — without producing a real lead in the downstream CRM. Flip `submit: true` only when an end-to-end test is intentional.

### Output

```json
{
  "config": "...",
  "url": "...",
  "title": "...",
  "gtmIds": ["GTM-XXX", "AW-123", "G-YYY"],
  "scriptDetectors": { "name": <count of matching inline scripts> },
  "fieldProbes": [ { "label": "after-load", "fields": [...] } ],
  "dataLayerSnapshots": [ { "label": "after-load", "events": [...] } ],
  "pushLog": [ { "ts": 169..., "args": [...] } ],
  "walkLog": [...],
  "errors": [...]
}
```

`pushLog` redacts long-string or `key=value`-shaped values to keep cookie/PII payloads out of the artifact.

## Adding a new client config

Drop a JSON file in `configs/`. Slug = filename without `.json`. Then run `-c <slug>`.
