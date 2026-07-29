---
description: Forge a grimoire — create a new framework from scratch or from an example
argument-hint: [framework-path-or-name]
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

> Authority: `new-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Forge a new grimoire (framework) by invoking the `manage-frameworks` essence (skill) with the `create-framework` workflow.
</objective>

<process>
1. Parse $ARGUMENTS for grimoire path or name. If missing, prompt the user.
2. Read and follow the essence workflow:

@.claude/skills/manage-frameworks/SKILL.md

Follow the `create-framework` workflow.
</process>

<success_criteria>
- Grimoire directory created with all required files
- manifest.json (stat block), guardrails.md, and prompt chain initialized
- Grimoire registered in Mythos
</success_criteria>
