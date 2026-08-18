#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/dream/dream-lane.js — S4 of plan
// world-mind-dream-communication. The module-level singleton that gives
// train-tick.js an in-tick data path to S3's dream-composer.js: incremental
// per-worldStatePath trigger history, the compute/update lifecycle split
// (AMENDMENT v9's causality rule), and the same-path collision registry
// (AMENDMENT v10).
//
// WHY A MODULE-LEVEL SINGLETON, NOT A NEW trainTick() PARAMETER (AMENDMENT
// v8, codex V7-1 CRITICAL + codewhale F2): trainTick()'s actual signature
// (hive, worldStatePath, network, rng, liveConfig, tickIndex, controllerState,
// options, laneState) carries neither a ledger nor a calibration reference.
// require()-ing this module once and consulting its own accumulated state
// needs no new trainTick() parameter and no run-live.js call-site change --
// this is the "true scope reduction, correctly bounded" the plan's S4 detail
// names: run-live.js's call to trainTick() needs no new branch or argument
// for the trigger path specifically.
//
// TWO-STEP LIFECYCLE PER TICK, ENFORCED (AMENDMENT v9, NO SAME-TICK
// LOOKAHEAD):
//   (1) COMPUTE, at the START of a tick, BEFORE decide(): checkTriggers()
//       reads history as it stood at the END of the PRIOR tick and produces
//       ONE dreamFeatures value for this tick.
//   (2) UPDATE, at the END of trainTick() (the :449-480 result region),
//       AFTER the decision and its results already exist: recordTickOutcome()
//       appends this tick's own outcomes to history, extending it to
//       "through this tick." The COMPUTE step for the NEXT tick reads THIS
//       updated history -- never this tick's own outcomes at compute time.
// The two functions are never called out of order by design: nothing in this
// module lets an UPDATE feed back into the SAME tick's own COMPUTE, because
// COMPUTE only ever reads what a PRIOR UPDATE call already wrote.
//
// REGISTRY / SAME-PATH COLLISION (AMENDMENT v10, codex V8-1 micro-confirm):
// keyed by worldStatePath -- the ACTUAL, in-tick-reachable identity
// (trainTick()'s own second parameter, unique per sandbox/run). Two active
// registrations for the SAME path throw DREAM-LANE-PATH-COLLISION rather
// than silently sharing or interleaving history. The registry is per-
// process, in-memory, module-level state -- a crashed/killed process never
// deregisters, but a FRESH process starts with a FRESH, empty registry (this
// module's own module-level Map is recreated on process start), so a
// subsequent run reusing that worldStatePath after a crash registers
// cleanly with fresh (cold-start) history. registerRun()/deregisterRun() are
// exported, explicit, and directly testable (AC14(d)); checkTriggers() and
// recordTickOutcome() perform LAZY, idempotent registration internally
// (register-if-absent, never a second explicit registerRun() call) so a
// normal run's own repeated per-tick calls never collide with themselves --
// only a genuinely second, concurrent registration attempt against the same
// still-active path throws.
//
// RESUME SEMANTICS, DECLARED COLD START: a resumed run is a NEW process with
// a FRESH, empty registry and FRESH, empty per-path history by construction
// -- there is no attempt to reconstruct trigger-detection history from
// checkpoint state (a deliberate simplicity choice, not an oversight).
// Consequence, recorded explicitly: dreams may fire slightly later after a
// resume, because history needs fresh ticks to rebuild enough evidence to
// satisfy trigger 1/2's window/threshold conditions. The vault/ledger's own
// DURABLE forecasts (S1/S2) are UNAFFECTED -- they live in generation-bound
// files, not in this singleton's in-memory state.
//
// DEFAULT-OFF, BENCHMARK-SAFE: both checkTriggers() and recordTickOutcome()
// check Boolean(liveConfig.dream_lane_enabled) FIRST, before touching the
// registry or history AT ALL, when disabled -- a stock run (the default)
// therefore performs zero registry lookups, zero history writes, and zero
// ledger classification calls, not merely "produces a zero-vector output
// with hidden bookkeeping still running." liveConfig is re-checked every
// call (not cached), matching every other liveConfig-driven feature in this
// codebase (computeControllerWeight, computeEntropyBonusWeight) -- a
// dashboard toggle takes effect on the very next tick.

const fs = require('fs');
const path = require('path');
const composer = require('./dream-composer.js');
const calibration = require('./calibration.js');
const ledger = require('./consequence-ledger.js');
const dreamMemory = require('./dream-memory.js');

// Retention window for in-memory trigger history, ticks. Must comfortably
// exceed the largest window any trigger/relevance check reads:
// composer.RECENCY_WINDOW (100, trigger 3's hope-record staleness bound) +
// consequence-ledger's own default sustained-survival windowTicks (20) +
// margin. Documented tunable, like composer's own DEFAULT_DARKNESS_BATCH_CAP
// and RECENCY_WINDOW -- the plan does not pin a numeric value for this
// module's own retention horizon.
const HISTORY_RETENTION_TICKS = 150;

// windowTicks passed to consequence-ledger's classifySustainedSurvival() --
// reuses that module's own default (20) rather than inventing a second
// number, so "sustained survival" means the same window everywhere in this
// plan's evidence chain.
const SUSTAINED_SURVIVAL_WINDOW_TICKS = 20;

const DREAM_FEATURE_SIZE = 9;
const ZERO_DREAM_FEATURES = Object.freeze(new Array(DREAM_FEATURE_SIZE).fill(0));

