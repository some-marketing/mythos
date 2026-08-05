#!/usr/bin/env node
'use strict';

// _dev/state/mind-repair-test/prove-alive.js
//
// Liveness prover for the world mind (plan ant-world-mind-network-repair, S1).
// Scores the world-mind policy against the deterministic fixture from
// fixture-gen.js and reports each of the plan's r1-amended bounded criteria
// with its measured value, its threshold, and a pass/fail -- never a bare
// verdict, because a verdict without its number cannot be re-checked by the
// S3 trial.
//
// Criteria (coordinator defaults, operator-overridable, recorded in evidence):
//   (a) NaN/Infinity: zero, anywhere in any forward pass (hiddenPre, hidden,
//       logits, probs), across both probe seeds and all fixture states.
//   (b) Seed sensitivity: L2(policy(seed 1, s), policy(seed 999999, s)) > 0.01
//       on >= 90% of fixture states.
//   (c) State sensitivity: >= 100 distinct policy vectors over the fixture,
//       components compared at 1e-9.
//   (d) Non-degeneracy: 0.1 < mean per-state entropy < ln(5) - 0.05.
//   (e) Weight-update path: if one exists, pre/post checksums over a 300-tick
//       run must differ; if none exists, that is reported as the named
//       successor gap (thinks-but-cannot-learn), not silently passed.
//
// Usage:
//   node prove-alive.js --out <file.json> [--generation-dir <committed gen dir>]
//                       [--construction-seed <int>]
//
// This script is READ-ONLY with respect to the engine: it constructs networks
// in memory, never writes into tools/, and writes exactly one output file.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const ENGINE = path.join(__dirname, '..', '..', '..', 'tools', 'ant-hive-world');
const { forward } = require(path.join(ENGINE, 'untrained-network.js'));
const worldMindModule = require(path.join(ENGINE, 'world-mind.js'));
const { createWorldMind, encodeWorldState, WORLD_OUTPUT_SIZE } = worldMindModule;
const { generateFixture, FIXTURE_SEED, FIXTURE_COUNT } = require('./fixture-gen.js');

const THRESHOLDS = {
  nan_count_max: 0,
  seed_sensitivity_l2: 0.01,
  seed_sensitivity_pct_min: 0.9,
  distinct_policies_tolerance: 1e-9,
  distinct_policies_min: 100,
  entropy_mean_min: 0.1,
  entropy_mean_max: Math.log(WORLD_OUTPUT_SIZE) - 0.05
};

const PROBE_SEED_A = 1;
const PROBE_SEED_B = 999999;

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function isBad(x) {
  return typeof x !== 'number' || Number.isNaN(x) || !Number.isFinite(x);
}

// Count every non-finite value produced anywhere in a forward pass -- not just
// in the output. A policy can look fine while an intermediate is NaN only if
// the NaN is being swallowed downstream (relu(NaN) -> 0 is exactly how this
// bug hid), so the intermediates are where the honest check lives.
function scanPass(pass, tally) {
  for (const key of ['hiddenPre', 'hidden', 'logits', 'probs']) {
    for (const v of pass[key]) if (isBad(v)) tally[key] += 1;
  }
}

function l2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function entropy(probs) {
  return -probs.reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
}

// Quantize each component onto a 1e-9 lattice and key on the tuple. Two policy
// vectors count as the same iff every component lands in the same 1e-9 bin.
// This is a binning, not a clustering: two vectors differing by less than 1e-9
// but straddling a bin edge would be counted distinct. That direction of error
// inflates the count, so it is stated here rather than left implicit -- with a
// measured count far above the threshold it does not change the verdict, and
// the raw distances are reported alongside so the margin is inspectable.
function policyKey(probs, tolerance) {
  return probs.map((p) => Math.round(p / tolerance)).join('|');
}

function checksumNetwork(net) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ W1: net.W1, b1: net.b1, W2: net.W2, b2: net.b2 }))
    .digest('hex');
}

