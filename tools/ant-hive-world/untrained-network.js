#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/untrained-network.js — a genuinely UNTRAINED network,
// seeded with small random weights, that learns entirely from the simulation
// itself. Operator (2026-07-16): "untrained network seeded with ants... the
// sim will be the training ground." This REPLACES llm-decide.js as the
// hive's decision mechanism -- a pretrained LLM (even prompted carefully)
// still carries enormous baked-in knowledge in its weights, which is
// pre-loaded instinct by another name. This network starts knowing nothing:
// no language, no strategy, no ant behavior -- only random initial weights
// and a tiny feedforward architecture.
//
// Reward signal (operator, 2026-07-16): survival/resource-based. A hive
// accumulates its own stockpile from successful gathers; upkeep decays that
// stockpile every tick; running out is a real, felt consequence (starvation),
// not just a number going down. This is what "let them figure it out through
// experience" actually requires at the model level, not just the seed level.
//
// No deep-learning dependency -- the state/action space here is tiny (a
// handful of numeric features -> 4 discrete actions), so a from-scratch,
// fully-inspectable feedforward net + REINFORCE-style update is more honest
// and auditable than pulling in a large ML framework for this scale.
//
// Stigmergy / pheromone trails (operator, 2026-07-16: "we wanted an ant
// based world though an ant based model"): the network's own architecture
// makes it ant-based, not just untrained -- foraging is mediated through
// reading and reinforcing a shared, environment-persisted trail field
// (world-state.js's pheromones), the actual mechanism real ant colonies use
// for indirect coordination, rather than sensing raw global pool counts and
// picking an arbitrary/random location. The network still decides WHETHER
// to forage/build/claim (learned via REINFORCE, no prior); WHERE a forage
// action lands is trail-following (exploit) vs. exploration, same
// exploit/explore balance real stigmergic systems run on.
const { strongestTrail } = require('./world-state.js');

const INPUT_SIZE = 9;   // [own_food, own_wood, shared_food, shared_wood, shared_stone, own_territory_count, own_structures_count, food_trail_strength, wood_trail_strength]
const HIDDEN_SIZE = 8;
const OUTPUT_SIZE = 5;  // gather-food, gather-wood, build, claim-territory, idle
const TRAIL_FOLLOW_PROB = 0.8;   // exploit a known trail this often when one exists
const TRAIL_SENSE_CAP = 10;      // normalization cap for the trail-strength input features
// Input normalization (plan ant-hive-world-exploration-fix-hiveb-collapse,
// S1/S2; resolved s4-normalization-escalation gate, amendment
// __amendment__20260718T185536Z, superseding s4-combination-escalation's
// update-clipping backstop). encodeState()'s raw own/shared resource-count
// features previously fed trainStep()'s forward pass at whatever magnitude
// the world happened to hold -- fixture-v1-scale inputs (~10) vs.
// run-live.js's REALISTIC RESOURCE_POOL scale ({food:40,wood:30,stone:15})
// produced a measured ~57x hidden-layer-energy amplification (hiddenNormSq
// ~=1.97 at fixture scale vs ~=113.47 at RESOURCE_POOL scale), which made
// candidate (c)'s dLogits-level clipping unworkable at ANY fixed clip value
// (a clip sweep across 0.05-50 all failed) -- the amplification happens
// upstream of dLogits, in the forward pass itself. RESOURCE_NORM_K is a
// FIXED constant chosen once, a priori, from the two known scales in this
// lineage (fixture-v1's own-food=10; RESOURCE_POOL's food/wood/stone of
// 40/30/15) -- not tuned per-run or adjusted after observing test results.
// normalizeResource() is a saturating x/(x+K) map: bounded to [0, 1), 0 at
// x=0, strictly monotone increasing, and a pure function of x alone (no
// cross-tick or cross-run state -- fresh-minds compliant). K=20 sits at the
// approximate geometric middle of the two known regimes, so neither the old
// fixture-v1 scale nor the RESOURCE_POOL scale sits at either normalized
// extreme.
const RESOURCE_NORM_K = 20;
// 'gather' is split into two distinct actions -- discovered necessary
// 2026-07-16: build costs wood, but a single undifferentiated 'gather'
// verb hardcoded to one resource gives the network no way to actually
// LEARN that wood is what building requires. Splitting the action lets
// that dependency be something it discovers, not something scripted in.
const VERB_ORDER = ['gather-food', 'gather-wood', 'build', 'claim-territory', 'idle'];
const LEARNING_RATE = 0.05;
const UPKEEP_COST = 1;  // stockpile consumed per tick just to keep existing

