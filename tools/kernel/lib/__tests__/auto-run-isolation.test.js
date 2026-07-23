'use strict';

/**
 * Tests for the S2 auto-run isolation library.
 * Repo convention: node --test (NOT jest).
 *
 * Mocks: git (createBranch), execStep, isDisabled, and exercises real S1
 * classification results through plan fixtures. Also proves the run-plan.js
 * inert integration leaves the default path unchanged.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const A = require('../auto-run-isolation.js');

// ---------------------------------------------------------------------------
// Fixtures / helpers.
// ---------------------------------------------------------------------------

/** A step that classifies SAFE (auto-run): plain text, explicit empty files. */
function safeStep(id, extra) {
  return Object.assign(
    { id, title: 'refactor helper ' + id, description: 'tidy internal code', files_touched: [] },
    extra
  );
}

/** A step that classifies GATE: spends money. */
function gatingStep(id) {
  return { id, title: 'raise campaign budget', description: 'increase daily budget', files_touched: [] };
}

function planOf(steps) {
  return { schema: 'TaskPlan/1.0', bounded_plan: { steps } };
}

/** Recording git mock. */
function mockGit() {
  const calls = [];
  return {
    calls,
    createBranch(name) { calls.push(name); },
  };
}

/** Recording execStep mock; optionally throws on a given step id. */
function mockExec(throwOnId) {
  const ran = [];
  const fn = (stepObj) => {
    const id = stepObj && (stepObj.id || stepObj.step_id);
    if (throwOnId && id === throwOnId) {
      throw new Error('boom@' + id);
    }
    ran.push(id);
  };
  fn.ran = ran;
  return fn;
}

// ---------------------------------------------------------------------------
// planAutoRunSegment — safe prefix computation.
// ---------------------------------------------------------------------------

describe('planAutoRunSegment', () => {
  it('all-auto-run when NO step gates', () => {
    const seg = A.planAutoRunSegment(planOf([safeStep('S1'), safeStep('S2'), safeStep('S3')]));
    assert.equal(seg.run_decision, 'all-auto-run');
    assert.deepEqual(seg.safe_prefix, ['S1', 'S2', 'S3']);
    assert.equal(seg.gated_step_id, null);
  });

  it('auto-run-prefix: prefix is the steps strictly before the first gate', () => {
    const seg = A.planAutoRunSegment(planOf([safeStep('S1'), safeStep('S2'), gatingStep('S3'), safeStep('S4')]));
    assert.equal(seg.run_decision, 'auto-run-prefix');
    assert.deepEqual(seg.safe_prefix, ['S1', 'S2']);
    assert.equal(seg.gated_step_id, 'S3');
  });

  it('gate-immediately when the FIRST step gates (empty safe prefix)', () => {
    const seg = A.planAutoRunSegment(planOf([gatingStep('S1'), safeStep('S2')]));
    assert.equal(seg.run_decision, 'gate-immediately');
    assert.deepEqual(seg.safe_prefix, []);
    assert.equal(seg.gated_step_id, 'S1');
  });

  it('gate-immediately (fail-closed) for a garbled/empty plan with no step id', () => {
    const seg = A.planAutoRunSegment({ schema: 'TaskPlan/1.0', bounded_plan: { steps: [] } });
    assert.equal(seg.run_decision, 'gate-immediately');
    assert.deepEqual(seg.safe_prefix, []);
    assert.equal(seg.gated_step_id, null);
    // The fail-closed plan_decision must be 'gate' (never silently auto-run).
    assert.equal(seg.classification.plan_decision, 'gate');
  });

  it('only the FIRST gate matters even if later steps also gate', () => {
    const seg = A.planAutoRunSegment(planOf([safeStep('S1'), gatingStep('S2'), gatingStep('S3')]));
    assert.deepEqual(seg.safe_prefix, ['S1']);
    assert.equal(seg.gated_step_id, 'S2');
  });
});

// ---------------------------------------------------------------------------
// runOnIsolatedBranch — runs only the prefix, stops at the gate.
// ---------------------------------------------------------------------------

