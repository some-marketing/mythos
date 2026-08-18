'use strict';

// Coverage for tools/ant-hive-world/dream/dream-lane.js -- plan
// world-mind-dream-communication, S4. AC14's four fixture arms
// (causality, fresh-key-fresh-state, cold-start-on-resume, same-path
// collision), the default-off no-op guarantee, and the action/relevance
// translation dream-lane.js owns per the S4 dispatch.
//
// dream-lane.js's registry is per-process module state -- each test uses a
// fresh, unique worldStatePath so tests never collide with each other's
// registrations (the collision tests below deregister explicitly, or use
// their own dedicated path).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dreamLane = require('../dream/dream-lane.js');
const calibration = require('../dream/calibration.js');
const dreamMemory = require('../dream/dream-memory.js');
const dreamComposer = require('../dream/dream-composer.js');

// S4b (integration pass) gave checkTriggers()/recordTickOutcome() real
// filesystem side effects when enabled -- vault appendEntry() calls and an
// evidence-file append, both defaulting to the REAL, shared paths
// (dream-lane.js's DEFAULT_VAULT_PATH, and a sandboxRoot derived from
// worldStatePath) when no override is registered first. Every test below
// that exercises the enabled path pre-registers with a SCRATCH vault/
// sandbox (via freshPath()) so this suite never touches the real, durable
// vault file or writes evidence files outside its own tmp directory.
let pathCounter = 0;
const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-lane-test-'));

// Raw, UNREGISTERED path -- only for tests that specifically exercise
// lazy-registration semantics themselves (registered vs. not-yet-registered
// is the fact under test). Using this for an ENABLED checkTriggers()/
// recordTickOutcome() call would fall back to the REAL default vault path.
function freshUnregisteredPath() {
  pathCounter += 1;
  return `/fixture/sandbox-${pathCounter}/shared/world-state.json`;
}

// Pre-registered with a scratch vault + sandbox -- the normal helper for
// every trigger/causality-logic test in this file.
function freshPath() {
  const p = freshUnregisteredPath();
  dreamLane.registerRun(p, {
    vaultPath: path.join(SCRATCH_ROOT, `vault-${pathCounter}.jsonl`),
    sandboxRoot: path.join(SCRATCH_ROOT, `sandbox-${pathCounter}`)
  });
  return p;
}

test('default-off: checkTriggers is a complete no-op (zero vector, no registration) when dream_lane_enabled is absent', () => {
  const p = freshUnregisteredPath();
  const result = dreamLane.checkTriggers(p, 'hive-a', 100, {}, { hive_state: { stockpile: { food: 5 } } });
  assert.deepEqual(result.dreamFeatures, new Array(9).fill(0));
  assert.equal(result.signal, null);
  assert.equal(dreamLane.getRunState(p), null, 'a disabled lane must never register the path');
});

test('default-off: checkTriggers is a no-op when dream_lane_enabled is explicitly false', () => {
  const p = freshUnregisteredPath();
  const result = dreamLane.checkTriggers(p, 'hive-a', 100, { dream_lane_enabled: false }, {});
  assert.deepEqual(result.dreamFeatures, new Array(9).fill(0));
  assert.equal(dreamLane.getRunState(p), null);
});

test('default-off: recordTickOutcome is a no-op when disabled -- no history accumulates', () => {
  const p = freshUnregisteredPath();
  const result = dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig: {} });
  assert.deepEqual(result, { recorded: false });
  assert.equal(dreamLane.getRunState(p), null);
});

test('checkTriggers auto-registers the path lazily on first enabled use (default vault/sandbox, since none was pre-registered)', () => {
  const p = freshUnregisteredPath();
  assert.equal(dreamLane.getRunState(p), null);
  dreamLane.checkTriggers(p, 'hive-a', 0, { dream_lane_enabled: true }, {});
  assert.notEqual(dreamLane.getRunState(p), null, 'the first enabled call must register the path');
  assert.equal(dreamLane.getRunState(p).vaultPath, dreamLane.DEFAULT_VAULT_PATH, 'lazy registration with no override falls back to the real default vault path');
  dreamLane.deregisterRun(p);
});

test('recordTickOutcome accumulates history that a later checkTriggers call reads', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  // PRODUCTION-VALID sequence (S4b trend-gate r2): a starvation crossing
  // (starved: true) always carries stockpile 0 -- applyUpkeep()'s own
  // definition of `starved` forces this, and consecutive starved:true
  // ticks with no recovery between them are impossible (once at 0, the
  // hive can't "cross" to 0 again until it recovers above 0 first). Two
  // crossings, each preceded by a recovery tick, with a DECLINING recovery
  // peak (5 -> 3) so the trend gate also passes.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 5 });
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 1, peak=5
  dreamLane.recordTickOutcome(p, 'hive-a', 3, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 3 });
  dreamLane.recordTickOutcome(p, 'hive-a', 4, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 2, peak=3 (<=5)
  const result = dreamLane.checkTriggers(p, 'hive-a', 5, liveConfig, { hive_state: { stockpile: { food: 0 } } });
  assert.equal(result.signal.trigger_class, 'repeating-starvation');
  assert.equal(result.signal.lane, 'darkness');
  dreamLane.deregisterRun(p);
});

test('checkTriggers translates a gather-food action into recentActivity for trigger 1', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  // Round 1: hive-a gathers food from tile-1.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, {
    starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } },
    action: { verb: 'gather', resourceKey: 'food', tileId: 'tile-1' }, liveConfig
  });
  // Round 2: tile-1 is gone (extinction), close enough (1 tick) to be within the proximity window.
  const result = dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, { hive_state: { stockpile: { food: 5 } } });
  dreamLane.recordTickOutcome(p, 'hive-a', 2, {
    starved: false, worldStateSnapshot: { food_sources: {} },
    action: { verb: 'idle' }, liveConfig
  });
  const result2 = dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, { hive_state: { stockpile: { food: 5 } } });
  assert.equal(result2.signal.trigger_class, 'patch-death-near-activity');
  assert.equal(result2.signal.lane, 'darkness');
  dreamLane.deregisterRun(p);
});

test('checkTriggers does NOT fire trigger 1 for a non-gather activity near a dead patch (translation preserves the MAJOR fix)', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, {
    starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } },
    action: { verb: 'idle' }, liveConfig // idle, not gather -- must not translate to gather-food
  });
  dreamLane.recordTickOutcome(p, 'hive-a', 2, {
    starved: false, worldStateSnapshot: { food_sources: {} },
    action: { verb: 'idle' }, liveConfig
  });
  const result = dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, { hive_state: { stockpile: { food: 5 } } });
  assert.notEqual(result.signal && result.signal.trigger_class, 'patch-death-near-activity');
  dreamLane.deregisterRun(p);
});

