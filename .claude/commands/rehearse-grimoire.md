---
description: Rehearse a grimoire — run replay-readiness checks for a framework candidate
argument-hint: <candidate-root> [--case <case-id|all>]
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

> Authority: `replay-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Rehearse a grimoire: execute replay-readiness checks for one or more candidate replay cases and update the candidate summary. Passing rehearsal is what earns a grimoire the Gold rank (proven safe to repeat unattended).
</objective>

<process>
1. Parse `$ARGUMENTS` for `<candidate-root>` and optional replay case selector.
2. Run:

`npm run workspace:candidate:replay -- --candidate <candidate-root> --case <case-id|all>`

3. Follow the `replay-framework` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>
