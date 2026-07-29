'use strict';

/**
 * A2 (plan-approval-surface) — /run-plan runtime (tools/codex/commands/run-plan.js,
 * dispatched via tools/commands/smos-command-runner.cjs) enforces operator_stamp
 * as a real run-time blocker, behind the DEFAULT-OFF flag SMOS_ENFORCE_OPERATOR_STAMP.
 *
 * Falsifiable contract:
 *   - flag ON + marker operator_stamp:null  -> blocked (exit 2), reason operator-stamp-missing, NO execution.
 *   - flag ON + perimeter plan + present-but-UNVERIFIED operator_stamp -> blocked (exit 2), reason operator-stamp-unverified (HMAC re-verification fails closed).
 *   - flag ON + perimeter plan + VERIFIED HMAC operator_stamp          -> proceeds past the stamp gate.
 *   - flag ON + NON-perimeter plan                                     -> not stamp-blocked (enforcement is perimeter-scoped).
 *   - flag OFF (default)                      -> never stamp-blocked (bootstrap safety; preserves existing run-plan behavior).
 *   - flag ON + --skip-distinct-review override -> stamp invariant still blocks; override is review/convene-only.
 *
 * Run: node --test tools/codex/commands/__tests__/run-plan.operator-stamp.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runRunPlan, runPlan } = require('../run-plan');
const W = require('../../../kernel/lib/autonomous-execution-wiring');
const stampPlan = require('../../../planning/stamp-plan');
const verify = require('../../../planning/lib/operator-approval-verify');

const FLAG = 'SMOS_ENFORCE_OPERATOR_STAMP';

// A TEST-ONLY GREENLIGHT seam: inject a known secret into the real synchronous
// re-verifier so a positive path can be exercised without the on-device secret
// store. The LIVE dispatched path passes NO greenlightVerify (uses the trusted
// keychain secret) — this only relocates the (already-trusted) secret for tests.
const TEST_SECRET = 'test-operator-secret-do-not-ship';
function injectedGreenlight(secret) {
  return (a) => W.verifyPresentStampSync({ ...a, hmacSecret: secret });
}
/** Build a VALID HMAC GREENLIGHT stamp bound to the plan file at `root`. */
function validStampFor(root, planId, secret) {
  const planText = fs.readFileSync(path.join(root, '_dev/reports/analysis/task-plans', `${planId}__plan.json`), 'utf8');
  const planSha256 = verify.computePlanSha256(planText);
  return stampPlan.buildStamp(secret, { planId, planSha256, timestamp: '2026-06-29T00:00:00Z' });
}

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

// Temp root with a resolvable system-scope plan + a live-shape marker
// (last_event convene_complete validates only because A4 widened the set).
function makeRoot(planId, { operatorStamp }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-plan-stamp-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  const markerDir = path.join(root, '_dev/state/plan-task-review-state');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(
    path.join(planDir, `${planId}__plan.json`),
    JSON.stringify({ task_id: planId, bounded_plan: { steps: [] } })
  );
  fs.writeFileSync(
    path.join(markerDir, `${planId}.json`),
    JSON.stringify({
      schema: 'PlanTaskReviewState/1.0',
      plan_id: planId,
      last_event: 'convene_complete',
      distinct_reviews: [],
      operator_stamp: operatorStamp
    })
  );
  return root;
}

test('flag ON + operator_stamp:null -> blocked (exit 2), operator-stamp-missing, no execution', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-null', { operatorStamp: null });
    const res = runRunPlan(root, { args: ['rp-null'] });
    assert.strictEqual(res.exitCode, 2);
    assert.match(res.stdout, /operator-stamp-missing/);
    assert.doesNotMatch(res.stdout, /AUTHORITY GRANTED/);
  });
});

// D1 (codex S5 review fix): PRESENCE IS NOT AUTHORITY. A present-but-unverified
// (hand-written) stamp on a perimeter plan now FAILS CLOSED — re-verified at run
// time against the version-bound GREENLIGHT proof.
test('flag ON + present-but-UNVERIFIED (hand-written) stamp on a perimeter plan -> BLOCKED (fail closed)', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-present-unverified', {
      operatorStamp: { by: '{OPERATOR_NAME} (human operator)', at: '2026-06-29T00:00:00Z' }
    });
    const res = runRunPlan(root, { args: ['rp-present-unverified'] });
    assert.strictEqual(res.exitCode, 2);
    assert.match(res.stdout, /operator-stamp-unverified/);
    assert.doesNotMatch(res.stdout, /AUTHORITY GRANTED/);
  });
});

// POSITIVE PATH: a perimeter plan WITH a verifier-passing GREENLIGHT proof (a
// valid HMAC stamp bound to the current plan digest) proceeds past the stamp gate.
test('flag ON + VERIFIED GREENLIGHT proof on a perimeter plan -> NOT stamp-blocked (proceeds)', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-verified', { operatorStamp: null });
    const stamp = validStampFor(root, 'rp-verified', TEST_SECRET);
    // Rewrite the marker to carry the valid stamp.
    const markerPath = path.join(root, '_dev/state/plan-task-review-state', 'rp-verified.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    marker.operator_stamp = stamp;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const res = runPlan(root, 'rp-verified', { greenlightVerify: injectedGreenlight(TEST_SECRET) });
    assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing|operator-stamp-unverified/);
  });
});