test('checkTriggers builds the current-state relevance predicate from the hive state it is given (FOOD_STRESS_THRESHOLD)', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  // Build sustained-survival history: 20 ticks, zero starvation for hive-a.
  for (let t = 1; t <= 20; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  }
  // Hive currently well-fed (food=10, above FOOD_STRESS_THRESHOLD=2) -- not relevant right now.
  const notRelevant = dreamLane.checkTriggers(p, 'hive-a', 21, liveConfig, { hive_state: { stockpile: { food: 10 } } });
  assert.notEqual(notRelevant.signal && notRelevant.signal.trigger_class, 'verified-reachable-hope');

  // Hive currently food-stressed (food=1, at or below the threshold) -- relevant.
  const relevant = dreamLane.checkTriggers(p, 'hive-a', 21, liveConfig, { hive_state: { stockpile: { food: 1 } } });
  assert.equal(relevant.signal.trigger_class, 'verified-reachable-hope');
  assert.equal(relevant.signal.lane, 'hope');
  dreamLane.deregisterRun(p);
});

test('dreamSignalToFeatures shapes a fired signal into the 9-slot dream-feature block', () => {
  const signal = { lane: 'darkness', targeted_verb: 'gather-food', forecast_authority: 0.75 };
  const features = dreamLane.dreamSignalToFeatures(signal);
  assert.equal(features.length, 9);
  assert.equal(features[0], 1, 'dream_present');
  assert.equal(features[1], 1, 'lane_darkness');
  assert.equal(features[2], 0, 'lane_hope');
  assert.deepEqual(features.slice(3, 8), [1, 0, 0, 0, 0], 'targeted_verb_onehot, gather-food is index 0');
  assert.equal(features[8], 0.75, 'forecast_authority');
});

test('dreamSignalToFeatures returns the zero vector for a null signal (no dream this tick)', () => {
  assert.deepEqual(dreamLane.dreamSignalToFeatures(null), new Array(9).fill(0));
});

test('dreamSignalToFeatures: a hope signal (targeted_verb null) produces an all-zero verb one-hot', () => {
  const signal = { lane: 'hope', targeted_verb: null, forecast_authority: 0.6 };
  const features = dreamLane.dreamSignalToFeatures(signal);
  assert.deepEqual(features.slice(3, 8), [0, 0, 0, 0, 0]);
  assert.equal(features[2], 1, 'lane_hope');
});

test('dreamSignalToFeatures: S5 re-trial fold -- a "mixed" (cross-lane merged) signal sets BOTH lane flags, never neither', () => {
  const signal = { lane: 'mixed', targeted_verb: 'gather-food', forecast_authority: 0.5 };
  const features = dreamLane.dreamSignalToFeatures(signal);
  assert.equal(features[0], 1, 'dream_present');
  assert.equal(features[1], 1, 'lane_darkness -- a mixed delivery genuinely carries a darkness-lane source');
  assert.equal(features[2], 1, 'lane_hope -- a mixed delivery genuinely carries a hope-lane source too');
});

test('actionToVerbOrderString translates decide()\'s gather+resourceKey shape correctly', () => {
  assert.equal(dreamLane.actionToVerbOrderString({ verb: 'gather', resourceKey: 'food' }), 'gather-food');
  assert.equal(dreamLane.actionToVerbOrderString({ verb: 'gather', resourceKey: 'wood' }), 'gather-wood');
  assert.equal(dreamLane.actionToVerbOrderString({ verb: 'idle' }), 'idle');
  assert.equal(dreamLane.actionToVerbOrderString({ verb: 'build' }), 'build');
  assert.equal(dreamLane.actionToVerbOrderString(null), null);
});

// --- AC14(a): CAUSALITY -- tick-N features are fixed before tick-N outcomes exist ---

test('AC14(a) CAUSALITY: tick-N dreamFeatures are unaffected by what tick-N\'s own outcome turns out to be', () => {
  const liveConfig = { dream_lane_enabled: true };

  // Two parallel histories, identical through tick 19 (both build the same
  // sustained-survival evidence for hive-a).
  function buildHistory(worldStatePath) {
    for (let t = 1; t <= 19; t += 1) {
      dreamLane.recordTickOutcome(worldStatePath, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    }
  }

  const pathA = freshPath();
  const pathB = freshPath();
  buildHistory(pathA);
  buildHistory(pathB);

  // Compute tick 20's features on BOTH paths BEFORE either path's tick-20
  // outcome is recorded -- this is the actual causality proof: the compute
  // step for tick 20 cannot see tick 20's own outcome because nothing has
  // appended it yet, on EITHER path, regardless of what happens next.
  const hiveState = { hive_state: { stockpile: { food: 1 } } };
  const featuresA = dreamLane.checkTriggers(pathA, 'hive-a', 20, liveConfig, hiveState).dreamFeatures;
  const featuresB = dreamLane.checkTriggers(pathB, 'hive-a', 20, liveConfig, hiveState).dreamFeatures;
  assert.deepEqual(featuresA, featuresB, 'identical history through tick 19 must produce identical tick-20 features');

  // NOW diverge tick 20's own outcome on each path -- one starves, one
  // doesn't. This must never have been able to influence the ALREADY-
  // COMPUTED tick-20 features above (they were fixed before this ran).
  dreamLane.recordTickOutcome(pathA, 'hive-a', 20, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.recordTickOutcome(pathB, 'hive-a', 20, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });

  // Re-assert the ALREADY-COMPUTED tick-20 values are untouched by the
  // divergent outcome recorded afterward (they are plain local values by
  // this point, so this is really asserting they were never mutated).
  assert.deepEqual(featuresA, featuresB);

  dreamLane.deregisterRun(pathA);
  dreamLane.deregisterRun(pathB);
});

// REGRESSION (codex fold review, MAJOR fix): the exact cross-hive same-tick
// lookahead scenario codex reproduced. run-live.js processes hive-a and
// hive-b SEQUENTIALLY within one round -- hive-a's full COMPUTE+UPDATE runs
// to completion, THEN hive-b's COMPUTE+UPDATE runs, both for the SAME tick
// index. Before the pending-buffer fix, hive-a's UPDATE landed straight in
// visible history, so hive-b's SAME-TICK COMPUTE could see it (codex's
// concrete repro: a null trigger flipping to repeating-starvation purely
// from intra-tick hive ordering, never from an actual N-1-or-earlier fact).
// NOTE: fixture uses the REVISED trigger-2 default (2 crossings in a
// 40-tick window, S4b closeout item 4a) -- 1 pre-existing (flushed) event is
// "one short," and the SAME-TICK second event is what would complete the
// threshold if hive-b's compute could see it.
test('REGRESSION: hive-b\'s tick-N COMPUTE must NOT see hive-a\'s tick-N outcome, recorded moments earlier on the SAME path', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };

  // Build 1 starvation event for hive-a at tick 1 (one short of the
  // 2-event threshold) -- deliberately NOT yet enough to fire on its own.
  // PRODUCTION-VALID stockpile (S4b trend-gate r2): every starved:true row
  // carries stockpile 0 (applyUpkeep()'s own invariant); with no recovery
  // row between these two crossings, recovery_peak is 0 for both -- still
  // non-increasing (0 <= 0), so the trend gate passes trivially. This test
  // is about cross-hive same-tick visibility, not trend direction.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // flushes tick 1 -- 1 starvation event now visible, below threshold=2

  // Round for tick 2: hive-a's own outcome is a SECOND starvation event --
  // this WOULD satisfy the threshold if hive-b's compute could see it. It
  // must not, because it is the SAME tick as hive-b's own compute below.
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 });

  // Same tick (2), a DIFFERENT hive's compute step -- this is codex's exact
  // scenario. hive-a's tick-2 outcome (recorded moments earlier, same tick,
  // same path) must be invisible here.
  const hiveBResult = dreamLane.checkTriggers(p, 'hive-b', 2, liveConfig, {});
  assert.notEqual(hiveBResult.signal && hiveBResult.signal.trigger_class, 'repeating-starvation', 'hive-b must not see hive-a\'s same-tick outcome');

  // hive-a's OWN next compute, tick 3 -- now the tick-2 outcome (both of
  // hive-a's own starvation events) is legitimately visible, since tick 3
  // is strictly later than tick 2.
  const hiveANextTick = dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  assert.equal(hiveANextTick.signal.trigger_class, 'repeating-starvation', 'tick 3 must see both of hive-a\'s own outcomes through tick 2');

  dreamLane.deregisterRun(p);
});

