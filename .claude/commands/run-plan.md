---
description: Resolve a plan-like artifact and route it to the correct execution pathway
mode: COORDINATOR
---

<objective>
Provide one operator-facing command that inspects a target plan artifact, determines whether it is an execution plan, task plan, or unsupported review artifact, and then routes it to the correct execution and review workflow truthfully.
</objective>

<process>
- Resolve the target artifact from the argument. Prefer explicit paths when provided; otherwise check tools/codex/prompt-system/prompt-plan-registry.json ids first, then use the shared task-plan resolver (tools/planning/lib/resolve-task-plan.js) which searches system and client roots with ambiguity blocking.
- Inspect the resolver result for owned_artifacts_audit. If the audit is non-null and missing[] is non-empty, surface a STATE-RECONCILIATION WARNING block listing the missing paths BEFORE routing. The warning is informational, not blocking — the operator decides whether to investigate (likely a branch-state issue: cherry-pick from archive, re-run a prior slice, or amend the plan) or proceed. Audit fields: existing[] (paths present on disk), missing[] (paths absent from disk and not declared NEW by any step), planned_new[] (paths declared as files to be created by a step's files_touched (NEW) marker), glob_patterns_not_validated[] (paths containing glob characters; not checked).
- Inspect the artifact type before acting.
- If the artifact satisfies the prompt-plan contract from tools/codex/prompt-system/plan-contract.md (ordered stages, observable exit criteria, prompt/workflow references where applicable, status surface), route to execute-plan.
- If the artifact is a task plan produced by /plan-task (task-intake schema JSON and matching markdown summary), do NOT pretend it is a prompt plan. Instead, execute it as a bounded task-implementation workflow: read the plan artifacts, honor gates and trust tier, use matched frameworks where applicable, implement the bounded task directly, verify the result, choose the correct post-execution review lane, and report remaining blockers truthfully.
- Before launching any write-capable or credential-dependent subagent during task-plan execution, run a preflight: prove the target write scope with a tiny disposable write, prove required credential paths are readable, and fail fast if either check fails.
- Do not source broad .env files inside subagents when a targeted secret extraction is sufficient. Extract only the exact variable needed and pass it via a temp file or explicit argument.
- For browser-authenticated work, prefer the proven authenticated session unless a fresh subagent session has explicitly demonstrated the same access.
- If the artifact is review-only, ambiguous, or missing the minimum structure needed for safe execution, stop and report why it cannot be run yet. Recommend the exact next command or conversion step.
- When routing to execute-plan, either invoke /execute-plan with the resolved plan id/path or clearly hand off to that exact command.
- When routing to task-plan execution, use the task plan as the source of truth for covered steps, gap steps, gates, and expected outcomes. Do not require the operator to restate the task.
- For task-plan execution: keep the work bounded to the scope expressed in the task plan, surface human gates before mutation steps, and verify completion against the task plan's expected outcomes and gates.
- After direct verification of a task-plan slice, route the slice into one of three closeout lanes: verify-local, codex-bridge, or operator gate.
- Honor an explicit task-plan review expectation when present, such as review_lane, trust tier, or equivalent closeout metadata, unless actual execution risk exceeded that expectation.
- Use verify-local only for low-risk, small, single-surface, repo-local slices with no credential dependency, no browser-auth dependency, no staging/production mutation, and no launch-critical or external-account impact. Record the verify-local JSON envelope as a durable analysis artifact. If verify-local exits with escalation or error, do not treat the slice as locally cleared; route it to codex-bridge or operator gate instead.
- Use codex-bridge for task-plan slices that are cross-surface, launch-critical, staging/production facing, browser-admin or credential dependent, external-account dependent, or otherwise above the local-first lane. Publish a truthful HandoffSignal/1.0, generate the codex bridge prompt artifact, and if the managed bridge runner is available dispatch it before reporting the slice complete.
- Use operator gate when the next step truly requires human judgment, human approval, missing credentials, or access that neither direct execution nor codex-bridge can resolve.
- Never collapse the distinction silently. Report both routes chosen: execution route and post-execution review route.
</process>

<success_criteria>
- Target artifact resolved before any execution
- Artifact type classified truthfully
- Correct route selected: execute-plan, task-plan execution, or blocked/unsupported
- Operator is not required to know the plan type in advance
- If execution occurs, verification evidence is produced for the bounded slice
- Write-capable subagent launches do not proceed without preflight proof of write access and credential-path readability
- Task-plan execution ends with an explicit post-execution review route and matching evidence artifacts
- Actor-bridge review lanes auto-dispatch when available or block truthfully when unavailable
</success_criteria>

<handoff>
prompt_plan_detected: execute-plan <resolved-plan>
task_plan_detected: run the bounded task-plan implementation workflow directly from the task plan artifacts, then route closeout to verify-local, codex-bridge, or operator gate
unsupported_or_ambiguous: review-task-plan, plan-task, or author a compatible execution plan depending on the blocker
plan_diverged_during_execution: /amend-plan <task-id> — when execution reality materially diverges from plan assumptions (changed dependencies, outputs, gates, risk tier, or review lane)
</handoff>
