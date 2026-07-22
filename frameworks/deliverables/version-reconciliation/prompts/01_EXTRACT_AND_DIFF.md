# 01 — Extract and Diff

## Purpose
Validate both version files, extract structured content from each, align sections, classify all differences, and generate a bidirectional contradiction report with provenance citations.

## Execution Mode
FINDINGS_ONLY — reads both version files, extracts content, diffs, and writes analysis artifacts. Never modifies input files.

## Inputs
| Input | Required | Description |
|-------|----------|-------------|
| `version_a` | Yes | Path to first version file (.md, .docx, .pptx, .pdf) |
| `version_b` | Yes | Path to second version file (may differ in format from version_a) |
| `source_of_truth` | No | Which version is authoritative: 'a' or 'b' (default: neither) |
| `focus_sections` | No | Comma-separated section names to prioritize |

## Process

### Step 1: Validate Inputs [AUTO]
1. Confirm `version_a` exists and is a readable file
2. Confirm `version_b` exists and is a readable file
3. If either is missing, STOP and report what is needed
4. Determine file format for each version by extension:
   - `.md` — Markdown
   - `.docx` — Word document
   - `.pptx` — PowerPoint presentation
   - `.pdf` — PDF document
5. Record whether this is a same-format or cross-format comparison
6. If cross-format, note the alignment strategy required (see guardrails.md#cross-format)
7. Flag concerns: files >10MB, unsupported formats, password-protected files, empty files

### Step 2: Extract Version A Content [AUTO]
1. Read the full content of version_a
2. For .pptx files:
   - Use python-pptx if available; fall back to Read tool
   - Extract EVERY slide: title, body text, bullet points, tables, images (references)
   - Extract ALL speaker notes — these are first-class content per guardrails.md#speaker-notes
3. For .md files:
   - Parse heading structure (H1, H2, H3)
   - Extract all text under each heading
   - Capture code blocks, tables, and lists separately
4. For .pdf files:
   - Extract text content page by page
   - Identify section headers and body text
5. For .docx files:
   - Extract paragraph text with heading levels
   - Capture tables, lists, and footnotes
6. Build a fact index for version A:
   - **Numbers**: Every number found, with exact value and location (section/slide, line/position)
   - **Dates**: Every date reference, with exact value and location
   - **Prices**: Every monetary value, with currency and location
   - **Counts**: Every enumerated quantity (e.g., "12 deliverables")
   - **Named entities**: People, companies, products mentioned
   - **Lists**: Every bulleted or numbered list, with item count and items
   - **Tables**: Every table, with row/column counts and cell values
7. Every number MUST be captured as an indexed fact — no number is insignificant

### Step 3: Extract Version B Content [AUTO]
1. Repeat Step 2 procedure for version_b

### Step 4: Align Sections [AUTO]
1. Match sections between versions using:
   - Exact title match (highest confidence)
   - Normalized title match (case-insensitive, whitespace-normalized)
   - Fuzzy title match (>80% similarity)
   - Content similarity match (fallback for untitled sections)
2. For cross-format comparisons (e.g., .pptx vs .md):
   - Map slide titles to markdown H2 headings
   - Map slide numbers to section order
   - Document alignment method for each pair per guardrails.md#cross-format
3. Record alignment result for every section:
   - `aligned`: matched pair with alignment method and confidence
   - `unaligned_a`: section in A with no match in B
   - `unaligned_b`: section in B with no match in A

### Step 5: Classify Differences [AUTO]
1. For each aligned section pair, compare:
   - Title text
   - Body text (paragraph by paragraph or bullet by bullet)
   - Speaker notes (if present in either version)
   - Lists (item count and item content)
   - Tables (row/column counts and cell values)
   - Numbers (exact value comparison — no tolerance)
   - Dates (exact value comparison)
2. Assign each difference one of these classifications:
   - `NUMBER_MISMATCH` — Any numeric value differs (always CRITICAL per guardrails.md#number-mismatch)
   - `TEXT_DIFFERS` — Non-numeric text content differs between versions
   - `ADDED_IN_A` — Content present in version A but absent from version B
   - `ADDED_IN_B` — Content present in version B but absent from version A
   - `STRUCTURE_DIFFERS` — Same content but different structural representation (bullet vs paragraph, table vs list)
   - `ORDER_DIFFERS` — Same content items but in different order
3. Apply severity per guardrails.md#severity-classification:
   - `NUMBER_MISMATCH` -> CRITICAL
   - `ADDED_IN_A` or `ADDED_IN_B` -> MAJOR
   - `TEXT_DIFFERS` -> MINOR (unless numbers are embedded, then CRITICAL)
   - `STRUCTURE_DIFFERS` -> MINOR
   - `ORDER_DIFFERS` -> MINOR
4. If `focus_sections` was provided, mark those sections with `"prioritized": true`

### Step 6: Apply Provenance Check [AUTO]
1. For every contradiction, verify and cite the exact location in BOTH versions:
   - Version A location: file path, section/slide, line/position, exact quoted text
   - Version B location: file path, section/slide, line/position, exact quoted text
2. For items present in only one version:
   - Cite the exact location where the item appears
   - Confirm its absence in the other version (search for related terms)
3. Cross-reference the fact index from extraction to ensure no facts were missed
4. Flag any contradictions where provenance cannot be fully established

### Step 7: Generate Outputs [AUTO]
1. Write `reconciliation_output/CONTRADICTION_REPORT.md` with the following structure:

```markdown
# Contradiction Report

## Overview
- Version A: [path] ([format])
- Version B: [path] ([format])
- Comparison type: [same_format|cross_format]
- Source of truth: [A|B|Neither]
- Generated: [ISO-8601]

## Summary
| Severity | Count |
|----------|-------|
| CRITICAL | N |
| MAJOR    | N |
| MINOR    | N |
| INFO     | N |
| **Total**| **N** |

## Critical Findings
[All CRITICAL items listed first with full provenance]

## Version A Has, Version B Lacks
[Grouped by section, with provenance citations]

## Version B Has, Version A Lacks
[Grouped by section, with provenance citations]

## Both Have, Values Differ
[Grouped by section, with side-by-side values and provenance]

## Open Questions for Review
[Items requiring human judgment]
```

2. Write `reconciliation_output/reconciliation_summary.json`:

```json
{
  "version_a": {"path": "...", "format": "..."},
  "version_b": {"path": "...", "format": "..."},
  "comparison_type": "same_format|cross_format",
  "source_of_truth": "a|b|none",
  "generated_at": "ISO-8601",
  "severity_counts": {"CRITICAL": 0, "MAJOR": 0, "MINOR": 0, "INFO": 0, "total": 0},
  "classification_counts": {"NUMBER_MISMATCH": 0, "TEXT_DIFFERS": 0, "ADDED_IN_A": 0, "ADDED_IN_B": 0, "STRUCTURE_DIFFERS": 0, "ORDER_DIFFERS": 0},
  "critical_findings": [
    {
      "description": "...",
      "version_a_value": "...",
      "version_a_location": "...",
      "version_b_value": "...",
      "version_b_location": "...",
      "authoritative_value": "... (if source_of_truth set)"
    }
  ],
  "a_not_in_b": [
    {
      "section": "...",
      "description": "...",
      "location": "...",
      "severity": "MAJOR"
    }
  ],
  "b_not_in_a": [
    {
      "section": "...",
      "description": "...",
      "location": "...",
      "severity": "MAJOR"
    }
  ],
  "sections_with_contradictions": ["section names"],
  "sections_clean": ["section names with no differences"],
  "open_questions": ["items requiring human judgment"]
}
```

3. If `source_of_truth` is designated, add an "Authoritative Value" field to each contradiction

## Output
- `reconciliation_output/CONTRADICTION_REPORT.md`
- `reconciliation_output/reconciliation_summary.json`

## Success Criteria
- Both files validated as readable with formats correctly detected
- All sections/slides from both versions extracted and represented
- Speaker notes extracted for all .pptx slides
- Every number captured as an indexed fact
- All sections accounted for (aligned or unaligned)
- Every difference classified with correct severity
- All NUMBER_MISMATCH items classified as CRITICAL
- Bidirectional reporting: A-not-in-B and B-not-in-A both present
- Every contradiction cites exact location in both versions
- Provenance verified for all findings
- Cross-format alignment decisions documented (if applicable)
- Observational reporting only — no forbidden labels per guardrails.md#forbidden-labels

## Failure Modes
| Condition | Action |
|-----------|--------|
| version_a does not exist | STOP; report error, ask for correct path |
| version_b does not exist | STOP; report error, ask for correct path |
| Unsupported file format | STOP; report supported formats (.md, .docx, .pptx, .pdf) |
| Password-protected file | STOP; report that file cannot be read without password |
| File is empty (0 bytes) | WARN; proceed but flag for user review |
| File exceeds 10MB | WARN; note chunked processing may be needed |
| .pptx cannot be read by python-pptx | Try Read tool; if that fails, try ZIP extraction per guardrails |
| .pdf text extraction produces garbled output | WARN; include raw content, flag for manual review |
| Section produces empty extraction | WARN; log the section, continue with remaining sections |
| Speaker notes cannot be extracted | WARN; flag prominently — speaker notes are first-class content |
| No sections can be aligned | WARN; report all sections as unaligned, proceed with full ADDED_IN_A / ADDED_IN_B |
| Alignment ambiguity (multiple candidates) | Use best match, flag with alignment_confidence: low |
| Provenance cannot be verified for a contradiction | Include with `provenance_status: unverified` flag |
