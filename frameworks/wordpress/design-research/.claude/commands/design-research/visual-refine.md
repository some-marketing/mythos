---
description: CSS/HTML visual refinement via Gemini handoff with brand token validation
argument-hint: "<export|import> [mockup-file] [element]"
allowed-tools: Task
---

<objective>
Facilitate iterative CSS/HTML visual refinement using Gemini by invoking the
`design-research/visual-refine` skill. Extends cross-ai-handoff with CSS-specific
context, the 6-step SOP, and mockup audit integration.
</objective>

<process>
1. **Parse arguments**
   - Extract phase (`export` or `import`), mockup file, and element from `$ARGUMENTS`.
   - If phase is missing, prompt the user.

2. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/visual-refine/SKILL.md`
   - Read the base pattern: `frameworks/wordpress/design-research/.claude/skills/design-research/cross-ai-handoff/SKILL.md`
   - For export: extract CSS context, capture screenshot, package with SOP step.
   - For import: validate tokens, apply to mockup, rebuild preview, run audit, sync spec.

3. **Deliver results**
   - For export: present handoff package paths and Gemini instructions.
   - For import: report validation, audit results, and spec sync status.
</process>

<success_criteria>
- Exports include full CSS context (tokens, parent, SOP step, spec values)
- Imports preserve all brand tokens
- Mockup audit passes after import
- Spec document synced if values changed
- Complete audit trail in _handoffs/
</success_criteria>