test('AC14(a) CAUSALITY, cross-hive arm: two hives\' same-tick COMPUTE calls see IDENTICAL history, regardless of intra-tick call order', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };

  for (let t = 1; t <= 5; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    dreamLane.recordTickOutcome(p, 'hive-b', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    dreamLane.checkTriggers(p, 'hive-a', t + 1, liveConfig, {}); // flush through tick t before the next round
  }

  // Tick 6: hive-a computes first, THEN records its own tick-6 outcome,
  // THEN hive-b computes -- hive-b's compute must see EXACTLY what hive-a's
  // compute saw (both read history through tick 5 only), never hive-a's
  // freshly-recorded tick-6 row.
  const featuresHiveAFirst = dreamLane.checkTriggers(p, 'hive-a', 6, liveConfig, {}).dreamFeatures;
  dreamLane.recordTickOutcome(p, 'hive-a', 6, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  const featuresHiveBSecond = dreamLane.checkTriggers(p, 'hive-b', 6, liveConfig, {}).dreamFeatures;
  assert.deepEqual(featuresHiveAFirst, featuresHiveBSecond, 'both hives\' tick-6 compute must read the identical (through-tick-5) history');

  dreamLane.deregisterRun(p);

  // MIRRORED ARM (codex re-verify, residual MAJOR): the first arm above only
  // ever exercises hive-a-computing-first. Prove the claim actually holds
  // for BOTH intra-tick orders, not just the one order this test happened to
  // pick -- an identical fixture, hive-b computes first this time, then
  // hive-a, then a three-way equality against the FIRST arm's own values
  // (proving order-independence, not merely self-consistency within one
  // order).
  const p2 = freshPath();
  for (let t = 1; t <= 5; t += 1) {
    dreamLane.recordTickOutcome(p2, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    dreamLane.recordTickOutcome(p2, 'hive-b', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    dreamLane.checkTriggers(p2, 'hive-a', t + 1, liveConfig, {}); // flush through tick t before the next round
  }

  // Tick 6, MIRRORED: hive-b computes first, THEN records its own tick-6
  // outcome, THEN hive-a computes.
  const featuresHiveBFirst = dreamLane.checkTriggers(p2, 'hive-b', 6, liveConfig, {}).dreamFeatures;
  dreamLane.recordTickOutcome(p2, 'hive-b', 6, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  const featuresHiveASecond = dreamLane.checkTriggers(p2, 'hive-a', 6, liveConfig, {}).dreamFeatures;

  // THREE-WAY EQUALITY: both orders, on both fixtures, produce the SAME
  // dreamFeatures -- the claim the test's own title makes, actually proven.
  assert.deepEqual(featuresHiveBFirst, featuresHiveASecond, 'mirrored order: both hives\' tick-6 compute must also read identical history');
  assert.deepEqual(featuresHiveAFirst, featuresHiveBFirst, 'the A-first run\'s values must equal the B-first run\'s values -- proving call-order independence, not just per-order self-consistency');

  dreamLane.deregisterRun(p2);
});

// --- AC14(b): FRESH KEY = FRESH STATE ---

test('AC14(b) FRESH KEY = FRESH STATE: two different worldStatePath keys never share history', () => {
  const liveConfig = { dream_lane_enabled: true };
  const pathWithHistory = freshPath();
  const freshKeyPath = freshPath();

  // Build a trigger-2-satisfying history on pathWithHistory only.
  // PRODUCTION-VALID stockpile (S4b trend-gate r2): every starved:true row
  // carries stockpile 0 -- with no recovery rows between crossings,
  // recovery_peak is 0 for each, which is non-increasing (0 <= 0) and
  // passes the trend gate trivially. This test is about registry key
  // isolation, not trend direction.
  for (let t = 1; t <= 3; t += 1) {
    dreamLane.recordTickOutcome(pathWithHistory, 'hive-a', t, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 });
  }
  const fired = dreamLane.checkTriggers(pathWithHistory, 'hive-a', 4, liveConfig, {});
  assert.equal(fired.signal.trigger_class, 'repeating-starvation');

  // Identical tick index, identical hive, but a FRESH key -- must have empty history.
  const notFired = dreamLane.checkTriggers(freshKeyPath, 'hive-a', 4, liveConfig, {});
  assert.equal(notFired.signal, null, 'a fresh worldStatePath key must never see another key\'s accumulated history');

  dreamLane.deregisterRun(pathWithHistory);
  dreamLane.deregisterRun(freshKeyPath);
});

// --- AC14(c): COLD-START ON RESUME ---

test('AC14(c) COLD-START ON RESUME: a fresh registration for the same worldStatePath after deregistration starts with empty history', () => {
  const liveConfig = { dream_lane_enabled: true };
  const p = freshPath();

  // PRODUCTION-VALID stockpile (S4b trend-gate r2): see the FRESH-KEY test
  // above -- stockpile 0 on every crossing, no recovery rows between them,
  // recovery_peak 0 each, trend gate passes trivially (0 <= 0).
  for (let t = 1; t <= 3; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 });
  }
  const beforeResume = dreamLane.checkTriggers(p, 'hive-a', 4, liveConfig, {});
  assert.equal(beforeResume.signal.trigger_class, 'repeating-starvation');
  assert.equal(beforeResume.coldStart, false, 'history is no longer cold once outcomes have been recorded');

  // Simulate the process ending and a resumed run reusing the SAME
  // worldStatePath -- deregisterRun() is the process-death/normal-
  // completion equivalent (a fresh process would get an empty Map
  // automatically; deregistration is the explicit, testable equivalent).
  dreamLane.deregisterRun(p);

  // Same identical mechanical condition (3 starvation events, tick 4) does
  // NOT fire post-resume: history starts empty, cold start.
  const afterResume = dreamLane.checkTriggers(p, 'hive-a', 4, liveConfig, {});
  assert.equal(afterResume.signal, null, 'a resumed run must start with empty in-memory trigger history');
  assert.equal(afterResume.coldStart, true, 'the fresh registration must be recorded as a cold start');

  dreamLane.deregisterRun(p);
});

