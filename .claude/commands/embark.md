---
description: Embark — resolve a plan artifact and route it to the correct execution pathway
argument-hint: <task-id | plan-path>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Authority: `run-plan` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Embark on a quest: inspect a plan artifact, determine what it is (an executable plan or a quest charter produced by `/plan-quest`), and route it to the correct execution and review pathway truthfully — so the operator does not need to know the plan type in advance.
</objective>

<process>
1. **Resolve the target** from the argument (task id or explicit path). When the operand names a grimoire rather than a plan path, first resolve it through the alias registry (the canonical registry, then the user overlay at `$MYTHOS_HOME/aliases.yaml`, within the `frameworks` domain) to a canonical `service/framework` id — `resolveAlias('frameworks', <operand>)` in `tools/user/resolve-alias.cjs`. If the charter declares owned artifacts and some are missing from disk, surface a STATE-RECONCILIATION WARNING before routing; it is informational, not blocking.
2. **Classify the artifact** before acting. If it is a quest charter (task plan) from `/plan-quest`, do not pretend it is a generic execution plan. Execute it as a bounded task-implementation workflow: read the charter, honor its gates (saving throws) and trust tier, use matched grimoires where applicable, implement the bounded task, verify the result, and choose the correct post-execution review lane.
3. **Preflight before any write-capable or credential-dependent step.** Prove the target write scope with a tiny disposable write, prove any required credential paths are readable, and fail fast if either check fails. Extract only the exact secret needed — never source broad environment files when a targeted extraction suffices.
4. **Keep execution bounded** to the charter's scope. Surface human gates before mutation steps. Verify completion against the charter's expected outcomes and gates.
5. **Route closeout to one of three lanes:**
   - **verify-local** — only for low-risk, small, single-surface, repo-local slices with no credential, browser-auth, or staging/production dependency. Record a durable verification artifact. If verification escalates or errors, do not treat the slice as cleared — route it onward.
   - **independent-review** — for cross-surface, launch-critical, staging/production, credential-dependent, or external-account slices. Have a distinct mind (a second model or a human) review it, and record a truthful status note before reporting the slice complete.
   - **operator-gate** — when the next step truly needs human judgment, approval, or access that neither execution nor independent review can resolve.
6. **If the artifact is review-only, ambiguous, or missing structure needed for safe execution,** stop and report why, recommending the exact next command.
7. **If execution reveals that plan assumptions materially changed** (dependencies, outputs, gates, risk tier, or review lane), stop and re-plan/amend durably — do not silently adjust the plan in chat.
8. **Report both routes chosen:** the execution route and the post-execution review route. Never collapse the distinction silently.
</process>

<success_criteria>
- Target resolved and artifact type classified truthfully before any execution
- Correct route selected: bounded task-plan execution, generic plan execution, or blocked/unsupported
- Write-capable steps do not proceed without preflight proof of write access and credential readability
- Execution ends with an explicit post-execution review route and matching evidence
- Plan divergence during execution triggers a durable amendment, not a silent in-chat edit
</success_criteria>

<handoff>
task_plan_detected: run the bounded charter implementation, then route closeout to verify-local, independent-review, or operator-gate
unsupported_or_ambiguous: /trial-quest or /plan-quest depending on the blocker
plan_diverged_during_execution: amend the quest charter durably, then resume
</handoff>
