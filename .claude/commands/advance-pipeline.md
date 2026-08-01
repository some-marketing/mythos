---
description: Legacy alias for execute-plan master
mode: COORDINATOR
---

<objective>
Preserve backward compatibility for operators who still invoke advance-pipeline, but resolve that request through the canonical master plan executor instead of maintaining a separate execution contract.
</objective>

<process>
- Treat advance-pipeline as a compatibility wrapper, not an independent workflow definition.
- Read instructions/canonical/commands/execute-plan.yaml and _dev/prompts/prompt-plan-registry.json first.
- If the argument is empty or 'master', execute the canonical master plan exactly as execute-plan master would.
- If the argument is 'list', list compatible prompt plans exactly as execute-plan list would and do not execute anything.
- If any other argument is provided, stop and direct the operator to run-plan <plan-id|task-id|path> for general plan execution, or execute-plan <plan-id> for specialist prompt-plan execution.
- Do not preserve or reintroduce the historical stage-and-track execution contract here. The execution grammar, verification rules, and gate behavior are owned by execute-plan.
- Reuse the master plan's existing execution artifacts and planning refresh rules so legacy invocations remain observationally compatible.
</process>

<success_criteria>
- Legacy invocations resolve to the same behavior as execute-plan for equivalent requests
- Operators are redirected to /run-plan for new plan execution (any type)
- No separate historical execution contract remains in advance-pipeline
</success_criteria>

<orchestration_rules>
- Prefer /run-plan for all new operator usage. /execute-plan remains the specialist prompt-plan executor used internally.
- Do not diverge from execute-plan behavior for equivalent requests.
- Do not advertise advance-pipeline as the primary plan executor.
- Never invent plan-specific logic inside this alias.
</orchestration_rules>

<handoff>
operator_wants_to_run_a_plan: run-plan (primary operator execution router — handles task plans and prompt plans)
prompt_plan_specialist_execution: execute-plan master
list_available_plans: execute-plan list
non_master_target_requested: run-plan <plan-id|task-id|path>
blocker_or_suspicious_success: review-progress pipeline
</handoff>
