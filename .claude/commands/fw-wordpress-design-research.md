---
description: Run Design Research — Pre-build design research and competitive site analysis
mode: COORDINATOR
---

<objective>
Execute the Design Research framework against a client project. Routes into the per-framework harness at frameworks/wordpress/design-research/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-design-research.md and frameworks/wordpress/design-research/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/design-research <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
