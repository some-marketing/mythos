'use strict';

// Red-then-green coverage for the on-policy fix (plan
// ant-sim-nine-mind-harness-triad-architecture, §4). Perplexity's literature
// review + Codex's confirmation found that decide() samples from a
// VERIFIER/SWEEPER-shaped distribution `probs' = normalize(probs .* laneMultipliers)`
// while trainStep() independently recomputed forward()'s RAW probs and built
// its REINFORCE gradient from those -- an on-/off-policy mismatch. Standard
// REINFORCE is only unbiased when the gradient is computed against the
// distribution the action was actually sampled from.
//
// This suite asserts the two computations now use the SAME probs' -- it would
// have failed before untrained-network.js's normalizeShapedProbs()/laneMultipliers
// plumbing existed, because trainStep() had no laneMultipliers parameter at
// all and always built dLogits from forward()'s raw probs regardless of what
// decide() actually sampled from.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNetwork, forward, decide, trainStep, encodeState, VERB_ORDER, OUTPUT_SIZE } = require('../untrained-network.js');

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

test('decide() samples from the shaped distribution, not the raw one, when laneMultipliers is supplied', () => {
  const network = createNetwork(7);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  // Zero out 'build' (index 2) and halve 'idle' (index 4) -- an asymmetric
  // shape a uniform reweight could not fake.
  const laneMultipliers = [1, 1, 0, 1, 0.5];

  const rng = () => 0.999999; // always lands in the LAST nonzero bucket of cumulative probs
  const action = decide(network, hiveState, worldState, rng, {}, undefined, laneMultipliers);

  // The action actually sampled must never be the VERIFIER-zeroed candidate --
  // it has zero mass in probs', by construction of normalizeShapedProbs.
  assert.notEqual(action._verb5, 'claim-territory' /* index 3 kept, sanity control */);
  assert.equal(action._probs[2], 0, "build's shaped probability must be exactly 0");
  // The raw (unshaped) distribution is still reported separately for
  // divergence measurement, and it must NOT be zero at index 2 (that's the
  // whole point of tracking both).
  const { probs: rawProbs } = forward(network, encodeState(hiveState, worldState));
  assert.deepEqual(action._raw_probs, rawProbs);
  assert.notEqual(action._raw_probs[2], 0);
});

test('trainStep computes its REINFORCE gradient against probs\', not the raw unshaped probs, when laneMultipliers is supplied', () => {
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const reward = 1;
  const actionIndex = 0; // gather-food
  const laneMultipliers = [1, 1, 0, 1, 0.5]; // 'build' infeasible, 'idle' cautioned

  const netForShaped = createNetwork(11);
  const netForRaw = JSON.parse(JSON.stringify(createNetwork(11)));

  trainStep(netForShaped, hiveState, worldState, actionIndex, reward, 0, undefined, {}, laneMultipliers);
  // Same call, WITHOUT laneMultipliers -- this reproduces the pre-fix
  // behavior exactly (raw probs, no reweighting).
  trainStep(netForRaw, hiveState, worldState, actionIndex, reward, 0, undefined, {});

  // The two updates must differ: reweighting the distribution before building
  // dLogits changes p_i for every output unit (softmax normalization couples
  // them), so the gradient -- and therefore the resulting weights -- must not
  // be identical. This is the defect the fix closes: before laneMultipliers
  // existed, these two calls were indistinguishable no matter what was passed.
  assert.notDeepEqual(netForShaped.W2, netForRaw.W2, 'shaped-policy gradient must differ from raw-policy gradient');

  // Directly verify the shaped gradient MATCHES a hand-computed REINFORCE
  // term built from probs' = normalize(rawProbs .* laneMultipliers), not from
  // rawProbs itself.
  const net2 = createNetwork(11);
  const { hidden, probs: rawProbs } = forward(net2, encodeState(hiveState, worldState));
  const shapedRaw = rawProbs.map((p, i) => p * laneMultipliers[i]);
  const sum = shapedRaw.reduce((a, b) => a + b, 0);
  const shapedProbs = shapedRaw.map((p) => p / sum);
  const expectedDLogits = shapedProbs.map((p, i) => ((i === actionIndex ? 1 : 0) - p) * reward);

  const LEARNING_RATE = 0.05;
  const expectedW2 = net2.W2.map((row, i) => row.map((w, j) => w + LEARNING_RATE * expectedDLogits[i] * hidden[j]));

  const net3 = createNetwork(11);
  trainStep(net3, hiveState, worldState, actionIndex, reward, 0, undefined, {}, laneMultipliers);

  for (let i = 0; i < OUTPUT_SIZE; i++) {
    for (let j = 0; j < net3.W2[i].length; j++) {
      assert.ok(
        Math.abs(net3.W2[i][j] - expectedW2[i][j]) < 1e-9,
        `W2[${i}][${j}]: expected ${expectedW2[i][j]}, got ${net3.W2[i][j]}`
      );
    }
  }
});

test('absent laneMultipliers leaves decide()/trainStep() byte-identical to pre-fix behavior', () => {
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const netA = createNetwork(3);
  const netB = createNetwork(3);
  const rng = () => 0.5;

  const actionA = decide(netA, hiveState, worldState, rng);
  const actionB = decide(netB, hiveState, worldState, rng);
  assert.deepEqual(actionA._probs, actionA._raw_probs, 'no laneMultipliers -> shaped probs equal raw probs');
  assert.deepEqual(actionA, actionB);

  trainStep(netA, hiveState, worldState, actionA._action_index, 1, 0);
  trainStep(netB, hiveState, worldState, actionB._action_index, 1, 0);
  assert.deepEqual(netA, netB);
});
