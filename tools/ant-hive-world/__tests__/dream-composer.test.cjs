'use strict';

// Coverage for tools/ant-hive-world/dream/dream-composer.js -- plan
// world-mind-dream-communication, S3. AC4 (symmetric disclosure + valence
// balance) and the pre-registered trigger classes/cooldowns/authority gate.
//
// This module is pure (no engine wiring) -- S4's dream-lane.js is
// responsible for sourcing live trigger evidence and calling into this
// module each tick. These tests exercise the trigger LOGIC against fixture
// evidence, per the S3 dispatch's explicit scope note.

const test = require('node:test');
const assert = require('node:assert/strict');

const composer = require('../dream/dream-composer.js');
const calibration = require('../dream/calibration.js');

function calibrationStateWithAuthority(lane, targetAuthority) {
  // authority = clamp(1 - 2*windowed_brier, 0.1, 1.0); back-solve brier for
  // a target authority in (0.1, 1.0), then feed 5 identical resolved
  // forecasts (the MIN_RESOLVED_FOR_AUTHORITY) with that brier.
  const state = calibration.createCalibrationState();
  const brier = (1 - targetAuthority) / 2;
  // predicted_p=0.5, outcome=true gives brier=(0.5-1)^2=0.25 always; instead
  // solve predicted_p directly: brier=(p-1)^2 => p = 1 - sqrt(brier).
  const p = 1 - Math.sqrt(Math.max(brier, 0));
  for (let i = 0; i < 5; i += 1) {
    calibration.recordResolvedForecast(state, `auth-seed-${lane}-${i}`, lane, p, true);
  }
  return state;
}

// Two-lane variant for merge-arbitration tests, which need independent
// darkness/hope authority values in the SAME calibrationState (a
// single-lane calibrationStateWithAuthority() leaves the other lane at the
// neutral 0.5 prior, which happens to clear the 0.3 gate too -- not useful
// for a test that needs one lane deliberately BELOW the gate).
function calibrationStateWithLaneAuthorities({ darkness, hope }) {
  const state = calibration.createCalibrationState();
  const seed = (lane, targetAuthority) => {
    if (targetAuthority === undefined) return;
    const brier = (1 - targetAuthority) / 2;
    const p = 1 - Math.sqrt(Math.max(brier, 0));
    for (let i = 0; i < 5; i += 1) {
      calibration.recordResolvedForecast(state, `auth-seed-${lane}-${i}`, lane, p, true);
    }
  };
  seed('darkness', darkness);
  seed('hope', hope);
  return state;
}

// Trend-gate fixture helper (S4b amendment, coordinator-pinned trend-gate
// definition r2, 2026-08-13T17:45Z): a starvation-crossing CLASSIFIER
// OUTPUT (consequence-ledger.js's classifyStarvation shape) carrying a
// `recovery_peak` value -- these are composer-level fixtures exercising
// evaluateTrigger2RepeatingStarvation's LOGIC over already-classified
// evidence, not raw run-log rows, so there is no "starved implies stockpile
// 0" constraint here (that constraint applies to RAW ROWS the ledger
// consumes, not to recovery_peak, which is the ledger's own DERIVED
// output -- see the producer-path test below for a fixture built from raw
// rows through the real classifier). `recovery_peak: 1000 - tick` is a
// trivial monotonically DECREASING-in-tick sequence -- any subset, sorted
// ascending by tick, is automatically non-increasing (strictly decreasing,
// in fact), so this helper always PASSES the trend gate. Tests that need
// to exercise the gate FAILING build their own explicit recovery_peak
// values instead.
function decreasingStarvation(tick, subject = 'hive-a') {
  return { metric: 'starvation_event', subject, tick, recovery_peak: 1000 - tick };
}

// --- TRIGGER CLASS 1: patch-death-near-activity ---

test('trigger 1 fires when the acting hive gathered from the extinct patch within the 10-tick proximity window', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'gather-food' }];

  const result = composer.evaluateTrigger1PatchDeathNearActivity({
    hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState
  });

  assert.equal(result.fired, true);
  assert.equal(result.signal.lane, 'darkness');
  assert.equal(result.signal.trigger_class, 'patch-death-near-activity');
  assert.equal(result.signal.hive_id, 'hive-a');
  assert.ok(result.signal.provenance.length > 0);
});

test('trigger 1 does NOT fire when the hive never gathered from the extinct patch (condition not met)', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-2', tick: 95, action: 'gather-food' }]; // different patch

  const result = composer.evaluateTrigger1PatchDeathNearActivity({
    hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState
  });

  assert.equal(result.fired, false);
  assert.equal(result.reason, 'condition-not-met');
});

test('trigger 1 does NOT fire when the gather activity falls outside the proximity window', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 80, action: 'gather-food' }]; // 20 ticks before, outside window=10

  const result = composer.evaluateTrigger1PatchDeathNearActivity({
    hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState
  });

  assert.equal(result.fired, false);
  assert.equal(result.reason, 'condition-not-met');
});

