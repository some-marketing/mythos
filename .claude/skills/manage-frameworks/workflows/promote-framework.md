# Promote Framework Workflow

## Steps

1. **[AUTO] Read candidate metadata** — Load `candidate.json` and compute promotion readiness from current files.
2. **[AUTO] Enforce promotion gates** — Stop if replay, evidence count, or sanitization checks fail.
3. **[AUTO] Copy framework assets** — Copy `proposed_framework/` into `learning-language-models/frameworks/{service}/{framework}/`.
4. **[AUTO] Register canonically** — Update `instructions/canonical/system.yaml` and the framework spec file under `instructions/canonical/frameworks/{service}/`.
5. **[AUTO] Regenerate managed instructions** — Run `npm run instructions:generate`.
6. **[AUTO] Sync manifest** — Run `npm run manifest:sync` to register the promoted framework in `.claude/project-claude.yml`.
7. **[AUTO] Validate parity** — Run `npm run instructions:validate` and `npm run manifest:check`.
8. **[AUTO] Mark production** — Update `candidate.json` status to `production`.

## Completion Audit

9. **[AUTO] Run completion audit** — Invoke the `completion-auditor` subagent with:
   - **acceptance_criteria**: Framework exists in `frameworks/`, canonical registration updated, instruction files regenerated, manifest synced and validated
   - **changed_files**: All files copied/created during promotion
   - **non_goals**: Framework content changes (promotion is a structural operation)
   - **validation_results**: Output of `npm run instructions:validate`, `npm run manifest:check`, and `npm run manifest:validate` from step 7 (full stdout/stderr, not just pass/fail)
10. **[GATE: blockers found] Reopen** — If the completion audit returns blocker-level findings, fix only the specific unmet items and re-run (maximum 2 reopen cycles). If blockers persist, escalate to user.

## Output

- New framework under `frameworks/`
- Updated canonical registration
- Regenerated harness instruction files
