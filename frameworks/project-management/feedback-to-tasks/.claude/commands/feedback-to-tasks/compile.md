---
name: compile
description: Run full feedback-to-tasks pipeline — architecture, fetch, audit, format
skill: feedback-to-tasks
mode: PATCH_ALLOWED
arguments:
  - name: source_tool
    description: "PM tool containing feedback: 'dart' or 'notion'"
    required: true
  - name: source_location
    description: Board name, page URL, or database ID
    required: true
  - name: destination_format
    description: "Output format: 'markdown', 'json', or 'github-issues'"
    required: true
---

Run the full feedback-to-tasks pipeline.

1. Load `guardrails.md` for execution constraints
2. Map communication architecture (stakeholders, roles, authority)
3. Fetch raw feedback from source tool via MCP
4. Audit provenance — every item must trace to a specific source
5. Flag ambiguous, contradictory, and out-of-scope items
6. Format task list with provenance citations
7. Present to user for review

Every task without a source citation is INVALID. Follow `guardrails.md`.