// ============================================================================
// S4b INTEGRATION PASS (operator go, 2026-08-13T02:20Z; closeout items 1-4).
// The S5 trial ran the nervous system without the narrator: no runtime
// forecast issuance existed, so calibrationState stayed empty and authority
// sat frozen at the neutral 0.5 for the life of every run; the composer/
// vault content pathway was never wired into the tick path, so the vault
// was never populated live; trigger-1's fabrication audit had no per-tick
// world-state evidence to re-derive from. This section wires all three
// closed, plus the two pre-registered trigger/gate semantic revisions
// closeout item 4 named.
//
// FORECAST-ISSUANCE RULES (deterministic, evidence-derived, NO LLM, NO rng
// anywhere -- pre-registered constants below, each documented
// tunable-not-ratified, same discipline as composer.RECENCY_WINDOW /
// DEFAULT_DARKNESS_BATCH_CAP):
//   RULE A (darkness, patch_extinction): when a tracked patch's food level
//     is STRICTLY DECREASING across the last FORECAST_PATCH_DECLINE_K
//     observed snapshots (and the patch still exists -- forecasting FUTURE
//     extinction, not narrating an already-happened one), issue a forecast
//     with predicted_p derived from the OBSERVED relative decline over that
//     window: (level_oldest - level_newest) / level_oldest, clamped to
//     [FORECAST_P_FLOOR, FORECAST_P_CEILING].
//   RULE B (darkness, starvation_event): after
//     FORECAST_STARVATION_PRECURSOR_COUNT starvation crossings for a hive
//     (a PRECURSOR count, deliberately lower than trigger 2's own
//     REPEAT_THRESHOLD -- a forecast is a prediction ABOUT a pattern, not a
//     restatement of the trigger's own already-met condition), issue a
//     forecast with predicted_p derived from the observed crossing RATE in
//     the trailing 100 ticks.
//   RULE C (hope, sustained_survival): "after a genuine recovery
//     observation" -- when a hive's post-starvation non-starved streak
//     FIRST reaches FORECAST_RECOVERY_STREAK ticks (edge-triggered: issued
//     exactly once per qualifying streak, not re-issued every tick the
//     streak continues), issue a forecast with predicted_p derived from the
//     streak length.
// ONE OPEN FORECAST PER (metric, subject) AT A TIME: a rule never issues a
// second forecast for the same metric+subject while an earlier one from
// that pair is still unresolved -- calibration.js's own
// FORECAST-ALREADY-RESOLVED enforcement would refuse a same-forecast_id
// rebind anyway, but this additionally keeps the ISSUANCE side honest about
// not flooding the ledger with redundant, unresolvable-in-parallel
// predictions about the same subject.
//
// RESOLUTION: at every COMPUTE step (checkTriggers()), BEFORE trigger
// evaluation, every open forecast whose horizon has been reached (tick_index
// >= tick_issued + horizon_ticks) is resolved mechanically against the SAME
// flushed ledger events trigger evaluation itself uses (calibration.js's own
// resolveForecastOutcome()), fed into calibrationState via
// recordResolvedForecast() -- authority now MOVES during a run, and (because
// resolution runs BEFORE this same tick's trigger evaluation) a forecast
// resolving exactly this tick can affect this tick's own authority gate.
//
// VAULT POPULATION: every issued forecast, every resolved forecast's
// disclosure (composer.composeForecastEntry()), and every FIRED trigger's
// composed content (composer.composeSignalEntry()) persist to the vault as
// real entries -- pending, generation-bound (see PROVISIONAL GENERATION_ID
// below), via dream-memory.js's own appendEntry(). The dreamFeatures the
// encoder sees are derived from the COMPOSED signal entry's own fields
// (dreamSignalToFeatures still reads the underlying signal directly, since
// composeSignalEntry carries the signal's fields through UNCHANGED by
// construction -- the composition step never alters what the network sees,
// it only ALSO persists it, closing the loop honestly rather than silently
// swapping the encoder's actual input source).
//
// PROVISIONAL GENERATION_ID, DECLARED (not the real checkpoint lineage
// identity): S1's real generation_id is only known once run-live.js's
// commitCheckpoint() actually calls checkpoint.commitGeneration() at run
// END -- dream-lane.js has no reachable way to predict that value from
// inside a mid-run COMPUTE/UPDATE step without run-live.js precomputing and
// threading it through (a larger, undispatched wiring change). Entries
// written by this module therefore use `worldStatePath` itself as their
// generation_id -- stable and unique for the whole run's duration, but NOT
// the string S1's real commit-wiring (dreamMemory.commitGenerationEntries())
// will later match against. CONSEQUENCE, NAMED HONESTLY: these entries
// never flip from 'pending' to 'committed' by the existing S1 wiring; they
// remain 'pending' for the life of the vault file, which is still a valid,
// auditable, readable state (dreamMemory.activeEntries() includes pending
// entries; only 'quarantined' entries are excluded from downstream reads).
// For --no-checkpoint runs (every S5 ablation run, past and future) this is
// moot regardless -- commitCheckpoint() never runs at all in that mode, so
// generation_id would never resolve to a real committed value even if this
// module could predict it. Reconciling a provisional run-scoped identifier
// with the real checkpoint generation_id at commit time is a follow-up
// integration point, named here, not solved by this pass.
//
// EVIDENCE FILE (closeout item 3): <sandboxRoot>/dream-lane-evidence.jsonl,
// append-only, one line per (tick, hive) COMPUTE call, carrying that tick's
// patch-presence snapshot plus any forecast issued/resolved plus any dream
// fired -- gives trigger-1 (patch-death-near-activity) fabrication audits a
// persisted, re-derivable evidence trail, closing the 30-skipped-markers gap
// the S5 trial's ablation tool declared. `sandboxRoot` is derived from
// `worldStatePath` (= <sandboxRoot>/shared/world-state.json, run-live.js's
// own WORLD_STATE_PATH convention) rather than threaded as a new parameter.
//
// STOCK-RUN INVARIANT, EXTENDED: every addition in this section sits behind
// the SAME `enabled` (Boolean(liveConfig.dream_lane_enabled)) short-circuit
// checkTriggers()/recordTickOutcome() already used -- a stock run performs
// zero forecast-rule evaluation, zero calibration writes, zero vault
// appendEntry() calls, and never creates the evidence file at all.
// ============================================================================

const FORECAST_PATCH_DECLINE_K = 3; // documented tunable
const FORECAST_P_FLOOR = 0.1;
const FORECAST_P_CEILING = 0.9;
const FORECAST_STARVATION_PRECURSOR_COUNT = 1; // documented tunable
const FORECAST_RECOVERY_STREAK = 5; // documented tunable
const FORECAST_HORIZON_DEFAULT = 50; // matches calibration.HORIZON_TICKS_DEFAULT

