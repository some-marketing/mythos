---
description: Empower a grimoire — improve a framework based on execution feedback
argument-hint: <framework-path>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Agent]
---

> Authority: `improve-framework` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Empower a grimoire (improve a framework based on execution feedback) by invoking the `manage-frameworks` essence (skill).
</objective>

<process>
1. Parse $ARGUMENTS for grimoire path. If missing, prompt the user.
2. Read and follow the essence workflow:

@.claude/skills/manage-frameworks/SKILL.md

Follow the `improve-framework` workflow.
</process>

<success_criteria>
- Execution outputs analyzed for improvement opportunities
- Grimoire files updated based on findings
- Changes preserve prompt chain continuity
</success_criteria>
