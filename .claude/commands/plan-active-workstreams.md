---
description: Plan the current bounded follow-on queues after the master pipeline is complete
mode: REVIEW_ONLY
---

<objective>
Choose the truthful next bounded queue after master-pipeline completion, assign ownership cleanly, and write a stable active-workstreams planning artifact with the exact next command.
</objective>

<process>
- Read the current bounded-work source of truth: _dev/reports/analysis/plan-active-workstreams__2026-03-28.md when present, _dev/reports/signals/ for live coordination signals, _dev/reports/analysis/plan-pipeline.md, and _dev/reports/analysis/plan-pipeline.next-step.json.
- Confirm that the master pipeline is complete and should not be reopened as another numbered stage.
- Determine the primary active queue, the secondary queue if any, the exact next command for the highest-priority queue, and whether any live signal conflict, stale assignment, or queue ambiguity needs cleanup first.
- Write two stable artifacts: _dev/reports/analysis/plan-active-workstreams.md and _dev/reports/analysis/plan-active-workstreams.next-step.json.
- The planning JSON must include: planned_at, current_queue_summary, next_recommended_command, recommended_model, why_this_is_next, blocking_conditions, and active_queues.
- If the highest-priority queue has just completed a validated slice, record whether the correct next action is to push that bounded slice to remote before opening the next queue increment.
- If the next queue increment is lane expansion, define the activation threshold explicitly: adoption evidence required, what metrics must look healthy, and the exact condition that allows or blocks enabling the next lane.
- Report the primary queue, exact next command, and any queue ambiguity or signal conflict.
</process>

<success_criteria>
- Master-pipeline completion confirmed before switching to active queues
- Stable active-workstreams planning artifacts written
- One primary queue selected with an exact next command
- Queue ambiguity or signal conflict surfaced explicitly if present
</success_criteria>

<handoff>
assignments_or_live_signals_stale: review-active-workstreams
signal_conflict_detected: normalize-signals
queue_clear_for_execution: use the exact command from plan-active-workstreams.next-step.json
</handoff>
