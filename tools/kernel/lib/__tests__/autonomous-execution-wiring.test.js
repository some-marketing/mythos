'use strict';

/**
 * S5 tests — autonomous-execution-wiring.js + the two live entrypoints
 * (run-plan.js, userprompt-plan-review-gate.cjs).
 * Repo convention: node --test (NOT jest).
 *
 * The KEY safety test is `DEFAULT (both flags OFF)` — run-plan + the gate hook
 * must behave byte-identically to before S5. Everything else proves the dormant
 * logic only engages behind the deliberate, default-OFF flags + an injected
 * executor, and that GREENLIGHT (operator-approval-verify) is the only authority.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const W = require('../autonomous-execution-wiring.js');
const runPlanMod = require('../../../codex/commands/run-plan.js');
const gate = require('../../hooks/userprompt-plan-review-gate.cjs');

const AUTO_FLAG = 'SMOS_AUTONOMOUS_EXECUTION';
const ENFORCE_FLAG = 'SMOS_ENFORCE_OPERATOR_STAMP';

// ---------------------------------------------------------------------------
// Fixtures / helpers.
// ---------------------------------------------------------------------------

function safeStep(id, extra) {
  return Object.assign({ id, step_id: id, title: 'refactor helper ' + id, description: 'tidy internal code', files_touched: [] }, extra);
}
function gatingStep(id) {
  return { id, step_id: id, title: 'raise campaign budget', description: 'increase daily ad spend', files_touched: [] };
}
function planOf(steps) {
  return { schema: 'TaskPlan/1.0', task_id: 'PLAN', bounded_plan: { steps } };
}
function mockGit() {
  const calls = [];
  return { calls, createBranch(name) { calls.push(name); } };
}
/** Async recording execStep; optionally rejects on a given step id. */
function asyncExec(throwOnId) {
  const ran = [];
  const fn = async (stepObj) => {
    const id = stepObj && (stepObj.id || stepObj.step_id);
    // Force a real async tick so a non-awaited caller would proceed before ran[] is set.
    await Promise.resolve();
    if (throwOnId && id === throwOnId) throw new Error('boom@' + id);
    ran.push(id);
  };
  fn.ran = ran;
  return fn;
}

