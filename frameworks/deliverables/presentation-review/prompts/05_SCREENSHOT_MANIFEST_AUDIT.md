# 05 — Screenshot Manifest Audit

## Purpose
Validate that all screenshots exist, match their manifest descriptions, are correctly annotated, and are placed on the correct slides.

## Execution Mode
REVIEW_ONLY — reads screenshots (multimodal), manifest, and presentation content; writes `screenshot_findings.json` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `presentation_content.json` | Yes | Output of Prompt 02 |
| `source_document_index.json` | Yes | Output of Prompt 03 (contains screenshot_manifest) |
| `intake_manifest.json` | Yes | Output of Prompt 01 (contains screenshot inventory) |
| Screenshot files | Yes | Physical image files in the project directory |

## Prerequisites
- Prompts 01, 02, and 03 must be complete

## Parallelization
This prompt can run in PARALLEL with Prompts 04 and 06.

## Process

### Step 1: Load Artifacts [AUTO]
Read all three input artifacts from `audit_output/`.
Extract:
- `screenshot_manifest` from source_document_index.json
- `screenshots` list from intake_manifest.json
- Image references from presentation_content.json slides

### Step 2: Existence Check [AUTO]
For each entry in the screenshot manifest:
1. Check if the expected file exists in the screenshot directory
2. Record: PRESENT or MISSING
3. Note any screenshots in the directory that are NOT in the manifest (orphaned files)

### Step 3: Visual Verification [AUTO]
For each screenshot that exists:
1. Read the image file using the Read tool (multimodal visual analysis)
2. Compare what the image shows against the manifest description
3. Check for required annotations:
   - Highlights, circles, arrows mentioned in the manifest
   - Text annotations or callouts
   - Correct branding or website shown
4. Record: VISUAL_MATCH or VISUAL_MISMATCH with details

### Step 4: Slide Placement Check [AUTO]
For each screenshot in the manifest:
1. Check which slide(s) it's assigned to in the manifest
2. Check if the presentation has image references on those slides
3. Check position (left, right, full) if specified in manifest
4. Record: PLACED_CORRECTLY, WRONG_SLIDE, NOT_PLACED, or CANNOT_VERIFY

### Step 5: Write Screenshot Findings [AUTO]
Write `audit_output/screenshot_findings.json` with structure:
```json
{
  "total_in_manifest": 0,
  "total_in_directory": 0,
  "verified": 0,
  "missing": 0,
  "mismatched": 0,
  "orphaned": 0,
  "findings": [
    {
      "finding_id": "SS-01",
      "screenshot_id": 1,
      "filename": "...",
      "manifest_description": "...",
      "existence": "PRESENT | MISSING",
      "visual_verification": "VISUAL_MATCH | VISUAL_MISMATCH | NOT_CHECKED",
      "visual_notes": "...",
      "annotations_present": ["..."],
      "annotations_expected": ["..."],
      "annotations_status": "COMPLETE | PARTIAL | MISSING",
      "target_slides": [3],
      "placement_status": "PLACED_CORRECTLY | WRONG_SLIDE | NOT_PLACED | CANNOT_VERIFY",
      "severity": "MAJOR | MINOR | INFO",
      "evidence": "..."
    }
  ],
  "orphaned_files": [
    {"filename": "...", "path": "..."}
  ],
  "summary": {
    "all_present": true,
    "all_verified": true,
    "all_placed": true
  }
}
```

## Output
- `audit_output/screenshot_findings.json`

## Success Criteria
- Every manifest entry checked for existence
- Every existing screenshot visually verified
- Every screenshot checked for correct slide placement
- Orphaned files identified
- All findings have severity and evidence

## Failure Modes
| Condition | Action |
|-----------|--------|
| No screenshot manifest available | Check existence only; skip placement/annotation checks |
| Image file cannot be read | Record as UNREADABLE; severity MAJOR |
| Manifest describes screenshot differently than visual shows | Record as VISUAL_MISMATCH; include both descriptions |
| Cannot determine slide placement from .pptx extraction | Record as CANNOT_VERIFY; note extraction limitation |
