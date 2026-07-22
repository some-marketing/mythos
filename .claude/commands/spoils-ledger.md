---
description: Spoils ledger — report capture readiness and missing fields
argument-hint: <capture-root>
allowed-tools: [Read, Glob, Grep, Bash]
---

> Authority: `capture-status` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Read the spoils ledger (capture status): show whether a capture bundle is ready to scaffold from and what is still missing if it is not.
</objective>

<process>
1. Parse `$ARGUMENTS` for `<capture-root>`.
2. Run:

`npm run workspace:capture:status -- --capture <capture-root>`

3. Follow the `capture-status` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>
