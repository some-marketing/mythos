---
description: Run Content Editing — Scoped WordPress admin content editing with visual and functional verification
mode: COORDINATOR
---

<objective>
Execute the Content Editing framework against a client project. Routes into the per-framework harness at frameworks/wordpress/content-editing/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-content-editing.md and frameworks/wordpress/content-editing/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/content-editing <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