test('MAJOR fix: trigger 1 does NOT fire when the activity near the dead patch is NOT gathering (e.g. idle/build) -- proximity alone is not consequence', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [
    { hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'idle' },
    { hive_id: 'hive-a', patch_id: 'tile-1', tick: 96, action: 'build' },
    { hive_id: 'hive-a', patch_id: 'tile-1', tick: 97, action: 'claim-territory' },
    { hive_id: 'hive-a', patch_id: 'tile-1', tick: 98, action: 'gather-wood' }
  ];

  const result = composer.evaluateTrigger1PatchDeathNearActivity({
    hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState
  });

  assert.equal(result.fired, false, 'a hive that never gathered from the patch has no consequence connection to it');
  assert.equal(result.reason, 'condition-not-met');
});

// --- TRIGGER CLASS 2: repeating-starvation ---
// REVISED (S4b, closeout item 4a): default threshold/window are now 2
// crossings in a 40-tick window (was 3-in-20 at S5 trial time) -- the S5
// trial observed the old default fire exactly once in 2,100 hive-ticks
// (`starved` is a crossing, not a persistent state). Fixtures below use the
// new defaults; the OLD 3-in-20 semantics are still reachable via explicit
// `threshold`/`windowTicks` overrides and are tested separately below.

test('trigger 2 fires when the hive accumulates >= 2 starvation events within a 40-tick window (new default)', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(70), decreasingStarvation(99)];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, true);
  assert.equal(result.signal.trigger_class, 'repeating-starvation');
});

test('trigger 2: the count condition met but the trend gate FAILS (recovery_peak rising -- recovering better between crossings, not worsening) is suppressed, not fired, and journaled as trend-gate', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    { metric: 'starvation_event', subject: 'hive-a', tick: 70, recovery_peak: 2 },
    { metric: 'starvation_event', subject: 'hive-a', tick: 99, recovery_peak: 5 } // rose -- recovering better
  ];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, false);
  assert.equal(result.met, true, 'the count condition WAS met -- this is a suppression, not condition-not-met');
  assert.equal(result.reason, 'trend-gate');
});

test('trigger 2: the trend gate PASSES on equal recovery peaks -- non-increasing includes equal (a plateaued, never-improving recovery still counts as persistent)', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    { metric: 'starvation_event', subject: 'hive-a', tick: 70, recovery_peak: 3 },
    { metric: 'starvation_event', subject: 'hive-a', tick: 99, recovery_peak: 3 } // equal, not greater
  ];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, true, 'equal recovery peaks must pass the non-increasing gate');
});

test('trigger 2: 3 crossings with a mixed direction where the LAST pair is increasing is suppressed (the whole sequence must be non-increasing, not just an early stretch)', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    { metric: 'starvation_event', subject: 'hive-a', tick: 70, recovery_peak: 8 },
    { metric: 'starvation_event', subject: 'hive-a', tick: 85, recovery_peak: 4 }, // decreasing so far
    { metric: 'starvation_event', subject: 'hive-a', tick: 99, recovery_peak: 6 } // rose at the end -- fails
  ];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, false);
  assert.equal(result.met, true);
  assert.equal(result.reason, 'trend-gate');
});

test('trigger 2: a crossing with no recovery_peak on record (null) fails the trend gate rather than silently passing', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    { metric: 'starvation_event', subject: 'hive-a', tick: 70, recovery_peak: null },
    { metric: 'starvation_event', subject: 'hive-a', tick: 99, recovery_peak: 5 }
  ];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, false);
  assert.equal(result.met, true);
  assert.equal(result.reason, 'trend-gate-no-stockpile-data');
});

test('trendGateResult: exported directly, passes on a strictly-decreasing sequence and an unsorted-input sequence alike', () => {
  assert.equal(composer.trendGateResult([{ tick: 1, recovery_peak: 5 }, { tick: 2, recovery_peak: 3 }]).passed, true);
  // Deliberately out-of-tick-order input -- trendGateResult sorts internally.
  assert.equal(composer.trendGateResult([{ tick: 2, recovery_peak: 3 }, { tick: 1, recovery_peak: 5 }]).passed, true);
  assert.equal(composer.trendGateResult([{ tick: 1, recovery_peak: 3 }, { tick: 2, recovery_peak: 5 }]).passed, false);
});

// --- PRODUCER-PATH INTEGRATION (codex delta review lesson: "cross-layer
// gates need a fixture driven through the real producer; pure evaluator
// fixtures can encode impossible states" -- this drives PRODUCTION-VALID
// raw run-log rows through the REAL consequence-ledger.js classifier, not
// a hand-built composer-level fixture, closing the exact gap that let the
// r1 defect (vacuous trend gate) ship with 100% passing evaluator-only
// tests). ---

test('PRODUCER-PATH: real run-log rows -> classifyStarvation -> evaluateTrigger2RepeatingStarvation fires on a genuinely worsening recovery pattern', () => {
  const ledger = require('../dream/consequence-ledger.js');
  // Crossings at ticks 90/95 -- inside the default 40-tick window ending at
  // the evaluation tick (100), i.e. (60, 100].
  const rows = [
    { tick: 88, hive: 'hive-a', starved: false, stockpile: 6 }, // recovers to 6 before crossing 1
    { tick: 90, hive: 'hive-a', starved: true, stockpile: 0 }, // crossing 1 (peak since start = 6)
    { tick: 93, hive: 'hive-a', starved: false, stockpile: 2 }, // only recovers to 2 this time
    { tick: 95, hive: 'hive-a', starved: true, stockpile: 0 } // crossing 2 (peak since crossing 1 = 2)
  ];
  const starvationEvents = ledger.classifyStarvation(rows);
  assert.equal(starvationEvents.length, 2);

  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });
  assert.equal(result.fired, true, 'peak dropped 6 -> 2 across crossings -- a genuinely worsening, production-real pattern');
});

