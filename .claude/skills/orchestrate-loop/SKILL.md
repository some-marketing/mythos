---
name: orchestrate-loop
description: >
  General review-driven orchestration loop for Mythos. Use when work needs a
  controller that can resolve plans, signals, review artifacts, or active
  workstreams; preserve coordinator/worker/reviewer boundaries; classify
  Codex findings; route through native commands; and close through evidence,
  debrief, and truthful signals.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>
<prime_directive>
Run the loop. Do not collapse the loop into chat judgment. Review findings are typed control input; actor roles are separate; evidence determines state.
</prime_directive>

<objective>
Provide a general orchestration workflow for Mythos. The skill receives a target context from `/orchestrate-loop`, classifies the current state, chooses the next native route, handles Codex or other review findings through a decision tree, and returns the exact next command. Repair is one branch of the loop, not the whole loop.
</objective>

<quick_start>
1. Resolve the target and classify the loop state before taking action.
2. Normalize the target into the recursive task kernel: Current State, one Question / Work, and Desired State.
3. If there is one safe next step, route it. If there are more than three peer steps or questions, recurse into children or split siblings before routing.
4. Name the workstream scope, session id or run id when available, working directory/project surface, human operator, coordinator Claude agent, worker agent if any, and reviewer actor if any.
5. Choose the execution shape. The coordinator is not the default worker.
6. Run a registered mechanical reconciler before another bridge/LLM turn when one exists for the target or artifact type.
7. If Codex findings are present, classify them by severity and type.
8. Choose the native route: `/follow-signal`, `/run-plan`, `/execute-plan`, `/amend-plan`, `/dispatch-bridge`, `/review-progress`, `/debrief-run`, or `/normalize-signals`.
9. If the selected workflow has a closeout tail, route debrief/next-session/cleanup through the actor that did the substantive work unless the coordinator did that work directly.
10. Return one exact next command or a truthful blocked state.
</quick_start>

<arc_state_check>
When the target already lives inside an active actor arc:
- Read `/arc-status` before deciding whether the loop is continuing the same arc or trying to self-mint a new one.
- Use `/arc-rest`, `/arc-blocked`, and `/arc-complete` as the explicit lifecycle transitions.
- Do not flatten arc lifecycle into chat summaries. State lives in the arc snapshot, not in coordinator narration.
</arc_state_check>

<execution_mode>
COORDINATOR. The skill routes work and writes orchestration artifacts only through native surfaces. Source edits belong to a bounded worker or the selected native execution command, not to the coordinator by default.
</execution_mode>

<model_recommendation>
Use sonnet for ordinary loop routing. Use opus only when the review findings are governance-shaping, ambiguous across multiple plans, or require deep synthesis across stale artifacts.
</model_recommendation>

<when_to_use>
Use this skill when the work involves any of:
- a task plan, prompt plan, signal, review artifact, or active workstream that needs next-step routing
- Codex findings or another independent review result
- a blocked stage that might need amendment, worker repair, evidence collection, or re-review
- coordinator/worker/reviewer role separation
- multi-step work that must end with evidence, debrief, and a truthful signal

Do not use this skill for a single low-risk source edit with no review lane and no orchestration state. Use the ordinary task workflow instead.
</when_to_use>

<safety_rules>
- Never read or expose credentials, PII, or `.env` values while resolving context.
- Never run destructive operations from this skill.
- Never advance downstream stages while unresolved or undeferred CRITICAL or MAJOR findings remain.
- Never let a coordinator silently become a source-editing worker after delegation was selected.
- Never treat a worker summary or chat message as completion evidence.
</safety_rules>

<execution_rules>
- Native commands own native actions; return the command instead of recreating its behavior.
- Evidence gaps are their own state and do not automatically imply source repair.
- Plan divergence routes to `/amend-plan` before implementation continues.
- Independent review is required for acceptance-grade system work.
- Meaningful multi-step loops require `/debrief-run` before closure.
- The repo-managed PreTool hook may surface an orchestrator-worker gate when a coordinator attempts direct mutation or analysis work that should belong to a bounded worker. Treat that gate as control-plane evidence: in observe-only mode, route the work through the correct native command or worker lane; in enforcing mode, do not bypass it.
</execution_rules>

<recursive_task_kernel>
Every loop target must be expressed as:

1. `Current State` - what is true now, with source or artifact context.
2. `Question / Work` - the one central question or work-unit to resolve.
3. `Desired State` - what should be true after resolution.

The middle question is the work.

