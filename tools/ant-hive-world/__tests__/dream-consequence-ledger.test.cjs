'use strict';

// Coverage for tools/ant-hive-world/dream/consequence-ledger.js -- plan
// world-mind-dream-communication, S2. AC2.

const test = require('node:test');
const assert = require('node:assert/strict');

const ledger = require('../dream/consequence-ledger.js');

test('classifyPatchExtinction detects a food-source id present then absent, field-name keyed', () => {
  const snapshots = [
    { tick: 10, food_sources: { 'tile-1': 5, 'tile-2': 3 } },
    { tick: 20, food_sources: { 'tile-2': 3 } }
  ];
  const events = ledger.classifyPatchExtinction(snapshots);
  assert.equal(events.length, 1);
  assert.equal(events[0].subject, 'tile-1');
  assert.equal(events[0].tick, 20);
  assert.ok(events[0].evidence.length > 0);
});

test('classifyPatchExtinction emits nothing when no patch disappears', () => {
  const snapshots = [
    { tick: 10, food_sources: { 'tile-1': 5 } },
    { tick: 20, food_sources: { 'tile-1': 2 } }
  ];
  assert.deepEqual(ledger.classifyPatchExtinction(snapshots), []);
});

test('classifyStarvation reads row.starved by field name, not position', () => {
  const rows = [
    { tick: 1, hive: 'hive-a', starved: false },
    { tick: 2, hive: 'hive-a', starved: true },
    { tick: 2, hive: 'hive-b', starved: false }
  ];
  const events = ledger.classifyStarvation(rows);
  assert.equal(events.length, 1);
  assert.equal(events[0].subject, 'hive-a');
  assert.equal(events[0].tick, 2);
  assert.ok(events[0].evidence.length > 0);
});

test('classifyStarvation is unaffected by extra/reordered fields (field-name keying, not positional)', () => {
  const rows = [
    // Deliberately shuffled key order vs. the run-log writer's own order,
    // plus an extra unrecognized field -- a positional reader would break,
    // a field-name reader must not.
    { extra_future_field: 'x', hive: 'hive-a', starved: true, tick: 5 }
  ];
  const events = ledger.classifyStarvation(rows);
  assert.equal(events.length, 1);
  assert.equal(events[0].subject, 'hive-a');
});

// S4b amendment (coordinator-pinned trend-gate definition r2,
// 2026-08-13T17:45Z): classifyStarvation computes `recovery_peak` per
// crossing -- the max post-upkeep stockpile since the hive's PREVIOUS
// crossing (or since the start of the given rows, if none). Fixtures below
// are PRODUCTION-VALID: a `starved: true` row always carries stockpile: 0
// (applyUpkeep()'s own definition -- see dream-composer.js's trendGateResult
// header for why the r1 definition, which read the crossing's OWN
// stockpile, was vacuous). The recovery signal lives in the NON-crossing
// rows between two crossings, never on the crossing row itself.

test('classifyStarvation computes recovery_peak as the max stockpile since the hive\'s previous crossing', () => {
  const rows = [
    { tick: 50, hive: 'hive-a', starved: false, stockpile: 4 },
    { tick: 51, hive: 'hive-a', starved: true, stockpile: 0 }, // crossing 1: peak = max(4, 0) = 4
    { tick: 52, hive: 'hive-a', starved: false, stockpile: 2 },
    { tick: 53, hive: 'hive-a', starved: true, stockpile: 0 } // crossing 2: peak since crossing 1 = max(2, 0) = 2
  ];
  const events = ledger.classifyStarvation(rows);
  assert.equal(events.length, 2);
  assert.equal(events[0].tick, 51);
  assert.equal(events[0].recovery_peak, 4);
  assert.equal(events[1].tick, 53);
  assert.equal(events[1].recovery_peak, 2, 'crossing 2\'s peak must be scoped to rows since crossing 1, not the whole history');
});

test('classifyStarvation reports recovery_peak: null when a crossing\'s entire lookback has no stockpile data, never a silent 0', () => {
  const rows = [
    { tick: 50, hive: 'hive-a', starved: false }, // no stockpile field at all
    { tick: 51, hive: 'hive-a', starved: true } // crossing, but no stockpile data anywhere in its lookback
  ];
  const events = ledger.classifyStarvation(rows);
  assert.equal(events[0].recovery_peak, null);
});

test('classifyStarvation scopes recovery_peak per hive independently, never mixing one hive\'s recovery into another\'s crossing', () => {
  const rows = [
    { tick: 50, hive: 'hive-a', starved: false, stockpile: 9 },
    { tick: 51, hive: 'hive-b', starved: false, stockpile: 1 },
    { tick: 52, hive: 'hive-a', starved: true, stockpile: 0 },
    { tick: 53, hive: 'hive-b', starved: true, stockpile: 0 }
  ];
  const events = ledger.classifyStarvation(rows);
  const hiveAEvent = events.find((e) => e.subject === 'hive-a');
  const hiveBEvent = events.find((e) => e.subject === 'hive-b');
  assert.equal(hiveAEvent.recovery_peak, 9);
  assert.equal(hiveBEvent.recovery_peak, 1, 'hive-b\'s own low peak must not be inflated by hive-a\'s unrelated high stockpile');
});

