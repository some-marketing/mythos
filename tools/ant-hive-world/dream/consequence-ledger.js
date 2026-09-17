#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/dream/consequence-ledger.js — S2 (ledger half) of plan
// world-mind-dream-communication. Pure, mechanical extraction of outcome
// records from run-log.jsonl rows and world-state snapshots -- no LLM, no
// free-text generation, pure data transforms. Mirrors the read-only
// extraction shape of lore-engine/detect-triggers.js (checkpoint-diffed,
// append-only-log-plus-snapshot input) without adopting lore-engine's LLM
// dispatch.
//
// FIELD-NAME KEYING (AMENDMENT v4, codewhale F1): every classifier below
// reads run-log rows by FIELD NAME (row.starved, row.hive, row.tick,
// row.stockpile, ...), never by positional index or fixed row-order
// assumption. sim-learning-instrumentation (candidate only, not in-flight)
// may later normalize the run-log record schema; a positional reader would
// silently break under that normalization where a field-name reader would
// not.
//
// EVERY extracted record carries {tick_range, hive_id or patch_id, evidence:
// [source row/snapshot refs]} -- a record with no evidence reference is a
// bug, asserted in tests, never emitted (enforced here by construction: the
// evidence array is always built from the rows/snapshots that produced the
// record, never omitted).
//
// REGROWTH RE-VALIDATION (AMENDMENT v2, codewhale objection 2, AC9): this
// classifier's patch-extinction assumption ("a zeroed patch is permanently
// gone") holds only while sim-replenishment-dynamics' regrowth mechanic
// stays inactive in DEFAULT_CONFIG. Re-validate this module against
// post-regrowth world-state semantics before trusting its output as an S3
// input once a future plan activates that config key -- see AC9.

const METRIC_CLASSES = Object.freeze({
  patch_extinction: 'occurrence',
  starvation_event: 'occurrence',
  recovery: 'occurrence',
  sustained_survival: 'persistence'
});

function assertEvidence(record) {
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    throw new Error(`consequence-ledger: record for ${record.subject} at tick ${record.tick} has no evidence -- refusing to emit`);
  }
  return record;
}

// PATCH EXTINCTION: a food-source id present in a prior snapshot, absent in
// a later one, zero regrowth applicable (AC9's gate). `worldStateSnapshots`
// is an array of { tick, food_sources: { [tileId]: amount } }, ordered
// ascending by tick.
function classifyPatchExtinction(worldStateSnapshots) {
  const snapshots = [...(worldStateSnapshots || [])].sort((a, b) => a.tick - b.tick);
  const events = [];
  for (let i = 1; i < snapshots.length; i += 1) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const prevIds = Object.keys(prev.food_sources || {});
    const currIds = new Set(Object.keys(curr.food_sources || {}));
    for (const tileId of prevIds) {
      if (!currIds.has(tileId)) {
        events.push(assertEvidence({
          metric: 'patch_extinction',
          subject: tileId,
          tick: curr.tick,
          tick_range: [prev.tick, curr.tick],
          evidence: [
            { source: 'world-state', ref: `snapshot@tick=${prev.tick}:present` },
            { source: 'world-state', ref: `snapshot@tick=${curr.tick}:absent` }
          ]
        }));
      }
    }
  }
  return events;
}