Rules:
- If there is exactly one safe next step, execute or route it inside the current authority scope.
- If a safe binary choice appears, default to yes and record the defaulted decision.
- If three choices include an option that means "do both," treat do-both as the single effective answer.
- If more than three peer steps or questions appear at one level, recurse downward into child tasks when they serve the same desired state, or split sideways into sibling tasks when they have different desired states.
- Questions resolve at the lowest possible level. Bubble up only questions requiring human judgment, explicit approval, budget/scope/timeline commitment, client-facing risk acceptance, destructive or irreversible action, credential access, or same-rank authority conflict.
- Child results bubble upward as answer, resulting state, and parent impact.

These defaults do not override execution modes, data safety, destructive-operation confirmation, external/publication approval gates, or review-lane requirements.
</recursive_task_kernel>

<required_inputs>
The invoking command should provide:
- resolved target id or path
- workstream scope and session/run id when available
- current working directory and project/client surface
- artifact type if known
- governing plan, signal, or review paths
- latest amendment/debrief paths if present
- actor roles already involved
- evidence already run
- blockers already known

If these are missing, classify the state as `needs_context` and return the exact native command or file read needed to resolve it.
</required_inputs>

<loop_states>
- `needs_context` - target or authority cannot be resolved yet
- `ready_to_start` - plan or signal is executable and no review blocker is active
- `in_progress` - worker or execution lane is active
- `mechanical_reconcile_needed` - a registered deterministic reconciler exists and has not been run against the current evidence set
- `mechanical_reconcile_failed` - a deterministic reconciler found missing evidence, contract drift, unsafe temporary grants, commit-scope drift, or unsupported signal-validation claims
- `ready_for_review_mechanically_verified` - deterministic checks passed and the declared review lane still needs to judge the work
- `ready_for_review` - work/evidence exists and needs independent review
- `review_returned` - Codex or another reviewer has returned findings
- `review_iteration_ceiling_reached` - a single review scope has accumulated N or more passes (default N=4; low=3, medium=4, high=5) without reaching NO_FINDINGS / clean verdict; route to `/amend-plan` or operator-gate rather than silently dispatch another pass
- `evidence_missing` - review or closeout cannot evaluate because evidence is absent
- `plan_diverged` - execution reality differs from plan assumptions, gates, scope, risk tier, or review lane
- `blocked` - a named blocker prevents progress
- `ready_for_clear` - review passed or blockers are deferred and debrief/clearance is next
- `cycle_complete` - debrief and truthful closeout state exist
</loop_states>

<actor_roles>
Always name actors explicitly:
- workstream scope
- session id, run id, or signal scope when available
- working directory and project/client surface
- human operator
- coordinator Claude agent
- worker Claude agent or bridge worker, if delegated
- Codex agent, if in review lane
- Gemini/OpenCode/other actor, if present

Rules:
- The coordinator resolves, delegates, verifies, integrates, and reports. The coordinator is not the default worker.
- The worker implements bounded edits or execution.
- The reviewer classifies and validates independently.
- The human operator decides judgment gates, destructive gates, and unresolved governance conflicts.
- Hook support: `tools/kernel/hooks/pretool-orchestrator-worker-gate.cjs` is the reflex-tier guard for this boundary. It is observe-only unless `MYTHOS_ORCHESTRATOR_GATE=1`; subagents are exempt because they are already bounded worker lanes. A hook warning does not itself complete delegation, review, or debrief requirements.
- When a workflow selects a worker lane, bounded implementation, review prep, cleanup, debrief, reconcile-lessons, next-session, and scoped closeout commit belong to that worker lane by default. The coordinator validates evidence and makes routing decisions; it does not pull the work back into main chain just because the next step is routine.
- Exception: if coordinator Claude did the substantive work directly, coordinator Claude owns the debrief and closeout for that work. Do not delegate a debrief away from the actor that actually produced the evidence.
- If a workflow naturally ends with debrief + next-session + cleanup + scoped commit, treat that as a delegated closeout phase inside the already-authorized workflow. Do not ask the human operator before obvious closeout steps unless a destructive, external, ambiguous, or judgment-only gate appears.
- The coordinator escalates to the human operator only after worker and review lanes cannot resolve the question, or when the remaining gate is destructive, external, or judgment-only.
- If coordinator Claude selected a worker lane, coordinator Claude must not source-edit directly unless the worker blocks and the boundary is explicitly re-opened.
- Use Codex as logical-core review when there are multiple viable routes, consequential assumptions, or disagreement with the coordinator's read. Do not convene extra actors by ceremony.

