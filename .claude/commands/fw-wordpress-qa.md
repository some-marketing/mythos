---
description: Run Qa — Playwright-based site functionality testing with CRM integration validation
mode: COORDINATOR
---

<objective>
Execute the Qa framework against a client project. Routes into the per-framework harness at frameworks/wordpress/qa/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-qa.md and frameworks/wordpress/qa/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/qa <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
