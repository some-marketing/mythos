---
description: Appraise a grimoire — validate a framework's structure, prompt chain, and guardrails
argument-hint: <framework-path>
allowed-tools: [Read, Glob, Grep]
---

> Authority: `audit-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Appraise a grimoire (validate a framework's structure, prompt chain, and guardrails) by invoking the `manage-frameworks` essence (skill).
</objective>

<process>
1. Parse $ARGUMENTS for grimoire path. If missing, prompt the user. When the operand is a short grimoire name rather than a path, resolve it through the alias registry (the canonical registry first, then the user overlay at `$MYTHOS_HOME/aliases.yaml`, within this command's `frameworks` domain) to a canonical `service/framework` id before acting — `resolveAlias('frameworks', <operand>)` in `tools/user/resolve-alias.cjs`.
2. Read and follow the essence workflow:

@.claude/skills/manage-frameworks/SKILL.md

Follow the `audit-framework` workflow.
</process>

<success_criteria>
- Grimoire structure validated against template
- Prompt chain continuity verified
- Guardrails coverage confirmed for all execution modes
</success_criteria>
