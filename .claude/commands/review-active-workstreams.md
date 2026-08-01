---
description: Review the current bounded active workstreams after master-pipeline completion
mode: REVIEW_ONLY
---

<objective>
Run a findings-first review of the bounded follow-on queues, focusing on assignment clarity, signal truth, queue conflicts, and whether the current next-step recommendations are still accurate.
</objective>

<process>
- Read _dev/reports/analysis/plan-active-workstreams.md, _dev/reports/analysis/plan-active-workstreams.next-step.json, the live coordination signals in _dev/reports/signals/, and the directly referenced plans/task maps for the active queues.
- Check whether each active signal_scope has at most one live signal, whether the assigned actor and exact next command are still truthful, whether the primary and secondary queues are still the right split, and whether queue status on Dart would now be inconsistent with repo truth.
- Write _dev/reports/analysis/review-active-workstreams.md and _dev/reports/analysis/review-active-workstreams.expectation-failures.json.
- The expectation-failure JSON must include scope, reviewed_at, source_of_truth, and a failures array with id, severity, expected, observed, evidence, and recommended_next_action.
- Report findings first, then the truthful next queue step.
</process>

<success_criteria>
- Current active queues reviewed against live signals
- Findings written even when the result is no findings
- Queue ownership and next-step truth checked explicitly
</success_criteria>

<handoff>
assignments_need_refresh: plan-active-workstreams
stale_or_duplicate_signals: normalize-signals
queue_split_coherent: use the exact command from plan-active-workstreams.next-step.json
</handoff>