// STARVATION: run-log rows where result.starved === true (field-name keyed).
//
// `recovery_peak` (S4b amendment, coordinator-pinned trend-gate definition
// r2, 2026-08-13T17:45Z, replacing the r1 definition's `stockpile` field --
// codex delta review CRITICAL 1: r1 recorded the crossing's OWN post-upkeep
// stockpile, but applyUpkeep() (untrained-network.js:515) defines a
// starvation crossing as food hitting exactly zero -- `starved` is
// `food > 0 && nextFood === 0` -- so every genuine crossing's own post-
// upkeep stockpile is ALWAYS 0. A non-increasing check over an
// always-[0,0,...] sequence is vacuous; it can never fail. r2 replaces
// WHICH observable the trend gate reads, not the non-increasing rule
// itself (that rule was always sound -- it needed a production-possible
// input): INTER-CROSSING RECOVERY PEAK, the maximum post-upkeep food this
// hive attained SINCE ITS PREVIOUS CROSSING (or since the start of the
// rows this classifier was given, if no earlier crossing exists in that
// history -- see the DEVIATION note below). A declining recovery_peak
// sequence means the hive is recovering LESS between successive
// starvations -- a genuinely worsening, direction-consistent pattern; a
// rising sequence means it is recovering MORE -- getting better, not
// worse. Computed HERE (not incrementally in dream-lane.js's singleton
// state) to keep this module's existing pattern intact: every classifier
// in this file (classifyPatchExtinction, classifyRecovery,
// classifySustainedSurvival) is a PURE, STATELESS function of the rows
// array it receives, recomputed fresh every call -- recovery_peak follows
// that same shape rather than introducing new per-hive running state
// dream-lane.js would have to correctly reset on cold-start/resume.
//
// WINDOW BOUND (coordinator-pinned trend-gate definition r3, resolving
// codex delta review r3's MAJOR finding on the r2 deviation above): r2's
// "since the start of the rows this call was given" fallback was NOT
// accepted this round -- dream-lane.js hands this classifier up to
// HISTORY_RETENTION_TICKS (150 ticks) of history on every call, far wider
// than the trigger's own 40-tick window, so a crossing with no PRIOR
// crossing in that wide history could inherit a pre-window stockpile peak
// from up to 150 ticks back, potentially reversing the trend-gate verdict
// a 40-tick-window-scoped observer would have reached. FIX: `recoveryPeakWindowTicks`
// is an OPTIONAL parameter (never a baked-in constant -- this classifier
// stays window-agnostic, exactly like every other one in this file) that
// bounds EVERY crossing's lookback -- not just a crossing with no prior
// crossing -- to at most that many ticks before the crossing's OWN tick,
// on top of (never instead of) the existing "since the previous crossing"
// reset: whichever start point is LATER (the previous crossing, or
// crossingTick - recoveryPeakWindowTicks) wins. The composer/trigger side
// owns STARVATION_REPEAT_WINDOW_TICKS and is the one caller that supplies
// this bound (dream-lane.js's checkTriggers() and ablation.cjs's audit
// re-derivation both pass dream-composer.js's own exported constant) --
// this module never reads that constant for itself. Omitting the
// parameter (or passing null) restores the unbounded r2 behavior, kept
// only for callers with no window concept of their own.
//
// `stockpile` on each ROW (the caller's raw per-tick datum, threaded from
// dream-lane.js's recordTickOutcome) is still required as this function's
// INPUT -- rows missing it are simply excluded from the running peak,
// which naturally produces `recovery_peak: null` for a crossing whose
// entire (bounded) lookback has no stockpile data at all (never a silent 0).
function classifyStarvation(runLogRows, { recoveryPeakWindowTicks = null } = {}) {
  const rows = runLogRows || [];
  const byHive = new Map();
  for (const row of rows) {
    if (row.hive === undefined || row.hive === null) continue;
    if (!byHive.has(row.hive)) byHive.set(row.hive, []);
    byHive.get(row.hive).push(row);
  }
  const events = [];
  for (const [hiveId, hiveRows] of byHive.entries()) {
    const sorted = [...hiveRows].sort((a, b) => a.tick - b.tick);
    let sincePrevCrossing = []; // [{tick, stockpile}], reset at every crossing
    for (const row of sorted) {
      if (typeof row.stockpile === 'number') sincePrevCrossing.push({ tick: row.tick, stockpile: row.stockpile });
      if (row.starved === true) {
        // The window floor is exclusive, matching dream-composer.js's own
        // window filter convention (`ev.tick > tick - windowTicks`) exactly
        // -- a value at precisely `row.tick - recoveryPeakWindowTicks`
        // ticks back is OUTSIDE the window, not the boundary case.
        const windowFloor = recoveryPeakWindowTicks !== null ? row.tick - recoveryPeakWindowTicks : -Infinity;
        const inWindow = sincePrevCrossing.filter((s) => s.tick > windowFloor);
        const recoveryPeak = inWindow.length > 0 ? Math.max(...inWindow.map((s) => s.stockpile)) : null;
        events.push(assertEvidence({
          metric: 'starvation_event',
          subject: hiveId,
          tick: row.tick,
          tick_range: [row.tick, row.tick],
          recovery_peak: recoveryPeak,
          evidence: [{ source: 'run-log.jsonl', ref: `tick=${row.tick},hive=${hiveId},starved=true` }]
        }));
        sincePrevCrossing = []; // next crossing's lookback starts fresh from here
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
  return events;
}

// RECOVERY: a hive's stockpile crossing from below-upkeep to
// sustained-above-upkeep over N ticks. `upkeepThreshold` and `sustainTicks`
// are the ledger's tunables (defaults chosen conservatively; callers scoring
// against a specific run may override).
function classifyRecovery(runLogRows, { upkeepThreshold = 0, sustainTicks = 5 } = {}) {
  const byHive = new Map();
  for (const row of runLogRows || []) {
    if (row.hive === undefined || row.hive === null) continue;
    if (!byHive.has(row.hive)) byHive.set(row.hive, []);
    byHive.get(row.hive).push(row);
  }
  const events = [];
  for (const [hiveId, rows] of byHive.entries()) {
    const sorted = [...rows].sort((a, b) => a.tick - b.tick);
    let streak = [];
    let sawBelow = false;
    for (const row of sorted) {
      const food = row.stockpile && typeof row.stockpile.food === 'number' ? row.stockpile.food : null;
      if (food === null) continue;
      if (food <= upkeepThreshold) {
        sawBelow = true;
        streak = [];
        continue;
      }
      // above upkeep
      streak.push(row);
      if (sawBelow && streak.length >= sustainTicks) {
        const windowRows = streak.slice(-sustainTicks);
        events.push(assertEvidence({
          metric: 'recovery',
          subject: hiveId,
          tick: row.tick,
          tick_range: [windowRows[0].tick, windowRows[windowRows.length - 1].tick],
          evidence: windowRows.map((r) => ({ source: 'run-log.jsonl', ref: `tick=${r.tick},hive=${hiveId},food=${r.stockpile.food}` }))
        }));
        sawBelow = false; // one recovery event per below->sustained-above crossing
        streak = [];
      }
    }
  }
  return events;
}

// SUSTAINED SURVIVAL: no starvation event in a rolling window. Emits one
// event per hive per trailing window of `windowTicks` consecutive rows that
// contains zero starved===true rows, evaluated at each row once the window
// is full (rolling, may emit overlapping windows -- callers/tests that want
// non-overlapping windows can de-duplicate by tick_range).
function classifySustainedSurvival(runLogRows, { windowTicks = 20 } = {}) {
  const byHive = new Map();
  for (const row of runLogRows || []) {
    if (row.hive === undefined || row.hive === null) continue;
    if (!byHive.has(row.hive)) byHive.set(row.hive, []);
    byHive.get(row.hive).push(row);
  }
  const events = [];
  for (const [hiveId, rows] of byHive.entries()) {
    const sorted = [...rows].sort((a, b) => a.tick - b.tick);
    for (let i = windowTicks - 1; i < sorted.length; i += 1) {
      const windowRows = sorted.slice(i - windowTicks + 1, i + 1);
      const hasStarvation = windowRows.some((r) => r.starved === true);
      if (!hasStarvation) {
        events.push(assertEvidence({
          metric: 'sustained_survival',
          subject: hiveId,
          tick: windowRows[windowRows.length - 1].tick,
          tick_range: [windowRows[0].tick, windowRows[windowRows.length - 1].tick],
          evidence: windowRows.map((r) => ({ source: 'run-log.jsonl', ref: `tick=${r.tick},hive=${hiveId},starved=${Boolean(r.starved)}` }))
        }));
      }
    }
  }
  return events;
}

// Orchestrator: runs every classifier over the same run-log/world-state
// input and returns one flat, mechanically-produced ledger.
function extractOutcomeRecords({ runLogRows = [], worldStateSnapshots = [], recoveryOptions, survivalOptions } = {}) {
  return {
    patch_extinction: classifyPatchExtinction(worldStateSnapshots),
    starvation_event: classifyStarvation(runLogRows),
    recovery: classifyRecovery(runLogRows, recoveryOptions),
    sustained_survival: classifySustainedSurvival(runLogRows, survivalOptions)
  };
}

module.exports = {
  METRIC_CLASSES,
  classifyPatchExtinction,
  classifyStarvation,
  classifyRecovery,
  classifySustainedSurvival,
  extractOutcomeRecords
};
