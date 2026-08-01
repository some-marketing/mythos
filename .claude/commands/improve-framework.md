---
description: Improve framework based on run outputs
mode: PATCH_ALLOWED
---

<objective>
Improve a framework based on execution feedback and output analysis by identifying gaps in prompts, schemas, and guardrails, proposing changes for user approval, applying approved changes, and running post-improvement validation and lifecycle hooks.
</objective>

<process>
- Parse arguments for <framework-path>. If missing, prompt the user.
- Read execution outputs: scan recent project outputs under clients/ for patterns, recurring issues, and quality gaps related to this framework.
- Identify gaps: find missing prompt steps, unclear instructions, schema mismatches between expected and actual outputs, guardrail coverage gaps, and prompt chain continuity issues.
- Propose changes: list each improvement with justification, affected files, and expected impact. Present proposals to the user for review.
- Apply approved changes: update prompts, schemas, guardrails, and other framework files as approved by the user. Preserve prompt chain continuity throughout all changes.
- Version bump: update the version field in manifest.json to reflect the improvement.
- Sync manifest: run npm run manifest:sync if skills, commands, or agents were added or removed during improvement.
- Re-audit: run audit-framework on the improved framework to verify changes do not break structure or references.
- Run completion audit: invoke the completion-auditor subagent with acceptance criteria (improvements applied as approved, version bumped, re-audit passes with zero critical findings). If blocker-level findings, fix and re-run (maximum 2 reopen cycles).
- Run post-improve lifecycle hooks: execute npm run lifecycle:hooks -- --profile post-improve --framework-id <service/framework>. If any hook fails, report the failure and stop.
</process>

<success_criteria>
- Execution outputs analyzed for improvement opportunities
- Changes proposed with justification before applying
- User approval obtained before modifying framework files
- Framework files updated while preserving prompt chain continuity
- Version bumped in manifest.json
- Re-audit passes with no critical findings
- Completion audit passed or blockers resolved within 2 reopen cycles
- Post-improve lifecycle hooks executed successfully
</success_criteria>

<handoff>
improvements_applied: audit-framework <framework-path> for full verification
re_audit_failures: Fix audit failures and re-run
lifecycle_hook_failure: Fix hook issue and re-run lifecycle hooks
</handoff>
