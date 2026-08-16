'use strict';

// Runs tools/ant-hive-world/planner-divergence-check.cjs's measurement (L1
// acceptance criterion, design doc S9 falsifier) and writes the honest
// result to a report artifact. This test asserts only that the measurement
// itself ran and produced a well-formed result -- the falsifier judgment
// (does the rate clear the >1% floor) is NOT asserted here as a pass/fail
// gate, on purpose: a real, non-tuned null result is evidence to report, not
// a CI failure to chase. See the written report artifact and the session
// debrief for the honest floor-clearance verdict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runDivergenceCheck } = require('../planner-divergence-check.cjs');

const REPORT_PATH = path.join(__dirname, '..', '..', '..', '_dev', 'reports', 'analysis', 'planner-divergence-check__L1.json');

test('planner-divergence-check runs and reports a well-formed, honest measurement (not asserted against the floor here -- see report artifact)', () => {
  const params = { ticks: 2000, seed: 424242, horizon: 30 };
  const { ticks, diverged, rate } = runDivergenceCheck(params);

  assert.equal(ticks, params.ticks);
  assert.ok(Number.isInteger(diverged) && diverged >= 0 && diverged <= ticks);
  assert.ok(rate >= 0 && rate <= 1);

  const DIVERGENCE_FLOOR = 0.01;
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    schema: 'PlannerDivergenceCheck/1.0',
    task_id: 'ant-sim-three-lobe-lane-redesign',
    step: 'L1',
    acceptance_criterion: 'design doc S9 falsifier -- PLANNER divergence rate on hive-A must clear the >1% floor',
    ticks,
    diverged_ticks: diverged,
    rate,
    rate_pct: `${(rate * 100).toFixed(2)}%`,
    floor: DIVERGENCE_FLOOR,
    clears_floor: rate > DIVERGENCE_FLOOR,
    params
  }, null, 2) + '\n');
});
