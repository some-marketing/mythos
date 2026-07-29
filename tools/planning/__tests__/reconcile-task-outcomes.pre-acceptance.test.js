'use strict';

/**
 * Tests for reconcile-task-outcomes.js pre-acceptance marking (grounding A1).
 *
 * Falsifiable contract:
 *   - PRE-ACCEPTANCE is eligible ONLY for high-confidence + complete + a real
 *     verification artifact (debrief or verify-local).
 *   - The pre_acceptance_verified stage NEVER sets completion truth:
 *     operator_acceptance stays false and pre_acceptance.finalized stays false.
 *   - Without --apply, nothing is marked pre_acceptance_verified.
 *
 * Run: node --test tools/planning/__tests__/reconcile-task-outcomes.pre-acceptance.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  preAcceptanceEligible,
  buildStagedOutcome,
  applyWindow,
  loadActivation,
  recordObservation,
  isActivated,
  activationPath,
} = require('../reconcile-task-outcomes');

const planMeta = { scope: 'system', planPath: '/repo/_dev/reports/analysis/task-plans/x__plan.json' };

const highVerified = {
  status: 'complete',
  confidence: 'high',
  summary: 'debrief + ship commit',
  evidence: { git_commits: [{ sha: 'a', subject: 'feat: x' }], debrief_artifacts: ['run-debrief__x.json'], verify_local_artifacts: [], closed_signals: [] },
};
const highNoArtifact = {
  status: 'complete',
  confidence: 'high',
  summary: 'high but no artifact',
  evidence: { git_commits: [], debrief_artifacts: [], verify_local_artifacts: [], closed_signals: [] },
};
const mediumComplete = {
  status: 'complete',
  confidence: 'medium',
  summary: 'two commits, no debrief',
  evidence: { git_commits: [], debrief_artifacts: [], verify_local_artifacts: [], closed_signals: [] },
};

test('eligible only for high-confidence complete WITH a verification artifact', () => {
  assert.equal(preAcceptanceEligible(highVerified), true);
  assert.equal(preAcceptanceEligible(highNoArtifact), false);
  assert.equal(preAcceptanceEligible(mediumComplete), false);
});

test('--apply marks eligible case pre_acceptance_verified but NOT finalized', () => {
  const out = buildStagedOutcome('x', highVerified, planMeta, { apply: true });
  assert.equal(out.acceptance_stage, 'pre_acceptance_verified');
  assert.ok(out.pre_acceptance, 'pre_acceptance block present');
  // Completion truth is NEVER set here.
  assert.equal(out.pre_acceptance.finalized, false);
  assert.equal(out.pre_acceptance.operator_acceptance, false);
  assert.equal(out.pre_acceptance.ratification_required, true);
  assert.equal(out.proposed_outcome_args.operator_acceptance, false);
});

test('--apply does NOT promote medium/high-without-artifact past staged', () => {
  const med = buildStagedOutcome('x', mediumComplete, planMeta, { apply: true });
  assert.equal(med.acceptance_stage, 'staged');
  assert.equal(med.pre_acceptance, undefined);

  const bare = buildStagedOutcome('x', highNoArtifact, planMeta, { apply: true });
  assert.equal(bare.acceptance_stage, 'staged');
});

test('dry-run (no --apply) never marks pre_acceptance_verified', () => {
  const out = buildStagedOutcome('x', highVerified, planMeta, { apply: false });
  assert.equal(out.acceptance_stage, 'staged');
  assert.equal(out.pre_acceptance, undefined);
  assert.equal(out.proposed_outcome_args.operator_acceptance, false);
});

// ── FIX 2: A3 observation window gating (mirror of homeostasis) ──────────────

test('applyWindow defaults to 3 and honors SMOS_HYGIENE_APPLY_WINDOW', () => {
  const prev = process.env.SMOS_HYGIENE_APPLY_WINDOW;
  try {
    delete process.env.SMOS_HYGIENE_APPLY_WINDOW;
    assert.equal(applyWindow(), 3);
    process.env.SMOS_HYGIENE_APPLY_WINDOW = '5';
    assert.equal(applyWindow(), 5);
    process.env.SMOS_HYGIENE_APPLY_WINDOW = 'garbage';
    assert.equal(applyWindow(), 3, 'unparseable window falls back to default');
  } finally {
    if (prev === undefined) delete process.env.SMOS_HYGIENE_APPLY_WINDOW;
    else process.env.SMOS_HYGIENE_APPLY_WINDOW = prev;
  }
});

test('activation window advances via recordObservation and gates isActivated', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-act-'));
  try {
    // Fresh: zero observed cycles -> not activated at threshold 3.
    assert.equal(loadActivation(base).observed_cycles, 0);
    assert.equal(isActivated(base, 3), false);

    recordObservation(base);
    recordObservation(base);
    assert.equal(loadActivation(base).observed_cycles, 2);
    assert.equal(isActivated(base, 3), false, 'still short of the window');

    recordObservation(base);
    assert.equal(loadActivation(base).observed_cycles, 3);
    assert.equal(isActivated(base, 3), true, 'threshold met -> activated');

    // Durable artifact persisted with the expected schema.
    const act = JSON.parse(fs.readFileSync(activationPath(base), 'utf8'));
    assert.equal(act.schema, 'HygieneApplyActivation/1.0');
    assert.equal(act.apply_class, 'reconcile-task-outcomes-pre-acceptance');
    assert.ok(act.last_observed, 'last_observed timestamp recorded');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