test('AC14(c) companion: durable S1/S2 evidence (calibration state) is unaffected across the same resume boundary -- only trigger-detection history resets', () => {
  const calibration = require('../dream/calibration.js');
  const liveConfig = { dream_lane_enabled: true };
  const p = freshPath();

  dreamLane.checkTriggers(p, 'hive-a', 1, liveConfig, {}); // registers the path
  const state = dreamLane.getRunState(p);
  // Simulate durable calibration evidence already resolved (would, in a
  // real run, come from S1's vault -- this fixture asserts the SCOPE of the
  // resume reset, not S1's own persistence, which is out of this module's
  // hands entirely).
  calibration.recordResolvedForecast(state.calibrationState, 'f1', 'darkness', 0.9, true);
  calibration.recordResolvedForecast(state.calibrationState, 'f2', 'darkness', 0.9, true);
  calibration.recordResolvedForecast(state.calibrationState, 'f3', 'darkness', 0.9, true);
  calibration.recordResolvedForecast(state.calibrationState, 'f4', 'darkness', 0.9, true);
  calibration.recordResolvedForecast(state.calibrationState, 'f5', 'darkness', 0.9, true);
  const authorityBeforeResume = calibration.authority(state.calibrationState, 'darkness');
  assert.notEqual(authorityBeforeResume, 0.5, 'the fixture calibration state must actually be non-neutral to prove anything');

  // A resumed run gets a FRESH calibrationState (in-memory trigger-
  // detection state resets, per the plan) -- this module's own calibration
  // bookkeeping is NOT the durable S1/S2 vault; a real integrator sources
  // durable authority from the vault, not from this ephemeral singleton.
  // This fixture documents that scope boundary explicitly.
  dreamLane.deregisterRun(p);
  dreamLane.checkTriggers(p, 'hive-a', 1, liveConfig, {});
  const freshState = dreamLane.getRunState(p);
  assert.equal(calibration.authority(freshState.calibrationState, 'darkness'), 0.5, 'a fresh registration starts with the neutral prior -- the reset is scoped to in-memory state only, never claimed to be the durable evidence record');

  dreamLane.deregisterRun(p);
});

// --- AC14(d): SAME-PATH COLLISION ---

test('AC14(d) SAME-PATH COLLISION: a second registerRun() for an active path throws DREAM-LANE-PATH-COLLISION', () => {
  const p = freshUnregisteredPath();
  dreamLane.registerRun(p);
  assert.throws(
    () => dreamLane.registerRun(p),
    (err) => err instanceof dreamLane.DreamLanePathCollisionError && err.code === 'DREAM-LANE-PATH-COLLISION' && err.worldStatePath === p
  );
  dreamLane.deregisterRun(p);
});

test('AC14(d) companion: two runs\' histories never interleave -- each run\'s recorded history contains only its own outcomes', () => {
  const liveConfig = { dream_lane_enabled: true };
  const pathX = freshUnregisteredPath();
  const pathY = freshUnregisteredPath();

  dreamLane.registerRun(pathX);
  dreamLane.registerRun(pathY); // a DIFFERENT path -- not a collision

  dreamLane.recordTickOutcome(pathX, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.recordTickOutcome(pathY, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });

  // Each recordTickOutcome() call lands in its own state's PENDING buffer
  // until a strictly-later tick flushes it (the cross-hive lookahead fix,
  // codex fold review) -- inspect the combined pending+flushed view here,
  // since this test's purpose is proving no CROSS-PATH interleaving, not
  // exercising the flush timing (covered by its own tests above).
  const stateX = dreamLane.getRunState(pathX);
  const stateY = dreamLane.getRunState(pathY);
  const rowsX = [...stateX.runLogRows, ...stateX.pendingRunLogRows];
  const rowsY = [...stateY.runLogRows, ...stateY.pendingRunLogRows];
  assert.equal(rowsX.length, 1);
  assert.equal(rowsY.length, 1);
  assert.equal(rowsX[0].starved, true, 'pathX\'s own outcome only');
  assert.equal(rowsY[0].starved, false, 'pathY\'s own outcome only');

  dreamLane.deregisterRun(pathX);
  dreamLane.deregisterRun(pathY);
});

test('AC14(d) companion: process-death recovery -- a fresh registration for the SAME path after a simulated crash (no deregistration call made) succeeds cleanly once actually deregistered', () => {
  // This module cannot simulate an actual process crash (a real crash would
  // just drop the whole in-memory Map by construction -- see the module
  // header). What IS testable in-process is the equivalent: registering,
  // then modeling "the process died without calling deregisterRun" as an
  // explicit deregistration standing in for the fresh-process empty-Map
  // guarantee, then proving the SAME path registers cleanly afterward with
  // fresh, empty history -- exactly the state a brand-new process's empty
  // registry would produce.
  const p = freshUnregisteredPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.registerRun(p);
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });

  // The "crash": no deregisterRun() call was made by the dead process's own
  // completion path -- but a fresh process's registry is fresh BY
  // CONSTRUCTION (a new require() gets a new module-level Map), which this
  // in-process test cannot literally reproduce (same module instance). The
  // deregistration call here stands in for "a fresh process's Map never had
  // this entry to begin with" -- the OBSERVABLE result (fresh, empty state
  // for this path) is identical either way.
  dreamLane.deregisterRun(p);

  const freshState = dreamLane.registerRun(p);
  assert.deepEqual(freshState.runLogRows, [], 'a fresh registration must never inherit the dead run\'s history');
  assert.equal(freshState.coldStart, true);

  dreamLane.deregisterRun(p);
});

// ============================================================================
// S4b INTEGRATION PASS (closeout items 1-4): forecast issuance, live
// authority movement, vault population, evidence-file shape, and the stock-
// run zero-activity guarantee extended to the new surfaces.
// ============================================================================

// --- RULE A: patch decline -> patch_extinction forecast ---

test('RULE A issues a patch_extinction forecast when a patch\'s level strictly decreases across 3 flushed snapshots', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 10 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // flush tick 1
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 7 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {}); // flush tick 2
  dreamLane.recordTickOutcome(p, 'hive-a', 3, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 4 } }, action: { verb: 'idle' }, liveConfig });
  const result = dreamLane.checkTriggers(p, 'hive-a', 4, liveConfig, {}); // flush tick 3 -- 3 snapshots now: 10,7,4, strictly decreasing

  assert.equal(result.issuedForecasts.length, 1);
  const forecast = result.issuedForecasts[0];
  assert.equal(forecast.target.metric, 'patch_extinction');
  assert.equal(forecast.target.subject, 'tile-1');
  assert.ok(Math.abs(forecast.predicted_p - 0.6) < 1e-9, `expected predicted_p=0.6 (relative decline (10-4)/10), got ${forecast.predicted_p}`);

  dreamLane.deregisterRun(p);
});

test('RULE A does NOT issue a forecast when the patch level is not strictly decreasing', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 10 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 7 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 3, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 8 } }, action: { verb: 'idle' }, liveConfig }); // ticked UP, not down
  const result = dreamLane.checkTriggers(p, 'hive-a', 4, liveConfig, {});

  assert.equal(result.issuedForecasts.filter((f) => f.target.metric === 'patch_extinction').length, 0);
  dreamLane.deregisterRun(p);
});

