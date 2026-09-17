#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/world-train.js -- the world mind's LEARNING PATH.
//
// Plan: ant-world-mind-learning-path, S1. Design authority: the S0 memo
// `_dev/reports/analysis/world-mind-learning-signal-memo__20260805.md`,
// candidate (c) -- one-step MASKED PREDICTION ERROR on a hidden-layer
// prediction head -- cleared by the G-LEARNING-SIGNAL-DESIGN design review
// (codex-cli-run__20260805T034254Z) and adopted by plan amendment r2.
//
// WHY THIS SIGNAL AND NOT AN OUTCOME REWARD (memo section 0, in one paragraph,
// because every other decision here follows from it): two of the world mind's
// five verbs -- `seed-wood` and `seed-stone` -- author the tiles that
// mirror-detector.js reads as "world features" (measured: 40 of the 46 feature
// tiles at tick 300, 87%). Any signal that optimizes the verb distribution
// therefore shapes the input to the mirror statistic, and the mirror gate stops
// measuring emergence and starts measuring the reward function. Mirror-safety
// is not a property you can add to a policy-optimizing signal by choosing
// reward terms carefully; it is the property of not optimizing the policy
// against outcomes at all. So this module trains a WORLD MODEL: the mind
// predicts the next tick's world features and learns from the miss. The policy
// changes only because the representation it reads changes.
//
// THE ONE HARD GUARANTEE THIS FILE MAKES: `W2` and `b2` -- the verb-preference
// weights -- are never written by this module. Not "left at zero gradient" --
// never written at all. assertLazyPredictionInvariant() below is the mechanical
// falsifier for that claim, and it runs at construction time (from
// world-mind.js's module load), not in a comment.
//
// DEPENDENCY DIRECTION, deliberately: this module requires ONLY
// untrained-network.js. world-mind.js requires THIS module (for head
// construction, serialization and the invariant assertions). A require of
// world-mind.js from here would be a cycle between the mind and its update
// rule, which is a load-order bug waiting to happen.

const { mulberry32 } = require('./untrained-network.js');

// --- Constants (memo section 3.2) ------------------------------------------
//
// No schedule, no decay, no adaptive optimizer, no clipping, no momentum. If
// S2 shows the update is too large or too small, the fix is a NEW contract
// version with its own hash -- not a knob that silently makes old evidence
// incomparable. Every constant below is part of `training_config_hash`
// (checkpoint.js), so a generation trained under different values is detectable
// rather than assumed comparable.

// Same numeric value as untrained-network.js's LEARNING_RATE (0.05), declared
// SEPARATELY here so the hive side and the world side can diverge deliberately
// rather than by accident. untrained-network.js does not export its constant
// and is outside this plan's write set, so the two are not mechanically linked;
// that is recorded as a known limitation rather than hidden.
const WORLD_LEARNING_RATE = 0.05;

// M -- the feature coordinates the loss is computed over. INCLUDED because none
// of them is a mirror-detector feature family or a build placement:
//   4 hive count            (not a feature family, not a build)
//   6 total pheromone       (not in mirror-detector's featureCoords key list)
//   7 starvation pressure   (hive-internal stockpiles, mirror-orthogonal)
const WORLD_LOSS_MASK = Object.freeze([4, 6, 7]);

// E -- the coordinates EXCLUDED from the loss (memo section 4.1). These are the
// mirror-detector's own feature families and the build-placement side of the
// mirror statistic:
//   0 total food across food_sources   3 food_sources count
//   1 resources.wood (wood_sources)    5 territory-tile count
//   2 resources.stone (stone_sources)
// KNOWN, BOUNDED COUPLING, stated rather than hidden: excluded coordinates
// remain INPUTS. The W1 gradient is `eta * dPre * x[k]` for every k, so an
// excluded coordinate still multiplies into the update even though it
// contributes nothing to delta. That is unavoidable for any signal -- the mind
// must read its world to think about it. The contract governs WHAT IS
// OPTIMIZED, not what is observed; the confound test (memo section 4.3, run in
// S2) is what adjudicates the residual empirically instead of by argument.
const WORLD_LOSS_EXCLUDED = Object.freeze([0, 1, 2, 3, 5]);

const WORLD_LEARNING_CONTRACT_VERSION = 1;
const WORLD_LOSS_FORM = 'masked-mse-onestep';
const WORLD_LAG_CONVENTION = 'prev-input-t, target-t+1, update-before-decide';

