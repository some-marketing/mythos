# Claude Prompt Pack: Operational Loop Closure

Prompt pack for closing the operational loop after a substantial implementation or review cycle in Mythos so planning, signals, lessons, validation, and next-action surfaces all agree again.

Primary source material:
- [`whats-next.md`](../../whats-next.md)
- [`_dev/reports/analysis/review-progress__repo.md`](../reports/analysis/review-progress__repo.md)
- [`_dev/reports/analysis/review-active-workstreams.md`](../reports/analysis/review-active-workstreams.md)
- [`_dev/reports/analysis/plan-active-workstreams.md`](../reports/analysis/plan-active-workstreams.md)
- [`_dev/reports/analysis/plan-pipeline.md`](../reports/analysis/plan-pipeline.md)
- [`_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md`](../LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md)
- [`_dev/COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md`](../COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md)
- [`frameworks/meta/execution-normalization/manifest.json`](../../frameworks/meta/execution-normalization/manifest.json)
- [`_dev/concepts/lessons-automation-design-decisions.md`](../concepts/lessons-automation-design-decisions.md)

Primary target files:
- `_dev/reports/analysis/plan-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.next-step.json`
- `_dev/reports/analysis/review-active-workstreams.md`
- `_dev/reports/analysis/review-progress__repo.md`
- `_dev/reports/signals/**`
- `tools/signals/**`
- `tools/autonomy/**`
- `tests/lifecycle/**`
- `whats-next.md`

## Goal

Close the loop between:
- what the repo has actually completed
- what the planning surfaces still claim
- what the live signal surface says
- what the lessons cadence requires
- what the next bounded execution slice should be

Desired outcome:
- stale planning and stale signals are removed or refreshed
- lessons reconciliation is treated as an operational loop, not a reminder
- meta-framework validation is advanced from plan to evidence where feasible
- autonomy/maturity work is left in an explicit truthful state
- any distinct-family-reviewer-dependent feedback loop is reported and managed truthfully
- the sequence ends with one standard closeout bundle
- the next command after the pass is concrete and durable

## Why This Matters

Mythos already has strong framework structure, validation, and control-plane tooling.

The current gap is mostly loop closure:
- implementation can outrun planning artifacts
- successful work can leave stale review or active-workstream state behind
- lessons can be captured without becoming durable next work
- forward-looking autonomy work can remain conceptually true but operationally unverified

This pack is for bringing those surfaces back into alignment without widening into a new architecture pass.

## Lessons Automation Requirements

Per the approved lessons-automation design (`_dev/concepts/lessons-automation-design-decisions.md`), every bounded slice in this pack must:

1. **Rolling capture** — append observations to the session-learnings artifact every ~3 substantive turns and on blocker, stage transition, operator correction, or surprising success. Each entry: timestamp, observation, category, evidence refs, likely_reusable.
2. **Debrief at closeout** — before emitting `ready_for_clear`, produce a run debrief consuming accumulated session learnings. Output: improve-plan (0-3 items), replicate-plan (0-3 items). "No lesson" is valid.
3. **Block ready_for_clear** until debrief artifacts exist for meaningful runs.

## Recommended Execution Order

Run this pack as three bounded implementation slices:

1. planning and signal truth refresh
2. lessons-loop operationalization or hardening
3. meta-framework validation and autonomy-baseline truth refresh

Then run:

4. validation
5. completion audit

Do not combine all three write slices into one large edit unless the repo state is already very stable.

## Recommended Near-Term Slice

If only one slice can be done now, start with:
1. planning and signal truth refresh
2. then lessons-loop operationalization
3. then meta-framework validation/autonomy baseline

Why this order:
- stale planning and stale signals distort every later action
- lessons need a durable output loop once the control plane is stable
- meta-framework and maturity work should be advanced from a truthful baseline, not from stale queue state

Do not start with:
- runtime parity expansion
- broad new automation daemons
- new provider integrations
- speculative maturity automation before current evidence surfaces are aligned

## Prompt 1: Coordinator Kickoff

