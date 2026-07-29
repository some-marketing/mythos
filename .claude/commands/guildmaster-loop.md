---
description: Guildmaster loop — the review-driven orchestration loop that routes multi-actor work without collapsing roles
argument-hint: <task | plan-path | workstream>
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

> Authority: `orchestrate-loop` — this mythic name is an alias; state and errors belong to the resolved command.

<objective>
Run the Guildmaster loop: a reusable control loop for work that needs more than one actor. The Guildmaster (orchestrator) resolves the target, reads current state, picks an execution shape, delegates or routes the work, collects evidence, classifies review findings, and emits the exact next action — without ever collapsing the Guildmaster (coordinator), the familiar/worker, the Adjudicator (reviewer), and the human operator into one role. In plain terms: this is an orchestration controller with explicit role boundaries and evidence gates.
</objective>

<process>
1. **Resolve the target first.** Treat the argument as a quest charter (task plan), a plan path, a loop charter under `_dev/loops/`, or a named workstream. If more than one target matches, stop and report the ambiguity — do not guess.
2. **Load context.** Read the governing plan (or, for a loop charter, the charter file itself under `_dev/loops/`), the latest review (trial) artifact for the same scope, and any prior debrief (chronicle) for the same scope.
3. **Normalize into the task kernel** before choosing a route: Current State (what is true now), Question / Work (the one central work-unit), and Desired State (what should be true after). The middle question is the work.
4. **Fractalize before delegating.** If there is exactly one safe next step, take it inside the current scope. If a safe binary choice appears, default to yes. If a "do both" option exists among three, treat do-both as the answer. If more than three peer steps or questions appear at one level, split into child quests (shared desired state) or sibling quests (differing desired states).
5. **Resolve questions at the lowest level.** Bubble up to the human operator only what needs human judgment: approval, budget/scope/timeline commitment, client-facing risk, destructive or irreversible action, credential access, or a same-rank authority conflict.
6. **Name the actors explicitly:** human operator, Guildmaster (coordinator), familiar/worker if any, and Adjudicator (independent reviewer) if in the review lane. If one session is the Guildmaster, it must not silently become the worker after it has chosen to delegate. The coordinator is not the default worker.
7. **Classify the loop state:** ready_to_start, in_progress, ready_for_review, review_returned, evidence_missing, plan_diverged, blocked, ready_for_clear, or cycle_complete.
8. **Run deterministic checks first.** If a mechanical checker (script, test, linter) can settle a question, run it before spending a review or model turn. Treat its output as evidence, not judgment.
9. **Choose an execution shape:** single-threaded; coordinator plus a bounded worker; coordinator plus an independent review; coordinator plus worker plus independent review; or blocked/operator-gate.
10. **Route through the native commands** rather than improvising: `/embark` (run-plan) to execute a plan, `/trial-quest` (review-task-plan) to review one, `/chronicle` (debrief-run) to close out. Prefer amending an owning plan over authoring a parallel one.
11. **When you delegate, write a bounded worker contract:** scope, working surface, owned artifacts, write surfaces, forbidden surfaces, execution mode, expected evidence, tests/checks, return fields, and who owns closeout. The coordinator validates the returned artifacts — a worker's summary is not completion evidence.
12. **When an independent review returns, classify findings by severity and type** before acting. Severity: CRITICAL, MAJOR, MINOR, INFO, NO_FINDINGS. Type: source_defect, evidence_missing, plan_divergence, stale_context, authority_boundary, contract_drift, test_gap, scope_mismatch, unsafe_risk, blocked_dependency.
13. **Apply the review decision tree.** CRITICAL/MAJOR source_defect, authority_boundary, contract_drift, unsafe_risk, or scope_mismatch keeps the stage blocked and routes to a plan amendment (if assumptions changed) then bounded repair. evidence_missing collects evidence and re-reviews. plan_divergence/stale_context re-plans before continuing. MINOR closes only if acceptance criteria allow; otherwise record follow-ups. INFO/NO_FINDINGS may close after evidence and debrief.
14. **Cap review iterations.** If one review scope runs several passes (default 4; low-risk 3, high-risk 5) without a clean verdict, stop and route to scope-tightening or an operator decision — do not silently dispatch another pass.
15. **Never advance a downstream stage** while an unresolved CRITICAL/MAJOR blocker stands on the current one, unless the deferral is recorded durably.
16. **Collect evidence before closeout:** changed files, commands run, test/check outputs, review artifacts. Missing evidence means the state is evidence_missing, not complete.
17. **The producer cannot self-validate acceptance-grade work.** Run the independent review lane the plan or risk requires before declaring done.
18. **Close the loop** with `/chronicle` for meaningful multi-step work, write a truthful status note under `_dev/reports/analysis/`, and return a concise status: resolved target, loop state, actor roles, review classification, evidence, blockers, and the exact next command.
</process>

<role_boundaries>
- The Guildmaster coordinates, resolves targets, writes/routes authority artifacts, validates evidence, integrates work, and reports. It is not the default worker.
- A familiar/worker implements bounded edits inside declared write and execution surfaces.
- The Adjudicator reviews through a distinct lane — a second model or a human, never the mind that produced the work. Its findings are control input, not commentary.
- The human operator resolves judgment gates, destructive gates, and same-rank governance conflicts.
- Whoever did the substantive work owns the closeout tail (debrief, cleanup, scoped commit) by default.
</role_boundaries>

<success_criteria>
- Target resolved or ambiguity reported before execution
- Loop state classified explicitly
- Actor roles named without ambiguity; coordinator/worker/reviewer boundaries preserved
- Execution shape chosen before delegation or review
- Deterministic checks run before model/review turns
- Review findings classified by severity and type before the next action
- CRITICAL/MAJOR findings block downstream advancement unless durably deferred
- The producer does not validate its own acceptance-grade outcome
- Meaningful loops end with debrief evidence and a truthful status note
- Final output includes the exact next command
</success_criteria>

<handoff>
ready_to_start: /embark <target>
plan_diverged: re-plan or amend the owning quest charter before continuing
review_needed: request an independent review from a second model or a human reviewer
ready_for_clear: /chronicle <target>, then close out or emit the next stage command
</handoff>