test('PRODUCER-PATH: real run-log rows -> classifyStarvation -> evaluateTrigger2RepeatingStarvation suppresses a genuinely recovering pattern', () => {
  const ledger = require('../dream/consequence-ledger.js');
  const rows = [
    { tick: 88, hive: 'hive-a', starved: false, stockpile: 2 }, // recovers only to 2 before crossing 1
    { tick: 90, hive: 'hive-a', starved: true, stockpile: 0 }, // crossing 1 (peak since start = 2)
    { tick: 93, hive: 'hive-a', starved: false, stockpile: 7 }, // recovers much further this time
    { tick: 95, hive: 'hive-a', starved: true, stockpile: 0 } // crossing 2 (peak since crossing 1 = 7)
  ];
  const starvationEvents = ledger.classifyStarvation(rows);

  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });
  assert.equal(result.fired, false);
  assert.equal(result.met, true);
  assert.equal(result.reason, 'trend-gate', 'peak rose 2 -> 7 across crossings -- the hive is genuinely recovering better, not worse');
});

test('PRODUCER-PATH r3: the recoveryPeakWindowTicks bound flips the END-TO-END trigger verdict -- proving the fix is load-bearing all the way to evaluateTrigger2RepeatingStarvation, not just at the classifier', () => {
  const ledger = require('../dream/consequence-ledger.js');
  const rows = [
    { tick: 10, hive: 'hive-a', starved: false, stockpile: 100 }, // far pre-window
    { tick: 70, hive: 'hive-a', starved: false, stockpile: 3 },
    { tick: 72, hive: 'hive-a', starved: true, stockpile: 0 }, // crossing 1
    { tick: 90, hive: 'hive-a', starved: false, stockpile: 5 },
    { tick: 95, hive: 'hive-a', starved: true, stockpile: 0 } // crossing 2
  ];
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);

  // WITHOUT the bound: crossing 1 inherits the pre-window peak of 100,
  // [100, 5] is non-increasing -- the OLD (r2) code fires.
  const unboundedEvents = ledger.classifyStarvation(rows);
  const unboundedResult = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents: unboundedEvents, cooldownState: composer.createCooldownState(), calibrationState
  });
  assert.equal(unboundedResult.fired, true, 'sanity check: this fixture DOES flip the old, unbounded code to fire');

  // WITH the canonical 40-tick bound (dream-composer.js's own
  // STARVATION_REPEAT_WINDOW_TICKS): crossing 1's peak is capped to the
  // in-window 3, [3, 5] is increasing -- the FIXED code correctly
  // suppresses instead.
  const boundedEvents = ledger.classifyStarvation(rows, { recoveryPeakWindowTicks: composer.STARVATION_REPEAT_WINDOW_TICKS });
  const boundedResult = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents: boundedEvents, cooldownState: composer.createCooldownState(), calibrationState
  });
  assert.equal(boundedResult.fired, false);
  assert.equal(boundedResult.reason, 'trend-gate', 'the bounded, canonical evaluation must suppress -- pre-window history no longer reverses the verdict');
});

test('trigger 2 does NOT fire below the 2-event threshold (new default)', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    { metric: 'starvation_event', subject: 'hive-a', tick: 99 }
  ]; // only 1

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, false);
  assert.equal(result.reason, 'condition-not-met');
});

test('trigger 2 does NOT count events outside the rolling 40-tick window (new default)', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    { metric: 'starvation_event', subject: 'hive-a', tick: 55 }, // outside the 40-tick window ending at 100
    { metric: 'starvation_event', subject: 'hive-a', tick: 99 }
  ];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState
  });

  assert.equal(result.fired, false, 'only 1 of the 2 events falls inside the rolling window');
});

test('trigger 2 still supports the OLD 3-in-20 semantics via explicit threshold/windowTicks overrides', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99)];

  const result = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState, threshold: 3, windowTicks: 20
  });

  assert.equal(result.fired, true);

  const notEnough = composer.evaluateTrigger2RepeatingStarvation({
    hiveId: 'hive-a', tick: 100, starvationEvents: starvationEvents.slice(0, 2), cooldownState: composer.createCooldownState(), calibrationState, threshold: 3, windowTicks: 20
  });
  assert.equal(notEnough.fired, false);
});

// --- TRIGGER CLASS 3: verified-reachable-hope ---

test('trigger 3 fires from a sustained_survival record for the acting hive (the dormant-regrowth evidence floor)', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.9);
  const cooldownState = composer.createCooldownState();
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 90 }];

  const result = composer.evaluateTrigger3VerifiedReachableHope({
    hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true
  });

  assert.equal(result.fired, true);
  assert.equal(result.signal.lane, 'hope');
  assert.equal(result.signal.trigger_class, 'verified-reachable-hope');
});

test('trigger 3 does NOT fire for a different hive\'s sustained_survival record', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.9);
  const cooldownState = composer.createCooldownState();
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-b', tick: 90 }];

  const result = composer.evaluateTrigger3VerifiedReachableHope({
    hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true
  });

  assert.equal(result.fired, false);
  assert.equal(result.reason, 'condition-not-met');
});