// Small mulberry32 PRNG so runs can be reproducible when a seed is supplied,
// while still being genuinely random (not zero-initialized) by default.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randSmall(rng) {
  // Small random init (roughly N(0, 0.1)-ish via a crude Box-Muller-free
  // approximation) -- untrained means "knows nothing," not "produces
  // exploding garbage." Small weights keep the initial policy close to
  // uniform-random over actions, which is the honest starting point.
  return (rng() - 0.5) * 0.2;
}

function createNetwork(seed) {
  const rng = mulberry32(seed === undefined ? Date.now() ^ Math.floor(Math.random() * 1e9) : seed);
  const W1 = Array.from({ length: HIDDEN_SIZE }, () => Array.from({ length: INPUT_SIZE }, () => randSmall(rng)));
  const b1 = Array.from({ length: HIDDEN_SIZE }, () => 0);
  const W2 = Array.from({ length: OUTPUT_SIZE }, () => Array.from({ length: HIDDEN_SIZE }, () => randSmall(rng)));
  const b2 = Array.from({ length: OUTPUT_SIZE }, () => 0);
  return { W1, b1, W2, b2 };
}

function relu(x) { return x > 0 ? x : 0; }
function reluDeriv(x) { return x > 0 ? 1 : 0; }

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// Shannon entropy in nats -- the actual measurement of "is the policy still
// exploring or has it collapsed onto one action." Max possible value for
// OUTPUT_SIZE actions is ln(OUTPUT_SIZE) (uniform distribution); 0 means
// fully deterministic (collapsed). Plan ant-hive-world-exploration-fix S3.
function computeEntropy(probs) {
  return -probs.reduce((sum, p) => (p > 0 ? sum + p * Math.log(p) : sum), 0);
}

function forward(network, input) {
  const { W1, b1, W2, b2 } = network;
  const hiddenPre = W1.map((row, i) => row.reduce((s, w, j) => s + w * input[j], b1[i]));
  const hidden = hiddenPre.map(relu);
  const logits = W2.map((row, i) => row.reduce((s, w, j) => s + w * hidden[j], b2[i]));
  const probs = softmax(logits);
  return { hiddenPre, hidden, logits, probs };
}

// Bounded, monotone, deterministic saturating normalization for a raw
// resource count: 0 at x=0, approaches 1 as x grows, never reaches or
// exceeds it. RESOURCE_NORM_K is a fixed constant (see above) -- this is
// NOT an adaptive/running normalization (no mean/variance tracking, no
// cross-tick memory of any kind), just a fixed pointwise map.
function normalizeResource(x) {
  const v = x || 0;
  return v / (v + RESOURCE_NORM_K);
}

function encodeState(hiveState, worldState) {
  const own = (hiveState.hive_state && hiveState.hive_state.stockpile) || {};
  const shared = worldState.resources || {};
  const territory = worldState.territory || {};
  const ownTerritory = Object.values(territory).filter((v) => v === hiveState.identity).length;
  const geometry = worldState.geometry_log || [];
  const ownStructures = geometry.filter((g) => g.hive === hiveState.identity).length;
  const foodTrail = strongestTrail(worldState, 'food').strength;
  const woodTrail = strongestTrail(worldState, 'wood').strength;
  return [
    normalizeResource(own.food),
    normalizeResource(own.wood),
    normalizeResource(shared.food),
    normalizeResource(shared.wood),
    normalizeResource(shared.stone),
    ownTerritory,
    ownStructures,
    Math.min(foodTrail, TRAIL_SENSE_CAP) / TRAIL_SENSE_CAP,
    Math.min(woodTrail, TRAIL_SENSE_CAP) / TRAIL_SENSE_CAP
  ];
}

// Where a gather action actually lands: exploit the strongest known trail
// for this resource kind most of the time (stigmergic recruitment -- a rich,
// reinforced spot draws foragers back to it, including from the OTHER hive
// sensing the same shared trail field); otherwise explore a fresh tile. Not
// hardcoded ant behavior -- the network still decides IF to gather at all,
// this only supplies the location a real forager would sense via trail.
function chooseForageTile(worldState, kind, rng, trailFollowProb) {
  const followProb = trailFollowProb === undefined ? TRAIL_FOLLOW_PROB : trailFollowProb;
  const draw = rng();
  const trail = strongestTrail(worldState, kind);
  if (trail.tileId && draw < followProb) return trail.tileId;
  return `tile-${Math.floor(rng() * 100)}`;
}

