---
description: Review a generated task plan before execution
mode: REVIEW_ONLY
---

<objective>
Present a generated task plan to the operator for review, showing matched framework, covered and gap steps, required gates, expected outcomes, risk notes, and hardening opportunities. This is REVIEW_ONLY — do not execute the plan.
</objective>

<process>
- Resolve the plan artifacts using the shared task-plan resolver (tools/planning/lib/resolve-task-plan.js) with $ARGUMENTS. The resolver searches system and client plan roots and blocks on ambiguous matches.
- Inspect the resolver result for owned_artifacts_audit. If the audit is non-null and missing[] is non-empty, surface a STATE-RECONCILIATION WARNING block listing the missing paths at the top of the review. The warning is informational, not blocking — operator decides whether to investigate (cherry-pick, re-run prior slice, amend plan) before approving the plan for execution. Audit fields: existing[], missing[], planned_new[], glob_patterns_not_validated[].
- Present the plan to the operator with sections for: matched framework and rationale, covered steps vs gap steps, required gates and checkers, expected outcomes, risk notes and trust tier, hardening opportunity, state-reconciliation warning (if audit.missing is non-empty).
- Accept operator decision: approve (plan can be executed via /run-plan), modify scope (adjust steps, gates, or trust tier), add gates (add additional checkers), or reject (plan is discarded with reason).
- Do not execute the plan — this is review only.
- Pipeline rule (operator, 2026-06-10): operator review is NOT the only gate. The full lifecycle is plan -> codex distinct-mind review -> operator stamp -> (if BIG) /convene -> /run-plan, mechanically enforced at /run-plan time by tools/kernel/hooks/userprompt-plan-review-gate.cjs. During review, record the distinct-mind review in the plan's plan-task-review-state marker as distinct_reviews: [{actor, artifact, at, verdict}] (pending entries go in distinct_reviews_pending and do NOT satisfy the gate). If no codex review exists yet, dispatch one via /dispatch-bridge before or alongside the operator stamp — operator approval of an unreviewed plan is the exact failure mode this gate exists to prevent (sdag-ads-approval-portal-mvp, 2026-06-10).
- BIG classification at review time: if the plan is BIG (routing_expectations.risk_tier high, client-facing surface, new always-on infrastructure, or multi-actor), set big: true in the marker (risk_tier high is auto-detected by the gate; the other criteria are reviewer judgment) and note that /convene evidence (marker.convene_review or _dev/reports/analysis/convene-runs/*<plan-id>*) is required before /run-plan.
</process>

<success_criteria>
- Plan artifacts loaded and presented clearly
- All plan sections surfaced: framework match, steps, gates, outcomes, risk, hardening
- Operator decision captured
- No execution attempted
</success_criteria>

<handoff>
approved: /run-plan <task-id>
modified: Update plan artifacts then /run-plan <task-id>
rejected: Plan discarded, operator decides next step
amendment_exists: If an amendment artifact exists for this plan, present the divergences alongside the original plan during review. The amendment does not replace the plan — it records what changed and why.
</handoff>