test('MAJOR fix: trigger 3 does NOT fire for a sustained_survival record older than the RECENCY_WINDOW -- stale hope is false hope', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.9);
  const cooldownState = composer.createCooldownState();
  // Record is 150 ticks old; RECENCY_WINDOW default is 100.
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 50 }];

  const result = composer.evaluateTrigger3VerifiedReachableHope({
    hiveId: 'hive-a', tick: 200, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true
  });

  assert.equal(result.fired, false, 'a record beyond the recency window no longer speaks to what is reachable now');
  assert.equal(result.reason, 'condition-not-met');
});

test('MAJOR fix: trigger 3 does NOT fire when the current-state relevance predicate returns false', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.9);
  const cooldownState = composer.createCooldownState();
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 90 }];

  const result = composer.evaluateTrigger3VerifiedReachableHope({
    hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState,
    isCurrentlyRelevant: () => false // e.g. the hive is not currently food-stressed -- this hope is not relevant right now
  });

  assert.equal(result.fired, false, 'a mechanically-eligible record must still be suppressed when it is not relevant to the hive\'s current situation');
  assert.equal(result.reason, 'condition-not-met');
});

test('MAJOR fix: trigger 3 throws if the caller omits the current-state relevance predicate entirely -- relevance is never assumed', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.9);
  const cooldownState = composer.createCooldownState();
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 90 }];

  assert.throws(
    () => composer.evaluateTrigger3VerifiedReachableHope({ hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState }),
    /isCurrentlyRelevant/
  );
});

test('trigger 3 fires for a record exactly at the RECENCY_WINDOW boundary', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.9);
  const cooldownState = composer.createCooldownState();
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 0 }];

  const result = composer.evaluateTrigger3VerifiedReachableHope({
    hiveId: 'hive-a', tick: composer.RECENCY_WINDOW, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true
  });

  assert.equal(result.fired, true, 'a record exactly RECENCY_WINDOW ticks old is still within the window (inclusive boundary)');
});

// --- cooldowns (per-class, per-hive, 20 ticks) ---

// S4b amendment (operator ratification 2026-08-13T16:46Z, call S4b-2, MERGE
// policy): cooldown is no longer consumed by the per-trigger evaluator call
// itself -- it is consumed exactly once, for every CLEARED class together,
// by arbitrateDelivery() (see dream-composer.js's own header on
// gateOrSignal/arbitrateDelivery). Tests that exercise cooldown timing must
// therefore route each "clearing" call through arbitrateDelivery(), the same
// way the live checkTriggers() tick path does, to actually record the fire.

test('a trigger inside its 20-tick cooldown does NOT fire again, even though its condition is still met', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99)];
  const first = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  assert.equal(first.fired, true);
  const firstArbitration = composer.arbitrateDelivery({ 'repeating-starvation': first }, cooldownState);
  assert.equal(firstArbitration.mergedTriggerClasses.length, 1, 'arbitration must record exactly one cleared class');

  const second = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 110, starvationEvents, cooldownState, calibrationState }); // 10 ticks later, inside cooldown=20
  assert.equal(second.fired, false);
  assert.equal(second.reason, 'cooldown');
});

test('a trigger fires again once its 20-tick cooldown has elapsed', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [
    decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99),
    decreasingStarvation(105), decreasingStarvation(115), decreasingStarvation(119)
  ];
  const first = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  assert.equal(first.fired, true);
  composer.arbitrateDelivery({ 'repeating-starvation': first }, cooldownState);

  // At tick=120, the rolling window is (100,120]; events at 105/115/119 fall
  // inside it (3 events, meeting the threshold), so this proves the
  // cooldown -- not the event window -- is what's being tested here.
  const second = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 120, starvationEvents, cooldownState, calibrationState }); // exactly 20 ticks later
  assert.equal(second.fired, true, 'cooldown of exactly 20 ticks must have elapsed');
});

test('cooldowns are enforced per-class per-hive independently', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99)];
  const resultA = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  composer.arbitrateDelivery({ 'repeating-starvation': resultA }, cooldownState);

  // Same hive, SAME trigger class, same tick again -- now blocked (proves
  // the arbitration call above actually recorded the fire).
  const resultARepeat = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  assert.equal(resultARepeat.fired, false, 'hive-a\'s own cooldown for this class must now be active');

  // A different hive, same trigger class, same tick -- its own cooldown is untouched.
  const starvationEventsB = [decreasingStarvation(90, 'hive-b'), decreasingStarvation(95, 'hive-b'), decreasingStarvation(99, 'hive-b')];
  const resultB = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-b', tick: 100, starvationEvents: starvationEventsB, cooldownState, calibrationState });
  assert.equal(resultB.fired, true, 'hive-b\'s cooldown for this class must be independent of hive-a\'s');

  // Same hive, a DIFFERENT trigger class, same tick -- also untouched by trigger 2's cooldown.
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'gather-food' }];
  const resultTrigger1 = composer.evaluateTrigger1PatchDeathNearActivity({ hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState });
  assert.equal(resultTrigger1.fired, true, 'trigger class 1\'s cooldown for hive-a must be independent of trigger class 2\'s');
});

// --- delivery arbitration + merge (S4b-2 MERGE policy) ---

