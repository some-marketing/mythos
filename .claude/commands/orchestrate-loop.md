---
description: Run a general review-driven orchestration loop with explicit actor roles, evidence gates, Codex finding classification, and debrief closeout
mode: COORDINATOR
---

<objective>
Provide a reusable control loop for multi-actor Mythos work. The loop resolves the target, identifies the current state, chooses an execution shape, delegates or routes through native commands, collects evidence, classifies review findings, and emits the exact next action without collapsing coordinator, worker, reviewer, and human operator roles.
</objective>

<process>
- Resolve the target artifact before any execution. Prefer explicit paths, then signal scope, then prompt-plan registry id, then task-plan resolver. If more than one target matches, stop and report the ambiguity; do not guess.
- Load current loop context: governing plan or signal, latest amendments, latest review artifact for the same scope, latest debrief for the same scope, and operator-continuity state when present.
- Normalize the target into the recursive task kernel before choosing a route: Current State (what is true now), Question / Work (the one central question or work-unit), and Desired State (what should be true after resolution). The middle question is the work.
- Apply fractalization before delegation: if there is exactly one safe next step, execute or route it inside the current authority scope; if a safe binary choice appears, default to yes; if three choices include a do-both option, treat do-both as the single effective answer; if more than three steps or questions appear at one level, split into child tasks under the same desired state or sibling tasks when desired states differ.
- Resolve questions at the lowest possible level. Bubble up only questions that require the human operator's judgment, explicit approval, budget/scope/timeline commitment, client-facing risk acceptance, destructive or irreversible action, credential access, or resolution of same-rank authority conflict.
- Name task custody explicitly before delegation, closeout, or scoped commit: workstream scope, session id or run id when available, working directory, project/client/framework/system surface, custody_hierarchy, owned artifacts, and known out-of-scope dirty surfaces. When a task plan exists, prefer mechanically generated plan.scope_identity from tools/planning/lib/task-custody.js. Parallel workflows are normal; global dirty worktree state is context, not ownership.
- Name actor roles explicitly: human operator, coordinator agent, worker agent or bridge actor if any, Codex agent if in the review lane, and any other distinct actor. If the same session is coordinator, it must not silently become the worker after delegation has been selected. The coordinator is not the default worker.
- Classify the loop state as one of: ready_to_start, in_progress, mechanical_reconcile_needed, mechanical_reconcile_failed, ready_for_review_mechanically_verified, ready_for_review, review_returned, review_iteration_ceiling_reached, evidence_missing, plan_diverged, blocked, ready_for_clear, cycle_complete.
- Honor the repo-managed orchestrator-worker PreTool gate as reflex-tier evidence for role-boundary drift. When `tools/kernel/hooks/pretool-orchestrator-worker-gate.cjs` warns in observe-only mode, route direct coordinator mutation or analysis through the correct native command or bounded worker lane. When `MYTHOS_ORCHESTRATOR_GATE=1` blocks, do not bypass it. Subagents are exempt because they are already worker lanes.
- Track review-iteration count per review scope. When a single review scope (e.g., <task-id>-impl-review) accumulates N or more passes without NO_FINDINGS / clean verdict, classify the loop as review_iteration_ceiling_reached and route to /amend-plan for scope tightening OR to an operator-gate for evidence-vs-further-iteration decision. Default N=4; per-risk-tier override: low=3, medium=4, high=5. Evidence: this slice's Codex S11 iterated 6 times without escalation.
- Check for a registered mechanical reconciler for the resolved target or artifact type before spending another bridge or LLM turn. If one exists, run it or route to it first. Treat its output as evidence, not judgment. If it reports missing evidence or contract drift, classify the loop as evidence_missing, mechanical_reconcile_failed, or blocked and route to the exact repair or evidence command. If it passes, attach its artifact to the review or closeout packet and continue to the declared review lane.
- Choose the execution shape using the orchestrate-loop Claude skill decision tree: single-threaded, coordinator plus bounded worker, coordinator plus Codex review bridge, coordinator plus worker plus Codex review bridge, or blocked/operator gate.
- Route through native commands before custom behavior: /run-plan for executable plan artifacts, /execute-plan for compatible prompt plans, /follow-signal for live signal authority, /amend-plan for plan divergence, /dispatch-bridge for cross-actor handoff, /review-progress for findings-first review, /debrief-run for closeout, and /normalize-signals for signal hygiene.
- When work is delegated, require a bounded worker contract that names workstream scope, session/run id, working surface, owned artifacts, write surfaces, forbidden surfaces, execution mode, expected evidence, tests or smoke commands, return fields, and closeout ownership when the workflow is expected to end with debrief, next-session, cleanup, or scoped commit. The coordinator validates returned artifacts and does not treat worker summaries as completion evidence.
- Preserve task custody. Custody cascades downward to child tasks/delegations and upward to project/client/system rollups. Rollups may aggregate child_scopes, but they must not claim child artifacts unless explicitly listed in owned_artifacts. If two live workflows share artifact prefixes or signals, stop in needs_context or route to /normalize-signals before delegating. Closeout and scoped commits must include only artifacts tied to the current workstream scope unless the coordinator records an explicit cross-scope reason.
- Preserve closeout ownership. If a delegated worker or bridge worker did the substantive work, debrief, reconcile-lessons, next-session, cleanup, and scoped closeout commit stay in that delegated lane by default. If the coordinator did the substantive work directly, the coordinator owns debrief and closeout. Closeout must restate scope identity and explicit exclusions before any scoped commit. Do not ask the human operator before obvious closeout steps inside an already-authorized loop unless a destructive, external, ambiguous, or judgment-only gate appears.
- Use Codex as logical-core review when there are multiple viable routes, consequential assumptions, or disagreement with the coordinator's read. Do not convene extra actors by ceremony.
- When Codex review or another independent review returns, classify findings by severity and type before choosing the next action. Severity classes: CRITICAL, MAJOR, MINOR, INFO, NO_FINDINGS. Finding types: source_defect, evidence_missing, plan_divergence, stale_context, authority_boundary, schema_or_contract_drift, test_gap, scope_mismatch, unsafe_or_destructive_risk, blocked_external_dependency.
- Apply the review decision tree. CRITICAL or MAJOR source_defect, authority_boundary, schema_or_contract_drift, unsafe_or_destructive_risk, or scope_mismatch keeps the current stage blocked and routes to /amend-plan when assumptions or gates changed, then dispatches bounded repair work. Evidence_missing collects evidence and re-reviews without source repair unless source behavior is also implicated. Plan_divergence or stale_context routes to /amend-plan or /review-task-plan before implementation continues. MINOR findings close only when acceptance criteria and review lane say they are nonblocking; otherwise record follow-up tasks or bounded repair. INFO or NO_FINDINGS may close after evidence and debrief are complete.
- Never advance a downstream stage while unresolved or undeferred CRITICAL or MAJOR blockers remain on the current stage. A deferral must be durable: amendment, debrief, task record, or signal with explicit blocker and next command.
- Collect evidence before closeout: changed files, commands run, test outputs, smoke outputs, review artifacts, and validation state. If evidence is missing, classify the loop as evidence_missing rather than complete.
- Before declaring completion, run the independent review lane required by the governing plan or actual risk. For acceptance-grade system work, the producer cannot self-validate.
- Run /debrief-run for meaningful multi-step work before clearing the loop. If /debrief-run cannot resolve the target, write a truthful blocked or manual-debrief state with the exact missing resolver support.
- Write or update the appropriate HandoffSignal/1.0 state: ready-for-review, blocked, ready-for-clear, or cycle-complete. Include review and test evidence paths, not just narrative claims.
- Return a concise status to the human operator: resolved target, loop state, actor roles, review classification, evidence collected, blockers, and exact next command.
</process>

