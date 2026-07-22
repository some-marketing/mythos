# SEO Validation Framework Guardrails

This document defines safety rules, execution modes, and constraints for the SEO validation framework. Adapted from the wordpress/qa framework guardrails for read-only crawl and validation use.

---

## Quick Reference Table

| Mode | Writes Files | Crawls Site | Modifies Site | Use Case |
|------|-------------|-------------|---------------|----------|
| FINDINGS_ONLY | No | No | No | Review existing crawl data only |
| RUN_ONLY | Reports only | Yes | No | Execute crawl, produce findings |
| REVIEW_ONLY | Reports only | No | No | Re-analyze existing crawl artifacts |

---

## 1. Execution Modes {#execution-modes}

### FINDINGS_ONLY
- **Purpose:** Observe and document without crawling or writing
- **Allowed:** Read existing crawl artifacts, present findings in chat
- **Forbidden:** Write files, launch Playwright, modify any data
- **Use when:** Reviewing prior crawl results in conversation

### RUN_ONLY
- **Purpose:** Execute the crawl and produce findings without modifying the target site
- **Allowed:** Launch Playwright, fetch pages, extract data, write crawl artifacts and reports
- **Forbidden:** Submit forms, click buttons, log in (unless auth is required for crawl access), modify any site content
- **Use when:** Pre-launch SEO validation runs

### REVIEW_ONLY
- **Purpose:** Re-analyze existing crawl data and produce updated reports
- **Allowed:** Read crawl/ and checks/ directories, write updated reports
- **Forbidden:** Re-crawl the site, modify crawl artifacts
- **Use when:** Regenerating reports after threshold changes or known-issue updates

---

## 2. Crawl Safety Rules {#crawl-safety}

### Read-Only Crawl
- The crawler MUST NOT submit forms, click interactive elements, or trigger state changes
- The crawler MUST NOT attempt to log into WordPress admin
- If HTTP Basic auth is configured in site-config.json, it is used only for page access
- The crawler respects robots.txt directives
- The crawler adds a 500ms minimum delay between page loads to avoid hammering the server

### Scope Enforcement
- Only URLs matching the configured site domain are crawled
- External links are checked via HEAD request only (for broken link detection)
- Include/exclude patterns from site-config.json are enforced before any page fetch
- Maximum page count is capped (default: 500) to prevent runaway crawls

---

## 3. Observational Reporting {#observational-reporting}

All reports MUST follow observational reporting principles (adapted from wordpress/qa).

### What TO do:
- Describe what you observe: "Page /inventory/ has 3 H1 tags"
- Describe what you expected: "Expected: 1 H1 per page. Observed: 3 H1 tags"
- Cite evidence with file paths: "Extracted data at `crawl/extracted/inventory.json`"
- Quantify: "Alt text coverage: 67/120 images (55.8%)"

### What NOT to do:
- Do NOT diagnose root causes
- Do NOT suggest code implementations
- Do NOT prescribe solutions
- Do NOT estimate fix times

### Required Labels
- `**Observation:**` — Factual description
- `**HYPOTHESIS:**` — Labeled interpretation with evidence citation
- `**Evidence:**` — File path to supporting data

---

## 4. Evidence Standards {#evidence-standards}

### Per-Page Extraction
Every crawled page produces a JSON file at `crawl/extracted/{slug}.json` containing:
- URL, status code, page type classification
- Title tag, H1 tag(s), meta description
- Canonical URL, robots meta directives
- OG tags (title, description, image, url, type)
- Image inventory (src, alt text presence, alt text value)
- Internal links, external links
- JSON-LD structured data blocks (raw)

### Per-Check Results
Every validation check produces entries in `checks/results.json` with:
- Check ID, check name, scope (page-level or site-level)
- Status: pass | fail | warn
- Evidence: specific data points that triggered the status
- Affected URLs

### Screenshots
Mobile emulation screenshots are stored at `mobile/screenshots/{device}/{slug}.png`.

---

## 5. Data Safety {#data-safety}

### Never Include
- Real credentials (even if provided in site-config.json, never log them)
- Cookie values or session tokens
- Content behind authentication (unless explicitly configured)

### Safe Patterns
- Reference site-config.json for auth without exposing values
- Store extracted text content, not raw authentication headers

---

## 6. Step Markers {#step-markers}

| Marker | Meaning |
|--------|---------|
| `[AUTO]` | Execute without confirmation |
| `[USER]` | Present to operator, wait for response |
| `[GATE: condition]` | If condition TRUE -> behave as [USER]; if FALSE -> proceed as [AUTO] |

### Required Gates
- **Pre-crawl gate:** Operator confirms target URL and scope before Playwright launches
- **Report gate:** Operator reviews findings before any external system updates (Dart, etc.)
