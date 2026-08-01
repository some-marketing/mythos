---
description: Run a findings-first review of progress or pipeline output
mode: REVIEW_ONLY
---

<objective>
Independently assess current progress or output quality, produce a findings-first review, and capture unmet output expectations in _dev/reports/analysis/.
</objective>

<process>
- Resolve scope from arguments: if empty, review overall repo progress; if 'pipeline', review historical main-pipeline progress and its current replacement state; if 'advance-pipeline', review latest legacy master-plan execution evidence; if 'active-workstreams', review the current bounded queues; if a path, review that target.
- Read the governing sources for the chosen scope: for prompt-system or pipeline reviews, read _dev/prompts/claude-master-run-order.md; for active-workstreams, read _dev/reports/analysis/plan-active-workstreams.md, _dev/reports/analysis/plan-active-workstreams.next-step.json, and the live coordination signals for each queued signal_scope; read any prompt packs, command docs, or lifecycle artifacts referenced by the target; read relevant evidence from _dev/reports/analysis/, _dev/reports/lifecycle/, and _dev/reports/signals/ when present.
- For long-running multi-actor loops or repeated command work, also inspect the latest same-day session-learnings__*.md artifact and the most recent review artifact for the same scope to catch recurring drift rather than treating each pass as isolated.
- Derive the output expectations from the source-of-truth docs. Do not trust self-reported completion claims without evidence.
- Compare expected versus observed state and identify: blocker-level misses, warning-level drift or partial completion, and truthful completions with sufficient evidence.
- Write a markdown review to _dev/reports/analysis/review-progress__<scope-safe>.md.
- Write an expectation-failure capture to _dev/reports/analysis/review-progress__<scope-safe>.expectation-failures.json with scope, reviewed_at, source_of_truth, and failures array (id, severity, expected, observed, evidence, recommended_next_action). Write with empty failures array if no failures.
- Report findings to the user in order: findings by severity, open questions or assumptions, short progress summary.
</process>

<success_criteria>
- Review scope resolved from arguments or defaulted safely
- Source-of-truth docs read before judging completion
- Findings reported with file/path evidence when available
- Expectation-failure capture written even when empty
- User receives a concise findings-first assessment
</success_criteria>

<handoff>
prompt_system_drift: assemble-prompt-system all
repo_coherent_not_queued: plan-pipeline
stage_ready_to_execute: execute-plan master
master_pipeline_complete_multiple_queues: plan-active-workstreams
lessons_reconciliation_cadence_hit: reconcile-lessons
pipeline_review_but_master_pipeline_complete: review-progress repo or plan-active-workstreams
</handoff>