function clamp(value, floor, ceiling) {
  return Math.min(ceiling, Math.max(floor, value));
}

// Default vault path -- matches run-live.js's own VAULT_PATH computation
// exactly (repo-root/_dev/state/ant-world-mind-memory/dream-memory.jsonl),
// expressed relative to THIS file's own location one directory deeper.
const DEFAULT_VAULT_PATH = path.join(__dirname, '..', '..', '..', '_dev', 'state', 'ant-world-mind-memory', 'dream-memory.jsonl');

class DreamLanePathCollisionError extends Error {
  constructor(worldStatePath) {
    super(`dream-lane: DREAM-LANE-PATH-COLLISION -- worldStatePath '${worldStatePath}' is already registered by an active run; two active runs must never share dream-lane history`);
    this.name = 'DreamLanePathCollisionError';
    this.code = 'DREAM-LANE-PATH-COLLISION';
    this.worldStatePath = worldStatePath;
  }
}

// Module-level, per-process, in-memory registry: worldStatePath -> singleton
// state. Recreated fresh whenever this module is first require()'d in a new
// process -- a crashed process's Map dies with it (no serialization, no
// restore path), which IS the cold-start guarantee, not a separate mechanism
// for it.
const registry = new Map();

function createSingletonState(worldStatePath, options = {}) {
  return {
    worldStatePath,
    // S4b: the vault path and sandbox root this run's forecast/dream
    // entries and evidence file are written to. `vaultPath` defaults to the
    // real, shared, durable vault (matching run-live.js's own VAULT_PATH);
    // tests inject a scratch path instead. `sandboxRoot` defaults to the
    // derivation from worldStatePath (<sandboxRoot>/shared/world-state.json).
    vaultPath: options.vaultPath || DEFAULT_VAULT_PATH,
    sandboxRoot: options.sandboxRoot || path.dirname(path.dirname(worldStatePath)),
    coldStart: true, // flips false the first time pending data actually flushes into history
    worldStateSnapshots: [], // [{tick, food_sources}], at most one per tick (see upsertSnapshot)
    runLogRows: [], // [{tick, hive, starved, stockpile}], one per hive per tick -- stockpile added S4b (trend-gate definition, see recordTickOutcome)
    activityLog: [], // [{hive_id, patch_id, tick, action}], one per hive per tick
    cooldownState: composer.createCooldownState(),
    calibrationState: calibration.createCalibrationState(),
    // S4b forecast-issuance/resolution state.
    openForecasts: [], // [{forecast_id, generation_id, tick_issued, target:{metric,subject,horizon_ticks}, predicted_p}]
    ratioRecordWritten: false, // the per-run ratioRecord is written once, lazily, on first fired dream
    // PENDING BUFFER (codex fold review, MAJOR fix -- cross-hive same-tick
    // lookahead). run-live.js processes both hives SEQUENTIALLY within one
    // round: trainTick(hive-a) runs its full COMPUTE+UPDATE, THEN
    // trainTick(hive-b) runs its own COMPUTE+UPDATE, for the SAME tick
    // index. Writing hive-a's UPDATE straight into `runLogRows` etc. would
    // let hive-b's SAME-TICK COMPUTE see hive-a's SAME-TICK outcome --
    // codex reproduced this concretely (a null trigger flipping to
    // repeating-starvation purely from intra-tick hive ordering). Every
    // UPDATE call lands in this pending buffer, keyed to the tick it
    // belongs to; it only becomes visible history (flushed into
    // runLogRows/worldStateSnapshots/activityLog) when a COMPUTE or UPDATE
    // call for a STRICTLY LATER tick arrives -- see maybeFlush() below.
    // Multiple UPDATE calls for the SAME tick (both hives) accumulate in
    // the SAME pending buffer; multiple COMPUTE calls for the SAME tick
    // (both hives' checkTriggers()) see the SAME (unflushed) history,
    // never each other's same-tick outcome. A run ending mid-buffer simply
    // discards the pending in-memory state on process exit -- durable
    // surfaces (S1's vault, S2's calibration ledger) are untouched by this
    // buffer entirely; it exists only for this module's own trigger-
    // detection history.
    pendingTick: null,
    pendingRunLogRows: [],
    pendingActivity: [],
    pendingSnapshot: null
  };
}

// Flushes pending data into visible history IF the pending tick is
// STRICTLY EARLIER than `tickIndex` -- never when equal (a same-tick call,
// from the OTHER hive, must not see this tick's own not-yet-complete
// data) and never when pending is empty (nothing to flush). Called at the
// START of both checkTriggers() and recordTickOutcome(), so ticks only
// ever advance and a strictly-later tick's first touch (compute OR update)
// is what promotes the prior tick's buffered outcomes into real history.
function maybeFlush(state, tickIndex) {
  if (state.pendingTick === null || !(state.pendingTick < tickIndex)) return;
  state.runLogRows.push(...state.pendingRunLogRows);
  if (state.pendingSnapshot) upsertSnapshot(state, state.pendingSnapshot.tick, state.pendingSnapshot.food_sources);
  state.activityLog.push(...state.pendingActivity);
  trimHistory(state, state.pendingTick);
  state.coldStart = false;
  state.pendingTick = null;
  state.pendingRunLogRows = [];
  state.pendingActivity = [];
  state.pendingSnapshot = null;
}

// EXPLICIT registration -- throws DREAM-LANE-PATH-COLLISION if this path is
// already active. Directly testable (AC14(d)); also the function
// getOrRegister() below calls internally on first use for a path.
function registerRun(worldStatePath, options = {}) {
  if (registry.has(worldStatePath)) {
    throw new DreamLanePathCollisionError(worldStatePath);
  }
  const state = createSingletonState(worldStatePath, options);
  registry.set(worldStatePath, state);
  return state;
}

function deregisterRun(worldStatePath) {
  registry.delete(worldStatePath);
}

function getRunState(worldStatePath) {
  return registry.get(worldStatePath) || null;
}

