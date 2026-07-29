---
name: finding-repair-loop
description: Coordinator-facing skill that closes the inner loop of /orchestrate-loop /review-task-plan and /review-progress when the distinct-family reviewer bridge returns findings. Reads the latest review artifact, classifies findings per the orchestrate-loop classifier, folds MAJOR+MINOR repairs into the paired plan JSON+MD with lockstep edits, writes a PlanRepair/1.0 sibling manifest plus state marker, and re-dispatches with an iteration-aware scope. Escalates to /amend-plan or operator-gate when the iteration ceiling is hit. Activates automatically when a fresh reviewer-run artifact lands for a scope that already has a state marker, or when the operator says "fold the findings", "repair the reviewer findings", or "next iteration".
audience: coordinator
version: 0.1.0
status: STAGED
---

<skill>

<objective>
Close the gap between "the distinct-family reviewer bridge review returned" and "next concrete step" without coordinator narration. Execute one repair iteration: classify, fold, manifest, re-dispatch — or recognize the terminal state (NO_FINDINGS, MINOR-only-non-acceptance, ceiling-reached) and route accordingly.
</objective>

<prompt_type>Coordinator</prompt_type>

<execution_mode>
PATCH_ALLOWED — Edits the paired plan JSON+MD, writes new repair manifests + state markers, dispatches the next bridge round. Never edits implementation surfaces (worker artifacts) — those belong to /run-plan workers.
</execution_mode>

<model_recommendation>
sonnet for ordinary repair iterations. opus only when findings require deep cross-artifact synthesis or governance-shaping decisions.
</model_recommendation>

<activation>
- A fresh `_dev/reports/analysis/reviewer-run__<ts>__<scope>.md` exists for a scope that already has a state marker at `_dev/state/plan-task-review-state/<task-id>.json`
- Operator phrasing: "fold the findings", "repair the reviewer findings", "iterate", "next iteration", "v3" / "v4" with no other context
- /orchestrate-loop classifier returns `review_returned` and the plan owner wants the loop closed without per-iteration narration
- Dispatched scope name follows `<task-id>-impl-review-vN` or `<task-id>-impl-diff-review-vN` pattern
</activation>

<quick_start>
1. [AUTO] Resolve scope context — find the latest review artifact and existing state marker
2. [AUTO] Read the review and extract findings (severity + type per orchestrate-loop classifier)
3. [AUTO] Decide branch — NO_FINDINGS / MINOR-only-non-acceptance / has-MAJOR / ceiling-reached
4. [AUTO] Execute the chosen branch (see decision_tree)
5. [AUTO] Update state marker truthfully
6. [USER] Report: iteration counter, finding mix, action taken, next command
</quick_start>

