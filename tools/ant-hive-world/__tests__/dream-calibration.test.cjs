'use strict';

// Coverage for tools/ant-hive-world/dream/calibration.js -- plan
// world-mind-dream-communication, S2. AC3: exact-expected-value fixtures
// covering HIT, MISS, UNRESOLVED-TIMEOUT (resolved per the metric-class
// rule, not excluded), and a ROLLED-BACK-GENERATION (quarantined) forecast.
// Also covers the codex fold-review MAJOR fix: one-outcome-per-forecast_id
// is mechanically enforced (FORECAST-ALREADY-RESOLVED), not merely
// documented.

const test = require('node:test');
const assert = require('node:assert/strict');

const calibration = require('../dream/calibration.js');

test('resolveForecastOutcome: HIT case -- occurrence metric, event observed within horizon', () => {
  const forecast = {
    forecast_id: 'f1', generation_id: 'gen-1', tick_issued: 100,
    target: { metric: 'patch_extinction', subject: 'tile-1', horizon_ticks: 50 },
    predicted_p: 0.9
  };
  const events = [{ subject: 'tile-1', tick: 130 }]; // within [100,150]
  const outcome = calibration.resolveForecastOutcome(forecast, events);
  assert.equal(outcome, true);
  assert.equal(calibration.brier(forecast.predicted_p, outcome), (0.9 - 1) ** 2);
  assert.ok(Math.abs(calibration.brier(forecast.predicted_p, outcome) - 0.01) < 1e-12);
});

test('resolveForecastOutcome: MISS case -- occurrence metric, predicted high but nothing observed by horizon', () => {
  const forecast = {
    forecast_id: 'f2', generation_id: 'gen-1', tick_issued: 100,
    target: { metric: 'starvation_event', subject: 'hive-a', horizon_ticks: 50 },
    predicted_p: 0.9
  };
  const events = []; // nothing observed
  const outcome = calibration.resolveForecastOutcome(forecast, events);
  assert.equal(outcome, false, 'occurrence metric resolves FALSE when not observed by horizon');
  const b = calibration.brier(forecast.predicted_p, outcome);
  assert.ok(Math.abs(b - 0.81) < 1e-12, `expected brier=0.81, got ${b}`);
});

test('resolveForecastOutcome: UNRESOLVED-TIMEOUT case, resolved per the metric-class rule, not excluded', () => {
  // Occurrence metric, nothing observed by horizon -> a definite FALSE
  // resolution (not an "unresolved, drop it" case).
  const occurrenceForecast = {
    forecast_id: 'f3', generation_id: 'gen-1', tick_issued: 0,
    target: { metric: 'recovery', subject: 'hive-a', horizon_ticks: 50 },
    predicted_p: 0.5
  };
  assert.equal(calibration.resolveForecastOutcome(occurrenceForecast, []), false);

  // Persistence metric, no disqualifying event observed by horizon -> a
  // definite TRUE resolution (sustained survival through the full window).
  const persistenceForecast = {
    forecast_id: 'f4', generation_id: 'gen-1', tick_issued: 0,
    target: { metric: 'sustained_survival', subject: 'hive-a', horizon_ticks: 50 },
    predicted_p: 0.8
  };
  assert.equal(calibration.resolveForecastOutcome(persistenceForecast, []), true);
  const b = calibration.brier(0.8, true);
  assert.ok(Math.abs(b - 0.04) < 1e-12, `expected brier=0.04, got ${b}`);
});

test('resolveForecastOutcome: persistence metric resolves FALSE when a disqualifying event is observed', () => {
  const forecast = {
    forecast_id: 'f5', generation_id: 'gen-1', tick_issued: 0,
    target: { metric: 'sustained_survival', subject: 'hive-a', horizon_ticks: 50 },
    predicted_p: 0.8
  };
  const disqualifyingEvents = [{ subject: 'hive-a', tick: 10 }]; // a starvation event in-window
  assert.equal(calibration.resolveForecastOutcome(forecast, disqualifyingEvents), false);
});

