---
description: Package context for external AI systems and ingest validated responses
argument-hint: "<export|import> [context-path]"
allowed-tools: [Read, Write, Edit, Grep, Glob]
---

<objective>
Enable structured collaboration with external AI systems (Gemini, ChatGPT) via copy-paste
handoff by invoking the `design-research/cross-ai-handoff` skill.
</objective>

<process>
1. **Parse arguments**
   - Extract phase (`export` or `import`) and optional context path from `$ARGUMENTS`.
   - If phase is missing, prompt the user.

2. **Invoke the skill**
   - Read the skill definition: `frameworks/wordpress/design-research/.claude/skills/design-research/cross-ai-handoff/SKILL.md`
   - For export: follow the export workflow (collect context, package prompt, write files).
   - For import: follow the import workflow (parse response, validate boundaries, apply changes).

3. **Deliver results**
   - Present file paths for export package or applied changes.
   - Report validation results for imports.
</process>

<success_criteria>
- Exports are self-contained and copy-pasteable with no credentials
- Imports validated against export boundaries before applying
- Complete audit trail in _handoffs/ directory
</success_criteria>
