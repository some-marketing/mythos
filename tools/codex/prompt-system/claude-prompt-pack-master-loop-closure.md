# Claude Prompt Pack: Master Loop Closure Workflow

Top-level prompt pack for the current Mythos prompt-system model.

This is the master prompt pack for current-state repo work. It does not replace the bounded implementation packs. It chooses the truthful next loop-closure slice, delegates to the right bounded pack, and forces validation and completion audit before closeout.

Primary source material:
- [`claude-master-run-order.md`](./claude-master-run-order.md)
- [`claude-prompt-pack-operational-loop-closure.md`](./claude-prompt-pack-operational-loop-closure.md)
- [`whats-next.md`](../../whats-next.md)
- [`_dev/reports/analysis/plan-pipeline.md`](../reports/analysis/plan-pipeline.md)
- [`_dev/reports/analysis/plan-active-workstreams.md`](../reports/analysis/plan-active-workstreams.md)
- [`_dev/reports/analysis/review-active-workstreams.md`](../reports/analysis/review-active-workstreams.md)
- [`_dev/reports/analysis/review-progress__repo.md`](../reports/analysis/review-progress__repo.md)
- [`_dev/reports/analysis/prompt-system-assembly.md`](../reports/analysis/prompt-system-assembly.md)
- [`_dev/concepts/lessons-automation-design-decisions.md`](../concepts/lessons-automation-design-decisions.md)
- [`instructions/canonical/commands/execute-plan.yaml`](../../instructions/canonical/commands/execute-plan.yaml)

Primary child workflow:
- [`claude-prompt-pack-operational-loop-closure.md`](./claude-prompt-pack-operational-loop-closure.md)

## Goal

Run the current master workflow without reintroducing the old stage-and-track system and without widening into unrelated architecture work.

Desired outcome:
- the repo starts from current planning, current signals, and current lessons
- exactly one bounded implementation slice is chosen truthfully
- the bounded slice uses the right child workflow instead of improvising
- if Codex review is part of the slice, the managed listener lifecycle is handled truthfully
- validation and completion audit happen before closeout
- the sequence ends with one standard closeout bundle
- the final handoff names the exact next command

## Why This Exists

Mythos already has a master run-order file and a bounded operational loop-closure pack.

What was missing was a true master prompt pack artifact that:
- acts as the reusable top-level execution surface
- wraps the operational loop-closure pack instead of making the run-order file do all orchestration work
- gives the prompt system one real master pack, not just one primary reference

## Claude Optimization Notes

- Use the master pack for current-state repo work, not for reopening the historical 15-stage pipeline.
- Treat the operational loop-closure pack as the implementation sub-pack for current-state truth refresh.
- Prefer stopping with a truthful next command over widening into a second initiative.

## Multi-Agent Functionality

- Stay in the main thread for kickoff, synthesis, bounded-slice selection, validation review, and final closeout.
- Keep the main thread thin: it frames the slice, issues bounded instructions, performs extra checks, and synthesizes what to communicate to the user and to Codex.
- Read-only subagents are allowed only for inventory prompts.
- Write-owning workers are allowed only for the chosen bounded slice, with a disjoint file scope.
- Independent validation must be read-only and must not be owned by the same worker that implemented the slice.
- Validation and completion audit must remain read-only.
- Do not run multiple write-owning workers against overlapping `_dev/reports/` or `tools/codex/prompt-system/` files.

## Model Guidance

- Coordinator and worker prompts: strongest implementation-capable path available.
- Explorer prompts: read-only, bounded, inventory only.
- Validation and completion-audit prompts: read-only, findings-first, no new implementation.

## Execution Pattern

All bounded slices must follow the seven-step orchestration pattern defined in `instructions/canonical/commands/execute-plan.yaml`:

1. **Plan** — frame the slice, define acceptance criteria
2. **Build** — execute through bounded workers with disjoint scopes
3. **Verify** — independent read-only validation (mandatory, not advisory)
4. **Fix** — if verification finds failures, attempt fix cycle (max 2)
5. **Lessons Capture** — rolling capture during work (~3 substantive turns), plus event triggers on blocker/transition/correction/surprise. Append to session-learnings artifact.
6. **Codex Review** — publish HandoffSignal/1.0, generate bridge prompt, start managed listener (mandatory)
7. **Gate** — check criteria, update status, debrief before closeout

