# Self-Improving Loop Protocol — build interface contract (v1)

Shared contract so parallel builders produce DISJOINT, non-conflicting files that integrate.
Source of truth for the law: `_dev/concepts/self-improving-loop-protocol/context/loop-protocol-law-candidate.md`.
Plan: `_dev/reports/analysis/task-plans/self-improving-loop-protocol__plan.json` (v2).

## Governance rule (critical)
`instructions/canonical/**` and `.claude/settings.json` are WRITE-BLOCKED without a ConveneReceipt.
Therefore:
- Enforcement code + config → live under `tools/kernel/loop-protocol/`, `tools/kernel/hooks/`,
  `tools/planning/lib/`, `tools/workspace/schemas/` (writable; keyword NOTICE only — fine).
- The canonical LAW doc + the 4 referenced-authority promotions → **staged** under
  `_dev/concepts/self-improving-loop-protocol/staging/canonical/` (operator moves to
  `instructions/canonical/` at GATE-bootstrap with a receipt). Never write instructions/canonical/ directly.
- The hook is built but NOT wired into dispatch-pretool.cjs and NOT armed (GATE-bootstrap gates arming).

## File ownership (disjoint — do not touch another owner's files)
- **W1 (manifest+hook):** `tools/kernel/loop-protocol/protected-path-manifest.json`,
  `tools/kernel/hooks/pretool-loop-layer-gate.cjs`, `tools/kernel/loop-protocol/KILL-SWITCH.md`
- **W2 (grade+fixtures):** `tools/workspace/schemas/loop-grade-record.schema.json`,
  `tools/planning/lib/loop-grade-record.js`, `tools/kernel/loop-protocol/fixtures/**`,
  `tools/kernel/loop-protocol/rerun-fixtures.cjs`
- **W3 (ledger+ops):** `tools/kernel/loop-protocol/ledger.js` (+ schema),
  `tools/kernel/loop-protocol/ledger-ratchet.cjs` (operator tool),
  `tools/kernel/loop-protocol/iteration-cap.js`, `tools/kernel/loop-protocol/reconcile.cjs`
- **W4 (canonical drafts, staged):** `_dev/concepts/self-improving-loop-protocol/staging/canonical/*.yaml`
  + `staging/canonical/MOVE-TO-CANONICAL.md`

## Shared data shapes (build to these; the hook reads them)

### protected-path-manifest.json (W1)  — the default-deny classification manifest
```
{
  "version": 1,
  "layer_physics": "any path/content that evaluates pass/fail or authorizes output or reaches base-system = L1",
  "auto_L1_globs": ["instructions/canonical/**","tools/kernel/hooks/**","tools/verify/hooks/**",
                    "**/*guardrails*","tools/convene/**","tools/council/**",
                    ".claude/settings.json","tools/kernel/loop-protocol/protected-path-manifest.json",
                    "tools/kernel/loop-protocol/**approval**","**/*.frozen.json"],
  "task_plan_governed_fields": ["review_lane","required_gates","routing_expectations","scope_type"],
  "instances": { "<instance-id>": {
     "L0_globs":[], "L05_grant_globs":[], "floor_tripwire_globs":[],
     "runtime_source":"", "max_age_seconds":0, "grace_deadline_iso":null } },
  "default": "L1"    // anything unmatched by an instance L0/L0.5 mapping AND not auto_L1 → still L1 (default-deny)
}
```

### loop-grade-record.schema.json (W2)  — closure-gate refuses without these
Required: `unit_id, produced_by{actor,harness,model_family}, validated_by[{actor,harness,model_family}],
frozen_baseline_sha, classifier_id, convergence_threshold, verdict, roster_distinct_family:boolean`.
Rule: `produced_by` must not appear in `validated_by`; consequence-grade requires ≥1 validator with a
DIFFERENT model_family than producer (tiered rule: actor+harness base; +family for consequence-grade).

### ledger.js record (W3)  — per-instance classification ledger the ratchet diffs against
`{ path, layer, classified_by{actor,harness,family}, ts, change_ref }`. Down-layer reclassification
(L1→L0/L0.5) is a ratchet event: `ledger-ratchet.cjs` is OPERATOR-ONLY (writes a signed reclassify entry);
the hook treats a down-layer diff without a matching operator reclassify entry as BLOCK.

### hook contract (W1)  — pretool-loop-layer-gate.cjs, UNARMED
Reads a tool-write input {file_path, content}. Steps: (1) detect if the actor is a loop-instance via a
NON-loop-writable signal (e.g. env `MYTHOS_LOOP_INSTANCE` stamped by control-loop-lobe, documented as
TODO-at-arming — for now default "not a loop" so unarmed = no-op). (2) classify the path via manifest
physics (auto_L1 globs, task_plan_governed_fields, instance L0/L05 maps, default-deny). (3) apply gates:
L1/L2 → block-for-loop; fail→pass ratchet (turning a blocked/unknown into pass) → block; novel/unmapped
path → L1; grace_deadline exceeded → block L0.5 auto-apply. (4) EXIT 0 ALWAYS WHILE UNARMED (emit a
NOTICE describing what it WOULD do), so building it changes nothing until GATE-bootstrap wires+arms it.
Include unit tests in `tools/kernel/hooks/__tests__/pretool-loop-layer-gate.test.cjs` proving the
classification + ratchet + novel-path + grace logic on fixtures.

## Integration
The hook (W1) reads the manifest (W1), the grade schema path (W2), and the ledger (W3) BY PATH per this
contract — no cross-editing. W4's staged canonical is inert until the operator moves it with a receipt.
Coordinator integrates + runs all tests + presents at GATE-bootstrap.
