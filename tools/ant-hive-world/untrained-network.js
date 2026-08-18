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

// BASE_INPUT_SIZE (plan world-mind-dream-communication, S4, AMENDMENT v7):
// the original 9-element feature block -- [own_food, own_wood, shared_food,
// shared_wood, shared_stone, own_territory_count, own_structures_count,
// food_trail_strength, wood_trail_strength] -- unchanged in meaning or
// order. DREAM_FEATURE_SIZE is the fixed 9-slot dream-as-perception block
// appended after it: [dream_present (0/1), lane_darkness (0/1), lane_hope
// (0/1), targeted_verb_onehot (5 slots, matching VERB_ORDER below), // eslint-disable-line
// forecast_authority (0..1)]. INPUT_SIZE, the HIVE network's default input
// width, is genuinely 9->18 -- a real, acknowledged, precedented (VERIFIER/
// SWEEPER triad) lineage-breaking shape change, honestly declared here, not
// hidden behind a constant that still reads 9. world-mind.js's own network
// is UNAFFECTED: it always passes an explicit `dims.inputSize`
// (WORLD_INPUT_SIZE) to createNetwork(), which createNetwork() below treats
// as the caller's own complete shape, never split into base+dream slots.
const BASE_INPUT_SIZE = 9;
const DREAM_FEATURE_SIZE = 9;
const INPUT_SIZE = BASE_INPUT_SIZE + DREAM_FEATURE_SIZE; // 18
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

