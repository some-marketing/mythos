---
name: create-task
description: Create a Dart task from workspace context using the appropriate task type template
skill: dart-collaboration
mode: PATCH_ALLOWED
arguments:
  - name: context_file
    description: Path to workspace context file (optional — can create without one)
    required: false
  - name: type
    description: "Task type: brief, design_decision, implementation, verification, investigation, documentation, owner_summary, for_grouping"
    required: false
  - name: board
    description: Dart board name (defaults to current project's board)
    required: false
---

Create a Dart task using the dart-collaboration framework.

1. Load `docs/TASK_TYPES.md` for the task type templates and decision table
2. If `context_file` is provided, read it to inform the task content
3. If `type` is not specified, infer it from context or ask the user
4. Generate title and description using the appropriate template
5. Present to user for confirmation before creating
6. Create via `mcp__Dart__create_task`
7. Update `tasks/index.json` with the new entry

For multi-person client deliverables (2+ contributors, or 1 contributor with a distinct owner audience), do NOT create a single task. Route to the Owner-Summary workspace-tree path: emit the 3-level `tasks/` workspace (`owner_summary` parent + `for_grouping` per contributor + implementation children + nested `index.json`) and defer creation to `tools/dart-integration/create-tasks-from-workspace.js`. The `owner_summary` and `for_grouping` types are the tree's parent/grouping layers — they are built by the tool, not hand-created via single-task `create_task`. See `prompts/01_TASK_FROM_CONTEXT.md` (Steps 1b/1c).

Follow `guardrails.md` — never create without confirmation.
