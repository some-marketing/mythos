#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/verifier-breadth-check.cjs -- reusable measurement
// tool for plan ant-sim-three-lobe-lane-redesign's L2 acceptance evidence,
// mirroring planner-divergence-check.cjs's shape (parametrizable, bounded,
// single-hive, NOT the L3/L4 multi-arm ablation).
//
// Measures three things over a seeded run with VERIFIER+BREADTH active
// (verifier only -- no PLANNER, no SWEEPER -- so verifier_changed_argmax
// isolates this lane):
//
// 1. verifier_changed_argmax rate -- WIRING evidence only. Divergence is
//    NOT an outcome measure: the retired SWEEPER lane diverged at 4-6% and
//    produced no outcome effect across two well-powered ablations. A lane
//    passing a divergence check is wired, not working.
// 2. The contested_density distribution across currently-OPEN tiles,
//    sampled every tick (the population trainTick's claim candidate is
//    drawn from) -- the design doc S9 falsifier asks whether the graduated
//    score collapses to effectively-binary in practice at radius=1. In a
//    single-hive run the opponent never claims, so density is structurally
//    0 everywhere; the falsifier only becomes TESTABLE at the two-hive
//    ablation (L5). This tool reports that honestly instead of implying
//    the check passed.
// 3. gather-* presence-vs-magnitude disagreement per tick -- the ticks
//    where the pre-L2 food_sources entry-count presence check and the L2
//    resources.food magnitude check would disagree (entries exist, summed
//    quantity 0), i.e. what the gather half of L2 actually changes.
//
// Usage: node verifier-breadth-check.cjs [--ticks N] [--seed N]

const fs = require('fs');
const path = require('path');
const os = require('os');

const { setupHives } = require('./harness.js');
const { generateBlankHiveSeed } = require('./generate-blank-hive-seed.js');
const { trainTick } = require('./train-tick.js');
const { contestedDensity } = require('./verifier-lane.js');
const { createNetwork, mulberry32 } = require('./untrained-network.js');
const { readWorldState, TILE_GRID_SIZE, coordsToTile } = require('./world-state.js');

function parseArgs(argv) {
  const out = { ticks: 2000, seed: 424242 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ticks') out.ticks = Number(argv[++i]);
    else if (argv[i] === '--seed') out.seed = Number(argv[++i]);
  }
  return out;
}

function openTileDensities(worldState, identity) {
  const territory = worldState.territory || {};
  const densities = [];
  for (let y = 0; y < TILE_GRID_SIZE; y++) {
    for (let x = 0; x < TILE_GRID_SIZE; x++) {
      const tileId = coordsToTile(x, y);
      if (territory[tileId] !== undefined) continue; // not open
      const d = contestedDensity(territory, tileId, identity);
      if (d !== null) densities.push(d);
    }
  }
  return densities;
}

function runBreadthCheck({ ticks, seed }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-breadth-check-'));
  const hiveSeed = generateBlankHiveSeed('hive-a', 'verifier-breadth-check', new Date(0).toISOString());
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [hiveSeed], worldStatePath, { food: 200, wood: 200 });
  const hive = hives['hive-a'];

  const network = createNetwork(seed);
  const rng = mulberry32(seed + 1);
  const laneState = { verifierEnabled: true }; // verifier alone: no planner, no sweeper

  let observedTicks = 0;
  let divergedTicks = 0;
  let gatherDisagreementTicks = 0;
  const densityBuckets = { zero: 0, graduated: 0, one: 0 }; // per open-tile sample
  let openTileSamples = 0;

  for (let i = 0; i < ticks; i++) {
    const pre = readWorldState(worldStatePath);
    const presenceFeasible = Object.keys(pre.food_sources || {}).length > 0;
    const magnitudeFeasible = ((pre.resources || {}).food || 0) > 0;
    if (presenceFeasible !== magnitudeFeasible) gatherDisagreementTicks += 1;
    for (const d of openTileDensities(pre, 'hive-a')) {
      openTileSamples += 1;
      if (d === 0) densityBuckets.zero += 1;
      else if (d === 1) densityBuckets.one += 1; // unreachable by construction; counted to keep the falsifier honest
      else densityBuckets.graduated += 1;
    }
    const result = trainTick(hive, worldStatePath, network, rng, {}, i, undefined, {}, laneState);
    observedTicks += 1;
    if (result.verifier_changed_argmax) divergedTicks += 1;
  }

  return {
    ticks: observedTicks,
    verifier_diverged_ticks: divergedTicks,
    verifier_divergence_rate: divergedTicks / observedTicks,
    gather_presence_vs_magnitude_disagreement_ticks: gatherDisagreementTicks,
    open_tile_density_samples: openTileSamples,
    density_buckets: densityBuckets
  };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const r = runBreadthCheck(opts);
  console.log(JSON.stringify({
    schema: 'VerifierBreadthCheck/1.0',
    ...r,
    verifier_divergence_rate_pct: `${(r.verifier_divergence_rate * 100).toFixed(2)}%`,
    caveats: [
      'Divergence is wiring evidence, not efficacy: SWEEPER diverged 4-6% with no outcome effect across two well-powered ablations.',
      'The divergence rate measures the whole VERIFIER lane (no breadth-disabled control arm in this tool); attributing it to pre-existing feasibility masking is an INFERENCE from the two inertness measurements below, not an independently controlled result.',
      'Single-hive run: contested_density is structurally 0 with no opponent claimant; the S9 effectively-binary collapse falsifier is only TESTABLE at the two-hive ablation (L5).'
    ],
    params: opts
  }, null, 2));
}

module.exports = { runBreadthCheck, parseArgs };
