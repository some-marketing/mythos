# 03 — Source Document Index

## Purpose
Read and index all source documents for efficient cross-referencing during the audit.

## Execution Mode
REVIEW_ONLY — reads source documents and writes `source_document_index.json` to `audit_output/`.

## Inputs
| Input | Required | Source |
|-------|----------|--------|
| `intake_manifest.json` | Yes | Output of Prompt 01 |

## Prerequisites
- Prompt 01 (INTAKE_AND_DISCOVERY) must be complete

## Process

### Step 1: Load Intake Manifest [AUTO]
Read `audit_output/intake_manifest.json` to get the list of discovered files and their roles.

### Step 2: Read Source Documents [AUTO]
For each file classified as a key document (slide_content_spec, project_scope, proposal, technical_spec, competitor_research, errata):

1. Read the full file content
2. Extract key facts into an indexed structure:
   - **Pricing**: Any dollar amounts, payment schedules, pricing tiers
   - **Timeline**: Dates, durations, phase definitions, milestones
   - **Deliverables**: Named deliverables, features, scope items
   - **People**: Named individuals, roles, quotes
   - **Statistics**: Numbered claims, percentages, scores, ratings
   - **Corrections**: Items marked as changed, corrected, or "do NOT use"
   - **Screenshots**: References to specific screenshots, image placements
   - **Competitors**: Named competitor companies, URLs, comparisons

3. For each extracted fact, record:
   - `fact_text`: The exact text
   - `source_file`: Which document it came from
   - `line_number`: Where in the document
   - `category`: Which category above
   - `slide_reference`: If the fact mentions a specific slide number

### Step 3: Extract Screenshot Manifest [AUTO]
If a slide content spec exists:
1. Parse it for screenshot-to-slide mappings
2. For each screenshot entry, record:
   - `screenshot_id`: Sequence number or identifier
   - `filename`: Expected filename
   - `description`: What the screenshot should show
   - `target_slides`: Which slide(s) it should appear on
   - `annotations`: Expected annotations, highlights, callouts
   - `position`: Left, right, full, etc.

### Step 4: Extract Corrections List [AUTO]
If an errata file exists:
1. Parse all corrections/errata entries
2. For each correction, record:
   - `correction_id`: Sequence number
   - `original_value`: The incorrect/outdated value
   - `corrected_value`: What it should be changed to
   - `context`: Where in the presentation this applies
   - `source_file`: Which errata document
   - `line_number`: Where in the errata document

### Step 5: Write Source Document Index [AUTO]
Write `audit_output/source_document_index.json` with structure:
```json
{
  "documents_indexed": 0,
  "total_facts_extracted": 0,
  "facts_by_category": {
    "pricing": [],
    "timeline": [],
    "deliverables": [],
    "people": [],
    "statistics": [],
    "corrections": [],
    "screenshots": [],
    "competitors": []
  },
  "screenshot_manifest": [
    {
      "screenshot_id": 1,
      "filename": "...",
      "description": "...",
      "target_slides": [],
      "annotations": [],
      "position": "..."
    }
  ],
  "corrections_list": [
    {
      "correction_id": 1,
      "original_value": "...",
      "corrected_value": "...",
      "context": "...",
      "source_file": "...",
      "line_number": 0
    }
  ],
  "warnings": []
}
```

## Output
- `audit_output/source_document_index.json`

## Success Criteria
- All key documents read and indexed
- Facts categorized with source citations
- Screenshot manifest extracted (if slide content spec exists)
- Corrections list extracted (if errata exists)
- Valid JSON output

## Failure Modes
| Condition | Action |
|-----------|--------|
| Key document cannot be read | WARN; skip that document; note in warnings |
| No pricing found in any document | INFO; pricing verification will be skipped |
| No screenshot manifest found | WARN; screenshot audit will validate existence only, not placement |
| No corrections/errata found | INFO; corrections check will be skipped |
| Ambiguous fact extraction | Include both interpretations; flag as AMBIGUOUS |