// `dims` (optional) lets a caller that is NOT a hive mind build a network at
// its own dimensions (plan ant-world-mind-network-repair, S0). Every field is
// optional and every default is this module's own constant, so an omitted
// `dims` -- which is every pre-existing caller -- produces a byte-identical
// network to the one this function built before the parameter existed: the
// same three Array.from loops consume the same rng draws in the same order.
//
// This exists because the world mind reused this constructor and silently
// inherited the HIVE's INPUT_SIZE (9) while its own encoder emitted 8
// features, so forward() read input[8] === undefined and every hidden unit
// became NaN. The fix is not a second hardcoded constant somewhere else --
// it is letting the caller state the shape ITS OWN encoder needs, and
// asserting the two agree at construction time (see world-mind.js).
// EXPANSION INITIALIZATION, PINNED ORDER (plan world-mind-dream-communication,
// S4, AMENDMENT v8 CRITICAL fix -- non-negotiable). Naively drawing `inputSize`
// RNG values per W1 row would consume MORE draws per row once inputSize grows
// 9->18, shifting every draw that follows (b1, W2, b2) relative to a pre-v7
// 9-input network seeded identically -- breaking both the byte-identical-
// forward-pass proof AND bit-identical old weights. The fix: for each hidden
// row, draw exactly `baseInputSize` RNG values (the ORIGINAL-SHAPE columns,
// in the EXACT SAME row-major sequence a pre-v7 9-input network draws), THEN
// append `inputSize - baseInputSize` ZERO-INITIALIZED columns -- literal 0.0,
// consuming ZERO additional RNG draws. b1, W2, b2 are then drawn in the same
// order and quantity as before, completely unperturbed.
//
// `baseInputSize` defaults to `inputSize` itself (every column RNG-drawn, zero
// appended columns) for every caller that does not explicitly opt into a
// split -- world-mind.js's `createNetwork(seed, {inputSize: WORLD_INPUT_SIZE})`
// call falls here and is therefore byte-identical to before this parameter
// existed. The ONE caller that DOES opt in is the hive network's own default:
// when `dims.inputSize` is omitted entirely (every existing `createNetwork(seed)`
// call in run-live.js), inputSize defaults to INPUT_SIZE (18) and baseInputSize
// defaults to BASE_INPUT_SIZE (9) -- exactly the split AC7's fixture requires.
// A caller may also request the split (or the old bare 9-input shape, e.g. for
// an AC7 comparison fixture) explicitly via `dims.inputSize`/`dims.baseInputSize`.
function createNetwork(seed, dims) {
  const d = dims || {};
  const inputSize = d.inputSize === undefined ? INPUT_SIZE : d.inputSize;
  const hiddenSize = d.hiddenSize === undefined ? HIDDEN_SIZE : d.hiddenSize;
  const outputSize = d.outputSize === undefined ? OUTPUT_SIZE : d.outputSize;
  const baseInputSize = d.baseInputSize !== undefined
    ? d.baseInputSize
    : (d.inputSize === undefined ? BASE_INPUT_SIZE : d.inputSize);
  for (const [name, value] of [['inputSize', inputSize], ['hiddenSize', hiddenSize], ['outputSize', outputSize], ['baseInputSize', baseInputSize]]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`createNetwork: ${name} must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }
  if (baseInputSize > inputSize) {
    throw new Error(`createNetwork: baseInputSize (${baseInputSize}) cannot exceed inputSize (${inputSize})`);
  }
  const rng = mulberry32(seed === undefined ? Date.now() ^ Math.floor(Math.random() * 1e9) : seed);
  const W1 = Array.from({ length: hiddenSize }, () => {
    const row = Array.from({ length: baseInputSize }, () => randSmall(rng));
    for (let k = baseInputSize; k < inputSize; k += 1) row.push(0);
    return row;
  });
  const b1 = Array.from({ length: hiddenSize }, () => 0);
  const W2 = Array.from({ length: outputSize }, () => Array.from({ length: hiddenSize }, () => randSmall(rng)));
  const b2 = Array.from({ length: outputSize }, () => 0);
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

// ZERO_DREAM_VECTOR (plan world-mind-dream-communication, S4): the inert
// default for encodeState()'s fourth parameter -- every one of the 9 slots
// exactly 0. forward()'s weighted sum contributes exactly 0 for any weight
// multiplying a 0 input, REGARDLESS of that weight's value (AC7's proof) --
// so a caller that never supplies dreamFeatures gets a forward pass
// mathematically identical to a pre-v7 9-input network. Frozen so it can
// never be mutated out from under a caller holding a reference to it.
const ZERO_DREAM_VECTOR = Object.freeze(new Array(DREAM_FEATURE_SIZE).fill(0));

// `dreamFeatures` (optional, default ZERO_DREAM_VECTOR; plan world-mind-
// dream-communication, S4, AMENDMENT v7): the dream-as-perception input
// block, appended after the 9 original features -- INPUT_SIZE grows 9->18.
// This is the CONCRETE ATTACHMENT POINT for dream signals: they become part
// of the hive mind's OBSERVED INPUT, never an injected or overridden
// action. train-tick.js computes ONE dreamFeatures value per tick (via
// dream-lane.js's checkTriggers()) and threads it, unchanged, to every
// encodeState() call this tick makes (decide(), trainStep(), and the
// policy_entropy_post_update recomputation) -- an implementation defect if
// any one of those three sees a different value than the other two for the
// same tick.
function encodeState(hiveState, worldState, dreamFeatures) {
  const own = (hiveState.hive_state && hiveState.hive_state.stockpile) || {};
  const shared = worldState.resources || {};
  const territory = worldState.territory || {};
  const ownTerritory = Object.values(territory).filter((v) => v === hiveState.identity).length;
  const geometry = worldState.geometry_log || [];
  const ownStructures = geometry.filter((g) => g.hive === hiveState.identity).length;
  const foodTrail = strongestTrail(worldState, 'food').strength;
  const woodTrail = strongestTrail(worldState, 'wood').strength;
  const df = dreamFeatures || ZERO_DREAM_VECTOR;
  return [
    normalizeResource(own.food),
    normalizeResource(own.wood),
    normalizeResource(shared.food),
    normalizeResource(shared.wood),
    normalizeResource(shared.stone),
    ownTerritory,
    ownStructures,
    Math.min(foodTrail, TRAIL_SENSE_CAP) / TRAIL_SENSE_CAP,
    Math.min(woodTrail, TRAIL_SENSE_CAP) / TRAIL_SENSE_CAP,
    ...df
  ];
}

// Where a gather action actually lands: exploit the strongest known trail
// for this resource kind most of the time (stigmergic recruitment -- a rich,
// reinforced spot draws foragers back to it, including from the OTHER hive
// sensing the same shared trail field); otherwise explore a fresh tile. Not
// hardcoded ant behavior -- the network still decides IF to gather at all,
// this only supplies the location a real forager would sense via trail.
// Episodic-escape food-yield fix (plan ant-sim-reward-specification-repair,
// S1) -- see live-config.js's gather_yield_food comment for the full
// derivation. INERT BY DEFAULT, matching computeEntropyBonusWeight's
// convention (train-tick.js): an absent, zero, negative, or otherwise
// non-positive value falls back to 1 -- byte-identical to pre-fix behavior
// for every caller that does not opt in. A pure function of liveConfig
// alone (no cross-tick or cross-run state).
function resolveGatherYieldFood(liveConfig) {
  const raw = liveConfig && liveConfig.gather_yield_food;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

// No-trail fallback used to draw uniformly over all 100 tiles, but food only
// ever occupies the 5-7 tiles in `worldState.food_sources` -- a ~95% miss
// rate that meant no gather ever landed on food, so no trail was ever
// deposited to make the trail-follow branch above fire (diagnostic
// food-targeting-diagnostic__20260811T074500Z.md). Gated on kind === 'food'
// because wood has no spatial source list at all (a global abstract pool
// claimed via claimResource, not claimFoodSource) -- an ungated change here
// would silently kill wood's uniform exploration for no reason.
function chooseForageTile(worldState, kind, rng, trailFollowProb) {
  const followProb = trailFollowProb === undefined ? TRAIL_FOLLOW_PROB : trailFollowProb;
  const draw = rng();
  const trail = strongestTrail(worldState, kind);
  if (trail.tileId && draw < followProb) return trail.tileId;

  if (kind === 'food') {
    const foodSources = worldState.food_sources || {};
    const activeSources = Object.keys(foodSources).filter((tileId) => {
      const amount = foodSources[tileId];
      return tileId !== '' && Number.isFinite(amount) && amount > 0;
    });
    if (activeSources.length > 0) {
      return activeSources[Math.floor(rng() * activeSources.length)];
    }
  }
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
//
// `laneMultipliers` (optional, plan ant-sim-nine-mind-harness-triad-architecture,
// S3) is an array of OUTPUT_SIZE non-negative scalars, one per VERB_ORDER index --
// VERIFIER's feasible(a) times SWEEPER's (1 - gamma_sweep*caution(a)), combined by
// the CALLER (train-tick.js), not derived here. When supplied, decide() samples
// from the SHAPED distribution `probs' = normalize(probs .* laneMultipliers)`
// instead of the raw softmax output, and the `_probs` field returned below is
// probs' -- the distribution actually sampled from, not the network's raw
// output. This is the decision-time half of the on-policy fix (plan §4): the
// action leaving this function was drawn from probs', so any REINFORCE update
// on it must be computed against probs', never against the raw probs it did
// NOT sample from. `_raw_probs` carries the unshaped distribution separately,
// for divergence measurement (verifier_changed_argmax / sweeper_changed_argmax,
// plan §7.1) -- the caller already has laneMultipliers, so recomputing it from
// _raw_probs costs nothing extra. Absent laneMultipliers (every pre-existing
// caller, and every hive/world-mind not opted into the triad): behavior is
// byte-identical to before this parameter existed -- probs' === probs.
function normalizeShapedProbs(probs, laneMultipliers) {
  if (!laneMultipliers) return probs;
  const shaped = probs.map((p, i) => p * Math.max(0, laneMultipliers[i] ?? 1));
  const sum = shaped.reduce((a, b) => a + b, 0);
  // Degenerate case (every candidate zeroed) -- never happens under this
  // plan's own design (idle's feasible(a) is always 1, verifier-lane.js), but
  // guarded rather than assumed: falling back to the raw policy over a hard
  // veto keeps "VERIFIER/SWEEPER re-weight, they never stamp" true even in a
  // pathological multiplier set.
  if (!(sum > 0)) return probs;
  return shaped.map((p) => p / sum);
}

// The uniform draw decide()'s claim-territory branch has always used to
// pick a target tile (previously inlined at that branch). Extracted so a
// caller that needs to know the candidate BEFORE decide() samples a verb
// (VERIFIER's feasibility check, verifier-lane.js -- it cannot honestly
// check "is this candidate feasible" without knowing which tile the
// candidate is) can draw it once, hand it to decide() via
// `precomputedClaimTileId`, and have decide() reuse that value instead of
// drawing a second, independent tile. One rng() call either way -- this
// only relocates it earlier in the sequence, it never duplicates it.
function pickClaimTerritoryTile(rng) {
  return `tile-${Math.floor((rng || Math.random)() * 100)}`;
}

function decide(network, hiveState, worldState, rng, liveConfig = {}, tickIndex, laneMultipliers, precomputedClaimTileId, dreamFeatures) {
  const input = encodeState(hiveState, worldState, dreamFeatures);
  const { probs: rawProbs } = forward(network, input);
  const probs = normalizeShapedProbs(rawProbs, laneMultipliers);
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
  // policy_entropy is measured against probs' (the shaped, actually-sampled
  // distribution) when laneMultipliers is present -- entropy of a
  // distribution the policy did not sample from would not describe this
  // tick's actual exploration. Byte-identical to before when absent.
  const policyEntropy = computeEntropy(probs);
  const base = { _action_index: chosenIndex, _verb5: chosenVerb, _probs: probs, _raw_probs: rawProbs, policy_entropy: policyEntropy, forced_exploration: forced };
  if (chosenVerb === 'gather-food') {
    const tileId = chooseForageTile(worldState, 'food', foragerRng, trailFollowProb);
    const amount = resolveGatherYieldFood(liveConfig);
    return { verb: 'gather', resourceKey: 'food', amount, tileId, ...base };
  }
  if (chosenVerb === 'gather-wood') {
    const tileId = chooseForageTile(worldState, 'wood', foragerRng, trailFollowProb);
    return { verb: 'gather', resourceKey: 'wood', amount: 1, tileId, ...base };
  }
  if (chosenVerb === 'build') return { verb: 'build', entry: { kind: 'chamber', coords: null }, ...base }; // coords null: the network decides IF to build, not WHERE -- harness resolves placement onto owned territory (operator 2026-08-03, mirror-gate geometry)
  if (chosenVerb === 'claim-territory') {
    const tileId = precomputedClaimTileId || pickClaimTerritoryTile(rng);
    return { verb: 'claim-territory', tileId, ...base };
  }
  return { verb: 'idle', ...base };
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
// `options.freeze === true` is TRUE LEARNING-OFF for the hive network, and it
// is a real freeze rather than a small learning rate: the forward pass runs,
// the gradients are computed, and NOT ONE PARAMETER IS WRITTEN. It mirrors
// world-train.js's worldTrainStep({freeze: true}) deliberately -- the same word
// meaning the same thing on both learning paths, so "learning OFF" is one
// claim about the engine instead of two claims that happen to share a name.
//
// Added for review finding F1 (tools/ticktock/benchmark-colony-v1.json declared
// "learning OFF" while this function updated weights at a hard-coded 0.05 with
// no way to disable it). A frozen baseline that keeps learning is not frozen.
// Default (options omitted) is UNCHANGED behavior for every existing caller:
// learning stays on unless someone asks for it to stop.
//
// The return value gains `_frozen` for observability and keeps returning the
// network itself, so no existing caller's use of the return value changes.
//
// `laneMultipliers` (optional, last param, plan ant-sim-nine-mind-harness-
// triad-architecture, S3 -- the on-policy fix). REINFORCE is only an
// unbiased gradient estimator when the action was actually SAMPLED from the
// distribution the gradient is computed against. If the caller shaped
// decide()'s sampling with VERIFIER's feasible(a) / SWEEPER's caution(a)
// (untrained-network.js's `normalizeShapedProbs`), the action reaching this
// function was drawn from probs' = normalize(probs .* laneMultipliers), NOT
// from forward()'s raw probs -- so the gradient must be built from probs',
// too, or the update is biased toward actions the true behavior policy could
// not have produced (a VERIFIER-zeroed candidate must never receive a
// nonzero REINFORCE term, because the actual sampling policy could not have
// picked it). The CALLER (train-tick.js) passes the identical
// laneMultipliers array used at decision time -- decision-time and
// training-time shaping are the same computation, not two independent
// re-derivations that could drift. Absent (every pre-existing caller, and
// every hive/world-mind not opted into the triad): probs' === probs,
// byte-identical gradient to before this parameter existed.
function trainStep(network, hiveState, worldState, actionIndex, reward, entropyBonusWeight, updateClip, options = {}, laneMultipliers, dreamFeatures) {
  const freeze = options.freeze === true;
  const weight = entropyBonusWeight === undefined ? 0 : entropyBonusWeight;
  const input = encodeState(hiveState, worldState, dreamFeatures);
  const { hiddenPre, hidden, probs: rawProbs } = forward(network, input);
  const probs = normalizeShapedProbs(rawProbs, laneMultipliers);
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

  // Backprop into W2/b2, then hidden, then W1/b1. Under freeze the same
  // quantities are computed in the same order -- dHidden reads W2 before this
  // iteration would have written it, exactly as in the learning path, so the
  // gradient is the identical number either way -- and the four assignment
  // statements are simply not executed.
  const dHidden = new Array(HIDDEN_SIZE).fill(0);
  for (let i = 0; i < OUTPUT_SIZE; i++) {
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      dHidden[j] += network.W2[i][j] * dLogits[i];
      if (!freeze) network.W2[i][j] += LEARNING_RATE * dLogits[i] * hidden[j];
    }
    if (!freeze) network.b2[i] += LEARNING_RATE * dLogits[i];
  }
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    const dPre = dHidden[j] * reluDeriv(hiddenPre[j]);
    for (let k = 0; k < INPUT_SIZE; k++) {
      if (!freeze) network.W1[j][k] += LEARNING_RATE * dPre * input[k];
    }
    if (!freeze) network.b1[j] += LEARNING_RATE * dPre;
  }
  // Nothing is stamped onto `network` here, deliberately: the network object is
  // what gets serialized into checkpoints, and a freeze must leave it byte-for-
  // byte as it found it. Whether learning was frozen is the CALLER's fact, and
  // run-live.js records it in run-log provenance where it belongs.
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
  INPUT_SIZE, BASE_INPUT_SIZE, DREAM_FEATURE_SIZE, HIDDEN_SIZE, OUTPUT_SIZE, VERB_ORDER, UPKEEP_COST,
  TRAIL_FOLLOW_PROB, TRAIL_SENSE_CAP, RESOURCE_NORM_K, ZERO_DREAM_VECTOR,
  createNetwork, forward, softmax, computeEntropy, encodeState, decide, trainStep, applyUpkeep,
  chooseForageTile, mulberry32, normalizeResource, resolveGatherYieldFood, normalizeShapedProbs,
  pickClaimTerritoryTile
};
