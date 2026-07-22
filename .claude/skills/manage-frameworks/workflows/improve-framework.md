# Improve Framework Workflow

## Steps

1. **[USER] Identify framework** — Which framework to improve
2. **[AUTO] Read execution outputs** — Scan recent project outputs for patterns
3. **[AUTO] Identify gaps** — Find missing prompt steps, unclear instructions, schema mismatches
4. **[AUTO] Propose changes** — List improvements with justification
5. **[USER] Approve changes** — User reviews and approves proposed improvements
6. **[AUTO] Apply changes** — Update prompts, schemas, guardrails as approved
7. **[AUTO] Version bump** — Update manifest.json version
8. **[AUTO] Sync manifest** — Run `npm run manifest:sync` if skills, commands, or agents were added or removed
9. **[AUTO] Re-audit** — Run audit to verify changes don't break structure

## Completion Audit

10. **[AUTO] Run completion audit** — Invoke the `completion-auditor` subagent with:
    - **acceptance_criteria**: Improvements applied as approved, version bumped in manifest, re-audit passes with zero critical findings
    - **changed_files**: All files modified during improvement
    - **non_goals**: Unrelated framework changes or scope expansion
    - **validation_results**: Output of `npm run instructions:validate` and the re-audit from step 9 (full stdout/stderr, not just pass/fail)
11. **[GATE: blockers found] Reopen** — If the completion audit returns blocker-level findings, fix only the specific unmet items and re-run (maximum 2 reopen cycles). If blockers persist, escalate to user.