// Lazy, idempotent registration for the normal in-tick call path: the FIRST
// call for a given worldStatePath registers it; every subsequent call within
// the same (still-registered) run just reuses the existing state -- never a
// second registerRun() call, so a run's own repeated per-tick use never
// collides with itself. Only an explicit, separate registerRun() call
// against an ALREADY-active path (the AC14(d) collision scenario) throws.
function getOrRegister(worldStatePath, options = {}) {
  const existing = registry.get(worldStatePath);
  if (existing) return existing;
  return registerRun(worldStatePath, options);
}

function trimHistory(state, currentTick) {
  const cutoff = currentTick - HISTORY_RETENTION_TICKS;
  state.worldStateSnapshots = state.worldStateSnapshots.filter((s) => s.tick > cutoff);
  state.runLogRows = state.runLogRows.filter((r) => r.tick > cutoff);
  state.activityLog = state.activityLog.filter((a) => a.tick > cutoff);
}

// One snapshot per tick, not one per hive-call-per-tick: trainTick() runs
// once per hive per round (run-live.js's loop), so a naive per-call push
// would record TWO food-source snapshots for the same round (hive-a's,
// then hive-b's, each reading a different post-tick world-state) --
// breaking classifyPatchExtinction()'s consecutive-pair assumption. The
// LATEST call for a given tick wins, which is also the most complete
// picture of that round (whichever hive acted last has seen both hives'
// effects).
function upsertSnapshot(state, tick, foodSources) {
  const existing = state.worldStateSnapshots.find((s) => s.tick === tick);
  if (existing) {
    existing.food_sources = { ...(foodSources || {}) };
  } else {
    state.worldStateSnapshots.push({ tick, food_sources: { ...(foodSources || {}) } });
  }
}

// ACTION TRANSLATION: decide()'s returned action carries verb:'gather' +
// resourceKey:'food'|'wood' for the two gather verbs (untrained-network.js's
// decide()), never the VERB_ORDER string dream-composer.js's trigger 1
// requires ('gather-food' exactly, per its MAJOR fix). Neither decide()'s
// output nor consequence-ledger's events carry this translation natively --
// it is this module's own, since S4 is what "owns sourcing recentActivity
// from what trainTick actually sees."
function actionToVerbOrderString(action) {
  if (!action) return null;
  if (action.verb === 'gather') return action.resourceKey === 'wood' ? 'gather-wood' : 'gather-food';
  return action.verb;
}

// LANE ENCODING (S5 re-trial fold): two binary slots, darkness and hope --
// 'mixed' (a cross-lane merged delivery, dream-composer.js's own
// mergeDreamSignals) sets BOTH to 1, the only honest encoding for a block
// with per-lane binary slots and no third slot of its own: the delivery
// genuinely carries both a darkness-lane and a hope-lane source this tick,
// so the network's own observed input should say so, not silently report
// "neither lane fired" the way `signal.lane === 'darkness'`/`'hope'`
// (exact-match) alone would for a 'mixed' value.
function dreamSignalToFeatures(signal) {
  if (!signal) return new Array(DREAM_FEATURE_SIZE).fill(0);
  const verbIndex = composer.TARGETED_VERBS.indexOf(signal.targeted_verb);
  const verbOneHot = composer.TARGETED_VERBS.map((_, i) => (i === verbIndex ? 1 : 0));
  return [
    1, // dream_present
    signal.lane === 'darkness' || signal.lane === 'mixed' ? 1 : 0,
    signal.lane === 'hope' || signal.lane === 'mixed' ? 1 : 0,
    ...verbOneHot, // 5 slots, matching VERB_ORDER
    signal.forecast_authority
  ];
}

// FOOD_STRESS_THRESHOLD -- "food-stressed," the plan's own named example).
const FOOD_STRESS_THRESHOLD = 2; // documented tunable, like composer's own non-ratified constants

// --- S4b forecast-issuance rules (RULE A/B/C, see the module header) ---

function hasOpenForecast(state, metric, subject) {
  return state.openForecasts.some((f) => f.target.metric === metric && f.target.subject === subject);
}

function buildForecast(state, { metric, subject, predictedP, tickIssued, horizonTicks = FORECAST_HORIZON_DEFAULT, sourceWindow = null }) {
  return {
    // Globally unique across the shared vault (many runs write to the same
    // file): worldStatePath is unique per sandbox/run, so prefixing with it
    // guarantees no cross-run forecast_id collision even under the
    // provisional generation_id scheme (see module header).
    forecast_id: `${state.worldStatePath}:${metric}:${subject}:${tickIssued}`,
    generation_id: state.worldStatePath,
    tick_issued: tickIssued,
    target: { metric, subject, horizon_ticks: horizonTicks },
    predicted_p: predictedP,
    // S4b amendment (operator ratification 2026-08-13T16:46Z, item d): the
    // EXACT ledger rows/window this forecast's evidence came from -- not
    // just "issued at tick N," which names the write time but not what was
    // actually read to produce the prediction. Shape is rule-specific (see
    // each issuance rule below); null only if a caller builds a forecast
    // without one (never done by this module's own three rules).
    source_window: sourceWindow
  };
}

// RULE A (darkness, patch_extinction): strictly-decreasing food level across
// the last FORECAST_PATCH_DECLINE_K flushed snapshots.
function issuePatchDeclineForecasts(state, tickIndex) {
  const recent = state.worldStateSnapshots.slice(-FORECAST_PATCH_DECLINE_K);
  if (recent.length < FORECAST_PATCH_DECLINE_K) return [];
  const oldestPatchIds = Object.keys(recent[0].food_sources || {});
  const issued = [];
  for (const patchId of oldestPatchIds) {
    const levels = recent.map((snap) => snap.food_sources[patchId]);
    if (levels.some((l) => l === undefined || l === null)) continue; // must exist in every observed snapshot
    const strictlyDecreasing = levels.every((l, i) => i === 0 || l < levels[i - 1]);
    if (!strictlyDecreasing) continue;
    const newest = levels[levels.length - 1];
    if (!(newest > 0)) continue; // already gone -- a consequence, not a forecast target
    if (hasOpenForecast(state, 'patch_extinction', patchId)) continue;
    const oldest = levels[0];
    const relativeDecline = oldest > 0 ? (oldest - newest) / oldest : 0;
    const predictedP = clamp(relativeDecline, FORECAST_P_FLOOR, FORECAST_P_CEILING);
    const sourceWindow = {
      from_tick: recent[0].tick,
      to_tick: recent[recent.length - 1].tick,
      snapshot_count: FORECAST_PATCH_DECLINE_K,
      levels
    };
    issued.push(buildForecast(state, { metric: 'patch_extinction', subject: patchId, predictedP, tickIssued: tickIndex, sourceWindow }));
  }
  return issued;
}