test('arbitrateDelivery merges two simultaneously-cleared trigger classes into ONE delivered dream, journaling both sources', () => {
  const calibrationState = calibrationStateWithLaneAuthorities({ darkness: 0.9, hope: 0.9 });
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'gather-food' }];
  const trigger1Result = composer.evaluateTrigger1PatchDeathNearActivity({ hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState });
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 100 }];
  const trigger3Result = composer.evaluateTrigger3VerifiedReachableHope({ hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true });
  assert.equal(trigger1Result.fired, true);
  assert.equal(trigger3Result.fired, true);

  const arbitration = composer.arbitrateDelivery({
    'patch-death-near-activity': trigger1Result,
    'verified-reachable-hope': trigger3Result
  }, cooldownState);

  assert.deepEqual(arbitration.mergedTriggerClasses.sort(), ['patch-death-near-activity', 'verified-reachable-hope'].sort());
  assert.equal(arbitration.delivered.sources.length, 2, 'the merged delivery must journal both source triggers');
  assert.equal(arbitration.delivered.lane, 'mixed', 'a darkness+hope merge is the EXPLICIT lane "mixed" (S5 re-trial fold) -- null would misstate it as absent, not merged');

  // Both classes must now be in cooldown -- delivered means delivered, and
  // both source classes were part of what delivered.
  assert.equal(composer.cooldownElapsed(cooldownState, 'hive-a', 'patch-death-near-activity', 100), false);
  assert.equal(composer.cooldownElapsed(cooldownState, 'hive-a', 'verified-reachable-hope', 100), false);
});

test('arbitrateDelivery: an authority-gate-suppressed class is journaled as suppressed, not merged, and does not consume its cooldown', () => {
  const calibrationState = calibrationStateWithLaneAuthorities({ darkness: 0.9, hope: 0.1 }); // hope below AUTHORITY_GATE_MIN
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'gather-food' }];
  const trigger1Result = composer.evaluateTrigger1PatchDeathNearActivity({ hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState });
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 100 }];
  const trigger3Result = composer.evaluateTrigger3VerifiedReachableHope({ hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true });
  assert.equal(trigger1Result.fired, true);
  assert.equal(trigger3Result.fired, false);
  assert.equal(trigger3Result.reason, 'suppressed-authority-gate');

  const arbitration = composer.arbitrateDelivery({
    'patch-death-near-activity': trigger1Result,
    'verified-reachable-hope': trigger3Result
  }, cooldownState);

  assert.deepEqual(arbitration.mergedTriggerClasses, ['patch-death-near-activity']);
  assert.equal(arbitration.delivered.sources.length, 1);
  assert.equal(arbitration.suppressed.length, 1);
  assert.equal(arbitration.suppressed[0].trigger_class, 'verified-reachable-hope');
  assert.equal(composer.cooldownElapsed(cooldownState, 'hive-a', 'verified-reachable-hope', 100), true, 'a suppressed class never earned a cooldown');
});

test('arbitrateDelivery returns no delivery and empty dispositions when nothing cleared', () => {
  const cooldownState = composer.createCooldownState();
  const arbitration = composer.arbitrateDelivery({}, cooldownState);
  assert.equal(arbitration.delivered, null);
  assert.deepEqual(arbitration.mergedTriggerClasses, []);
  assert.deepEqual(arbitration.suppressed, []);
});

test('mergeDreamSignals: a single-source delivery still carries a one-element sources array -- no special-casing downstream', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99)];
  const result = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  const arbitration = composer.arbitrateDelivery({ 'repeating-starvation': result }, cooldownState);
  assert.equal(arbitration.delivered.sources.length, 1);
  assert.equal(arbitration.delivered.lane, 'darkness');
});

// --- authority gate (< 0.3 suppresses; >= 0.3 fires, continuous value rides along) ---

test('a trigger whose condition is met is SUPPRESSED (not fired) when lane authority is below the 0.3 floor -- logged, not dropped', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.15); // below AUTHORITY_GATE_MIN=0.3
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99)];

  const result = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });

  assert.equal(result.fired, false);
  assert.equal(result.met, true, 'the mechanical condition WAS met -- this proves it is logged as suppressed, not treated as condition-not-met');
  assert.equal(result.reason, 'suppressed-authority-gate');
  assert.ok(result.authority < composer.AUTHORITY_GATE_MIN);
});

test('a suppressed trigger does not consume its cooldown -- it may fire on a later tick once authority recovers', () => {
  const lowAuthority = calibrationStateWithAuthority('darkness', 0.15);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95), decreasingStarvation(99)];
  const suppressed = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState: lowAuthority });
  assert.equal(suppressed.fired, false);

  const highAuthority = calibrationStateWithAuthority('darkness', 0.9);
  const fired = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 101, starvationEvents, cooldownState, calibrationState: highAuthority });
  assert.equal(fired.fired, true, 'a suppressed attempt must not have consumed the cooldown');
});

test('a fired DreamSignal carries the continuous authority value, not just a pass/fail', () => {
  const calibrationState = calibrationStateWithAuthority('hope', 0.72);
  const cooldownState = composer.createCooldownState();
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 90 }];

  const result = composer.evaluateTrigger3VerifiedReachableHope({ hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true });

  assert.equal(result.fired, true);
  assert.ok(Math.abs(result.signal.forecast_authority - 0.72) < 1e-6);
});

// --- symmetric disclosure + valence balance (AC4) ---

