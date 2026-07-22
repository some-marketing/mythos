---
description: Validate screenshots against manifest and slide placement
allowed-tools: Task, Read, Glob, Grep
---

<objective>
Verify that all screenshots exist, visually match their manifest descriptions,
have correct annotations, and are placed on the correct slides.
</objective>

<process>
1. **Verify prerequisites**
   - Check that `audit_output/presentation_content.json` exists.
   - Check that `audit_output/source_document_index.json` exists.
   - If either is missing, inform user to run `/presentation-review:extract` first. STOP.

2. **Execute screenshot audit**
   - Read the prompt: `frameworks/deliverables/presentation-review/prompts/05_SCREENSHOT_MANIFEST_AUDIT.md`
   - Follow the prompt's process exactly.
   - Delegate to the screenshot-auditor-agent if using subagents.
   - Use the Read tool for multimodal visual verification of each screenshot.

3. **Present findings**
   - Summary: present/missing/verified/orphaned counts
   - List any MAJOR findings (missing or mismatched screenshots)
   - Point to `audit_output/screenshot_findings.json` for full details
</process>

<context>
Prompt: `frameworks/deliverables/presentation-review/prompts/05_SCREENSHOT_MANIFEST_AUDIT.md`
Guardrails: `frameworks/deliverables/presentation-review/guardrails.md#evidence-standards`
Mode: REVIEW_ONLY
</context>

<success_criteria>
- screenshot_findings.json written with every manifest entry checked
- Visual verification performed on all existing screenshots
- Orphaned files identified
- All findings have evidence citations
</success_criteria>
