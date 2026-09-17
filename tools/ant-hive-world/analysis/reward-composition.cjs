#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/analysis/reward-composition.cjs -- W1, plan
// reward-weights-ablation. ANALYSIS-ONLY over EXISTING telemetry. Zero new
// sim runs, zero engine edits, zero writes outside this tool's three owned
// artifacts (this file + the two W1 output artifacts).
//
// INPUT CONTRACT (plan W1 detail, verbatim scope):
//   (a) the gen-2 generation manifest
//       _dev/state/ticktock/generations/tt-gen-2-run-003.20260814.json,
//       followed to its run-log pointer _dev/sim-runs/tt-gen-2-run-003/run-log.jsonl
//   (b) rcds control-run shim telemetry
//       _dev/sim-runs/rcds-ablation/control-*/srd2-telemetry.jsonl
//
// AMBIGUITY NAMED AND RESOLVED (not guessed): srd2-telemetry.jsonl carries
// no `action` or `reward` field -- it is environment-shim telemetry (spawn/
// regrow/grazing/gathers/food_sources_after/upkeep), structurally identical
// in shape to the srd2/rcds balance-audit lineage's input, and cannot supply
// the per-tick reward or action/outcome this step's cross-assertion and
// share computation require. Each `control-*` directory also contains a
// `run-log.jsonl` with the IDENTICAL per-tick-row schema as the gen-2
// run-log (action, resource_key, applied, territory_outcome,
// territory_reward_contribution, food_exhausted, reward, reward_contract_
// version, policy_entropy, policy_entropy_post_update, stockpile) --
// confirmed by direct read of both files before this tool was written. This
// tool therefore reads `run-log.jsonl` from every `control-*` directory as
// the reward-bearing source for input (b), and still reads and sha256-
// receipts `srd2-telemetry.jsonl` per the letter of the input contract even
// though it does not enter the reward-composition computation -- its
// receipt is recorded in the artifact under `srd2_telemetry_receipts` so
// the declared input is provably read, not silently substituted.
//
// RAW-VS-BONUS DISTINCTION (plan W1 requirement, resolved from the run-log
// schema, stated before any share is computed): the persisted `reward`
// field is the RAW output of train-tick.js's computeReward() (verified by
// direct code read, train-tick.js:232-251, and by manual cross-check on
// sample rows before this tool was written -- e.g. a failed build under
// food_exhausted: -0.5 + -2 = -2.5, matches the persisted row exactly).
// computeReward() takes no entropy term as input. The decaying entropy-
// bonus schedule (computeEntropyBonusWeight, train-tick.js:271-281) and the
// reactive entropy controller are a SEPARATE training-signal channel
// (`effective_entropy_bonus_weight`) that steers the policy-gradient
// entropy term, not the environment reward -- they do not enter `reward` at
// any point in the source. `reward` is therefore RAW reward throughout this
// artifact; no entropy-bonus-adjusted reward field exists in this schema to
// distinguish it from.
//
// HIVE-ROW FILTER: rows with hive === 'world' (relax-decay / world-mind
// bookkeeping rows) carry no `reward` field and are excluded. Only
// hive === 'hive-a' | 'hive-b' rows are analyzed, separately then combined,
// per the plan's stated filter.
//
// CROSS-ASSERTION (plan W1, fail-closed): every hive-a/hive-b row's reward
// is independently recomputed from its own action/outcome fields via the
// v3 weight table (train-tick.js:185-195 resolveRewardWeights, read-only;
// this tool hardcodes the shipped v3 defaults and additionally asserts each
// run's own reward-semantics.json / live-config.json reports those exact
// defaults -- a run with a non-default weight would fail this assertion and
// the run fails closed rather than being silently scored against the wrong
// table). Any recomputed-vs-persisted mismatch on any row fails that run's
// entry closed, naming the file, the row index (0-based within the
// filtered hive-a/hive-b sequence), and both values.
//
// PENALTY DIAGNOSTICS (v4, outer-leg F1/F2, orchestrator-directed): 95%
// firing does NOT make reward_food_exhausted a constant baseline shift --
// it is a state/trajectory-dependent living cost. This tool computes (i)
// variance of the per-trajectory firing rate ACROSS trajectories (seed x
// hive), (ii) variance of the firing rate ACROSS time-to-go (tick deciles,
// pooled), and (iii) population covariance of the exhaustion indicator with
// each action-taken indicator (gather, build, claim-territory) and with
// post-tick stockpile.food. NO CLAIM OF GRADIENT NEUTRALITY IN EITHER
// DIRECTION is made anywhere in this artifact -- W1 measures, W2 tests.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GEN2_MANIFEST_PATH = path.join(REPO_ROOT, '_dev', 'state', 'ticktock', 'generations', 'tt-gen-2-run-003.20260814.json');
const RCDS_DIR = path.join(REPO_ROOT, '_dev', 'sim-runs', 'rcds-ablation');
const OUT_JSON = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'reward-weights-ablation__composition.json');
const OUT_MD = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'reward-weights-ablation__composition.md');

