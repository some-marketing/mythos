---
description: Repair defective plan artifacts via atomic paired JSON+MD authority-field mutation with full provenance
mode: PATCH_ALLOWED
---

<objective>
Repair defective plan artifacts (paired JSON+MD authority) with full provenance via a sibling repair manifest. Distinct from /amend-plan (overlay-only). Mutates base plan authority atomically; paired JSON+MD discipline enforced by managed runtime.
</objective>

<process>
- Resolve plan artifacts using resolveTaskPlanPaths($ARGUMENTS); obtain { json_path, md_path, storage_root, scope }.
- Read plan.scope_identity (TaskCustody/1.0) when present. Repair manifests must copy or restate the custody identity and add the repair JSON/MD paths plus state marker path to owned_artifacts. If scope_identity itself is the defective surface, regenerate it mechanically with tools/planning/lib/task-custody.js rather than freehand-authoring.
- Verify the proposed change touches at least one field from authority_boundary.immutable_authority_fields_json or its MD mirror. If not, refuse and route to /amend-plan.
- Compute pre_repair_hashes = { json: sha256(json_path bytes), md: sha256(md_path bytes) }.
- Enforce governing-amendment authority coverage per governing_amendment_coverage_contract: refuse with 'governing-amendment-coverage-violation' when uncovered_authority_paths[] contains entries lacking a matching declared_omissions[] with operator_gate_ref. Absence of the coverage object soft-warns only.
- Apply the paired mutation atomically: stage edits to both JSON and MD in memory; write both or neither. On any write failure, roll back both surfaces.
- Compute post_repair_hashes = { json: sha256(json_path bytes), md: sha256(md_path bytes) } after atomic write.
- Enforce paired_content_propagation_contract for bounded_plan.required_gates and bounded_plan.expected_outcomes: MD plural-form sections must carry numbered items that equal the corresponding JSON array values IN ORDER (ordinal content parity, not count-only). Missing section, count mismatch, or any ordinal content mismatch fails with 'paired-content-propagation-violation' and rolls BOTH base JSON and MD back to their pre-repair bytes before returning.
- Invoke tools/planning/validate-task-plan.js against the repaired JSON (10s timeout). On exit 0 remove any <plan-json>.warning sidecar; on non-zero exit rewrite the sidecar with current validator output. On missing validator or spawn error, record validator_status.ok=null and continue. Record validator_status { ok, exit_code?, ran_at, output_summary?, error? } in the PlanRepair/1.0 manifest.
- Write sibling repair manifest JSON at <storage_root>/<task-id>__repair__<TIMESTAMP>.json and paired MD at <storage_root>/<task-id>__repair__<TIMESTAMP>.md per artifact_schema.plan_repair_manifest. Manifest MUST include review_reference, fields_touched_json, fields_touched_md, pre/post hashes, author_actor, produced_by_harness_id, schema_version='PlanRepair/1.0', validator_status.
- Write review-before-run state marker at _dev/state/plan-task-review-state/<task-id>.json (or client-scoped equivalent) with post_repair.review_status='pending', post_repair.repair_id, post_repair.timestamp, post_repair.review_reference.
- Emit exact_next_command: '/review-task-plan <task-id>'.
- Idempotency: on re-invocation against an already-repaired-pending-review plan, report already-pending-review with the existing repair_id, and refuse to re-repair without a new review_reference that post-dates the pending marker.
</process>

<success_criteria>
- Plan JSON and MD resolved via shared resolver
- Proposed change verified to touch at least one immutable authority field
- Pre-repair hashes computed before any write
- Paired JSON+MD mutation committed atomically (both surfaces or neither)
- Post-repair hashes computed after atomic write
- Sibling repair manifest JSON+MD written with complete PlanRepair/1.0 fields including review_reference
- Review-before-run state marker written with post_repair.review_status='pending'
- Exact next command '/review-task-plan <task-id>' emitted
- Idempotent on re-invocation against already-pending-review plan
- No other files touched; no commits made; no implementation work attempted
</success_criteria>

<handoff>
next_command: /review-task-plan <task-id>
repair_manifest_json: <storage_root>/<task-id>__repair__<TIMESTAMP>.json
repair_manifest_md: <storage_root>/<task-id>__repair__<TIMESTAMP>.md
state_marker: _dev/state/plan-task-review-state/<task-id>.json
</handoff>