// Given a state, sample an action stochastically (untrained = must explore,
// never a fixed deterministic strategy) using an injectable rng for
// testability. `liveConfig` (optional) overrides trail_follow_prob --
// operator (2026-07-16): "i need to be able to modify variables in this
// dashboard."
//
// `tickIndex` (optional) + `liveConfig.forced_exploration_interval`
// implement periodic forced exploration (plan ant-hive-world-exploration-fix
// S2): every `forced_exploration_interval` ticks, ignore the learned policy
// and sample uniformly instead -- still trained on the outcome (trainStep
// is called normally with whatever action_index this returns). Disabled by
// default (undefined interval, or no tickIndex supplied) -- zero behavior
// change for every existing caller. Returns `forced_exploration: true/false`
// and `policy_entropy` explicitly so callers can log them, not infer them.
function decide(network, hiveState, worldState, rng, liveConfig = {}, tickIndex) {
  const input = encodeState(hiveState, worldState);
  const { probs } = forward(network, input);
  const r = (rng || Math.random)();

  const forcedInterval = liveConfig.forced_exploration_interval;
  const forced = Boolean(forcedInterval) && forcedInterval > 0 &&
    tickIndex !== undefined && (tickIndex % forcedInterval === 0);

  let chosenIndex;
  if (forced) {
    chosenIndex = Math.min(probs.length - 1, Math.floor(r * probs.length));
  } else {
    let cumulative = 0;
    chosenIndex = probs.length - 1;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) { chosenIndex = i; break; }
    }
  }

  const chosenVerb = VERB_ORDER[chosenIndex];
  const foragerRng = rng || Math.random;
  const trailFollowProb = liveConfig.trail_follow_prob;
  const policyEntropy = computeEntropy(probs);
  if (chosenVerb === 'gather-food') {
    const tileId = chooseForageTile(worldState, 'food', foragerRng, trailFollowProb);
    return { verb: 'gather', resourceKey: 'food', amount: 1, tileId, _action_index: chosenIndex, _probs: probs, policy_entropy: policyEntropy, forced_exploration: forced };
  }
  if (chosenVerb === 'gather-wood') {
    const tileId = chooseForageTile(worldState, 'wood', foragerRng, trailFollowProb);
    return { verb: 'gather', resourceKey: 'wood', amount: 1, tileId, _action_index: chosenIndex, _probs: probs, policy_entropy: policyEntropy, forced_exploration: forced };
  }
  if (chosenVerb === 'build') return { verb: 'build', entry: { kind: 'chamber', coords: null }, _action_index: chosenIndex, _probs: probs, policy_entropy: policyEntropy, forced_exploration: forced }; // coords null: the network decides IF to build, not WHERE -- harness resolves placement onto owned territory (operator 2026-08-03, mirror-gate geometry)
  if (chosenVerb === 'claim-territory') return { verb: 'claim-territory', tileId: `tile-${Math.floor((rng || Math.random)() * 100)}`, _action_index: chosenIndex, _probs: probs, policy_entropy: policyEntropy, forced_exploration: forced };
  return { verb: 'idle', _action_index: chosenIndex, _probs: probs, policy_entropy: policyEntropy, forced_exploration: forced };
}

