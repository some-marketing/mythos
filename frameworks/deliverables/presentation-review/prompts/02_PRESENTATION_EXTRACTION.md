# 02 — Presentation Extraction

## Purpose
Extract all slide content from the .pptx file into a structured JSON format for cross-referencing.

## Execution Mode
REVIEW_ONLY — reads presentation file and writes `presentation_content.json` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `PRESENTATION_FILE` | Yes | From intake manifest or user input |
| `intake_manifest.json` | Yes | Output of Prompt 01 |

## Prerequisites
- Prompt 01 (INTAKE_AND_DISCOVERY) must be complete
- `audit_output/intake_manifest.json` must exist

## Process

### Step 1: Load Intake Manifest [AUTO]
Read `audit_output/intake_manifest.json` to confirm presentation file path.

### Step 2: Extract Presentation Content [AUTO]
Using the extraction method (see `guardrails.md#pptx-extraction`):

1. Read the .pptx file
2. For each slide, extract:
   - `slide_number` (1-indexed)
   - `title` (text from title placeholder)
   - `body_text` (all non-title text, preserving structure)
   - `speaker_notes` (if present)
   - `images` (list of image references with dimensions)
   - `layout_name` (slide layout identifier)
   - `has_images` (boolean)
   - `text_length` (character count of all text on slide)

3. Record metadata:
   - `total_slides` (count)
   - `slides_with_images` (count)
   - `slides_with_notes` (count)
   - `extraction_method` (python-pptx | read-tool | xml-parse)

### Step 3: Normalize Text [AUTO]
For each slide's text content:
1. Strip excessive whitespace while preserving paragraph breaks
2. Normalize quotes (smart quotes -> straight quotes for comparison)
3. Preserve bullet points and list structure
4. Note any text that appears to be a placeholder or template variable

### Step 4: Write Presentation Content [AUTO]
Write `audit_output/presentation_content.json` with structure:
```json
{
  "presentation_file": "...",
  "extraction_method": "...",
  "metadata": {
    "total_slides": 0,
    "slides_with_images": 0,
    "slides_with_notes": 0
  },
  "slides": [
    {
      "slide_number": 1,
      "title": "...",
      "body_text": "...",
      "speaker_notes": "...",
      "images": [
        {"name": "...", "width_px": 0, "height_px": 0, "position": "..."}
      ],
      "layout_name": "...",
      "has_images": true,
      "text_length": 0
    }
  ]
}
```

## Output
- `audit_output/presentation_content.json`

## Success Criteria
- All slides extracted (count matches actual slide count)
- Text content captured for every text-containing slide
- Image references captured for every image-containing slide
- No slides skipped or duplicated
- Valid JSON output

## Failure Modes
| Condition | Action |
|-----------|--------|
| .pptx file cannot be read | Try fallback extraction methods per guardrails; if all fail, STOP |
| Slide contains only images (no text) | Record with empty title/body, note `text_length: 0` |
| Extraction produces garbled text | Flag in warnings; include raw text; proceed |
| Speaker notes missing for all slides | INFO; proceed (notes are optional) |
