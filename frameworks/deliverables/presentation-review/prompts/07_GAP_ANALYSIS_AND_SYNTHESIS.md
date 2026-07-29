# 07 — Gap Analysis and Synthesis

## Purpose
Synthesize all findings from the parallel audit steps into patterns, coverage gaps, and an overall assessment.

## Execution Mode
REVIEW_ONLY — reads all finding artifacts, writes `gap_analysis.json` and `gap_analysis.md` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `slide_findings.json` | Yes | Output of Prompt 04 |
| `screenshot_findings.json` | Yes | Output of Prompt 05 |
| `corrections_findings.json` | Yes | Output of Prompt 06 |
| `source_document_index.json` | Yes | Output of Prompt 03 |
| `intake_manifest.json` | Yes | Output of Prompt 01 |

## Prerequisites
- Prompts 04, 05, and 06 must ALL be complete (this is the convergence point)

## Process

### Step 1: Load All Finding Artifacts [AUTO]
Read all five input artifacts from `audit_output/`.

### Step 2: Aggregate Finding Counts [AUTO]
Compile totals across all three audit streams:
- Total findings by severity (CRITICAL, MAJOR, MINOR, INFO)
- Total findings by category (content, pricing, timeline, screenshot, correction, etc.)
- Pass rate: slides with no CRITICAL or MAJOR findings / total slides

### Step 3: Pattern Analysis [AUTO]
Look for patterns across findings:
1. **Recurring issues**: Same type of finding appearing on multiple slides
2. **Source document gaps**: Facts in the presentation not traceable to any source doc
3. **Unused source material**: Significant content in source docs not represented in any slide
4. **Correction patterns**: Are unapplied corrections clustered (suggesting a section was missed)?
5. **Screenshot patterns**: Are missing/mismatched screenshots clustered on certain slides?

### Step 4: Coverage Analysis [AUTO]
Calculate coverage metrics:
- **Spec coverage**: % of slide content spec items represented in the presentation
- **Fact accuracy**: % of verifiable facts that match source documents
- **Screenshot completeness**: % of manifest screenshots present and verified
- **Correction compliance**: % of errata corrections applied
- **Source utilization**: % of key source document facts referenced in the presentation

### Step 5: Cross-Stream Observations [AUTO]
Identify findings that span multiple audit streams:
- A slide with both content issues AND screenshot issues
- A correction that wasn't applied AND the affected slide has other findings
- Screenshots that are present but the slide content they illustrate has issues

### Step 6: Overall Assessment [AUTO]
Determine the overall audit verdict:
- **STRONG PASS**: No CRITICAL, no MAJOR, minor/info only
- **PASS WITH NOTES**: No CRITICAL, 1-2 MAJOR, notes provided
- **NEEDS REVIEW**: 1+ CRITICAL or 3+ MAJOR findings requiring attention
- **SIGNIFICANT ISSUES**: Multiple CRITICAL findings

### Step 7: Write Gap Analysis [AUTO]
Write both `audit_output/gap_analysis.json` and `audit_output/gap_analysis.md`:

JSON structure:
```json
{
  "aggregate_counts": {
    "by_severity": {"CRITICAL": 0, "MAJOR": 0, "MINOR": 0, "INFO": 0, "PASS": 0},
    "by_category": {},
    "by_stream": {"slide_audit": 0, "screenshot_audit": 0, "corrections_check": 0}
  },
  "pass_rate": 0.0,
  "coverage": {
    "spec_coverage_pct": 0,
    "fact_accuracy_pct": 0,
    "screenshot_completeness_pct": 0,
    "correction_compliance_pct": 0
  },
  "patterns": [
    {"pattern": "...", "affected_slides": [], "finding_ids": []}
  ],
  "cross_stream_observations": ["..."],
  "unused_source_material": ["..."],
  "overall_verdict": "STRONG PASS | PASS WITH NOTES | NEEDS REVIEW | SIGNIFICANT ISSUES",
  "verdict_rationale": "..."
}
```

Markdown format: human-readable narrative summary with sections for each analysis area.

## Output
- `audit_output/gap_analysis.json`
- `audit_output/gap_analysis.md`

## Success Criteria
- All three finding streams aggregated
- Coverage metrics calculated
- Patterns identified (or explicitly noted as "no patterns found")
- Overall verdict assigned with rationale
- Both JSON and markdown outputs written

## Failure Modes
| Condition | Action |
|-----------|--------|
| One finding stream is empty (e.g., no corrections) | Note reduced coverage; calculate metrics from available streams |
| Conflicting findings across streams | Report both; flag as requiring manual resolution |
| All findings are PASS | Report as STRONG PASS with confidence note |
