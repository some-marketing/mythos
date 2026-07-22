---
name: format
description: Format audited feedback into task list
skill: feedback-to-tasks
mode: PATCH_ALLOWED
arguments:
  - name: destination_format
    description: "Output format: 'markdown', 'json', or 'github-issues'"
    required: true
  - name: task_prefix
    description: Prefix for task IDs (e.g., 'CLIENTB' for CLIENTB-001)
    required: false
---

Format audited feedback into a task list.

1. Load all prior artifacts from `task_output/`
2. Generate task list with: ID, title, description, provenance citation, priority, ambiguity flags
3. Present to user for review
4. Write `task_output/TASK_LIST.md` and `task_compilation_summary.json`

No action inference — feedback becomes review items, not prescribed changes.
