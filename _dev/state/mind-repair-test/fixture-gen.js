#!/usr/bin/env node
'use strict';

// _dev/state/mind-repair-test/fixture-gen.js
//
// Deterministic world-state fixture generator for the mind-repair liveness
// proof (plan ant-world-mind-network-repair, S1). One seed in, N world states
// out, byte-identical across runs and across the repair boundary -- which is
// the whole point: the SAME fixture is scored pre-repair and post-repair, so
// any difference in the measured policies is attributable to the repair and
// not to a different sample of states.
//
// The generator only produces the fields encodeWorldState() actually reads
// (resources, food_sources, territory, pheromones, hives[].hive_state.stockpile)
// and it deliberately spans a wide magnitude range on each of them, because a
// fixture clustered in one corner of the input space could not tell a
// state-sensitive policy from a state-blind one.

const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', '..', 'tools', 'ant-hive-world');
const { mulberry32 } = require(path.join(ENGINE, 'untrained-network.js'));

const FIXTURE_SEED = 20260805;
const FIXTURE_COUNT = 1000;

function intIn(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function buildState(rng) {
  const foodSourceCount = intIn(rng, 0, 25);
  const food_sources = {};
  for (let i = 0; i < foodSourceCount; i++) {
    food_sources[`tile-${intIn(rng, 0, 99)}-${i}`] = intIn(rng, 1, 30);
  }

  const territoryCount = intIn(rng, 0, 40);
  const territory = {};
  for (let i = 0; i < territoryCount; i++) {
    territory[`tile-${intIn(rng, 0, 99)}-${i}`] = rng() < 0.5 ? 'hive-a' : 'hive-b';
  }

  const pheromones = { food: {}, wood: {} };
  for (const kind of ['food', 'wood']) {
    const n = intIn(rng, 0, 12);
    for (let i = 0; i < n; i++) {
      pheromones[kind][`tile-${intIn(rng, 0, 99)}-${i}`] = Math.round(rng() * 800) / 100;
    }
  }

  const hiveCount = intIn(rng, 0, 6);
  const hives = {};
  for (let i = 0; i < hiveCount; i++) {
    // Half the hives are allowed to sit at or below zero food so the
    // starvation-pressure feature actually varies across the fixture.
    const food = rng() < 0.5 ? 0 : intIn(rng, 1, 60);
    hives[`hive-${i}`] = { hive_state: { stockpile: food } };
  }

  return {
    resources: { wood: intIn(rng, 0, 120), stone: intIn(rng, 0, 120), food: intIn(rng, 0, 120) },
    food_sources,
    territory,
    pheromones,
    hives
  };
}

function generateFixture(seed = FIXTURE_SEED, count = FIXTURE_COUNT) {
  const rng = mulberry32(seed);
  const states = [];
  for (let i = 0; i < count; i++) states.push(buildState(rng));
  return { seed, count, states };
}

module.exports = { generateFixture, FIXTURE_SEED, FIXTURE_COUNT };

if (require.main === module) {
  const fs = require('fs');
  const out = path.join(__dirname, 'fixture-world-states.json');
  const fixture = generateFixture();
  fs.writeFileSync(out, JSON.stringify({
    schema: 'MindRepairFixture/1.0',
    seed: fixture.seed,
    count: fixture.count,
    generator: '_dev/state/mind-repair-test/fixture-gen.js',
    states: fixture.states
  }));
  process.stdout.write(`wrote ${fixture.count} states (seed ${fixture.seed}) -> ${out}\n`);
}
