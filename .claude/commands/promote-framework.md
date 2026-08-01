---
description: Promote a validated framework candidate into Mythos
mode: PATCH_ALLOWED
---

<objective>
Promote a validated candidate into the frameworks/ directory, register it canonically in system.yaml, regenerate managed instruction files, sync the manifest, validate parity, and run post-promotion lifecycle hooks.
</objective>

<process>
- Parse arguments for <candidate-root>. If missing, prompt the user.
- Read candidate metadata: load candidate.json and compute promotion readiness from current files, replay results, and sanitization status.
- Enforce promotion gates: stop if replay checks have not passed, evidence count is insufficient, or sanitization checks fail. Report specific blockers.
- Copy framework assets: copy proposed_framework/ contents into frameworks/{service}/{framework}/, creating the directory structure.
- Register canonically: update instructions/canonical/system.yaml to add the new framework entry and create the framework spec file under instructions/canonical/frameworks/{service}/.
- Regenerate managed instructions: run npm run instructions:generate to produce harness-specific instruction files from canonical specs.
- Sync manifest: run npm run manifest:sync to register the promoted framework in .claude/project-claude.yml.
- Validate parity: run npm run instructions:validate and npm run manifest:check to confirm all generated files are consistent.
- Mark production: update candidate.json status to 'production'.
- Run completion audit: invoke the completion-auditor subagent with acceptance criteria (framework exists in frameworks/, canonical registration updated, instruction files regenerated, manifest synced and validated), changed files, and validation results. If blocker-level findings are returned, fix specific unmet items and re-run (maximum 2 reopen cycles).
- Run post-promote lifecycle hooks: execute npm run lifecycle:hooks -- --profile post-promote --framework-id <service/framework> --candidate-root <candidate-root>. If any hook fails, report the failure and stop.
</process>

<success_criteria>
- Promotion gates enforced before any file copying
- Framework assets copied to frameworks/{service}/{framework}/
- Canonical registration updated in system.yaml
- Managed instruction files regenerated successfully
- Manifest synced and validated
- Candidate status marked as production
- Completion audit passed or blockers resolved within 2 reopen cycles
- Post-promote lifecycle hooks executed successfully
</success_criteria>

<handoff>
promotion_complete: audit-framework <framework-path> to verify
promotion_blocked: Fix blockers and re-run promote-framework
lifecycle_hook_failure: Fix hook issue and re-run lifecycle hooks
</handoff>
