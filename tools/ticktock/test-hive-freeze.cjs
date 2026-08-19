#!/usr/bin/env node
'use strict';

// tools/ticktock/test-hive-freeze.cjs -- acceptance tests for TRUE hive
// learning-OFF (review finding F1).
//
// The defect: benchmark-colony-v1.json declared "learning OFF" while
// untrained-network.js's trainStep() updated weights at a hard-coded
// LEARNING_RATE = 0.05 with no flag, no config key, and no way to disable it.
// The benchmark was reproducible, which is not the same property as frozen.
//
// The tests below check the two halves of the claim separately, because they
// can fail independently: (1) a frozen trainStep writes NOTHING, and (2) an
// unfrozen one still writes, so the freeze is a real switch rather than a
// learning path that had already stopped moving on its own.
//
// Run: node tools/ticktock/test-hive-freeze.cjs

const path = require('path');

const ENGINE = path.resolve(__dirname, '..', 'ant-hive-world');
const { createNetwork, trainStep, decide } = require(path.join(ENGINE, 'untrained-network.js'));

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${detail === undefined ? '' : JSON.stringify(detail)}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function snapshot(net) {
  return JSON.stringify({ W1: net.W1, b1: net.b1, W2: net.W2, b2: net.b2 });
}

function maxDelta(a, b) {
  let max = 0;
  for (const key of ['W1', 'W2']) {
    for (let i = 0; i < a[key].length; i += 1) {
      for (let j = 0; j < a[key][i].length; j += 1) {
        max = Math.max(max, Math.abs(a[key][i][j] - b[key][i][j]));
      }
    }
  }
  for (const key of ['b1', 'b2']) {
    for (let i = 0; i < a[key].length; i += 1) max = Math.max(max, Math.abs(a[key][i] - b[key][i]));
  }
  return max;
}

const HIVE_STATE = { identity: 'hive-a', hive_state: { stockpile: { food: 12, wood: 5 } } };
const WORLD_STATE = {
  resources: { food: 40, wood: 30, stone: 15 },
  territory: { 'tile-1': 'hive-a', 'tile-2': 'hive-b' },
  geometry_log: [{ hive: 'hive-a', kind: 'chamber', tick: 3 }],
  pheromones: {}
};

// ---------------------------------------------------------------------------
section('1. options.freeze === true writes NOT ONE parameter');
// ---------------------------------------------------------------------------
{
  const net = createNetwork(20260805);
  const before = snapshot(net);
  // A large reward, so a learning step would be unmistakably visible.
  for (let i = 0; i < 50; i += 1) {
    trainStep(net, HIVE_STATE, WORLD_STATE, i % 5, 10, 0.3, undefined, { freeze: true });
  }
  const after = snapshot(net);
  check('50 frozen trainStep calls leave the network byte-identical', before === after);
  check('no stray field is stamped onto the network object', Object.keys(net).sort().join(',') === 'W1,W2,b1,b2', Object.keys(net));
}

// ---------------------------------------------------------------------------
section('2. The switch is real: unfrozen still learns (a null result would be vacuous)');
// ---------------------------------------------------------------------------
{
  const net = createNetwork(20260805);
  const before = JSON.parse(snapshot(net));
  for (let i = 0; i < 50; i += 1) {
    trainStep(net, HIVE_STATE, WORLD_STATE, i % 5, 10, 0.3, undefined);
  }
  const delta = maxDelta(before, net);
  check('50 unfrozen trainStep calls DO move weights', delta > 1e-6, { max_abs_delta: delta });
  process.stdout.write(`        (max |delta| unfrozen: ${delta.toExponential(3)})\n`);
}

// ---------------------------------------------------------------------------
section('3. Default (options omitted) is unchanged: existing callers still learn');
// ---------------------------------------------------------------------------
{
  const a = createNetwork(777);
  const b = createNetwork(777);
  for (let i = 0; i < 20; i += 1) {
    trainStep(a, HIVE_STATE, WORLD_STATE, i % 5, 3, 0.3, undefined);              // no options at all
    trainStep(b, HIVE_STATE, WORLD_STATE, i % 5, 3, 0.3, undefined, {});          // empty options
  }
  check('omitting options and passing {} are identical', snapshot(a) === snapshot(b));
  check('and both are still learning', maxDelta(JSON.parse(snapshot(createNetwork(777))), a) > 1e-6);
  const c = createNetwork(777);
  for (let i = 0; i < 20; i += 1) trainStep(c, HIVE_STATE, WORLD_STATE, i % 5, 3, 0.3, undefined, { freeze: false });
  check('freeze: false is the same as no freeze', snapshot(a) === snapshot(c));
}

// ---------------------------------------------------------------------------
section('4. A frozen network keeps a FIXED policy (this is what "frozen" buys)');
// ---------------------------------------------------------------------------
{
  // With learning on, the same state stops mapping to the same action
  // distribution as weights move. With learning off it never stops. That
  // stability -- not seed determinism -- is what a frozen baseline means.
  const { forward, encodeState } = require(path.join(ENGINE, 'untrained-network.js'));
  const frozen = createNetwork(4242);
  const learning = createNetwork(4242);
  const probsAtStart = forward(frozen, encodeState(HIVE_STATE, WORLD_STATE)).probs.slice();

  for (let i = 0; i < 100; i += 1) {
    trainStep(frozen, HIVE_STATE, WORLD_STATE, 0, 5, 0.3, undefined, { freeze: true });
    trainStep(learning, HIVE_STATE, WORLD_STATE, 0, 5, 0.3, undefined);
  }
  const frozenProbs = forward(frozen, encodeState(HIVE_STATE, WORLD_STATE)).probs;
  const learningProbs = forward(learning, encodeState(HIVE_STATE, WORLD_STATE)).probs;
  const frozenShift = Math.max(...frozenProbs.map((p, i) => Math.abs(p - probsAtStart[i])));
  const learningShift = Math.max(...learningProbs.map((p, i) => Math.abs(p - probsAtStart[i])));

  check('a frozen policy does not drift at all', frozenShift === 0, { frozenShift });
  check('a learning policy demonstrably does', learningShift > 0.01, { learningShift });
  process.stdout.write(`        (policy shift over 100 steps -- frozen: ${frozenShift}, learning: ${learningShift.toFixed(4)})\n`);
  check('decide() still functions on a frozen network', typeof decide(frozen, HIVE_STATE, WORLD_STATE, () => 0.5).verb === 'string');
}

// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
