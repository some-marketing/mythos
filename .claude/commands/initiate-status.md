---
description: Initiate status — report a framework candidate's maturity and promotion blockers
argument-hint: <candidate-root>
allowed-tools: [Read, Glob, Grep, Bash]
---

> Authority: `candidate-status` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Report the initiate's standing: the current replay summary, sanitization blockers, and promotion (rank-up) readiness for a framework candidate (a grimoire at rank Iron).
</objective>

<process>
1. Parse `$ARGUMENTS` for `<candidate-root>`.
2. Run:

`npm run workspace:candidate:status -- --candidate <candidate-root>`

3. Follow the `candidate-status` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>
