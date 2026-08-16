'use strict';

// Fallow/regrowth mechanic (plan sim-replenishment-dynamics, S1/S2).
// AC1 (golden fixture, S1): with all defaults, a seeded 300-tick full-run
// trajectory (run-log.jsonl + final world-state.json, normalized to strip
// only wall-clock/identity fields that are provably non-deterministic even
// with a fixed root-seed -- see capture-fixture.cjs's header comment for the
// exact field list and why) must be byte-identical before and after S1+S2
// landed. Captured via:
//
//   node tools/scoped/sim-replenishment-dynamics/capture-fixture.cjs \
//     --ticks 300 --sandbox-root _dev/sim-runs/<name> \
//     --root-seed 777000111 --run-name fixture-pre
//
// run BEFORE this file's changes (report: _dev/sim-runs/srd-fixture-pre/
// fixture-report.json) and again AFTER (report: _dev/sim-runs/
// srd-fixture-post/fixture-report.json, same root seed/ticks/run-name --
// only the sandbox-root differs). Both runs produced these exact hashes;
// hard-coded here as the fixture pin so a future regression against this
// contract fails loudly instead of drifting silently.
//
// REBASELINED, DELIBERATELY (codex fold review, plan world-mind-dream-
// communication, S4, MAJOR fix -- the same deliberate-pin-update pattern
// territory-reassertion.test.cjs's shape_hash pin already uses). S4's S2
// consequence-ledger's run-log MARKER (AC2/AC12) adds four new, ALWAYS-NULL
// fields (lane, dream_lane, dream_trigger_class, dream_forecast_authority)
// additively to EVERY run-log row when dream_lane_enabled is falsy-absent
// (the default) -- the simulation's actual BEHAVIOR (every action, reward,
// RNG draw, and the final world-state) is unchanged, proven by
// world_state_sha256 staying IDENTICAL and by a strip-proof in the S4
// implementation receipt (message to team-lead, 2026-08-13): removing
// exactly those 4 fields from every row of the post-S4 run-log and
// recomputing the hash with capture-fixture.cjs's own algorithm reproduces
// the OLD pin below byte-for-byte. The run-log CONTENT hash necessarily
// moves anyway, because the marker fields are real bytes on every row --
// this is the schema-growth consequence AC2/AC12 require, not a behavioral
// regression.
//
// OLD pin (pre-S4): run_log 'c568b22c6ab3d4e50cd631ac0d8c52e1c3cc14c09cc4ded62e007c079a325a1b'.
const GOLDEN_RUN_LOG_SHA256 = '9d23ca4ac603b005efcdfdf8c23b7fcc47579e049390e5c1769c4ab1cb63b494';
const GOLDEN_WORLD_STATE_SHA256 = '2518028c221b6418eb50a8f3d5a97d835264209faad9d109b9947ff40acf0fe7'; // unchanged -- world-state carries no run-log marker fields

// The MECHANICAL enforcement of the golden fixture is capture-fixture.cjs's
// --verify-against-run-log / --verify-against-world-state flags (codex
// review 2026-08-12, sim-replenishment-s1s2-impl-review, MAJOR): a live
// 300-tick run is too slow for a unit test, so a CI job or the S4
// re-fingerprint step runs
//
//   node tools/scoped/sim-replenishment-dynamics/capture-fixture.cjs \
//     --ticks 300 --sandbox-root <scratch dir> --root-seed 777000111 \
//     --run-name fixture-pre \
//     --verify-against-run-log 9d23ca4ac603b005efcdfdf8c23b7fcc47579e049390e5c1769c4ab1cb63b494 \
//     --verify-against-world-state 2518028c221b6418eb50a8f3d5a97d835264209faad9d109b9947ff40acf0fe7
//
// which exits non-zero on any mismatch. This test file's job is narrower:
// pin the constants, and -- when a prior capture's report file is present on
// disk -- assert it actually recorded these hashes, so a stale/edited report
// left lying around cannot silently drift from what this file claims.
const path = require('node:path');
const fs = require('node:fs');
// Points at the S3-falsifier-path re-verification capture (team-lead
// dispatch, final code round): the mechanic's absence from DEFAULT_CONFIG
// changed nothing about the trajectory -- same hashes, reconfirmed after the
// revert below.
const REPORT_PATH = path.join(__dirname, '..', '..', '..', '_dev', 'sim-runs', 'srd-fixture-final', 'fixture-report.json');
const CAPTURE_COMMAND = 'node tools/scoped/sim-replenishment-dynamics/capture-fixture.cjs --ticks 300 ' +
  '--sandbox-root _dev/sim-runs/srd-fixture-final --root-seed 777000111 --run-name fixture-final ' +
  '--verify-against-run-log ' + GOLDEN_RUN_LOG_SHA256 + ' --verify-against-world-state ' + GOLDEN_WORLD_STATE_SHA256;

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initialWorldState,
  regrowFoodSources,
  DEFAULT_FOOD_SOURCE_REGROW_RATE,
  DEFAULT_FOOD_SOURCE_REGROW_CAP,
  INITIAL_FOOD_SOURCE_AMOUNT
} = require('../world-state.js');
const { DEFAULT_CONFIG } = require('../live-config.js');