Dispatch routing (per `instructions/canonical/dispatch-routing-rule.yaml`, advisory):
- Disclose the model/mind at every subagent or bridge dispatch, at dispatch time ("haiku — mechanical", "codex GPT-5.5 — distinct review"). Same-model Claude subagents are parallel contexts, not distinct intelligence.
- Tier the dispatched mind by work altitude: mechanical/extraction/recon → Haiku; bounded light judgment → Sonnet; genuine reasoning/creative/synthesis/live-mutation → frontier. Artifact-verifiable output lowers the tier; judgment-is-the-deliverable raises it.
- Route across harnesses per `tools/signals/lib/target-command-policy.cjs` (codex GPT-5.5, gemini, openrouter, opencode, opencode-local = Ollama-backed local); mechanical lanes consider local coding agents first, credential-adjacent work prefers opencode-local. The routing question: cheapest mind this lane's verification can hold accountable?
</actor_roles>

<scope_identity>
Parallel workstreams are normal. Every orchestrate-loop run must carry its own identity so evidence, closeout, and commits do not bleed across adjacent workflows.

Required identity fields:
- `workstream_scope`: task id, signal scope, plan id, or explicit workstream name
- `session_or_run_id`: current session id, execution id, signal timestamp, or `unknown` with reason
- `working_surface`: repo root plus client/project/framework/system surface
- `custody_hierarchy`: mechanically generated task -> project -> client -> system cascade when plan context exists
- `owned_artifacts`: exact plan, amendment, signal, debrief, handoff, and review artifacts in scope
- `forbidden_artifacts`: known dirty or parallel-workflow surfaces that must not be touched

Rules:
- Do not summarize global repo state as if it belongs to the current loop. Parallel dirty files are context, not ownership.
- When a task plan exists, prefer its mechanically generated `scope_identity` from `tools/planning/lib/task-custody.js` over reconstructing custody in chat.
- Custody cascades downward to child tasks/delegations and upward to project/client/system rollups; rollups aggregate `child_scopes` without claiming child artifacts unless explicitly listed.
- Worker assignments must include the same identity fields and must return changed paths grouped by owned scope.
- Closeout and scoped commits must include only artifacts tied to `workstream_scope` unless the coordinator explicitly records a cross-scope reason.
- If two live workflows share artifact prefixes or signals, stop in `needs_context` or run `/normalize-signals` before delegating.
</scope_identity>

<closeout_ownership>
Closeout is part of the work, not after-the-fact chat cleanup.

Rules:
- If a bounded worker or bridge worker did the substantive work, that worker's assignment should include closeout inputs and, when safe, the debrief/next-session/cleanup/scoped-commit phase.
- If coordinator Claude did the substantive work, coordinator Claude performs the debrief and closeout inline.
- The coordinator still owns final integration: read the worker's returned evidence, verify changed artifacts and status, classify blockers, and report the exact next command.
- Closeout must restate `workstream_scope`, `session_or_run_id`, `working_surface`, owned artifacts, and explicit exclusions before any scoped commit.
- Do not ask the human operator whether to run obvious closeout steps inside an already-authorized loop. Ask only for real ambiguity, destructive/external action, or judgment gates.
</closeout_ownership>

<native_route_order>
Prefer native Mythos surfaces in this order:
1. `/follow-signal` for live signal authority.
2. `/run-plan` for bounded task-plan or plan-like execution.
3. `/execute-plan` for compatible prompt-plan execution.
4. `/amend-plan` when plan assumptions, gates, review lane, risk, stage status, or evidence contract changed.
5. `/dispatch-bridge` for distinct actor review, bounded worker handoff, or Codex re-review.
6. `/review-progress` for findings-first review of current state.
7. `/debrief-run` before closeout.
8. `/normalize-signals` when the live signal surface is stale, duplicate, or contradictory.

If a native command owns the next action, return that command. Do not hand-roll it.
</native_route_order>

<mechanical_reconciliation>
Before spending another bridge/LLM turn, check whether the resolved target or artifact type has a registered deterministic reconciler.

Rules:
- Reconciler output is evidence, not judgment.
- A reconciler can move the loop to `ready_for_review_mechanically_verified`, but it cannot mark acceptance-grade work complete.
- If the reconciler reports missing evidence or contract drift, route to the exact missing evidence or repair command before broad review.
- Attach reconciler artifacts to review and closeout packets when review still needs to run.

Artifact pattern:
- `_dev/reports/analysis/mechanical-reconcile__<scope>__<timestamp>.json`
- `_dev/reports/analysis/mechanical-reconcile__<scope>__<timestamp>.md`
</mechanical_reconciliation>

<workflow>
<step name="resolve-context">
Read the target, latest amendment, latest review artifact, latest debrief, and operator-continuity state when available. If the target is ambiguous, stop in `needs_context`.
</step>