```text
Close the operational loop in Mythos so planning, signals, lessons, and next-step truth are aligned again.

Read these files first:
- `whats-next.md`
- `_dev/reports/analysis/review-progress__repo.md`
- `_dev/reports/analysis/review-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.next-step.json`
- `_dev/reports/analysis/plan-pipeline.md`
- `_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md`
- `_dev/COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md`
- `frameworks/meta/execution-normalization/manifest.json`
- your project's distinct-family-reviewer bridge helper, if one exists
- `tools/autonomy/complete-task.cjs`

Goal:
- remove drift between completed work and planning/signal surfaces
- make the lessons loop operational rather than advisory
- advance the meta-framework/autonomy story only as far as evidence supports
- leave a truthful next command and durable artifacts

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only subagents in parallel:
   - one for planning/signal truth inventory
   - one for lessons/meta-framework/autonomy inventory
4. Synthesize findings in the main thread.
5. Keep the main thread thin: it frames the slice, issues bounded instructions, performs extra checks, and synthesizes what to communicate to the user and to the distinct-family reviewer.
6. Implement exactly one bounded first slice through bounded workers or subagents with declared ownership.
7. Validate that slice with an independent read-only validator, not with the same worker that made the change.
8. If the first slice requires distinct-family review or cross-actor feedback, dispatch the review to your distinct-family reviewer and record the handoff note under `_dev/reports/signals/` before claiming auto-run active.
9. If the first slice stabilizes the repo state, continue to the next bounded slice.
10. Before lessons reconciliation or final closeout, close out the distinct-family reviewer handoff unless another still-live reviewer-targeted scope explicitly requires it.
11. Launch one read-only completion-auditor-style subagent before closeout.

Acceptance criteria:
1. Planning surfaces no longer describe consumed or closed work as live.
2. Live signals and planning artifacts agree on the current active or completed queues.
3. Lessons reconciliation has an explicit trigger and durable output expectation.
4. The meta-framework/autonomy surfaces are either advanced with evidence or explicitly left blocked with concrete prerequisites.
5. Any distinct-family reviewer feedback loop is left in a truthful state: handoff prepared, auto-run active, or feedback received.
6. Rolling lessons capture happened during work (session-learnings artifact updated).
7. Debrief artifacts (improve-plan, replicate-plan) exist before ready_for_clear.
8. The final report names the exact next command.

Constraints:
- keep the work bounded to loop closure and operational truth
- do not widen into unrelated runtime/framework feature work
- do not let the main thread become the primary deep-work surface when the slice can be partitioned safely
- do not let the same worker both implement and independently validate the slice
- do not claim automation exists where only planning exists
- do not claim the distinct-family reviewer listener loop is live merely because a handoff note and bridge prompt exist
- do not leave a managed distinct-family reviewer listener running after final closeout unless another live reviewer-targeted queue still depends on it
- preserve historical artifacts; fix the current truth surfaces rather than rewriting history

Final response must include:
- changed files
- which loop-closure slices were completed
- validations run
- distinct-family reviewer handoff/listener state if applicable
- remaining blockers or deferred items
- exact next command

Closeout bundle
- summary of what the pass completed
- summary of lessons captured or an explicit note that no new lessons were warranted
- action items revealed but not yet codified into prompt packs, commands, guardrails, tests, or workflow assets
- clear instruction: `recommended_next_command: clear` only when the run is actually ready for clear; otherwise list the exact pending items
```

## Prompt 2: Explorer A - Planning And Signal Truth Inventory

```text
You are a read-only subagent.

Purpose:
Inventory the current planning and signal surfaces and identify exact drift that prevents clean loop closure.

Read:
- `_dev/reports/analysis/review-progress__repo.md`
- `_dev/reports/analysis/review-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.next-step.json`
- `_dev/reports/analysis/plan-pipeline.md`
- inspect `_dev/reports/signals/` and `_dev/reports/signals/closed/`
- `tools/signals/lib/pipeline-loop.js`
- your project's distinct-family-reviewer bridge helper, if one exists

Return exactly these sections:

Findings
- stale planning claims with file references
- stale or mismatched live-signal claims with file references
- any exact next-command drift with file references

Implementation notes
- smallest files that must be updated first
- whether drift is best fixed in docs, signals, watcher logic, or all three

Risks
- risks of changing history instead of current state
- risks of leaving consumed signals or stale next-step JSON in place

Do not edit files.
```

## Prompt 3: Explorer B - Lessons, Meta-Framework, And Autonomy Inventory

```text
You are a read-only subagent.

Purpose:
Inventory what is still missing to truly close the loop on lessons reconciliation, meta-framework validation, and autonomy maturity truth.

Read:
- `whats-next.md`
- `_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md`
- `_dev/COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md`
- `frameworks/meta/execution-normalization/manifest.json`
- `frameworks/meta/execution-normalization/prompts/README.md`
- `tools/autonomy/complete-task.cjs`
- `_dev/reports/analysis/lessons-reconciliation__2026-03-28-pass4.md`

Return exactly these sections:

Findings
- which loop elements are already implemented
- which remain blocked, conceptual, or only partially validated

Implementation notes
- smallest truthful next slice for lessons reconciliation
- smallest truthful next slice for meta-framework validation
- smallest truthful next slice for autonomy maturity work

Risks
- overclaiming maturity
- adding new automation before enough evidence exists
- mixing planning cleanup with larger architecture work

Do not edit files.
```

## Prompt 4: Worker - Planning And Signal Truth Refresh