function forecast(id, generationId, metric, subject, predictedP, outcome) {
  return { forecast_id: id, generation_id: generationId, target: { metric, subject, horizon_ticks: 50 }, tick_issued: 0, predicted_p: predictedP, outcome };
}

test('classifyForecastDisclosure: all four disclosure states are produced from the metric+outcome pair', () => {
  assert.deepEqual(composer.classifyForecastDisclosure(forecast('f1', 'g1', 'patch_extinction', 'tile-1', 0.9, true)), { lane: 'darkness', disclosure: 'realized' });
  assert.deepEqual(composer.classifyForecastDisclosure(forecast('f2', 'g1', 'starvation_event', 'hive-a', 0.9, false)), { lane: 'darkness', disclosure: 'averted' });
  assert.deepEqual(composer.classifyForecastDisclosure(forecast('f3', 'g1', 'recovery', 'hive-a', 0.9, true)), { lane: 'hope', disclosure: 'successful' });
  assert.deepEqual(composer.classifyForecastDisclosure(forecast('f4', 'g1', 'sustained_survival', 'hive-a', 0.9, false)), { lane: 'hope', disclosure: 'failed' });
});

test('SYMMETRIC DISCLOSURE (AC4): a failed-hope record composes into the SAME entry shape as a realized-darkness record, and is not dropped', () => {
  const failedHope = composer.composeForecastEntry(forecast('fh1', 'g1', 'sustained_survival', 'hive-a', 0.8, false));
  const realizedDarkness = composer.composeForecastEntry(forecast('rd1', 'g1', 'patch_extinction', 'tile-1', 0.8, true));

  // Same field shape (keys), the mechanical proof that a failed hope is
  // composed and disclosed with no special/softened schema -- it is exactly
  // as plainly reported as a realized darkness.
  assert.deepEqual(Object.keys(failedHope).sort(), Object.keys(realizedDarkness).sort());
  assert.deepEqual(Object.keys(failedHope.text_or_data).sort(), Object.keys(realizedDarkness.text_or_data).sort());
  assert.equal(failedHope.text_or_data.disclosure, 'failed');
  assert.equal(failedHope.entry_type, 'dream');
  assert.equal(failedHope.lane, 'hope');
  assert.ok(failedHope.provenance.ref.length > 0, 'a failed hope still carries provenance -- it is not dropped');
});

test('SYMMETRIC DISCLOSURE: an averted darkness composes with the same shape/priority as a realized one', () => {
  const averted = composer.composeForecastEntry(forecast('a1', 'g1', 'starvation_event', 'hive-a', 0.7, false));
  const realized = composer.composeForecastEntry(forecast('r1', 'g1', 'starvation_event', 'hive-b', 0.7, true));
  assert.deepEqual(Object.keys(averted).sort(), Object.keys(realized).sort());
  assert.equal(averted.text_or_data.disclosure, 'averted');
  assert.equal(realized.text_or_data.disclosure, 'realized');
});

test('composeForecastEntry throws rather than composing a forecast with no forecast_id or generation_id', () => {
  assert.throws(() => composer.composeForecastEntry({ generation_id: 'g1', target: { metric: 'recovery', subject: 'hive-a' }, predicted_p: 0.5, outcome: true }), /forecast_id/);
  assert.throws(() => composer.composeForecastEntry({ forecast_id: 'f1', target: { metric: 'recovery', subject: 'hive-a' }, predicted_p: 0.5, outcome: true }), /generation_id/);
});

// --- composeSignalEntry (S4b, closeout item 2): compose a vault entry from a LIVE-FIRED DreamSignal ---

test('composeSignalEntry composes a DreamMemory-shaped entry from a fired DreamSignal, carrying the signal\'s own fields verbatim', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.9);
  const cooldownState = composer.createCooldownState();
  const starvationEvents = [decreasingStarvation(70), decreasingStarvation(99)];
  const result = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  assert.equal(result.fired, true);

  const entry = composer.composeSignalEntry(result.signal, 'gen-test-1');
  assert.equal(entry.entry_type, 'dream');
  assert.equal(entry.lane, 'darkness');
  assert.equal(entry.generation_id, 'gen-test-1');
  assert.equal(entry.text_or_data.trigger_class, 'repeating-starvation');
  assert.equal(entry.text_or_data.hive_id, 'hive-a');
  assert.equal(entry.text_or_data.forecast_authority, result.signal.forecast_authority);
  assert.ok(entry.provenance && entry.provenance.source, 'a composed signal entry must carry non-empty provenance');
  // S4b amendment (item d): a raw (non-merged) signal still composes with a
  // one-element `sources` array and an (empty, by default) suppressed list
  // -- symmetric shape whether or not a merge happened.
  assert.equal(entry.text_or_data.disclosure, 'live-perception');
  assert.equal(entry.text_or_data.sources.length, 1);
  assert.equal(entry.text_or_data.sources[0].trigger_class, 'repeating-starvation');
  assert.deepEqual(entry.text_or_data.suppressed_triggers, []);
});

test('composeSignalEntry throws without a signal or a generation_id', () => {
  assert.throws(() => composer.composeSignalEntry(null, 'gen-1'), /signal/);
  assert.throws(() => composer.composeSignalEntry({ lane: 'darkness', trigger_class: 'repeating-starvation', provenance: [] }, null), /generation_id/);
});

