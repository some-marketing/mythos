'use strict';

// tools/ant-hive-world/embodiment-bridge/bridge-network.js -- plan
// ant-hive-world-embodiment-s2-bridge, S2.
//
// A small, standalone REINFORCE-style policy network for the physics
// bridge, SEPARATE from tools/ant-hive-world/untrained-network.js by
// deliberate operator decision (2026-07-17): the shared network's
// encodeState()/INPUT_SIZE are fixed to the abstract 9-dimensional
// resource-economy shape and are actively used by the sibling
// ant-hive-world-exploration-fix-hiveb-collapse plan's entropy-collapse
// debugging. Modifying that shared file to also accept a 7-dimensional
// physics-shaped input was assessed as a real coordination risk and
// explicitly declined in favor of this parallel, bridge-local network.
//
// Reuses ONLY the generic, stateless math utilities (mulberry32 seeded
// RNG, softmax) from untrained-network.js -- these are pure functions
// with no coupling to encodeState/INPUT_SIZE/the shared mind's weights,
// so reusing them carries none of the coordination risk that modifying
// the shared network's input shape would.
//
// Per the standing project rule (memory: ant-hive-world-fresh-minds-each-run,
// operator 2026-07-17 "we must delete the old sim minds and start fresh
// each time"): createNetwork() below is ALWAYS called fresh per run, NEVER
// loaded from disk or checkpointed. Do not add persistence here without
// explicit operator sign-off.

const { mulberry32, softmax } = require('../untrained-network.js');

const INPUT_SIZE = 7; // [pos_x, pos_y, pos_z, vel_x, vel_y, vel_z, distance_to_target]
const HIDDEN_SIZE = 8;
const ACTIONS = ['approach', 'idle']; // minimal action set, sufficient to prove the chain
const OUTPUT_SIZE = ACTIONS.length;

function randSmall(rng) {
  return (rng() - 0.5) * 0.2;
}

/**
 * Fresh, untrained network -- never loaded from disk, never checkpointed.
 * See memory/feedback_ant-hive-world-fresh-minds-each-run.md.
 */
function createNetwork(seed) {
  const rng = mulberry32(seed);
  const W1 = Array.from({ length: HIDDEN_SIZE }, () =>
    Array.from({ length: INPUT_SIZE }, () => randSmall(rng))
  );
  const b1 = Array.from({ length: HIDDEN_SIZE }, () => 0);
  const W2 = Array.from({ length: OUTPUT_SIZE }, () =>
    Array.from({ length: HIDDEN_SIZE }, () => randSmall(rng))
  );
  const b2 = Array.from({ length: OUTPUT_SIZE }, () => 0);
  return { W1, b1, W2, b2, seed };
}

function relu(x) {
  return x > 0 ? x : 0;
}

/**
 * Forward pass: perception vector -> action probability distribution.
 * @param {object} network
 * @param {number[]} input length-7 perception vector
 * @returns {{ hidden: number[], logits: number[], probs: number[] }}
 */
function forward(network, input) {
  if (input.length !== INPUT_SIZE) {
    throw new Error(`bridge-network forward(): expected input length ${INPUT_SIZE}, got ${input.length}`);
  }
  const hidden = network.W1.map((row, i) => {
    const sum = row.reduce((acc, w, j) => acc + w * input[j], network.b1[i]);
    return relu(sum);
  });
  const logits = network.W2.map((row, i) => {
    return row.reduce((acc, w, j) => acc + w * hidden[j], network.b2[i]);
  });
  const probs = softmax(logits);
  return { hidden, logits, probs };
}

/**
 * Perception vector from a bridge_step.py result's "perception" field.
 * @param {{pos: number[], vel: number[], distance_to_target: number}} perception
 * @returns {number[]} length-7 vector
 */
function encodePerception(perception) {
  return [
    perception.pos[0], perception.pos[1], perception.pos[2],
    perception.vel[0], perception.vel[1], perception.vel[2],
    perception.distance_to_target
  ];
}

/**
 * Sample a discrete action from a probability distribution.
 * @param {number[]} probs
 * @param {function(): number} rng
 * @returns {string} action label from ACTIONS
 */
function sampleAction(probs, rng) {
  const r = rng();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (r <= cumulative) return ACTIONS[i];
  }
  return ACTIONS[ACTIONS.length - 1];
}

module.exports = {
  INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE, ACTIONS,
  createNetwork, forward, encodePerception, sampleAction
};