// A plan EDITED after stamping invalidates the version-bound proof (drift guard).
test('flag ON + valid stamp but plan EDITED after stamping -> BLOCKED (drift guard, fail closed)', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-drift', { operatorStamp: null });
    const stamp = validStampFor(root, 'rp-drift', TEST_SECRET);
    const markerPath = path.join(root, '_dev/state/plan-task-review-state', 'rp-drift.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    marker.operator_stamp = stamp;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    // Tamper the plan AFTER stamping — the bound digest no longer matches.
    const planPath = path.join(root, '_dev/reports/analysis/task-plans', 'rp-drift__plan.json');
    fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8') + ' ');
    const res = runPlan(root, 'rp-drift', { greenlightVerify: injectedGreenlight(TEST_SECRET) });
    assert.strictEqual(res.exitCode, 2);
    assert.match(res.stdout, /operator-stamp-unverified/);
  });
});

test('flag OFF (default) + operator_stamp:null -> NOT stamp-blocked (bootstrap safety)', () => {
  withFlag(undefined, () => {
    const root = makeRoot('rp-off', { operatorStamp: null });
    const res = runRunPlan(root, { args: ['rp-off'] });
    assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing/);
  });
});

test('flag ON + --skip-distinct-review cannot bypass the operator-stamp invariant', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-override', { operatorStamp: null });
    const res = runRunPlan(root, { args: ['rp-override', '--skip-distinct-review'] });
    assert.strictEqual(res.exitCode, 2);
    assert.match(String(res.stdout || ''), /operator-stamp-missing/);
    assert.match(String(res.stdout || ''), /bypasses distinct-review\/convene only/);
  });
});

test('shared gate off restores the legacy broad override as an explicit rollback', () => {
  const previous = process.env.SMOS_PLAN_RUN_GATE_MODE;
  process.env.SMOS_PLAN_RUN_GATE_MODE = 'off';
  try {
    withFlag('1', () => {
      const root = makeRoot('rp-override-off', { operatorStamp: null });
      const res = runRunPlan(root, { args: ['rp-override-off', '--skip-distinct-review'] });
      assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing/);
    });
  } finally {
    if (previous === undefined) delete process.env.SMOS_PLAN_RUN_GATE_MODE;
    else process.env.SMOS_PLAN_RUN_GATE_MODE = previous;
  }
});

// REGRESSION GUARD: the command-runner (tools/commands/smos-command-runner.cjs)
// dispatches runPlan() — NOT runRunPlan(). The stamp gate MUST live in runPlan
// or the real /run-plan path is ungated. Exercise runPlan directly.
test('DISPATCHED PATH: runPlan() (what the command-runner wires) blocks on null stamp when flag ON', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-dispatch-null', { operatorStamp: null });
    const res = runPlan(root, 'rp-dispatch-null', {});
    assert.strictEqual(res.exitCode, 2);
    assert.match(res.stdout, /operator-stamp-missing/);
    assert.doesNotMatch(res.stdout, /AUTHORITY GRANTED/);
  });
});

test('DISPATCHED PATH: runPlan() with present-but-UNVERIFIED stamp -> BLOCKED (presence is not authority)', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-dispatch-present', {
      operatorStamp: { by: '{OPERATOR_NAME} (human operator)', at: '2026-06-29T00:00:00Z' }
    });
    const res = runPlan(root, 'rp-dispatch-present', {});
    assert.strictEqual(res.exitCode, 2);
    assert.match(res.stdout, /operator-stamp-unverified/);
    assert.doesNotMatch(res.stdout, /AUTHORITY GRANTED/);
  });
});

test('DISPATCHED PATH: runPlan() with a VERIFIED GREENLIGHT proof is NOT stamp-blocked', () => {
  withFlag('1', () => {
    const root = makeRoot('rp-dispatch-verified', { operatorStamp: null });
    const stamp = validStampFor(root, 'rp-dispatch-verified', TEST_SECRET);
    const markerPath = path.join(root, '_dev/state/plan-task-review-state', 'rp-dispatch-verified.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    marker.operator_stamp = stamp;
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    const res = runPlan(root, 'rp-dispatch-verified', { greenlightVerify: injectedGreenlight(TEST_SECRET) });
    assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing|operator-stamp-unverified/);
  });
});

test('DISPATCHED PATH: runPlan() flag OFF -> never stamp-blocked (bootstrap safety)', () => {
  withFlag(undefined, () => {
    const root = makeRoot('rp-dispatch-off', { operatorStamp: null });
    const res = runPlan(root, 'rp-dispatch-off', {});
    assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing/);
  });
});