test('composeSignalEntry on a MERGED delivery journals every source and every suppressed trigger, with a "live-perception-merged" disclosure', () => {
  const calibrationState = calibrationStateWithLaneAuthorities({ darkness: 0.9, hope: 0.1 });
  const cooldownState = composer.createCooldownState();
  const extinctionEvents = [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }];
  const recentActivity = [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'gather-food' }];
  const trigger1Result = composer.evaluateTrigger1PatchDeathNearActivity({ hiveId: 'hive-a', tick: 100, extinctionEvents, recentActivity, cooldownState, calibrationState });
  const starvationEvents = [decreasingStarvation(90), decreasingStarvation(95)];
  const trigger2Result = composer.evaluateTrigger2RepeatingStarvation({ hiveId: 'hive-a', tick: 100, starvationEvents, cooldownState, calibrationState });
  const sustainedSurvivalEvents = [{ metric: 'sustained_survival', subject: 'hive-a', tick: 100 }];
  const trigger3Result = composer.evaluateTrigger3VerifiedReachableHope({ hiveId: 'hive-a', tick: 100, sustainedSurvivalEvents, cooldownState, calibrationState, isCurrentlyRelevant: () => true });

  const arbitration = composer.arbitrateDelivery({
    'patch-death-near-activity': trigger1Result,
    'repeating-starvation': trigger2Result,
    'verified-reachable-hope': trigger3Result
  }, cooldownState);

  const entry = composer.composeSignalEntry(arbitration.delivered, 'gen-test-merge', { suppressed: arbitration.suppressed });
  assert.equal(entry.text_or_data.disclosure, 'live-perception-merged');
  assert.deepEqual(
    entry.text_or_data.sources.map((s) => s.trigger_class).sort(),
    ['patch-death-near-activity', 'repeating-starvation'].sort()
  );
  assert.equal(entry.text_or_data.suppressed_triggers.length, 1);
  assert.equal(entry.text_or_data.suppressed_triggers[0].trigger_class, 'verified-reachable-hope');
  assert.equal(entry.lane, 'darkness', 'both merged sources (trigger 1 and trigger 2) are darkness-lane, so the merge has one shared lane, not null');
});

test('composeBatch: 1:1 default ratio is honored when both lanes have eligible evidence', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('d2', 'g1', 'starvation_event', 'hive-a', 0.9, true),
    forecast('d3', 'g1', 'starvation_event', 'hive-b', 0.9, false),
    forecast('h1', 'g1', 'recovery', 'hive-a', 0.9, true),
    forecast('h2', 'g1', 'sustained_survival', 'hive-b', 0.9, true)
    // 3 darkness, 2 hope eligible -> 1:1 fit: k = min(floor(3/1), floor(2/1)) = 2 -> 2 darkness, 2 hope
  ];
  const batch = composer.composeBatch(forecasts, { generationId: 'g1' });
  assert.equal(batch.darkness.length, 2);
  assert.equal(batch.hope.length, 2);
  assert.equal(batch.shortfall.darkness, false);
  assert.equal(batch.shortfall.hope, false);
  assert.equal(batch.ratioUsed.label, '1:1');
});

test('composeBatch: the ratified 1:1.5 hope-lean ratio is honored when both lanes have eligible evidence', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('d2', 'g1', 'starvation_event', 'hive-a', 0.9, true),
    forecast('h1', 'g1', 'recovery', 'hive-a', 0.9, true),
    forecast('h2', 'g1', 'sustained_survival', 'hive-b', 0.9, true),
    forecast('h3', 'g1', 'recovery', 'hive-b', 0.9, false)
    // 2 darkness, 3 hope -> ratio {darkness:2, hope:3} -> k=min(floor(2/2), floor(3/3))=1 -> 2 darkness, 3 hope
  ];
  const batch = composer.composeBatch(forecasts, { ratio: composer.VALENCE_RATIO_HOPE_LEAN, rationale: 'heavily punishing environment, hope-lean ratified for this run', generationId: 'g1' });
  assert.equal(batch.darkness.length, 2);
  assert.equal(batch.hope.length, 3);
  assert.equal(batch.ratioUsed.label, '1:1.5');
});

test('composeBatch: darkness-only batch with a logged shortfall when no hope evidence is eligible -- never backfilled', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('d2', 'g1', 'starvation_event', 'hive-a', 0.9, true)
  ];
  const batch = composer.composeBatch(forecasts, { generationId: 'g1' });
  assert.equal(batch.darkness.length, 2);
  assert.equal(batch.hope.length, 0);
  assert.equal(batch.shortfall.hope, true);
  assert.equal(batch.shortfall.darkness, false);
});

test('composeBatch: hope-only batch with a logged shortfall when no darkness evidence is eligible', () => {
  const forecasts = [forecast('h1', 'g1', 'recovery', 'hive-a', 0.9, true)];
  const batch = composer.composeBatch(forecasts, { generationId: 'g1' });
  assert.equal(batch.darkness.length, 0);
  assert.equal(batch.hope.length, 1);
  assert.equal(batch.shortfall.darkness, true);
});

test('composeBatch: symmetric disclosure holds inside a real batch -- a failed-hope forecast is selected exactly like a successful one', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('h1', 'g1', 'sustained_survival', 'hive-a', 0.9, false) // failed hope
  ];
  const batch = composer.composeBatch(forecasts, { generationId: 'g1' });
  assert.equal(batch.hope.length, 1, 'a failed hope must not be excluded from the batch just because its disclosure is negative');
  assert.equal(batch.hope[0].text_or_data.disclosure, 'failed');
});