test('RULE A does NOT issue a forecast for a patch that has already gone extinct (a consequence, not a forecast target)', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 10 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 3, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig }); // tile-1 is GONE
  const result = dreamLane.checkTriggers(p, 'hive-a', 4, liveConfig, {});

  assert.equal(result.issuedForecasts.filter((f) => f.target.subject === 'tile-1').length, 0, 'an already-extinct patch is a consequence, not a forecast target');
  dreamLane.deregisterRun(p);
});

// --- RULE B: starvation precursor -> starvation_event forecast ---

test('RULE B issues a starvation_event forecast after 1 starvation crossing (the precursor count)', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  const result = dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // flushes tick 1 -- 1 crossing visible

  const forecast = result.issuedForecasts.find((f) => f.target.metric === 'starvation_event');
  assert.ok(forecast, 'a starvation_event precursor forecast must be issued after 1 crossing');
  assert.equal(forecast.target.subject, 'hive-a');
  assert.ok(Math.abs(forecast.predicted_p - 0.45) < 1e-9, `expected predicted_p=0.45 (0.3 + 0.15*1), got ${forecast.predicted_p}`);

  dreamLane.deregisterRun(p);
});

test('RULE B does NOT issue a second starvation_event forecast for the same hive while one is still open', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  const first = dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});
  assert.equal(first.issuedForecasts.filter((f) => f.target.metric === 'starvation_event').length, 1);

  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  const second = dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  assert.equal(second.issuedForecasts.filter((f) => f.target.metric === 'starvation_event').length, 0, 'a second forecast for the same (metric, subject) must not be issued while the first is unresolved');

  dreamLane.deregisterRun(p);
});

// --- RULE C: recovery streak -> sustained_survival forecast ---

test('RULE C issues a sustained_survival forecast exactly when a post-starvation streak first reaches the recovery length, edge-triggered', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // flush tick 1

  let lastResult = null;
  for (let t = 2; t <= 6; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    lastResult = dreamLane.checkTriggers(p, 'hive-a', t + 1, liveConfig, {}); // flush tick t
  }
  // After flushing tick 6, the streak [2,3,4,5,6] = 5 non-starved rows exactly reaches FORECAST_RECOVERY_STREAK.
  const recoveryForecasts = lastResult.issuedForecasts.filter((f) => f.target.metric === 'sustained_survival');
  assert.equal(recoveryForecasts.length, 1, 'exactly one sustained_survival forecast must be issued the tick the streak first qualifies');
  assert.equal(recoveryForecasts[0].target.subject, 'hive-a');
  assert.ok(Math.abs(recoveryForecasts[0].predicted_p - 0.75) < 1e-9, `expected predicted_p=0.75 (0.5 + 0.05*5), got ${recoveryForecasts[0].predicted_p}`);

  dreamLane.deregisterRun(p);
});

test('RULE C does NOT issue when there has been no prior starvation to recover from', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  let lastResult = null;
  for (let t = 1; t <= 6; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
    lastResult = dreamLane.checkTriggers(p, 'hive-a', t + 1, liveConfig, {});
  }
  assert.equal(lastResult.issuedForecasts.filter((f) => f.target.metric === 'sustained_survival').length, 0, 'a "recovery" needs a prior starvation to recover from');
  dreamLane.deregisterRun(p);
});

// --- live authority movement ---

test('live authority movement: confidently-wrong forecasts lower authority within a run fixture', () => {
  const p = freshPath();
  const state = dreamLane.getRunState(p); // already registered by freshPath()
  for (let i = 0; i < 5; i += 1) {
    state.openForecasts.push({
      forecast_id: `test-forecast-${i}`,
      generation_id: p,
      tick_issued: 0,
      target: { metric: 'starvation_event', subject: 'hive-a', horizon_ticks: 10 },
      predicted_p: 0.9
    });
  }
  const authorityBefore = calibration.authority(state.calibrationState, 'darkness');
  assert.equal(authorityBefore, 0.5, 'neutral prior before any resolution (fewer than 5 resolved)');

  // Resolve at tick 20 (> horizon 10) with NO starvation evidence at all --
  // every confidently-high (0.9) prediction resolves to a MISS.
  const resolved = dreamLane.resolveOpenForecasts(state, 20, { extinctionEvents: [], starvationEvents: [] });
  assert.equal(resolved.length, 5);
  assert.ok(resolved.every((f) => f.outcome === false), 'sanity: every seeded forecast must resolve MISS given zero starvation evidence');

  const authorityAfter = calibration.authority(state.calibrationState, 'darkness');
  assert.ok(authorityAfter < authorityBefore, `authority must drop after confidently-wrong forecasts resolve -- before=${authorityBefore}, after=${authorityAfter}`);
  assert.ok(authorityAfter < 0.5);

  dreamLane.deregisterRun(p);
});

// --- vault population on trigger fire ---

test('vault population: a fired trigger persists a composed dream entry AND a per-run ratioRecord to the vault', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  // PRODUCTION-VALID stockpile (S4b trend-gate r2): stockpile 0 on both
  // crossings (no recovery rows between them) -- recovery_peak 0 each,
  // non-increasing (0 <= 0), trend gate passes trivially.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 });
  const result = dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {}); // 2 crossings visible -- fires repeating-starvation
  assert.equal(result.signal.trigger_class, 'repeating-starvation');

  const entries = dreamMemory.materialize(state.vaultPath);
  const dreamEntries = entries.filter((e) => e.entry_type === 'dream' && e.text_or_data && e.text_or_data.trigger_class === 'repeating-starvation');
  assert.equal(dreamEntries.length, 1, 'the fired signal must compose and persist exactly one dream entry');
  assert.equal(dreamEntries[0].lane, 'darkness');
  assert.equal(dreamEntries[0].commit_status, 'pending', 'provisional generation_id entries never auto-commit (see module header)');

  const ratioEntries = entries.filter((e) => e.entry_type === 'dream' && e.text_or_data && e.text_or_data.ratio_choice);
  assert.equal(ratioEntries.length, 1, 'the per-run ratioRecord must be persisted exactly once');
  assert.equal(ratioEntries[0].text_or_data.ratio_choice, '1:1');

  dreamLane.deregisterRun(p);
});

test('vault population: forecast issuance and resolution both persist vault entries', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // issues a starvation_event forecast

  let entries = dreamMemory.materialize(state.vaultPath);
  const forecastEntries = entries.filter((e) => e.entry_type === 'forecast');
  assert.equal(forecastEntries.length, 1, 'an issued forecast must persist as a forecast entry');

  // Resolve it directly (fast-forward past the horizon) and confirm a
  // disclosure 'dream' entry appears.
  const resolved = dreamLane.resolveOpenForecasts(state, 100, { extinctionEvents: [], starvationEvents: [] });
  assert.equal(resolved.length, 1);
  const disclosureEntry = dreamComposer.composeForecastEntry(resolved[0]);
  dreamMemory.appendEntry(state.vaultPath, disclosureEntry);

  entries = dreamMemory.materialize(state.vaultPath);
  const disclosures = entries.filter((e) => e.entry_type === 'dream' && e.text_or_data && e.text_or_data.disclosure && e.text_or_data.disclosure !== 'live-perception');
  assert.ok(disclosures.length >= 1, 'a resolved forecast must be able to compose a retrospective disclosure entry');

  dreamLane.deregisterRun(p);
});

// --- evidence-file append-only shape ---

