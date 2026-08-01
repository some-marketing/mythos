---
name: ship-workstream
description: Ship a workstream end-to-end — cascading /plan-task → /review-task-plan loop → /run-plan (subagent execution) → codex-bridge review → /review-task-plan --approve → /debrief-run → /next-session → scoped commit. Hard-coded constraints, stop conditions, iteration ceiling, and coordinator/worker/reviewer discipline. Use when the operator names a workstream id or task description and wants the whole loop run autonomously. Replaces the 60-line prose handoff prompt.
version: 1.0.0
execution_mode: COORDINATOR
trust_tier: report_write_scoped
---

<skill>

<prime_directive>
Cascade the full Mythos workstream pipeline. The operator provides a workstream id or a one-line task description; /ship-workstream owns the rest. Every step routes through native Mythos commands; the cascade does not re-implement their behavior. Stop conditions are first-class: hitting one pauses to report, never silently continues.
</prime_directive>

<objective>
Run a complete workstream cycle — intake to commit — as one operator-facing command. Replaces the pattern where every session started with a long prose handoff prompt.
</objective>

<execution_mode>
COORDINATOR (Claude main chain). Workers are bounded subagents. Reviewer is Codex via /dispatch-bridge. Operator is the gate for pause-and-report stop conditions.
</execution_mode>

<experimental_status>
EXPERIMENTAL / Claude-local only. Not registered as a canonical Mythos command.

- No `instructions/canonical/commands/ship-workstream.yaml` exists yet.
- Not listed in AGENTS.md implemented managed commands.
- The `npm run codex:smos -- command --exact "/ship-workstream ..."` managed-runtime path will NOT work; this skill executes only through Claude-side invocation.
- Promotion to canonical requires: (a) one more successful cascade cycle proving the pattern, (b) authoring the canonical YAML spec, (c) AGENTS.md registration, (d) /dispatch-bridge review of the promotion itself.
- Until promoted, treat /ship-workstream as a Claude-local convenience, not a committed Mythos command surface.
</experimental_status>

<when_to_use>
- Operator names a workstream id from the open queue (e.g. "ship bridge-first-dispatch-enforcement-stage-3-repair")
- Operator names a task description ("ship a repair of X using /repair-plan")
- Starting a new session with `/ship-workstream <arg>` where <arg> is either an existing plan id or a task description
- Explicitly NOT for: trivial single-file edits, research-only questions, operator-approval-pending items
</when_to_use>

<arguments>
Primary: workstream id OR one-line task description (positional)
Flags:
- `--stop-at <phase>` — Pause before the named phase (plan|review|execute|review-execution|approve|debrief|handoff|commit). Default: no stop; run full cycle.
- `--scope system|client=CODE` — Scope override. Default: inferred from task/plan.
- `--dry-run` — Plan the cascade, list the commands, do not execute.
</arguments>

<phases>
**Two approval paths:** New plans enter phase 4 APPROVAL STOP after their review clears. Repaired plans enter phase 8 APPROVE (with `--approve --approval-ref`). These are distinct; do not conflate them.

1. **INTAKE** — Resolve the argument. If it matches an existing plan id (via `resolveTaskPlanPaths`), skip to phase 3. If it is a task description, proceed to phase 2.
2. **PLAN** — `/plan-task --scope <scope> "<task description>"`. Capture the produced plan id.
3. **REVIEW-PLAN** — `/review-task-plan <plan-id>`. If `review_lane=codex-bridge`, dispatch codex-bridge via `/dispatch-bridge`. Loop until CLEARED or iteration ceiling (default 5 for high-risk, 4 for medium, 3 for low). On AMEND_REQUIRED with operator decision named in findings → STOP + report. On ceiling reached → STOP + offer Path A (comprehensive reconciliation) vs Path B (operator-gated deferral).
4. **APPROVAL STOP (new plans only)** — After REVIEW-PLAN returns CLEARED for a newly-authored plan, STOP and request explicit operator approval before proceeding to `/run-plan`. Invoking `/ship-workstream <arg>` authorizes the CASCADE SHAPE, NOT plan content. Operator must confirm the reviewed plan before execution.
   - EXCEPTION: plans that already carry a durable operator approval gate (e.g. a prior PlanAmendment/1.1 operator_gate with `status=resolved` for execution authorization) may skip this stop. The skill must cite the exact gate id + amendment path as justification.
   - EXCEPTION: repaired plans — the `/review-task-plan --approve --approval-ref` flow in phase 8 is the approval path for repaired plans, not this phase. This phase applies only to newly-authored plans entering `/run-plan` for the first time.
