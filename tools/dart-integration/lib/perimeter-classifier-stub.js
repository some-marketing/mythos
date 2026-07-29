'use strict';

/**
 * perimeter-classifier-stub.js
 *
 * STUB. The private source this tool was ported from used a full,
 * fail-closed, per-step "consequential perimeter" classifier (~700 lines of
 * predicates over plan-step metadata, deciding auto-run vs. operator-gate per
 * step) that lives under a private `kernel/` directory not included in this
 * port — that's Wave-2 OS-machinery scaffold territory, not a Wave-1 vendor
 * integration.
 *
 * This stub preserves the SAME fail-closed posture and the SAME return shape
 * `classifyPlan()` produced, so `plan-dart-projection.js` needs no other
 * change, but it classifies every step as `unknown` -> `gate`. That means:
 * every plan you project through this tool will show every step as requiring
 * operator greenlight, never auto-run — safe, if not very autonomous.
 *
 * If you want real per-step auto-run/gate classification, port your own
 * classifier here with the same `classifyPlan(planJson) -> { decision,
 * plan_decision, unknown, first_gate_step_id, tripped, steps }` shape, where
 * `steps` is one `{ decision: 'gate'|'auto-run', unknown: boolean, tripped:
 * array }` entry per plan step (in step order).
 */

const UNKNOWN_PREDICATE = 'classifier_not_ported';

function extractSteps(plan) {
  if (Array.isArray(plan && plan.bounded_plan && plan.bounded_plan.steps)) {
    return plan.bounded_plan.steps;
  }
  if (Array.isArray(plan && plan.steps)) return plan.steps;
  return [];
}

function classifyPlan(planJson) {
  let plan = planJson;
  if (typeof plan === 'string') {
    try { plan = JSON.parse(plan); } catch (_) { plan = null; }
  }

  const failClosed = (reason, steps = []) => ({
    decision: 'gate',
    plan_decision: 'gate',
    unknown: true,
    first_gate_step_id: steps[0] && steps[0].step_id ? steps[0].step_id : null,
    tripped: [{ predicate: UNKNOWN_PREDICATE, step_id: null, evidence: reason }],
    steps: steps.map((step, i) => ({
      step_id: step && step.step_id ? step.step_id : `step-${i}`,
      decision: 'gate',
      unknown: true,
      tripped: [{ predicate: UNKNOWN_PREDICATE, evidence: reason }]
    }))
  });

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return failClosed('plan is missing or not an object — fail-closed', []);
  }

  const rawSteps = extractSteps(plan);
  return failClosed(
    'per-step classifier not ported in this build (see lib/perimeter-classifier-stub.js) — every step fail-closes to gate',
    rawSteps
  );
}

module.exports = { classifyPlan };
