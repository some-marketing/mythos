---
description: Extract presentation content and index source documents
argument-hint: "[presentation-file]"
allowed-tools: Task, Read, Glob, Grep
---

<objective>
Extract all slide content from a .pptx file into structured JSON and index
all source documents in the project directory. This is the prerequisite step
for running slide or screenshot audits independently.
</objective>

<process>
1. **Parse arguments**
   - Extract `presentation-file` from `$ARGUMENTS`.
   - If missing, prompt the user interactively.
   - Use the presentation file's parent directory as the project directory.

2. **Run discovery if needed**
   - Check if `audit_output/intake_manifest.json` exists.
   - If not, run Prompt 01 (INTAKE_AND_DISCOVERY) first.

3. **Execute extraction**
   - Read the prompt: `frameworks/deliverables/presentation-review/prompts/02_PRESENTATION_EXTRACTION.md`
   - Extract all slides into `presentation_content.json`
   - Read the prompt: `frameworks/deliverables/presentation-review/prompts/03_SOURCE_DOCUMENT_INDEX.md`
   - Index source documents into `source_document_index.json`

4. **Report summary**
   - Total slides extracted
   - Total source documents indexed
   - Facts extracted by category
   - Screenshot manifest entries found
   - Corrections/errata entries found
</process>

<context>
Prompts: `frameworks/deliverables/presentation-review/prompts/01_INTAKE_AND_DISCOVERY.md`,
         `frameworks/deliverables/presentation-review/prompts/02_PRESENTATION_EXTRACTION.md`,
         `frameworks/deliverables/presentation-review/prompts/03_SOURCE_DOCUMENT_INDEX.md`
Mode: REVIEW_ONLY
</context>

<success_criteria>
- presentation_content.json written with all slides
- source_document_index.json written with categorized facts
- intake_manifest.json exists (created if needed)
- Summary displayed to user
</success_criteria>
