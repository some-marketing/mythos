---
description: Generate completed Perplexity research prompt from intake data
argument-hint: <project-slug>
allowed-tools: [Read, Write, Glob, Grep]
---

<objective>
Generate a completed Perplexity AI research prompt from intake data by invoking the `design-research` skill with the `generate` workflow.
</objective>

<context>
- Skill: `frameworks/wordpress/design-research/.claude/skills/design-research/SKILL.md`
- Prompt template: `frameworks/wordpress/design-research/prompts/02_RESEARCH_PROMPT.md`
- Variable guide: `frameworks/wordpress/design-research/docs/VARIABLE_GUIDE.md`
- Guardrails: `frameworks/wordpress/design-research/guardrails.md`
</context>

<process>
1. Parse $ARGUMENTS for project slug. If missing, list available projects and prompt user.
2. Read the skill at `frameworks/wordpress/design-research/.claude/skills/design-research/SKILL.md` and follow the generate workflow.
</process>

<success_criteria>
- Research prompt generated from intake data
- Output written to project directory
</success_criteria>