// RULE B (darkness, starvation_event): a PRECURSOR count of crossings for a
// hive (deliberately lower than trigger 2's own repeat threshold -- a
// forecast predicts a pattern, it does not restate the trigger's already-met
// condition), predicted_p derived from the observed crossing rate.
function issueStarvationPrecursorForecast(state, tickIndex, hiveId, starvationEvents) {
  const hiveCrossings = starvationEvents.filter((e) => e.subject === hiveId);
  if (hiveCrossings.length < FORECAST_STARVATION_PRECURSOR_COUNT) return null;
  if (hasOpenForecast(state, 'starvation_event', hiveId)) return null;
  const precursorWindowTicks = 100;
  const recentCrossingTicks = hiveCrossings.filter((e) => tickIndex - e.tick <= precursorWindowTicks).map((e) => e.tick);
  const predictedP = clamp(0.3 + 0.15 * recentCrossingTicks.length, FORECAST_P_FLOOR, FORECAST_P_CEILING);
  const sourceWindow = { window_ticks: precursorWindowTicks, crossing_ticks: recentCrossingTicks };
  return buildForecast(state, { metric: 'starvation_event', subject: hiveId, predictedP, tickIssued: tickIndex, sourceWindow });
}

// RULE C (hope, sustained_survival): "after a genuine recovery observation"
// -- a hive's post-starvation non-starved streak FIRST reaching
// FORECAST_RECOVERY_STREAK ticks, edge-triggered (issued exactly once per
// qualifying streak).
function issueRecoveryForecast(state, tickIndex, hiveId) {
  const hiveRows = state.runLogRows.filter((r) => r.hive === hiveId).sort((a, b) => a.tick - b.tick);
  let lastStarvedIdx = -1;
  for (let i = 0; i < hiveRows.length; i += 1) if (hiveRows[i].starved) lastStarvedIdx = i;
  if (lastStarvedIdx === -1) return null; // nothing to "recover" from yet
  const sinceStreak = hiveRows.slice(lastStarvedIdx + 1);
  if (sinceStreak.length !== FORECAST_RECOVERY_STREAK) return null; // edge-triggered: exactly on the tick the streak first qualifies
  if (hasOpenForecast(state, 'sustained_survival', hiveId)) return null;
  const predictedP = clamp(0.5 + 0.05 * FORECAST_RECOVERY_STREAK, FORECAST_P_FLOOR, FORECAST_P_CEILING);
  const sourceWindow = {
    from_tick: sinceStreak[0].tick,
    to_tick: sinceStreak[sinceStreak.length - 1].tick,
    streak_length: FORECAST_RECOVERY_STREAK
  };
  return buildForecast(state, { metric: 'sustained_survival', subject: hiveId, predictedP, tickIssued: tickIndex, sourceWindow });
}

// --- S4b forecast resolution ---

// Metric -> the ledger event set resolveForecastOutcome() needs for that
// metric class. sustained_survival (a PERSISTENCE metric) resolves against
// DISQUALIFYING events -- starvation crossings for the same subject -- per
// calibration.js's own documented contract, never against sustained_survival
// events themselves.
function ledgerEventsForMetric(metric, { extinctionEvents, starvationEvents }) {
  if (metric === 'patch_extinction') return extinctionEvents;
  if (metric === 'starvation_event') return starvationEvents;
  if (metric === 'sustained_survival') return starvationEvents;
  return [];
}

// Resolves every open forecast whose horizon has been reached, feeding
// calibrationState (authority now MOVES during a run) and returning the
// resolved forecasts for vault disclosure composition.
function resolveOpenForecasts(state, tickIndex, ledgerEvents) {
  const stillOpen = [];
  const resolved = [];
  for (const forecast of state.openForecasts) {
    const dueAt = forecast.tick_issued + forecast.target.horizon_ticks;
    if (tickIndex < dueAt) {
      stillOpen.push(forecast);
      continue;
    }
    const metricEvents = ledgerEventsForMetric(forecast.target.metric, ledgerEvents);
    const outcome = calibration.resolveForecastOutcome(forecast, metricEvents);
    const lane = composer.laneForMetric(forecast.target.metric);
    calibration.recordResolvedForecast(state.calibrationState, forecast.forecast_id, lane, forecast.predicted_p, outcome, { quarantined: false });
    resolved.push({ ...forecast, outcome });
  }
  state.openForecasts = stillOpen;
  return resolved;
}

// --- S4b vault persistence (guarded no-op on any write failure -- a vault
// write is evidence bookkeeping, never allowed to crash the tick loop) ---

// seedVault() runs FIRST, every time, before any other entry is ever
// appended (S4b amendment, operator ratification 2026-08-13T16:46Z, call
// S4b-3, resolving codex CRITICAL 2's first half: "a missing vault can also
// begin with forecast entry 0 instead of the required doctrine seed"). This
// is the ONLY vault-write path dream-lane.js has (every forecast, resolved
// disclosure, signal, and ratio-record write goes through this function), so
// guarding it here guarantees the doctrine seed always lands first on EVERY
// path that can create a vault, including the trial harness path -- not just
// the ones some caller remembers to seed explicitly. seedVault() is
// idempotent (a no-op once the vault already exists), so this costs nothing
// beyond the file-existence check on every call. Returns the WRITTEN entry
// (carrying its real entry_id) on success, or null on failure, so callers
// that need the delivered entry's own identity (evidence-file provenance)
// can read it back without a second vault read.
function safeAppendVaultEntry(vaultPath, entry) {
  try {
    dreamMemory.seedVault(vaultPath);
    return dreamMemory.appendEntry(vaultPath, entry);
  } catch (err) {
    // A malformed entry (e.g. missing provenance) is a real bug worth
    // surfacing -- but never as an unhandled exception that kills a live
    // sim tick. Logged to stderr, tick continues.
    process.stderr.write(`dream-lane: vault write refused -- ${err.message}\n`);
    return null;
  }
}

