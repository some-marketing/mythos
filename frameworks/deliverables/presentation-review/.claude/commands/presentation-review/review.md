---
description: Full end-to-end presentation audit against project plan documents
argument-hint: "[presentation-file] [project-directory]"
allowed-tools: Task, Read, Glob, Grep
---

<objective>
Run a complete presentation review by executing the full 8-prompt chain:
discovery, extraction, indexing, slide audit, screenshot audit, corrections check,
gap analysis, and report assembly. Produces a structured AUDIT_REPORT.md.
</objective>

<process>
1. **Parse arguments**
   - Extract `presentation-file` and `project-directory` from `$ARGUMENTS`.
   - If either is missing, prompt the user interactively.

2. **Execute the skill workflow**
   - Read the skill definition: `frameworks/deliverables/presentation-review/.claude/skills/presentation-review/SKILL.md`
   - Follow the `review` automated_workflow exactly.
   - The workflow handles all 8 prompts in sequence (with parallel steps 04-06).

3. **Delegate to agents**
   - Use the discovery-agent for Prompt 01
   - Use the extraction-agent for Prompts 02-03
   - Use the slide-auditor-agent for Prompt 04
   - Use the screenshot-auditor-agent for Prompt 05
   - Run Prompt 06 (corrections check) inline (lightweight)
   - Use the report-agent for Prompts 07-08

4. **Present results**
   - Display the overall verdict and key metrics
   - Point user to `audit_output/AUDIT_REPORT.md` for full details
   - List any CRITICAL or MAJOR findings inline
</process>

<context>
Skill definition: `frameworks/deliverables/presentation-review/.claude/skills/presentation-review/SKILL.md`
Guardrails: `frameworks/deliverables/presentation-review/guardrails.md`
Prompt chain: `frameworks/deliverables/presentation-review/prompts/`
Mode: REVIEW_ONLY — no input files modified.
</context>

<success_criteria>
- All 8 prompts executed successfully
- audit_output/ contains all 10 expected artifacts
- AUDIT_REPORT.md includes every slide and all finding streams
- No input files were modified
- Findings use observational reporting (no recommendations or root causes)
</success_criteria>
