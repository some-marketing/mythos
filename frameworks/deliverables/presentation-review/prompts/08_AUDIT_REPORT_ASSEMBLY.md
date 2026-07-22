# 08 — Audit Report Assembly

## Purpose
Assemble all findings, analyses, and the gap analysis into a final structured audit report.

## Execution Mode
REVIEW_ONLY — reads all artifacts, writes `AUDIT_REPORT.md` and `audit_summary.json` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `intake_manifest.json` | Yes | Output of Prompt 01 |
| `presentation_content.json` | Yes | Output of Prompt 02 |
| `source_document_index.json` | Yes | Output of Prompt 03 |
| `slide_findings.json` | Yes | Output of Prompt 04 |
| `screenshot_findings.json` | Yes | Output of Prompt 05 |
| `corrections_findings.json` | Yes | Output of Prompt 06 |
| `gap_analysis.json` | Yes | Output of Prompt 07 |
| `gap_analysis.md` | Yes | Output of Prompt 07 |

## Prerequisites
- All prompts 01-07 must be complete

## Process

### Step 1: Load All Artifacts [AUTO]
Read all eight input artifacts from `audit_output/`.

### Step 2: Assemble AUDIT_REPORT.md [AUTO]
Write the final report using this structure:

```markdown
# Presentation Audit Report

**Presentation:** {filename}
**Audit Date:** {date}
**Overall Verdict:** {verdict}

---

## Executive Summary

{2-3 sentence summary of the audit outcome}

### Key Metrics
| Metric | Value |
|--------|-------|
| Total Slides | {n} |
| Slides Passing | {n} |
| CRITICAL Findings | {n} |
| MAJOR Findings | {n} |
| MINOR Findings | {n} |
| INFO Findings | {n} |
| Screenshot Completeness | {n}/{n} |
| Corrections Applied | {n}/{n} |

---

## Source Documents Reviewed

{Table of documents from intake_manifest}

---

## Slide-by-Slide Findings

### Slide {n}: {title}
**Status:** PASS | {severity level}

{For each finding on this slide:}
- **Observation:** {what was found}
- **Evidence:** {file:line citations}
- **HYPOTHESIS:** {interpretation, if any}

{Repeat for all slides}

---

## Screenshot Audit

### Summary
- {n}/{n} screenshots present
- {n}/{n} visually verified
- {n} orphaned files

### Findings
{Table of screenshot findings}

---

## Corrections & Errata Check

### Summary
- {n}/{n} corrections applied

### Findings
{Table of correction findings}

---

## Gap Analysis

{Include gap_analysis.md content}

---

## Open Questions for Review

{Compiled list of items requiring human judgement}

---

## Evidence Locations

{Index of all referenced files and their roles}
```

### Step 3: Assemble audit_summary.json [AUTO]
Write a machine-readable summary:
```json
{
  "presentation_file": "...",
  "audit_date": "...",
  "overall_verdict": "...",
  "metrics": {
    "total_slides": 0,
    "slides_passing": 0,
    "finding_counts": {"CRITICAL": 0, "MAJOR": 0, "MINOR": 0, "INFO": 0},
    "screenshot_completeness": "12/12",
    "corrections_compliance": "7/7"
  },
  "critical_findings": [],
  "major_findings": [],
  "open_questions": [],
  "source_documents_reviewed": 0,
  "coverage": {}
}
```

### Step 4: Validate Report [AUTO]
1. Confirm all slides are covered in the report
2. Confirm all findings from sub-reports are included
3. Confirm no forbidden labels per `guardrails.md#forbidden-labels`
4. Confirm all evidence paths are valid file references

## Output
- `audit_output/AUDIT_REPORT.md`
- `audit_output/audit_summary.json`

## Success Criteria
- Report covers every slide
- All findings from all three audit streams included
- Executive summary accurately reflects the data
- No forbidden labels (Root Cause, Recommendation, Action Required, etc.)
- All evidence paths are traceable
- Both markdown and JSON outputs written
- Report is self-contained (readable without needing to open other artifacts)

## Failure Modes
| Condition | Action |
|-----------|--------|
| Missing input artifact | Include "DATA UNAVAILABLE" section; note which stream is missing |
| Finding count mismatch between sub-reports and aggregate | Flag discrepancy in report; include both counts |
| Report exceeds reasonable length | Summarize INFO findings in a table rather than listing each one |
