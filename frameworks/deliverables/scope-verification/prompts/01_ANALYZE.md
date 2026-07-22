# 01 — Analyze

## Purpose
Validate inputs, detect source type, load all source items, extract all scope claims, categorize and count with exact integers, compare bidirectionally, and generate the discrepancy report and verification summary — all in a single FINDINGS_ONLY pass.

## Execution Mode
FINDINGS_ONLY — reads scope document and source data, writes all artifacts to `verification_output/`. Never modifies the scope document or source data.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `SCOPE_DOCUMENT` | Yes | Path to scope or proposal document (.md, .docx, .pdf) |
| `SOURCE_DATA` | Yes | Path to source data (crawl directory, sitemap file, spreadsheet, or URL) |
| `SOURCE_TYPE` | No | Type hint: crawl\|sitemap\|spreadsheet\|url (auto-detected if omitted) |
| `CATEGORY_MAP` | No | Custom category definitions (uses defaults if omitted) |

## Process

### Step 1: Validate Inputs and Detect Source Type [AUTO]
1. Confirm `SCOPE_DOCUMENT` exists and is readable
2. Confirm file type is supported (.md, .docx, .pdf)
3. If missing or unreadable, STOP and report what's needed
4. If `SOURCE_TYPE` is provided, use it directly
5. Otherwise, auto-detect:
   - Directory containing files → `crawl`
   - File ending in `.xml` with `<urlset>` → `sitemap`
   - File ending in `.csv`, `.xlsx`, `.xls` → `spreadsheet`
   - String starting with `http://` or `https://` → `url`
6. If type cannot be determined, STOP and ask user for `SOURCE_TYPE`

### Step 2: Load All Source Items [AUTO]
1. **If crawl directory:**
   - Inventory all files recursively
   - For each file, extract: filename, relative path, file type, title (from HTML `<title>` or filename)
   - Record total file count as exact integer

2. **If sitemap XML:**
   - Parse all `<url>` entries
   - For each URL, extract: loc, lastmod (if present), changefreq (if present)
   - Record total URL count as exact integer

3. **If spreadsheet:**
   - Read all rows using header row for field mapping
   - For each row, extract all columns as key-value pairs
   - Record total row count as exact integer

4. **If URL:**
   - Use Playwright to navigate to the URL
   - Discover all internal links (same domain)
   - Follow each link, record: URL, page title, HTTP status
   - Continue until all discoverable pages are visited
   - Record total page count as exact integer

5. Write `verification_output/source_manifest.json`:
   ```json
   {
     "source_path": "...",
     "source_type": "crawl|sitemap|spreadsheet|url",
     "extraction_timestamp": "ISO-8601",
     "total_items": 0,
     "items": [
       {
         "id": "item_001",
         "name": "...",
         "url_or_path": "...",
         "type": "...",
         "metadata": {}
       }
     ]
   }
   ```

**Provenance Check:** `total_items` MUST equal the length of the `items` array. No approximations.

### Step 3: Extract All Scope Claims [AUTO]
1. Read the entire scope document
2. Extract every quantitative or enumerative claim:
   - **Count claims**: Any number followed by a content noun ("63 pages", "5 forms")
   - **Enumeration claims**: Named lists of items
   - **Category claims**: References to groups ("all blog posts", "every product page")
   - **Exclusion claims**: Explicit exclusions ("excluding drafts", "not including archived")
3. For each claim, record: exact text, line number, section heading, claim type

4. Write `verification_output/scope_claims.json`:
   ```json
   {
     "scope_document": "...",
     "extraction_timestamp": "ISO-8601",
     "total_claims": 0,
     "claims": [
       {
         "id": "claim_001",
         "text": "exact quoted text from scope",
         "line_number": 0,
         "section": "section heading",
         "claim_type": "count|enumeration|category|exclusion",
         "claimed_count": null,
         "claimed_items": [],
         "category": "pages|posts|forms|plugins|integrations|other"
       }
     ]
   }
   ```

**Provenance Check:** `total_claims` MUST equal the length of the `claims` array.

### Step 4: Categorize and Count [AUTO]
1. If `CATEGORY_MAP` is provided, use custom categories
2. Otherwise, apply default category rules:

**Page Type Categories:**
| Category | Detection Heuristics |
|----------|---------------------|
| `standard_page` | Static informational pages (about, contact, services, etc.) |
| `blog_post` | Posts with date-based URLs or blog/news path segments |
| `product_page` | E-commerce product pages (product path segment, price data) |
| `landing_page` | Campaign/marketing pages (short path, CTA-focused) |
| `archive_page` | Category, tag, date, or author archive listings |
| `utility_page` | Search results, 404, login, cart, checkout, account pages |

**Content Type Categories:**
| Category | Detection Heuristics |
|----------|---------------------|
| `form` | Pages containing form elements or form plugin shortcodes |
| `custom_post_type` | Non-standard post types (portfolio, testimonial, case study, etc.) |
| `media_gallery` | Pages with image galleries or video embeds |
| `dynamic_content` | Pages with AJAX-loaded or dynamically generated content |

