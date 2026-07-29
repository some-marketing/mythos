---
description: Refine spoils — validate and normalize a capture bundle
argument-hint: <capture-root>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

> Authority: `normalize-capture` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Refine spoils (normalize a capture): check whether a capture bundle has enough structured evidence to be marked ready for candidate scaffolding.
</objective>

<process>
1. Parse `$ARGUMENTS` for `<capture-root>`.
2. Run:

`npm run workspace:capture:normalize -- --capture <capture-root>`

3. Follow the `normalize-capture` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>

<success_criteria>
- Capture metadata updated with normalization status
- `NORMALIZATION_REPORT.md` created
- Missing required items clearly listed if the capture is incomplete
</success_criteria>
