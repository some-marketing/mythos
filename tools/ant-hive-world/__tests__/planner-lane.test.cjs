'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlannerState, advancePlanner, computeGoalMultiplier, selectGoal,
  GOALS, GOAL_BOOST, DEFAULT_HORIZON
} = require('../planner-lane.js');
const { RESOURCE_NORM_K, VERB_ORDER } = require('../untrained-network.js');

function hiveStateWithStockpile(food, wood) {
  return { identity: 'hive-A', hive_state: { stockpile: { food, wood } } };
}

test('createPlannerState rejects a non-positive-integer horizon', () => {
  assert.throws(() => createPlannerState(0));
  assert.throws(() => createPlannerState(-1));
  assert.throws(() => createPlannerState(1.5));
});

test('default horizon is exported and used when omitted', () => {
  const state = createPlannerState();
  assert.equal(state.horizon, DEFAULT_HORIZON);
});

test('selectGoal prioritizes FORAGE_FOOD when food stockpile is below the scarcity threshold', () => {
  const goal = selectGoal(hiveStateWithStockpile(0, RESOURCE_NORM_K * 5));
  assert.equal(goal, GOALS.FORAGE_FOOD);
});

test('selectGoal prioritizes FORAGE_WOOD over EXPAND_TERRITORY when only wood is scarce', () => {
  const goal = selectGoal(hiveStateWithStockpile(RESOURCE_NORM_K * 5, 0));
  assert.equal(goal, GOALS.FORAGE_WOOD);
});

test('selectGoal falls through to EXPAND_TERRITORY when both stockpiles are healthy and structures have caught up with territory', () => {
  const hiveState = hiveStateWithStockpile(RESOURCE_NORM_K * 5, RESOURCE_NORM_K * 5);
  const worldState = {
    territory: { t1: 'hive-A' },
    geometry_log: [{ hive: 'hive-A' }]
  };
  const goal = selectGoal(hiveState, worldState);
  assert.equal(goal, GOALS.EXPAND_TERRITORY);
});

test('selectGoal falls through to EXPAND_TERRITORY with no worldState context at all', () => {
  const goal = selectGoal(hiveStateWithStockpile(RESOURCE_NORM_K * 5, RESOURCE_NORM_K * 5));
  assert.equal(goal, GOALS.EXPAND_TERRITORY);
});

test('selectGoal prefers BUILD when claimed territory outpaces built structures and both stockpiles are healthy', () => {
  const hiveState = hiveStateWithStockpile(RESOURCE_NORM_K * 5, RESOURCE_NORM_K * 5);
  const worldState = {
    territory: { t1: 'hive-A', t2: 'hive-A' },
    geometry_log: [{ hive: 'hive-A' }]
  };
  const goal = selectGoal(hiveState, worldState);
  assert.equal(goal, GOALS.BUILD);
});

test('a fresh state (no goal yet) commits on its first advancePlanner call', () => {
  const state = createPlannerState(5);
  advancePlanner(state, hiveStateWithStockpile(0, 100));
  assert.equal(state.currentGoal, GOALS.FORAGE_FOOD);
  assert.equal(state.ticksRemaining, 5);
});

test('the commitment survives a single bad tick -- goal is unchanged even when the threshold read would now select differently', () => {
  const state = createPlannerState(5);
  advancePlanner(state, hiveStateWithStockpile(0, 100)); // commits to FORAGE_FOOD, ticksRemaining=5
  // Food is now healthy and wood is scarce -- a reactive lane would flip
  // goals immediately; PLANNER must not, mid-commitment.
  advancePlanner(state, hiveStateWithStockpile(999, 0));
  assert.equal(state.currentGoal, GOALS.FORAGE_FOOD);
  assert.equal(state.ticksRemaining, 4);
});

test('re-evaluates and re-commits once ticksRemaining reaches 0', () => {
  const state = createPlannerState(2);
  advancePlanner(state, hiveStateWithStockpile(0, 100)); // ticksRemaining 2 -> commit FORAGE_FOOD
  advancePlanner(state, hiveStateWithStockpile(999, 0));  // ticksRemaining 1, still FORAGE_FOOD
  advancePlanner(state, hiveStateWithStockpile(999, 0));  // ticksRemaining 0, still FORAGE_FOOD (this tick's decrement)
  advancePlanner(state, hiveStateWithStockpile(999, 0));  // re-evaluate: food healthy, wood scarce -> FORAGE_WOOD
  assert.equal(state.currentGoal, GOALS.FORAGE_WOOD);
  assert.equal(state.ticksRemaining, 2);
});

test('ticksRemaining strictly decrements to 0 across a full horizon before re-commit', () => {
  const state = createPlannerState(3);
  advancePlanner(state, hiveStateWithStockpile(0, 100));
  assert.equal(state.ticksRemaining, 3);
  advancePlanner(state, hiveStateWithStockpile(0, 100));
  assert.equal(state.ticksRemaining, 2);
  advancePlanner(state, hiveStateWithStockpile(0, 100));
  assert.equal(state.ticksRemaining, 1);
  advancePlanner(state, hiveStateWithStockpile(0, 100));
  assert.equal(state.ticksRemaining, 0);
});

