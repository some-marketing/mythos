---
description: Run end-of-session debrief producing improve and replicate plans
mode: REVIEW_ONLY
---

<objective>
Evaluate a completed execution slice or in-progress goal checkpoint by consuming accumulated session learnings, run artifacts, and independent review where available. Produce structured improve-plan and replicate-plan outputs that close the learning loop and prevent future actors from repeating completed work.
</objective>

<process>
- Resolve scope from arguments: if empty or 'latest', identify the most recent completed execution slice from _dev/reports/analysis/ stage reports; if a run-id is provided, locate artifacts for that specific slice; if --goal-checkpoint is provided, resolve the named in-progress goal and treat partial progress as the review subject.
- Read the most recent session learnings artifact(s) for this session: glob _dev/reports/analysis/session-learnings__*.md and read the file(s) matching the resolved scope date.
- Read the stage report and expectation-failures JSON for the completed slice: the relevant _dev/reports/analysis/advance-pipeline__<scope>.md and its matching .expectation-failures.json.
- Read the Codex review artifacts if they exist: glob _dev/reports/analysis/codex-cli-run__*.md and _dev/reports/signals/closed/ready-for-review__*.json for the matching scope.
- Evaluate from the builder perspective: what was hard, what flowed, what surprised. Identify friction points, gaps in specs or prompts, validation misses, and patterns that worked well.
- Classify each finding into one of two buckets: improve (local corrective mutation) or replicate (lateral spreading of proven pattern). A finding may be neither — discard anything that does not meet the threshold.
- Produce the debrief outputs: For an unplanned / operational session with NO run_id (no planned closeout-validation surface), also record a lightweight OperationalDebrief/1.0 marker at _dev/state/operational-debrief/<scope>.json (via tools/maintenance/lib/end-session-closeout.js writeOperationalDebriefMarker) pointing at this debrief / learning-journal entry. That marker is what the end-session closeout's operational validation lane accepts in place of the framework-grade artifacts, so an unplanned session validates instead of failing the verifier repo-wide. The marker carries an (initially empty) candidate_sweep_receipts slot reserved for the shutdown-kernel-candidate-sweep concept — do not populate it here.
-   - Write _dev/reports/analysis/run-debrief__<scope>.md — short summary with 3-7 key findings maximum. Each finding must cite a specific artifact or observation as evidence.
-   - Write _dev/reports/analysis/run-debrief__<scope>.improve-plan.json — 0-3 items following the improve-plan schema. Each item targets a specific surface (spec, command_contract, validation, closeout_rule, orchestration_primitive, framework_prompt, review_gate) with a concrete suggested change and evidence reference.
-   - Write _dev/reports/analysis/run-debrief__<scope>.replicate-plan.json — 0-3 items following the replicate-plan schema. Each item describes a proven pattern, its applicability, confidence level, and replication risk.
- For --goal-checkpoint, the markdown must also include a compact continuity block: current objective without scope shrinkage, completed work with evidence, open work, blockers/gate owners, forbidden repeat actions, changed/owned surfaces, and the exact next pickup command. The improve and replicate JSON outputs may contain empty item arrays when no stable lesson is ready; do not invent lessons to satisfy the checkpoint.
- Assess whether the completed slice is now stable enough to push to the active remote branch. Treat this as a control-plane question, not optional ops trivia: if the slice changed repo truth materially and the validation surface is complete, the debrief should say that the slice is ready to commit/push before the next major slice starts.
- 'No lesson' is a valid output. Do not invent findings to fill the artifacts. An empty items array is correct when the slice produced no actionable learnings.
- Answer the mandatory framework-delta question explicitly in the debrief summary (operator directive 2026-06-11: every task is expected to feed a framework): name which framework this slice created, improved, or executed. If the slice used a framework and friction was observed, improve items targeting that framework are the expected output. If the slice followed a repeatable shape no framework covers, recommend a capture (/capture-task or /scaffold-framework) in the summary. 'No framework delta' is a valid answer only with a stated reason — it is the exception, not the default.
- If improve items target a framework, note in the debrief summary that /improve-framework should consume them. Do not apply the improvements directly. The framework-flywheel lane (tools/framework-lifecycle/flywheel-check.cjs, launchd ca.somemarketing.smos.framework-flywheel) raises the apply-side signal mechanically — items left here will be drained, not lost.
- Replicate items are advisory only in v1 — no automatic propagation. Note applicability and risk but do not create signals or tasks for replication.
</process>

<success_criteria>
- Debrief markdown written with 3-7 findings max
- Improve-plan JSON written (may be empty items array)
- Replicate-plan JSON written (may be empty items array)
- No fabricated lessons — every finding cites evidence
- Scope resolved before any artifact reading
- Session learnings and stage reports consumed when they exist
</success_criteria>

<handoff>
improve_items_exist: /improve-framework <framework-id>
replicate_items_need_review: Surface as advisory to operator
default_next: commit/push validated slice or next execution slice
no_findings: No follow-on needed
</handoff>
