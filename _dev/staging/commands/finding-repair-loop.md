---
description: Coordinator-facing — close one distinct-family review iteration. Reads the latest reviewer-run, classifies findings, folds repairs OR routes-out OR escalates.
argument-hint: <task-id>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
audience: coordinator
status: STAGED
---

<objective>
Operator types `/finding-repair-loop <task-id>` (or coordinator skill auto-fires when a fresh reviewer-run lands for a scope with an existing state marker). Skill resolves the latest review, classifies findings, executes one of: NO_FINDINGS approval, MINOR-only inline-fix-and-approve, MAJOR repair-fold + re-dispatch, or escalate.

Replaces 4-6 turns of coordinator narration per workstream with a single bounded operation.
</objective>

<process>
Invoke @_dev/staging/skills/finding-repair-loop/SKILL.md with `TASK_ID = $1`.

Skill executes the automated_workflow steps 1-5. Operator sees the report at the end.
</process>

<success_criteria>
- Skill reports iteration N of M with branch taken
- State marker at `_dev/state/plan-task-review-state/<task-id>.json` reflects current state
- Next command is named explicitly
</success_criteria>
