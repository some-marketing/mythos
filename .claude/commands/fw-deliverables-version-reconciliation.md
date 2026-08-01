---
description: Run Version Reconciliation — Structured diff and contradiction detection between two versions of a deliverable, supporting cross-format comparison
mode: COORDINATOR
---

<objective>
Execute the Version Reconciliation framework against a client project. Routes into the per-framework harness at frameworks/deliverables/version-reconciliation/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-deliverables-version-reconciliation.md and frameworks/deliverables/version-reconciliation/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework deliverables/version-reconciliation <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