test('evidence file: one line per (tick, hive) COMPUTE call, append-only, JSON-parseable', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  dreamLane.checkTriggers(p, 'hive-a', 1, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-b', 1, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-b', 1, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } }, action: { verb: 'idle' }, liveConfig });

  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  const lines = fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2, 'one evidence line per COMPUTE call (hive-a, hive-b)');
  const rows = lines.map((l) => JSON.parse(l));
  assert.equal(rows[0].hive, 'hive-a');
  assert.equal(rows[0].tick, 1);
  assert.equal(rows[1].hive, 'hive-b');
  assert.ok('forecasts_issued' in rows[0] && 'forecasts_resolved' in rows[0] && 'dream_fired' in rows[0]);
  assert.ok('recent_activity' in rows[0], 'the evidence line must carry recent_activity (codex delta review MAJOR 3: closes the trigger-1 exact-join gap)');

  // Append-only: a further compute call only grows the file, never rewrites
  // the existing lines.
  const bytesBefore = fs.readFileSync(evidencePath);
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});
  const bytesAfter = fs.readFileSync(evidencePath);
  assert.ok(bytesAfter.length > bytesBefore.length);
  assert.deepEqual(bytesAfter.subarray(0, bytesBefore.length), bytesBefore, 'existing evidence bytes must never be rewritten');

  dreamLane.deregisterRun(p);
});

test('evidence file: recent_activity carries the exact per-hive gather-target history trigger 1 itself reads, closing the exact-join gap (codex delta review MAJOR 3)', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } }, action: { verb: 'gather', resourceKey: 'food', tileId: 'tile-1' }, liveConfig });
  const result = dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // flushes tick 1's activity into visible history

  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  const lines = fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tick2Line = lines.find((l) => l.tick === 2);
  assert.ok(Array.isArray(tick2Line.recent_activity));
  const entry = tick2Line.recent_activity.find((a) => a.hive_id === 'hive-a' && a.tick === 1);
  assert.ok(entry, 'tick 1\'s flushed gather activity must be present in tick 2\'s evidence line');
  assert.equal(entry.patch_id, 'tile-1', 'the EXACT patch_id the hive gathered from must be recoverable, not just "some activity happened"');
  assert.equal(entry.action, 'gather-food');
  // This is exactly the shape `recentActivity` trigger 1's own evaluator
  // consumes (dream-composer.js's evaluateTrigger1PatchDeathNearActivity) --
  // proving the evidence file's own recent_activity field is the SAME data,
  // not a re-derivation of it.
  assert.deepEqual(new Set(Object.keys(entry)), new Set(['hive_id', 'patch_id', 'tick', 'action']));

  dreamLane.deregisterRun(p);
});

// --- stock-run zero-activity, extended to the new S4b surfaces ---

test('stock run: disabled calls create NEITHER a vault file NOR an evidence file, even against a pre-registered scratch path', () => {
  const p = freshPath(); // pre-registers a scratch vault/sandbox
  const state = dreamLane.getRunState(p);
  const disabledConfig = {}; // dream_lane_enabled absent

  for (let t = 1; t <= 5; t += 1) {
    dreamLane.checkTriggers(p, 'hive-a', t, disabledConfig, { hive_state: { stockpile: { food: 5 } } });
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: true, worldStateSnapshot: { food_sources: { 'tile-1': 1 } }, action: { verb: 'idle' }, liveConfig: disabledConfig });
  }

  assert.equal(fs.existsSync(state.vaultPath), false, 'a disabled run must never create the vault file');
  assert.equal(fs.existsSync(path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl')), false, 'a disabled run must never create the evidence file');

  dreamLane.deregisterRun(p);
});

// --- S4b amendment (operator ratification 2026-08-13T16:46Z): doctrine
// seed always runs first, merge arbitration in the live tick path,
// finalizeRun for no-checkpoint runs ---

test('S4b-3: the doctrine seed (entry 0) always lands before any other entry, even on the trial path where nothing pre-seeds the vault', () => {
  const p = freshPath(); // pre-registers a scratch vault path -- but never calls seedVault itself
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);
  assert.equal(fs.existsSync(state.vaultPath), false, 'nothing has written to this vault yet');

  // First live write on this path: a forecast issuance, exactly the "trial
  // path" codex's CRITICAL 2 finding named ("a missing vault can also begin
  // with forecast entry 0 instead of the required doctrine seed").
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});

  const entries = dreamMemory.materialize(state.vaultPath);
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].entry_id, 0);
  assert.equal(entries[0].entry_type, 'doctrine', 'entry 0 must be the doctrine seed, never a forecast or dream entry');
  assert.equal(entries[0].text_or_data.text, dreamMemory.CONSOLIDATED_WORDING);

  dreamLane.deregisterRun(p);
});

test('S4b-2 MERGE, live tick path: two trigger classes clearing the same (hive, tick) compose into ONE delivered dream with both sources journaled, and both cooldowns consumed', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  // Tick 1: hive-a starves AND gathers from tile-1 (still present).
  // PRODUCTION-VALID stockpile (S4b trend-gate r2): stockpile 0 on both
  // crossings (no recovery rows between them) -- recovery_peak 0 each,
  // non-increasing (0 <= 0), trend gate passes trivially.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, {
    starved: true,
    worldStateSnapshot: { food_sources: { 'tile-1': 5 } },
    action: { verb: 'gather', resourceKey: 'food', tileId: 'tile-1' },
    liveConfig,
    stockpile: 0
  });
  // Tick 2: hive-a starves again (2nd crossing -> meets trigger 2's
  // threshold) AND tile-1 goes extinct (present at tick 1, gone at tick 2 --
  // meets trigger 1's condition, since hive-a gathered from it at tick 1,
  // within the 10-tick proximity window).
  dreamLane.recordTickOutcome(p, 'hive-a', 2, {
    starved: true,
    worldStateSnapshot: { food_sources: {} },
    action: { verb: 'idle' },
    liveConfig,
    stockpile: 0
  });

  // Tick 3's COMPUTE reads history flushed through tick 2 -- both trigger
  // classes' conditions are now met, and default (neutral 0.5) authority
  // clears the 0.3 gate for both.
  const result = dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  assert.ok(result.signal, 'a dream must have delivered');
  assert.equal(result.arbitration.mergedTriggerClasses.length, 2, 'both cleared trigger classes must merge into the one delivery');
  assert.deepEqual(
    result.arbitration.mergedTriggerClasses.sort(),
    ['patch-death-near-activity', 'repeating-starvation'].sort()
  );

  const entries = dreamMemory.materialize(state.vaultPath);
  const dreamEntries = entries.filter((e) => e.entry_type === 'dream' && e.text_or_data && e.text_or_data.disclosure === 'live-perception-merged');
  assert.equal(dreamEntries.length, 1, 'exactly ONE delivered dream entry, never one per source trigger');
  assert.equal(dreamEntries[0].text_or_data.sources.length, 2, 'both source triggers must be journaled on the delivery record');
  assert.deepEqual(dreamEntries[0].text_or_data.suppressed_triggers, [], 'neither class was suppressed here -- both cleared');

  // Both source classes must now be in cooldown (post-arbitration
  // consumption) -- a repeat evaluation at the same tick would be blocked.
  assert.equal(dreamComposer.cooldownElapsed(state.cooldownState, 'hive-a', 'patch-death-near-activity', 3), false);
  assert.equal(dreamComposer.cooldownElapsed(state.cooldownState, 'hive-a', 'repeating-starvation', 3), false);

  // The evidence-file line for this tick must name the merge and the
  // delivered entry's own identity.
  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  const lines = fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tick3Line = lines.find((l) => l.tick === 3);
  assert.ok(tick3Line.dream_fired, 'the evidence line for the delivering tick must record the delivery');
  assert.equal(typeof tick3Line.dream_fired.entry_id, 'number', 'the delivered dream\'s own vault entry_id must be recorded');
  assert.deepEqual(tick3Line.dream_fired.merged_trigger_classes.sort(), ['patch-death-near-activity', 'repeating-starvation'].sort());
  assert.equal(tick3Line.run_id, p);
  assert.equal(tick3Line.generation_id, p);

  dreamLane.deregisterRun(p);
});

