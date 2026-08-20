'use strict';

/**
 * A1 (plan-approval-surface) — userprompt-plan-review-gate.cjs enforces
 * operator_stamp as a THIRD mechanical requirement (Stamp != convene), behind
 * the DEFAULT-OFF feature flag SMOS_ENFORCE_OPERATOR_STAMP.
 *
 * Falsifiable contract (UPDATED by S5 perimeter scoping —
 * plan-execution-autonomy-default-perimeter-gate-and-tracking):
 *   - With the flag ON, a marker whose operator_stamp is null, AND a plan that
 *     TRIPS the consequential perimeter, evaluateGate emits a missing[] OPERATOR
 *     STAMP entry + the DO-NOT-EXECUTE injection.
 *   - With the flag ON and a present operator_stamp, NO stamp entry is added.
 *   - With the flag OFF (default), the stamp is NOT enforced (bootstrap safety).
 *   - The --skip-distinct-review override cannot bypass a stamp invariant unless the shared gate is explicitly off for rollback.
 *   - S5: with the flag ON, a null stamp, but a NON-PERIMETER (auto-run) plan,
 *     NO stamp entry is added — enforcement fires only at the perimeter.
 *
 * Run: node --test tools/kernel/hooks/__tests__/userprompt-plan-review-gate.operator-stamp.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gate = require('../userprompt-plan-review-gate.cjs');

const FLAG = 'SMOS_ENFORCE_OPERATOR_STAMP';

function withFlag(value, fn) {
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  }
}

// Temp project root with a resolvable (non-BIG) plan + a marker carrying a
// satisfying distinct review, so the ONLY variable is operator_stamp.
//
// S5: `perimeter` selects whether the plan TRIPS the consequential perimeter.
// Default true (a money-spending step => classifier 'gate') so the "stamp
// required" cases hold under perimeter-scoped enforcement; perimeter:false uses
// a plain non-perimeter step (=> classifier 'auto-run') to prove the relaxation.
function makeRoot(planId, { operatorStamp, perimeter = true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-stamp-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  const markerDir = path.join(root, '_dev/state/plan-task-review-state');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  const step = perimeter
    ? { step_id: 's1', title: 'raise campaign budget', description: 'increase daily ad spend', files_touched: [] }
    : { step_id: 's1', title: 'tidy helper', description: 'internal refactor', files_touched: ['tools/x.js'] };
  fs.writeFileSync(
    path.join(planDir, `${planId}__plan.json`),
    JSON.stringify({
      task_id: planId,
      scope_type: 'system',
      routing_expectations: { risk_tier: 'medium' }, // NOT big -> no convene requirement
      bounded_plan: { steps: [step] }
    })
  );
  fs.writeFileSync(
    path.join(markerDir, `${planId}.json`),
    JSON.stringify({
      schema: 'PlanTaskReviewState/1.0',
      plan_id: planId,
      last_event: 'distinct_review_complete',
      distinct_reviews: [{ actor: 'codex', verdict: 'approve', artifact: 'r.md' }],
      operator_stamp: operatorStamp
    })
  );
  return root;
}

test('flag ON + operator_stamp:null -> OPERATOR STAMP missing entry + DO-NOT-EXECUTE injection', () => {
  withFlag('1', () => {
    const root = makeRoot('stamp-null-plan', { operatorStamp: null });
    const res = gate.evaluateGate('/run-plan stamp-null-plan', root, 'sess-1');
    assert.strictEqual(res.action, 'inject');
    assert.match(res.text, /OPERATOR STAMP/);
    assert.match(res.text, /DO NOT EXECUTE/);
    // The distinct review IS satisfied here, so the ONLY failure is the stamp.
    assert.doesNotMatch(res.text, /DISTINCT-MIND \(codex\) REVIEW — no distinct_reviews/);
  });
});

test('flag ON + present operator_stamp -> NO stamp entry; gate passes', () => {
  withFlag('1', () => {
    const root = makeRoot('stamp-present-plan', {
      operatorStamp: { by: '{OPERATOR_NAME} (human operator)', at: '2026-06-29T00:00:00Z' }
    });
    const res = gate.evaluateGate('/run-plan stamp-present-plan', root, 'sess-2');
    assert.strictEqual(res.action, 'inject');
    assert.doesNotMatch(res.text, /OPERATOR STAMP — /);
    assert.match(res.text, /PASS/);
  });
});

test('flag OFF (default) -> operator_stamp:null does NOT add a stamp entry (bootstrap safety)', () => {
  withFlag(undefined, () => {
    const root = makeRoot('stamp-off-plan', { operatorStamp: null });
    const res = gate.evaluateGate('/run-plan stamp-off-plan', root, 'sess-3');
    assert.strictEqual(res.action, 'inject');
    assert.doesNotMatch(res.text, /OPERATOR STAMP/);
    assert.match(res.text, /PASS/);
  });
});

test('operator review override cannot bypass flag ON + null operator stamp', () => {
  withFlag('1', () => {
    const root = makeRoot('stamp-override-plan', { operatorStamp: null });
    const res = gate.evaluateGate('/run-plan stamp-override-plan --skip-distinct-review', root, 'sess-4');
    assert.strictEqual(res.action, 'inject');
    assert.match(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /OPERATOR STAMP/);
    assert.match(res.text, /bypasses distinct-review\/convene only/);
  });
});

// S5: perimeter scoping — flag ON + null stamp but a NON-PERIMETER (auto-run)
// plan adds NO stamp entry and PASSES. Enforcement fires only at the perimeter.
test('S5: flag ON + null stamp + NON-PERIMETER plan -> NO stamp entry; gate passes', () => {
  withFlag('1', () => {
    const root = makeRoot('stamp-nonperimeter-plan', { operatorStamp: null, perimeter: false });
    const res = gate.evaluateGate('/run-plan stamp-nonperimeter-plan', root, 'sess-5');
    assert.strictEqual(res.action, 'inject');
    assert.doesNotMatch(res.text, /OPERATOR STAMP/);
    assert.doesNotMatch(res.text, /DO NOT EXECUTE/);
    assert.match(res.text, /PASS/);
  });
});

// Unit-level: the enforcement assessor is OFF by default and ON only via flag.
test('assessOperatorStampEnforcement: OFF by default, ON via flag, present vs missing', () => {
  withFlag(undefined, () => {
    assert.strictEqual(gate.assessOperatorStampEnforcement({ operator_stamp: null }).enforced, false);
  });
  withFlag('1', () => {
    assert.strictEqual(gate.assessOperatorStampEnforcement({ operator_stamp: null }).status, 'missing');
    assert.strictEqual(
      gate.assessOperatorStampEnforcement({ operator_stamp: { by: '{OPERATOR_NAME}' } }).status,
      'present'
    );
  });
});

// Round-4 review P1: this hook's own diagnostic text documents the CURRENT
// flag name MYTHOS_ENFORCE_OPERATOR_STAMP, but the shared lib
// (tools/planning/lib/plan-review-state.js) may only recognize the legacy
// SMOS_ENFORCE_OPERATOR_STAMP name in a given tree. Enforcement must not
// silently stay OFF when an operator sets the documented name.
test('FALSIFIER: MYTHOS_ENFORCE_OPERATOR_STAMP alone (no legacy SMOS var set) enables enforcement', () => {
  const MYTHOS_FLAG = 'MYTHOS_ENFORCE_OPERATOR_STAMP';
  const prevMythos = process.env[MYTHOS_FLAG];
  const prevLegacy = process.env[FLAG];
  delete process.env[FLAG];
  process.env[MYTHOS_FLAG] = '1';
  try {
    assert.strictEqual(gate.assessOperatorStampEnforcement({ operator_stamp: null }).enforced, true);
    assert.strictEqual(gate.assessOperatorStampEnforcement({ operator_stamp: null }).status, 'missing');
  } finally {
    if (prevMythos === undefined) delete process.env[MYTHOS_FLAG]; else process.env[MYTHOS_FLAG] = prevMythos;
    if (prevLegacy === undefined) delete process.env[FLAG]; else process.env[FLAG] = prevLegacy;
  }
});
