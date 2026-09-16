'use strict';

/*
 * Episodic-escape food-yield fix -- plan ant-sim-reward-specification-repair,
 * S1.
 *
 * A gather-food action has always credited amount:1 while upkeep_cost_food
 * is also 1, so net food per PERFECT gather was 0 -- verified against the
 * reference run: max(stockpile.food)=0 and ticks_with_food=0 across all 600
 * hive rows. That makes the -2 starvation ("exhaustion") penalty a constant
 * every hive always pays, not a gradient a hive can learn its way out of.
 * These tests pin the fix (config-driven gather_yield_food, default 2) and
 * the inertness invariant it must never break: an absent/non-positive value
 * must reproduce today's amount:1 behavior byte-identically.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNetwork,
  forward,
  encodeState,
  decide,
  resolveGatherYieldFood,
  VERB_ORDER,
  UPKEEP_COST
} = require('../untrained-network.js');
const DEFAULT_CONFIG = require('../live-config.js').DEFAULT_CONFIG;

function goldenHiveState(overrides = {}) {
  return {
    identity: 'hive-a',
    hive_state: { resources: {}, territory: {}, worker_dispatch_state: {}, stockpile: {} },
    ...overrides
  };
}

function goldenWorldState(overrides = {}) {
  return { resources: { food: 10 }, territory: {}, geometry_log: [], ...overrides };
}

// Deterministically drive `decide()` toward a specific VERB_ORDER index by
// computing this network's actual probs at this state first, then choosing
// an rng draw that lands inside that action's cumulative-probability bucket.
// This works regardless of the (small-random, seed-dependent) initial
// weights -- it doesn't assume any particular prob distribution, only that
// softmax always assigns every action a strictly positive probability.
function rngForAction(net, hiveState, worldState, targetIndex) {
  const { probs } = forward(net, encodeState(hiveState, worldState));
  let cumulative = 0;
  for (let i = 0; i < targetIndex; i++) cumulative += probs[i];
  const mid = cumulative + probs[targetIndex] / 2;
  return () => mid;
}

test('resolveGatherYieldFood: absent liveConfig key is inert (falls back to 1)', () => {
  assert.equal(resolveGatherYieldFood({}), 1);
  assert.equal(resolveGatherYieldFood(undefined), 1);
});

test('resolveGatherYieldFood: non-positive/garbage values fall back to 1, not propagate', () => {
  assert.equal(resolveGatherYieldFood({ gather_yield_food: 0 }), 1);
  assert.equal(resolveGatherYieldFood({ gather_yield_food: -1 }), 1);
  assert.equal(resolveGatherYieldFood({ gather_yield_food: null }), 1);
  assert.equal(resolveGatherYieldFood({ gather_yield_food: NaN }), 1);
});

test('resolveGatherYieldFood: a positive configured value passes through', () => {
  assert.equal(resolveGatherYieldFood({ gather_yield_food: 2 }), 2);
});

test('decide(): liveConfig={} (absent key) emits amount:1 for gather-food -- the inertness pin', () => {
  const net = createNetwork(11);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const targetIndex = VERB_ORDER.indexOf('gather-food');
  const rng = rngForAction(net, hiveState, worldState, targetIndex);
  const action = decide(net, hiveState, worldState, rng, {});
  assert.equal(action.verb, 'gather');
  assert.equal(action.resourceKey, 'food');
  assert.equal(action.amount, 1);
});

test('decide(): gather_yield_food:2 emits amount:2 for gather-food', () => {
  const net = createNetwork(13);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const targetIndex = VERB_ORDER.indexOf('gather-food');
  const rng = rngForAction(net, hiveState, worldState, targetIndex);
  const action = decide(net, hiveState, worldState, rng, { gather_yield_food: 2 });
  assert.equal(action.verb, 'gather');
  assert.equal(action.resourceKey, 'food');
  assert.equal(action.amount, 2);
});

test('decide(): gather-wood emits amount:1 regardless of gather_yield_food', () => {
  const net = createNetwork(17);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const targetIndex = VERB_ORDER.indexOf('gather-wood');
  const rng = rngForAction(net, hiveState, worldState, targetIndex);
  const action = decide(net, hiveState, worldState, rng, { gather_yield_food: 2 });
  assert.equal(action.verb, 'gather');
  assert.equal(action.resourceKey, 'wood');
  assert.equal(action.amount, 1, 'gather-wood is not a food-yield tunable and must stay 1');
});

test('decide(): a non-positive/garbage gather_yield_food falls back to amount:1, not propagate', () => {
  const net = createNetwork(19);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const targetIndex = VERB_ORDER.indexOf('gather-food');
  for (const garbage of [0, -1, null]) {
    const rng = rngForAction(net, hiveState, worldState, targetIndex);
    const action = decide(net, hiveState, worldState, rng, { gather_yield_food: garbage });
    assert.equal(action.amount, 1, `expected fallback to 1 for gather_yield_food=${garbage}`);
  }
});

test('DEFAULT_CONFIG ships gather_yield_food:2, and net food per successful gather is >= 1', () => {
  assert.equal(DEFAULT_CONFIG.gather_yield_food, 2);
  // Assert the ORDERING invariant, not the literal 2, so a future retune of
  // either constant fails on the invariant (episodic escape must remain
  // possible) rather than on a hardcoded number.
  assert.ok(
    DEFAULT_CONFIG.gather_yield_food - DEFAULT_CONFIG.upkeep_cost_food >= 1,
    `expected net food per perfect gather (gather_yield_food - upkeep_cost_food) >= 1, got ` +
    `${DEFAULT_CONFIG.gather_yield_food} - ${DEFAULT_CONFIG.upkeep_cost_food}`
  );
  // upkeep_cost_food must stay untouched by this fix -- it is the unit prior
  // published starved-crossing evidence is reported in.
  assert.equal(DEFAULT_CONFIG.upkeep_cost_food, UPKEEP_COST);
});
