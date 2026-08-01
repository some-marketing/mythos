---
description: Run Presentation Review — Cross-reference audit of client presentations against project plan documents, screenshots, and errata
mode: COORDINATOR
---

<objective>
Execute the Presentation Review framework against a client project. Routes into the per-framework harness at frameworks/deliverables/presentation-review/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-deliverables-presentation-review.md and frameworks/deliverables/presentation-review/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework deliverables/presentation-review <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
