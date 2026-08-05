#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/world-mind.js — a WORLD-LEVEL mind, one level above the
// hive minds. Operator (2026-08-03): set up a world mind per the embodied
// neural-net research — a fresh, untrained network that reads the FULL shared
// world-state (all hives, resources, pheromones, territory) and emits
// world-level coordination verbs.
//
// Doctrine honored (all hard rules, from the sim's own memory/doctrine):
//   - FRESH MINDS (operator ratification 2026-08-05): weights ARE serialized via
//     serializeWorldMind/restoreWorldMind (checkpoint.js), resuming the same
//     mind's lineage across turn boundaries. Never loads from previous lineages
//     or crosses the courier membrane. No learning/update path yet (plan
//     ant-world-mind-learning-path).
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
// WORLD_INPUT_SIZE is NOT declared here -- it is derived from encodeWorldState
// itself, below the encoder's definition, so there is exactly one source of
// truth for "how many features does this mind see." See the derivation and the
// repair note at the WORLD_INPUT_SIZE definition further down this file.
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

// SINGLE SOURCE OF TRUTH for the world mind's input width (plan
// ant-world-mind-network-repair, S0). This is a probe of the encoder, not a
// restatement of it: encodeWorldState is a pure function of its argument with
// a fixed-length return, so calling it once on an empty world at module load
// yields exactly the number of features it will emit on every real world too.
// Adding or removing a feature in encodeWorldState therefore resizes the
// network automatically -- there is no second number anywhere that a future
// edit could forget to update, which is the specific failure this repairs.
const WORLD_INPUT_SIZE = encodeWorldState({}).length;

// Construction-time shape assertion. The bug this repairs was silent: a
// network built at the wrong width still ran, still produced a probability
// vector, and still looked plausible in every log, because relu(NaN) is 0 and
// a zero hidden layer yields the zero-initialized logits' uniform softmax. So
// the guarantee cannot live in a comment or a constant -- it has to be a throw
// on the construction path, checked against a LIVE re-probe of the encoder
// rather than against the cached constant above (a cached constant would also
// go stale if createNetwork ever stopped honouring the dims it is handed).
function assertWorldMindShape(network) {
  const encoderFeatureCount = encodeWorldState({}).length;
  const w1Cols = network.W1[0].length;
  if (w1Cols !== encoderFeatureCount) {
    throw new Error(
      `world-mind construction: encoder emits ${encoderFeatureCount} features but W1 has ${w1Cols} columns ` +
      '-- a mismatch here makes every hidden unit NaN and the policy silently uniform'
    );
  }
  if (network.W1.some((row) => row.length !== encoderFeatureCount)) {
    throw new Error('world-mind construction: ragged W1 -- not every row matches the encoder feature count');
  }
  if (network.W1.length !== WORLD_HIDDEN_SIZE) {
    throw new Error(`world-mind construction: W1 has ${network.W1.length} rows, expected ${WORLD_HIDDEN_SIZE}`);
  }
  if (network.W2.length !== WORLD_OUTPUT_SIZE) {
    throw new Error(`world-mind construction: W2 has ${network.W2.length} rows, expected ${WORLD_OUTPUT_SIZE} verbs`);
  }
  if (network.W2.some((row) => row.length !== WORLD_HIDDEN_SIZE)) {
    throw new Error('world-mind construction: W2 column count does not match the hidden layer width');
  }
  if (network.b1.length !== WORLD_HIDDEN_SIZE || network.b2.length !== WORLD_OUTPUT_SIZE) {
    throw new Error('world-mind construction: bias vector length does not match its layer');
  }
  return network;
}

