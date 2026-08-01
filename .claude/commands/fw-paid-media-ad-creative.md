---
description: Run Ad Creative — Generate, iterate, and scale ad creative across paid advertising platforms with structured testing plans
mode: COORDINATOR
---

<objective>
Execute the Ad Creative framework against a client project. Routes into the per-framework harness at frameworks/paid-media/ad-creative/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-paid-media-ad-creative.md and frameworks/paid/media-ad-creative/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework paid/media-ad-creative <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
