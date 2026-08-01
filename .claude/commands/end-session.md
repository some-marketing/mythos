---
description: Programmatically inventory end-session closeout evidence and emit an EndSessionCloseout/1.0 readiness index
mode: PATCH_ALLOWED
---

<objective>
Provide one deterministic closeout command that records important artifacts, actor-specific pending actions, verifier status, and clear-readiness basis before context clear.
</objective>

<process>
- Require exactly one selector: --system, --client CODE, or --scope <workstream>.
- Inventory existing reports, debriefs, handoffs, task plans, amendments, ready-for-review or blocked signals, verifier outputs, and maintenance outputs for the selected scope.
- Run tools/verify/verify-artifact-completeness.cjs for the selected scope and store the verifier result as evidence.
- Record observations, unknowns, interpretations, unverified_signals, readiness_basis, and actor-specific pending actions as separate fields.
- Keep maintenance closeout output as hygiene evidence only; never treat maintenance closeout as the full end-session authority.
- Emit paired outputs at _dev/reports/analysis/end-session-closeout__<scope-key>__<timestamp>__index.json and .md plus a scoped evidence directory.
- Set ready_for_clear true only when verifiers return PASS, no live unconsumed signals remain, no actor-specific pending actions remain, no scoped naming drift is detected, and no handoff collision risk is detected.
</process>

<success_criteria>
- Only one scope selector is provided
- Artifact completeness verifier returns PASS for the selected scope
- EndSessionCloseout/1.0 index.json and index.md are emitted
- ready_for_clear is derived from evidence, not model confidence
- No live unconsumed signals remain for the scope
- Scope directory exists under _dev/reports/analysis/end-session-closeout__<scope-key>/
</success_criteria>
