---
description: Audit slide content against source documents and spec
allowed-tools: Task, Read, Glob, Grep
---

<objective>
Cross-reference every slide in the extracted presentation content against
the source document index. Produces per-slide findings with severity
classification.
</objective>

<process>
1. **Verify prerequisites**
   - Check that `audit_output/presentation_content.json` exists.
   - Check that `audit_output/source_document_index.json` exists.
   - If either is missing, inform user to run `/presentation-review:extract` first. STOP.

2. **Execute slide audit**
   - Read the prompt: `frameworks/deliverables/presentation-review/prompts/04_SLIDE_CONTENT_AUDIT.md`
   - Follow the prompt's process exactly.
   - Delegate to the slide-auditor-agent if using subagents.

3. **Present findings**
   - Summary table: findings by severity
   - List any CRITICAL or MAJOR findings inline
   - Point to `audit_output/slide_findings.json` for full details
</process>

<context>
Prompt: `frameworks/deliverables/presentation-review/prompts/04_SLIDE_CONTENT_AUDIT.md`
Guardrails: `frameworks/deliverables/presentation-review/guardrails.md#observational-reporting`
Mode: REVIEW_ONLY
</context>

<success_criteria>
- slide_findings.json written with every slide audited
- Every finding has severity, category, and evidence
- Observational reporting used throughout
</success_criteria>
