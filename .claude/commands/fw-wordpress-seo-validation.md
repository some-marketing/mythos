---
description: Run Seo Validation — Playwright-based pre-launch SEO validation crawl for WordPress sites
mode: COORDINATOR
---

<objective>
Execute the Seo Validation framework against a client project. Routes into the per-framework harness at frameworks/wordpress/seo-validation/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-seo-validation.md and frameworks/wordpress/seo-validation/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/seo-validation <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