test('golden fixture pin: constants are well-formed sha256 hex digests', () => {
  assert.match(GOLDEN_RUN_LOG_SHA256, /^[0-9a-f]{64}$/);
  assert.match(GOLDEN_WORLD_STATE_SHA256, /^[0-9a-f]{64}$/);
});

test('golden fixture ENFORCEMENT: a captured report on disk must match the pinned hashes exactly', (t) => {
  if (!fs.existsSync(REPORT_PATH)) {
    // LOUD skip, not a silent pass: names the exact command to regenerate
    // the evidence this test wants to check.
    t.diagnostic(
      `No fixture report at ${REPORT_PATH} -- SKIPPING the enforcing hash comparison. ` +
      `Regenerate it with:\n  ${CAPTURE_COMMAND}`
    );
    t.skip('fixture report not present on disk -- see diagnostic for the capture command');
    return;
  }
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  assert.equal(report.run_log_sha256, GOLDEN_RUN_LOG_SHA256, 'run-log hash drifted from the pinned golden fixture');
  assert.equal(report.world_state_sha256, GOLDEN_WORLD_STATE_SHA256, 'world-state hash drifted from the pinned golden fixture');
});

// S3 FALSIFIER PATH (plan sim-replenishment-dynamics, AC4): the
// pre-registered ablation ran to completion and neither treatment arm
// cleared the eligibility bar (see _dev/reports/analysis/
// sim-replenishment-dynamics__ablation.{json,md}). AC4's falsifier branch is
// "no default/fingerprint change ships" -- so, unlike the original S1/S2
// landing, these two keys are DELIBERATELY ABSENT from DEFAULT_CONFIG, not
// present-and-zeroed. This is a stronger no-behavior-change guarantee for
// the benchmark's world_params_defaults digest specifically: an absent key
// and a present-zero key both resolve to the same runtime behavior (see the
// next test), but only the absent form leaves DEFAULT_CONFIG's key SET,
// and therefore its digest, untouched.
test('live-config defaults do NOT carry the regrowth keys (AC4 falsifier path -- benchmark-digest-stable)', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, 'food_source_regrow_rate'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, 'food_source_regrow_cap'), false);
  assert.equal(DEFAULT_CONFIG.food_source_regrow_rate, undefined);
  assert.equal(DEFAULT_CONFIG.food_source_regrow_cap, undefined);
});

test('harness wiring reads the absent keys as undefined -> falsy rate -> structurally a no-op', () => {
  // Reproduces harness.js's exact call shape (regrowRate: liveConfig.food_
  // source_regrow_rate, regrowCap: liveConfig.food_source_regrow_cap) using
  // the real DEFAULT_CONFIG object a stock run actually reads liveConfig
  // from -- not a hand-built {} -- so this is integration evidence for the
  // wiring, not just the pure-function unit test above it.
  const state = initialWorldState({});
  const result = regrowFoodSources(state, {
    regrowRate: DEFAULT_CONFIG.food_source_regrow_rate,
    regrowCap: DEFAULT_CONFIG.food_source_regrow_cap
  });
  assert.equal(result, state); // reference equality -- the early return still fires with the keys absent
});

test('world-state module keeps its own internal defaults regardless of live-config -- the mechanic is not deleted, only unwired from DEFAULT_CONFIG', () => {
  assert.equal(DEFAULT_FOOD_SOURCE_REGROW_RATE, 0);
  assert.equal(DEFAULT_FOOD_SOURCE_REGROW_CAP, INITIAL_FOOD_SOURCE_AMOUNT);
});

