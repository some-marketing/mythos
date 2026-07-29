---
description: Collect client info for design research prompt generation
argument-hint: [client-name]
allowed-tools: [Read, Write, Glob, Grep]
---

<objective>
Collect client information for design research prompt generation by invoking the `design-research` skill with the `intake` workflow.
</objective>

<context>
- Skill: `frameworks/wordpress/design-research/.claude/skills/design-research/SKILL.md`
- Variable guide: `frameworks/wordpress/design-research/docs/VARIABLE_GUIDE.md`
- Intake schema: `frameworks/wordpress/design-research/schemas/intake.schema.json`
- Guardrails: `frameworks/wordpress/design-research/guardrails.md`
</context>

<process>
1. Parse $ARGUMENTS for client name. If missing, prompt the user.
2. Read the skill at `frameworks/wordpress/design-research/.claude/skills/design-research/SKILL.md` and follow the intake workflow.
</process>

<success_criteria>
- Client information collected and validated
- Intake data written to project directory
</success_criteria>
