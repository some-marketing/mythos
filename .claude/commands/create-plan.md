---
description: Operator-friendly alias for plan-task
mode: REVIEW_ONLY
---

<objective>
Provide a natural-language operator entry point for bounded task planning while delegating the actual planning workflow to the canonical plan-task process and artifact contract.
</objective>

<process>
- Treat create-plan as a compatibility wrapper around plan-task, not as an independent planning contract.
- Resolve the arguments using the same grammar as plan-task: task description or Dart task id plus optional client/project/source flags.
- Load the canonical plan-task skill/process and run the same similarity assessment and bounded planning workflow.
- Determine scope_type: if the task has a client_code and is client delivery work, scope_type is 'client' with storage_root 'clients/{client_code}/plans'; if the task is framework, runtime, or cross-client system work, scope_type is 'system' with storage_root '_dev/reports/analysis/task-plans'. Write plan artifacts to the resolved storage_root using the task-intake schema and markdown summary.
- Require the same explicit routing metadata as plan-task: risk_tier, review_lane, review_lane_rationale, and optional escalation_triggers.
- If the task is linked to Dart, preserve the normal planning breadcrumb/writeback proposal behavior from plan-task.
- Do not invent a second artifact schema or alternate execution path. Approved plans still execute through run-plan.
</process>

<success_criteria>
- Operators can invoke create-plan with natural task wording
- The resulting artifacts match the same bounded task-plan contract as plan-task
- The resulting artifacts include explicit run-plan routing expectations
- No duplicate planning schema or routing ambiguity is introduced
- Execution handoff remains run-plan for approved task plans
</success_criteria>

<handoff>
plan_created: review-task-plan <task-id|path> or run-plan <task-id|path>
queue_truth_needed_first: npm run next-step
system_status_needed_first: mythos-status
</handoff>
