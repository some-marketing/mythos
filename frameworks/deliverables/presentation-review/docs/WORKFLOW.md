# Presentation Review Workflow

## Overview

The presentation review framework audits a client-facing presentation (.pptx) against the project plan documents that informed its creation. It validates content accuracy, screenshot placement, and errata compliance.

## Prompt Chain

```
01_INTAKE_AND_DISCOVERY
        |
   ┌────┴────┐
   v          v
02_EXTRACTION  03_SOURCE_INDEX
   |          |
   └────┬─────┘
        |
   ┌────┼────────┐
   v    v         v
04_SLIDE  05_SCREENSHOT  06_CORRECTIONS
   |      |              |
   └──────┼──────────────┘
          v
   07_GAP_ANALYSIS
          |
          v
   08_AUDIT_REPORT
```

## Step-by-Step

### Phase 1: Discovery (Sequential)
**Prompt 01: Intake and Discovery**
- Validates inputs (presentation file + project directory)
- Inventories all files and classifies them by role
- Identifies key documents (scope, proposal, spec, errata, screenshots)
- Output: `intake_manifest.json`

### Phase 2: Extraction (Can Parallelize)
**Prompt 02: Presentation Extraction**
- Extracts all slide content into structured JSON
- Captures titles, body text, speaker notes, image references
- Output: `presentation_content.json`

**Prompt 03: Source Document Index**
- Reads and indexes all source documents
- Extracts facts by category (pricing, timeline, deliverables, etc.)
- Builds screenshot manifest and corrections list
- Output: `source_document_index.json`

### Phase 3: Audit (Parallel)
These three prompts can run simultaneously:

**Prompt 04: Slide Content Audit**
- Cross-references every slide against spec and source docs
- Checks pricing, timeline, statistics, quotes, deliverables
- Verifies narrative arc compliance
- Output: `slide_findings.json`

**Prompt 05: Screenshot Manifest Audit**
- Checks screenshot existence, visual accuracy, annotations
- Validates slide placement against manifest
- Identifies orphaned files
- Output: `screenshot_findings.json`

**Prompt 06: Corrections and Errata Check**
- Verifies each correction from errata has been applied
- Searches for prohibited content
- Calculates compliance rate
- Output: `corrections_findings.json`

### Phase 4: Synthesis (Sequential)
**Prompt 07: Gap Analysis and Synthesis**
- Aggregates findings from all three audit streams
- Identifies patterns, coverage gaps, cross-stream observations
- Assigns overall verdict
- Output: `gap_analysis.json` + `gap_analysis.md`

**Prompt 08: Audit Report Assembly**
- Assembles final structured report
- Includes executive summary, slide-by-slide findings, evidence index
- Output: `AUDIT_REPORT.md` + `audit_summary.json`

## Execution Modes

| Mode | Use Case | What Happens |
|------|----------|-------------|
| FINDINGS_ONLY | Quick verbal check | Run prompts 01-07 in chat, no files written |
| REVIEW_ONLY | Full structured audit | All prompts run, all artifacts written to `audit_output/` |

## Typical Duration
- Discovery + Extraction: ~2-3 minutes
- Audit (parallel): ~3-5 minutes
- Synthesis + Report: ~2-3 minutes
- **Total: ~7-11 minutes** for a 14-slide presentation with 12 screenshots and 7 source documents

## Graceful Degradation

The framework adapts when components are missing:

| Missing Component | Impact |
|-------------------|--------|
| No slide content spec | Audit compares presentation against scope/proposal only |
| No errata file | Corrections check skipped; noted in report |
| No screenshots | Screenshot audit skipped; noted in report |
| No proposal (pricing) | Pricing verification skipped; noted in report |
| No technical spec | Technical accuracy verification reduced |