<step name="normalize-kernel">
State the target as Current State, one Question / Work, and Desired State. If more than three peer steps or questions are needed, split into children or siblings and classify each resulting unit separately.
</step>

<step name="classify-state">
Choose one loop state from `<loop_states>` and name the actor roles from `<actor_roles>`.
</step>

<step name="mechanical-reconcile">
If a registered reconciler exists for the resolved target or artifact type and has not been run against the current evidence set, classify the loop as `mechanical_reconcile_needed` and route to it before bridge dispatch. If it fails, classify as `mechanical_reconcile_failed`, `evidence_missing`, or `blocked` and return the concrete repair/evidence route. If it passes, attach its artifact and continue to independent review when required.
</step>

<step name="classify-review">
If Codex or another independent reviewer returned findings, classify each finding by severity and type using `<codex_finding_classifier>`.
</step>

<step name="route-next-action">
Apply `<decision_tree>` and choose the native command from `<native_route_order>`.
</step>

<step name="return-control-output">
Return the fields in `<output_format>` and end with exactly one next command or a blocked state.
</step>
</workflow>

<execution_shapes>
- `single_threaded` - only for small, low-risk work without acceptance-grade review requirements.
- `coordinator_plus_worker` - bounded implementation or evidence collection by worker, coordinator validates.
- `coordinator_plus_codex_review` - coordinator or worker produced output; Codex agent reviews.
- `coordinator_plus_worker_plus_codex_review` - worker implements, coordinator reintegrates, Codex reviews.
- `blocked_or_operator_gate` - human operator or missing external state is required.
</execution_shapes>

<codex_finding_classifier>
When Codex findings are present, classify each finding before choosing action.

Severity:
- `CRITICAL` - unsafe, destructive, credential, data-loss, or trust-boundary issue.
- `MAJOR` - blocks acceptance criteria, stage progression, authority truth, schema/contract truth, or reliable execution.
- `MINOR` - does not block current acceptance criteria but should be recorded or fixed soon.
- `INFO` - context, observation, or nonblocking improvement.
- `NO_FINDINGS` - reviewer reported no issues.

Type:
- `source_defect`
- `evidence_missing`
- `plan_divergence`
- `stale_context`
- `authority_boundary`
- `schema_or_contract_drift`
- `test_gap`
- `scope_mismatch`
- `unsafe_or_destructive_risk`
- `blocked_external_dependency`
</codex_finding_classifier>

<decision_tree>
1. **No target or ambiguous target**
   - State: `needs_context`
   - Next command: `/normalize-signals` if signal ambiguity, `/mythos-status` or `/review-active-workstreams` if no authority surface, or ask the human operator only when repo truth cannot disambiguate.

2. **Live signal exists**
   - State: depends on signal.
   - Next command: `/follow-signal <signal-scope|--file path> --execute` unless the signal is blocked or stale.
   - If stale/duplicate: `/normalize-signals <scope>`.

3. **Plan exists and no active review blocker**
   - State: `ready_to_start`.
   - Next command: `/run-plan <target>` for task plans or `/execute-plan <target>` for compatible prompt plans.

3a. **One safe next step exists**
   - State: `ready_to_start`.
   - Next command: execute or route the single step through the native command that owns it.

3b. **More than three peer steps or questions exist**
   - State: `plan_diverged`.
   - Next command: split into child tasks when they share the parent desired state, split into sibling tasks when desired states differ, then reclassify each unit through the task kernel.

4. **Registered mechanical reconciler exists and has not run**
   - State: `mechanical_reconcile_needed`.
   - Next command: run the target-specific reconciler, emit mechanical-reconcile artifacts, then reclassify.
   - Do this before dispatching broad bridge review or worker repair.

5. **Mechanical reconciler failed**
   - State: `mechanical_reconcile_failed`, `evidence_missing`, or `blocked`.
   - Next command: fix the concrete drift or collect the missing evidence first.
   - Do not dispatch broad review while deterministic drift remains open.

6. **Mechanical reconciler passed and review lane remains required**
   - State: `ready_for_review_mechanically_verified`.
   - Next command: dispatch the declared review lane with the reconciler artifact attached.

7. **Review returned CRITICAL or MAJOR source, authority, schema, unsafe-risk, or scope findings**
   - State: `blocked`.
   - Next command: `/amend-plan <target>` if the plan's assumptions, gates, stage status, review lane, or evidence contract changed.
   - After amendment: dispatch bounded worker repair, run tests/smokes, dispatch Codex re-review.
   - Do not advance downstream stages while these findings remain unresolved or undeferred.