// The world mind's dimensions are ITS OWN, stated explicitly at the call site
// and verified immediately. It previously called createNetwork(seed) bare and
// inherited the hive network's INPUT_SIZE=9 by accident.
function createWorldMind(seed) {
  return assertWorldMindShape(createNetwork(seed, {
    inputSize: WORLD_INPUT_SIZE,
    hiddenSize: WORLD_HIDDEN_SIZE,
    outputSize: WORLD_OUTPUT_SIZE
  }));
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

// --- Checkpoint serialization (plan ant-world-checkpoint-loader, S1) --------
//
// The FRESH MINDS rule above is unchanged in substance and narrowed in scope by
// an explicit later operator ratification (2026-08-05, convene synthesis
// 20260805T014353Z): a world mind still never loads a mind from a PREVIOUS
// lineage, and its weights still never cross the courier membrane. What it may
// now do is continue its OWN lineage across a turn boundary, because a turn
// boundary is an artifact of how the guest is scheduled, not a fact about the
// world. "Fresh each run" was protecting against inherited instinct; resuming
// the same mind you were ten minutes ago is not inherited instinct.
//
// These two functions are deliberately dumb and total: the world mind IS a
// createNetwork() network, so its serialized form is its four parameter
// arrays and nothing else. No require of checkpoint.js from here -- checkpoint.js
// requires this module for its architecture descriptor, and a cycle between a
// contract and the thing it describes is a bug waiting for a load-order change.
const WORLD_MIND_RESOURCE_NORM_K = WORLD_RESOURCE_NORM_K;

// DEFECT HISTORY -- observed 2026-08-05, REPAIRED 2026-08-05 (plan
// ant-world-mind-network-repair, S0). Retained rather than deleted because the
// r6/r7 baselines and the checkpoint-loader evidence were all recorded under
// the broken behavior, and a reader of those artifacts needs to find this note.
//
// THE DEFECT (no longer present): createWorldMind() delegated to
// untrained-network.js's createNetwork() with no dimensions, so W1 was built at
// the HIVE network's [HIDDEN_SIZE=8][INPUT_SIZE=9] while encodeWorldState()
// returned 8 features. forward() read input[8] === undefined, every hiddenPre
// entry became NaN, relu(NaN) returned 0, and the logits collapsed to b2, which
// createNetwork initializes to zeros. Measured on a 1000-state fixture before
// the repair: 16,000 NaN hidden pre-activations, exactly ONE distinct policy
// vector, seed-to-seed L2 distance identically 0, entropy pinned at ln(5).
// The world mind was a uniform random verb sampler: weights inert, observations
// unread. That is what the r6 baseline's uniform world-verb distribution
// (600/570/594/591/645 over 3000 ticks) was actually measuring.
//
// THE REPAIR: createWorldMind() now passes its own dimensions, derived from
// encodeWorldState itself (WORLD_INPUT_SIZE above), and assertWorldMindShape()
// throws at construction if the encoder and W1 ever disagree again.
//
// CONSEQUENCE FOR CHECKPOINTS, and it is the intended one: the architecture
// hash covers both the declared sizes and the shape the engine actually builds,
// so every generation committed BEFORE this repair now fails the VERSION stage
// with resume-failed-halt:version:architecture-hash-mismatch rather than
// loading [8][9] weights into an [8][8] network. That refusal is the design
// working, not a regression.
//
// The parameters were serialized in full even while inert, which is what makes
// that refusal clean: nothing was dropped, so nothing is ambiguous. The shape
// check below still validates against the shape the engine ACTUALLY builds
// rather than against the declared constants -- post-repair the two agree
// (matches_declared === true), and keeping the check pointed at reality is what
// would catch a future divergence instead of assuming one cannot happen.
const ACTUAL_WORLD_MIND_SHAPE = (() => {
  const probe = createWorldMind(0);
  return {
    w1_rows: probe.W1.length,
    w1_cols: probe.W1[0].length,
    w2_rows: probe.W2.length,
    w2_cols: probe.W2[0].length,
    matches_declared: probe.W1[0].length === WORLD_INPUT_SIZE
      && probe.W1.length === WORLD_HIDDEN_SIZE
      && probe.W2.length === WORLD_OUTPUT_SIZE
  };
})();

function serializeWorldMind(network) {
  return {
    W1: network.W1.map((row) => row.slice()),
    b1: network.b1.slice(),
    W2: network.W2.map((row) => row.slice()),
    b2: network.b2.slice()
  };
}

// Restores parameters into a NEW object and refuses on any shape mismatch --
// loading an [8][8] matrix into a differently-shaped world mind is silent
// corruption, and silent corruption that still runs is worse than a halt.
function restoreWorldMind(payload) {
  if (!payload || !Array.isArray(payload.W1) || !Array.isArray(payload.W2)) {
    throw new Error('world-mind restore: payload is not a serialized network');
  }
  const s = ACTUAL_WORLD_MIND_SHAPE;
  if (payload.W1.length !== s.w1_rows || payload.W1.some((r) => r.length !== s.w1_cols)) {
    throw new Error(`world-mind restore: W1 shape mismatch (engine builds [${s.w1_rows}][${s.w1_cols}])`);
  }
  if (payload.W2.length !== s.w2_rows || payload.W2.some((r) => r.length !== s.w2_cols)) {
    throw new Error(`world-mind restore: W2 shape mismatch (engine builds [${s.w2_rows}][${s.w2_cols}])`);
  }
  if (payload.b1.length !== s.w1_rows || payload.b2.length !== s.w2_rows) {
    throw new Error('world-mind restore: bias length mismatch');
  }
  return {
    W1: payload.W1.map((row) => row.slice()),
    b1: payload.b1.slice(),
    W2: payload.W2.map((row) => row.slice()),
    b2: payload.b2.slice()
  };
}

module.exports = {
  WORLD_INPUT_SIZE,
  WORLD_HIDDEN_SIZE,
  WORLD_OUTPUT_SIZE,
  WORLD_VERB_ORDER,
  WORLD_MIND_RESOURCE_NORM_K,
  ACTUAL_WORLD_MIND_SHAPE,
  encodeWorldState,
  createWorldMind,
  decideWorld,
  applyWorldVerb,
  serializeWorldMind,
  restoreWorldMind
};
