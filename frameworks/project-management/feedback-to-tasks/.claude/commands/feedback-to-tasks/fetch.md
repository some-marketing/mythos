---
name: fetch
description: Fetch raw feedback from PM tool via MCP
skill: feedback-to-tasks
mode: RUN_ONLY
arguments:
  - name: source_tool
    description: "'dart' or 'notion'"
    required: true
  - name: source_location
    description: Board name, page URL, or database ID
    required: true
---

Fetch raw feedback without processing.

1. Connect to source tool via MCP
2. Fetch all feedback items (comments, tasks, annotations)
3. For each: record author, timestamp, content, parent item, thread context
4. Write `task_output/raw_feedback.json`

RUN_ONLY — fetch and record, do not interpret or transform.