8. **Review returned evidence_missing**
   - State: `evidence_missing`.
   - Next command: run the missing tests/smokes or collect missing artifacts, then dispatch Codex re-review with explicit evidence attached.
   - Do not source-repair just because evidence is missing unless a source defect is also present.

9. **Review returned plan_divergence or stale_context**
   - State: `plan_diverged`.
   - Next command: `/amend-plan <target>` or `/review-task-plan <target>`.
   - Do not keep implementing from stale assumptions.

10. **Review returned MINOR only**
   - State: `ready_for_clear` if minors do not touch acceptance criteria; otherwise `blocked`.
   - Next command: record follow-up tasks or dispatch bounded repair if acceptance criteria are touched.

11. **Review returned INFO only or NO_FINDINGS**
   - State: `ready_for_clear`.
   - Next command: `/debrief-run <target>`.
   - After debrief, close the relevant signal or emit the next authorized stage command.

12. **Worker returned**
   - State: `ready_for_review` unless already independently reviewed.
   - Next command: read actual changed artifacts, run declared tests/smokes, then `/dispatch-bridge --target codex ...` for acceptance-grade review.

13. **External blocker or human judgment gate**
   - State: `blocked`.
   - Next command: write or preserve blocked signal with `recommended_next_actor: operator` and exact blocker.

14. **Review iteration ceiling reached**
   - Condition: a single review scope (e.g., `<task-id>-impl-review`) has accumulated N or more passes without a NO_FINDINGS / clean verdict.
   - Default N=4. Per-risk-tier override: low=3, medium=4, high=5.
   - State: `review_iteration_ceiling_reached`.
   - Next command: `/amend-plan <target>` to tighten scope OR operator-gate for an evidence-vs-further-iteration decision.
   - Rationale: late-emerging drift across repeated passes is a signal to change the plan or escalate, not to keep dispatching. Evidence: the `framework-wpforms-entries-probe` slice iterated 6 times before converging.
</decision_tree>

<evidence_contract>
Before a loop can move to `ready_for_clear` or `cycle_complete`, require:
- changed files or explicit no-source-change statement
- commands run
- test and smoke outputs, or explicit evidence_missing state
- review artifact path and reviewer actor
- mechanical reconciler artifact when one exists for the target or artifact type
- amendment path when assumptions changed
- debrief path for meaningful multi-step work
- exact next command
</evidence_contract>

<output_format>
Return:
1. `Resolved target:` id/path and artifact type.
2. `Scope identity:` workstream scope, session/run id, working surface, owned artifacts, and explicit exclusions.
3. `Task kernel:` Current State, Question / Work, Desired State.
4. `Loop state:` one of the declared loop states.
5. `Actor roles:` named human/coordinator/worker/reviewer actors.
6. `Review classification:` severity/type summary, or `none`.
7. `Evidence:` commands, tests, smoke cases, review paths.
8. `Blockers:` unresolved blockers or `none`.
9. `Exact next command:` one command, or `blocked` with the exact missing prerequisite.
</output_format>

<success_criteria>
- Target state is classified before action.
- Target is normalized into Current State, one Question / Work, and Desired State before routing.
- More than three peer steps or questions trigger child/sibling fractalization instead of long flat task bodies.
- Only human-judgment or protected approval questions bubble to the human operator.
- Scope identity is explicit before delegation, closeout, or scoped commit.
- Actor roles are explicit.
- Native commands own native work.
- Codex findings are classified by severity and type before routing.
- Registered deterministic checks run before LLM review or worker dispatch when applicable.
- CRITICAL and MAJOR findings block downstream progression unless durably deferred.
- Evidence gaps do not masquerade as source defects.
- Coordinator/worker/reviewer boundaries are preserved.
- The output ends with one exact next command or a truthful blocked state.
</success_criteria>

<boundaries>
- This skill does not replace `/orchestrate`; it complements it as the review-driven loop controller.
- This skill does not execute arbitrary repairs itself; it routes to workers or native commands.
- This skill does not treat Codex findings as final truth without evidence, but it does treat them as control-plane input that must be classified and answered.
- This skill does not close meaningful work without debrief evidence.
- **Reciprocal note to `/ship-workstream` (EXPERIMENTAL):** `/orchestrate-loop` is the judgment-heavy router that classifies findings and chooses the next native command based on current state. `/ship-workstream` (Claude-local experimental) is the pre-shaped opinionated cascade for already-bounded workstreams that wants the full pipeline run end-to-end without per-phase judgment calls. Use `/orchestrate-loop` when the right next command is unclear or the situation needs classification. Use `/ship-workstream` only when the workstream is already bounded and you want the cascade pattern applied without re-deriving it as prose.
</boundaries>
</skill>
