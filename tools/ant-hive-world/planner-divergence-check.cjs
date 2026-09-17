#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/planner-divergence-check.cjs -- reusable measurement
// tool for plan ant-sim-three-lobe-lane-redesign's L1 acceptance criterion
// (design doc S9 falsifier): does PLANNER's ticksRemaining commitment
// mechanism actually change decisions, measured as the fraction of ticks
// where PLANNER's shaping flips the post-VERIFIER argmax
// (`planner_changed_argmax`)? A real falsifier -- this script's output can
// and should be reported honestly even when it comes back under the floor,
// per the design doc's own explicit instruction not to silently retry with
// a raised horizon or boosted GOAL_BOOST.
//
// Bounded, self-contained, single-hive -- NOT the L3/L4 multi-arm ablation
// (terminal_reward / territory_over_commitment_rate / contested_outcome
// comparison against a control arm across many seeds), which this script
// does not attempt. Parametrizable (--ticks, --seed, --horizon) so L3/L4
// can reuse this exact measurement across multiple seeds rather than each
// re-deriving it.
//
// Usage: node planner-divergence-check.cjs [--ticks N] [--seed N] [--horizon N]

const fs = require('fs');
const path = require('path');
const os = require('os');

const { setupHives } = require('./harness.js');
const { generateBlankHiveSeed } = require('./generate-blank-hive-seed.js');
const { trainTick } = require('./train-tick.js');
const { createPlannerState, DEFAULT_HORIZON } = require('./planner-lane.js');
const { createNetwork, mulberry32 } = require('./untrained-network.js');

function parseArgs(argv) {
  const out = { ticks: 2000, seed: 424242, horizon: DEFAULT_HORIZON };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ticks') out.ticks = Number(argv[++i]);
    else if (argv[i] === '--seed') out.seed = Number(argv[++i]);
    else if (argv[i] === '--horizon') out.horizon = Number(argv[++i]);
  }
  return out;
}

function runDivergenceCheck({ ticks, seed, horizon }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-planner-floor-'));
  const hiveSeed = generateBlankHiveSeed('hive-a', 'planner-divergence-check', new Date(0).toISOString());
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [hiveSeed], worldStatePath, { food: 200, wood: 200 });
  const hive = hives['hive-a'];

  const network = createNetwork(seed);
  const rng = mulberry32(seed + 1);
  const plannerState = createPlannerState(horizon);
  const laneState = { verifierEnabled: true, plannerState, gammaSweep: 1 };

  let observedTicks = 0;
  let divergedTicks = 0;
  for (let i = 0; i < ticks; i++) {
    const result = trainTick(hive, worldStatePath, network, rng, {}, i, undefined, {}, laneState);
    observedTicks += 1;
    if (result.planner_changed_argmax) divergedTicks += 1;
  }

  return { ticks: observedTicks, diverged: divergedTicks, rate: divergedTicks / observedTicks };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const DIVERGENCE_FLOOR = 0.01;
  const { ticks, diverged, rate } = runDivergenceCheck(opts);
  const clearsFloor = rate > DIVERGENCE_FLOOR;
  console.log(JSON.stringify({
    schema: 'PlannerDivergenceCheck/1.0',
    ticks,
    diverged_ticks: diverged,
    rate,
    rate_pct: `${(rate * 100).toFixed(2)}%`,
    floor: DIVERGENCE_FLOOR,
    clears_floor: clearsFloor,
    params: opts
  }, null, 2));
  process.exit(clearsFloor ? 0 : 1);
}

module.exports = { runDivergenceCheck, parseArgs };
