---
description: Choose the next eligible stage or infrastructure track before execution
mode: REVIEW_ONLY
---

<objective>
Plan the next pipeline move from the master run order, identify the next eligible stage or track, and write a planning artifact that recommends the exact next command and model to use.
</objective>

<process>
- Read tools/codex/prompt-system/claude-master-run-order.md as the source of truth.
- Inspect current repo evidence relevant to stage eligibility: referenced prompt packs and docs, stage status notes in the master doc, _dev/reports/analysis/, _dev/reports/lifecycle/, and _dev/reports/signals/ when relevant to a stage's gate criteria.
- Determine: the next eligible main stage (if any), any cross-cutting infrastructure track that should be run now or in parallel, any blocker, human gate, or deferral that prevents advancement, and whether the master pipeline is already complete so active-workstream planning should take over.
- Write two artifacts: planning report to _dev/reports/analysis/plan-pipeline.md and planning signal to _dev/reports/analysis/plan-pipeline.next-step.json.
- The planning signal must include: planned_at, current_state_summary, next_recommended_command, recommended_model, why_this_is_next, blocking_conditions, and secondary_recommendations.
- When the previous slice is validated and materially changes repo truth, the plan should prefer commit/push before the next major stage or queue increment unless there is a concrete reason not to.
- Report to the user: next recommended command, recommended model, why it is next, and any blocker or gate.
</process>

<success_criteria>
- Master run order inspected before recommending a next step
- Next command and recommended model stated explicitly
- Planning artifact written to _dev/reports/analysis/
- Blockers, human gates, or deferrals surfaced when present
</success_criteria>

<handoff>
prompt_system_drift: assemble-prompt-system all
stage_clear_for_execution: run-plan master (or execute-plan master for specialist prompt-plan execution)
latest_result_suspicious: review-progress pipeline
master_pipeline_complete_bounded_follow_on: plan-active-workstreams
general_plan_execution: run-plan (primary operator router for all plan types)
</handoff>