const EPSILON = 1e-9;

// v3 shipped defaults, train-tick.js:185-195 resolveRewardWeights(). Every
// run consumed here is asserted (not assumed) to report these exact values
// in its own reward-semantics.json / live-config.json before being scored
// against this table.
const V3_DEFAULTS = {
  buildApplied: 1.5,
  gatherFoodApplied: 1,
  gatherWoodApplied: 0.3,
  claimTerritoryNew: 0.5,
  idle: 0,
  actionFailed: -0.5,
  foodExhausted: -2
};
const V3_DEFAULT_LIVECONFIG_KEYS = {
  reward_build_applied: V3_DEFAULTS.buildApplied,
  reward_gather_food_applied: V3_DEFAULTS.gatherFoodApplied,
  reward_gather_wood_applied: V3_DEFAULTS.gatherWoodApplied,
  reward_claim_territory_new: V3_DEFAULTS.claimTerritoryNew,
  reward_idle: V3_DEFAULTS.idle,
  reward_action_failed: V3_DEFAULTS.actionFailed,
  reward_food_exhausted: V3_DEFAULTS.foodExhausted
};

const TERM_KEYS = ['gather_food_applied', 'gather_wood_applied', 'build_applied', 'territory_new', 'territory_already_owned', 'idle', 'action_failed', 'food_exhausted'];

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Str(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function mean(arr) { return arr.length ? sum(arr) / arr.length : null; }
function variance(arr) {
  if (!arr.length) return null;
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}
function covariance(xs, ys) {
  if (xs.length === 0 || xs.length !== ys.length) return null;
  const mx = mean(xs), my = mean(ys);
  return mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
}
function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Territory reward component, independently mirroring
// train-tick.js:215-225 territoryRewardContribution() for cross-assertion.
function territoryComponent(row) {
  const outcome = row.territory_outcome;
  if (outcome === undefined || outcome === null || outcome === 'not_applicable') {
    // Not a claim-territory verb this tick (shouldn't reach here for
    // non-territory verbs; guarded by caller's verb dispatch).
    return { value: 0, term: 'territory_already_owned' };
  }
  if (outcome === 'already_owned') return { value: 0, term: 'territory_already_owned' };
  if (outcome === 'newly_acquired') return { value: V3_DEFAULTS.claimTerritoryNew, term: 'territory_new' };
  // 'contested' -- the claim genuinely did not land
  return { value: V3_DEFAULTS.actionFailed, term: 'action_failed' };
}

// Independent recomputation mirroring train-tick.js:232-251 computeReward(),
// split into (actionComponent, exhaustionComponent, term) for the share
// breakdown, plus the recomposed total for cross-assertion.
function recompute(row) {
  let actionValue, term;
  if (row.action === 'gather') {
    if (!row.applied) { actionValue = V3_DEFAULTS.actionFailed; term = 'action_failed'; }
    else if (row.resource_key === 'wood') { actionValue = V3_DEFAULTS.gatherWoodApplied; term = 'gather_wood_applied'; }
    else { actionValue = V3_DEFAULTS.gatherFoodApplied; term = 'gather_food_applied'; }
  } else if (row.action === 'build') {
    actionValue = row.applied ? V3_DEFAULTS.buildApplied : V3_DEFAULTS.actionFailed;
    term = row.applied ? 'build_applied' : 'action_failed';
  } else if (row.action === 'claim-territory') {
    const t = territoryComponent(row);
    actionValue = t.value;
    term = t.term;
  } else if (row.action === 'idle') {
    actionValue = V3_DEFAULTS.idle;
    term = 'idle';
  } else {
    return { fail: `unrecognized action '${row.action}'` };
  }
  const exhaustionValue = row.food_exhausted ? V3_DEFAULTS.foodExhausted : 0;
  return { actionValue, term, exhaustionValue, total: actionValue + exhaustionValue };
}

function assertDefaultWeights(dir) {
  const rsPath = path.join(dir, 'reward-semantics.json');
  const lcPath = path.join(dir, 'live-config.json');
  const source = fs.existsSync(rsPath) ? rsPath : (fs.existsSync(lcPath) ? lcPath : null);
  if (!source) return { ok: false, reason: `neither reward-semantics.json nor live-config.json present in ${dir}` };
  const doc = JSON.parse(fs.readFileSync(source, 'utf8'));
  const semantics = doc.reward_semantics || doc;
  for (const [key, expected] of Object.entries(V3_DEFAULT_LIVECONFIG_KEYS)) {
    if (semantics[key] !== expected) {
      return { ok: false, reason: `${path.relative(REPO_ROOT, source)} key '${key}' = ${semantics[key]}, expected v3 default ${expected}` };
    }
  }
  return { ok: true, source: path.relative(REPO_ROOT, source), sha256: sha256File(source) };
}

// Process one run-log.jsonl into per-hive trajectory records. Returns
// fail_closed:true with a named reason on any cross-assertion mismatch or
// weight-default violation.
function processRunLog(label, seed, runLogPath) {
  const dir = path.dirname(runLogPath);
  const weightCheck = assertDefaultWeights(dir);
  const sha = sha256File(runLogPath);
  const base = { label, seed, run_log_path: path.relative(REPO_ROOT, runLogPath), run_log_sha256: sha };
  if (!weightCheck.ok) {
    return { ...base, fail_closed: true, reason: `weight-default assertion failed: ${weightCheck.reason}` };
  }
  const rows = readJsonl(runLogPath);
  const byHive = { 'hive-a': [], 'hive-b': [] };
  let filteredIndex = 0;
  for (const row of rows) {
    if (row.hive !== 'hive-a' && row.hive !== 'hive-b') continue; // exclude world rows
    const rec = recompute(row);
    if (rec.fail) {
      return { ...base, fail_closed: true, reason: `row (filtered index ${filteredIndex}, tick ${row.tick}, hive ${row.hive}): ${rec.fail}` };
    }
    const mismatch = Math.abs(rec.total - row.reward) > EPSILON;
    if (mismatch) {
      return {
        ...base,
        fail_closed: true,
        reason: `cross-assertion mismatch at file=${path.relative(REPO_ROOT, runLogPath)} row(filtered_index)=${filteredIndex} tick=${row.tick} hive=${row.hive}: recomputed=${rec.total} persisted=${row.reward}`
      };
    }
    byHive[row.hive].push({
      tick: row.tick,
      action: row.action,
      applied: row.applied,
      term: rec.term,
      action_value: rec.actionValue,
      food_exhausted: !!row.food_exhausted,
      exhaustion_value: rec.exhaustionValue,
      reward: row.reward,
      policy_entropy: row.policy_entropy,
      policy_entropy_post_update: row.policy_entropy_post_update,
      stockpile_food: (row.stockpile && typeof row.stockpile.food === 'number') ? row.stockpile.food : 0
    });
    filteredIndex += 1;
  }
  if (byHive['hive-a'].length === 0 || byHive['hive-b'].length === 0) {
    return { ...base, fail_closed: true, reason: `missing rows for one or both hives (hive-a=${byHive['hive-a'].length}, hive-b=${byHive['hive-b'].length})` };
  }
  return { ...base, fail_closed: false, weight_source: weightCheck.source, weight_source_sha256: weightCheck.sha256, byHive };
}

function shareTable(rows) {
  const totals = {};
  for (const k of TERM_KEYS) totals[k] = 0;
  for (const r of rows) {
    totals[r.term] += Math.abs(r.action_value);
    if (r.food_exhausted) totals.food_exhausted += Math.abs(r.exhaustion_value);
  }
  const grandTotal = sum(Object.values(totals));
  const shares = {};
  for (const k of TERM_KEYS) shares[k] = grandTotal > 0 ? totals[k] / grandTotal : null;
  return { totals, grand_total_abs_reward: grandTotal, shares };
}

function firingRate(rows) {
  const n = rows.length;
  const fired = rows.filter((r) => r.food_exhausted).length;
  return { n, fired, rate: n > 0 ? fired / n : null };
}

function entropyTrajectory(rows) {
  const pe = rows.map((r) => r.policy_entropy).filter((x) => typeof x === 'number');
  const peu = rows.map((r) => r.policy_entropy_post_update).filter((x) => typeof x === 'number');
  return {
    policy_entropy_min: pe.length ? Math.min(...pe) : null,
    policy_entropy_first: pe.length ? pe[0] : null,
    policy_entropy_final: pe.length ? pe[pe.length - 1] : null,
    policy_entropy_post_update_min: peu.length ? Math.min(...peu) : null,
    policy_entropy_post_update_final: peu.length ? peu[peu.length - 1] : null
  };
}

// Per-seed entropy-transition summary (repair, orchestrator-directed after
// codex fold-up trial MAJOR finding): the min/final table alone is
// compatible with BOTH "collapsed from tick 1" and "collapsed late" -- this
// walks the row sequence directly to report which one actually happened.
// "Zero/subnormal" threshold matches codex's read: |policy_entropy| < 1e-6.
const ENTROPY_COLLAPSE_THRESHOLD = 1e-6;
function entropyTransitionSummary(rows) {
  let firstCollapseIdx = null;
  let collapseCount = 0;
  rows.forEach((r, i) => {
    const v = r.policy_entropy;
    if (typeof v === 'number' && Math.abs(v) < ENTROPY_COLLAPSE_THRESHOLD) {
      collapseCount += 1;
      if (firstCollapseIdx === null) firstCollapseIdx = i;
    }
  });
  const n = rows.length;
  return {
    n_rows: n,
    threshold: ENTROPY_COLLAPSE_THRESHOLD,
    first_row_tick: n ? rows[0].tick : null,
    first_row_entropy: n ? rows[0].policy_entropy : null,
    first_collapse_filtered_index: firstCollapseIdx,
    first_collapse_tick: firstCollapseIdx !== null ? rows[firstCollapseIdx].tick : null,
    zero_or_subnormal_row_count: collapseCount,
    zero_or_subnormal_fraction: n ? collapseCount / n : null,
    classification: collapseCount === 0 ? 'no_collapse' : (firstCollapseIdx === 0 ? 'collapsed_from_start' : 'late_collapse')
  };
}

// Time-to-go decile buckets pooled across all rows of all valid trajectories.
function timeToGoBuckets(allRows, nBuckets) {
  const maxTick = Math.max(...allRows.map((r) => r.tick));
  const buckets = Array.from({ length: nBuckets }, () => []);
  for (const r of allRows) {
    const frac = Math.min(0.999999, (r.tick - 1) / maxTick);
    const idx = Math.floor(frac * nBuckets);
    buckets[idx].push(r.food_exhausted ? 1 : 0);
  }
  return buckets.map((b, i) => ({
    bucket_index: i,
    time_to_go_band: `${Math.round((1 - (i + 1) / nBuckets) * maxTick)}-${Math.round((1 - i / nBuckets) * maxTick)} ticks remaining`,
    n: b.length,
    firing_rate: b.length ? mean(b) : null
  }));
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(GEN2_MANIFEST_PATH, 'utf8'));
  const manifestSha256 = sha256File(GEN2_MANIFEST_PATH);
  const runLogEntry = (manifest.outputs || []).find((o) => o.path.endsWith('run-log.jsonl'));
  if (!runLogEntry) {
    process.stderr.write('FATAL: gen-2 manifest carries no run-log.jsonl output pointer.\n');
    process.exit(1);
  }
  const gen2RunLogPath = path.join(REPO_ROOT, runLogEntry.path);
  const gen2RunLogActualSha256 = sha256File(gen2RunLogPath);
  const gen2ManifestPointerVerified = gen2RunLogActualSha256 === runLogEntry.sha256;

  const inputReceipts = [
    { path: path.relative(REPO_ROOT, GEN2_MANIFEST_PATH), sha256: manifestSha256, role: 'gen-2 generation manifest' },
    { path: runLogEntry.path, sha256: gen2RunLogActualSha256, role: 'gen-2 run-log (manifest-pointed, hash-verified)', manifest_declared_sha256: runLogEntry.sha256, manifest_pointer_verified: gen2ManifestPointerVerified }
  ];

  const runs = [];
  runs.push(processRunLog('gen-2-run-003', manifest.metrics.sim_round.root_seed, gen2RunLogPath));

  const controlDirs = fs.readdirSync(RCDS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('control-'))
    .map((e) => e.name)
    .sort();
  const srd2TelemetryReceipts = [];
  for (const name of controlDirs) {
    const dir = path.join(RCDS_DIR, name);
    const runLogPath = path.join(dir, 'run-log.jsonl');
    const telemetryPath = path.join(dir, 'srd2-telemetry.jsonl');
    const seedMatch = name.match(/(\d+)$/);
    if (fs.existsSync(telemetryPath)) {
      srd2TelemetryReceipts.push({ path: path.relative(REPO_ROOT, telemetryPath), sha256: sha256File(telemetryPath), note: 'declared input (b); read and receipted; does not carry action/reward -- not used in reward-composition computation (see header note)' });
    }
    if (!fs.existsSync(runLogPath)) {
      runs.push({ label: name, seed: seedMatch ? Number(seedMatch[1]) : null, fail_closed: true, reason: `no run-log.jsonl found in ${path.relative(REPO_ROOT, dir)}` });
      continue;
    }
    runs.push(processRunLog(name, seedMatch ? Number(seedMatch[1]) : null, runLogPath));
    inputReceipts.push({ path: path.relative(REPO_ROOT, runLogPath), sha256: sha256File(runLogPath), role: `rcds control run-log (${name})` });
  }

  const validRuns = runs.filter((r) => !r.fail_closed);
  const failedRuns = runs.filter((r) => r.fail_closed);

  // Per-trajectory (seed x hive) tables.
  const trajectories = [];
  for (const run of validRuns) {
    for (const hive of ['hive-a', 'hive-b']) {
      const rows = run.byHive[hive];
      trajectories.push({
        label: run.label,
        seed: run.seed,
        hive,
        n_rows: rows.length,
        firing: firingRate(rows),
        shares: shareTable(rows),
        entropy: entropyTrajectory(rows),
        entropy_transition: entropyTransitionSummary(rows)
      });
    }
  }

  // Combined (all trajectories pooled) share table + firing rate.
  const allRowsFlat = validRuns.flatMap((r) => [...r.byHive['hive-a'], ...r.byHive['hive-b']]);
  const combined = {
    n_rows: allRowsFlat.length,
    firing: firingRate(allRowsFlat),
    shares: shareTable(allRowsFlat)
  };

  // gen-2-only OBSERVE-figure verification (the ~95% claim is gen-2 OBSERVE-scoped).
  const gen2Run = validRuns.find((r) => r.label === 'gen-2-run-003');
  const gen2Rows = gen2Run ? [...gen2Run.byHive['hive-a'], ...gen2Run.byHive['hive-b']] : [];
  const gen2Firing = firingRate(gen2Rows);

  // Variance across trajectories (per-trajectory firing rate).
  const trajectoryRates = trajectories.map((t) => t.firing.rate).filter((x) => x !== null);
  const varianceAcrossTrajectories = variance(trajectoryRates);

  // Variance across time-to-go (decile buckets, pooled across all valid trajectories).
  const N_BUCKETS = 10;
  const buckets = timeToGoBuckets(allRowsFlat, N_BUCKETS);
  const bucketRates = buckets.map((b) => b.firing_rate).filter((x) => x !== null);
  const varianceAcrossTimeToGo = variance(bucketRates);

  // Covariance of the exhaustion indicator with action-taken indicators and stockpile.
  const exhaustionIndicator = allRowsFlat.map((r) => (r.food_exhausted ? 1 : 0));
  const isGather = allRowsFlat.map((r) => (r.action === 'gather' ? 1 : 0));
  const isBuild = allRowsFlat.map((r) => (r.action === 'build' ? 1 : 0));
  const isTerritory = allRowsFlat.map((r) => (r.action === 'claim-territory' ? 1 : 0));
  const stockpileFood = allRowsFlat.map((r) => r.stockpile_food);
  const covariances = {
    exhaustion_vs_gather: covariance(exhaustionIndicator, isGather),
    exhaustion_vs_build: covariance(exhaustionIndicator, isBuild),
    exhaustion_vs_territory: covariance(exhaustionIndicator, isTerritory),
    exhaustion_vs_stockpile_food: covariance(exhaustionIndicator, stockpileFood)
  };

  const penaltyDiagnostics = {
    non_claim: "NO CLAIM OF GRADIENT NEUTRALITY IN EITHER DIRECTION is made here. 95% firing is a state/trajectory-dependent living cost, not a constant baseline shift: the firing indicator's variance across trajectories and across time-to-go, and its covariance with action choice and stockpile state, are measured below. W1 measures; W2 (the calibration sweep) tests.",
    variance_across_trajectories: { n_trajectories: trajectoryRates.length, per_trajectory_rates: trajectories.map((t) => ({ label: t.label, hive: t.hive, rate: t.firing.rate })), variance: varianceAcrossTrajectories },
    variance_across_time_to_go: { n_buckets: N_BUCKETS, buckets, variance: varianceAcrossTimeToGo },
    covariance_with_action_and_state: covariances
  };

  const entropySummary = trajectories.map((t) => ({ label: t.label, seed: t.seed, hive: t.hive, entropy: t.entropy, entropy_transition: t.entropy_transition }));

  // REPAIR (codex fold-up trial MAJOR finding): the min/final entropy table
  // alone is compatible with "collapsed from tick 1" and "collapsed late";
  // this reads the actual per-tick sequence to settle which happened for
  // rcds control hive-b, and states the W2-relevant reading explicitly.
  const controlHiveBTrajectories = trajectories.filter((t) => t.label.startsWith('control-') && t.hive === 'hive-b');
  const hiveBEntropyCorrection = {
    correction_note: "REPAIR (post-hoc, codex fold-up trial MAJOR finding): an earlier chat summary of this artifact stated rcds control hive-b was zero-entropy for the entire run. The min/final table in entropy_trajectories is compatible with both entire-run and late-run collapse; it does not by itself distinguish them. Direct read of the per-tick policy_entropy sequence (below) shows LATE-run collapse, not entire-run collapse: entropy starts at the same ~1.6094-nat initial value as every other trajectory and stays nonzero through roughly the first three-quarters of the run, then drops to zero/subnormal (|policy_entropy| < 1e-6) for the remaining tail. The prior chat claim was wrong; this artifact's own min/final table was never wrong, only silent on which shape produced it.",
    w2_relevant_reading: "For W2 (calibration sweep), rcds control hive-b is a baseline that is pre-collapsed ONLY in its late segment (approximately the last quarter of the 300-tick run, seed-dependent -- see per-seed first_collapse_tick below), not from tick 1. Any W2 comparison against this control should account for a late-window entropy floor, not treat the whole trajectory as already-collapsed.",
    threshold: ENTROPY_COLLAPSE_THRESHOLD,
    per_seed: controlHiveBTrajectories.map((t) => ({
      label: t.label,
      seed: t.seed,
      first_row_entropy: t.entropy_transition.first_row_entropy,
      first_collapse_tick: t.entropy_transition.first_collapse_tick,
      first_collapse_filtered_index: t.entropy_transition.first_collapse_filtered_index,
      zero_or_subnormal_row_count: t.entropy_transition.zero_or_subnormal_row_count,
      n_rows: t.entropy_transition.n_rows,
      classification: t.entropy_transition.classification
    }))
  };

  const artifact = {
    schema: 'RewardCompositionArtifact/1.0',
    task_id: 'reward-weights-ablation',
    step_id: 'W1',
    generated_at: new Date().toISOString(),
    input_contract_note: 'srd2-telemetry.jsonl (declared input b) carries no action/reward field; run-log.jsonl in the same control-* directories (identical schema to gen-2) is the reward-bearing source used for computation. See header comment and srd2_telemetry_receipts below.',
    reward_field_semantics: 'reward is RAW computeReward() output (train-tick.js:232-251); no entropy-bonus-adjusted reward field exists in this schema. Confirmed by code read and by 100% cross-assertion pass across all analyzed rows.',
    v3_default_weights: V3_DEFAULTS,
    epsilon: EPSILON,
    input_receipts: inputReceipts,
    srd2_telemetry_receipts: srd2TelemetryReceipts,
    self_refused: failedRuns.length > 0,
    runs_processed: runs.length,
    runs_valid: validRuns.length,
    runs_fail_closed: failedRuns.length,
    fail_closed_detail: failedRuns.map((r) => ({ label: r.label, seed: r.seed, reason: r.reason })),
    zero_new_sim_runs: true,
    trajectories,
    combined,
    gen2_observe_firing_rate_verification: {
      claimed_figure: '~95%',
      measured_rate: gen2Firing.rate,
      measured_fired: gen2Firing.fired,
      measured_n: gen2Firing.n,
      verified: gen2Firing.rate !== null && Math.abs(gen2Firing.rate - 0.95) <= 0.03
    },
    penalty_diagnostics: penaltyDiagnostics,
    entropy_trajectories: entropySummary,
    hive_b_entropy_collapse_correction: hiveBEntropyCorrection,
    self_sha256: null
  };

  const withoutHash = JSON.stringify({ ...artifact, self_sha256: undefined });
  artifact.self_sha256 = sha256Str(withoutHash);

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2));

  const md = buildMarkdown(artifact);
  fs.writeFileSync(OUT_MD, md);

  process.stdout.write(`Artifact written: ${path.relative(REPO_ROOT, OUT_JSON)}\nself_sha256=${artifact.self_sha256}\nself_refused=${artifact.self_refused}\nruns_valid=${artifact.runs_valid}/${artifact.runs_processed}\ncombined_firing_rate=${artifact.combined.firing.rate}\n`);
}