function withEnv(map, fn) {
  const saved = {};
  for (const k of Object.keys(map)) {
    saved[k] = process.env[k];
    if (map[k] === undefined) delete process.env[k];
    else process.env[k] = map[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(map)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** Temp root with a resolvable plan + a marker (null stamp, satisfying review). */
function makeRoot(planId, { perimeter, operatorStamp }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's5-wiring-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  const markerDir = path.join(root, '_dev/state/plan-task-review-state');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  const step = perimeter ? gatingStep('s1') : safeStep('s1', { files_touched: ['tools/x.js'] });
  fs.writeFileSync(
    path.join(planDir, `${planId}__plan.json`),
    JSON.stringify({ task_id: planId, scope_type: 'system', routing_expectations: { risk_tier: 'medium' }, bounded_plan: { steps: [step] } })
  );
  fs.writeFileSync(
    path.join(markerDir, `${planId}.json`),
    JSON.stringify({ schema: 'PlanTaskReviewState/1.0', plan_id: planId, last_event: 'convene_complete', distinct_reviews: [{ actor: 'codex', verdict: 'approve', artifact: 'r.md' }], operator_stamp: operatorStamp === undefined ? null : operatorStamp })
  );
  return root;
}

// ===========================================================================
// THE KEY SAFETY TEST: default (both flags OFF) is byte-identical to pre-S5.
// ===========================================================================

describe('DEFAULT (both flags OFF/unset): byte-identical behavior', () => {
  it('run-plan: output is identical whether SMOS_AUTONOMOUS_EXECUTION is unset, true, or 1 (no executor injected)', () => {
    const call = (autoFlag) => withEnv({ [AUTO_FLAG]: autoFlag, [ENFORCE_FLAG]: undefined }, () => {
      try { return { result: runPlanMod.runPlan('/nonexistent-smos-root-xyz', 'no-such-task-id', {}) }; }
      catch (e) { return { error: e && e.message }; }
    });
    const base = call(undefined);
    assert.deepEqual(base, call('true'));
    assert.deepEqual(base, call('1'));
  });

  it('run-plan: a resolvable null-stamp plan is NEVER stamp-blocked when ENFORCE is OFF (pre-S5 behavior preserved)', () => {
    withEnv({ [ENFORCE_FLAG]: undefined, [AUTO_FLAG]: undefined }, () => {
      const root = makeRoot('def-plan', { perimeter: true, operatorStamp: null });
      const res = runPlanMod.runPlan(root, 'def-plan', {});
      // The stamp gate is the only thing S5 touches on this path; with ENFORCE
      // OFF it must NOT fire (the perimeter consult is never reached).
      assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing/);
    });
  });

  it('run-plan: flag-OFF outcome is identical for a perimeter vs non-perimeter plan (perimeter consult never runs)', () => {
    withEnv({ [ENFORCE_FLAG]: undefined, [AUTO_FLAG]: undefined }, () => {
      const rootP = makeRoot('def-peri', { perimeter: true, operatorStamp: null });
      const rootN = makeRoot('def-nonp', { perimeter: false, operatorStamp: null });
      const a = runPlanMod.runPlan(rootP, 'def-peri', {});
      const b = runPlanMod.runPlan(rootN, 'def-nonp', {});
      // Same exit code + same (non-stamp) blocking shape — perimeter is invisible
      // when ENFORCE is OFF; only the plan id text differs.
      assert.equal(a.exitCode, b.exitCode);
      assert.doesNotMatch(String(a.stdout || ''), /operator-stamp-missing/);
      assert.doesNotMatch(String(b.stdout || ''), /operator-stamp-missing/);
    });
  });

  it('gate hook: flag-OFF /run-plan injection is identical for a perimeter vs non-perimeter plan (no stamp branch, no perimeter consult)', () => {
    withEnv({ [ENFORCE_FLAG]: undefined }, () => {
      const rootP = makeRoot('hook-peri', { perimeter: true, operatorStamp: null });
      const rootN = makeRoot('hook-nonp', { perimeter: false, operatorStamp: null });
      const a = gate.evaluateGate('/run-plan hook-peri', rootP, 's');
      const b = gate.evaluateGate('/run-plan hook-nonp', rootN, 's');
      assert.equal(a.action, 'inject');
      assert.equal(b.action, 'inject');
      assert.doesNotMatch(a.text, /OPERATOR STAMP/);
      assert.doesNotMatch(b.text, /OPERATOR STAMP/);
      assert.match(a.text, /PASS/);
      assert.match(b.text, /PASS/);
    });
  });

  it('gate hook: a non-/run-plan prompt is still a silent no-op', () => {
    const res = gate.evaluateGate('just chatting about the weather', '/tmp', 's');
    assert.equal(res.action, 'silent');
  });
});

// ===========================================================================
// (1) Perimeter-scoped enforcement (SMOS_ENFORCE_OPERATOR_STAMP ON).
// ===========================================================================

describe('perimeter-scoped GREENLIGHT enforcement (ENFORCE flag ON)', () => {
  it('run-plan: perimeter plan with NO stamp is BLOCKED (operator-stamp-missing)', () => {
    withEnv({ [ENFORCE_FLAG]: '1' }, () => {
      const root = makeRoot('enf-peri-null', { perimeter: true, operatorStamp: null });
      const res = runPlanMod.runPlan(root, 'enf-peri-null', {});
      assert.equal(res.exitCode, 2);
      assert.match(res.stdout, /operator-stamp-missing/);
      assert.doesNotMatch(res.stdout, /AUTHORITY GRANTED/);
    });
  });

  it('run-plan: NON-perimeter plan with NO stamp runs WITHOUT a stamp (enforcement relaxed off the perimeter)', () => {
    withEnv({ [ENFORCE_FLAG]: '1' }, () => {
      const root = makeRoot('enf-nonp-null', { perimeter: false, operatorStamp: null });
      const res = runPlanMod.runPlan(root, 'enf-nonp-null', {});
      assert.doesNotMatch(String(res.stdout || ''), /operator-stamp-missing/);
    });
  });

  it('run-plan: perimeter plan with a present-but-UNVERIFIED stamp is BLOCKED (presence is not authority)', () => {
    withEnv({ [ENFORCE_FLAG]: '1' }, () => {
      const root = makeRoot('enf-peri-present', { perimeter: true, operatorStamp: { by: '{OPERATOR_NAME} (human operator)', at: '2026-06-29T00:00:00Z' } });
      const res = runPlanMod.runPlan(root, 'enf-peri-present', {});
      assert.equal(res.exitCode, 2);
      assert.match(res.stdout, /operator-stamp-unverified/);
    });
  });

  it('gate hook: perimeter plan + null stamp + ENFORCE ON -> DO NOT EXECUTE + OPERATOR STAMP missing', () => {
    withEnv({ [ENFORCE_FLAG]: '1' }, () => {
      const root = makeRoot('hook-enf-peri', { perimeter: true, operatorStamp: null });
      const res = gate.evaluateGate('/run-plan hook-enf-peri', root, 's');
      assert.match(res.text, /OPERATOR STAMP/);
      assert.match(res.text, /DO NOT EXECUTE/);
    });
  });

  it('gate hook: NON-perimeter plan + null stamp + ENFORCE ON -> PASS (no stamp entry)', () => {
    withEnv({ [ENFORCE_FLAG]: '1' }, () => {
      const root = makeRoot('hook-enf-nonp', { perimeter: false, operatorStamp: null });
      const res = gate.evaluateGate('/run-plan hook-enf-nonp', root, 's');
      assert.doesNotMatch(res.text, /OPERATOR STAMP/);
      assert.match(res.text, /PASS/);
    });
  });

  it('planTripsPerimeter: FAIL-CLOSED on null/garbled, true for perimeter, false for auto-run', () => {
    assert.equal(W.planTripsPerimeter(null), true);
    assert.equal(W.planTripsPerimeter({ nonsense: true }), true); // no steps => fail-closed gate
    assert.equal(W.planTripsPerimeter(planOf([gatingStep('S1')])), true);
    assert.equal(W.planTripsPerimeter(planOf([safeStep('S1', { files_touched: ['tools/x.js'] })])), false);
  });
});

// ===========================================================================
// (2) Autonomous execution (async runner) + kill switches + projection.
// ===========================================================================

describe('runOnIsolatedBranchAsync — async safe-prefix execution', () => {
  it('AWAITS an async execStep: ran[] is fully populated (a non-awaited caller would miss them)', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'P', planJson: planOf([safeStep('S1'), safeStep('S2'), gatingStep('S3')]), execStep: exec, git, stamp: 'abc' });
    assert.deepEqual(res.ran, ['S1', 'S2']);
    assert.deepEqual(exec.ran, ['S1', 'S2']); // proves each await resolved before the loop advanced
    assert.equal(res.branch, 'auto-run/P-abc');
    assert.deepEqual(git.calls, ['auto-run/P-abc']);
    assert.equal(res.stopped_at, 'S3');
    assert.equal(res.reason, 'stopped-at-gate');
  });

  it('STOPS at the gate and never runs the gated step', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'P', planJson: planOf([safeStep('S1'), gatingStep('S2'), safeStep('S3')]), execStep: exec, git, stamp: 's' });
    assert.deepEqual(res.ran, ['S1']);
    assert.ok(!exec.ran.includes('S2'), 'the gated step must NEVER be executed');
  });

  it('gate-immediately (first step gates): runs nothing', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'P', planJson: planOf([gatingStep('S1'), safeStep('S2')]), execStep: exec, git, stamp: 's' });
    assert.deepEqual(res.ran, []);
    assert.equal(res.run_decision, 'gate-immediately');
    assert.equal(res.stopped_at, 'S1');
  });

  it('async step error: stops, leaves the branch, reports aloud', async () => {
    const git = mockGit();
    const exec = asyncExec('S2');
    const res = await W.runOnIsolatedBranchAsync({ planId: 'PE', planJson: planOf([safeStep('S1'), safeStep('S2'), gatingStep('S3')]), execStep: exec, git, stamp: 's' });
    assert.deepEqual(res.ran, ['S1']);
    assert.equal(res.stopped_at, 'S2');
    assert.equal(res.reason, 'step-error');
    assert.match(res.error.message, /boom@S2/);
    assert.deepEqual(git.calls, ['auto-run/PE-s'], 'branch left for inspection');
  });

  it('KILL SWITCH (isDisabled true) prevents start: no branch, no steps', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'PK', planJson: planOf([safeStep('S1'), gatingStep('S2')]), execStep: exec, git, stamp: 's', isDisabled: () => true });
    assert.equal(res.started, false);
    assert.equal(res.disabled, true);
    assert.deepEqual(git.calls, []);
    assert.deepEqual(exec.ran, []);
    assert.equal(res.reason, 'kill-switch-disabled');
  });

  it('KILL SWITCH flipped mid-run halts and reports aloud', async () => {
    const git = mockGit();
    let n = 0;
    const isDisabled = () => (n++ >= 2);
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'PM', planJson: planOf([safeStep('S1'), safeStep('S2'), safeStep('S3'), gatingStep('S4')]), execStep: exec, git, stamp: 's', isDisabled });
    assert.equal(res.disabled, true);
    assert.equal(res.reason, 'kill-switch-disabled-midrun');
    assert.ok(res.ran.length < 3);
  });

  it('PER-PLAN BLOCKED (isPlanBlocked true) halts before start', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'PB', planJson: planOf([safeStep('S1'), gatingStep('S2')]), execStep: exec, git, stamp: 's', isPlanBlocked: async () => true });
    assert.equal(res.disabled, true);
    assert.equal(res.reason, 'plan-blocked');
    assert.deepEqual(git.calls, []);
  });

  it('throws when stamp is missing (never Date.now())', async () => {
    await assert.rejects(
      () => W.runOnIsolatedBranchAsync({ planId: 'P', planJson: planOf([safeStep('S1')]), execStep: async () => {}, git: mockGit() }),
      /stamp/
    );
  });
});

