# Prompt 02 -- Crawl and Extract SEO Signals

> **Framework:** wordpress/seo-validation
> **Prompt:** 02 of N
> **Execution mode:** RUN_ONLY
> **Depends on:** Prompt 01 outputs (`crawl/page-inventory.json`)

---

## Objective

Crawl every in-scope page produced by Prompt 01 and extract the full set of on-page SEO signals into per-page JSON files. Produce a crawl summary with aggregate statistics.

---

## Steps

### Step 1 -- Read Page Inventory `[AUTO]`

Read `crawl/page-inventory.json` (produced by Prompt 01).
Parse the list of in-scope pages. Each entry contains at minimum a `url` and `page_type`.
If the file is missing or empty, **STOP** and report the error -- do not proceed without a valid inventory.

### Step 2 -- Read Site Configuration `[AUTO]`

Read `site-config.json` from the project root.
Check for authentication configuration:

- If `auth.type` is `"basic"`, resolve `auth.credentials_ref` to obtain credentials (e.g., environment variable name, keychain reference, or 1Password item). Do not read username/password directly from the config file.
- If no auth block is present, proceed without authentication.

### Step 3 -- Launch Playwright Browser `[AUTO]`

Launch Playwright with Chromium.

- If HTTP Basic auth is configured (Step 2), pass credentials to the browser context via `httpCredentials`.
- Otherwise, create a default browser context with no credentials.

### Step 4 -- Crawl and Extract Each Page `[AUTO]`

For each in-scope page from Step 1, respecting a **500 ms minimum delay** between page loads:

1. **Navigate** to the URL. Wait for `networkidle`.
2. **Record** the HTTP status code.
3. **Extract** the following from the rendered DOM:

   **Title and headings**
   - `<title>` tag content
   - All `<h1>` tags -- count and full text content of each

   **Canonical and meta tags**
   - `<link rel="canonical">` href
   - `<meta name="description">` content
   - `<meta name="robots">` content

   **Open Graph meta tags**
   - `og:title`
   - `og:description`
   - `og:image`
   - `og:url`
   - `og:type`

   **Images**
   - All `<img>` tags: `src`, `alt` attribute (present / absent / empty / value), `loading` attribute

   **Internal links**
   - All `<a href>` elements pointing to the same domain: `href`, link text

   **External links**
   - All `<a href>` elements pointing to a different domain: `href`, link text, `rel` attributes (e.g. `nofollow`)

   **Structured data**
   - All `<script type="application/ld+json">` blocks: parse the JSON, record the `@type` value

4. **Derive slug** from the URL path (strip leading/trailing slashes, replace `/` with `_`; use `index` for the root path).
5. **Write** extracted data to `crawl/extracted/{slug}.json` using the per-page schema below.

### Step 5 -- Record Crawl Errors `[AUTO]`

Track any pages that fail to load (timeout, HTTP 5xx, connection refused, or any other load failure).
Write all errors to `crawl/errors.json` as an array of objects:

```json
[
  {
    "url": "string",
    "error_type": "timeout | 5xx | connection_refused | other",
    "status_code": "number|null",
    "message": "string"
  }
]
```

### Step 6 -- Close Browser `[AUTO]`

Close the Playwright browser instance and all contexts. Release resources.

### Step 7 -- Write Crawl Summary `[AUTO]`

Write `crawl/crawl-summary.json` with the following structure:

```json
{
  "crawled_at": "ISO-8601",
  "total_pages": "N",
  "successful": "N",
  "failed": "N",
  "errors": ["..."],
  "extraction_stats": {
    "pages_with_h1": "N",
    "pages_with_canonical": "N",
    "pages_with_og": "N",
    "pages_with_structured_data": "N",
    "total_images": "N",
    "total_internal_links": "N",
    "total_external_links": "N"
  }
}
```

- `crawled_at`: ISO-8601 timestamp of when the crawl completed.
- `total_pages`: total number of pages attempted.
- `successful`: pages that returned HTTP 2xx and were fully extracted.
- `failed`: pages that could not be loaded or extracted.
- `errors`: array of error objects from Step 5.
- `extraction_stats`: aggregate counts across all successfully crawled pages.

---

## Per-Page Extracted JSON Schema

Each file written to `crawl/extracted/{slug}.json` must conform to:

```json
{
  "url": "string",
  "slug": "string",
  "page_type": "string",
  "status_code": "number",
  "crawled_at": "ISO-8601",
  "title": "string|null",
  "h1_tags": ["string"],
  "canonical": "string|null",
  "meta_description": "string|null",
  "meta_robots": "string|null",
  "og_tags": {
    "og:title": "string|null",
    "og:description": "string|null",
    "og:image": "string|null",
    "og:url": "string|null",
    "og:type": "string|null"
  },
  "images": [
    {
      "src": "string",
      "alt": "string|null",
      "has_alt": "boolean",
      "loading": "string|null"
    }
  ],
  "internal_links": [
    {
      "href": "string",
      "text": "string"
    }
  ],
  "external_links": [
    {
      "href": "string",
      "text": "string",
      "rel": "string|null"
    }
  ],
  "structured_data": [
    {
      "raw": {},
      "type": "string"
    }
  ]
}
```

---

## Guardrails

- **Read-only crawl.** The crawler must not submit forms, click buttons, trigger modals, or interact with any dynamic UI elements. Navigation and DOM reading only.
- **Respect robots.txt.** Honor any robots.txt directives carried forward in `crawl/page-inventory.json`. If a page was marked as blocked by robots.txt in the inventory, skip it and do not request it.
- **Rate limiting.** Maintain a minimum 500 ms delay between page loads to avoid overwhelming the target server.
- **No data mutation.** Do not POST, PUT, PATCH, or DELETE to any endpoint on the target site.
- **Execution mode: RUN_ONLY.** Execute the steps as written. Do not deviate, add analysis, or produce recommendations -- that is the responsibility of later prompts in the chain.
