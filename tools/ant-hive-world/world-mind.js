#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/world-mind.js — a WORLD-LEVEL mind, one level above the
// hive minds. Operator (2026-08-03): set up a world mind per the embodied
// neural-net research — a fresh, untrained network that reads the FULL shared
// world-state (all hives, resources, pheromones, territory) and emits
// world-level coordination verbs.
//
// Doctrine honored (all hard rules, from the sim's own memory/doctrine):
//   - FRESH MINDS each run: this mind is created via createNetwork(seed),
//     weights live only in process memory, never loaded/checkpointed/persisted
//     (operator 2026-07-17: "delete the old sim minds and start fresh each time").
//   - CARRIAGE / COORDINATION, NOT AUTHORITY (no-godmode + solar-system-scoped
//     carriage ruling): the world mind never overrides or commands a hive's
//     decision. Its verbs are environmental and signaling — it shapes the
//     shared world (food spawn pressure, pheromone signal, decay rate) that
//     the hive minds perceive and react to, exactly as a real world's ecology
//     shapes its inhabitants without commanding them.
//   - A producer never validates its own trial: this mind's decisions are
//     logged as observations (run-log rows + world-state field) for the
//     dashboard and any reviewer; it does not grade itself.
//
// Architecture mirrors untrained-network.js on purpose: tiny feedforward net,
// REINFORCE-free at the world level for now (the world mind starts as a
// stochastic policy sampler over world verbs; a world-level reward signal is
// future work and must be proposed, not assumed).

const { createNetwork, forward, softmax, mulberry32 } = require('./untrained-network.js');
const {
  decayPheromones,
  depositPheromone,
  sumFoodSources
} = require('./world-state.js');

// World-level input features (all read-only observations of the shared world):
//   [ total_food, total_wood, total_stone, food_source_count, hive_count,
//     total_territory, pheromone_signal_strength, starvation_pressure ]
const WORLD_INPUT_SIZE = 8;
const WORLD_HIDDEN_SIZE = 8;
// World-level verbs — environmental/coordination, never hive commands:
//   0 seed-wood      -> world spawns a new wood source (ecological renewal)
//   1 seed-stone     -> world spawns a new stone source
//   2 signal-food    -> world deposits a food pheromone signal (stigmergic cue)
//   3 relax-decay    -> world slows pheromone decay (signal persists longer)
//   4 idle           -> no world action this tick (hands control back to hives)
const WORLD_OUTPUT_SIZE = 5;
const WORLD_VERB_ORDER = [
  'seed-wood',
  'seed-stone',
  'signal-food',
  'relax-decay',
  'idle'
];

// Normalization cap for raw world magnitudes (mirrors RESOURCE_NORM_K intent:
// fixed constant chosen from known scale, never tuned per-run).
const WORLD_RESOURCE_NORM_K = 40;

function normalizeWorldResource(x) {
  return x / (x + WORLD_RESOURCE_NORM_K);
}

function encodeWorldState(worldState) {
  const resources = (worldState && worldState.resources) || {};
  const foodSources = (worldState && worldState.food_sources) || {};
  const territory = (worldState && worldState.territory) || {};
  const pheromones = (worldState && worldState.pheromones) || {};

  let pheromoneStrength = 0;
  for (const kind of Object.keys(pheromones)) {
    for (const strength of Object.values(pheromones[kind] || {})) {
      pheromoneStrength += strength;
    }
  }

  // Starvation pressure: hives whose stockpile is at/below zero.
  const hiveStates = (worldState && worldState.hives) || {};
  const hiveIds = Object.keys(hiveStates);
  let starving = 0;
  for (const id of hiveIds) {
    const stock = hiveStates[id] && hiveStates[id].hive_state && hiveStates[id].hive_state.stockpile;
    if (stock !== undefined && stock <= 0) starving += 1;
  }

  const totalFood = sumFoodSources(foodSources);
  return [
    normalizeWorldResource(totalFood),
    normalizeWorldResource(resources.wood || 0),
    normalizeWorldResource(resources.stone || 0),
    normalizeWorldResource(Object.keys(foodSources).length),
    normalizeWorldResource(hiveIds.length),
    normalizeWorldResource(Object.keys(territory).length),
    normalizeWorldResource(pheromoneStrength),
    normalizeWorldResource(starving)
  ];
}

function createWorldMind(seed) {
  return createNetwork(seed);
}

// Sample a world verb from the network's policy. Pure observation + sampling:
// never reads hive sandboxes, never writes hive state, never overrides a hive
// decision. Returns the verb plus diagnostics (prob, entropy) for the log.
function decideWorld(network, worldState, rng, tickIndex) {
  const input = encodeWorldState(worldState);
  const { probs } = forward(network, input);
  const logitsEntropy = -probs.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0);
  // Sample from the policy (never argmax — stochastic world policy).
  let r = rng();
  let verbIndex = WORLD_OUTPUT_SIZE - 1;
  for (let i = 0; i < WORLD_OUTPUT_SIZE; i++) {
    r -= probs[i];
    if (r <= 0) { verbIndex = i; break; }
  }
  return {
    verb: WORLD_VERB_ORDER[verbIndex],
    verbIndex,
    prob: probs[verbIndex],
    entropy: logitsEntropy,
    input
  };
}

// Apply a world verb to the shared world state. Returns { applied, note }.
// Environmental/coordination actions only — the hives keep full agency.
function applyWorldVerb(state, decision, rng) {
  const verb = decision.verb;
  switch (verb) {
    case 'seed-wood': {
      const existing = state.wood_sources || {};
      if (Object.keys(existing).length >= 20) return { applied: false, note: 'wood source cap reached' };
      const tileId = `wood-tile-${Math.floor(rng() * 100)}`;
      if (!existing[tileId]) existing[tileId] = 4;
      state.wood_sources = existing;
      return { applied: true, note: `world seeded 1 wood source at ${tileId}` };
    }
    case 'seed-stone': {
      const existing = state.stone_sources || {};
      if (Object.keys(existing).length >= 20) return { applied: false, note: 'stone source cap reached' };
      const tileId = `stone-tile-${Math.floor(rng() * 100)}`;
      if (!existing[tileId]) existing[tileId] = 4;
      state.stone_sources = existing;
      return { applied: true, note: `world seeded 1 stone source at ${tileId}` };
    }
    case 'signal-food': {
      const tileId = `tile-${Math.floor(rng() * 100)}`;
      depositPheromone(state, 'food', tileId, 0.5);
      return { applied: true, note: `world deposited food signal at ${tileId}` };
    }
    case 'relax-decay': {
      decayPheromones(state, 0.9); // gentler than the default factor
      return { applied: true, note: 'world relaxed pheromone decay (factor 0.9)' };
    }
    case 'idle':
      return { applied: false, note: 'world idle — control with hives' };
    default:
      return { applied: false, note: `unknown world verb ${verb}` };
  }
}

module.exports = {
  WORLD_INPUT_SIZE,
  WORLD_HIDDEN_SIZE,
  WORLD_OUTPUT_SIZE,
  WORLD_VERB_ORDER,
  encodeWorldState,
  createWorldMind,
  decideWorld,
  applyWorldVerb
};
