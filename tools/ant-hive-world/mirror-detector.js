#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/mirror-detector.js — the gate instrument for the
// three-sided embodied-mind experiment (operator 2026-08-03: "the gate we're
// going to use is 'will they create a simulation that mirrors this one in
// their world?'").
//
// A mirror is a built structure whose geometry encodes the world's layout
// beyond chance. This detector measures that: it correlates the build
// positions recorded in geometry_log against the discovered world-feature
// positions (wood/stone/water/ore/clay/fiber tiles), and compares the
// observed correspondence to a random-placement null via permutation.
//
// Statistic (mean nearest-feature distance): for each build, distance to the
// nearest discovered feature tile; smaller observed mean than the null =
// builds are landing near resources = a mirror forming. p-value = fraction
// of null shuffles with a mean as small or smaller.
//
// Usage: node mirror-detector.js [--sandbox-root <dir>] [--world-state <path>]
//        [--shuffles <n>] [--json]
//
// Pure read — never writes the sim. The dashboard calls it as a module.

const fs = require('fs');
const path = require('path');
const { readWorldState, tileToCoords } = require('./world-state.js');

const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const hasFlag = (flag) => process.argv.indexOf(flag) !== -1;
const JSON_OUT = hasFlag('--json');

const SANDBOX_ROOT = argVal('--sandbox-root', path.join(process.cwd(), '.ant-hive-sandbox'));
const WORLD_STATE_PATH = argVal('--world-state', path.join(SANDBOX_ROOT, 'shared', 'world-state.json'));
const SHUFFLES = parseInt(argVal('--shuffles', '1000'), 10);

// Feature tile index -> (x,y) via the shared 10x10 grid. Accepts both
// `tile-N` and `wood-tile-N` key shapes.
function featureCoords(worldState) {
  const out = [];
  const keys = ['food_sources', 'wood_sources', 'stone_sources', 'clay_sources', 'water_sources', 'ore_sources', 'fiber_sources'];
  for (const k of keys) {
    const src = worldState[k];
    if (!src || typeof src !== 'object') continue;
    for (const tileId of Object.keys(src)) {
      const c = tileToCoords(tileId);
      if (c) out.push(c);
    }
  }
  return out;
}

function buildCoords(worldState) {
  const out = [];
  const log = worldState && worldState.geometry_log;
  if (!Array.isArray(log)) return out;
  for (const e of log) {
    if (Array.isArray(e.coords) && e.coords.length >= 2) out.push([e.coords[0], e.coords[1]]);
  }
  return out;
}

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

// Mean nearest-feature distance for a set of builds against feature coords.
function meanNearest(builds, features) {
  if (!builds.length || !features.length) return null;
  let sum = 0;
  for (const b of builds) {
    let best = Infinity;
    for (const f of features) {
      const d = dist2(b, f);
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / builds.length;
}

// Random-placement null: shuffle build positions over the same grid extent
// (0..9 x 0..9) and recompute. p-value = P(null_mean <= observed_mean).
function permutationTest(builds, features, shuffles) {
  const observed = meanNearest(builds, features);
  if (observed === null) return { observed: null, p_value: null, null_mean: null, null_sd: null, n_builds: builds.length, n_features: features.length };
  let count = 0;
  let sum = 0;
  let sumsq = 0;
  for (let i = 0; i < shuffles; i++) {
    const shuffled = builds.map((b) => [Math.floor(Math.random() * 10), Math.floor(Math.random() * 10)]);
    const m = meanNearest(shuffled, features);
    if (m !== null) {
      if (m <= observed) count += 1;
      sum += m;
      sumsq += m * m;
    }
  }
  const nullMean = sum / shuffles;
  const variance = Math.max(0, sumsq / shuffles - nullMean * nullMean);
  return {
    observed,
    p_value: count / shuffles,
    null_mean: nullMean,
    null_sd: Math.sqrt(variance),
    n_builds: builds.length,
    n_features: features.length,
    shuffles
  };
}

function detect(worldState) {
  const builds = buildCoords(worldState);
  const features = featureCoords(worldState);
  const stat = permutationTest(builds, features, SHUFFLES);
  // Cluster guard (operator 2026-08-03): a single-point cluster near a feature
  // is NOT a mirror -- a mirror is a layout that encodes the world. Require
  // builds to span multiple distinct tiles before a small p can claim
  // mirror-forming; otherwise the verdict is cluster-not-mirror regardless of p.
  const distinctTiles = new Set(builds.map((b) => b[0] + ',' + b[1])).size;
  const MIN_SPREAD = 4;
  const verdict = stat.p_value === null ? 'no-data'
    : distinctTiles < MIN_SPREAD ? 'cluster-not-mirror'
    : stat.p_value < 0.05 ? 'mirror-forming'
    : stat.p_value < 0.2 ? 'approaching-null'
    : 'null-consistent';
  return {
    gate: 'mirror',
    ts: new Date().toISOString(),
    n_builds: builds.length,
    n_features: features.length,
    distinct_tiles: distinctTiles,
    min_spread: MIN_SPREAD,
    ...stat,
    verdict
  };
}

if (require.main === module) {
  const ws = readWorldState(WORLD_STATE_PATH);
  const result = detect(ws || {});
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`builds=${result.n_builds} features=${result.n_features} observed_mean_dist=${result.observed != null ? result.observed.toFixed(2) : 'n/a'} null_mean=${result.null_mean != null ? result.null_mean.toFixed(2) : 'n/a'} p=${result.p_value != null ? result.p_value.toFixed(3) : 'n/a'} verdict=${result.verdict}`);
  }
  process.exit(result.p_value === null ? 2 : 0);
}

module.exports = { detect, featureCoords, buildCoords, meanNearest, permutationTest };
