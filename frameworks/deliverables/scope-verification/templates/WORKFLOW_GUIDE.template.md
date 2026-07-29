# Scope Verification: {{CLIENT_NAME}}

Project: `{{PROJECT_NAME}}`

## What This Does

Verifies a scope/proposal document against source data (site crawl, sitemap, spreadsheet, or URL) by exact categorization, counting, and discrepancy detection.

## Pre-Verification Checklist

- [ ] Scope document (.md, .docx, or .pdf) placed in `intake/`
- [ ] Source data placed in `intake/` (crawl directory, sitemap, spreadsheet, or URL)
- [ ] Source type identified (crawl|sitemap|spreadsheet|url)

## How to Run

### Full Verification
```
/scope-verification:verify intake/<scope_file> intake/<source_data>
```

### Check Status
```
/scope-verification:status
```

## Expected Output

```
verification_output/
├── source_manifest.json
├── categorized_inventory.json
├── scope_claims.json
├── comparison_matrix.json
├── DISCREPANCY_REPORT.md      <-- Primary deliverable
└── verification_summary.json  <-- Machine-readable summary
```

## Review Checklist (Post-Verification)

- [ ] Read DISCREPANCY_REPORT.md summary
- [ ] Review any count mismatches
- [ ] Review uncategorized items
- [ ] Check for items in source but missing from scope
- [ ] Check for items in scope but missing from source
- [ ] Share findings with scope author
