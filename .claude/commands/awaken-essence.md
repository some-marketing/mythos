---
description: Awaken an essence — extract a reusable skill from the current conversation's workflow
argument-hint: [skill-name]
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

> Authority: `extract-skill` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Awaken an essence (extract a skill): analyze the current conversation to identify a repeatable workflow, then generate the full Mythos artifact set (SKILL.md, command, familiar/agent, verification script, manifest updates) by invoking the `extract-skill` essence.
</objective>

<process>
1. If $ARGUMENTS contains a skill name, use it as the suggested name. When the operand names an existing essence, resolve it through the alias registry (the canonical registry first, then the user overlay at `$MYTHOS_HOME/aliases.yaml`, within this command's `skills` domain) to a canonical skill id before acting — `resolveAlias('skills', <operand>)` in `tools/user/resolve-alias.cjs` (e.g. `manage-grimoires` resolves to `manage-frameworks`).
2. Read and follow the essence workflow:

@.claude/skills/extract-skill/SKILL.md

Follow the full automated workflow from step 1 through step 11.
</process>

<success_criteria>
- Workflow extracted accurately from conversation context
- All artifacts generated (SKILL.md, command, optional familiar/agent, optional verification script)
- Artifacts pass `node tools/verify/verify-skill.cjs` validation
- Manifest updated with new entries
- User confirmed workflow before generation
</success_criteria>
