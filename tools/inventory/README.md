# tools/inventory

Read-only helpers for reconciling a monthly ad plan against **live dealer
inventory**. Neither tool here touches ad builds, Meta, or credentials.

## dealer-inventory-priority.js

Pulls live NEW-vehicle inventory counts per model from a dealer website and
emits a stock-depth-ranked run-list for a monthly Meta offer set: which
vehicle ad slots to run at full depth, which to trim to a single design
(thin stock), and which to HOLD (don't advertise a model you're out of).
JSON + human-readable Markdown.

```bash
# default config
node tools/inventory/dealer-inventory-priority.js

# your own dealer/cycle
node tools/inventory/dealer-inventory-priority.js --config tools/inventory/config/<name>.json

# capture artifacts, no stdout report
node tools/inventory/dealer-inventory-priority.js \
  --json-out _dev/reports/analysis/<proj>/inventory-priority.json \
  --md-out   _dev/reports/analysis/<proj>/inventory-priority.md --quiet
```

Config-driven and cwd-independent (paths resolve from `__dirname`). All
dealer / model / slot facts live in `config/*.json` — copy
`config/example-dealer-offers.config.example.json` for a new dealer or a
new build and edit:

- `dealer` — base URL, inventory-search path, model query param.
- `models` — per model: the `query` value for the search filter and a
  `match` regex against the site's `data-model` attribute. **The match is
  required** — on a zero-stock model some inventory platforms fall back to
  a set of generically-recommended cards, so an unscoped count would wildly
  over-count. Anchor the regex so it doesn't over-match related trims.
- `slots` — each ad slot: `model` (or `models` array + `roundup:true`, or
  `null` for a non-inventory-gated offer/brand slot) and `creative_units`.
- `thresholds` — `hold_at_or_below` (default 0 → HOLD) and
  `thin_at_or_below` (default 2 → run 1 design).
- `ad_model.ad_sets` — creative units are multiplied by this if your build
  duplicates creative across multiple ad sets/audiences.

**Method:** Playwright renders each model's filtered search page and counts
the hidden `input[name=vehicledata]` cards, deduped by `data-stock-number`,
matched to the target `data-model`, `NEW` only. The example config assumes
a d2cmedia-style SRP — adapt the scraping selectors in this file if your
dealer platform's markup differs. Requires `playwright`.

## dealer-vehicle-image.js

Grabs one representative NEW-vehicle photo per model from the same dealer
site (reusing the same config shape) and caches it locally, so a
review/approval card can show a recognizable picture of the vehicle a
promo is about.

## What's excluded

The source repo's `audit-canvas-vs-site.js` (a one-off scraper hardcoded to
one specific dealer's real production domain, comparing it against a local
CSV export) was excluded — it's a one-time diagnostic script bound to one
site, not a reusable pattern. The real dealer config this tool shipped with (a real dealership name,
real site URL, real monthly offer slots) was also excluded and replaced
with `config/example-dealer-offers.config.example.json`.
