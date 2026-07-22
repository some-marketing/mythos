# 04 — Slide Content Audit

## Purpose
Cross-reference every slide in the presentation against the slide content spec and source documents. This is the core audit step.

## Execution Mode
REVIEW_ONLY — reads extracted content and index, writes `slide_findings.json` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `presentation_content.json` | Yes | Output of Prompt 02 |
| `source_document_index.json` | Yes | Output of Prompt 03 |
| `intake_manifest.json` | Yes | Output of Prompt 01 |

## Prerequisites
- Prompts 01, 02, and 03 must be complete

## Parallelization
This prompt can run in PARALLEL with Prompts 05 and 06.

## Process

### Step 1: Load Artifacts [AUTO]
Read all three input artifacts from `audit_output/`.

### Step 2: Audit Each Slide [AUTO]
For each slide in `presentation_content.json`:

#### 2a. Title Check
- Compare slide title against the slide content spec
- Record: MATCH, DIFFERENT (with both values), or MISSING_FROM_SPEC

#### 2b. Content Verification
- For each factual claim on the slide:
  1. Search `source_document_index.json` for corroborating facts
  2. If found: verify exact match vs paraphrase vs contradiction
  3. If not found: flag as UNVERIFIED (may be original copy, not necessarily wrong)
- Check specific categories:
  - **Pricing**: Do dollar amounts match the proposal?
  - **Timeline**: Do dates, durations, phases match the scope doc?
  - **Statistics**: Do numbers, percentages, scores match source docs?
  - **Quotes**: Are attributed quotes exact matches?
  - **Deliverables**: Are listed deliverables consistent with scope?

#### 2c. Spec Completeness
- Check if all content specified for this slide (in the slide content spec) is present
- Flag any spec'd content that's missing from the slide
- Flag any slide content not in the spec (may be intentional additions)

#### 2d. Image Check
- Does the slide have the correct number of images per spec?
- Are image references consistent with the screenshot manifest?
- Note: visual verification of images happens in Prompt 05

#### 2e. Assign Severity
For each finding, classify per `guardrails.md#severity-classification`:
- CRITICAL: Factual error, wrong price, contradicts source
- MAJOR: Missing spec'd content, missing required image
- MINOR: Wording difference, layout variance
- INFO: Extra content, style observation

### Step 3: Narrative Arc Check [AUTO]
If the slide content spec defines a narrative structure (acts, sections, story flow):
1. Verify slides follow the specified narrative order
2. Check that transitional slides bridge correctly between sections
3. Note any structural deviations

### Step 4: Write Slide Findings [AUTO]
Write `audit_output/slide_findings.json` with structure:
```json
{
  "total_slides": 0,
  "slides_audited": 0,
  "finding_counts": {
    "CRITICAL": 0,
    "MAJOR": 0,
    "MINOR": 0,
    "INFO": 0,
    "PASS": 0
  },
  "slides": [
    {
      "slide_number": 1,
      "slide_title": "...",
      "overall_status": "PASS | ISSUE",
      "findings": [
        {
          "finding_id": "S01-F01",
          "severity": "CRITICAL | MAJOR | MINOR | INFO",
          "category": "content | pricing | timeline | statistics | quote | deliverable | image | narrative",
          "observation": "...",
          "expected": "...",
          "actual": "...",
          "evidence": [
            {"source": "...", "location": "...", "text": "..."}
          ],
          "hypothesis": "... (optional)"
        }
      ]
    }
  ],
  "narrative_arc": {
    "specified": true,
    "structure": "...",
    "compliance": "MATCH | DEVIATION",
    "notes": "..."
  }
}
```

## Output
- `audit_output/slide_findings.json`

## Success Criteria
- Every slide has been audited (slides_audited == total_slides)
- Every finding has a severity, category, and at least one evidence citation
- No factual claims left unverified without being flagged
- Pricing, timeline, and deliverables explicitly checked
- Finding IDs are unique and sequential

## Failure Modes
| Condition | Action |
|-----------|--------|
| No slide content spec available | Audit against scope/proposal only; note reduced coverage |
| Slide has no text content | Record as INFO finding; check if image-only is per spec |
| Contradictory facts in source documents | Flag both sources; record as AMBIGUOUS; do not resolve |
| Cannot determine intended slide content | Record as UNKNOWN; flag for manual review |
