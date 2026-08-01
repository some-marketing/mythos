# Framework Review Workflow

## Validation Tiers

This workflow uses two distinct validation tiers. They serve different purposes and must not be conflated.

| Tier | Method | Covers | Cannot Cover |
|------|--------|--------|--------------|
| **Structural (mechanical)** | Scripts, file checks, schema validation | File existence, directory layout, JSON schema conformance, naming conventions, cross-reference integrity, count consistency | Whether content is accurate, complete, or useful |
| **Semantic (LLM review)** | LLM-driven reading and assessment | Content quality, reasoning completeness, business correctness, criteria fulfillment beyond presence checks | Full deterministic proof of correctness |

**Rule:** Structural validation runs first. If it fails, semantic review is skipped — there is nothing meaningful to review if artifacts are missing or malformed.

## Steps

### Tier 1: Structural Validation (Mechanical)

1. **[AUTO] Read manifest** — Load `manifest.json` from the framework directory. Extract `output_contract` / `output_contract_v2` (expected directories and artifacts) and prompt-level `success_criteria` from each prompt chain entry.
1a. **[AUTO] Read run state** — If `run_state.json` exists in the output root, load structural validation results from `output_validation`.
2. **[AUTO] Check outputs exist** — For each entry in `output_contract`, verify the directory/file exists under `<PROJECT_ROOT>/`. List missing artifacts. This is a structural check only — file existence does not imply content quality.
3. **[AUTO] Validate output structure** — Run `validate-output.js` or equivalent structural checks: file existence, schema conformance, naming patterns, cross-reference integrity. These checks are deterministic and binary (pass/fail). They confirm the output _shape_ is correct but say nothing about whether the _content_ is correct.

### Tier 2: Semantic Review (LLM-Driven)

4. **[LLM] Assess output quality** — For each prompt that was executed, read the actual output artifacts and assess them against `success_criteria`. This step requires LLM judgment and cannot be fully automated. The reviewer must:
   - **Read the artifact**, not just confirm it exists
   - **Cite specific passages** that satisfy or fail each criterion (file path + excerpt)
   - **Assess reasoning quality**: Is the analysis substantive or superficial? Are conclusions supported by evidence within the artifact?
   - **Check for common failure modes**: unfilled placeholders, copy-paste artifacts, vague assertions without supporting detail, missing sections that criteria require
   - **Flag uncertainty**: If a criterion cannot be confidently assessed, state "unable to verify — [reason]" rather than defaulting to PASS

### Synthesis

5. **[AUTO] Generate review report** — Combine structural validation (from Tier 1) with semantic assessment (from Tier 2). For each output artifact:
   - **Structural status**: PASS/FAIL with check details
   - **Semantic status**: PASS/FAIL/UNCERTAIN with cited evidence
   - **Evidence format**: `{file_path, excerpt_or_observation, assessment, severity}`
   Include a summary: total artifacts expected, found, structurally valid, semantically assessed, passing, failing.
6. **[AUTO] Write report** — Save to `<PROJECT_ROOT>/reports/review.md`

## Completion Audit

After the review report is written, invoke the `completion-auditor` subagent to verify completion before declaring the run done. This step applies to substantial execution runs (multi-prompt chains). Single-prompt or read-only runs are exempt.

7. **[AUTO] Run completion audit** — Invoke the `completion-auditor` subagent with `mode: "auto"` (autonomous execution, no interactive prompts). Provide:
   - **acceptance_criteria**: The framework's `output_contract` entries and prompt-level `success_criteria`
   - **changed_files**: Artifacts listed in `run_state.json` → `artifacts_produced`
   - **non_goals**: Any scope boundaries declared in the framework's `guardrails.md`
   - **validation_results**: The `output_validation` section from `run_state.json` (includes `findings[]` with per-finding `severity`, `code`, and `message`) and the review report from step 6. This provides concrete validation command results, not just boolean/count summaries.
8. **[GATE: blockers found] Reopen** — If the completion audit returns blocker-level findings:
   a. List the specific unmet items
   b. Address only those items (do not expand scope)
   c. Re-run the completion audit (maximum 2 reopen cycles)
   d. If blockers persist after 2 cycles, escalate to user
9. **[AUTO] Finalize** — If the completion audit returns PASS (or only warning/info findings that do not violate acceptance criteria), the run is complete

## Subagent Autonomy

All subagents in this workflow are spawned with `mode: "auto"` — they execute autonomously without interactive permission prompts. The orchestrator retains interactive control at gate boundaries (steps 8 and 9).

## Reviewer vs Auditor Responsibilities

| Concern | Output Reviewer | Completion Auditor |
|---------|----------------|-------------------|
| Primary question | "Are the outputs good?" | "Are the acceptance criteria met?" |
| Assesses | Content quality, reasoning depth, business correctness | Whether each stated criterion has evidence of completion |
| Evidence standard | Cites specific passages and artifacts | Cross-references changed files against criteria |
| Scope | All output artifacts from the run | Only the declared acceptance criteria and changed files |
| Can block on | Quality failures, superficial analysis | Missing deliverables, unmet criteria, missing test results |

The output reviewer runs as part of Tier 2 (step 4). The completion auditor runs after the review report is written (step 7). They are complementary, not redundant.

## References
- Framework manifest: `frameworks/{service}/{framework}/manifest.json` — `output_contract` and `prompt_chain[].success_criteria`
- System guardrails: `.claude/guardrails.md` — observational reporting rules apply to review output
- Completion auditor: `.claude/agents/completion-auditor.md` — evidence-based completion verification
- Output reviewer: `.claude/agents/output-reviewer.md` — semantic quality assessment
- Structural validation: `tools/workspace/validate-output.js` — mechanical structure checks only (Tier 1)
