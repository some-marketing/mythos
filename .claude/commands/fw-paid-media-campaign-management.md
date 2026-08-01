---
description: Run Campaign Management — End-to-end paid advertising campaign management
mode: COORDINATOR
---

<objective>
Execute the Campaign Management framework against a client project. Routes into the per-framework harness at frameworks/paid-media/campaign-management/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-paid-media-campaign-management.md and frameworks/paid-media/campaign-management/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework paid-media/campaign-management <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
