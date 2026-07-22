# Claude Master Run Order

Single source of truth for the current top-level Claude prompt-system workflow in `_dev/prompts/`.

This file answers one question:

**If you want Claude to improve current-state work today, what exact main workflow should it run, and when should it stop before widening into other work?**

Use this as the top-level orchestration document.

## Canonical Main Workflow

There is one canonical main workflow for the current prompt-system authoring model:

- [`<your-canonical-pack>.md`](./<your-canonical-pack>.md)

This pack is the only active top-level workflow.

Use it when the working mind needs to:
- choose the truthful current-state slice
- refresh planning truth
- refresh signal truth
- operationalize the lessons loop
- refresh meta-framework and autonomy truth
- end with validation and completion audit

All other prompt packs in `_dev/prompts/` are not co-equal top-level workflows.

Treat them as one of:
- supporting source material
- bounded sub-workflows invoked by the canonical main workflow
- historical or completed lanes that must not be reopened implicitly

## Current Operational Truth

<!-- Replace this section with the plain-language state of your own repo: what pipeline
     stage you're in, what's complete, what's deferred, and why the current lane is the
     right one to run next. Point at durable evidence artifacts, not memory. -->

Current truth:
- `<summarize what prior sequence completed or was intentionally deferred>`
- `<name the actual next-value work: loop closure, truth maintenance, or a fresh stage>`
- follow-on work should start from current planning, current signals, and current lessons — not from replaying an old stage order

Evidence:
- [`_dev/reports/analysis/<your-evidence-doc>.md`](../reports/analysis/<your-evidence-doc>.md)
- [`_dev/reports/analysis/plan-pipeline.md`](../reports/analysis/plan-pipeline.md)
- [`_dev/reports/analysis/plan-active-workstreams.md`](../reports/analysis/plan-active-workstreams.md)
- [`_dev/reports/analysis/review-active-workstreams.md`](../reports/analysis/review-active-workstreams.md)
- [`whats-next.md`](../../whats-next.md)

Do not silently reopen an old master sequence.

Only reopen an older prompt-pack lane if:
- the current loop-closure workflow explicitly identifies it as the next bounded slice, or
- a human explicitly directs that older lane to be reopened

## Distinct-Family Review / Operator Bridge Rule

When the working mind needs independent review from a distinct-family reviewer, or operator input, it must not pretend it can directly open that reviewer's turn.

Instead, use the durable bridge:
- publish a live handoff note in `_dev/reports/signals/` (closed notes move to `_dev/reports/signals/closed/`)
- update the linked task-tracking surface when one exists
- assign the task to the human operator when operator input is needed
- generate or reference a ready-to-paste reviewer prompt via your bridge-dispatch tooling

This bridge is part of the normal command flow:
- the working mind executes
- signals capture the handoff
- the task tracker reflects operator-visible state when needed
- the distinct-family reviewer reviews or plans from the resulting prompt and artifacts

Listener and handoff scoping rules:
- the main pipeline listener must only react to main-pipeline signals and must ignore signals that carry `signal_scope`
- a scoped workstream listener must only react to its exact `signal_scope`
- an auto-run listener must only react to signals with the correct `recommended_next_actor`
- do not dump ambient repo or unrelated workstream context into a handoff
- every cross-actor handoff should carry only:
  - exact target actor
  - exact scope
  - exact next command
  - exact artifact list
  - exact blockers or decisions still in play

## Default Execution Order

Run the canonical main workflow in this order:

1. Coordinator kickoff
   Use Prompt 1 from [`<your-canonical-pack>.md`](./<your-canonical-pack>.md).
2. Parallel read-only inventory
   Use Prompts 2 and 3 from the same pack.
3. Bounded slice execution
   Use Prompt 4 from the same pack, which dispatches into the operational loop-closure child workflow.
4. Validation
   Use Prompt 5.
5. Completion audit
   Use Prompt 6.

## Stop Rules

Stop after Prompt 4 and do not widen further if:
- current planning and signal surfaces are still contradictory
- the truthful next move is a bounded planning refresh rather than implementation
- a blocker requires operator judgment

Stop after Prompt 5 and do not widen further if:
- the lessons loop still lacks a safe trigger or artifact contract
- the truthful next move is to review the new lessons surface before more automation

Stop after Prompt 5 and do not emit ready_for_clear if:
- session-learnings artifact was not updated during the slice (rolling capture missed)
- debrief artifacts (improve-plan, replicate-plan) do not exist for meaningful runs

Stop after Prompt 6 and leave explicit gates instead of automation if:
- meta execution-normalization still lacks real validation evidence
- autonomy maturity still lacks the run-log evidence required in [`whats-next.md`](../../whats-next.md)
- the system would otherwise overclaim true replay, maturity, or graduation

## Supporting Prompt Systems

These prompt packs may be used as supporting inputs or bounded sub-workflows inside the canonical main workflow. List your own here, grouped by role, e.g.:

### Planning, Signal, And Control-Plane Support

- `<pack-a>.md`
- `<pack-b>.md`

### Framework And Maturity Support

- `<pack-c>.md`
- `<pack-d>.md`

### Historical Or Completed Lanes

These remain valuable references but are not the active top-level workflow:

- `<retired-pack>.md`

## Standalone / Not Sequenced

- `<standalone-pack>.md`
  `<one line on why it's a bounded side-lane, not part of the sequence>`

## Planning References

- [`whats-next.md`](../../whats-next.md)
- [`_dev/reports/analysis/review-progress__repo.md`](../reports/analysis/review-progress__repo.md)
- [`_dev/reports/analysis/review-active-workstreams.md`](../reports/analysis/review-active-workstreams.md)
- [`_dev/reports/analysis/plan-active-workstreams.md`](../reports/analysis/plan-active-workstreams.md)

## Success Condition

The master run order is coherent only if:
- it names exactly one canonical main workflow
- that workflow matches the current repo problem, not a historical pipeline
- other prompt packs are clearly classified as supporting, historical, or standalone
- no older stage or track system is still implicitly exposed as the active top-level path
- the seven-step orchestration pattern (plan-build-verify-fix-lessons-review-gate) is referenced as the execution standard for bounded slices
- debrief is required before ready_for_clear for meaningful runs

If that stops being true, the next command is:
- `/author-prompt-system master`

After a successful authoring pass, the normal follow-up is:
- `/assemble-prompt-system master`
