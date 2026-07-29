# 01 — Intake and Discovery

## Purpose
Validate inputs, discover directory structure, identify and classify all source documents in the project directory.

## Execution Mode
REVIEW_ONLY — reads project directory and writes `intake_manifest.json` to `audit_output/`.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `PROJECT_DIR` | Yes | Path to project directory containing source documents and screenshots |
| `PRESENTATION_FILE` | Yes | Path to .pptx file (may be within PROJECT_DIR or separate) |

## Process

### Step 1: Validate Inputs [AUTO]
1. Confirm `PROJECT_DIR` exists and is a directory
2. Confirm `PRESENTATION_FILE` exists and is a .pptx file
3. If either is missing, STOP and report what's needed

### Step 2: Inventory Project Directory [AUTO]
1. Recursively list all files in `PROJECT_DIR`
2. Classify each file into one of these roles:
   - `slide_content_spec` — Markdown defining intended slide content and screenshot placement
   - `project_scope` — Full project scope document
   - `proposal` — Client-facing proposal (with or without pricing)
   - `technical_spec` — Technical specification (stack, CPTs, plugins, etc.)
   - `competitor_research` — Competitor analysis or inspiration research
   - `errata` — Corrections, build instructions, or prompt errata
   - `screenshot` — Image file (PNG, JPG) used as presentation evidence
   - `presentation` — The .pptx file itself or a markdown export of it
   - `supporting` — Scripts, logs, scraped content, meeting notes
   - `unknown` — Cannot be classified

3. Classification heuristics:
   - Read the first 50 lines of each markdown/text file
   - Look for keywords: "scope", "proposal", "pricing", "technical", "competitor", "correction", "errata", "slide"
   - Screenshots: files in a `Screenshots/` subdirectory or image files with descriptive names
   - Errata: files referencing corrections, "do NOT use", "changed from X to Y"

### Step 3: Identify Key Documents [AUTO]
1. From classified files, identify:
   - **Primary slide spec**: The document that defines what each slide should contain
   - **Primary scope doc**: The authoritative source for project facts
   - **Errata file**: The document containing corrections that must be applied
   - **Screenshot directory**: Where presentation screenshots live
   - **Proposal**: Document with pricing and deliverables
2. If any critical document cannot be identified, flag as `MISSING` (not a blocker — proceed with what's available)

### Step 4: Screenshot Inventory [AUTO]
1. List all image files in the project directory (recursive)
2. For each screenshot, record: filename, path, file size, dimensions (if determinable)
3. Check if a screenshot manifest exists (often embedded in the slide content spec)

### Step 5: Write Intake Manifest [AUTO]
Write `audit_output/intake_manifest.json` with structure:
```json
{
  "project_directory": "...",
  "presentation_file": "...",
  "discovered_files": [
    {"path": "...", "role": "...", "size_bytes": 0, "line_count": 0}
  ],
  "key_documents": {
    "slide_content_spec": "path or null",
    "project_scope": "path or null",
    "proposal": "path or null",
    "technical_spec": "path or null",
    "competitor_research": "path or null",
    "errata": "path or null"
  },
  "screenshots": [
    {"filename": "...", "path": "...", "size_bytes": 0}
  ],
  "screenshot_directory": "path or null",
  "warnings": ["any issues discovered during intake"]
}
```

## Output
- `audit_output/intake_manifest.json`

## Success Criteria
- All files in PROJECT_DIR inventoried and classified
- Key documents identified (or flagged as missing)
- All screenshots catalogued
- Intake manifest written with no JSON syntax errors

## Failure Modes
| Condition | Action |
|-----------|--------|
| PROJECT_DIR does not exist | STOP; report error |
| PRESENTATION_FILE does not exist | STOP; report error |
| No markdown files found in PROJECT_DIR | WARN; proceed (presentation can still be audited against itself) |
| No screenshots found | WARN; skip screenshot audit steps later |
| No slide content spec found | WARN; audit will compare presentation against scope/proposal only |
| No errata file found | INFO; corrections check will be skipped |