5. **PRE-EXECUTE PREFLIGHT** — Resolve operator gates via `resolveOperatorGates`. Blocking → STOP + report. Verify `operator-continuity-state.json` (if present) does not require pause. Permission-envelope preflight if declared.
6. **EXECUTE** — `/run-plan <plan-id>`. The /run-plan skill itself handles subagent delegation per its own process. Capture all artifacts it produces.
7. **REVIEW-EXECUTION** — Dispatch codex-bridge review of executed slice. Route verdict per decision tree: CLEARED → phase 8; AMEND_REQUIRED with mechanical fixes → delegate bounded fix worker, re-review (counts toward ceiling); AMEND_REQUIRED with operator decision → STOP; BLOCKED → STOP.
8. **APPROVE (repaired plans only)** — For repaired plans (state marker `last_event=post_repair`, `review_status=pending`): `/review-task-plan <plan-id> --approve --approval-ref <final-codex-clear-artifact>`. Verify `/run-plan` no longer refuses on repair-pending-review. For non-repaired plans, skip this phase.
9. **DEBRIEF** — `/debrief-run <plan-id>`.
10. **HANDOFF** — `/next-session --system` (or `--client CODE`).
11. **SIGNAL-CLOSURE** — Close all dispatch-bridge and ready-for-review signals produced by this workstream via `tools/signals/close-signal.js`.
12. **COMMIT** — Enumerate paths by workstream scope. Stage with explicit `git add <path1> <path2> ...` (never `git add -A` or `git add .`). Include the {CLIENT_CODE}-safe check: verify `git status --short` shows only the enumerated workstream files staged. Commit with structured message: workstream id + bounded surfaces + test matrix summary + deferrals (if any). Co-authored trailer.
</phases>

<stop_conditions>
STOP = pause, report to operator, do not proceed:
- Codex returns AMEND_REQUIRED naming an operator decision (reversible policy question).
- Review iteration ceiling reached (risk high → 5, medium → 4, low → 3). Offer Path A / Path B.
- Propagation-gap pattern: three consecutive rounds with "fix did not propagate to <other surface>" findings. Amendment authoring checklist is drifting.
- Finding requires editing surfaces outside the declared workstream scope. Surface cross-workstream coupling.
- Credential or access blocker.
- `/repair-plan` refusal (authority-boundary-violation, paired-artifact-violation, invalid-review-reference, blocking-operator-gate, already-pending-review). Do not bypass.
- `operator-continuity-state.json` says `operator_state` in {unavailable, overloaded, conflicted, succession-out-of-scope} at a gate requiring operator judgment.
- Dirty worktree outside workstream scope detected after phase 11 signal-closure. Do not commit until operator decides what to do with the foreign changes.
</stop_conditions>

<non_negotiables>
- Coordinator = main chain. Workers = bounded subagents. Reviewer = Codex via bridge. Never source-edit from coordinator after delegation was chosen.
- Every `/repair-plan` invocation carries a `review_reference` that exists AND contains the target `task_id`. Scenario-f refusal is live.
- `/review-task-plan` approval syntax: `<task-id> --approve --approval-ref <path>`. Never `--approve` alone. Never `--approval-ref` without `--approve` or `--reject`.
- Bridge dispatch is mandatory when `review_lane=codex-bridge`. Dispatch automatically, never ask.
- Signal timestamps: always `date +%Y-%m-%dT%H:%M:%S%z`. Never invent.
- Scoped commit: enumerate paths. Exclude `_dev/logs/archive.jsonl`. Exclude any file not touched by this workstream.
- Close all workstream signals before the commit (`tools/signals/close-signal.js`).
- New plans must pass an APPROVAL STOP (phase 4) before `/run-plan`. Cascade-shape authorization is not plan-content authorization.
- Every phase boundary has a verification step: changed artifacts + commands run + test outputs + review artifact path. No silent transitions.
</non_negotiables>

<lessons_baked_in>
Encoded from session 2026-04-21 (repair-plan-implementation):
- Propagation discipline: amendments must name every authoritative surface (required_gates, expected_outcomes, risk_notes, paired MD), not just step-level.
- Client-scope coverage: handler writes to state/marker paths MUST use `resolveStateMarkerPath` with `clientCode` if the plan is client-scoped.
- Review iteration ceiling is a feature. Hitting it means the authoring checklist needs tightening or the drift deserves deferral.
- `/repair-plan` can repair its own plan. Dogfood cycles are expected, not failures.
- Validator PASS alone is not sufficient when the validator only checks schema id. Bridge review must inspect canonical field-shape.
- Bridge prompts should not hard-code evidence counts; derive from artifacts.
</lessons_baked_in>

<output_format>
Return at each phase boundary:
1. Phase name + status (completed | in-progress | stopped)
2. Commands executed this phase
3. Artifacts produced (paths)
4. Next phase or stop reason

End of cycle: one-line summary of the ship + scoped commit sha (if phase 12 ran).
</output_format>

<success_criteria>
- Argument resolved (existing plan id or task description)
- Each phase boundary explicitly crossed with evidence
- No silent stop-condition skips
- `/run-plan` executed only after review cleared
- `/review-task-plan --approve` invoked only after codex-bridge CLEARED verdict on execution
- Debrief + handoff artifacts exist
- All workstream signals closed before commit
- Commit is truthfully scoped (no foreign files)
- APPROVAL STOP was honored for new plans — no `/run-plan` invocation without durable operator approval (explicit per-session confirmation OR cited pre-existing approval gate)
</success_criteria>

<boundaries>
- Does NOT replace `/orchestrate-loop` (which teaches the orchestration pattern). This is the opinionated cascade version that hard-codes the constraints.
- Does NOT re-implement native commands. Every action routes through `/plan-task`, `/review-task-plan`, `/run-plan`, `/debrief-run`, `/next-session`, `/dispatch-bridge`.
- Does NOT invoke `/repair-plan` on its own — that is the EXECUTOR's business (called from inside `/run-plan` when the plan prescribes repair).
- Does NOT auto-commit without enumerated paths. Sanity check staged set matches workstream scope before commit.
</boundaries>

</skill>
