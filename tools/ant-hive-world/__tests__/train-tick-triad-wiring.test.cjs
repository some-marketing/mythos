'use strict';

// Red-then-green coverage for wiring VERIFIER/SWEEPER into trainTick()'s
// combine step (plan ant-sim-nine-mind-harness-triad-architecture, §1.3,
// §6 S3). Before this wiring existed, trainTick() had no `laneState`
// parameter at all -- passing one was silently ignored (JS drops excess
// arguments), decide()/trainStep() always ran their pre-triad code path, and
// no divergence measure (§7.1) was ever computed. This suite asserts the
// wiring is real: VERIFIER's ground-truth infeasibility actually suppresses
// an unaffordable 'build' even when AUTHOR's raw policy strongly prefers it,
// and the divergence flags are populated booleans, not silently absent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { setupHives } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');
const { trainTick } = require('../train-tick.js');
const { createSweeperState } = require('../sweeper-lane.js');
const { createPlannerState, GOALS } = require('../planner-lane.js');
const { VERB_ORDER } = require('../untrained-network.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-triad-'));
}

// A network hand-crafted so forward() overwhelmingly favors 'build' (index 2)
// regardless of input -- large positive W2 row for build, large negative for
// everything else, zero W1 so the hidden layer's exact input doesn't matter.
function buildBiasedNetwork() {
  const HIDDEN = 8, INPUT = 9, OUTPUT = 5;
  const W1 = Array.from({ length: HIDDEN }, () => Array.from({ length: INPUT }, () => 0));
  const b1 = Array.from({ length: HIDDEN }, () => 1); // constant positive hidden activation after ReLU
  const W2 = Array.from({ length: OUTPUT }, (_, i) => Array.from({ length: HIDDEN }, () => (i === 2 ? 5 : -5)));
  const b2 = Array.from({ length: OUTPUT }, () => 0);
  return { W1, b1, W2, b2 };
}

test('trainTick wires VERIFIER into decide(): an unaffordable build is suppressed even when AUTHOR strongly prefers it', () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  // resourcePool wood: 0 -- build (cost wood:2) is genuinely infeasible.
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 0 });
  const hive = hives['hive-a'];

  const network = buildBiasedNetwork();
  const rng = () => 0.01; // always picks the argmax-ish first bucket of whatever distribution is sampled
  const laneState = { verifierEnabled: true, sweeperState: undefined, gammaSweep: 1 };

  const result = trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);

  // The wiring must exist: divergence flags are real booleans, not the
  // silent `null` that trainTick() (pre-wiring) would produce because it
  // never received or consulted laneState at all.
  assert.equal(typeof result.verifier_changed_argmax, 'boolean');
  // AUTHOR's raw policy overwhelmingly favors 'build' (crafted weights), but
  // it is infeasible (wood: 0) -- VERIFIER must have changed the argmax away
  // from AUTHOR's raw preference.
  assert.equal(result.verifier_changed_argmax, true);
  // The actually-applied action must not be the infeasible build, precisely
  // because probs' zeroed it out before sampling -- if trainTick silently
  // ignored laneState, `build` would still dominate and result.action would
  // be 'build' (which would then hard-fail at the harness level, applied:false).
  assert.notEqual(result.action, 'build');
});

test('trainTick wires SWEEPER into decide(): recordOutcome actually grows the ring buffer across ticks', () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 10 });
  const hive = hives['hive-a'];

  const network = buildBiasedNetwork();
  const rng = () => 0.01;
  const sweeperState = createSweeperState(5);
  const laneState = { verifierEnabled: false, sweeperState, gammaSweep: 1 };

  assert.equal(sweeperState.buffer.length, 0);
  trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);
  assert.equal(sweeperState.buffer.length, 1, 'trainTick must call recordOutcome on the shared sweeperState after scoring the tick');
  assert.ok(VERB_ORDER.includes(sweeperState.buffer[0].verb), 'recorded verb must be from the 5-verb space, matching VERIFIER\'s mapping');
});

test('trainTick wires PLANNER into decide(): a committed goal boosts its served verb even against AUTHOR\'s raw preference for a different verb', () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 10 });
  const hive = hives['hive-a'];

  const network = buildBiasedNetwork(); // strongly favors 'build' (index 2)
  const rng = () => 0.01;
  const plannerState = createPlannerState(30);
  plannerState.currentGoal = GOALS.EXPAND_TERRITORY;
  plannerState.ticksRemaining = 30;
  const laneState = { verifierEnabled: false, plannerState, gammaSweep: 1 };

  const result = trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);

  assert.equal(typeof result.planner_changed_argmax, 'boolean');
  assert.equal(result.sweeper_changed_argmax, null, 'sweeper divergence field must stay null when only PLANNER is wired in');
});

test('trainTick wires PLANNER into the post-tick site: ticksRemaining actually decrements across ticks', () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 10 });
  const hive = hives['hive-a'];

  const network = buildBiasedNetwork();
  const rng = () => 0.5;
  const plannerState = createPlannerState(30);
  const laneState = { verifierEnabled: false, plannerState, gammaSweep: 1 };

  assert.equal(plannerState.currentGoal, null);
  trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);
  // First tick: pre-tick read saw the null/inert bootstrap state (goal not
  // yet committed); the post-tick site is where the very first commitment
  // happens.
  assert.notEqual(plannerState.currentGoal, null);
  assert.equal(plannerState.ticksRemaining, 30);
  trainTick(hive, worldStatePath, network, rng, {}, 1, undefined, {}, laneState);
  assert.equal(plannerState.ticksRemaining, 29);
});

test("PLANNER never zeroes idle's multiplier -- trainTick's laneMultipliers keep idle at 1 regardless of the committed goal", () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 10 });
  const hive = hives['hive-a'];

  const network = buildBiasedNetwork();
  const rng = () => 0.5;
  for (const goal of Object.values(GOALS)) {
    const plannerState = createPlannerState(30);
    plannerState.currentGoal = goal;
    plannerState.ticksRemaining = 30;
    const laneState = { verifierEnabled: false, plannerState, gammaSweep: 1 };
    const result = trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);
    assert.ok(typeof result.action === 'string', `expected an action for goal ${goal}`);
  }
});

test('trainTick with laneState omitted is byte-identical to the pre-triad code path', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePathA = path.join(root, 'a', 'world-state.json');
  const worldStatePathB = path.join(root, 'b', 'world-state.json');
  const hivesA = setupHives(path.join(root, 'a'), [seedA], worldStatePathA, { food: 10, wood: 10 });
  const hivesB = setupHives(path.join(root, 'b'), [seedB], worldStatePathB, { food: 10, wood: 10 });

  const netA = buildBiasedNetwork();
  const netB = buildBiasedNetwork();
  const rng = () => 0.5;

  const resultA = trainTick(hivesA['hive-a'], worldStatePathA, netA, rng, {}, 0);
  const resultB = trainTick(hivesB['hive-a'], worldStatePathB, netB, rng, {}, 0);

  assert.equal(resultA.verifier_changed_argmax, null);
  assert.equal(resultA.sweeper_changed_argmax, null);
  assert.equal(resultA.planner_changed_argmax, null);
  assert.deepEqual(netA, netB);
  assert.equal(resultA.action, resultB.action);
});
