# Output Formats

## Artifacts Overview

| Artifact | Format | Prompt | Purpose |
|----------|--------|--------|---------|
| `intake_manifest.json` | JSON | 01 | File inventory and classification |
| `presentation_content.json` | JSON | 02 | Extracted slide content |
| `source_document_index.json` | JSON | 03 | Indexed facts from source documents |
| `slide_findings.json` | JSON | 04 | Per-slide audit findings |
| `screenshot_findings.json` | JSON | 05 | Screenshot verification results |
| `corrections_findings.json` | JSON | 06 | Errata compliance results |
| `gap_analysis.json` | JSON | 07 | Synthesized metrics and patterns |
| `gap_analysis.md` | Markdown | 07 | Human-readable analysis narrative |
| `AUDIT_REPORT.md` | Markdown | 08 | Final comprehensive report |
| `audit_summary.json` | JSON | 08 | Machine-readable summary |

## Output Directory Structure

```
audit_output/
├── intake_manifest.json
├── presentation_content.json
├── source_document_index.json
├── slide_findings.json
├── screenshot_findings.json
├── corrections_findings.json
├── gap_analysis.json
├── gap_analysis.md
├── AUDIT_REPORT.md
└── audit_summary.json
```

## Severity Levels

| Severity | Color | Meaning |
|----------|-------|---------|
| CRITICAL | Red | Factual error that could mislead client |
| MAJOR | Orange | Missing spec'd content or unapplied correction |
| MINOR | Yellow | Wording or layout difference |
| INFO | Blue | Extra content or style observation |
| PASS | Green | Slide matches spec with no issues |

## Verdict Levels

| Verdict | Criteria |
|---------|----------|
| STRONG PASS | No CRITICAL, no MAJOR findings |
| PASS WITH NOTES | No CRITICAL, 1-2 MAJOR findings |
| NEEDS REVIEW | 1+ CRITICAL or 3+ MAJOR findings |
| SIGNIFICANT ISSUES | Multiple CRITICAL findings |

## Finding ID Format

| Prefix | Source | Example |
|--------|--------|---------|
| `S{nn}-F{nn}` | Slide content audit | S05-F01 (Slide 5, Finding 1) |
| `SS-{nn}` | Screenshot audit | SS-03 (Screenshot Finding 3) |
| `CR-{nn}` | Corrections check | CR-02 (Correction Finding 2) |

## JSON Schema References

- Intake: `schemas/intake.schema.json`
- Audit Summary: `schemas/output/audit-report.schema.json`
- Slide Finding: `schemas/output/slide-finding.schema.json`
