# Prompt 05 -- Findings Report

> **Framework:** wordpress/seo-validation
> **Prompt:** 05 of N
> **Execution mode:** REVIEW_ONLY
> **Depends on:** Prompt 01 outputs (`crawl/page-inventory.json`), Prompt 02 outputs (`crawl/crawl-summary.json`, `crawl/extracted/*.json`), Prompt 03 outputs (`checks/results.json`, `checks/{check_id}.json`), Prompt 04 outputs (`mobile/results.json`, `mobile/screenshots/`)
> **Guardrails:** `frameworks/wordpress/seo-validation/guardrails.md`

---

## Objective

Aggregate all crawl and check results into the final findings report. Read existing artifacts produced by earlier prompts in the chain and produce two report files: a machine-readable summary (`reports/summary.json`) and a human-readable findings document (`reports/findings.md`).

This prompt does NOT re-crawl the site or re-run checks. It reads existing artifacts and writes report files only.

---

## Steps

### Step 1 -- Read All Artifacts `[AUTO]`

Read the following artifacts from the project directory:

| Artifact | Path | Required |
|----------|------|----------|
| Page inventory | `crawl/page-inventory.json` | **Yes** |
| Crawl summary | `crawl/crawl-summary.json` | **Yes** |
| Check results | `checks/results.json` | **Yes** |
| Per-check details | `checks/{check_id}.json` | No (read all that exist) |
| Mobile results | `mobile/results.json` | No |

If any **required** artifact is missing or unparseable, **STOP** and report the error to the operator. Do not proceed without valid crawl and check data.

If `mobile/results.json` is absent, set `mobile_tested` to `false` in downstream outputs and skip mobile sections in the findings document.

For per-check detail files, scan the `checks/` directory for any JSON files other than `results.json` and read each one. These provide granular per-page evidence for individual checks.

---

### Step 2 -- Produce Summary JSON `[AUTO]`

Write `reports/summary.json` with the following structure:

```json
{
  "report_generated_at": "ISO-8601",
  "site_url": "string",
  "pages_crawled": 0,
  "pages_failed": 0,
  "checks_run": 0,
  "checks_passed": 0,
  "checks_failed": 0,
  "checks_warned": 0,
  "mobile_tested": false,
  "mobile_pages_tested": 0,
  "overall_health": "good|needs-attention|critical",
  "critical_issues": [
    { "check_id": "string", "summary": "string", "affected_count": 0 }
  ],
  "warnings": [
    { "check_id": "string", "summary": "string", "affected_count": 0 }
  ]
}
```

#### Field Reference

| Field | Source | Description |
|-------|--------|-------------|
| `report_generated_at` | Current time | ISO-8601 timestamp of report generation |
| `site_url` | `crawl/page-inventory.json` → `site_url` | Canonical site URL |
| `pages_crawled` | `crawl/crawl-summary.json` → `successful` | Pages that returned HTTP 2xx |
| `pages_failed` | `crawl/crawl-summary.json` → `failed` | Pages that could not be loaded |
| `checks_run` | `checks/results.json` | Total number of distinct checks executed |
| `checks_passed` | `checks/results.json` | Checks with status `pass` |
| `checks_failed` | `checks/results.json` | Checks with status `fail` |
| `checks_warned` | `checks/results.json` | Checks with status `warn` |
| `mobile_tested` | Presence of `mobile/results.json` | Whether mobile emulation was run |
| `mobile_pages_tested` | `mobile/results.json` → page count | Number of pages tested on mobile devices |
| `overall_health` | Derived (see classification below) | Aggregate health classification |
| `critical_issues` | `checks/results.json` | Array of failed checks meeting critical threshold |
| `warnings` | `checks/results.json` | Array of checks with `warn` status |

#### Overall Health Classification

Evaluate in this order. The first matching rule determines the classification:

1. **`critical`** -- Any of the following is true:
   - A check with status `fail` affects more than 10% of crawled pages
   - Any blocker-class check has status `fail`. Blocker-class checks are: `canonical-presence`, `h1-presence`, `status-code`

2. **`needs-attention`** -- Any check has status `fail` or `warn`

3. **`good`** -- All checks have status `pass`

---