<success_criteria>
- Target resolved or ambiguity reported before execution
- Scope identity named before delegation, closeout, or scoped commit
- Current loop state classified explicitly
- Actor roles named without ambiguous role terms
- Execution shape chosen before delegation or review dispatch
- Native commands used for authority, plan divergence, bridge dispatch, review, signal following, debrief, and signal hygiene where applicable
- Every routed work unit is normalized as Current State, one Question / Work, and Desired State before recursion, delegation, or operator escalation
- More than three peer steps or questions at one level triggers child/sibling fractalization instead of a long flat task body
- Only questions requiring human judgment or protected approval gates bubble up to the human operator
- Codex or independent review findings classified by severity and type before next action
- Known deterministic checks are executed by registered tools before LLM review or worker dispatch. LLM turns are reserved for judgment, review classification, exception handling, and operator-facing synthesis
- CRITICAL and MAJOR findings block downstream stage advancement unless durably deferred
- Evidence gaps route to evidence collection rather than source repair by default
- Coordinator/worker/reviewer boundaries preserved
- Closeout owner is explicit before debrief/next-session/cleanup begins
- Meaningful loops end with debrief evidence and a truthful HandoffSignal/1.0 state
- Final output includes the exact next command
</success_criteria>

<handoff>
ready_to_start_task_plan: /run-plan <target> or /orchestrate <target> if execution-shape selection is still needed
live_signal: /follow-signal <signal-scope|--file path> --execute
plan_diverged: /amend-plan <target>
review_needed: /dispatch-bridge --target codex --task "<review task>" --command "/review-progress <scope>"
major_or_critical_findings: dispatch bounded worker repair, then tests, then Codex re-review
evidence_missing: run missing tests or smoke cases, attach evidence, then re-dispatch review
mechanical_reconcile_needed: run the target-specific reconciler, then reclassify
mechanical_reconcile_failed: do not dispatch broad review; fix the concrete missing evidence or drift first
ready_for_review_mechanically_verified: dispatch the declared review lane with the mechanical reconciler artifact attached
ready_for_clear: /debrief-run <target>, then close or emit next stage command
signal_surface_messy: /normalize-signals <scope>
</handoff>