// REINFORCE-style single-step update: nudge weights so the action taken
// becomes more (positive reward) or less (negative reward) likely given the
// state it was taken in. This is the actual learning step -- the network's
// weights change here, nowhere else.
//
// `entropyBonusWeight` (optional, default 0 = disabled) adds an entropy
// regularization term to the gradient (plan ant-hive-world-exploration-fix
// S1) -- counteracts policy collapse (observed: both hive-minds locking
// onto one action within ~100-300 ticks and never adapting again).
// Analytic gradient of softmax entropy H w.r.t. logit z_i is
// p_i * (-log(p_i) - H) (standard result, same form used for entropy
// bonuses in actor-critic / PPO-style policy gradients); weight=0 makes
// this term exactly 0, so every existing caller is unaffected.
//
// `updateClip` (optional, default undefined = disabled) is candidate (c)
// update-clipping (plan ant-hive-world-exploration-fix-hiveb-collapse, S4
// combination-escalation gate, amendment __amendment__20260718T183529Z):
// an L-infinity clamp on each output unit's dLogits value, applied BEFORE
// backprop, bounding how far a single trainStep() call can move the
// network's weights regardless of reward magnitude or raw-input scale.
// Added as a compositional backstop to candidate (b) (the decaying
// entropy schedule above, still primary) after S4's 2,000-tick live run
// showed (b) alone eliminates permanent collapse but leaves brief
// self-recovering sub-floor dips under REALISTIC (larger, unnormalized)
// resource-count inputs than the frozen S3 fixture uses -- see
// train-tick.js's computeEntropyBonusWeight() comment and the resolved
// s4-combination-escalation gate for the full incident. undefined
// (or any non-finite value) leaves dLogits completely untouched --
// byte-identical to every pre-existing caller that does not opt in.
function trainStep(network, hiveState, worldState, actionIndex, reward, entropyBonusWeight, updateClip) {
  const weight = entropyBonusWeight === undefined ? 0 : entropyBonusWeight;
  const input = encodeState(hiveState, worldState);
  const { hiddenPre, hidden, probs } = forward(network, input);
  const entropy = computeEntropy(probs);

  // dL/dlogits for softmax + the sampled action, scaled by reward (REINFORCE
  // gradient: (1[a=chosen] - prob[a]) * reward for each output unit), plus
  // the entropy-bonus gradient scaled by entropyBonusWeight.
  const clip = (updateClip === undefined || !(updateClip > 0)) ? undefined : updateClip;
  const dLogits = probs.map((p, i) => {
    const reinforceGrad = ((i === actionIndex ? 1 : 0) - p) * reward;
    const entropyGrad = weight === 0 ? 0 : weight * p * (-Math.log(Math.max(p, 1e-12)) - entropy);
    const raw = reinforceGrad + entropyGrad;
    if (clip === undefined) return raw;
    return Math.max(-clip, Math.min(clip, raw));
  });

  // Backprop into W2/b2, then hidden, then W1/b1.
  const dHidden = new Array(HIDDEN_SIZE).fill(0);
  for (let i = 0; i < OUTPUT_SIZE; i++) {
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      dHidden[j] += network.W2[i][j] * dLogits[i];
      network.W2[i][j] += LEARNING_RATE * dLogits[i] * hidden[j];
    }
    network.b2[i] += LEARNING_RATE * dLogits[i];
  }
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    const dPre = dHidden[j] * reluDeriv(hiddenPre[j]);
    for (let k = 0; k < INPUT_SIZE; k++) {
      network.W1[j][k] += LEARNING_RATE * dPre * input[k];
    }
    network.b1[j] += LEARNING_RATE * dPre;
  }
  return network;
}

// Apply upkeep decay to a hive's own stockpile -- the actual survival
// pressure. Returns { hiveState, starved } so callers can compute a
// starvation-reward penalty and log it as a real event, not a silent decay.
function applyUpkeep(hiveState, upkeepCost) {
  const cost = upkeepCost === undefined ? UPKEEP_COST : upkeepCost;
  const stockpile = { ...((hiveState.hive_state && hiveState.hive_state.stockpile) || {}) };
  const food = stockpile.food || 0;
  const nextFood = Math.max(0, food - cost);
  stockpile.food = nextFood;
  // `starved` is the positive-to-zero CROSSING. It is a published metric
  // (_dev/sim-runs/authority-probe.js:72 documents the terminology, and prior
  // results are reported in its units), so its definition must not move.
  const starved = food > 0 && nextFood === 0;
  // `foodExhausted` is the STATE: the hive ends this tick with nothing.
  // Distinct from the crossing because a hive already at zero never crosses,
  // and rewarding on the crossing alone inverts the incentive to forage —
  // see computeReward in train-tick.js.
  const foodExhausted = nextFood === 0;
  return {
    hiveState: { ...hiveState, hive_state: { ...hiveState.hive_state, stockpile } },
    starved,
    foodExhausted
  };
}

module.exports = {
  INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE, VERB_ORDER, UPKEEP_COST,
  TRAIL_FOLLOW_PROB, TRAIL_SENSE_CAP, RESOURCE_NORM_K,
  createNetwork, forward, softmax, computeEntropy, encodeState, decide, trainStep, applyUpkeep,
  chooseForageTile, mulberry32, normalizeResource
};
