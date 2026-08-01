---
description: Run Documentation — Client-facing WordPress admin documentation via MCP browser walkthroughs with Notion output
mode: COORDINATOR
---

<objective>
Execute the Documentation framework against a client project. Routes into the per-framework harness at frameworks/wordpress/documentation/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-documentation.md and frameworks/wordpress/documentation/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/documentation <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