```text
Refresh the current planning and signal truth surfaces in Mythos so the repo no longer describes closed work as active.

Ownership:
- `_dev/reports/analysis/plan-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.next-step.json`
- `_dev/reports/analysis/review-active-workstreams.md`
- `_dev/reports/analysis/review-progress__repo.md`
- narrow supporting signal or watcher files only if required

You are not alone in the codebase. Do not revert edits by others.

Task:
- align the planning artifacts with the actual current live/closed signal state
- preserve exact next-command truth
- remove or correct claims that are now stale
- if the current-state artifacts imply an active distinct-family reviewer listener, make sure that claim is backed by a real listener-status artifact or remove the claim
- if watcher logic is the source of drift, fix the smallest truthful code path and add a narrow test

Constraints:
- do not rewrite historical reports except where the current repo uses them as active truth surfaces
- prefer updating the current-state artifacts rather than retroactively sanitizing the archive
- do not widen into broader signal architecture changes
- do not invent watcher/cron status from a prompt or signal alone

Final response must include:
- changed files
- what stale claims were corrected
- whether any watcher logic needed to change
- validations run
```

## Prompt 5: Worker - Lessons Loop Operationalization

```text
Operationalize the lessons reconciliation loop in the smallest truthful way so repeated lessons produce durable work instead of passive reminders.

Ownership:
- `tools/signals/**`
- `tests/lifecycle/**`
- `_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md` only if its current-state guidance must be updated
- current review/analysis surfaces only if required to reflect the new loop contract

You are not alone in the codebase. Do not revert edits by others.

Task:
- add or harden the trigger for lessons reconciliation during long-running or blocked-fix-close cycles
- ensure the loop leaves a durable artifact or signal even on a no-findings pass
- make repeated lessons able to produce a bounded hardening signal, plan update, or task-map update
- keep the mechanism small and truthful

Constraints:
- do not build a generic learning engine
- do not add a new queue system
- do not overstate what is automated versus recommended

Final response must include:
- changed files
- exact trigger rules added or hardened
- exact durable artifact or signal contract
- validations run
- what remains deferred
```

## Prompt 6: Worker - Meta-Framework Validation And Autonomy Baseline

```text
Advance the meta execution-normalization and autonomy surfaces from planning truth toward evidence-backed truth, without overclaiming maturity.

Ownership:
- `whats-next.md`
- framework-validation or autonomy helper surfaces only if a bounded truthful update is required
- supporting analysis/report files as needed

You are not alone in the codebase. Do not revert edits by others.

Task:
- validate the smallest real next step for `meta/execution-normalization`
- make the autonomy/maturity state truthful about what is implemented, what is blocked, and what evidence is still required
- if no code change is justified, update only the durable planning/reporting surfaces so they stop overstating or understating reality

Preferred bounded outcomes:
- a real validation pass or artifact showing how the meta framework should be applied next
- or a tightened `whats-next.md` / analysis state that clearly gates maturity work on real evidence

Constraints:
- do not invent fake maturity metrics
- do not claim true replay where only preflight exists
- do not start graduation automation until the repo has the stated evidence base

Final response must include:
- changed files
- what new evidence was produced or what truth surface was corrected
- exact remaining prerequisites for maturity/graduation work
- validations run
```

## Prompt 7: Validation Prompt

```text
Validate the operational loop-closure work.

Acceptance criteria:
1. Current planning artifacts match the truthful live or completed workstream state.
2. Live signals and current planning artifacts no longer contradict one another.
3. The lessons loop has an explicit recurring trigger and a durable output contract.
4. The meta-framework/autonomy surfaces are truthful about what is implemented versus blocked.
5. Any watcher or signal code changes are covered by narrow validation or tests.
6. Any claimed distinct-family reviewer listener state is backed by the real listener lifecycle artifact or explicitly marked as only handoff prepared.

Required output:
- Findings
- Validation run
- Acceptance-criteria status
- Remaining gaps
- Closeout bundle completeness

Validation rules:
- run the narrowest truthful tests for any touched watcher/signal/autonomy code
- if only docs/planning surfaces changed, run the lightest structural checks that prove references and contracts are coherent
- do not overstate validation

Do not edit files.
```

## Prompt 8: Completion Audit Prompt

```text
You are a read-only completion auditor.

Audit whether the operational loop-closure pass is actually complete.

Focus on:
- whether current-state artifacts tell the truth
- whether stale queue state was really cleared
- whether the lessons loop now produces durable next work instead of reminders
- whether the meta-framework/autonomy status is evidence-backed rather than aspirational
- whether the final next command is concrete and justified

Return exactly these sections:

Findings
- blocker, warning, and info findings with file references

Acceptance criteria
- pass/fail for each criterion

Residual risks
- anything still likely to drift soon

Closeout bundle
- whether the final summary, lessons summary, uncodified action items, and clear instruction are all present and truthful

Do not edit files.
```
