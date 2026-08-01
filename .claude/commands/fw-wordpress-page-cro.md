---
description: Run Page Cro — Multi-phase conversion rate optimization audit for marketing pages
mode: COORDINATOR
---

<objective>
Execute the Page Cro framework against a client project. Routes into the per-framework harness at frameworks/wordpress/page-cro/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-page-cro.md and frameworks/wordpress/page-cro/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/page-cro <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
