# Framework Guardrails

This document consolidates all safety rules, execution modes, and constraints for the Scope Verification framework. Reference this file from skills, commands, and agents via anchor links.

---

## Quick Reference Table

| Mode | Writes Files | Runs Tests | Modifies Inputs | Use Case |
|------|-------------|------------|-----------------|----------|
| FINDINGS_ONLY | No | No | No | Observe, count, and report discrepancies only |
| PATCH_ALLOWED | Scoped | No | Scoped | Apply approved corrections to scope document |

---

## 1. Execution Modes {#execution-modes}

### FINDINGS_ONLY
- **Purpose:** Extract source data, categorize, count, compare against scope, and report discrepancies
- **Allowed:** Read files, crawl URLs via Playwright, analyze content, write artifacts to `verification_output/`
- **Forbidden:** Modify the scope document or any source data files
- **Use when:** Running the analysis pass (Prompt 01), producing discrepancy report

### PATCH_ALLOWED
- **Purpose:** Apply user-approved corrections to the scope document based on verified discrepancies
- **Allowed:** Read all artifacts, modify the scope document with confirmed corrections only
- **Forbidden:** Change source data, apply corrections without user confirmation, alter any artifact retroactively
- **Use when:** Prompt 02 (Report and Update) after user reviews and approves specific corrections

---

## 2. Observational Reporting {#observational-reporting}

**CRITICAL:** All reports and analysis outputs MUST follow observational reporting principles.

### What TO do:
- Describe what you observe: "Source manifest contains 63 pages across 4 content types"
- Describe what the scope claims: "Scope document Section 3.2 states '58 pages to migrate'"
- Cite evidence with exact locations: "Source: `source_manifest.json` item count = 63; Scope: `proposal.md:line 47` states '58 pages'"
- Quantify discrepancies with exact integers: "Scope claims 58 pages; source contains 63 pages; delta = +5 (UNDERCOUNT)"
- Posit hypotheses (labeled): "HYPOTHESIS: The 5 missing pages may be draft/staging pages excluded from the original crawl"

### What NOT to do:
- Do NOT diagnose root causes -- Don't say "The proposal writer miscounted the pages"
- Do NOT suggest scope changes -- No "Update Section 3.2 to say 63 pages"
- Do NOT prescribe pricing adjustments -- No "Increase the project cost by $X for the extra pages"
- Do NOT make editorial decisions -- No "These 5 extra pages should be excluded from scope"
- Do NOT estimate effort impact -- No "This will add 2 days to the migration timeline"

### Forbidden Labels and Patterns {#forbidden-labels}

Reports must contain **ZERO** instances of:

| Forbidden | Replace With |
|-----------|-------------|
| `Root Cause:` | `Observation:` + `HYPOTHESIS:` |
| `Recommendation:` | `Open Questions for Review` |
| `Action Required:` | `Evidence Locations:` |
| `Fix:` or `Change to:` | `Observation:` (describe the discrepancy) |
| `Confidence Level: HIGH` | Remove entirely -- let evidence speak |
| Priority labels (`P0`, `P1`, `P2`) | Use severity: CRITICAL / MAJOR / MINOR |
| Edit suggestions (in FINDINGS_ONLY) | Remove entirely |
| Time estimates | Remove entirely |
| `~`, `approximately`, `around` before numbers | Use exact integers only |

### Required Labels {#required-labels}

All interpretive statements MUST use one of:

- `**Observation:**` -- Factual description of what was counted or compared
- `**HYPOTHESIS:**` -- Labeled interpretation with evidence path citation
- `**Cross-Source Pattern:**` -- Factual comparison across scope and source data
- `**Open Questions for Review:**` -- Section header for questions requiring human judgement
- `**Evidence Locations:**` -- Section header listing file paths and line numbers

---

## 3. Zero Tolerance for Approximation {#zero-approximation}

**CRITICAL:** This framework enforces exact counting. Approximation is a verification failure.

### Forbidden Patterns:
- `~63 pages` -- MUST be `63 pages`
- `approximately 20 blog posts` -- MUST be `20 blog posts`
- `around 15 custom post types` -- MUST be `15 custom post types`
- `several`, `many`, `a few`, `some` as quantities -- MUST use exact integers
- `50+` or `100+` -- MUST enumerate to exact count

### Count Integrity Rule:
If the scope document states "63 pages", the verification MUST enumerate exactly which 63 pages are claimed. If the source contains 63 items, all 63 MUST be listed by name/URL in `source_manifest.json`.

### Provenance Check:
Every count in every artifact MUST be verifiable by counting the items in the associated list. If `categorized_inventory.json` says `"blog_posts": 24`, there MUST be exactly 24 items in the `blog_posts` array. A mismatch between a stated count and its item list is itself a CRITICAL finding.