test('regrowFoodSources has no rng parameter -- structurally cannot draw from the shared stream', () => {
  // Signature is (state, opts = {}); Function.length only counts parameters
  // before the first one with a default, so it reports 1 here -- that IS
  // the proof: there is no third parameter for an rng to occupy, and no
  // slot between `state` and `opts` for one either.
  assert.equal(regrowFoodSources.length, 1);
  assert.equal(regrowFoodSources.toString().includes('rng'), false);
});

test('rate 0 (the default) is a hard no-op: returns the SAME object reference, before any patch is touched', () => {
  const state = initialWorldState({});
  const result = regrowFoodSources(state, { regrowRate: 0, regrowCap: 8 });
  assert.equal(result, state); // reference equality -- proves the early return, not just deep equality
});

test('omitting regrowRate resolves to the default (0) -- also a no-op', () => {
  const state = initialWorldState({});
  const result = regrowFoodSources(state, {});
  assert.equal(result, state);
});

test('rate 0 is a no-op even when a draw-counting rng-shaped stub is present on opts -- proves zero shared-stream draws', () => {
  // regrowFoodSources takes no rng argument at all (previous test), so there
  // is no call site through which a caller COULD hand it one; this test
  // additionally proves that even stuffing a draw-counting function onto opts
  // (as if a caller mistakenly tried) is never invoked, because the function
  // signature never reads such a field.
  let draws = 0;
  const spyRng = () => { draws += 1; return 0.5; };
  const state = initialWorldState({});
  const result = regrowFoodSources(state, { regrowRate: 0, regrowCap: 8, rng: spyRng });
  assert.equal(result, state);
  assert.equal(draws, 0);
});

test('rate > 0 grows a half-depleted patch along the discrete logistic curve with exact expected values, never exceeds cap', () => {
  // Patch at exactly K/2 = 4 (cap 8): x' = x + r*x*(1 - x/K) = 4 + 0.05*4*(1 - 4/8)
  //                                       = 4 + 0.05*4*0.5 = 4 + 0.1 = 4.1
  const cap = 8;
  const rate = 0.05;
  const state = { food_sources: { 'tile-1': 4 }, resources: { food: 4 } };
  const result = regrowFoodSources(state, { regrowRate: rate, regrowCap: cap });
  assert.equal(result.food_sources['tile-1'], 4.1);
  assert.equal(result.resources.food, 4.1);
  assert.notEqual(result, state); // growth happened -- must be a new object

  // growth peaks at x = K/2: verify the increment at K/2 exceeds the
  // increment at a point away from K/2 on both sides.
  const below = regrowFoodSources({ food_sources: { t: 2 }, resources: { food: 2 } }, { regrowRate: rate, regrowCap: cap });
  const atPeak = regrowFoodSources({ food_sources: { t: 4 }, resources: { food: 4 } }, { regrowRate: rate, regrowCap: cap });
  const above = regrowFoodSources({ food_sources: { t: 6 }, resources: { food: 6 } }, { regrowRate: rate, regrowCap: cap });
  const deltaBelow = below.food_sources.t - 2;
  const deltaAtPeak = atPeak.food_sources.t - 4;
  const deltaAbove = above.food_sources.t - 6;
  assert.ok(deltaAtPeak > deltaBelow, `peak delta ${deltaAtPeak} should exceed below-peak delta ${deltaBelow}`);
  assert.ok(deltaAtPeak > deltaAbove, `peak delta ${deltaAtPeak} should exceed above-peak delta ${deltaAbove}`);
});

test('growth never exceeds the cap, even from very close to it', () => {
  const cap = 8;
  const state = { food_sources: { t: 7.99 }, resources: { food: 7.99 } };
  const result = regrowFoodSources(state, { regrowRate: 0.5, regrowCap: cap });
  assert.ok(result.food_sources.t <= cap, `${result.food_sources.t} exceeded cap ${cap}`);
});

test('a patch already at or above the cap is left untouched', () => {
  const state = { food_sources: { t: 8 }, resources: { food: 8 } };
  const result = regrowFoodSources(state, { regrowRate: 0.05, regrowCap: 8 });
  assert.equal(result, state); // no change -> same reference (no patch was in range 0<x<K)
});

