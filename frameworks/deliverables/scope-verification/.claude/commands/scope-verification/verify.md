---
name: verify
description: Run full scope verification pipeline — intake, count, compare, report
skill: scope-verification
mode: PATCH_ALLOWED
arguments:
  - name: scope_document
    description: Path to scope or proposal document
    required: true
  - name: source_data
    description: Path to source data (crawl directory, sitemap, spreadsheet, or URL)
    required: true
  - name: source_type
    description: "Type hint: crawl|sitemap|spreadsheet|url (auto-detected if omitted)"
    required: false
---

Run the full scope verification pipeline.

1. Load `guardrails.md` for execution constraints
2. Validate scope document and source data
3. Detect source type and extract all items into `source_manifest.json`
4. Extract all claims from scope into `scope_claims.json`
5. Categorize and count every source item — EXACT integers only
6. Compare scope claims against inventory
7. Generate `DISCREPANCY_REPORT.md` with severity and provenance
8. Present to user for optional corrections

ZERO tolerance for approximation. Follow `guardrails.md`.