test('S5 re-trial fold, live tick path: a genuine darkness+hope CROSS-LANE merge delivers lane:\'mixed\' end-to-end -- vault entry, dreamFeatures, and the evidence-file record all agree', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  // Build BOTH lanes' evidence simultaneously for hive-a:
  //   darkness (trigger 1): gather from tile-1 at tick 1, tile-1 goes
  //   extinct at tick 2 (present at tick 1, absent at tick 2) -- within the
  //   10-tick proximity window.
  //   hope (trigger 3): a clean, never-starved 20-row streak (ticks 1-20)
  //   satisfies classifySustainedSurvival's default 20-tick window,
  //   recorded well within RECENCY_WINDOW (100) of the eval tick.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, {
    starved: false, worldStateSnapshot: { food_sources: { 'tile-1': 5 } },
    action: { verb: 'gather', resourceKey: 'food', tileId: 'tile-1' }, liveConfig, stockpile: 1
  });
  for (let t = 2; t <= 21; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 1 });
  }

  // Eval at tick 22, currently food-stressed (stockpile.food <= FOOD_STRESS_THRESHOLD=2) -- satisfies trigger 3's isCurrentlyRelevant.
  const result = dreamLane.checkTriggers(p, 'hive-a', 22, liveConfig, { hive_state: { stockpile: { food: 1 } } });

  assert.ok(result.signal, 'a dream must have delivered');
  assert.deepEqual(
    result.arbitration.mergedTriggerClasses.sort(),
    ['patch-death-near-activity', 'verified-reachable-hope'].sort(),
    'sanity check: this fixture must genuinely clear one darkness AND one hope trigger together'
  );
  assert.equal(result.signal.lane, 'mixed', 'the delivered signal itself must carry lane:mixed, never null');

  // dreamFeatures: BOTH lane flags set (S5 re-trial fold's encoding fix).
  assert.equal(result.dreamFeatures[1], 1, 'lane_darkness flag must be set for a mixed delivery');
  assert.equal(result.dreamFeatures[2], 1, 'lane_hope flag must be set for a mixed delivery');

  // Vault entry: lane:'mixed', never null, and passes dream-memory.js's own LANES validation (already proven by not throwing here).
  const entries = dreamMemory.materialize(state.vaultPath);
  const dreamEntry = entries.find((e) => e.entry_type === 'dream' && e.text_or_data && e.text_or_data.disclosure === 'live-perception-merged');
  assert.ok(dreamEntry, 'the merged delivery must have persisted to the vault');
  assert.equal(dreamEntry.lane, 'mixed');

  // Evidence-file record: dream_fired.lane must also read 'mixed' -- this
  // is what ablation.cjs's delivery-correctness audit cross-checks a
  // run-log row's claimed 'mixed' lane against.
  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  const lines = fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tick22Line = lines.find((l) => l.tick === 22);
  assert.equal(tick22Line.dream_fired.lane, 'mixed');
  assert.equal(tick22Line.dream_fired.merged_trigger_classes.length, 2);

  dreamLane.deregisterRun(p);
});

test('S4b amendment: forecast issuance evidence and vault entries carry an exact source_window, not just an issue tick', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // issues a starvation_event forecast (RULE B)

  const entries = dreamMemory.materialize(state.vaultPath);
  const forecastEntry = entries.find((e) => e.entry_type === 'forecast');
  assert.ok(forecastEntry, 'a forecast entry must have been written');
  assert.ok(forecastEntry.text_or_data.source_window, 'the forecast entry must carry the exact source window it was derived from');
  assert.ok(Array.isArray(forecastEntry.text_or_data.source_window.crossing_ticks));
  assert.ok(forecastEntry.text_or_data.source_window.crossing_ticks.includes(1));

  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  const lines = fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tick2Line = lines.find((l) => l.tick === 2);
  assert.equal(tick2Line.forecasts_issued.length, 1);
  assert.ok(tick2Line.forecasts_issued[0].source_window, 'the evidence line must carry the same source_window as the vault entry');

  dreamLane.deregisterRun(p);
});

// --- finalizeRun (S4b-3: no-checkpoint / trial-run vault lifecycle) ---

test('finalizeRun flips this run\'s pending vault entries to run-terminal and deregisters the run', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {}); // issues a forecast, all still 'pending'

  let entries = dreamMemory.materialize(state.vaultPath);
  assert.ok(entries.some((e) => e.commit_status === 'pending'), 'this trial run must have left pending entries, per the no-checkpoint lifecycle');

  const result = dreamLane.finalizeRun(p);
  assert.ok(result.flipped.length >= 1);

  entries = dreamMemory.materialize(state.vaultPath);
  const runEntries = entries.filter((e) => e.generation_id === p);
  assert.ok(runEntries.every((e) => e.commit_status === 'run-terminal'), 'every entry this run wrote must reach the terminal run-terminal status, never left pending');
  assert.equal(dreamLane.getRunState(p), null, 'finalizeRun must deregister the run -- it is over');
});

test('finalizeRun resolves the SAME vault path the run actually registered with, not a fresh default', () => {
  const p = freshPath(); // registers a SCRATCH vault path, not DEFAULT_VAULT_PATH
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);
  const scratchVaultPath = state.vaultPath;
  assert.notEqual(scratchVaultPath, dreamLane.DEFAULT_VAULT_PATH);

  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig });
  dreamLane.checkTriggers(p, 'hive-a', 2, liveConfig, {});

  dreamLane.finalizeRun(p); // called with no explicit vaultPath argument

  const entries = dreamMemory.materialize(scratchVaultPath);
  assert.ok(entries.some((e) => e.commit_status === 'run-terminal'), 'finalizeRun must have found and flipped entries in the SCRATCH vault the run actually wrote to');
});

// --- S4b trend gate (coordinator-pinned definition 2026-08-13T17:05Z),
// live tick path: stockpile threading through recordTickOutcome ->
// consequence-ledger.js -> dream-composer.js, and suppression journaling ---