Debrief is mandatory before `ready_for_clear` for any meaningful run. The debrief produces an improve-plan (0-3 items) and replicate-plan (0-3 items). "No lesson" is a valid output.

## Recommended Execution Order

1. Coordinator kickoff
2. Parallel read-only inventory
3. Bounded implementation slice selection
4. Execute the bounded slice through the operational loop-closure pack (using seven-step pattern)
5. Validation
6. Completion audit (including debrief artifact check)

## Prompt 1: Coordinator Kickoff

```text
Run the current Mythos master workflow.

Read first:
- `tools/codex/prompt-system/claude-master-run-order.md`
- `tools/codex/prompt-system/claude-prompt-pack-master-loop-closure.md`
- `tools/codex/prompt-system/claude-prompt-pack-operational-loop-closure.md`
- `whats-next.md`
- `_dev/reports/analysis/plan-pipeline.md`
- `_dev/reports/analysis/plan-active-workstreams.md`
- `_dev/reports/analysis/review-active-workstreams.md`
- `_dev/reports/analysis/review-progress__repo.md`

Goal:
- decide the truthful current-state slice
- avoid reopening the historical master pipeline
- use the operational loop-closure pack only as a bounded implementation child workflow
- end with validation, completion audit, and exact next command

Required execution pattern:
1. Read the files above.
2. Produce a short plan with acceptance criteria.
3. Launch exactly two read-only subagents in parallel:
   - one for planning/signal truth inventory
   - one for lessons/meta/autonomy inventory
4. Synthesize findings in the main thread.
5. Choose exactly one bounded implementation slice.
6. Keep the main thread as coordinator only. The detailed research, implementation, and validation work should happen in bounded subagents or workers before the main thread advances.
7. Execute that slice through the operational loop-closure pack.
8. If the slice will rely on Codex feedback, start the managed 5-minute listener with `npm run signals:watch:codex:start` before reporting any auto-run status.
9. Validate with an independent read-only validator, not with the same worker that made the change.
10. If the slice started the managed Codex listener and no other live Codex-targeted scope still depends on it, stop it with `npm run signals:watch:codex:stop` before lessons/final closeout.
11. Launch one read-only completion-auditor-style subagent before final closeout.

Acceptance criteria:
1. The chosen slice is justified by current repo truth.
2. The work uses the operational loop-closure pack instead of inventing a new flow.
3. Any Codex handoff is reported truthfully as handoff prepared, auto-run active, or feedback received.
4. Validation and completion audit both run.
5. The final report names the exact next command.
```

## Prompt 2: Explorer A - Planning And Signal Inventory

```text
You are a read-only subagent.

Read:
- `_dev/reports/analysis/plan-pipeline.md`
- `_dev/reports/analysis/plan-active-workstreams.md`
- `_dev/reports/analysis/plan-active-workstreams.next-step.json`
- `_dev/reports/analysis/review-active-workstreams.md`
- `_dev/reports/analysis/review-progress__repo.md`
- inspect `_dev/reports/signals/` and `_dev/reports/signals/closed/`
- `tools/codex/prompt-system/claude-prompt-pack-operational-loop-closure.md`

Return exactly these sections:

Findings
- current planning truth
- current signal truth
- exact drift or stale claims that still justify a loop-closure slice

Recommended bounded slice
- the smallest truthful first slice
- why it should be done before any other slice

Risks
- risks of doing unnecessary work
- risks of leaving current drift in place

Do not edit files.
```

## Prompt 3: Explorer B - Lessons, Meta, And Autonomy Inventory

