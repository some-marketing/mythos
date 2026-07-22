# 06 — Corrections and Errata Check

## Purpose
Verify that all corrections and errata from the errata document have been correctly applied in the presentation.

## Execution Mode
REVIEW_ONLY — reads presentation content and corrections list; writes `corrections_findings.json` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `presentation_content.json` | Yes | Output of Prompt 02 |
| `source_document_index.json` | Yes | Output of Prompt 03 (contains corrections_list) |

## Prerequisites
- Prompts 02 and 03 must be complete

## Parallelization
This prompt can run in PARALLEL with Prompts 04 and 05.

## Skip Condition
If `source_document_index.json` contains an empty `corrections_list`, this prompt produces a minimal output noting "no corrections to check" and exits.

## Process

### Step 1: Load Artifacts [AUTO]
Read `presentation_content.json` and `source_document_index.json` from `audit_output/`.
Extract the `corrections_list` array.

### Step 2: Check Each Correction [AUTO]
For each correction in the list:

1. **Identify Target**: Determine which slide(s) the correction applies to
   - Use `context` field from the correction entry
   - Search presentation text for the `original_value`
   - Search presentation text for the `corrected_value`

2. **Verify Application**:
   - If `original_value` is NOT found AND `corrected_value` IS found: **APPLIED**
   - If `original_value` IS found AND `corrected_value` is NOT found: **NOT_APPLIED**
   - If both are found (different slides): **PARTIALLY_APPLIED** — flag which slides still have the old value
   - If neither is found: **CANNOT_VERIFY** — the relevant content may not be in the presentation

3. **Record Evidence**:
   - Which slide(s) were checked
   - Exact text found (or not found)
   - The correction source (errata file and line number)

### Step 3: Check for "Do NOT Use" Items [AUTO]
Some errata specify content that must NOT appear (e.g., outdated statistics, wrong dates):
1. Search entire presentation text for each prohibited item
2. If found: record as NOT_APPLIED with severity MAJOR
3. If not found: record as APPLIED (the prohibited content was correctly omitted)

### Step 4: Write Corrections Findings [AUTO]
Write `audit_output/corrections_findings.json` with structure:
```json
{
  "total_corrections": 0,
  "applied": 0,
  "not_applied": 0,
  "partially_applied": 0,
  "cannot_verify": 0,
  "findings": [
    {
      "finding_id": "CR-01",
      "correction_id": 1,
      "correction_type": "value_change | content_removal | content_addition | phrasing_change",
      "original_value": "...",
      "corrected_value": "...",
      "status": "APPLIED | NOT_APPLIED | PARTIALLY_APPLIED | CANNOT_VERIFY",
      "slides_checked": [3, 6],
      "slides_with_old_value": [],
      "slides_with_new_value": [3],
      "severity": "MAJOR | MINOR",
      "evidence": {
        "correction_source": "...",
        "correction_line": 0,
        "presentation_text": "...",
        "slide_number": 0
      }
    }
  ],
  "prohibited_items": [
    {
      "item": "...",
      "found_in_presentation": false,
      "status": "APPLIED | NOT_APPLIED",
      "slides_found_on": []
    }
  ],
  "summary": {
    "all_applied": true,
    "compliance_rate": "7/7"
  }
}
```

## Output
- `audit_output/corrections_findings.json`

## Success Criteria
- Every correction in the list has been checked
- Every "do NOT use" item has been searched for
- Each finding has clear APPLIED/NOT_APPLIED status
- Evidence citations for all findings
- Compliance rate calculated

## Failure Modes
| Condition | Action |
|-----------|--------|
| No corrections list available | Write minimal output: `{"total_corrections": 0, "findings": [], "summary": {"note": "No errata file found"}}` |
| Correction context is ambiguous | Search all slides; report all matches; flag as needs manual review |
| Original and corrected values are very similar | Use exact string matching; note near-matches for manual verification |