// S4b amendment (coordinator-pinned trend-gate definition r3, resolving
// codex delta review r3's MAJOR finding): recoveryPeakWindowTicks bounds
// EVERY crossing's lookback -- proving pre-window history cannot reverse a
// trend-gate verdict, per codex's own lesson for this fix.
test('classifyStarvation: recoveryPeakWindowTicks PROVES pre-window history cannot reverse a verdict -- the exact fixture that flips WITHOUT the bound', () => {
  const rows = [
    { tick: 10, hive: 'hive-a', starved: false, stockpile: 100 }, // far pre-window -- must NOT count
    { tick: 70, hive: 'hive-a', starved: false, stockpile: 3 }, // in-window recovery before crossing 1
    { tick: 72, hive: 'hive-a', starved: true, stockpile: 0 }, // crossing 1
    { tick: 90, hive: 'hive-a', starved: false, stockpile: 5 }, // in-window recovery before crossing 2
    { tick: 95, hive: 'hive-a', starved: true, stockpile: 0 } // crossing 2
  ];

  // WITHOUT a bound (the old, r2 behavior): crossing 1 inherits the tick-10
  // pre-window peak of 100 (nothing resets "since start" until the first
  // crossing) -- sequence [100, 5] is non-increasing -- the trend gate
  // would FIRE. This is codex's exact finding: pre-window history can
  // reverse the verdict.
  const unboundedEvents = ledger.classifyStarvation(rows);
  const unboundedPeaks = unboundedEvents.map((e) => e.recovery_peak);
  assert.deepEqual(unboundedPeaks, [100, 5]);

  // WITH the canonical 40-tick bound: crossing 1's lookback is capped to
  // (72 - 40, 72] = (32, 72] -- the tick-10 datum falls OUTSIDE that and is
  // excluded, so crossing 1's peak is the in-window 3, not the pre-window
  // 100. Sequence [3, 5] is INCREASING -- the trend gate now correctly
  // SUPPRESSES. The bound changes the verdict, proving it is load-bearing,
  // not cosmetic.
  const boundedEvents = ledger.classifyStarvation(rows, { recoveryPeakWindowTicks: 40 });
  const boundedPeaks = boundedEvents.map((e) => e.recovery_peak);
  assert.deepEqual(boundedPeaks, [3, 5]);

  assert.notDeepEqual(unboundedPeaks, boundedPeaks, 'the bound must actually change the computed peaks for this fixture, not just be present and inert');
});

test('classifyRecovery emits an event when stockpile crosses from below-upkeep to sustained-above-upkeep', () => {
  const rows = [
    { hive: 'hive-a', tick: 1, stockpile: { food: -2, wood: 0 } },
    { hive: 'hive-a', tick: 2, stockpile: { food: 1, wood: 0 } },
    { hive: 'hive-a', tick: 3, stockpile: { food: 2, wood: 0 } },
    { hive: 'hive-a', tick: 4, stockpile: { food: 3, wood: 0 } },
    { hive: 'hive-a', tick: 5, stockpile: { food: 4, wood: 0 } },
    { hive: 'hive-a', tick: 6, stockpile: { food: 5, wood: 0 } }
  ];
  const events = ledger.classifyRecovery(rows, { upkeepThreshold: 0, sustainTicks: 5 });
  assert.equal(events.length, 1);
  assert.equal(events[0].subject, 'hive-a');
  assert.equal(events[0].tick, 6);
});

test('classifyRecovery emits nothing when the hive never dips below upkeep', () => {
  const rows = [
    { hive: 'hive-a', tick: 1, stockpile: { food: 5 } },
    { hive: 'hive-a', tick: 2, stockpile: { food: 6 } }
  ];
  assert.deepEqual(ledger.classifyRecovery(rows, { upkeepThreshold: 0, sustainTicks: 2 }), []);
});

test('classifySustainedSurvival emits a window with zero starvation events', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ hive: 'hive-a', tick: i + 1, starved: false }));
  const events = ledger.classifySustainedSurvival(rows, { windowTicks: 5 });
  assert.equal(events.length, 1);
  assert.equal(events[0].subject, 'hive-a');
  assert.equal(events[0].tick_range[0], 1);
  assert.equal(events[0].tick_range[1], 5);
});

test('classifySustainedSurvival emits nothing when a starvation event falls inside the window', () => {
  const rows = [
    { hive: 'hive-a', tick: 1, starved: false },
    { hive: 'hive-a', tick: 2, starved: true },
    { hive: 'hive-a', tick: 3, starved: false }
  ];
  assert.deepEqual(ledger.classifySustainedSurvival(rows, { windowTicks: 3 }), []);
});

test('AC2: every emitted record carries non-empty evidence; a record with no evidence throws rather than being emitted', () => {
  const snapshots = [
    { tick: 1, food_sources: { 'tile-1': 5 } },
    { tick: 2, food_sources: {} }
  ];
  const events = ledger.classifyPatchExtinction(snapshots);
  for (const e of events) {
    assert.ok(Array.isArray(e.evidence) && e.evidence.length > 0, 'every record must carry non-empty evidence');
  }
});

test('extractOutcomeRecords orchestrates all four classifiers over the same input', () => {
  const runLogRows = [
    { hive: 'hive-a', tick: 1, starved: true, stockpile: { food: -1 } }
  ];
  const worldStateSnapshots = [
    { tick: 0, food_sources: { 'tile-1': 5 } },
    { tick: 1, food_sources: {} }
  ];
  const result = ledger.extractOutcomeRecords({ runLogRows, worldStateSnapshots });
  assert.ok(Array.isArray(result.patch_extinction));
  assert.ok(Array.isArray(result.starvation_event));
  assert.ok(Array.isArray(result.recovery));
  assert.ok(Array.isArray(result.sustained_survival));
  assert.equal(result.patch_extinction.length, 1);
  assert.equal(result.starvation_event.length, 1);
});
