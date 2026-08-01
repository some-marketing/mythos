---
description: Run Feedback To Tasks — Compiles stakeholder feedback from PM tools into provenance-cited task lists
mode: COORDINATOR
---

<objective>
Execute the Feedback To Tasks framework against a client project. Routes into the per-framework harness at frameworks/project-management/feedback-to-tasks/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-project-management-feedback-to-tasks.md and frameworks/project/management-feedback-to-tasks/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework project/management-feedback-to-tasks <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
