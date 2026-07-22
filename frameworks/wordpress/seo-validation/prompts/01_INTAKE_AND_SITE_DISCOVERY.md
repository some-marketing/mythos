# 01 — Intake and Site Discovery

> **Type**: Atomic
> **Mode**: RUN_ONLY — writes `crawl/page-inventory.json` (crawl artifact, permitted under RUN_ONLY)
> **Purpose**: Read site configuration, discover pages via robots.txt and XML sitemaps, classify page types, and produce a scoped page inventory for downstream crawl prompts.
> **Guardrails**: `frameworks/wordpress/seo-validation/guardrails.md`

---

## Overview

This prompt covers the first phase of an SEO validation run:

1. **Config validation** — Load and validate `site-config.json`
2. **Robots.txt fetch** — Retrieve and parse crawl directives
3. **Sitemap discovery** — Locate, parse, and validate XML sitemaps
4. **Page inventory** — Classify discovered URLs by page type
5. **Scope filtering** — Apply include/exclude patterns and page cap
6. **Artifact write** — Persist `crawl/page-inventory.json`

---

## Step 1 — Read and Validate Site Config [AUTO]

Read `site-config.json` from the project directory.

Validate these fields:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `site_url` | string | **Yes** | — | Full origin with protocol, no trailing slash |
| `auth` | object | No | `null` | If present, must contain `type` (string) and `credentials_ref` (string) |
| `scope` | object | No | `{}` | If present, may contain `include_patterns` (string[]) and `exclude_patterns` (string[]) |
| `max_pages` | number | No | `500` | Maximum pages to include in inventory |

If `site_url` is missing or empty, stop and report the error to the operator.

---

## Step 2 — Fetch and Parse robots.txt [AUTO]

Fetch `{site_url}/robots.txt`.

- Store the raw response body.
- Parse all `Disallow` directives (scoped to `User-agent: *` unless a more specific agent is configured).
- Parse all `Sitemap` directives.
- Note any `Disallow` rules that overlap with the configured crawl scope.

If `robots.txt` returns a non-200 status, log the status code and continue. A missing robots.txt is not blocking.

---

## Step 3 — Discover and Validate XML Sitemaps [AUTO]

Discover XML sitemaps by checking the following locations in order. Stop at the first successful discovery:

1. `Sitemap:` directives found in robots.txt (Step 2)
2. `{site_url}/sitemap.xml`
3. `{site_url}/sitemap_index.xml`
4. `{site_url}/wp-sitemap.xml` (WordPress default)

For each discovered sitemap:

- If the sitemap is a **sitemap index**, follow all `<sitemap>` entries and parse each child sitemap.
- Extract all `<loc>` URLs.
- Validate:
  - Well-formed XML (parseable without errors)
  - No broken internal `<loc>` references (URLs under site_url that 404)
  - `<lastmod>` dates present and valid ISO-8601

Record all validation issues. A sitemap with issues is still usable — log the issues and continue.

---

## Step 4 — Build Page Inventory and Classify [AUTO]

Build a page inventory from all URLs discovered in Step 3. Classify each page by type using URL pattern matching:

| Type | Pattern |
|------|---------|
| `homepage` | Root URL (`/` or site_url exactly) |
| `inventory` | URL contains `/inventory/` or is the main inventory listing page |
| `vdp` | Individual vehicle detail pages — typically child paths under `/inventory/` with a slug (e.g., `/inventory/2024-ford-f150-abc123/`) |
| `blog` | URL contains `/blog/` or `/news/` |
| `landing` | URL contains `/service-landing-pages/` or matches geo-targeted patterns (e.g., `/near-{city}/`, `/{city}-{service}/`) |
| `static` | Everything else (about, contact, financing, privacy, etc.) |

Apply classification in the order listed above. The first matching rule wins.

---

## Step 5 — Apply Scope Filters [AUTO]

If `scope.include_patterns` is set in site-config.json, keep only URLs matching at least one include pattern.

If `scope.exclude_patterns` is set, remove any URLs matching any exclude pattern.

After filtering, cap the inventory at `max_pages` (default 500). If the cap is reached, prioritize pages in this order: homepage, inventory, vdp, landing, blog, static.

---

## Step 6 — Write Page Inventory [AUTO]

Write `crawl/page-inventory.json` with the following structure:

```json
{
  "site_url": "https://example.com",
  "discovered_at": "2026-03-31T12:00:00Z",
  "robots_txt": {
    "raw": "User-agent: *\nDisallow: /wp-admin/\nSitemap: https://example.com/sitemap.xml",
    "disallow_rules": ["/wp-admin/"],
    "sitemap_urls": ["https://example.com/sitemap.xml"]
  },
  "sitemap_validation": {
    "found": true,
    "type": "index|single",
    "url_count": 142,
    "issues": [
      "3 URLs returned 404",
      "lastmod missing on 12 entries"
    ]
  },
  "pages": [
    {
      "url": "https://example.com/",
      "type": "homepage",
      "from_sitemap": true,
      "in_scope": true
    },
    {
      "url": "https://example.com/inventory/",
      "type": "inventory",
      "from_sitemap": true,
      "in_scope": true
    }
  ],
  "summary": {
    "total_discovered": 142,
    "in_scope": 138,
    "by_type": {
      "homepage": 1,
      "inventory": 1,
      "vdp": 98,
      "blog": 15,
      "landing": 8,
      "static": 15
    }
  }
}
```

### Field Reference

| Field | Description |
|-------|-------------|
| `site_url` | Canonical site URL from site-config.json |
| `discovered_at` | ISO-8601 timestamp of discovery run |
| `robots_txt.raw` | Full robots.txt response body |
| `robots_txt.disallow_rules` | Array of Disallow paths for the applicable user-agent |
| `robots_txt.sitemap_urls` | Array of Sitemap URLs declared in robots.txt |
| `sitemap_validation.found` | Whether any sitemap was discovered |
| `sitemap_validation.type` | `"index"` if sitemap index, `"single"` if standalone sitemap |
| `sitemap_validation.url_count` | Total URLs across all sitemaps |
| `sitemap_validation.issues` | Array of validation issue descriptions |
| `pages[].url` | Full page URL |
| `pages[].type` | Classified page type |
| `pages[].from_sitemap` | Whether the URL was found in a sitemap |
| `pages[].in_scope` | Whether the URL passed scope filters |
| `summary.total_discovered` | Total URLs found before scope filtering |
| `summary.in_scope` | URLs remaining after scope filtering and cap |
| `summary.by_type` | Count of in-scope pages by classification |

---

## Step 7 — Empty Inventory Gate [GATE: page count is 0]

If `summary.in_scope` is 0, **stop execution** and report to the operator:

- Whether robots.txt was reachable
- Whether any sitemaps were found
- Whether scope filters excluded all discovered URLs
- The raw URL count before filtering

Do not proceed to the next prompt in the chain until the operator resolves the issue.

---

## Next Steps

After successful completion, proceed to `02_CRAWL_AND_EXTRACT.md` which uses `crawl/page-inventory.json` as input to fetch and extract SEO signals from each in-scope page.
