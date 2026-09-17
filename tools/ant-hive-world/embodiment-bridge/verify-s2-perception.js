#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/embodiment-bridge/verify-s2-perception.js -- plan
// ant-hive-world-embodiment-s2-bridge, S2 required-gate check: "prove with
// a scripted check that the network can accept this input without error
// and produces a valid (non-NaN, in-distribution) action probability
// distribution -- not yet driving the physical body."

const { stepOnOrwell } = require('./bridge-client');
const { createNetwork, forward, encodePerception, ACTIONS } = require('./bridge-network');

const STEPS = 250;
const SEED = 12345; // fixed for this verification run only; real runs use a fresh non-repeating seed per the fresh-minds-each-run rule

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function main() {
  console.log('Requesting perception state from Orwell...');
  const result = stepOnOrwell(STEPS);

  const input = encodePerception(result.perception);
  console.log('Perception vector:', input);

  const network = createNetwork(SEED);
  const { probs } = forward(network, input);

  const checks = [];

  checks.push({
    name: `probs has ${ACTIONS.length} entries (one per action: ${ACTIONS.join(', ')})`,
    pass: Array.isArray(probs) && probs.length === ACTIONS.length
  });

  checks.push({
    name: 'all probs are finite numbers',
    pass: probs.every(isFiniteNumber)
  });

  checks.push({
    name: 'all probs in [0, 1]',
    pass: probs.every((p) => p >= 0 && p <= 1)
  });

  const sum = probs.reduce((a, b) => a + b, 0);
  checks.push({
    name: `probs sum to 1.0 (+/- 1e-6), got ${sum}`,
    pass: Math.abs(sum - 1.0) < 1e-6
  });

  let allPass = true;
  for (const check of checks) {
    console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.name}`);
    if (!check.pass) allPass = false;
  }

  if (allPass) {
    console.log('\nAction distribution:', ACTIONS.map((a, i) => `${a}=${probs[i].toFixed(4)}`).join(', '));
    console.log('\nS2_PERCEPTION_VERIFIED_OK');
    process.exit(0);
  } else {
    console.log('\nS2_PERCEPTION_VERIFICATION_FAILED');
    process.exit(1);
  }
}

main();