function main() {
  const outPath = argVal('--out', path.join(__dirname, 'liveness.json'));
  const generationDir = argVal('--generation-dir', null);
  const constructionSeedArg = argVal('--construction-seed', null);

  const fixture = generateFixture(FIXTURE_SEED, FIXTURE_COUNT);
  const netA = createWorldMind(PROBE_SEED_A);
  const netB = createWorldMind(PROBE_SEED_B);

  const tally = { hiddenPre: 0, hidden: 0, logits: 0, probs: 0 };
  const distinctA = new Set();
  const distinctB = new Set();
  const entropiesA = [];
  let seedSensitivePassing = 0;
  let l2Min = Infinity;
  let l2Max = -Infinity;
  let l2Sum = 0;

  for (const state of fixture.states) {
    const input = encodeWorldState(state);
    for (const v of input) if (isBad(v)) tally.hiddenPre += 1; // a bad input is a bad pass
    const passA = forward(netA, input);
    const passB = forward(netB, input);
    scanPass(passA, tally);
    scanPass(passB, tally);

    const d = l2(passA.probs, passB.probs);
    if (d > THRESHOLDS.seed_sensitivity_l2) seedSensitivePassing += 1;
    if (d < l2Min) l2Min = d;
    if (d > l2Max) l2Max = d;
    l2Sum += d;

    distinctA.add(policyKey(passA.probs, THRESHOLDS.distinct_policies_tolerance));
    distinctB.add(policyKey(passB.probs, THRESHOLDS.distinct_policies_tolerance));
    entropiesA.push(entropy(passA.probs));
  }

  const nanCount = tally.hiddenPre + tally.hidden + tally.logits + tally.probs;
  const pctPassing = seedSensitivePassing / fixture.count;
  const meanEntropy = entropiesA.reduce((a, b) => a + b, 0) / entropiesA.length;
  const minEntropy = Math.min(...entropiesA);
  const maxEntropy = Math.max(...entropiesA);

  // (e) Weight-update path. Two independent readings:
  //   STATIC: does any engine code path call a weight-update function with the
  //           world mind as its subject? (grep-equivalent, done in-process on
  //           the module surface so it cannot drift from what is loaded.)
  //   EMPIRICAL: if a committed generation is supplied, compare the world-mind
  //           parameters it carries against a freshly constructed network at
  //           the same construction seed. Identical => nothing moved the
  //           weights over the whole run.
  const engineSources = fs.readdirSync(ENGINE)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(ENGINE, f), 'utf8') }));
  const worldTrainCallers = engineSources
    .filter(({ text }) => /trainStep\s*\(\s*worldMind|worldMindTrain|trainWorldMind/.test(text))
    .map(({ file }) => file);
  const pathExists = worldTrainCallers.length > 0;

  const weightUpdate = {
    path_exists: pathExists,
    static_scan: {
      engine_files_scanned: engineSources.length,
      world_mind_update_callers: worldTrainCallers,
      note: pathExists
        ? 'a world-mind weight-update call site exists'
        : 'no engine file calls any weight-update function with the world mind as subject; trainStep() is called only with hive networks (train-tick.js)'
    },
    pre_checksum: null,
    post_checksum: null,
    empirical: null
  };

  if (generationDir) {
    const mindPath = path.join(generationDir, 'mind.json');
    const mind = JSON.parse(fs.readFileSync(mindPath, 'utf8'));
    const post = mind.world_mind.network;
    const seed = constructionSeedArg !== null
      ? Number(constructionSeedArg)
      : (() => {
        const rng = JSON.parse(fs.readFileSync(path.join(generationDir, 'rng.json'), 'utf8'));
        return rng.construction_seeds.world;
      })();
    const pre = createWorldMind(seed);
    weightUpdate.pre_checksum = checksumNetwork(pre);
    weightUpdate.post_checksum = checksumNetwork(post);
    weightUpdate.empirical = {
      generation_dir: generationDir,
      construction_seed: seed,
      ticks_elapsed: JSON.parse(fs.readFileSync(path.join(generationDir, 'identity.json'), 'utf8')).absolute_tick,
      checksums_differ: weightUpdate.pre_checksum !== weightUpdate.post_checksum,
      reading: weightUpdate.pre_checksum === weightUpdate.post_checksum
        ? 'world-mind parameters after the run are byte-identical to construction: no weight update occurred'
        : 'world-mind parameters moved during the run'
    };
  }

  const criteria = {
    a_no_nan: { measured: nanCount, threshold: THRESHOLDS.nan_count_max, pass: nanCount === 0, breakdown: tally },
    b_seed_sensitivity: {
      l2_threshold: THRESHOLDS.seed_sensitivity_l2,
      pct_threshold: THRESHOLDS.seed_sensitivity_pct_min,
      pct_passing: pctPassing,
      states_passing: seedSensitivePassing,
      l2_min: l2Min,
      l2_max: l2Max,
      l2_mean: l2Sum / fixture.count,
      pass: pctPassing >= THRESHOLDS.seed_sensitivity_pct_min
    },
    c_state_sensitivity: {
      tolerance: THRESHOLDS.distinct_policies_tolerance,
      threshold: THRESHOLDS.distinct_policies_min,
      distinct_seed_a: distinctA.size,
      distinct_seed_b: distinctB.size,
      pass: distinctA.size >= THRESHOLDS.distinct_policies_min
    },
    d_non_degeneracy: {
      mean: meanEntropy,
      min: minEntropy,
      max: maxEntropy,
      lower_bound: THRESHOLDS.entropy_mean_min,
      upper_bound: THRESHOLDS.entropy_mean_max,
      ln_output_size: Math.log(WORLD_OUTPUT_SIZE),
      pass: meanEntropy > THRESHOLDS.entropy_mean_min && meanEntropy < THRESHOLDS.entropy_mean_max
    },
    e_weight_update: weightUpdate
  };

  // DIAGNOSTIC (not a criterion, and deliberately not used to soften any
  // verdict). Criteria (b) and (d) are ABSOLUTE-magnitude bars on a policy
  // whose magnitude is set by the initial weight scale: randSmall() draws from
  // +/-0.1, two layers deep, so the logits of a freshly constructed network are
  // O(0.01) and its softmax is necessarily close to uniform no matter how well
  // the forward path works. That leaves two competing explanations for a (b)/(d)
  // failure -- "the repair did not really wire the inputs through" versus "the
  // inputs are wired through and the network is simply untrained" -- and a bare
  // pass/fail cannot tell them apart.
  //
  // This probe distinguishes them with a cheap check: multiply an in-memory COPY
  // of the weights by a scale factor and re-measure. If the forward path is
  // genuinely wired, amplification must produce a strongly non-uniform,
  // strongly seed-separated policy. If something were still broken, scaling
  // zeros or NaNs would change nothing. Nothing here is written back to the
  // engine; the real networks are untouched.
  function scaled(net, k) {
    return {
      W1: net.W1.map((r) => r.map((w) => w * k)),
      b1: net.b1.slice(),
      W2: net.W2.map((r) => r.map((w) => w * k)),
      b2: net.b2.slice()
    };
  }
  const amplification = [1, 10, 50].map((k) => {
    const sa = scaled(netA, k);
    const sb = scaled(netB, k);
    let ent = 0;
    let dsum = 0;
    let dmax = -Infinity;
    let spread = 0;
    for (const state of fixture.states) {
      const input = encodeWorldState(state);
      const pa = forward(sa, input).probs;
      const pb = forward(sb, input).probs;
      ent += entropy(pa);
      const d = l2(pa, pb);
      dsum += d;
      if (d > dmax) dmax = d;
      spread += Math.max(...pa) - Math.min(...pa);
    }
    return {
      weight_scale: k,
      mean_entropy: ent / fixture.count,
      mean_seed_l2: dsum / fixture.count,
      max_seed_l2: dmax,
      mean_prob_spread: spread / fixture.count
    };
  });

  const diagnostics = {
    note: 'weight-scale amplification probe -- evidence about WHY (b)/(d) land where they do; not a criterion and not used in any verdict',
    weight_scale_sweep: amplification,
    interpretation: amplification[2].mean_entropy < amplification[0].mean_entropy - 0.05
      ? 'the forward path is genuinely wired: scaling the same weights moves entropy and seed separation substantially, which is impossible if inputs were still being dropped'
      : 'amplification did NOT move the policy -- this would indicate the forward path is still not carrying the input signal'
  };

  const livenessPass = criteria.a_no_nan.pass && criteria.b_seed_sensitivity.pass
    && criteria.c_state_sensitivity.pass && criteria.d_non_degeneracy.pass;

  const report = {
    schema: 'MindLivenessProbe/1.0',
    measured_at: new Date().toISOString(),
    engine_shape: worldMindModule.ACTUAL_WORLD_MIND_SHAPE,
    encoder_feature_count: encodeWorldState({}).length,
    fixture: {
      path: '_dev/state/mind-repair-test/fixture-world-states.json',
      generator: '_dev/state/mind-repair-test/fixture-gen.js',
      seed: fixture.seed,
      count: fixture.count
    },
    probe_seeds: { a: PROBE_SEED_A, b: PROBE_SEED_B },
    thresholds: THRESHOLDS,
    criteria,
    diagnostics,
    // Three-valued on purpose. "alive" means every bounded criterion passed.
    // "not-alive" is reserved for a mind that is not reading its inputs at all
    // -- NaN present, one distinct policy, zero seed separation, which is
    // exactly the pre-repair reading. Anything in between is neither, and
    // collapsing it into either word would be a false report.
    liveness_verdict: livenessPass
      ? 'alive'
      : (criteria.a_no_nan.pass && criteria.c_state_sensitivity.pass
        ? 'reads-state-but-fails-magnitude-criteria'
        : 'not-alive')
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`\nwrote ${outPath}\n`);
}

main();
