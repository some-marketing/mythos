# Prompt 04 -- Mobile Rendering and Performance

> **Framework:** wordpress/seo-validation
> **Prompt:** 04 of N
> **Execution mode:** RUN_ONLY
> **Depends on:** Prompt 01 outputs (`crawl/page-inventory.json`)

---

## Objective

Check mobile rendering and basic performance for a representative sample of pages. Launch Playwright with mobile device emulation, capture screenshots, detect viewport and tap-target issues, and measure page weight and load times.

---

## Steps

### Step 1 -- Select Representative Pages `[AUTO]`

Read `crawl/page-inventory.json`. Select a representative sample of pages for mobile testing using these quotas:

| Page Type | Max Pages | Required |
|-----------|-----------|----------|
| Homepage | 1 | Always |
| Inventory listing pages | 3 | If present |
| VDP (vehicle detail) pages | 3 | If present |
| Blog pages | 2 | If present |
| Landing pages | 2 | If present |
| Static pages (contact, about, financing) | 2 | If present |

**Maximum 15 pages total for mobile testing.**

If the inventory contains fewer pages than the quotas allow, test all available pages. If a page type is not present in the inventory, skip it.

### Step 2 -- Read Configuration `[AUTO]`

Read `site-config.json` from the project root.

- If `auth.type` is `"basic"`, extract credentials for Playwright's `httpCredentials`.
- If no auth block is present, proceed without authentication.

Read `check-config.json` (if it exists) for device configuration overrides.

- If `mobile.devices` is defined, use those devices instead of the defaults.
- If `check-config.json` is missing or has no mobile section, use the default devices defined in Step 3.

### Step 3 -- Launch Playwright with Mobile Emulation `[AUTO]`

Launch Playwright with mobile device emulation. Default devices (used unless overridden by `check-config.json`):

| Device | Viewport | User Agent |
|--------|----------|------------|
| iPhone 14 | 390 x 844 | Safari UA |
| Pixel 7 | 412 x 915 | Chrome UA |

Create one browser context per device using Playwright's built-in device descriptors. If HTTP Basic auth is configured (Step 2), pass credentials to each context via `httpCredentials`.

### Step 4 -- Test Each Page on Each Device `[AUTO]`

For each selected page from Step 1, on each device from Step 3:

1. **Navigate** to the URL. Wait for `networkidle`.

2. **Take full-page screenshot.** Save to `mobile/screenshots/{device}/{slug}.png`.
   - Derive `{device}` from the device name in lowercase with hyphens (e.g. `iphone-14`, `pixel-7`).
   - Derive `{slug}` from the URL path (strip leading/trailing slashes, replace `/` with `_`; use `index` for the root path).

3. **Check viewport meta tag.** Look for `<meta name="viewport">`.
   - Record whether it is present.
   - Record whether it contains `width=device-width, initial-scale=1`.
   - Record the full `content` attribute value.

4. **Check for horizontal overflow.** Evaluate in-page:
   ```javascript
   document.documentElement.scrollWidth > document.documentElement.clientWidth
   ```
   Record `true` if horizontal overflow is detected, `false` otherwise.

5. **Check tap target sizing.** Find all clickable elements (`a`, `button`, `input`, `select`). For each element, read computed `width` and `height`. Flag any element where computed width < 44px or computed height < 44px.
   - Record total clickable elements count.
   - Record count of undersized elements.
   - For each undersized element, record: CSS selector, computed width, computed height.

6. **Measure page weight.** Capture total bytes transferred from the Performance API or Playwright network events.

7. **Count resources.** From network events, count:
   - Scripts (`.js`)
   - Stylesheets (`.css`)
   - Images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif`)
   - Fonts (`.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`)

8. **Record load timing.** Capture:
   - `domContentLoaded` event time (ms from navigation start)
   - `load` event time (ms from navigation start)

### Step 5 -- Write Results `[AUTO]`

Write `mobile/results.json` with the following structure:

```json
{
  "tested_at": "ISO-8601",
  "devices": ["iPhone 14", "Pixel 7"],
  "pages_tested": "N",
  "results": [
    {
      "url": "string",
      "page_type": "string",
      "device": "string",
      "screenshot": "mobile/screenshots/{device}/{slug}.png",
      "viewport_meta": {
        "present": true,
        "correct": true,
        "content": "width=device-width, initial-scale=1"
      },
      "horizontal_overflow": false,
      "tap_targets": {
        "total": "N",
        "undersized": "N",
        "undersized_elements": [
          {
            "selector": "string",
            "width": "N",
            "height": "N"
          }
        ]
      },
      "performance": {
        "page_weight_bytes": "N",
        "resource_count": {
          "scripts": "N",
          "stylesheets": "N",
          "images": "N",
          "fonts": "N"
        },
        "dom_content_loaded_ms": "N",
        "load_ms": "N"
      }
    }
  ],
  "summary": {
    "pages_with_overflow": "N",
    "pages_with_undersized_targets": "N",
    "avg_page_weight_bytes": "N",
    "viewport_meta_missing": "N"
  }
}
```

- `tested_at`: ISO-8601 timestamp of when mobile testing completed.
- `devices`: array of device names tested.
- `pages_tested`: total number of unique pages tested.
- `results`: one entry per page-device combination.
- `summary`: aggregate counts across all results.

### Step 6 -- Close Browser `[AUTO]`

Close the Playwright browser instance and all device contexts. Release resources.

---

## Guardrails

- **Read-only crawl.** The crawler must not submit forms, click buttons, trigger modals, or interact with any dynamic UI elements. Navigation and DOM reading only.
- **Rate limiting.** Maintain a minimum 500 ms delay between page loads to avoid overwhelming the target server.
- **No data mutation.** Do not POST, PUT, PATCH, or DELETE to any endpoint on the target site.
- **Execution mode: RUN_ONLY.** Execute the steps as written. Do not deviate, add analysis, or produce recommendations -- that is the responsibility of later prompts in the chain.