// --- S4b evidence file (closeout item 3) ---

function appendEvidenceLine(state, record) {
  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  try {
    fs.mkdirSync(state.sandboxRoot, { recursive: true });
    fs.appendFileSync(evidencePath, JSON.stringify(record) + '\n');
  } catch (err) {
    process.stderr.write(`dream-lane: evidence-file write refused -- ${err.message}\n`);
  }
}

// COMPUTE step. Called ONCE per tick, BEFORE decide() -- reads history
// through the PRIOR tick only (nothing this tick's own recordTickOutcome()
// call would append has happened yet). `currentHiveState` is the SAME
// hiveState object trainTick() already read at its own top (before this
// tick does anything) -- "what trainTick actually sees," per the dispatch,
// used to build the current-state relevance predicate trigger 3 requires
// (a simple, defensible, documented proxy: the hive is relevant to a past
// hope record when its CURRENT stockpile is at or below

function checkTriggers(worldStatePath, hiveId, tickIndex, liveConfig, currentHiveState) {
  const enabled = Boolean(liveConfig && liveConfig.dream_lane_enabled);
  if (!enabled) {
    return { dreamFeatures: new Array(DREAM_FEATURE_SIZE).fill(0), signal: null, triggerResults: null, coldStart: null, worldStatePath };
  }

  const state = getOrRegister(worldStatePath);
  // Flush any tick STRICTLY EARLIER than this one into visible history
  // FIRST -- this is what makes "read history through tick N-1" correct
  // regardless of intra-tick hive ordering: a same-tick call from the
  // OTHER hive (pendingTick === tickIndex) is never flushed here, so it
  // can never see this tick's own still-forming outcome.
  maybeFlush(state, tickIndex);

  const extinctionEvents = ledger.classifyPatchExtinction(state.worldStateSnapshots);
  // recoveryPeakWindowTicks (coordinator-pinned trend-gate definition r3):
  // bounds each crossing's recovery_peak lookback to the SAME window the
  // trigger itself uses, even though this module hands the classifier up
  // to HISTORY_RETENTION_TICKS (150) of history -- without this bound, a
  // crossing with no prior crossing in that wide history could inherit a
  // pre-window stockpile peak and reverse the trend-gate verdict.
  const starvationEvents = ledger.classifyStarvation(state.runLogRows, { recoveryPeakWindowTicks: composer.STARVATION_REPEAT_WINDOW_TICKS });
  const sustainedSurvivalEvents = ledger.classifySustainedSurvival(state.runLogRows, { windowTicks: SUSTAINED_SURVIVAL_WINDOW_TICKS });
  const recentActivity = state.activityLog;

  // S4b RESOLUTION, BEFORE trigger evaluation (closeout item 1): every open
  // forecast whose horizon has been reached resolves against this SAME
  // flushed evidence, updating calibrationState -- a forecast resolving
  // exactly this tick can move authority in time to affect THIS tick's own
  // gate check below. Each resolution also composes and persists a
  // retrospective 'dream' disclosure entry (composer.composeForecastEntry)
  // to the vault.
  const resolvedForecasts = resolveOpenForecasts(state, tickIndex, { extinctionEvents, starvationEvents });
  for (const resolved of resolvedForecasts) {
    const disclosureEntry = composer.composeForecastEntry(resolved);
    safeAppendVaultEntry(state.vaultPath, disclosureEntry);
  }

  // S4b ISSUANCE (closeout item 1): deterministic, evidence-derived forecast
  // rules (RULE A/B/C, module header) -- issued forecasts enter
  // state.openForecasts (for future resolution) AND persist to the vault as
  // 'forecast' entries now.
  const starvationPrecursor = issueStarvationPrecursorForecast(state, tickIndex, hiveId, starvationEvents);
  const recoveryForecast = issueRecoveryForecast(state, tickIndex, hiveId);
  const issuedForecasts = [
    ...issuePatchDeclineForecasts(state, tickIndex),
    ...(starvationPrecursor ? [starvationPrecursor] : []),
    ...(recoveryForecast ? [recoveryForecast] : [])
  ];
  for (const forecast of issuedForecasts) {
    state.openForecasts.push(forecast);
    const lane = composer.laneForMetric(forecast.target.metric);
    safeAppendVaultEntry(state.vaultPath, {
      entry_type: 'forecast',
      lane,
      text_or_data: forecast,
      provenance: { source: 'run-log.jsonl', ref: `issued_at_tick=${tickIndex},subject=${forecast.target.subject}` },
      calibration_score_at_write: calibration.authority(state.calibrationState, lane),
      generation_id: forecast.generation_id
    });
  }

  const currentFood = currentHiveState
    && currentHiveState.hive_state
    && typeof currentHiveState.hive_state.stockpile === 'object'
    && currentHiveState.hive_state.stockpile !== null
    && typeof currentHiveState.hive_state.stockpile.food === 'number'
    ? currentHiveState.hive_state.stockpile.food
    : null;
  const isCurrentlyRelevant = () => currentFood !== null && currentFood <= FOOD_STRESS_THRESHOLD;

  // WINDOW ANCHOR FIX (S5 re-trial fold, seed 777000306 tick 207 live/audit
  // divergence -- root-caused against the real persisted artifacts, not
  // guessed): every trigger's window/proximity/recency check compares
  // against `state.runLogRows`/`activityLog`/etc, which the FLUSH above
  // (maybeFlush(state, tickIndex)) has just populated with every round's
  // own outcome THROUGH round `tickIndex - 1` -- round `tickIndex` itself
  // (this COMPUTE call's own round) has NOT recorded its own outcome yet
  // (recordTickOutcome for THIS round runs later, in the UPDATE step).
  // `lastVisibleTick` is therefore the correct window anchor: it is the
  // most recent round whose data can actually appear in ANY of the
  // history arrays every trigger evaluator reads. Passing `tickIndex`
  // itself (the OLD code, before this fix) instead anchored the window one
  // round too early -- harmless for the UPPER bound (`ev.tick <= tick`,
  // since round `tickIndex` never has data to exclude anyway) but wrong
  // for the LOWER bound (`ev.tick > tick - windowTicks`): it silently
  // narrowed every trigger's configured N-tick window to N-1 REAL ticks of
  // actual visibility, one round tighter than the pinned definition names.
  // Confirmed against seed 777000306's real B-arm run-log: a
  // repeating-starvation crossing 39 real ticks before the visible
  // boundary (i.e., genuinely inside a 40-tick window) was wrongly
  // excluded by the old anchor, and its exclusion flipped the trend-gate
  // verdict from SUPPRESS to FIRE at persisted tick 207. This is NOT
  // trigger-2-specific -- trigger 1's PATCH_DEATH_PROXIMITY_TICKS join and
  // trigger 3's RECENCY_WINDOW check read `tick` from this SAME shared
  // `evalInput`, so they carried the identical one-round narrowing;
  // fixing the shared anchor here corrects all three uniformly rather
  // than leaving two of them with the same latent defect.
  const lastVisibleTick = tickIndex - 1;

  const evalInput = {
    hiveId,
    tick: lastVisibleTick,
    extinctionEvents,
    recentActivity,
    starvationEvents,
    sustainedSurvivalEvents,
    isCurrentlyRelevant,
    cooldownState: state.cooldownState,
    calibrationState: state.calibrationState
  };
  const triggerResults = composer.evaluateTriggers(evalInput);
  // S4b amendment (operator ratification 2026-08-13T16:46Z, call S4b-2,
  // MERGE policy): arbitrateDelivery is now the ONLY place a cooldown is
  // consumed -- every trigger class that cleared this tick's gate is part of
  // ONE delivered dream, merged, journaling every source and every
  // authority-gate-suppressed class, per the ratification's "nothing is
  // silently dropped" requirement. Replaces the old "take the first fired
  // trigger, the rest silently burn cooldown and vanish" behavior codex
  // flagged MAJOR.
  const arbitration = composer.arbitrateDelivery(triggerResults, state.cooldownState);
  const signal = arbitration.delivered;

  // S4b VAULT POPULATION (closeout item 2): a delivered signal's composed
  // content persists to the vault now, closing the loop -- the encoder's
  // dreamFeatures below are derived from the signal's OWN fields
  // (composeSignalEntry carries them through unchanged; see the module
  // header for why this is not a silent swap of the encoder's input
  // source). The per-run ratioRecord is written once, lazily, on the first
  // delivered dream. `deliveredEntry` captures the written vault entry (with
  // its real entry_id) for the evidence file's delivered-dream-identity
  // field (S4b amendment, item d).
  let deliveredEntry = null;
  if (signal) {
    const signalEntry = composer.composeSignalEntry(signal, state.worldStatePath, { suppressed: arbitration.suppressed });
    deliveredEntry = safeAppendVaultEntry(state.vaultPath, signalEntry);
    if (!state.ratioRecordWritten) {
      const ratioRecord = composer.buildRatioRecord(
        composer.VALENCE_RATIO_DEFAULT,
        'S4b default: 1:1 darkness:hope, pilot-frozen per plan world-mind-dream-communication S3 (no per-run override configured for this run)',
        state.worldStatePath
      );
      safeAppendVaultEntry(state.vaultPath, ratioRecord);
      state.ratioRecordWritten = true;
    }
  }

  // S4b EVIDENCE FILE (closeout item 3; amendment item d extends this with
  // suppressed/merged triggers, the delivered dream's own identity, and the
  // run/generation binding; THIS pass closes the trigger-1 exact-join gap
  // named at closeout item 3's own header -- codex delta review MAJOR 3):
  // one line per (tick, hive) COMPUTE call -- the patch-presence snapshot
  // as of this compute (the LATEST flushed snapshot, i.e. through tick
  // N-1), any forecast issued/resolved this tick, the full delivery-
  // arbitration disposition, and now `recent_activity` -- the SAME
  // `state.activityLog` trigger 1's own evaluator reads live (per-hive,
  // per-tick {hive_id, patch_id, tick, action} tuples, bounded by
  // HISTORY_RETENTION_TICKS). Persisting it closes the gap this module's
  // own header previously named as "not built this pass": a downstream
  // auditor (ablation.cjs's zero-fabrication audit) can now perform the
  // EXACT join -- "did this hive gather from the SPECIFIC cited patch
  // within the proximity window" -- rather than the prior EXISTENCE-only
  // check ("did some patch die nearby"). No behavior change to the
  // trigger's own live evaluation; this is additive evidence only.
  const latestSnapshot = state.worldStateSnapshots[state.worldStateSnapshots.length - 1];
  appendEvidenceLine(state, {
    tick: tickIndex,
    hive: hiveId,
    run_id: worldStatePath,
    generation_id: state.worldStatePath,
    patch_presence: latestSnapshot ? latestSnapshot.food_sources : null,
    patch_presence_as_of_tick: latestSnapshot ? latestSnapshot.tick : null,
    recent_activity: state.activityLog.map((a) => ({ hive_id: a.hive_id, patch_id: a.patch_id, tick: a.tick, action: a.action })),
    forecasts_issued: issuedForecasts.map((f) => ({ forecast_id: f.forecast_id, metric: f.target.metric, subject: f.target.subject, predicted_p: f.predicted_p, source_window: f.source_window })),
    forecasts_resolved: resolvedForecasts.map((f) => ({ forecast_id: f.forecast_id, metric: f.target.metric, subject: f.target.subject, outcome: f.outcome })),
    dream_fired: signal ? {
      entry_id: deliveredEntry ? deliveredEntry.entry_id : null,
      lane: signal.lane,
      trigger_class: signal.trigger_class,
      forecast_authority: signal.forecast_authority,
      merged_trigger_classes: arbitration.mergedTriggerClasses
    } : null,
    suppressed_triggers: arbitration.suppressed
  });

  return {
    dreamFeatures: dreamSignalToFeatures(signal),
    signal,
    triggerResults,
    arbitration,
    issuedForecasts,
    resolvedForecasts,
    coldStart: state.coldStart,
    worldStatePath
  };
}