```text
You are a read-only subagent.

Read:
- `whats-next.md`
- `_dev/LESSONS_RECONCILIATION_LOOP_IMPLEMENTATION_PLAN.md`
- `_dev/COMMAND_ADHERENCE_AND_VALIDATION_HARDENING_IMPLEMENTATION_PLAN.md`
- `frameworks/meta/execution-normalization/manifest.json`
- `tools/autonomy/complete-task.cjs`
- `tools/codex/prompt-system/claude-prompt-pack-operational-loop-closure.md`

Return exactly these sections:

Findings
- what is already implemented
- what is still blocked, conceptual, or only partially validated

Recommended bounded slice
- the smallest truthful next slice from this lane
- why it is or is not the right first slice today

Risks
- overclaiming maturity
- widening into future work before current truth is aligned

Do not edit files.
```

## Prompt 4: Worker - Execute The Chosen Slice Through The Child Workflow

```text
Execute exactly one bounded current-state slice through the operational loop-closure pack.

Read first:
- `tools/codex/prompt-system/claude-prompt-pack-operational-loop-closure.md`
- the coordinator synthesis
- the two read-only inventory outputs

Task:
- choose the single truthful slice
- use the corresponding prompt or prompts from `claude-prompt-pack-operational-loop-closure.md`
- keep ownership bounded to the files required by that slice
- stop when the chosen slice is complete instead of widening into a second initiative unless validation proves the repo is stable enough to continue

Allowed slice families:
- planning and signal truth refresh
- lessons-loop operationalization
- meta-framework and autonomy truth refresh

Constraints:
- do not reopen the old 15-stage pipeline
- do not create a new queue or initiative unless the current repo truth requires it
- do not claim automation or validation exists when it is still conceptual
- do not claim the Codex listener is active unless `npm run signals:watch:codex:start` was actually launched and the status artifact supports it
- do not leave the managed Codex listener running past final closeout unless another still-live Codex-targeted queue needs it

Final response must include:
- chosen slice
- prompts used from `claude-prompt-pack-operational-loop-closure.md`
- changed files
- validations run
- Codex handoff state if applicable
- exact next command

Seven-step enforcement:
- rolling lessons capture must happen during the slice (~3 substantive turns + event triggers)
- Codex review signal and bridge prompt are mandatory after the slice
- debrief must run before closeout: produce improve-plan.json (0-3 items) and replicate-plan.json (0-3 items)
- block ready_for_clear until debrief artifacts exist for meaningful runs

Closeout bundle
- summary of what the sequence accomplished
- summary of lessons captured or an explicit note that no new lessons were warranted
- debrief summary with improve-plan and replicate-plan references
- action items revealed but not yet codified into prompt packs, commands, guardrails, tests, or workflow assets
- clear instruction: `recommended_next_command: clear` only when the run is actually ready for clear; otherwise list the exact pending items
```

## Prompt 5: Validation

```text
You are validating a bounded master-workflow slice in Mythos.

Read:
- the worker summary
- changed files
- `tools/codex/prompt-system/claude-prompt-pack-master-loop-closure.md`
- `tools/codex/prompt-system/claude-prompt-pack-operational-loop-closure.md`

Task:
- verify the chosen slice actually matches current repo truth
- verify no second initiative was implicitly opened
- verify the reported next command matches the resulting artifacts
- run the smallest truthful validation commands for the files changed

Return:
- findings first
- validation results
- any remaining drift
- whether completion audit should pass or reopen
- whether the closeout bundle is complete
```

## Prompt 6: Completion Audit

```text
You are a read-only completion auditor for the current Mythos master workflow run.

Read:
- the coordinator plan
- the worker output
- the validation output
- changed files

Audit questions:
1. Did the run use the master pack as a top-level workflow and the operational loop-closure pack as a bounded child workflow?
2. Did it complete exactly one truthful bounded slice?
3. Did validation run with evidence?
4. Did rolling lessons capture happen during the slice?
5. Did the debrief run and produce improve-plan and replicate-plan artifacts (or explicitly note "no lesson")?
6. Is the final next command exact and durable?
7. Should the run be accepted, reopened, or stopped pending operator choice?

Return:
- verdict
- findings first
- missing evidence or reopen reasons
- closeout bundle completeness
- exact next command
```