// The prediction head is drawn from a DERIVED stream, not from the world mind's
// own construction stream. The derivation matters: createWorldMind(seed) must
// keep calling createNetwork(seed, dims) with its existing draw order
// untouched, so W1/b1/W2/b2 for a given construction seed stay byte-identical
// to what they were before this module existed. Anything else silently
// invalidates prove-alive.js's reconstruct-and-compare check and every recorded
// repair-evidence number.
const WORLD_HEAD_SEED_DERIVATION_CONSTANT = 2654435761;

// Transcribed from untrained-network.js's randSmall (`(rng() - 0.5) * 0.2`)
// rather than imported, because that module does not export it and is outside
// this plan's write set. The literal is duplicated on purpose and flagged here
// so a future edit to one has an obvious second site to check.
function randSmall(rng) {
  return (rng() - 0.5) * 0.2;
}

// --- Head construction ------------------------------------------------------
// Wp : R[F][H]  prediction-head weights   (F = encoder feature count, H = hidden width)
// bp : R[F]     prediction-head biases    (zeros, exactly like createNetwork's b1/b2)
function createPredictionHead(seed, featureCount, hiddenSize) {
  for (const [name, value] of [['featureCount', featureCount], ['hiddenSize', hiddenSize]]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`createPredictionHead: ${name} must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }
  const rng = mulberry32((seed + WORLD_HEAD_SEED_DERIVATION_CONSTANT) >>> 0);
  return {
    Wp: Array.from({ length: featureCount }, () => Array.from({ length: hiddenSize }, () => randSmall(rng))),
    bp: Array.from({ length: featureCount }, () => 0)
  };
}

// --- Forward (prediction only; the policy path is untouched) ----------------
// z = W1.x + b1 ; h = relu(z) ; yhat = Wp.h + bp
// Pure: allocates and returns, writes NOTHING into `mind`.
function predictWorldFeatures(mind, x) {
  const { W1, b1, Wp, bp } = mind;
  const H = W1.length;
  const F = Wp.length;
  const z = new Array(H);
  const h = new Array(H);
  for (let j = 0; j < H; j++) {
    let s = b1[j];
    const row = W1[j];
    for (let k = 0; k < row.length; k++) s += row[k] * x[k];
    z[j] = s;
    h[j] = s > 0 ? s : 0;
  }
  const yhat = new Array(F);
  for (let i = 0; i < F; i++) {
    let s = bp[i];
    const row = Wp[i];
    for (let j = 0; j < H; j++) s += row[j] * h[j];
    yhat[i] = s;
  }
  return { z, h, yhat };
}

// L = (1/|M|) * sum_{j in M} (yhat[j] - target[j])^2
function maskedPredictionLoss(yhat, target) {
  let s = 0;
  for (const j of WORLD_LOSS_MASK) {
    const e = yhat[j] - target[j];
    s += e * e;
  }
  return s / WORLD_LOSS_MASK.length;
}

// --- The update (memo section 3.3) ------------------------------------------
//
// This is GRADIENT DESCENT ON A LOSS, so every sign is negative. That is the
// one place it deliberately differs from untrained-network.js's trainStep,
// which ASCENDS on reward. Loop order and the read-then-write convention for
// accumulating `dHidden` (read the pre-update weight into dHidden, THEN write
// the weight) are transcribed from trainStep exactly, so the two can be diffed
// side by side.
//
// `prevFeatures` is x_t (the state encoded at the PREVIOUS world block, before
// that tick's verb was applied); `targetFeatures` is x_{t+1} (this tick's
// encoding). A null/absent prevFeatures means there is no lagged pair to train
// on and the step is a no-op -- that is the lazy-prediction invariant's
// skipped-block behavior, not an error.
//
// `options.freeze === true` computes and reports the loss but writes NOTHING.
// That is the frozen-mind control arm (S2 criterion (e)): identical code path,
// identical reads, zero parameter motion, so the measured delta between arms
// isolates the update itself rather than any incidental difference.
function worldTrainStep(mind, prevFeatures, targetFeatures, options = {}) {
  if (!prevFeatures) {
    return { updated: false, reason: 'no-prev-features', loss: null, frozen: Boolean(options.freeze) };
  }
  if (!targetFeatures || targetFeatures.length !== prevFeatures.length) {
    throw new Error('worldTrainStep: target feature vector width does not match prev_features');
  }

  const { z, h, yhat } = predictWorldFeatures(mind, prevFeatures);
  const loss = maskedPredictionLoss(yhat, targetFeatures);

  if (options.freeze) {
    return { updated: false, reason: 'frozen', loss, frozen: true };
  }

  const eta = WORLD_LEARNING_RATE;
  const F = mind.Wp.length;
  const H = mind.W1.length;

  // Gradient at the head's output. Exactly zero on every EXCLUDED coordinate --
  // that is what "excluded from the reward computation" means mechanically.
  const delta = new Array(F).fill(0);
  const scale = 2 / WORLD_LOSS_MASK.length;
  for (const j of WORLD_LOSS_MASK) {
    delta[j] = scale * (yhat[j] - targetFeatures[j]);
  }

  const dHidden = new Array(H).fill(0);
  for (let i = 0; i < F; i++) {
    const row = mind.Wp[i];
    const di = delta[i];
    for (let j = 0; j < H; j++) {
      dHidden[j] += row[j] * di;   // pre-update Wp read ...
      row[j] -= eta * di * h[j];   // ... then written
    }
    mind.bp[i] -= eta * di;
  }

  for (let j = 0; j < H; j++) {
    const dPre = dHidden[j] * (z[j] > 0 ? 1 : 0);
    const row = mind.W1[j];
    for (let k = 0; k < row.length; k++) {
      row[k] -= eta * dPre * prevFeatures[k];
    }
    mind.b1[j] -= eta * dPre;
  }

  // W2 and b2 are not written. Not "left at zero gradient" -- not written at
  // all. assertLazyPredictionInvariant() proves it mechanically.

  return { updated: true, reason: 'applied', loss, frozen: false };
}

// --- Serialization (owner delegates from world-mind.js) ---------------------
function serializePredictionHead(mind) {
  return {
    Wp: mind.Wp.map((row) => row.slice()),
    bp: mind.bp.slice()
  };
}

function restorePredictionHead(payload, featureCount, hiddenSize) {
  if (!payload || !Array.isArray(payload.Wp) || !Array.isArray(payload.bp)) {
    throw new Error('prediction-head restore: payload is not a serialized head');
  }
  if (payload.Wp.length !== featureCount || payload.Wp.some((r) => !Array.isArray(r) || r.length !== hiddenSize)) {
    throw new Error(`prediction-head restore: Wp shape mismatch (engine builds [${featureCount}][${hiddenSize}])`);
  }
  if (payload.bp.length !== featureCount) {
    throw new Error(`prediction-head restore: bp length mismatch (engine builds [${featureCount}])`);
  }
  return { Wp: payload.Wp.map((row) => row.slice()), bp: payload.bp.slice() };
}

// prev_features is the ONLY carrier of the one-tick lag, which is exactly why
// it must be in the checkpoint: a mid-learning resume that lost it would skip
// one update and silently break the A/A-prime byte-identity S2(d) requires.
// `null` is a MEANINGFUL value (no lagged pair yet, or the world block was
// skipped) and is distinct from "a vector of zeros".
function serializePrevFeatures(mind) {
  return mind.prev_features === null || mind.prev_features === undefined
    ? null
    : mind.prev_features.slice();
}

function restorePrevFeatures(payload, featureCount) {
  if (payload === null || payload === undefined) return null;
  if (!Array.isArray(payload) || payload.length !== featureCount) {
    throw new Error(`prev_features restore: expected null or an array of ${featureCount} numbers`);
  }
  if (payload.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error('prev_features restore: non-finite entry');
  }
  return payload.slice();
}

// --- Construction-time assertions -------------------------------------------

function assertPredictionHeadShape(mind, featureCount, hiddenSize) {
  if (!mind || !Array.isArray(mind.Wp) || !Array.isArray(mind.bp)) {
    throw new Error('world-mind construction: prediction head (Wp, bp) is absent -- a world mind without a head cannot learn and must not be constructed');
  }
  if (mind.Wp.length !== featureCount) {
    throw new Error(`world-mind construction: Wp has ${mind.Wp.length} rows, expected ${featureCount} (encoder feature count)`);
  }
  if (mind.Wp.some((row) => !Array.isArray(row) || row.length !== hiddenSize)) {
    throw new Error(`world-mind construction: ragged Wp or wrong column count (expected ${hiddenSize} = hidden width)`);
  }
  if (mind.bp.length !== featureCount) {
    throw new Error(`world-mind construction: bp has ${mind.bp.length} entries, expected ${featureCount}`);
  }
  if (!(mind.prev_features === null || (Array.isArray(mind.prev_features) && mind.prev_features.length === featureCount))) {
    throw new Error('world-mind construction: prev_features must be null or a vector of the encoder feature count');
  }
  return mind;
}

function paramFingerprint(mind) {
  return JSON.stringify([mind.W1, mind.b1, mind.W2, mind.b2, mind.Wp, mind.bp]);
}

// THE LAZY-PREDICTION INVARIANT, asserted rather than relied upon.
//
// The memo's checkpoint footprint carries ONE 8-vector (prev_features) instead
// of the three stored activations (z, h, yhat). That is exact rather than an
// approximation only if theta is mutated at exactly ONE site, exactly once per
// world block. This drives the world block's arithmetic twice and throws if any
// of the four constituent claims fails:
//
//   1. predicting is pure          -- predictWorldFeatures writes no parameter
//   2. re-forming is exact         -- the same features under unchanged theta
//                                     give BIT-identical yhat, so re-forming
//                                     yhat at tick t+1 equals forming it at t
//   3. the update writes W1/b1/Wp/bp
//   4. the update NEVER writes W2/b2 (the mirror-safety guarantee)
//
// Called from world-mind.js at module load, on a throwaway probe mind, so a
// regression is a hard failure at require() time rather than a quiet drift
// discovered by a reviewer three arms later.
function assertLazyPredictionInvariant(mind, featureCount) {
  const x0 = Array.from({ length: featureCount }, (_, i) => 0.1 + i * 0.037);
  const x1 = Array.from({ length: featureCount }, (_, i) => 0.2 + i * 0.013);

  // (1) purity of prediction
  const before = paramFingerprint(mind);
  const p1 = predictWorldFeatures(mind, x0);
  predictWorldFeatures(mind, x1);
  if (paramFingerprint(mind) !== before) {
    throw new Error('lazy-prediction invariant: predictWorldFeatures mutated the mind -- prediction must be pure');
  }

  // (2) exactness of re-forming under unchanged theta
  const p2 = predictWorldFeatures(mind, x0);
  for (let i = 0; i < featureCount; i++) {
    if (!Object.is(p1.yhat[i], p2.yhat[i])) {
      throw new Error(`lazy-prediction invariant: re-formed prediction differs at coordinate ${i} under unchanged parameters`);
    }
  }

  // (3) + (4) the single update site, and what it is allowed to touch
  const w2Before = JSON.stringify([mind.W2, mind.b2]);
  const trunkBefore = JSON.stringify([mind.W1, mind.b1, mind.Wp, mind.bp]);
  const step = worldTrainStep(mind, x0, x1);
  if (!step.updated) {
    throw new Error('lazy-prediction invariant: worldTrainStep refused a well-formed lagged pair');
  }
  if (JSON.stringify([mind.W2, mind.b2]) !== w2Before) {
    throw new Error('lazy-prediction invariant: the learning signal wrote W2/b2 -- the verb-preference weights must never be touched (mirror safety)');
  }
  if (JSON.stringify([mind.W1, mind.b1, mind.Wp, mind.bp]) === trunkBefore) {
    throw new Error('lazy-prediction invariant: worldTrainStep reported an update but wrote no parameter');
  }

  // frozen mode must be a true no-op on parameters while still reporting a loss
  const frozenBefore = paramFingerprint(mind);
  const frozen = worldTrainStep(mind, x0, x1, { freeze: true });
  if (frozen.updated || typeof frozen.loss !== 'number') {
    throw new Error('lazy-prediction invariant: frozen mode must report a loss and apply no update');
  }
  if (paramFingerprint(mind) !== frozenBefore) {
    throw new Error('lazy-prediction invariant: frozen mode mutated the mind');
  }

  // a skipped world block leaves nothing to train on, and that is a no-op
  const skip = worldTrainStep(mind, null, x1);
  if (skip.updated || skip.loss !== null || skip.reason !== 'no-prev-features') {
    throw new Error('lazy-prediction invariant: a null prev_features must skip the update, not train on stale lag');
  }

  return { ok: true };
}

module.exports = {
  WORLD_LEARNING_RATE,
  WORLD_LOSS_MASK,
  WORLD_LOSS_EXCLUDED,
  WORLD_LEARNING_CONTRACT_VERSION,
  WORLD_LOSS_FORM,
  WORLD_LAG_CONVENTION,
  WORLD_HEAD_SEED_DERIVATION_CONSTANT,
  createPredictionHead,
  predictWorldFeatures,
  maskedPredictionLoss,
  worldTrainStep,
  serializePredictionHead,
  restorePredictionHead,
  serializePrevFeatures,
  restorePrevFeatures,
  assertPredictionHeadShape,
  assertLazyPredictionInvariant
};