test('computeGoalMultiplier boosts only the verb(s) the current goal serves', () => {
  const state = createPlannerState(5);
  advancePlanner(state, hiveStateWithStockpile(0, 100)); // FORAGE_FOOD
  const out = computeGoalMultiplier(state, VERB_ORDER);
  assert.equal(out['gather-food'], GOAL_BOOST);
  assert.equal(out['gather-wood'], 1);
  assert.equal(out['build'], 1);
  assert.equal(out['claim-territory'], 1);
});

test("idle's multiplier is unconditionally 1 regardless of the current goal (S6 obligation)", () => {
  for (const goal of Object.values(GOALS)) {
    const state = createPlannerState(5);
    state.currentGoal = goal;
    state.ticksRemaining = 5;
    const out = computeGoalMultiplier(state, VERB_ORDER);
    assert.equal(out.idle, 1, `idle multiplier leaked for goal ${goal}`);
  }
});

test('computeGoalMultiplier never returns a multiplier below 1 for any verb -- re-weight, never veto', () => {
  const state = createPlannerState(5);
  advancePlanner(state, hiveStateWithStockpile(0, 0)); // FORAGE_FOOD (food checked first)
  const out = computeGoalMultiplier(state, VERB_ORDER);
  for (const verb of VERB_ORDER) {
    assert.ok(out[verb] >= 1, `${verb} multiplier ${out[verb]} is below the re-weight-never-veto floor of 1`);
  }
});

test('computeGoalMultiplier is inert (all 1s) on a state with no goal yet', () => {
  const state = createPlannerState(5);
  const out = computeGoalMultiplier(state, VERB_ORDER);
  for (const verb of VERB_ORDER) {
    assert.equal(out[verb], 1);
  }
});

test('computeGoalMultiplier is inert on an EXPIRED commitment (ticksRemaining=0) even though currentGoal is still set -- off-by-one regression (pre-commit Codex catch)', () => {
  const state = createPlannerState(5);
  state.currentGoal = GOALS.FORAGE_FOOD;
  state.ticksRemaining = 0; // decremented to 0 by advancePlanner, not yet re-selected
  const out = computeGoalMultiplier(state, VERB_ORDER);
  assert.equal(out['gather-food'], 1, 'an expired commitment must not still boost its goal-verb');
});

test('a commitment boosts its goal-verb for exactly `horizon` ticks, then one inert transition tick before the next commitment starts -- off-by-one regression (pre-commit Codex catch)', () => {
  // Mirrors train-tick.js's real per-tick order: read
  // (computeGoalMultiplier) BEFORE advance (advancePlanner).
  const state = createPlannerState(3);
  const hiveState = hiveStateWithStockpile(0, 100); // stays FORAGE_FOOD-eligible throughout
  // Cold-start bootstrap tick: no goal committed yet, inert by construction.
  computeGoalMultiplier(state, VERB_ORDER);
  advancePlanner(state, hiveState); // commits FORAGE_FOOD, ticksRemaining=3

  const boostedFlags = [];
  for (let i = 0; i < 5; i++) {
    const out = computeGoalMultiplier(state, VERB_ORDER);
    boostedFlags.push(out['gather-food'] === GOAL_BOOST);
    advancePlanner(state, hiveState);
  }
  // Ticks 1-3 of the commitment: boosted (exactly `horizon`=3 ticks, not 4
  // -- the off-by-one this guards). Tick 4: the single inert transition
  // tick (ticksRemaining just reached 0, not yet re-selected). Tick 5: the
  // first tick of the next commitment, boosted again.
  assert.deepEqual(boostedFlags, [true, true, true, false, true]);
});

test('BUILD goal boosts build and nothing else', () => {
  const state = createPlannerState(5);
  state.currentGoal = GOALS.BUILD;
  state.ticksRemaining = 5;
  const out = computeGoalMultiplier(state, VERB_ORDER);
  assert.equal(out.build, GOAL_BOOST);
  assert.equal(out['gather-food'], 1);
  assert.equal(out['gather-wood'], 1);
  assert.equal(out['claim-territory'], 1);
  assert.equal(out.idle, 1);
});

test('EXPAND_TERRITORY goal boosts claim-territory and nothing else', () => {
  const state = createPlannerState(5);
  advancePlanner(state, hiveStateWithStockpile(RESOURCE_NORM_K * 5, RESOURCE_NORM_K * 5));
  assert.equal(state.currentGoal, GOALS.EXPAND_TERRITORY);
  const out = computeGoalMultiplier(state, VERB_ORDER);
  assert.equal(out['claim-territory'], GOAL_BOOST);
  assert.equal(out['gather-food'], 1);
  assert.equal(out['gather-wood'], 1);
  assert.equal(out.build, 1);
});