test('composeBatch: quarantined generations are excluded from composer input entirely', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('d2', 'g-quarantined', 'starvation_event', 'hive-a', 0.9, true),
    forecast('h1', 'g1', 'recovery', 'hive-a', 0.9, true)
  ];
  const batch = composer.composeBatch(forecasts, { quarantinedGenerationIds: new Set(['g-quarantined']), generationId: 'g1' });
  assert.equal(batch.darkness.length, 1, 'the quarantined-generation forecast must never enter the batch');
  assert.equal(batch.darkness[0].generation_id, 'g1');
});

test('composeBatch: the darkness batch cap bounds composed output without touching underlying evidence count', () => {
  const forecasts = Array.from({ length: 20 }, (_, i) => forecast(`d${i}`, 'g1', 'patch_extinction', `tile-${i}`, 0.9, true))
    .concat(Array.from({ length: 20 }, (_, i) => forecast(`h${i}`, 'g1', 'recovery', `hive-${i}`, 0.9, true)));
  const batch = composer.composeBatch(forecasts, { darknessBatchCap: 5, generationId: 'g1' });
  assert.equal(batch.darkness.length, 5, 'darkness output is capped');
  // The cap never touches hope's own count nor the underlying forecast list itself.
  assert.equal(forecasts.filter((f) => f.target.metric === 'patch_extinction').length, 20, 'the underlying evidence set is untouched by the output cap');
});

test('composeBatch: the per-run ratio choice and its rationale are present in the returned ratioRecord (asserted, not silent)', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('h1', 'g1', 'recovery', 'hive-a', 0.9, true)
  ];
  const batch = composer.composeBatch(forecasts, { rationale: 'test rationale for this run', generationId: 'g1' });
  assert.ok(batch.ratioRecord, 'a ratioRecord must be returned for the caller to persist to the vault');
  assert.equal(batch.ratioRecord.entry_type, 'dream');
  assert.equal(batch.ratioRecord.text_or_data.rationale, 'test rationale for this run');
  assert.equal(batch.ratioRecord.text_or_data.ratio_choice, '1:1');
  assert.equal(batch.ratioRecord.generation_id, 'g1');
});

test('buildRatioRecord throws without a rationale -- the ratio choice is never a silent default', () => {
  assert.throws(() => composer.buildRatioRecord(composer.VALENCE_RATIO_DEFAULT, '', 'g1'), /rationale/);
});

// --- determinism: same inputs -> identical output, no rng, no wall clock ---

test('determinism: evaluateTriggers over identical inputs produces byte-identical results across repeated calls', () => {
  const calibrationState = calibrationStateWithAuthority('darkness', 0.6);
  const input = {
    hiveId: 'hive-a',
    tick: 100,
    extinctionEvents: [{ metric: 'patch_extinction', subject: 'tile-1', tick: 100 }],
    recentActivity: [{ hive_id: 'hive-a', patch_id: 'tile-1', tick: 95, action: 'gather-food' }],
    starvationEvents: [
      { metric: 'starvation_event', subject: 'hive-a', tick: 90 },
      { metric: 'starvation_event', subject: 'hive-a', tick: 95 },
      { metric: 'starvation_event', subject: 'hive-a', tick: 99 }
    ],
    sustainedSurvivalEvents: [],
    isCurrentlyRelevant: () => true,
    calibrationState
  };
  const runA = composer.evaluateTriggers({ ...input, cooldownState: composer.createCooldownState() });
  const runB = composer.evaluateTriggers({ ...input, cooldownState: composer.createCooldownState() });
  assert.deepEqual(runA, runB);
});

test('determinism: composeBatch over identical inputs produces byte-identical output across repeated calls', () => {
  const forecasts = [
    forecast('d1', 'g1', 'patch_extinction', 'tile-1', 0.9, true),
    forecast('d2', 'g1', 'starvation_event', 'hive-a', 0.9, true),
    forecast('h1', 'g1', 'recovery', 'hive-a', 0.9, true),
    forecast('h2', 'g1', 'sustained_survival', 'hive-b', 0.9, false)
  ];
  const opts = { generationId: 'g1', rationale: 'determinism check' };
  const runA = composer.composeBatch(forecasts, opts);
  const runB = composer.composeBatch(forecasts, opts);
  assert.deepEqual(runA, runB);
});

// --- risk-sensitivity tracking (plan S3, feeding S5's diagnostics) ---

test('risk-sensitivity tracking accumulates darkness/hope fractions per hive, deterministically', () => {
  const riskState = composer.createRiskSensitivityState();
  composer.recordDreamDelivered(riskState, 'hive-a', 'darkness');
  composer.recordDreamDelivered(riskState, 'hive-a', 'darkness');
  composer.recordDreamDelivered(riskState, 'hive-a', 'hope');
  const signal = composer.riskSensitivitySignal(riskState, 'hive-a');
  assert.equal(signal.total, 3);
  assert.ok(Math.abs(signal.darkness_fraction - 2 / 3) < 1e-9);
});

test('risk-sensitivity signal is null for a hive with no recorded dreams yet', () => {
  const riskState = composer.createRiskSensitivityState();
  assert.equal(composer.riskSensitivitySignal(riskState, 'hive-never-dreamed'), null);
});
