# Review-media staging

`stage-review-media.js` stages the per-ad creative media for an
ads-approval-portal's review cards:

1. Copies every delivered format/size variant (1:1, 4:5, 9:16, ...) for each
   ad from a design-vendor deliverables tree into your portal's
   same-origin `review-images/<code>/formats/` directory.
2. Emits a per-dealer media manifest (`app/data/<CODE>-review-media.json`)
   keyed by `ad_id`, listing each ad's format tiles (type/ratio/dims/label/
   file) and an optional grabbed vehicle image (from
   `tools/inventory/dealer-vehicle-image.js`).

Local-only and cached — files already staged are skipped. Nothing here
touches a live host, review-data JSON, or a capture log. Mechanical and
re-runnable.

Config-driven and cwd-independent (paths resolve from the config, which may
use absolute paths or paths relative to the config file's own directory).
Ratio is derived from the WIDTHxHEIGHT token in the delivered filename
(e.g. `1080X1080` → `1x1`, `1080X1350` → `4x5`, `1080X1920` → `9x16`), so
multiple vendor naming conventions resolve uniformly without a hardcoded
ratio label.

```bash
node tools/review-media/stage-review-media.js --config <path/to/media-config.json>
node tools/review-media/stage-review-media.js --config <cfg> --vehicle-map <map.json>
node tools/review-media/stage-review-media.js --config <cfg> --dry
```

Copy `config/example-review-media.config.example.json` and fill in your
own `deliverables_dir`, `review_images_dir`, `manifest_out`, and
`ad_id`/slot mapping.

## What's excluded

The two real media configs this tool shipped with (real dealership codes,
real absolute paths into one operator's own repo checkout) were excluded
and replaced with the example config above.