describe('runOnIsolatedBranch', () => {
  it('creates an isolated branch and runs ONLY the safe prefix, stopping at the gate', () => {
    const git = mockGit();
    const exec = mockExec();
    const plan = planOf([safeStep('S1'), safeStep('S2'), gatingStep('S3'), safeStep('S4')]);

    const res = A.runOnIsolatedBranch({ planId: 'PLAN', planJson: plan, execStep: exec, git, stamp: 'abc123' });

    assert.equal(res.started, true);
    assert.equal(res.branch, 'auto-run/PLAN-abc123');
    assert.deepEqual(git.calls, ['auto-run/PLAN-abc123']); // fresh isolated branch
    assert.deepEqual(res.ran, ['S1', 'S2']);               // only the prefix ran
    assert.deepEqual(exec.ran, ['S1', 'S2']);
    assert.equal(res.stopped_at, 'S3');                    // stopped AT the gate
    assert.ok(!exec.ran.includes('S3'), 'the gated step must NEVER be executed');
    assert.equal(res.error, null);
  });

  it('all-auto-run executes every step and stops_at null', () => {
    const git = mockGit();
    const exec = mockExec();
    const res = A.runOnIsolatedBranch({
      planId: 'P2', planJson: planOf([safeStep('S1'), safeStep('S2')]), execStep: exec, git, stamp: 's',
    });
    assert.deepEqual(res.ran, ['S1', 'S2']);
    assert.equal(res.stopped_at, null);
    assert.equal(res.run_decision, 'all-auto-run');
  });

  it('gate-immediately runs nothing but still records the gated step', () => {
    const git = mockGit();
    const exec = mockExec();
    const res = A.runOnIsolatedBranch({
      planId: 'P3', planJson: planOf([gatingStep('S1'), safeStep('S2')]), execStep: exec, git, stamp: 's',
    });
    assert.deepEqual(res.ran, []);
    assert.deepEqual(exec.ran, []);
    assert.equal(res.stopped_at, 'S1');
    assert.equal(res.run_decision, 'gate-immediately');
  });

  it('passes the raw step object (not just the id) to execStep', () => {
    const git = mockGit();
    const seen = [];
    const exec = (s) => seen.push(s);
    const s1 = safeStep('S1', { description: 'unique-marker' });
    A.runOnIsolatedBranch({ planId: 'P', planJson: planOf([s1, gatingStep('S2')]), execStep: exec, git, stamp: 's' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].description, 'unique-marker');
  });

  // --- Fail safe / reversible / aloud on step error. ---
  it('on a step error: stops, leaves the branch, reports the error aloud', () => {
    const git = mockGit();
    const exec = mockExec('S2'); // S2 throws
    const plan = planOf([safeStep('S1'), safeStep('S2'), safeStep('S3'), gatingStep('S4')]);

    const res = A.runOnIsolatedBranch({ planId: 'PE', planJson: plan, execStep: exec, git, stamp: 'st' });

    assert.equal(res.started, true);
    assert.equal(res.branch, 'auto-run/PE-st');
    assert.deepEqual(git.calls, ['auto-run/PE-st'], 'branch is created and LEFT for inspection');
    assert.deepEqual(res.ran, ['S1']);          // S1 succeeded, S2 failed mid-step
    assert.equal(res.stopped_at, 'S2');
    assert.ok(res.error, 'error is reported aloud');
    assert.equal(res.error.step_id, 'S2');
    assert.match(res.error.message, /boom@S2/);
    assert.equal(res.reason, 'step-error');
  });

  // --- Kill switch. ---
  it('kill switch (isDisabled true) prevents start: no branch, no steps', () => {
    const git = mockGit();
    const exec = mockExec();
    const res = A.runOnIsolatedBranch({
      planId: 'PK', planJson: planOf([safeStep('S1'), gatingStep('S2')]),
      execStep: exec, git, stamp: 's', isDisabled: () => true,
    });
    assert.equal(res.started, false);
    assert.equal(res.disabled, true);
    assert.equal(res.branch, null);
    assert.deepEqual(res.ran, []);
    assert.deepEqual(git.calls, [], 'no branch created when disabled');
    assert.deepEqual(exec.ran, []);
  });

  it('kill switch flipped mid-run stops and reports aloud', () => {
    const git = mockGit();
    let calls = 0;
    // disabled becomes true after the first step has run.
    const isDisabled = () => (calls++ >= 2); // checked before each of S1,S2,S3...
    const exec = mockExec();
    const plan = planOf([safeStep('S1'), safeStep('S2'), safeStep('S3'), gatingStep('S4')]);
    const res = A.runOnIsolatedBranch({ planId: 'PM', planJson: plan, execStep: exec, git, stamp: 's', isDisabled });
    assert.equal(res.started, true);
    assert.equal(res.disabled, true);
    assert.equal(res.reason, 'kill-switch-disabled-midrun');
    assert.ok(res.ran.length < 3, 'did not run the whole prefix after mid-run disable');
  });

  // --- Contract validation (fail aloud). ---
  it('throws when stamp is missing (never Date.now())', () => {
    assert.throws(
      () => A.runOnIsolatedBranch({ planId: 'P', planJson: planOf([safeStep('S1')]), execStep: () => {}, git: mockGit() }),
      /stamp/
    );
  });

  it('throws when git.createBranch is not injected', () => {
    assert.throws(
      () => A.runOnIsolatedBranch({ planId: 'P', planJson: planOf([safeStep('S1')]), execStep: () => {}, stamp: 's' }),
      /git\.createBranch/
    );
  });

  it('accepts steps[] directly (no planJson) and classifies them', () => {
    const git = mockGit();
    const exec = mockExec();
    const res = A.runOnIsolatedBranch({
      planId: 'PD', steps: [safeStep('S1'), gatingStep('S2')], execStep: exec, git, stamp: 's',
    });
    assert.deepEqual(res.ran, ['S1']);
    assert.equal(res.stopped_at, 'S2');
  });
});