<execution_rules>
  <rule id="paired-lockstep">Plan JSON and MD must update in lockstep. Either both write or neither.</rule>
  <rule id="manifest-required">Every repair iteration writes a PlanRepair/1.0 sibling manifest pair (JSON + MD) at `<storage_root>/<task-id>__repair__<ISO-ts>.{json,md}` plus state marker update. No prose-only repairs (the reviewer catches them).</rule>
  <rule id="iteration-aware-scope">Re-dispatch scope MUST increment iteration: `<base-scope>-vN+1`. Never re-use prior scope name — the reviewer needs to distinguish v1 review of v3 plan from v3 review of v3 plan.</rule>
  <rule id="ceiling-by-risk">Ceiling N defaults: low=3, medium=4, high=5 (per orchestrate-loop decision-tree #14). Read `routing_expectations.risk_tier` from plan JSON.</rule>
  <rule id="trajectory-check">Before re-dispatching, check finding-count trajectory across iterations. If counts are flat or increasing across 2+ iterations, escalate even before ceiling — drift is not converging.</rule>
  <rule id="no-implementation-edits">Never touch worker artifacts (tools/, .claude/settings.json wired surfaces, code under review). Repair is plan-text only. Implementation defects route back to a /run-plan worker, not to this skill.</rule>
  <rule id="back-check-before-redispatch">Before re-dispatch, run two mechanical scans: (a) every step-id reference cited by gates/routing matches actual step order; (b) every CLI flag mentioned in any step is declared in the authoring step. Catches the v2/v3 self-inflicted regressions.</rule>
  <rule id="staged-promotion">This skill is STAGED. Operator must promote from `_dev/staging/skills/finding-repair-loop/` to `.claude/skills/finding-repair-loop/` before it auto-activates. Until promoted, only invoked explicitly by operator.</rule>
</execution_rules>

<orchestrate_loop_classifier>
Severity (per orchestrate-loop SKILL.md):
- `CRITICAL` — unsafe, destructive, credential, data-loss, or trust-boundary
- `MAJOR` — blocks acceptance criteria, stage progression, authority truth, schema/contract truth, reliable execution
- `MINOR` — does not block current acceptance criteria but should be recorded
- `INFO` — context, observation, nonblocking
- `NO_FINDINGS` — reviewer reported no issues

Type:
- `source_defect` — implementation bug; routes BACK to /run-plan worker, not to this skill
- `evidence_missing` — collect evidence first; this skill does NOT source-repair when evidence is the gap
- `plan_divergence` — execution diverges from plan; routes to /amend-plan, not this skill
- `stale_context` — plan based on outdated assumptions; routes to /amend-plan
- `authority_boundary` — touches immutable authority fields; this skill HANDLES via PlanRepair atomic mutation
- `schema_or_contract_drift` — plan-internal contract mismatch; this skill HANDLES
- `test_gap` — gates declared but not mechanically checkable; this skill HANDLES by adding mechanical step
- `scope_mismatch` — review and target scope don't match; this skill HANDLES via scope rename
- `unsafe_or_destructive_risk` — escalate to operator-gate, do NOT auto-fold
- `blocked_external_dependency` — escalate to operator-gate
</orchestrate_loop_classifier>

<decision_tree>
1. **NO_FINDINGS** → state `ready_for_clear`. Flip state marker `post_review.decision='approved'`, `last_event='post_review_approved'`. Next command: `/debrief-run <task-id>`.

2. **MINOR-only AND none touch acceptance criteria** (e.g., doc-consistency drift, stale step references after renumber, external-tracker-id mismatch) → fix inline (1-line edits in JSON/MD), record in state marker `post_v<N>_inline_repairs[]`, flip state marker to `approved`. Next command: `/run-plan <task-id>` (if pre-implementation review) or `/debrief-run <task-id>` (if impl-diff review). NO new repair manifest needed for trivial inline fixes — record in state marker only.

3. **MINOR touches acceptance criteria OR any MAJOR+ findings** → check iteration counter against ceiling.

   3a. **Ceiling reached (current_iteration >= N)** → escalate. Next command: `/amend-plan <task-id>` (if scope/assumptions changed) OR operator-gate (if same-class drift recurring).

   3b. **Trajectory not converging** (last 2 iterations have flat or rising finding counts) → escalate even below ceiling. Same routing as 3a.

   3c. **Below ceiling, trajectory converging** → execute the repair loop:
      - Classify each MAJOR+ finding by type
      - source_defect / evidence_missing / plan_divergence / stale_context / unsafe / blocked_external → route OUT, do not auto-fold
      - authority_boundary / schema_or_contract_drift / test_gap / scope_mismatch → fold inline
      - For each foldable finding: edit the paired plan JSON+MD lockstep
      - Run back-checks (step-id references, CLI flag declarations)
      - Compute pre/post hashes
      - Write PlanRepair/1.0 manifest pair with `review_reference = <this reviewer-run path>`
      - Update state marker: `post_repair.repair_id`, `post_repair.review_reference`, `post_repair.review_status='pending'`, `last_event='post_repair_pending_review'`, append iteration to `review_iteration.history`
      - Re-dispatch by handing the review to your distinct-family reviewer and recording the handoff note under `_dev/reports/signals/`, naming the exact command (`/orchestrate-loop /review-task-plan <task-id>`) and the incremented scope (`<base-scope>-v<N+1>`)

4. **CRITICAL findings** → halt immediately. Do NOT auto-fold. Operator-gate. Write blocked signal.
</decision_tree>

<automated_workflow>
  <step id="1" name="resolve-context" type="AUTO">
    Resolve task-id from input or active state.

    1a. List `_dev/state/plan-task-review-state/*.json` — find the marker with `last_event='post_repair_pending_review'` or matching the operator's named task-id.

    1b. From the marker, read: plan paths, current iteration, ceiling (derive from plan JSON `routing_expectations.risk_tier`), review_iteration.history.

    1c. Find the latest review artifact: `_dev/reports/analysis/reviewer-run__<latest-ts>__<task-id>-impl-review*.md` OR `*-impl-diff-review*.md`. Sort by timestamp desc.

    1d. If no marker exists yet: this is iteration 1; fall back to /repair-plan flow to establish marker.
  </step>

  <step id="2" name="classify-findings" type="AUTO">
    Read the latest reviewer-run artifact. Extract findings using regex `^(MAJOR|MINOR|CRITICAL|INFO|NO_FINDINGS)`. For each finding capture: severity, type-tag (heuristic from finding text — credential|destructive → unsafe; "step order"|"contract" → schema_or_contract_drift; "missing"|"manifest" → authority_boundary; "vague"|"prose" → test_gap; "stale"|"renumber" → schema_or_contract_drift), one-line summary, cited file:line.

    Output: `findings[]` array.
  </step>

  <step id="3" name="decide-branch" type="AUTO">
    Apply decision_tree. Output: branch ∈ {no_findings | minor_only_inline | repair_loop | escalate_ceiling | escalate_trajectory | escalate_critical}.

    Trajectory check: read `review_iteration.history[]`. If last 2 entries have finding_count >= current_count (flat or increasing), set escalate_trajectory.
  </step>

  <step id="4-no-findings" name="branch-no-findings" type="AUTO" condition="branch=no_findings">
    Update state marker:
    - `post_review.decision='approved'`, `post_review.approval_reference=<this artifact>`, `post_review.decided_at=<ISO-now>`
    - `last_event='post_review_approved'`
    - Mirror `post_repair.review_status='approved'`
    - Append iteration to history with verdict 'approved-no-findings'

    Report next command: `/debrief-run <task-id>` (or `/run-plan` if pre-implementation review and S9 still pending).
  </step>

  <step id="4-inline" name="branch-minor-inline" type="AUTO" condition="branch=minor_only_inline">
    For each MINOR finding: identify the exact one-line edit needed (the reviewer usually states it in section 3 Suggestions). Apply via Edit tool to paired JSON+MD.

    Append `post_v<N>_inline_repairs[]` entries to state marker with description.

    Flip state marker to approved (same as branch-no-findings final state).

    Report next command per branch-no-findings.
  </step>

  <step id="4-repair" name="branch-repair-loop" type="AUTO" condition="branch=repair_loop">
    For each foldable finding (severity >= MINOR-affects-acceptance OR MAJOR, type in foldable-set):
    - Compute the bounded edit per the distinct-family reviewer's Suggestions section
    - Apply paired JSON+MD edit via Edit tool
    - Record in `findings_resolved[]`

    For each non-foldable finding (source_defect, evidence_missing, plan_divergence, stale_context, unsafe, blocked_external):
    - Record in `findings_routed_out[]` with the correct outbound command (/run-plan, /amend-plan, operator-gate)

    Run back-checks:
    - Grep for `S\d+` in plan.json after edits; verify every cited step-id exists in `bounded_plan.steps[].step_id`
    - Grep for `--<flag>` mentions in step descriptions; verify each declared in S1's CLI clause

    Compute pre/post hashes via shasum -a 256.

    Write PlanRepair/1.0 manifest pair at `<storage_root>/<task-id>__repair__<ISO-ts>.{json,md}` per `.claude/commands/repair-plan.md` inline schema. Required fields: schema_version='PlanRepair/1.0', repair_id, plan_id, plan_paths, timestamp, review_reference (path to the reviewer-run that triggered this), scope_identity (TaskCustody/1.0), fields_touched_json[], fields_touched_md[], pre_repair_hashes, post_repair_hashes, reason{summary, findings_resolved[], findings_routed_out[]}, author_actor, produced_by_harness_id, validator_status.

    Update state marker:
    - `post_repair.repair_id=<this repair_id>`, `post_repair.timestamp=<ISO-now>`, `post_repair.review_reference=<latest reviewer-run>`, `post_repair.review_status='pending'`, `post_repair.manifest_paths`
    - `last_event='post_repair_pending_review'`
    - Append iteration to `review_iteration.history` with verdict='needs-repair', findings_summary, artifact path
    - Increment `review_iteration.current`
    - Update `review_iteration.trajectory` based on count delta

    Re-dispatch: dispatch the review to your distinct-family reviewer and record the handoff note under `_dev/reports/signals/` — the handoff should carry the iteration-aware task summary (citing prior findings and repairs), the exact next command (`/orchestrate-loop /review-task-plan <task-id>`), the incremented scope (`<base-scope>-v<N+1>`), and the exact context set (plan.json, plan.md, latest repair manifest, prior reviewer-run).
  </step>

  <step id="4-escalate" name="branch-escalate" type="AUTO" condition="branch in {escalate_ceiling, escalate_trajectory, escalate_critical}">
    Update state marker:
    - `last_event='escalated'`
    - `escalation.reason=<ceiling|trajectory|critical>`
    - `escalation.routed_to=<command>`

    Report next command:
    - escalate_ceiling/escalate_trajectory: `/amend-plan <task-id>` (if scope changed) OR write blocked signal naming the recurring drift class
    - escalate_critical: write blocked signal with `recommended_next_actor: operator`, halt
  </step>

  <step id="5" name="report" type="USER">
    Report: iteration N of M, finding mix (count by severity), branch taken, action taken (folded vs routed-out vs escalated), exact next command. Brief.
  </step>
</automated_workflow>

<inputs>
  <required>
    <input name="TASK_ID">Task plan id; usually the same as the workstream scope.</input>
  </required>
  <optional>
    <input name="REVIEW_SCOPE_OVERRIDE">If multiple scopes share a task-id (impl-review vs impl-diff-review), specify which to operate on.</input>
    <input name="FORCE_ESCALATE">Boolean — operator override to skip the loop and escalate immediately.</input>
  </optional>
</inputs>

<outputs>
  <output name="repair-manifest-pair">PlanRepair/1.0 JSON + paired MD at storage_root, when branch=repair_loop</output>
  <output name="state-marker-update">Updated `_dev/state/plan-task-review-state/<task-id>.json`</output>
  <output name="next-dispatch-signal">Coordination signal for the next iteration's review</output>
  <output name="report">User-facing report: counts, branch, action, next command</output>
</outputs>

<success_criteria>
- Iteration counter is incremented exactly once per invocation
- Paired JSON+MD edits land lockstep (or both roll back)
- PlanRepair/1.0 manifest exists when branch=repair_loop (not prose-only)
- State marker accurately reflects current state (pending vs approved vs escalated)
- Re-dispatch scope name follows `<base>-v<N+1>` pattern
- Back-checks (step-id references, CLI flag declarations) pass before re-dispatch
- Trajectory metric is updated after each iteration
- Findings classified as source_defect / evidence_missing / plan_divergence are NOT auto-folded
- CRITICAL findings always escalate, never auto-fold
- Operator can stop the loop at any time by removing the state marker
</success_criteria>

<safety_rules>
- Never auto-fold CRITICAL findings
- Never auto-fold credential/destructive/unsafe findings
- Never edit implementation surfaces (workers' code) — only plan text
- Never silently re-use a prior scope name — always increment
- Never declare approved without writing the approval reference + decision_at to state marker
- Never proceed past ceiling without operator decision
- Never produce a prose-only repair manifest — always JSON+MD pair (the reviewer catches this)
</safety_rules>

<provenance>
Extracted from a real working session where this loop ran several plan-review and impl-diff-review iterations by hand before being captured as a skill for autonomous closure. The pattern generalizes: any coordinator that hand-walks the same review/classify/fold/re-dispatch sequence more than once or twice is a candidate for this staged skill.
</provenance>

</skill>