// ---------------------------------------------------------------------------
// runAutonomously — composes S2 + S3 (Dart projection) + S4.
// ---------------------------------------------------------------------------

describe('runAutonomously (S2+S3+S4 composition)', () => {
  /** Dart mock recording projection (parent-only, density-collapse) + comments. */
  function mockDart() {
    const created = [];
    const comments = [];
    let counter = 0;
    return {
      created, comments,
      listTasks: async () => ({ results: [] }),
      createTask: async (t) => { const id = 'task-' + (++counter); created.push({ id, ...t }); return { item: { id } }; },
      updateTask: async (id, patch) => ({ id, ...patch }),
      addComment: async (taskId, text) => { comments.push({ taskId, text }); return { item: { id: 'comment-' + (++counter) } }; },
      getTask: async (id) => ({ id, status: 'Doing' }), // never Blocked here
    };
  }

  it('projects the plan to Dart as ONE parent card and syncs running/done as step COMMENTS on that parent (observability only)', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const dart = mockDart();
    const res = await W.runAutonomously({ planId: 'PA', planJson: planOf([safeStep('S1'), gatingStep('S2')]), execStep: exec, git, stamp: 's', dart, dartboard: 'Board', isDisabled: () => false });
    assert.deepEqual(res.ran, ['S1']);
    assert.ok(res.projection && res.projection.parentId, 'projected to Dart as a single parent card');
    assert.deepEqual(res.projection.subtaskIds, [], 'density collapse: zero child cards');
    assert.strictEqual(dart.created.length, 1, 'exactly one Dart card created for the whole plan');

    // S1 went running -> done; the gated S2 was marked Blocked — all as
    // comments on the SAME single parent card (never a subtask write).
    const parentId = res.projection.parentId;
    assert.ok(dart.comments.every((c) => c.taskId === parentId), 'every step comment targets the single parent card');
    const texts = dart.comments.map((c) => c.text);
    assert.ok(texts.some((t) => t.includes('-> Doing')));
    assert.ok(texts.some((t) => t.includes('-> Done')));
    assert.ok(texts.some((t) => t.includes('-> Blocked')), 'gated step surfaced as a Blocked comment');
    assert.ok(texts.every((t) => t.startsWith('[System] ')), 'each comment carries the [System] prefix');
  });

  it('a Dart Blocked subtask HALTS the run (status read used ONLY to halt, never to authorize)', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const dart = mockDart();
    dart.getTask = async (id) => ({ id, status: 'Blocked' }); // operator dragged a card to Blocked
    const res = await W.runAutonomously({ planId: 'PBlk', planJson: planOf([safeStep('S1'), safeStep('S2'), gatingStep('S3')]), execStep: exec, git, stamp: 's', dart, dartboard: 'Board', isDisabled: () => false });
    assert.equal(res.disabled, true);
    assert.match(res.reason, /plan-blocked/);
  });

  it('a Dart projection failure NEVER blocks or authorizes execution (fail-open observability)', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const dart = { ...mockDart(), createTask: async () => { throw new Error('dart down'); }, listTasks: async () => { throw new Error('dart down'); } };
    const res = await W.runAutonomously({ planId: 'PFail', planJson: planOf([safeStep('S1'), gatingStep('S2')]), execStep: exec, git, stamp: 's', dart, dartboard: 'Board', isDisabled: () => false });
    assert.deepEqual(res.ran, ['S1']); // execution still proceeded
    assert.equal(res.projection, null);
  });
});