// ---------------------------------------------------------------------------
// run-plan.js INERT integration — default path is unchanged.
// ---------------------------------------------------------------------------

describe('run-plan.js inert integration', () => {
  const runPlanMod = require('../../../codex/commands/run-plan.js');

  it('autonomous execution is OFF by default', () => {
    const saved = process.env.SMOS_AUTONOMOUS_EXECUTION;
    delete process.env.SMOS_AUTONOMOUS_EXECUTION;
    try {
      assert.equal(runPlanMod.isAutonomousExecutionEnabled(), false);
    } finally {
      if (saved !== undefined) process.env.SMOS_AUTONOMOUS_EXECUTION = saved;
    }
  });

  it('the env flag toggles the helper but truthy parsing is strict', () => {
    const saved = process.env.SMOS_AUTONOMOUS_EXECUTION;
    try {
      process.env.SMOS_AUTONOMOUS_EXECUTION = 'true';
      assert.equal(runPlanMod.isAutonomousExecutionEnabled(), true);
      process.env.SMOS_AUTONOMOUS_EXECUTION = '1';
      assert.equal(runPlanMod.isAutonomousExecutionEnabled(), true);
      process.env.SMOS_AUTONOMOUS_EXECUTION = 'yes';
      assert.equal(runPlanMod.isAutonomousExecutionEnabled(), false);
      process.env.SMOS_AUTONOMOUS_EXECUTION = '';
      assert.equal(runPlanMod.isAutonomousExecutionEnabled(), false);
    } finally {
      if (saved === undefined) delete process.env.SMOS_AUTONOMOUS_EXECUTION;
      else process.env.SMOS_AUTONOMOUS_EXECUTION = saved;
    }
  });

  it('runPlan output is byte-identical whether the flag is OFF or ON (inert guard)', () => {
    const call = (flag) => {
      const saved = process.env.SMOS_AUTONOMOUS_EXECUTION;
      if (flag === undefined) delete process.env.SMOS_AUTONOMOUS_EXECUTION;
      else process.env.SMOS_AUTONOMOUS_EXECUTION = flag;
      let out;
      try {
        out = { result: runPlanMod.runPlan('/nonexistent-smos-root-xyz', 'no-such-task-id') };
      } catch (e) {
        out = { error: e && e.message };
      } finally {
        if (saved === undefined) delete process.env.SMOS_AUTONOMOUS_EXECUTION;
        else process.env.SMOS_AUTONOMOUS_EXECUTION = saved;
      }
      return out;
    };
    assert.deepEqual(call(undefined), call('true'));
  });
});
