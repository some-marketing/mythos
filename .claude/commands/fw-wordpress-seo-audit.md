---
description: Run Seo Audit — Multi-phase SEO audit for WordPress sites
mode: COORDINATOR
---

<objective>
Execute the Seo Audit framework against a client project. Routes into the per-framework harness at frameworks/wordpress/seo-audit/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-seo-audit.md and frameworks/wordpress/seo-audit/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/seo-audit <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