test('windowedBrier and authority: exact-expected-value fixture over 5 resolved forecasts', () => {
  const state = calibration.createCalibrationState();
  // predicted_p / outcome pairs chosen for a hand-computable mean.
  const fixtures = [
    { id: 'w1', p: 0.9, outcome: true },   // brier = 0.01
    { id: 'w2', p: 0.1, outcome: false },  // brier = 0.01
    { id: 'w3', p: 0.5, outcome: true },   // brier = 0.25
    { id: 'w4', p: 0.5, outcome: false },  // brier = 0.25
    { id: 'w5', p: 0.8, outcome: true }    // brier = 0.04
  ];
  for (const f of fixtures) {
    calibration.recordResolvedForecast(state, f.id, 'darkness', f.p, f.outcome);
  }
  // mean of [0.01, 0.01, 0.25, 0.25, 0.04] = 0.56 / 5 = 0.112
  const expectedMeanBrier = 0.112;
  const wb = calibration.windowedBrier(state, 'darkness');
  assert.ok(Math.abs(wb - expectedMeanBrier) < 1e-9, `expected windowed_brier=${expectedMeanBrier}, got ${wb}`);

  // authority = clamp(1 - 2*0.112, 0.1, 1.0) = clamp(0.776, 0.1, 1.0) = 0.776
  const expectedAuthority = 1 - 2 * expectedMeanBrier;
  const auth = calibration.authority(state, 'darkness');
  assert.ok(Math.abs(auth - expectedAuthority) < 1e-9, `expected authority=${expectedAuthority}, got ${auth}`);
});

test('authority reports the neutral prior 0.5 below the 5-forecast minimum', () => {
  const state = calibration.createCalibrationState();
  calibration.recordResolvedForecast(state, 'n1', 'hope', 0.9, true); // brier 0.01, only 1 resolved
  calibration.recordResolvedForecast(state, 'n2', 'hope', 0.9, true);
  calibration.recordResolvedForecast(state, 'n3', 'hope', 0.9, true);
  calibration.recordResolvedForecast(state, 'n4', 'hope', 0.9, true); // 4 resolved, still below MIN=5
  assert.equal(calibration.authority(state, 'hope'), 0.5);
});

test('authority clamps to the floor for a badly miscalibrated lane', () => {
  const state = calibration.createCalibrationState();
  for (let i = 0; i < 5; i += 1) {
    // predicted 0.95, outcome false every time -> brier = 0.9025 each ->
    // raw authority = 1 - 2*0.9025 = -0.805, clamped to floor 0.1.
    calibration.recordResolvedForecast(state, `floor-${i}`, 'darkness', 0.95, false);
  }
  assert.equal(calibration.authority(state, 'darkness'), calibration.AUTHORITY_FLOOR);
});

test('windowed ring buffer evicts oldest entries beyond WINDOW_SIZE=20', () => {
  const state = calibration.createCalibrationState();
  // 20 perfect predictions (brier=0), then 5 maximally-wrong predictions.
  for (let i = 0; i < 20; i += 1) calibration.recordResolvedForecast(state, `perfect-${i}`, 'hope', 1, true);
  for (let i = 0; i < 5; i += 1) calibration.recordResolvedForecast(state, `wrong-${i}`, 'hope', 1, false);
  assert.equal(state.hope.buffer.length, calibration.WINDOW_SIZE);
  // Only the most recent 20 entries remain: 15 perfect (brier=0) + 5 wrong (brier=1).
  const expectedMean = (15 * 0 + 5 * 1) / 20;
  assert.ok(Math.abs(calibration.windowedBrier(state, 'hope') - expectedMean) < 1e-9);
});

test('ROLLED-BACK-GENERATION: a quarantined forecast is excluded from the Brier window entirely', () => {
  const withoutQuarantined = calibration.createCalibrationState();
  const withQuarantined = calibration.createCalibrationState();

  const baseFixtures = [
    { id: 'q1', p: 0.9, outcome: true }, { id: 'q2', p: 0.1, outcome: false }, { id: 'q3', p: 0.5, outcome: true },
    { id: 'q4', p: 0.5, outcome: false }, { id: 'q5', p: 0.8, outcome: true }
  ];
  for (const f of baseFixtures) {
    calibration.recordResolvedForecast(withoutQuarantined, f.id, 'darkness', f.p, f.outcome);
    calibration.recordResolvedForecast(withQuarantined, f.id, 'darkness', f.p, f.outcome);
  }
  // This forecast belongs to a since-quarantined generation -- its outcome
  // scan would say MISS (predicted 0.99, outcome false, brier=0.9801), but
  // it must never enter the window.
  calibration.recordResolvedForecast(withQuarantined, 'q-quarantined', 'darkness', 0.99, false, { quarantined: true });

  assert.equal(
    calibration.windowedBrier(withQuarantined, 'darkness'),
    calibration.windowedBrier(withoutQuarantined, 'darkness'),
    'a quarantined forecast must not move the windowed_brier at all'
  );
  assert.equal(withQuarantined.darkness.buffer.length, 5, 'quarantined forecast must not even occupy a buffer slot');
});