test('trend gate, live tick path: a rising recovery_peak (recovering better between crossings) suppresses trigger 2 even though the count condition is met, and journals reason trend-gate', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const state = dreamLane.getRunState(p);

  // Two starvation crossings (PRODUCTION-VALID: stockpile 0 at each, per
  // applyUpkeep()'s own invariant), with a RECOVERY row between them that
  // climbs HIGHER before the second crossing than before the first --
  // recovery_peak RISES (2 -> 6), meaning the hive is recovering BETTER,
  // not worse. The count condition (>=2 in the 40-tick window) is met, but
  // the trend gate must suppress delivery.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 2 });
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 1, peak since start = 2
  dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 3, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 6 });
  dreamLane.recordTickOutcome(p, 'hive-a', 4, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 2, peak since crossing 1 = 6
  const result = dreamLane.checkTriggers(p, 'hive-a', 5, liveConfig, {});

  assert.equal(result.signal, null, 'the trend gate must suppress delivery despite the count condition being met');
  assert.ok(
    result.arbitration.suppressed.some((s) => s.trigger_class === 'repeating-starvation' && s.reason === 'trend-gate'),
    'the suppression must be journaled with reason trend-gate, auditable, not silently dropped'
  );

  const evidencePath = path.join(state.sandboxRoot, 'dream-lane-evidence.jsonl');
  const lines = fs.readFileSync(evidencePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tick5Line = lines.find((l) => l.tick === 5);
  assert.ok(
    tick5Line.suppressed_triggers.some((s) => s.trigger_class === 'repeating-starvation' && s.reason === 'trend-gate'),
    'the evidence file must also carry the trend-gate suppression'
  );

  dreamLane.deregisterRun(p);
});

test('trend gate, live tick path: a non-increasing (declining) recovery_peak delivers trigger 2 normally', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };

  // Same shape as above, but the recovery row between crossings climbs
  // LOWER the second time (6 -> 2) -- a genuinely worsening pattern.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 6 });
  dreamLane.recordTickOutcome(p, 'hive-a', 2, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 1, peak since start = 6
  dreamLane.checkTriggers(p, 'hive-a', 3, liveConfig, {});
  dreamLane.recordTickOutcome(p, 'hive-a', 3, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 2 });
  dreamLane.recordTickOutcome(p, 'hive-a', 4, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 2, peak since crossing 1 = 2
  const result = dreamLane.checkTriggers(p, 'hive-a', 5, liveConfig, {});

  assert.equal(result.signal.trigger_class, 'repeating-starvation');

  dreamLane.deregisterRun(p);
});

test('trend gate, live tick path, r3: a far pre-window peak does NOT reverse the verdict -- proves dream-lane.js\'s own call site actually passes the recoveryPeakWindowTicks bound through', () => {
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };

  // A very high pre-window stockpile at tick 1, more than 40 ticks before
  // crossing 1 (tick 47) -- retained by dream-lane.js's own history (well
  // under HISTORY_RETENTION_TICKS=150), but must NOT count toward crossing
  // 1's recovery_peak once the canonical 40-tick bound is applied.
  dreamLane.recordTickOutcome(p, 'hive-a', 1, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 100 });
  for (let t = 2; t <= 45; t += 1) {
    dreamLane.recordTickOutcome(p, 'hive-a', t, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 1 });
  }
  dreamLane.recordTickOutcome(p, 'hive-a', 46, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 3 });
  dreamLane.recordTickOutcome(p, 'hive-a', 47, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 1: bounded peak = 3 (in-window), UNBOUNDED peak would be 100
  dreamLane.recordTickOutcome(p, 'hive-a', 48, { starved: false, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 5 });
  dreamLane.recordTickOutcome(p, 'hive-a', 50, { starved: true, worldStateSnapshot: { food_sources: {} }, action: { verb: 'idle' }, liveConfig, stockpile: 0 }); // crossing 2: peak = 5

  const result = dreamLane.checkTriggers(p, 'hive-a', 51, liveConfig, {});

  // Bounded peaks [3, 5] are INCREASING -- the trend gate must suppress.
  // If dream-lane.js's call site forgot to pass recoveryPeakWindowTicks,
  // crossing 1 would inherit the tick-1 peak of 100, [100, 5] would be
  // non-increasing, and this would incorrectly FIRE instead.
  assert.equal(result.signal, null, 'the far pre-window peak of 100 must not reverse this verdict to a fire');
  assert.ok(
    result.arbitration.suppressed.some((s) => s.trigger_class === 'repeating-starvation' && s.reason === 'trend-gate'),
    'must be suppressed specifically by the trend gate, not some other reason'
  );

  dreamLane.deregisterRun(p);
});

test('S5 re-trial fold, live tick path: WINDOW ANCHOR REGRESSION -- the real seed 777000306 tick-207 boundary case now correctly suppresses (root-caused against the actual persisted B-777000306/run-log.jsonl artifacts)', () => {
  // Real hive-a crossing/stockpile data trimmed from
  // _dev/sim-runs/wmdc-ablation/B-777000306/run-log.jsonl (ticks 160-204;
  // everything outside this window is irrelevant to the trend gate's own
  // 40-tick lookback from the tick-207 marker). Every tick not listed below
  // is starved:false, food:0 (the real, near-universal filler value in this
  // stretch of the run).
  //
  // Crossings at (persisted) ticks 167, 197, 204 -- 167 sits EXACTLY 39
  // real ticks before the tick-206 causal visibility boundary (persisted
  // tick 207's own generating compute call can see history only through
  // persisted tick 206), i.e. genuinely INSIDE a 40-tick window. Before
  // this fix, dream-lane.js anchored the window at the CURRENT round
  // (tickIndex) instead of the LAST VISIBLE round (tickIndex - 1),
  // silently narrowing every trigger's configured window by one real tick
  // -- excluding this crossing and (empirically confirmed, see the fix's
  // own commit) flipping this exact delivery from SUPPRESS to FIRE in the
  // actual B-777000306 re-trial run.
  const p = freshPath();
  const liveConfig = { dream_lane_enabled: true };
  const overrides = { 166: 1, 167: 0, 194: 1, 195: 2, 196: 1, 197: 0, 203: 1, 204: 0 };
  const starvedTicks = new Set([167, 197, 204]);
  for (let t = 160; t <= 204; t += 1) {
    const food = t in overrides ? overrides[t] : 0;
    dreamLane.recordTickOutcome(p, 'hive-a', t, {
      starved: starvedTicks.has(t),
      worldStateSnapshot: { food_sources: {} },
      action: { verb: 'idle' },
      liveConfig,
      stockpile: food
    });
  }

  // checkTriggers(tickIndex=207) is the compute call whose window anchor
  // (tickIndex - 1 = 206, post-fix) must see all three crossings
  // (167, 197, 204) -- recovery peaks [1, 2, 1] fail the non-increasing
  // trend gate at the second comparison (2 > 1), correctly suppressing.
  const result = dreamLane.checkTriggers(p, 'hive-a', 207, liveConfig, {});

  assert.equal(result.signal, null, 'the real seed-306 crossing pattern must suppress, not fire, once the window anchor is fixed');
  assert.ok(
    result.arbitration.suppressed.some((s) => s.trigger_class === 'repeating-starvation' && s.reason === 'trend-gate'),
    'must be suppressed specifically by the trend gate (peaks [1,2,1] rise at the second step), matching the canonical audit re-derivation'
  );

  dreamLane.deregisterRun(p);
});
