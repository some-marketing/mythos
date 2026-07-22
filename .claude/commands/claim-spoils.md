---
description: Claim spoils — import successful work into a normalized capture bundle
argument-hint: --from <path> --into <project-root> --task-type <name> [--source <manual|llm|hybrid>]
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

> Authority: `capture-task` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Claim spoils (capture a task): import successful work from anywhere on disk into a structured capture bundle that can later scaffold a grimoire candidate.
</objective>

<process>
1. Parse `$ARGUMENTS` for source path, destination contract root, task type, and source mode.
2. Run the workspace capture tooling:

`npm run workspace:capture -- --from <path> --into <project-root> --task-type <name> --source <manual|llm|hybrid>`

3. Follow the `capture-task` workflow:

@.claude/skills/manage-frameworks/SKILL.md
</process>

<success_criteria>
- New spoils (capture) bundle created under `<project-root>/captures/`
- Imported evidence copied into `artifacts/imported/`
- Capture readiness summary produced
</success_criteria>