// UPDATE step. Called at the END of trainTick(), AFTER this tick's own
// decision/apply/upkeep results already exist (train-tick.js's :449-480
// result region). Appends this tick's OWN outcomes to the PENDING buffer
// (never straight into visible history -- see createSingletonState()'s own
// comment for why: the OTHER hive's SAME-TICK compute step must never see
// this). `worldStateSnapshot` is the POST-tick world state trainTick()
// already holds in memory as `result.worldState` (harness.tick()'s own
// return value) -- reusing it instead of a second WORLD_STATE_PATH disk
// read is a deliberate, documented deviation from the plan's literal "read
// WORLD_STATE_PATH once per tick" wording: the content is identical (same
// tick, same write), and reusing the in-memory value trainTick() already
// produced costs zero extra I/O and carries zero risk of reading a
// mid-write or stale file.
// `stockpile` (S4b amendment, operator ratification 2026-08-13T16:46Z;
// coordinator-pinned trend-gate definition r2, 2026-08-13T17:45Z):
// optional, the acting hive's stockpile at THIS tick (its post-upkeep
// value -- the state produced BY this tick). Threaded straight into
// runLogRows, and consequence-ledger.js's classifyStarvation reads the
// hive's ENTIRE stockpile history (across many rows/ticks, not just the
// crossing tick's own value -- see that function's own header) to compute
// each starvation_event's `recovery_peak`: the crossing tick's own
// post-upkeep value is ALWAYS 0 by applyUpkeep()'s own definition of
// `starved`, so it is never itself the trend-gate observable; it is one
// data point among the many this row (and the rows around it) contribute
// to a peak computed over the whole inter-crossing span. Optional and
// additive: a caller that omits it gets a row with stockpile:null, which
// simply contributes nothing to that peak computation -- if a crossing's
// entire lookback has no stockpile data at all, its recovery_peak comes
// back null and trigger 2's trend gate treats that as "cannot evaluate,"
// never a silent pass.
function recordTickOutcome(worldStatePath, hiveId, tickIndex, { starved, worldStateSnapshot, action, liveConfig, stockpile } = {}) {
  const enabled = Boolean(liveConfig && liveConfig.dream_lane_enabled);
  if (!enabled) return { recorded: false };

  const state = getOrRegister(worldStatePath);
  // Flush a STRICTLY EARLIER pending tick first (the normal case: the
  // OTHER hive's own UPDATE for tick N-1 is still pending when this tick's
  // FIRST hive starts tick N). A same-tick call (pendingTick === tickIndex,
  // e.g. this tick's SECOND hive) is never flushed here -- it accumulates
  // into the SAME pending buffer instead.
  maybeFlush(state, tickIndex);
  state.pendingTick = tickIndex;
  state.pendingRunLogRows.push({ tick: tickIndex, hive: hiveId, starved: Boolean(starved), stockpile: stockpile !== undefined ? stockpile : null });
  state.pendingSnapshot = { tick: tickIndex, food_sources: { ...((worldStateSnapshot && worldStateSnapshot.food_sources) || {}) } };
  if (action) {
    state.pendingActivity.push({ hive_id: hiveId, patch_id: action.tileId || null, tick: tickIndex, action: actionToVerbOrderString(action) });
  }
  return { recorded: true };
}