**Functionality Categories:**
| Category | Detection Heuristics |
|----------|---------------------|
| `plugin_integration` | Third-party plugin functionality (SEO, analytics, caching, etc.) |
| `api_integration` | External API connections |
| `custom_functionality` | Bespoke code or custom-developed features |

3. Assign every item to exactly one primary category (secondary categories recorded separately)
4. Items that cannot be categorized go into `uncategorized`
5. Count every category — EXACT integers only
6. Sum all category counts; cross-check total MUST equal `total_items` from source manifest
7. If cross-check fails, identify the discrepancy before proceeding

8. Write `verification_output/categorized_inventory.json`:
   ```json
   {
     "source_manifest": "verification_output/source_manifest.json",
     "categorization_timestamp": "ISO-8601",
     "total_items": 0,
     "category_summary": {
       "category_name": {
         "count": 0,
         "items": ["item_id_1", "item_id_2"]
       }
     },
     "uncategorized": {
       "count": 0,
       "items": []
     },
     "cross_check": {
       "sum_of_categories": 0,
       "source_total": 0,
       "match": true
     },
     "items": [
       {
         "id": "item_001",
         "name": "...",
         "primary_category": "...",
         "secondary_categories": [],
         "classification_evidence": "brief reason for categorization"
       }
     ]
   }
   ```

**Provenance Check:** For every category in `category_summary`, the `count` field MUST equal the length of the `items` array. The `cross_check.sum_of_categories` MUST equal `cross_check.source_total`. Violations are themselves CRITICAL findings.

### Step 5: Compare Bidirectionally [AUTO]

**Forward — Scope to Source:**
For each claim in `scope_claims.json`:
1. Identify the corresponding category or items in `categorized_inventory.json`
2. If **count claim**: compare `claimed_count` against matching category's `count`; classify as MATCH, OVERCOUNT (scope > source), or UNDERCOUNT (scope < source); record exact delta
3. If **enumeration claim**: for each named item, check if it exists in the source inventory; classify each as FOUND or MISSING_FROM_SOURCE
4. If **category claim**: map the scope category description to inventory categories; compare item sets
5. If **exclusion claim**: verify excluded items are indeed absent from counted totals

**Reverse — Source to Scope:**
For each item in `categorized_inventory.json`:
1. Check if the item is accounted for by any scope claim
2. Items not covered by any claim are classified as MISSING_FROM_SCOPE
3. Group uncovered items by category for reporting

Write `verification_output/comparison_matrix.json`:
```json
{
  "scope_claims_file": "verification_output/scope_claims.json",
  "categorized_inventory_file": "verification_output/categorized_inventory.json",
  "comparison_timestamp": "ISO-8601",
  "forward_results": [
    {
      "claim_id": "claim_001",
      "claim_text": "exact text from scope",
      "claim_type": "count|enumeration|category|exclusion",
      "scope_value": "value or count from scope",
      "source_value": "value or count from source",
      "status": "MATCH|OVERCOUNT|UNDERCOUNT|MISSING_FROM_SOURCE",
      "delta": 0,
      "severity": "CRITICAL|MAJOR|MINOR",
      "scope_location": "filename:line_number",
      "source_evidence": "category or item references"
    }
  ],
  "reverse_results": [
    {
      "item_id": "item_001",
      "item_name": "...",
      "category": "...",
      "status": "COVERED|MISSING_FROM_SCOPE",
      "covering_claim_id": "claim_id or null",
      "severity": "MAJOR"
    }
  ],
  "summary": {
    "total_forward_comparisons": 0,
    "forward_matches": 0,
    "forward_overcounts": 0,
    "forward_undercounts": 0,
    "forward_missing_from_source": 0,
    "total_reverse_items": 0,
    "reverse_covered": 0,
    "reverse_missing_from_scope": 0
  }
}
```

**Classification Rules:**
| Status | Direction | Severity | Meaning |
|--------|-----------|----------|---------|
| MATCH | Forward | — | Scope count equals source count |
| OVERCOUNT | Forward | CRITICAL | Scope claims more than source has |
| UNDERCOUNT | Forward | CRITICAL | Scope claims fewer than source has |
| MISSING_FROM_SOURCE | Forward | MAJOR | Scope references item not found in source |
| COVERED | Reverse | — | Source item accounted for in scope |
| MISSING_FROM_SCOPE | Reverse | MAJOR | Source item not accounted for in scope |

### Step 6: Generate Reports [AUTO]

**DISCREPANCY_REPORT.md:**
Write `verification_output/DISCREPANCY_REPORT.md` with the following structure:

```markdown
# Scope Verification — Discrepancy Report

## Executive Summary
- Scope document: [path]
- Source data: [path] ([type])
- Verification date: [ISO-8601]
- Verdict: [VERIFIED_CLEAN | DISCREPANCIES_FOUND | SIGNIFICANT_DISCREPANCIES]
- Total discrepancies: [exact integer]
- Breakdown: [N] CRITICAL, [N] MAJOR, [N] MINOR

## Section 1: Count Mismatches (CRITICAL)
For each OVERCOUNT or UNDERCOUNT from forward_results:
- **Observation:** [exact description]
- **Evidence Locations:**
  - Scope: `[file:line]` — "[exact quoted text]"
  - Source: `[artifact]` — [category]: [count] items
- **Delta:** [+N or -N]

## Section 2: Missing Items (MAJOR)
### Items in Scope but Not in Source
For each MISSING_FROM_SOURCE:
- **Observation:** [item description]
- **Evidence Locations:** [scope location, searched categories]

### Items in Source but Not in Scope
For each MISSING_FROM_SCOPE:
- **Observation:** [item description]
- **Evidence Locations:** [source location, relevant categories]

## Section 3: Category Misalignments (MINOR)
For each classification disagreement:
- **Observation:** [description]
- **Evidence Locations:** [both locations]

## Section 4: Verification Coverage
- Forward pass: [N/M] scope claims verified
- Reverse pass: [N/M] source items accounted for
- Categories verified: [list]

## Open Questions for Review
- [Questions requiring human judgement]
```

**Provenance check on the report:**
1. Every discrepancy MUST cite both a scope location and a source location
2. Scan for forbidden labels per `guardrails.md#forbidden-labels`
3. Scan for approximation language per `guardrails.md#zero-approximation`
4. If violations found, correct them before finalizing

**verification_summary.json:**
Write `verification_output/verification_summary.json`:
```json
{
  "scope_document": "...",
  "source_data": "...",
  "source_type": "...",
  "verification_timestamp": "ISO-8601",
  "verdict": "VERIFIED_CLEAN|DISCREPANCIES_FOUND|SIGNIFICANT_DISCREPANCIES",
  "total_discrepancies": 0,
  "severity_breakdown": {
    "CRITICAL": 0,
    "MAJOR": 0,
    "MINOR": 0
  },
  "forward_pass": {
    "claims_checked": 0,
    "claims_matched": 0,
    "claims_mismatched": 0
  },
  "reverse_pass": {
    "items_checked": 0,
    "items_covered": 0,
    "items_missing_from_scope": 0
  },
  "artifacts_generated": [
    "verification_output/source_manifest.json",
    "verification_output/scope_claims.json",
    "verification_output/categorized_inventory.json",
    "verification_output/comparison_matrix.json",
    "verification_output/DISCREPANCY_REPORT.md",
    "verification_output/verification_summary.json"
  ]
}
```

**Verdict Rules:**
| Verdict | Condition |
|---------|-----------|
| VERIFIED_CLEAN | Zero discrepancies of any severity |
| DISCREPANCIES_FOUND | At least one discrepancy, but zero CRITICAL |
| SIGNIFICANT_DISCREPANCIES | At least one CRITICAL discrepancy |

## Output
- `verification_output/source_manifest.json`
- `verification_output/scope_claims.json`
- `verification_output/categorized_inventory.json`
- `verification_output/comparison_matrix.json`
- `verification_output/DISCREPANCY_REPORT.md`
- `verification_output/verification_summary.json`

## Success Criteria
- Scope document validated and all claims extracted with line numbers
- Source data type correctly detected and all items extracted
- Source manifest contains exact item count matching item list length
- Every source item assigned to exactly one primary category
- All category counts are exact integers with matching item lists
- Cross-check total equals source manifest total
- Every scope claim compared against source (forward pass complete)
- Every source item checked against scope (reverse pass complete)
- All statuses assigned from the defined classification set
- Every discrepancy cites both scope and source locations
- Zero forbidden labels in the report
- Zero approximation language in the report
- Verdict correctly assigned per verdict rules
- Provenance check passed on every artifact

## Failure Modes
| Condition | Action |
|-----------|--------|
| SCOPE_DOCUMENT does not exist | STOP; report error |
| SOURCE_DATA does not exist and is not a URL | STOP; report error |
| Source type cannot be detected | STOP; ask user for SOURCE_TYPE |
| URL crawl fails (network error, blocked) | STOP; report error and suggest providing a sitemap or crawl directory instead |
| Spreadsheet has no header row | WARN; use column indices as field names |
| Scope document contains no quantitative claims | WARN; proceed but note comparison will be limited to enumeration matching |
| Sitemap XML is malformed | WARN; extract what is parseable, flag unparsed entries |
| Cross-check total does not match source total | STOP; identify which items are miscounted before proceeding |
| More than 20% of items are uncategorized | WARN; proceed but flag that custom CATEGORY_MAP may be needed |
| A scope claim cannot be mapped to any source category | Record as MISSING_FROM_SOURCE with note "no matching category" |
| Ambiguous claim-to-category mapping | Record all possible mappings, flag for human review in Open Questions |
| Forbidden labels detected in draft report | Remove and replace per guardrails before finalizing |
| Approximation language detected in draft report | Replace with exact counts before finalizing |
