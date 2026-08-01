---
description: Run Scope Verification — Verifies scope/proposal documents against source data by exact categorization, counting, and discrepancy detection
mode: COORDINATOR
---

<objective>
Execute the Scope Verification framework against a client project. Routes into the per-framework harness at frameworks/deliverables/scope-verification/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-deliverables-scope-verification.md and frameworks/deliverables/scope-verification/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework deliverables/scope-verification <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
