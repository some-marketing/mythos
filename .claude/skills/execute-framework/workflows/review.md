# Framework Review Workflow

## Steps

1. **[AUTO] Read manifest** — Load `manifest.json` from the framework directory. Extract `output_contract` / `output_contract_v2` (expected directories and artifacts) and prompt-level `success_criteria` from each prompt chain entry.
1a. **[AUTO] Read run state** — If `run_state.json` exists in the output root, load structural validation results from `output_validation`.
2. **[AUTO] Check outputs exist** — For each entry in `output_contract`, verify the directory/file exists under `<PROJECT_ROOT>/`. List missing artifacts.
3. **[AUTO] Validate output quality** — For each prompt that was executed, check its `success_criteria` against the actual outputs. Use `Grep` and `Read` to verify content matches criteria (e.g., required sections present, no unfilled placeholders, no PII).
4. **[AUTO] Generate review report** — Combine structural validation (from run_state) with quality validation. PASS/FAIL per output artifact with evidence (file path + what was checked + result). Include a summary: total artifacts expected, found, passing, failing.
5. **[AUTO] Write report** — Save to `<PROJECT_ROOT>/reports/review.md`

## Completion Audit

After the review report is written, invoke the `completion-auditor` subagent to verify completion before declaring the run done. This step applies to substantial execution runs (multi-prompt chains). Single-prompt or read-only runs are exempt.

6. **[AUTO] Run completion audit** — Invoke the `completion-auditor` subagent with:
   - **acceptance_criteria**: The framework's `output_contract` entries and prompt-level `success_criteria`
   - **changed_files**: Artifacts listed in `run_state.json` → `artifacts_produced`
   - **non_goals**: Any scope boundaries declared in the framework's `guardrails.md`
   - **validation_results**: The `output_validation` section from `run_state.json` (includes `findings[]` with per-finding `severity`, `code`, and `message`) and the review report from step 5. This provides concrete validation command results, not just boolean/count summaries.
7. **[GATE: blockers found] Reopen** — If the completion audit returns blocker-level findings:
   a. List the specific unmet items
   b. Address only those items (do not expand scope)
   c. Re-run the completion audit (maximum 2 reopen cycles)
   d. If blockers persist after 2 cycles, escalate to user
8. **[AUTO] Finalize** — If the completion audit returns PASS (or only warning/info findings that do not violate acceptance criteria), the run is complete

## References
- Framework manifest: `frameworks/{service}/{framework}/manifest.json` — `output_contract` and `prompt_chain[].success_criteria`
- System guardrails: `.claude/guardrails.md` — observational reporting rules apply to review output
- Completion auditor: `.claude/agents/completion-auditor.md` — evidence-based completion verification
