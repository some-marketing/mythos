# Prompt 03 — Validate SEO Checks

> **Framework:** wordpress/seo-validation
> **Execution mode:** RUN_ONLY
> **Reporting stance:** Observational — report facts and evidence, not diagnoses.

---

## Purpose

Validate extracted SEO signals against configurable rules. Each check produces a structured result entry with pass/fail/warn status and supporting evidence.

---

## Steps

### Step 1 [AUTO] — Load extracted page data

Read all extracted page data from:

- `crawl/extracted/*.json` (per-page extraction output)
- `crawl/crawl-summary.json` (aggregate crawl metadata)

Parse every file and build an in-memory page inventory keyed by URL.

---

### Step 2 [AUTO] — Load check configuration

Read `check-config.json` if present in the project root. If the file does not exist, use the default thresholds and settings defined below.

**Default `check-config.json`:**

```json
{
  "thresholds": {
    "alt-text-warn": 0.80,
    "alt-text-fail": 0.50,
    "title-min-length": 30,
    "title-max-length": 60,
    "meta-description-min-length": 120,
    "meta-description-max-length": 160
  },
  "skip_checks": [],
  "structured_data_expected_types": {
    "homepage": ["AutoDealer", "LocalBusiness"],
    "vdp": ["Vehicle", "Product", "Car"],
    "inventory": ["ItemList"]
  }
}
```

If `skip_checks` contains a check_id, skip that check entirely and omit it from results.

---

### Step 3 [AUTO] — Run checks

For each check, produce a result entry with the following fields:

| Field | Type | Description |
|---|---|---|
| `check_id` | string | Machine identifier (e.g., `h1-presence`) |
| `check_name` | string | Human-readable name |
| `scope` | `"page"` or `"site"` | Whether the check runs per-page or once across all pages |
| `status` | `"pass"`, `"fail"`, or `"warn"` | Overall check outcome |
| `summary` | string | One-line summary of findings |
| `affected_urls` | array of strings | URLs that triggered a non-pass result |
| `evidence` | array of objects | `{ "url": "...", "detail": "..." }` per affected item |

---

#### Page-Level Checks (run per page)

**`h1-presence`** — H1 tag presence
Every page must have exactly 1 H1 tag. Fail if a page has 0 or more than 1 H1.

**`h1-uniqueness`** — H1 text uniqueness
No two pages may share the same H1 text. Fail on any duplicates.

**`title-presence`** — Title tag presence
Every page must have a non-empty `<title>` tag. Fail if the title is missing or empty.

**`title-length`** — Title tag length
Title must be between `title-min-length` and `title-max-length` characters (default 30-60). Warn if outside range.

**`meta-description-presence`** — Meta description presence
Every page must have a meta description. Warn if missing.

**`meta-description-length`** — Meta description length
Meta description must be between `meta-description-min-length` and `meta-description-max-length` characters (default 120-160). Warn if outside range.

**`canonical-presence`** — Canonical tag presence
Every page must have a canonical tag. Fail if missing.

**`canonical-self-referencing`** — Canonical self-reference
The canonical URL must match the page URL, accounting for trailing slash normalization. Warn if mismatch.

**`og-required-tags`** — Open Graph required tags
Each page must have `og:title`, `og:description`, `og:image`, and `og:url`. Fail per missing tag.

**`alt-text-presence`** — Image alt text coverage
Images must have non-empty `alt` attributes. Report the coverage ratio.
- Warn if coverage is below `alt-text-warn` threshold (default 80%).
- Fail if coverage is below `alt-text-fail` threshold (default 50%).

**`meta-robots-noindex`** — Noindex flag on indexable pages
Flag pages with `noindex` that should be indexed (non-utility pages). Warn.

**`status-code`** — HTTP status code
Every page must return HTTP 200. Fail on 4xx or 5xx status codes.

---

#### Site-Level Checks (run once across all pages)

**`h1-uniqueness-site`** — Aggregate H1 uniqueness
Aggregate duplicate-H1 check across all pages. Report all groups of pages sharing the same H1 text.

**`canonical-uniqueness`** — Canonical URL uniqueness
No two pages may claim the same canonical URL. Fail on conflicts.

**`broken-internal-links`** — Broken internal links
For each internal link found during crawl:
- **Static URLs** (no query string): verify the target URL exists in the page inventory. If not found, report as broken.
- **Dynamic URLs** (contains `?` query string, or matches patterns declared in `site-config.json` `dynamic_url_patterns`): do NOT compare against inventory. Instead, send a HEAD request to verify the URL returns HTTP 200. Only report as broken if the HEAD request returns 4xx/5xx or times out after 3 seconds.
- `site-config.json` may declare a `dynamic_url_patterns` array (e.g., `["?clienta_filter_*", "/vehicle/*"]`) for site-specific dynamic URL patterns that lack query strings.

**`broken-external-links`** — Broken external links
HEAD-request each unique external link. Fail on 4xx/5xx responses. Use a 3-second timeout and a maximum of 50 concurrent requests. Record the status code for each checked URL.

**`structured-data-presence`** — JSON-LD presence by page type
Pages that should have JSON-LD structured data (homepage, VDP, inventory) must contain it. Report presence/absence by page type.
When extracting `@type` values, flatten `@graph` arrays — a JSON-LD block containing `"@graph": [{"@type": "AutoDealer"}, {"@type": "WebSite"}]` should be treated as if both types are present on the page. Process all nodes in `@graph` arrays, including nested ones.

**`structured-data-types`** — JSON-LD @type validation
Validate that `@type` values in JSON-LD match expected types from configuration (e.g., `AutoDealer` for homepage, `Vehicle`/`Product` for VDP). Warn on unexpected types.
Apply a **type hierarchy map** when comparing: a page with `AutoDealer` satisfies a requirement for `LocalBusiness` or `Organization` (since `AutoDealer` extends `LocalBusiness` extends `Organization` in schema.org). Similarly, `Vehicle` satisfies `Product`, and `CollectionPage` satisfies `ItemList` context. This prevents false positives from standard schema.org inheritance patterns.

**`sitemap-coverage`** — Sitemap vs. linked page coverage
Compare the page inventory (from sitemap) against pages actually linked from the site. Report:
- Pages present in sitemap but not linked from any page.
- Pages linked from the site but missing from sitemap.

---

### Step 4 [AUTO] — Write results

Write `checks/results.json` with the following structure:

```json
{
  "checked_at": "ISO-8601",
  "total_checks": N,
  "passed": N,
  "failed": N,
  "warned": N,
  "results": [
    {
      "check_id": "h1-presence",
      "check_name": "H1 tag presence",
      "scope": "page",
      "status": "pass|fail|warn",
      "summary": "95/100 pages have exactly 1 H1",
      "affected_urls": ["..."],
      "evidence": [{ "url": "...", "detail": "..." }]
    }
  ]
}
```

- `checked_at`: ISO-8601 timestamp of when checks completed.
- `total_checks`: Total number of checks executed (excluding skipped).
- `passed`, `failed`, `warned`: Counts by status.
- `results`: Array of result entries, one per check.

---

### Step 5 [AUTO] — Write per-check detail files

For any check with more than 10 affected URLs, write a separate detail file to `checks/{check_id}.json`. This keeps `results.json` manageable.

The detail file contains the full `evidence` array for that check. In `results.json`, truncate that check's `evidence` to the first 10 entries and add a field `"detail_file": "checks/{check_id}.json"` pointing to the full data.
