# Guardrails — paid-media/google-ads-search-campaign-build

## Purpose
Produce a new Google Ads Search campaign as a preview-approve-push bundle. The framework converts evidence into a structured proposal across six steps (intake, structure, bidding/budget, keywords, RSA/assets, measurement/launch) and hands off to the apply pipeline at `_dev/concepts/google-ads-apply-pipeline-v1.md`. v1 scope is Search only.

## Maturity status — discovery (probationary)
This framework is probationary for its first 3 runs. While in `discovery`:
- Operator must be present for each run.
- Codex preview review is required before any push.
- Post-push readback is required against the live account.
- Promotion to `stable` requires the artifact at `_dev/research/paid-media-google-ads-search-campaign-build-maturity-graduation-<timestamp>.md` (operator-ratified).
- Any deviation found during these 3 runs must be logged as a finding, not silently normalized.

## Maturity status and promotion

**Current tier:** `discovery`

**What `discovery` means in plain terms.** This framework has not yet earned autonomous execution. It is treated as unproven until it has produced 3 consecutive successful runs with the operator in the loop on every one. During discovery, Claude does not push to the live Google Ads account without the operator physically present, the Codex preview review artifact attached, and an approved preview bundle to match the push against.

**What the 3-run requirement means in practice.** The counter starts at 0. It increments only when a run meets the definition of successful (below) end-to-end. A run that required rollback or fix-forward remediation does not count toward the 3, even if the final state of the account was acceptable. The counter does not decrement; a remediation-required run is simply not credited. All 3 qualifying runs must occur before promotion is considered.

**What "successful run" means.** All of the following, in order, with artifacts:
1. Preview rendered from the framework prompt chain
2. Operator present at the run
3. Codex reviewed the preview and produced a review artifact
4. Operator approved the reviewed preview (explicit approval artifact)
5. Push executed cleanly against the google-ads MCP (no errors, no partial writes)
6. Post-push readback from the live account matched the approved preview
7. Operator ratified the run outcome (per-run ratification, logged in the maturity tracker)

**What promotion to `stable` unlocks.** After 3 successful discovery runs plus the operator-ratification artifact is written, the tier flips to `stable`. Under `stable`, Claude may execute preview→approve→push→readback cycles without the operator physically present on every run. Per-change operator approval is still required before each push (the approval artifact is mandatory forever); what changes is the live-presence requirement during the run itself.

**What promotion to `hardened` could eventually unlock.** Placeholder tier. Criteria are not yet defined. Candidates under consideration (non-binding): automated pre-push diff checks, per-change approval delegated to a narrower scope, or batched approvals against a policy envelope. Nothing in `hardened` is committed until that criteria set is authored and ratified.

**How to read the run log.** The human-readable promotion log lives at `frameworks/paid-media/google-ads-search-campaign-build/maturity-tracker.md`. Each run has an entry with its run ID, plan reference, preview bundle path, approval artifact path, push result, readback result, run outcome (pass or remediation-required), and whether it counts toward promotion. The machine-readable path templates are in `manifest.json` under `maturity.run_log_artifact_path_template` and `maturity.promotion_criteria.operator_ratification_artifact_path_template`.

## Execution mode progression
Each step declares its own mode. Advancing requires the gate for the current step to close with operator sign-off.
- Step 01 intake-and-evidence — FINDINGS_ONLY. Gate: observer gate (evidence inventory complete and cited).
- Step 02 account-structure-design — FINDINGS_ONLY. Gate: structure gate (campaign/ad-group topology justified against evidence).
- Step 03 bidding-and-budget-plan — REVIEW_ONLY. Gate: bidding-strategy gate + geo gate (strategy choice defensible; geo targeting explicit).
- Step 04 keywords-and-match-types — REVIEW_ONLY. Gate: keyword gate (match types, negatives, and decision matrix rules applied).
- Step 05 rsa-and-assets — PATCH_ALLOWED against a preview bundle only. Gate: copy gate (RSA composition, pin discipline, asset coverage; no live mutation).
- Step 06 measurement-and-launch — RUN_ONLY against the google-ads MCP via the preview-approve-push pipeline. Gates: measurement gate (conversion actions bound, attribution chosen, tracking verified) and launch gate (preview_hash bound, operator approval recorded, post-push readback captured).

No step may skip its gate. No step may run in a higher mode than declared.

## Prohibitions
- No verbatim Ed Leake content. Principles are distilled in our own words with citations to source PDFs.
- No PMax, Shopping, YouTube, or Scripts surface in v1. These are later modules.
- No live platform mutation without: (a) a bound preview_hash, (b) explicit operator approval recorded in the signal, and (c) a post-push readback against the account.
- No credential access outside the Subagent Preflight Contract. Credentials are loaded from Keychain or env by the google-ads MCP, never copied into prompts or artifacts.
- No mutation of `paid-media/campaign-management/`. That framework is composed by reference only; any cross-framework change is a separate plan.

## Required gates (summary)
- Observer gate (step 01): evidence is cited, not asserted; no invented numbers.
- Structure gate (step 02): account topology justified by intent clusters and evidence.
- Bidding-strategy gate (step 03): bid strategy tied to conversion volume reality and measurement readiness.
- Geo gate (step 03): geo targets explicit (presence vs. interest), with exclusions.
- Keyword gate (step 04): match-type methodology, negatives seed list, and decision-matrix rules present.
- Copy gate (step 05): RSA composition meets minimum asset counts, pin discipline is documented, ad-extensions/assets coverage enumerated.
- Measurement gate (step 06): conversion actions bound, attribution model chosen with rationale, enhanced conversions and call tracking addressed.
- Launch gate (step 06): preview_hash, operator-approval record, post-push readback artifact.

## Handoff expectations
Steps 01-05 produce preview-bundle-compatible artifacts. Step 06 feeds the preview-approve-push apply pipeline specified at `_dev/concepts/google-ads-apply-pipeline-v1.md`. The apply pipeline owns mutation; this framework owns the proposal, the gates, and the readback.

## Grounding-check alignment
Ed Leake principles are treated as evidence-backed heuristics, not rules. Each distilled principle in the prompt chain includes: (a) the principle in our own words, (b) its evidence basis (account class, scale, or observation pattern it derives from), and (c) failure conditions — the situations where the principle stops applying or inverts. This is curiosity-over-comfort per grounding check #15: we adopt the principle, and we stay ready to falsify it in this account's data.