---

## 4. Bidirectional Verification {#bidirectional-verification}

Verification MUST run in both directions:

### Scope-to-Source (Forward):
For every claim in the scope document, find the corresponding items in the source data.
- Missing from source = item claimed in scope but not found in source data

### Source-to-Scope (Reverse):
For every item in the source data, confirm it is accounted for in the scope document.
- Missing from scope = item exists in source but not mentioned in scope

### Both directions are required. A verification that only checks forward is incomplete.

---

## 5. Severity Classification {#severity-classification}

| Severity | Definition | Examples |
|----------|-----------|---------|
| CRITICAL | Count mismatch between scope and source data | Scope says 58 pages, source has 63; scope says 5 forms, source has 8 |
| MAJOR | Item exists in one dataset but not the other | Blog post in source not mentioned in scope; scope references a page that doesn't exist |
| MINOR | Category or classification disagreement | Scope calls it a "page", source classifies it as a "post"; naming differences |

### Severity Rules:
1. COUNT_MISMATCH is always CRITICAL -- a wrong number in a scope document directly affects pricing and effort
2. MISSING_ITEM is always MAJOR -- an unaccounted item means unscoped work or phantom deliverables
3. CATEGORY_MISMATCH is always MINOR -- classification differences that don't affect total counts
4. Severity is based on scope accuracy impact, not ease of correction

---

## 6. Source Data Handling {#source-data-handling}

### Supported Source Types:
| Type | Detection | Handling |
|------|-----------|----------|
| Crawl directory | Directory containing HTML/JSON files | Inventory all files, extract URLs and titles |
| Sitemap XML | File ending in `.xml` containing `<urlset>` | Parse all `<url>` entries |
| Spreadsheet | `.csv`, `.xlsx`, `.xls` file | Read all rows, use header row for field mapping |
| URL | Starts with `http://` or `https://` | Use Playwright to crawl; build sitemap from discovered links |

### Never Modify Source Data:
- Source files are read-only evidence
- Crawl directories must not be altered
- URLs must not be modified or redirected

### URL Crawling Rules (when source_data is a URL):
- Respect robots.txt
- Stay within the same domain unless explicitly configured otherwise
- Record every discovered URL with its HTTP status code
- Do not follow external links unless they are part of the scope

---

## 7. Scope Document Parsing {#scope-document-parsing}

### Claim Extraction Rules:
- A "claim" is any quantitative or enumerative statement in the scope document
- Extract ALL claims, not just page counts (forms, plugins, integrations, content types, etc.)
- Record the exact text, line number, and section of each claim
- Distinguish between:
  - **Count claims**: "63 pages", "5 contact forms", "12 custom post types"
  - **Enumeration claims**: Lists of specific items by name
  - **Category claims**: "All blog posts", "Every product page"
  - **Exclusion claims**: "Excluding draft pages", "Not including archived posts"

### Scope Document Integrity:
- NEVER modify the scope document during FINDINGS_ONLY mode
- In PATCH_ALLOWED mode, only modify passages explicitly approved by the user
- Always preserve the original text alongside any correction for audit trail

---

## 8. Data Safety {#data-safety}

### Never Include in Reports:
- Client passwords, API keys, or credentials
- Internal pricing calculations or margin discussions
- PII of individuals not already named in the scope document
- Source data content beyond what's needed for evidence (e.g., don't dump full page HTML)

### Safe Patterns:
- Reference file paths and line numbers instead of pasting large content blocks
- Quote only the specific text needed for evidence
- Use item counts and names, not full content bodies
- Summarize page content by title/URL, not by body text

---

## 9. Mode-Specific Checklists {#mode-checklists}

### FINDINGS_ONLY Checklist
- [ ] No input files were modified (scope document, source data)
- [ ] All artifacts written to `verification_output/` only
- [ ] Every count is an exact integer -- zero approximations
- [ ] Bidirectional verification performed (scope-to-source AND source-to-scope)
- [ ] Every discrepancy cites both scope location and source location
- [ ] Severity assigned to every discrepancy per Section 5 rules
- [ ] Provenance check passed: stated counts match item list lengths
- [ ] No forbidden labels or patterns per Section 2
- [ ] Evidence paths cited for all claims

### PATCH_ALLOWED Checklist
- [ ] User explicitly approved each correction before it was applied
- [ ] Only the scope document was modified (no source data changes)
- [ ] Original text preserved alongside corrections
- [ ] Corrections match verified source data exactly
- [ ] No new approximations introduced
- [ ] Modified passages re-verified against source after correction