function fmt(n) {
  if (n === null || n === undefined) return 'n/a';
  if (typeof n !== 'number') return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}
function pct(n) { return n === null || n === undefined ? 'n/a' : `${(n * 100).toFixed(1)}%`; }

function buildMarkdown(a) {
  const lines = [];
  lines.push('# reward-weights-ablation W1: reward-composition analysis (analysis-only, existing telemetry)');
  lines.push('');
  lines.push(`Generated: ${a.generated_at}`);
  lines.push(`self_refused: **${a.self_refused}**`);
  lines.push(`Runs processed: ${a.runs_processed} (valid ${a.runs_valid}, fail-closed ${a.runs_fail_closed})`);
  lines.push('');
  lines.push('## Input contract resolution');
  lines.push('');
  lines.push(a.input_contract_note);
  lines.push('');
  lines.push(a.reward_field_semantics);
  lines.push('');
  if (a.fail_closed_detail.length) {
    lines.push('## Fail-closed refusals');
    lines.push('');
    for (const f of a.fail_closed_detail) lines.push(`- \`${f.label}\` (seed ${f.seed}): ${f.reason}`);
    lines.push('');
  }
  lines.push('## food_exhausted firing rate: the ~95% gen-2 OBSERVE figure');
  lines.push('');
  const g = a.gen2_observe_firing_rate_verification;
  lines.push(`Claimed: ${g.claimed_figure}. Measured (gen-2 run-003, hive-a+hive-b pooled): ${pct(g.measured_rate)} (${g.measured_fired}/${g.measured_n} rows). Within +-3pp of claim: **${g.verified}**.`);
  lines.push('');
  lines.push(`Combined across ALL valid trajectories (gen-2 + 3 rcds control seeds, both hives): ${pct(a.combined.firing.rate)} (${a.combined.firing.fired}/${a.combined.firing.n} rows).`);
  lines.push('');
  lines.push('## Per-trajectory firing rate and reward-share table');
  lines.push('');
  lines.push('| trajectory | seed | hive | rows | firing rate | food_exhausted share | action-contingent share (1 - exhaustion) |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const t of a.trajectories) {
    const exShare = t.shares.shares.food_exhausted;
    lines.push(`| ${t.label} | ${t.seed} | ${t.hive} | ${t.n_rows} | ${pct(t.firing.rate)} | ${pct(exShare)} | ${exShare === null ? 'n/a' : pct(1 - exShare)} |`);
  }
  lines.push('');
  lines.push('## Combined reward-term shares (all valid trajectories pooled, share of total |reward|)');
  lines.push('');
  lines.push('| term | total |value| | share |');
  lines.push('|---|---|---|');
  for (const [k, v] of Object.entries(a.combined.shares.totals)) {
    lines.push(`| ${k} | ${fmt(v)} | ${pct(a.combined.shares.shares[k])} |`);
  }
  lines.push(`| **grand total |reward|** | ${fmt(a.combined.shares.grand_total_abs_reward)} | 100% |`);
  lines.push('');
  lines.push('## Penalty diagnostics (v4 outer-leg F1: variance / covariance, non-claim)');
  lines.push('');
  lines.push(`> ${a.penalty_diagnostics.non_claim}`);
  lines.push('');
  lines.push(`Variance of firing rate ACROSS trajectories (n=${a.penalty_diagnostics.variance_across_trajectories.n_trajectories}): **${fmt(a.penalty_diagnostics.variance_across_trajectories.variance)}**`);
  lines.push('');
  lines.push('| trajectory | hive | firing rate |');
  lines.push('|---|---|---|');
  for (const r of a.penalty_diagnostics.variance_across_trajectories.per_trajectory_rates) {
    lines.push(`| ${r.label} | ${r.hive} | ${pct(r.rate)} |`);
  }
  lines.push('');
  lines.push(`Variance of firing rate ACROSS time-to-go (${a.penalty_diagnostics.variance_across_time_to_go.n_buckets} deciles, pooled): **${fmt(a.penalty_diagnostics.variance_across_time_to_go.variance)}**`);
  lines.push('');
  lines.push('| bucket | time-to-go band | n | firing rate |');
  lines.push('|---|---|---|---|');
  for (const b of a.penalty_diagnostics.variance_across_time_to_go.buckets) {
    lines.push(`| ${b.bucket_index} | ${b.time_to_go_band} | ${b.n} | ${pct(b.firing_rate)} |`);
  }
  lines.push('');
  lines.push('Covariance of the exhaustion indicator with action choice and post-tick stockpile.food (pooled, all valid trajectories):');
  lines.push('');
  const c = a.penalty_diagnostics.covariance_with_action_and_state;
  lines.push(`- vs gather-taken indicator: ${fmt(c.exhaustion_vs_gather)}`);
  lines.push(`- vs build-taken indicator: ${fmt(c.exhaustion_vs_build)}`);
  lines.push(`- vs claim-territory-taken indicator: ${fmt(c.exhaustion_vs_territory)}`);
  lines.push(`- vs stockpile.food: ${fmt(c.exhaustion_vs_stockpile_food)}`);
  lines.push('');
  lines.push('## Entropy trajectories (native run-log fields, min/final per seed/hive)');
  lines.push('');
  lines.push('| trajectory | seed | hive | policy_entropy min | policy_entropy first | policy_entropy final | post_update min | post_update final | first collapse tick | collapse shape |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const e of a.entropy_trajectories) {
    const t = e.entropy_transition;
    lines.push(`| ${e.label} | ${e.seed} | ${e.hive} | ${fmt(e.entropy.policy_entropy_min)} | ${fmt(e.entropy.policy_entropy_first)} | ${fmt(e.entropy.policy_entropy_final)} | ${fmt(e.entropy.policy_entropy_post_update_min)} | ${fmt(e.entropy.policy_entropy_post_update_final)} | ${t.first_collapse_tick ?? 'none'} | ${t.classification} |`);
  }
  lines.push('');
  lines.push('## REPAIR: hive-b entropy collapse is LATE-RUN, not entire-run');
  lines.push('');
  const corr = a.hive_b_entropy_collapse_correction;
  lines.push(corr.correction_note);
  lines.push('');
  lines.push(corr.w2_relevant_reading);
  lines.push('');
  lines.push(`Collapse threshold: |policy_entropy| < ${corr.threshold}`);
  lines.push('');
  lines.push('| control seed | first-row entropy | first collapse tick | zero/subnormal rows | of n rows | classification |');
  lines.push('|---|---|---|---|---|---|');
  for (const s of corr.per_seed) {
    lines.push(`| ${s.seed} | ${fmt(s.first_row_entropy)} | ${s.first_collapse_tick ?? 'none'} | ${s.zero_or_subnormal_row_count} | ${s.n_rows} | ${s.classification} |`);
  }
  lines.push('');
  lines.push('## Input files consumed (read-only, sha256 recorded)');
  lines.push('');
  for (const r of a.input_receipts) {
    lines.push(`- \`${r.path}\` (${r.role}): \`${r.sha256}\`${r.manifest_declared_sha256 ? ` -- manifest-declared: \`${r.manifest_declared_sha256}\`, pointer verified: **${r.manifest_pointer_verified}**` : ''}`);
  }
  lines.push('');
  lines.push('Declared input (b) srd2-telemetry.jsonl receipts (read, hashed, not used in computation -- see input contract resolution above):');
  lines.push('');
  for (const r of a.srd2_telemetry_receipts) {
    lines.push(`- \`${r.path}\`: \`${r.sha256}\``);
  }
  lines.push('');
  lines.push(`Self sha256 (computed on write, over the JSON artifact with this field blanked): see \`reward-weights-ablation__composition.json\`'s own \`self_sha256\` field for the authoritative value (\`${a.self_sha256}\`).`);
  lines.push('');
  return lines.join('\n');
}

main();