// ===========================================================================
// Authority invariants: GREENLIGHT is the ONLY may-proceed signal.
// ===========================================================================

describe('authority invariants (no-self-approval / no-status-authorizes)', () => {
  it('the wiring surface exports NO authorize/resume/start/grant function', () => {
    const banned = /approve|authorize|resume|greenlight|grant|may[_-]?run/i;
    for (const name of Object.keys(W)) {
      // verifyPerimeterGreenlight is the sole may-proceed signal and is a pure
      // delegate to operator-approval-verify; allow it explicitly.
      if (name === 'verifyPerimeterGreenlight') continue;
      assert.doesNotMatch(name, banned, 'unexpected authority-shaped export: ' + name);
    }
  });

  it('verifyPerimeterGreenlight DELEGATES to operator-approval-verify: valid operator proof -> verified:true', async () => {
    const verify = require('../../../planning/lib/operator-approval-verify.js');
    const PLAN_TEXT = JSON.stringify({ task_id: 'plan-x', bounded_plan: { steps: [{ step_id: 's1' }] } });
    const SHA = verify.computePlanSha256(PLAN_TEXT);
    const CONVENTION = verify.buildApprovalConventionString('plan-x', SHA);
    const comment = { commentId: 'c1', authorDuid: 'usr_{OPERATOR_NAME}', authorName: '{OPERATOR_NAME}', text: CONVENTION };
    const r = await W.verifyPerimeterGreenlight({
      planId: 'plan-x', planText: PLAN_TEXT, taskId: 't1', citedCommentId: 'c1',
      operatorIdentity: { duid: 'usr_{OPERATOR_NAME}', email: 'get@example-agency.com', name: '{OPERATOR_NAME}' },
      dartApi: { getCommentAuthor: async () => comment },
    });
    assert.equal(r.verified, true, r.reason);
    assert.equal(r.mechanism, 'dart');
  });

  it('verifyPerimeterGreenlight FAILS CLOSED with no proof supplied', async () => {
    const r = await W.verifyPerimeterGreenlight({ planId: 'plan-x', planText: '{"task_id":"plan-x"}' });
    assert.equal(r.verified, false);
  });

  it('verifyPresentStampSync (D1 run-time re-verify): valid HMAC -> verified; tampered/non-object/drift -> fail-closed', () => {
    const stampPlan = require('../../../planning/stamp-plan');
    const verify = require('../../../planning/lib/operator-approval-verify');
    const SECRET = 'unit-secret-123';
    const planText = JSON.stringify({ task_id: 'plan-x', bounded_plan: { steps: [] } });
    const planSha256 = verify.computePlanSha256(planText);
    const goodStamp = stampPlan.buildStamp(SECRET, { planId: 'plan-x', planSha256, timestamp: '2026-06-29T00:00:00Z' });

    // valid -> verified
    assert.equal(W.verifyPresentStampSync({ planId: 'plan-x', planText, stamp: goodStamp, hmacSecret: SECRET }).verified, true);
    // presence-only / non-proof object -> fail closed
    assert.equal(W.verifyPresentStampSync({ planId: 'plan-x', planText, stamp: { by: '{OPERATOR_NAME}' }, hmacSecret: SECRET }).verified, false);
    // tampered MAC -> fail closed
    assert.equal(W.verifyPresentStampSync({ planId: 'plan-x', planText, stamp: { ...goodStamp, mac: 'deadbeef' }, hmacSecret: SECRET }).verified, false);
    // wrong secret -> fail closed
    assert.equal(W.verifyPresentStampSync({ planId: 'plan-x', planText, stamp: goodStamp, hmacSecret: 'wrong' }).verified, false);
    // plan edited after stamping (digest drift) -> fail closed
    assert.equal(W.verifyPresentStampSync({ planId: 'plan-x', planText: planText + ' ', stamp: goodStamp, hmacSecret: SECRET }).verified, false);
    // missing secret -> fail closed (no env opt-in)
    assert.equal(W.verifyPresentStampSync({ planId: 'plan-x', planText, stamp: goodStamp, hmacSecret: null }).verified, false);
  });

  it('the classifier alone does NOT authorize a gated step: a perimeter plan auto-runs NOTHING', async () => {
    const git = mockGit();
    const exec = asyncExec();
    const res = await W.runOnIsolatedBranchAsync({ planId: 'PG', planJson: planOf([gatingStep('S1'), safeStep('S2')]), execStep: exec, git, stamp: 's' });
    assert.deepEqual(res.ran, []);
    assert.equal(res.gated_step_id, 'S1');
  });
});
