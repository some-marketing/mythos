---
description: Run Design Mockup Validation — Cross-AI design mockup validation with iterative generation and review
mode: COORDINATOR
---

<objective>
Execute the Design Mockup Validation framework against a client project. Routes into the per-framework harness at frameworks/wordpress/design-mockup-validation/.claude/.
</objective>

<process>
- Read authoritative process from .claude/commands/fw-wordpress-design-mockup-validation.md and frameworks/wordpress/design-mockup-validation/manifest.json.
- Verify project path and framework link.
- Verify MCP availability per framework manifest.
- Execute via /run-framework wordpress/design-mockup-validation <project-path>.
- Validate outputs against manifest output contract.
</process>

<success_criteria>
- Framework prompt chain executed in correct order
- Output artifacts match manifest output contract
</success_criteria>