### Step 3 -- Produce Findings Document `[AUTO]`

Write `reports/findings.md` following the observational reporting rules defined in `guardrails.md` (section 3).

Use this exact structure:

```markdown
# SEO Validation Findings Report

**Site:** {site_url}
**Crawled:** {date from crawl-summary.json crawled_at}
**Pages:** {crawled} crawled, {failed} failed
**Overall Health:** {good|needs-attention|critical}

## Summary

{2-3 sentence overview. State the number of pages crawled, the number of checks run,
and the aggregate pass/fail/warn counts. If health is critical or needs-attention,
state the number of critical issues and warnings.}

## Critical Issues

{For each check with status `fail`, one subsection. If no critical issues, write:
"No critical issues observed."}

### {Check Name}
**Observation:** {Factual description of what was found. No root causes, no recommendations.}
**Affected pages:** {count} ({list the first 5 URLs; if more than 5, add "and {N} more -- see detail file"})
**Evidence:** `checks/{check_id}.json`

## Warnings

{For each check with status `warn`, one subsection. If no warnings, write:
"No warnings observed."}

### {Check Name}
**Observation:** {Factual description of what was found.}
**Affected pages:** {count} ({list the first 5 URLs; if more than 5, add "and {N} more -- see detail file"})
**Evidence:** `checks/{check_id}.json`

## Passing Checks

{Bulleted list of checks that passed, each with a one-line summary stat.
Example: "- **Title Tag Presence:** 138/138 pages have a title tag"}

## Mobile Rendering

{If mobile was NOT tested, write: "Mobile emulation was not run for this validation cycle."}

{If mobile WAS tested:}
**Devices:** {comma-separated list of device names from mobile/results.json}
**Pages tested:** {N}

{For each issue found in mobile/results.json:}
### {Issue type}
**Observation:** {Factual description of the rendering issue.}
**Screenshots:** `mobile/screenshots/{device}/{slug}.png`

## Crawl Notes

- Pages that failed to load: {comma-separated list of URLs, or "none"}
- Robots.txt issues: {list any issues from page-inventory.json robots_txt parsing, or "none"}
- Sitemap issues: {list any issues from page-inventory.json sitemap_validation.issues, or "none"}

## Evidence Locations

- Page inventory: `crawl/page-inventory.json`
- Extracted data: `crawl/extracted/`
- Check results: `checks/results.json`
- Mobile results: `mobile/results.json`
- Screenshots: `mobile/screenshots/`
```

#### Reporting Constraints

All content in `reports/findings.md` MUST adhere to guardrails section 3 (Observational Reporting):

- **DO:** Describe observations factually, cite evidence with file paths, quantify findings
- **DO NOT:** Diagnose root causes, suggest code implementations, prescribe solutions, estimate fix times
- Use required labels: `**Observation:**`, `**Evidence:**`
- Use `**HYPOTHESIS:**` only when interpretation is necessary, and always cite supporting evidence

---

### Step 4 -- Present for Review `[USER]`

Present the findings report summary to the operator for review.

Display the following in chat:

1. The `overall_health` classification
2. Count of critical issues, warnings, and passing checks
3. A one-line summary for each critical issue
4. A one-line summary for each warning

Wait for the operator to confirm before any external system updates (Dart task updates, notifications, etc.) are performed. Per guardrails section 6, this is a **required report gate**.

---

## Execution Mode: REVIEW_ONLY

This prompt operates under **REVIEW_ONLY** mode as defined in `guardrails.md`:

- **Allowed:** Read `crawl/` and `checks/` directories, write updated reports to `reports/`
- **Forbidden:** Re-crawl the site, modify crawl artifacts, modify check artifacts
- **Forbidden:** Submit forms, launch Playwright, or interact with any external site

---

## Output Artifacts

| Artifact | Path | Format |
|----------|------|--------|
| Summary JSON | `reports/summary.json` | JSON (machine-readable) |
| Findings document | `reports/findings.md` | Markdown (human-readable) |

---

## Next Steps

After operator review in Step 4, the findings report is complete. The operator decides whether to:

- Share the report externally
- Update project management tasks (Dart, etc.)
- Re-run specific checks with adjusted thresholds
- Proceed to remediation planning (outside this framework's scope)
