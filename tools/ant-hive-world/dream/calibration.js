#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/dream/calibration.js — S2 (calibration half) of plan
// world-mind-dream-communication. Deterministic, mechanical, no network
// calls, no LLM. Versioned numeric contract (AMENDMENT v2 D3) over a
// forecast/outcome BINDING contract (AMENDMENT v3).
//
// FORECAST/OUTCOME BINDING: every vault forecast entry carries
// {forecast_id, generation_id, tick_issued,
//  target: {metric, subject, horizon_ticks}, predicted_p}.
// Outcome resolution is a mechanical scan (via consequence-ledger.js's
// classifiers) of run-log/world-state events for `subject` within
// [tick_issued, tick_issued + horizon_ticks] -- one outcome per forecast_id,
// no rebinding once resolved.
//
// RESOLUTION RULE PER METRIC CLASS: OCCURRENCE metrics (patch_extinction,
// starvation_event, recovery) resolve FALSE if not observed by the horizon
// (the event provably did not happen in time). The PERSISTENCE metric
// (sustained_survival) resolves TRUE if no disqualifying event was observed
// by the horizon (survival was sustained through the full window). Both are
// DEFINITE resolutions at the horizon, not exclusions -- "unresolved-timeout"
// is a labeled CASE in the fixtures, not a class of forecast that goes
// unscored.
//
// A forecast whose generation_id is quarantined (S1) is excluded from the
// Brier window entirely, regardless of what its outcome scan would say --
// unverifiable-lineage evidence never enters calibration.
//
// WINDOWED BRIER SCORE per forecast lane (darkness, hope):
//   brier = (predicted_p - outcome)^2
// enters a per-lane ring buffer of window size W=20 resolved (non-
// quarantined) forecasts (oldest evicted); windowed_brier = mean(buffer);
// authority = clamp(1 - 2*windowed_brier, floor=0.1, ceiling=1.0) --
// deterministic, symmetric (a confident-wrong prediction in either direction
// produces the same brier penalty). Below 5 resolved forecasts in a lane,
// authority reports neutral prior 0.5.

const HORIZON_TICKS_DEFAULT = 50; // H=50
const WINDOW_SIZE = 20; // W=20
const NEUTRAL_PRIOR = 0.5;
const MIN_RESOLVED_FOR_AUTHORITY = 5;
const AUTHORITY_FLOOR = 0.1;
const AUTHORITY_CEILING = 1.0;

const LANES = Object.freeze(['darkness', 'hope']);
const OCCURRENCE_METRICS = Object.freeze(['patch_extinction', 'starvation_event', 'recovery']);
const PERSISTENCE_METRICS = Object.freeze(['sustained_survival']);
const METRIC_ENUM = Object.freeze([...OCCURRENCE_METRICS, ...PERSISTENCE_METRICS]);

function assertForecastShape(forecast) {
  if (!forecast || typeof forecast !== 'object') throw new Error('calibration: forecast must be an object');
  if (!forecast.forecast_id) throw new Error('calibration: forecast_id is required');
  if (!forecast.generation_id) throw new Error('calibration: generation_id is required');
  if (!Number.isInteger(forecast.tick_issued)) throw new Error('calibration: tick_issued must be an integer');
  if (!forecast.target || !METRIC_ENUM.includes(forecast.target.metric)) {
    throw new Error(`calibration: target.metric must be one of ${METRIC_ENUM.join('|')}`);
  }
  if (forecast.target.subject === undefined || forecast.target.subject === null) {
    throw new Error('calibration: target.subject is required');
  }
  if (typeof forecast.predicted_p !== 'number' || forecast.predicted_p < 0 || forecast.predicted_p > 1) {
    throw new Error('calibration: predicted_p must be a number in [0,1]');
  }
}

function subjectEventInWindow(events, subject, startTick, endTickInclusive) {
  return (events || []).some((e) => e.subject === subject && e.tick >= startTick && e.tick <= endTickInclusive);
}

// Resolve a single forecast's outcome mechanically. `metricEvents` is the
// set of ledger events for exactly this forecast's target.metric class
// (produced by consequence-ledger.js's classifiers, already keyed by field
// name) -- for an OCCURRENCE metric these are the events themselves; for the
// PERSISTENCE metric (sustained_survival) these are DISQUALIFYING events
// (starvation_event records) for the same subject.
function resolveForecastOutcome(forecast, metricEvents) {
  assertForecastShape(forecast);
  const horizonTicks = Number.isInteger(forecast.target.horizon_ticks) ? forecast.target.horizon_ticks : HORIZON_TICKS_DEFAULT;
  const windowEnd = forecast.tick_issued + horizonTicks;
  const observed = subjectEventInWindow(metricEvents, forecast.target.subject, forecast.tick_issued, windowEnd);
  const isOccurrence = OCCURRENCE_METRICS.includes(forecast.target.metric);
  // Occurrence: observed by horizon -> TRUE; not observed -> FALSE (definite).
  // Persistence: a disqualifying event observed -> FALSE (survival broken);
  // none observed by horizon -> TRUE (sustained through the window).
  return isOccurrence ? observed : !observed;
}