test('a zeroed/deleted patch stays gone -- there is no key for it to regrow under', () => {
  // Mirrors depleteFoodSourcesTotal's contract (world-state.js): a patch
  // fully consumed is DELETED from food_sources, not set to 0. There is
  // structurally no key left for regrowFoodSources to touch.
  const state = { food_sources: { alive: 3 }, resources: { food: 3 } };
  const result = regrowFoodSources(state, { regrowRate: 0.05, regrowCap: 8 });
  assert.equal(Object.prototype.hasOwnProperty.call(result.food_sources, 'gone'), false);
  assert.equal(Object.keys(result.food_sources).sort().join(','), 'alive');
});

// FLOAT-DETERMINISM FIXTURE (S2, codex review 2026-08-12,
// sim-replenishment-s1s2-impl-review, MAJOR): 20 consecutive applications of
// regrowFoodSources on a fixed starting state, asserted against the EXACT
// float value at every step for every patch -- not just the final value.
// Any platform/engine float-arithmetic drift (the plan's own noted
// out-of-scope limit) becomes a visible failure here instead of an invisible
// divergence. Computed once via:
//   node tools/scoped/sim-replenishment-dynamics/compute-trajectory-fixture.cjs
// Re-run that script and diff its output against the arrays below if this
// test ever needs to be regenerated -- never hand-edit a single value.
const GOLDEN_TRAJECTORY_RATE = 0.05;
const GOLDEN_TRAJECTORY_CAP = 8;
const GOLDEN_TRAJECTORY = {
  a: [
    1.04375, 1.089128662109375, 1.1361713374484177, 1.1849118711455928, 1.2353823638129866,
    1.28761292209851, 1.3416313992212163, 1.3974631266111754, 1.4551306380027476, 1.5146533875675456,
    1.5760474639179864, 1.6393253020606213, 1.7044953956263014, 1.771562011946921, 1.8405249127806833,
    1.911379083703678, 1.9841144753787374, 2.0587157600763777, 2.1351621069502786, 2.2134269796543156
  ],
  b: [
    4.1, 4.1999375, 4.2996876562255855, 4.399126326904998, 4.498130690499819,
    4.596579851844708, 4.694355429847039, 4.7913421207035505, 4.887428231003553, 4.982506175596165,
    5.076472935689386, 5.169230473306438, 5.2606860989332604, 5.350752789932988, 5.43934945806104,
    5.526401165170911, 5.611839286939441, 5.695601625146182, 5.777632469701192, 5.857882612217843
  ],
  c: [
    7.9049375, 7.909634144506836, 7.9141013998575005, 7.91835021380521, 7.922391036317539,
    7.926233839806388, 7.929888138776133, 7.93336300888055, 7.936667105382863, 7.939808681016592,
    7.942795603247756, 7.945635370941569, 7.948335130438911, 7.950901691049799, 7.953341539972673,
    7.955660856649714, 7.957865526569521, 7.959961154529474, 7.9619530773708345, 7.963846376200283
  ]
};

test('float-determinism fixture: 20 consecutive regrowFoodSources applications match the committed exact-float trajectory', () => {
  let state = { food_sources: { a: 1, b: 4, c: 7.9 }, resources: { food: 1 + 4 + 7.9 } };
  const actual = { a: [], b: [], c: [] };
  for (let i = 0; i < 20; i++) {
    state = regrowFoodSources(state, { regrowRate: GOLDEN_TRAJECTORY_RATE, regrowCap: GOLDEN_TRAJECTORY_CAP });
    actual.a.push(state.food_sources.a);
    actual.b.push(state.food_sources.b);
    actual.c.push(state.food_sources.c);
  }
  assert.deepEqual(actual, GOLDEN_TRAJECTORY);
});

test('multiple patches: only in-range patches change, others pass through untouched', () => {
  const state = { food_sources: { low: 2, atCap: 8, mid: 5 }, resources: { food: 15 } };
  const result = regrowFoodSources(state, { regrowRate: 0.05, regrowCap: 8 });
  assert.equal(result.food_sources.atCap, 8);
  assert.ok(result.food_sources.low > 2);
  assert.ok(result.food_sources.mid > 5);
  assert.ok(result.food_sources.low <= 8);
  assert.ok(result.food_sources.mid <= 8);
});
