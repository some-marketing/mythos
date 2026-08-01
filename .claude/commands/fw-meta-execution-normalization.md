---
description: Run Execution Normalization — Tool-agnostic pipeline for normalizing framework execution models with progressive code offloading
mode: COORDINATOR
---

<objective>
Execute the Execution Normalization framework against a client project. Routes into the per-framework harness at frameworks/meta/execution-normalization/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-meta-execution-normalization.md and frameworks/meta/execution-normalization/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework meta/execution-normalization <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