// FINALIZE RUN (S4b amendment, operator ratification 2026-08-13T16:46Z, call
// S4b-3): for runs that never call checkpoint.commitGeneration() (every
// --no-checkpoint / ablation-trial run), vault entries written under this
// run's provisional generation_id (== worldStatePath, see PROVISIONAL
// GENERATION_ID above) would otherwise sit 'pending' forever -- no commit
// wiring will ever flip them, since commitGenerationEntries() only ever
// matches a REAL checkpoint generation_id. This is the trial harness's own
// end-of-run hook -- named here, not wired into run-live.js (that wiring is
// a separate, undispatched integration point, exactly like the provisional
// generation_id it finalizes): it flips every 'pending' entry carrying this
// run's generation_id to the TERMINAL 'run-terminal' commit_status.
// Deregisters the in-memory singleton too (this run is over; a fresh
// registration for a REUSED path after this point is a legitimately new
// run, not a collision). Guarded no-op if the vault does not exist or this
// run wrote nothing pending -- see dream-memory.js's finalizeRunTerminal for
// the full status-semantics rationale.
function finalizeRun(worldStatePath, vaultPath) {
  // Resolve the SAME vault path this run actually wrote to, not a fresh
  // default -- tests (and any caller injecting options.vaultPath at
  // registration) must finalize the file entries actually landed in. Falls
  // back to the explicit `vaultPath` argument, then the registered state's
  // own vaultPath, then the shared default, in that order.
  const state = getRunState(worldStatePath);
  const resolvedVaultPath = vaultPath || (state && state.vaultPath) || DEFAULT_VAULT_PATH;
  const result = dreamMemory.finalizeRunTerminal(resolvedVaultPath, worldStatePath);
  deregisterRun(worldStatePath);
  return result;
}

module.exports = {
  DreamLanePathCollisionError,
  HISTORY_RETENTION_TICKS,
  SUSTAINED_SURVIVAL_WINDOW_TICKS,
  FOOD_STRESS_THRESHOLD,
  DREAM_FEATURE_SIZE,
  ZERO_DREAM_FEATURES,
  DEFAULT_VAULT_PATH,
  FORECAST_PATCH_DECLINE_K,
  FORECAST_P_FLOOR,
  FORECAST_P_CEILING,
  FORECAST_STARVATION_PRECURSOR_COUNT,
  FORECAST_RECOVERY_STREAK,
  FORECAST_HORIZON_DEFAULT,
  registerRun,
  deregisterRun,
  getRunState,
  getOrRegister,
  actionToVerbOrderString,
  dreamSignalToFeatures,
  hasOpenForecast,
  issuePatchDeclineForecasts,
  issueStarvationPrecursorForecast,
  issueRecoveryForecast,
  resolveOpenForecasts,
  checkTriggers,
  recordTickOutcome,
  finalizeRun
};