function brier(predictedP, outcomeBool) {
  const outcome = outcomeBool ? 1 : 0;
  return (predictedP - outcome) ** 2;
}

// Deterministic, named refusal (codex fold review, MAJOR): recording a
// second outcome for a forecast_id that already has one must never
// overwrite, silently ignore, or average -- it must throw. `code` is stable
// across error messages so callers can branch on it without string-matching
// the message.
class ForecastAlreadyResolvedError extends Error {
  constructor(forecastId, existing, attempted) {
    super(`calibration: forecast_id '${forecastId}' already resolved (existing: lane=${existing.lane} predicted_p=${existing.predictedP} outcome=${existing.outcomeBool} quarantined=${existing.quarantined}; attempted: lane=${attempted.lane} predicted_p=${attempted.predictedP} outcome=${attempted.outcomeBool} quarantined=${attempted.quarantined}) -- one outcome per forecast_id, no rebinding`);
    this.name = 'ForecastAlreadyResolvedError';
    this.code = 'FORECAST-ALREADY-RESOLVED';
    this.forecastId = forecastId;
    this.existing = existing;
    this.attempted = attempted;
  }
}

function createCalibrationState() {
  const state = { resolved: new Map() };
  for (const lane of LANES) state[lane] = { buffer: [] };
  return state;
}

// Record one resolved forecast's Brier score into its lane's windowed ring
// buffer. `quarantined: true` is a no-op on the buffer -- a forecast whose
// generation_id is quarantined never enters the Brier window, per S1's
// lineage rule -- but its forecast_id is still recorded as resolved, so a
// LATER attempt to rebind that same forecast_id (quarantined or not) still
// throws rather than silently succeeding.
//
// ONE-OUTCOME-PER-FORECAST_ID (codex fold review, MAJOR): a forecast_id that
// already has a recorded outcome throws ForecastAlreadyResolvedError
// (code FORECAST-ALREADY-RESOLVED) BEFORE any state is touched -- the
// existing resolution (lane, predicted_p, outcome, quarantined flag) is
// returned unmodified inside the error, and neither the resolved map nor the
// lane's Brier buffer is mutated by the rejected attempt. This holds for a
// duplicate-identical resubmission exactly as it does for a conflicting one
// -- "already resolved" is checked before any equality comparison, because
// even an identical resubmission is a rebinding attempt, not a no-op.
function recordResolvedForecast(state, forecastId, lane, predictedP, outcomeBool, { quarantined = false } = {}) {
  if (!LANES.includes(lane)) throw new Error(`calibration: unknown lane '${lane}'`);
  if (!forecastId) throw new Error('calibration: forecast_id is required to record an outcome');
  if (!state.resolved) state.resolved = new Map();
  const attempted = { lane, predictedP, outcomeBool, quarantined };
  const existing = state.resolved.get(forecastId);
  if (existing) {
    throw new ForecastAlreadyResolvedError(forecastId, existing, attempted);
  }
  state.resolved.set(forecastId, attempted);
  if (quarantined) return state;
  if (!state[lane]) state[lane] = { buffer: [] };
  const score = brier(predictedP, outcomeBool);
  state[lane].buffer.push(score);
  if (state[lane].buffer.length > WINDOW_SIZE) state[lane].buffer.shift();
  return state;
}

function windowedBrier(state, lane) {
  const buf = (state[lane] && state[lane].buffer) || [];
  if (!buf.length) return null;
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

function authority(state, lane) {
  const buf = (state[lane] && state[lane].buffer) || [];
  if (buf.length < MIN_RESOLVED_FOR_AUTHORITY) return NEUTRAL_PRIOR;
  const wb = windowedBrier(state, lane);
  const raw = 1 - 2 * wb;
  return Math.min(AUTHORITY_CEILING, Math.max(AUTHORITY_FLOOR, raw));
}

module.exports = {
  HORIZON_TICKS_DEFAULT,
  WINDOW_SIZE,
  NEUTRAL_PRIOR,
  MIN_RESOLVED_FOR_AUTHORITY,
  AUTHORITY_FLOOR,
  AUTHORITY_CEILING,
  LANES,
  OCCURRENCE_METRICS,
  PERSISTENCE_METRICS,
  METRIC_ENUM,
  assertForecastShape,
  resolveForecastOutcome,
  brier,
  ForecastAlreadyResolvedError,
  createCalibrationState,
  recordResolvedForecast,
  windowedBrier,
  authority
};