test('assertForecastShape rejects a forecast missing required binding fields', () => {
  assert.throws(() => calibration.resolveForecastOutcome({ generation_id: 'g', tick_issued: 0, target: { metric: 'recovery', subject: 'x' }, predicted_p: 0.5 }, []), /forecast_id/);
  assert.throws(() => calibration.resolveForecastOutcome({ forecast_id: 'f', tick_issued: 0, target: { metric: 'recovery', subject: 'x' }, predicted_p: 0.5 }, []), /generation_id/);
  assert.throws(() => calibration.resolveForecastOutcome({ forecast_id: 'f', generation_id: 'g', tick_issued: 0, target: { metric: 'not-a-real-metric', subject: 'x' }, predicted_p: 0.5 }, []), /target.metric/);
});

// --- codex fold review MAJOR fix: one-outcome-per-forecast_id, enforced ---

test('(a) duplicate identical outcome for the same forecast_id throws FORECAST-ALREADY-RESOLVED', () => {
  const state = calibration.createCalibrationState();
  calibration.recordResolvedForecast(state, 'dup-1', 'darkness', 0.7, true);
  assert.throws(
    () => calibration.recordResolvedForecast(state, 'dup-1', 'darkness', 0.7, true),
    (err) => err instanceof calibration.ForecastAlreadyResolvedError && err.code === 'FORECAST-ALREADY-RESOLVED'
  );
});

test('(b) conflicting outcome for the same forecast_id throws and leaves the ORIGINAL resolution untouched', () => {
  const state = calibration.createCalibrationState();
  calibration.recordResolvedForecast(state, 'conflict-1', 'darkness', 0.7, true);
  const originalResolved = new Map(state.resolved);
  const originalBuffer = [...state.darkness.buffer];

  assert.throws(
    () => calibration.recordResolvedForecast(state, 'conflict-1', 'darkness', 0.2, false),
    (err) => err instanceof calibration.ForecastAlreadyResolvedError
      && err.forecastId === 'conflict-1'
      && err.existing.predictedP === 0.7 && err.existing.outcomeBool === true
      && err.attempted.predictedP === 0.2 && err.attempted.outcomeBool === false
  );

  // The original resolution is exactly as it was -- never overwritten, never
  // silently ignored, never averaged.
  assert.deepEqual(state.resolved, originalResolved);
  assert.deepEqual(state.darkness.buffer, originalBuffer);
  assert.equal(state.resolved.get('conflict-1').predictedP, 0.7);
  assert.equal(state.resolved.get('conflict-1').outcomeBool, true);
});

test('(c) the Brier window after an attempted rebinding equals the window before it -- no partial state leaks', () => {
  const state = calibration.createCalibrationState();
  const fixtures = [
    { id: 'w1', p: 0.9, outcome: true }, { id: 'w2', p: 0.1, outcome: false },
    { id: 'w3', p: 0.5, outcome: true }, { id: 'w4', p: 0.5, outcome: false }, { id: 'w5', p: 0.8, outcome: true }
  ];
  for (const f of fixtures) calibration.recordResolvedForecast(state, f.id, 'darkness', f.p, f.outcome);
  const windowBefore = calibration.windowedBrier(state, 'darkness');
  const authorityBefore = calibration.authority(state, 'darkness');

  assert.throws(() => calibration.recordResolvedForecast(state, 'w3', 'darkness', 0.99, false));

  const windowAfter = calibration.windowedBrier(state, 'darkness');
  const authorityAfter = calibration.authority(state, 'darkness');
  assert.equal(windowAfter, windowBefore, 'windowed_brier must be identical after a rejected rebinding attempt');
  assert.equal(authorityAfter, authorityBefore, 'authority must be identical after a rejected rebinding attempt');
  assert.equal(state.darkness.buffer.length, 5, 'buffer length must not grow from a rejected attempt');
});

test('a rejected quarantined rebinding attempt does not add a buffer entry either', () => {
  const state = calibration.createCalibrationState();
  calibration.recordResolvedForecast(state, 'quar-conflict', 'hope', 0.5, true); // enters the buffer (not quarantined)
  assert.equal(state.hope.buffer.length, 1);
  assert.throws(() => calibration.recordResolvedForecast(state, 'quar-conflict', 'hope', 0.9, false, { quarantined: true }));
  assert.equal(state.hope.buffer.length, 1, 'a rejected rebinding attempt, quarantined or not, must not touch the buffer');
});

test('recordResolvedForecast requires a forecast_id', () => {
  const state = calibration.createCalibrationState();
  assert.throws(() => calibration.recordResolvedForecast(state, null, 'darkness', 0.5, true), /forecast_id/);
});
