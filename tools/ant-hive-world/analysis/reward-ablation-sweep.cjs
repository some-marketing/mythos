#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/analysis/reward-ablation-sweep.cjs -- W2, plan
// reward-weights-ablation. DUAL-MODE FILE, same shape as
// tools/scoped/srd2-boundary-crossing-trial/balance-audit.cjs and
// tools/ant-hive-world/analysis/calibration-sweep.cjs (the rcds D2 sweep):
//
//   1. SHIM MODE -- `node --require reward-ablation-sweep.cjs run-live.js
//      ...`. require.main !== module, so main() never runs. Instead this
//      file does two things in the preload, BEFORE run-live.js is loaded as
//      the actual program:
//
//        a) REWARD KNOB ECHO (new for W2 -- the rcds/srd2 knob-echo pattern
//           extended to reward_* keys). Unlike prey_graze_rate/max_prey/
//           max_food_sources (D2's ecology knobs, echoed by WRAPPING
//           world-state.js's exported dynamics functions), reward weights
//           are resolved by train-tick.js's resolveRewardWeights(liveConfig)
//           -- a PURE function of the merged liveConfig object, called from
//           INSIDE computeReward() via the module's own local binding, never
//           through module.exports. Wrapping the exported reference (the D2
//           technique) would not intercept that internal call -- same
//           destructured-CommonJS-capture problem balance-audit.cjs's own
//           header names for harness.tick, one level further in because
//           here the call is same-file, not merely same-process. Rather
//           than fight that, this shim calls the REAL exported
//           resolveRewardWeights() itself, in this same live process,
//           against the REAL merged config (live-config.js's own
//           readLiveConfig(), which does `{...DEFAULT_CONFIG, ...parsed}`)
//           read from the SAME file path run-live.js is about to read.
//           Because resolveRewardWeights is pure (no RNG, no state), calling
//           it here with byte-identical input is GUARANTEED to equal what
//           computeReward()'s internal call produces -- not a re-derived
//           approximation, the literal shipped function. `requested` /
//           `live_config_key_present` are read from the RAW override file
//           this tool wrote (pre-DEFAULT_CONFIG-merge) -- DEFAULT_CONFIG
//           itself carries reward_food_exhausted:-2 / reward_gather_food_
//           applied:1 (live-config.js:155-161, "an identical copy of these
//           defaults"), so the MERGED object always has the key present;
//           only the raw override file distinguishes "this run requested a
//           change" from "this run took the shipped default."
//
//        b) SRD2 SHIM (reused unmodified via require(), not copied) --
//           installs the srd2 balance-audit.cjs instrumentation on the same
//           cached world-state.js/harness.js/untrained-network.js exports,
//           giving this tool the same validated per-transition telemetry
//           (gathers[], food_sources_after, upkeep.stockpile_food_after,
//           prey/predator trajectories) the rcds sweep already relies on.
//           Environment stays at DEFAULTS for W2 (no ecology knob override),
//           so no D2-style ecology knob-echo wrap is layered on top here.
//
//      Each wrap/call touches only its own function or reads a file; no
//      engine file (world-state.js, live-config.js, harness.js,
//      train-tick.js, run-live.js) is edited, and RNG draws/outcomes stay
//      byte-identical to an uninstrumented run.
//
//   2. ORCHESTRATOR MODE -- `node reward-ablation-sweep.cjs` runs the W2
//      screening sweep: one shared control run per calibration seed
//      (777000601-603), then the PRIMARY arm (reward_food_exhausted: -1,
//      -0.5, 0, walking away from control -2, early stop at first
//      qualifying value), then -- ONLY if the primary arm qualifies nothing
//      -- the SECONDARY arm (reward_gather_food_applied: 2, 4, walking away
//      from control 1; diagnostic-only, never adoptable). Writes
//      _dev/reports/analysis/reward-weights-ablation__calibration.json.
//
// QUALIFY SCREEN (frozen in the plan, food-gathered-only, v4 relabeling): a
// variant qualifies iff TOTAL FOOD GATHERED (shim gathers[].taken, summed
// over the whole 300-tick run, both hives) is strictly greater than the
// SAME SEED's shared control on ALL 3 calibration seeds. Policy entropy is
// NOT part of the qualify rule -- it is a LOGGED GUARDRAIL inside the
// collapse panel, reported per variant, never gating (named exclusions:
// KL-from-init, grad/param norms -- inexecutable under --no-checkpoint,
// config-only, no persisted weights/log-probs).
//
// EVALUATION METRICS -- exact sources named per the plan's W2 detail (every
// formula recomputable by an independent reader from the named raw files
// alone): total food gathered / gathers-applied-per-tick (shim gathers[]);
// stockpile integral (shim upkeep.stockpile_food_after, both hives summed);
// V_true (shim food_sources_after snapshots, srd2/rcds definition, reused
// verbatim from tools/scoped/srd2-boundary-crossing-trial/ablation2.cjs's
// computeVTrue); policy-entropy min/final (run-log native policy_entropy /
// policy_entropy_post_update fields, run-live.js:910-914 -- no preload wrap,
// the v3 dead-code contingency this plan's predecessor removed); terminal
// stockpile @ tick 300 + non-negative flag (final hive-state.json, same
// files computeWholeSystemBalance already reads); per-hive gathered split +
// dominance note (shim gathers[] grouped by transition hive); waste under
// the existing residual <= 1e-6 assertion (computeWholeSystemBalance,
// reused verbatim from calibration-sweep.cjs); patch concentration
// (Herfindahl over applied gathers[].tile_id) and time-to-first-depletion
// per patch (food_sources_after presence/absence transitions).
//
// CONSERVED FOOD ACCOUNTING: per run, residual <= 1e-6 asserted as an
// instrument-health check (not the endpoint -- balance is not what W2
// measures, but a run whose accounting does not close is not trustworthy
// evidence for anything else it reports).
//
// SCREENING-SELECTION BIAS: W2 is a SCREENING sweep -- selection into W3
// uses W2's own outcomes (a winner's-curse-shaped bias), named here and
// carried into the W3 artifact's evidentiary label per the plan.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORLD_STATE_PATH_MOD = path.join(REPO_ROOT, 'tools', 'ant-hive-world', 'world-state.js');
const LIVE_CONFIG_PATH_MOD = path.join(REPO_ROOT, 'tools', 'ant-hive-world', 'live-config.js');
const HARNESS_PATH_MOD = path.join(REPO_ROOT, 'tools', 'ant-hive-world', 'harness.js');
const TRAIN_TICK_PATH_MOD = path.join(REPO_ROOT, 'tools', 'ant-hive-world', 'train-tick.js');
const RUN_LIVE = path.join(REPO_ROOT, 'tools', 'ant-hive-world', 'run-live.js');
const SRD2_SHIM = path.join(REPO_ROOT, 'tools', 'scoped', 'srd2-boundary-crossing-trial', 'balance-audit.cjs');
const THIS_FILE = __filename;

const SANDBOX_BASE = path.join(REPO_ROOT, '_dev', 'sim-runs', 'rwa-ablation');
const OUT_JSON = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'reward-weights-ablation__calibration.json');

const TICKS = 300;
const EPSILON = 1e-6;
const MAX_SCREENING_RUNS = 18; // 3 x (1 control + 3 primary) = 12, + up to 3 x (1 control-reuse skipped + 2 secondary) = 6 -> 18 worst case

// SEED REGISTRY (v2, codex MAJOR-2). Reproduced VERBATIM from the plan's
// top-level seed_registry object (_dev/reports/analysis/task-plans/
// reward-weights-ablation__plan.json) -- this artifact asserts pairwise
// disjointness across every array below at generation time.
const SEED_REGISTRY = {
  note: "Machine-readable registry (v2, codex MAJOR-2). Raw plan-scoped numbers; no letter-prefix reuse across lineages. The calibration artifact MUST reproduce this object verbatim and assert pairwise disjointness across all arrays.",
  sets: [
    { id: 'pilot', plan: 'sim-replenishment-dynamics', seeds: [777000201, 777000202, 777000203, 777000204, 777000205, 777000206, 777000207], status: 'drawn' },
    { id: 'srd2-calibration', plan: 'srd2-boundary-crossing-trial', seeds: [777000301, 777000302, 777000303], status: 'drawn' },
    { id: 'srd2-confirmatory', plan: 'srd2-boundary-crossing-trial', seeds: [], status: 'never-drawn (srd2 halted fail-closed before R2b/R3; no list was ever committed)' },
    { id: 'rcds-calibration', plan: 'reward-contract-demand-side', seeds: [777000401, 777000402, 777000403], status: 'drawn' },
    { id: 'rcds-confirmatory', plan: 'reward-contract-demand-side', seeds: [777000501, 777000502, 777000503, 777000504, 777000505, 777000506, 777000507], status: 'allocated-never-drawn (D3 never ran)' },
    { id: 'rwa-calibration', plan: 'reward-weights-ablation', seeds: [777000601, 777000602, 777000603], status: 'allocated-here (drawn at W2)' },
    { id: 'rwa-confirmatory', plan: 'reward-weights-ablation', seeds: [777000701, 777000702, 777000703, 777000704, 777000705, 777000706, 777000707], status: 'allocated-here (drawn only at W3)' }
  ]
};
const CALIBRATION_SEEDS = SEED_REGISTRY.sets.find((s) => s.id === 'rwa-calibration').seeds;

const PRIMARY_ARM = { id: 'PRIMARY', key: 'reward_food_exhausted', control: -2, grid_away_from_control: [-1, -0.5, 0] };
const SECONDARY_ARM = { id: 'SECONDARY', key: 'reward_gather_food_applied', control: 1, grid_away_from_control: [2, 4], diagnostic_only: true };

// ---------------------------------------------------------------------------
// SHIM MODE
// ---------------------------------------------------------------------------
function installRewardKnobEcho(knobEchoPath, liveConfigPath) {
  const { readLiveConfig } = require(LIVE_CONFIG_PATH_MOD);
  const { resolveRewardWeights } = require(TRAIN_TICK_PATH_MOD);
  let rawCfg = {};
  try { rawCfg = JSON.parse(fs.readFileSync(liveConfigPath, 'utf8')); } catch { /* absent override file -> control run */ }
  // The SAME merge + SAME resolver run-live.js/train-tick.js use internally
  // -- effective is therefore not a re-derivation, it is the shipped result.
  const mergedCfg = readLiveConfig(liveConfigPath);
  const weights = resolveRewardWeights(mergedCfg);
  const echo = {
    reward_food_exhausted: {
      requested: Object.prototype.hasOwnProperty.call(rawCfg, 'reward_food_exhausted') ? rawCfg.reward_food_exhausted : null,
      live_config_key_present: Object.prototype.hasOwnProperty.call(rawCfg, 'reward_food_exhausted'),
      effective: weights.foodExhausted
    },
    reward_gather_food_applied: {
      requested: Object.prototype.hasOwnProperty.call(rawCfg, 'reward_gather_food_applied') ? rawCfg.reward_gather_food_applied : null,
      live_config_key_present: Object.prototype.hasOwnProperty.call(rawCfg, 'reward_gather_food_applied'),
      effective: weights.gatherFoodApplied
    }
  };
  fs.writeFileSync(knobEchoPath, JSON.stringify(echo));
}

// ---------------------------------------------------------------------------
// ORCHESTRATOR MODE helpers
// ---------------------------------------------------------------------------
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Str(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

const ENGINE_FILES = {
  world_state: WORLD_STATE_PATH_MOD,
  live_config: LIVE_CONFIG_PATH_MOD,
  harness: HARNESS_PATH_MOD,
  train_tick: TRAIN_TICK_PATH_MOD,
  run_live: RUN_LIVE
};
function hashEngineFiles() {
  const out = {};
  for (const [k, p] of Object.entries(ENGINE_FILES)) out[k] = sha256File(p);
  return out;
}

function runInstrumented({ sandboxAbs, seed, runName, overrides }) {
  fs.mkdirSync(sandboxAbs, { recursive: true });
  const liveConfigPath = path.join(sandboxAbs, 'live-config.json');
  if (overrides && Object.keys(overrides).length > 0) {
    fs.writeFileSync(liveConfigPath, JSON.stringify(overrides, null, 2));
  } else if (fs.existsSync(liveConfigPath)) {
    fs.rmSync(liveConfigPath);
  }
  const telemetryPath = path.join(sandboxAbs, 'srd2-telemetry.jsonl');
  const knobEchoPath = path.join(sandboxAbs, 'rwa-knob-echo.json');
  const runLogPath = path.join(sandboxAbs, 'run-log.jsonl');
  for (const p of [telemetryPath, knobEchoPath, runLogPath]) { if (fs.existsSync(p)) fs.rmSync(p); }
  const args = ['--require', THIS_FILE, RUN_LIVE, '--ticks', String(TICKS), '--sandbox-root', sandboxAbs, '--root-seed', String(seed), '--run-name', runName, '--no-checkpoint'];
  const commandLine = `${process.execPath} ${args.join(' ')}`;
  const t0 = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT, encoding: 'utf8',
    env: { ...process.env, SRD2_TELEMETRY_PATH: telemetryPath, RWA_KNOB_ECHO_PATH: knobEchoPath, RWA_LIVE_CONFIG_PATH: liveConfigPath }
  });
  const elapsedMs = Date.now() - t0;
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, sandboxAbs, telemetryPath, knobEchoPath, runLogPath, elapsedMs, commandLine };
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function readKnobEcho(knobEchoPath) {
  if (!fs.existsSync(knobEchoPath)) return { available: false };
  return { available: true, ...JSON.parse(fs.readFileSync(knobEchoPath, 'utf8')) };
}

// Identical to srd2 balance-audit.cjs's / rcds calibration-sweep.cjs's
// computeWholeSystemBalance; genesis (initial_total=40) is independent of
// the swept reward knobs (they change SCORING, not the ecology constants).
function computeWholeSystemBalance(sandboxAbs, telemetry) {
  const initialTotal = 40;
  let cumulativeSpawnIn = 0;
  let cumulativeRegrowIn = 0;
  let cumulativeGrazingOut = 0;
  let cumulativeUpkeepOut = 0;
  for (const row of telemetry) {
    if (row.spawn && row.spawn.success) cumulativeSpawnIn += row.spawn.amount;
    if (row.regrow) cumulativeRegrowIn += row.regrow.amount;
    if (row.grazing) cumulativeGrazingOut += row.grazing.taken;
    if (row.upkeep) cumulativeUpkeepOut += row.upkeep.taken;
  }
  const finalWorldState = JSON.parse(fs.readFileSync(path.join(sandboxAbs, 'shared', 'world-state.json'), 'utf8'));
  const finalHiveA = JSON.parse(fs.readFileSync(path.join(sandboxAbs, 'hive-a', 'hive-state.json'), 'utf8'));
  const finalHiveB = JSON.parse(fs.readFileSync(path.join(sandboxAbs, 'hive-b', 'hive-state.json'), 'utf8'));
  const finalPatchTotal = Object.values(finalWorldState.food_sources || {}).reduce((a, b) => a + b, 0);
  const finalStockA = (finalHiveA.hive_state.stockpile && finalHiveA.hive_state.stockpile.food) || 0;
  const finalStockB = (finalHiveB.hive_state.stockpile && finalHiveB.hive_state.stockpile.food) || 0;
  const finalTotal = finalPatchTotal + finalStockA + finalStockB;
  const inflow = cumulativeSpawnIn + cumulativeRegrowIn;
  const outflow = cumulativeGrazingOut + cumulativeUpkeepOut;
  const predicted = initialTotal + inflow - outflow;
  const residual = Math.abs(predicted - finalTotal);
  return {
    initial_total: initialTotal, final_total: finalTotal, final_patch_total: finalPatchTotal,
    final_stockpile_a: finalStockA, final_stockpile_b: finalStockB,
    cumulative_spawn_in: cumulativeSpawnIn, cumulative_regrow_in: cumulativeRegrowIn,
    cumulative_grazing_out: cumulativeGrazingOut, cumulative_upkeep_out: cumulativeUpkeepOut,
    inflow, outflow, net_balance: inflow - outflow,
    predicted_final_total: predicted, residual, closed: residual <= EPSILON,
    terminal_non_negative: finalStockA >= 0 && finalStockB >= 0
  };
}

// V_true -- reused VERBATIM (same formula, same round-boundary convention)
// from tools/scoped/srd2-boundary-crossing-trial/ablation2.cjs's
// computeVTrue: time-average over rounds, at END-OF-ROUND (after both hive
// transitions), of live patches / patches-ever-available (run-wide UNION of
// tile ids that ever held a food source).
function computeVTrue(telemetry) {
  const everAvailable = new Set();
  const roundEndFractions = [];
  for (const row of telemetry) {
    for (const tileId of Object.keys(row.food_sources_after || {})) everAvailable.add(tileId);
  }
  const denom = everAvailable.size || 1;
  for (let i = 1; i < telemetry.length; i += 2) {
    const row = telemetry[i];
    const liveCount = Object.keys(row.food_sources_after || {}).length;
    roundEndFractions.push(liveCount / denom);
  }
  return roundEndFractions.length ? mean(roundEndFractions) : 0;
}

// Total food gathered, gathers-applied/tick, per-hive split, patch
// concentration (Herfindahl), time-to-first-depletion -- all from the shim's
// gathers[] / food_sources_after fields, per the plan's exact-sources list.
function computeGatherMetrics(telemetry) {
  let totalTaken = 0;
  let appliedCount = 0;
  const perHiveTaken = {};
  const tileTakenCounts = {};
  for (const row of telemetry) {
    for (const g of row.gathers || []) {
      if (!g.ok) continue;
      totalTaken += g.taken;
      appliedCount += 1;
      perHiveTaken[row.hive] = (perHiveTaken[row.hive] || 0) + g.taken;
      tileTakenCounts[g.tile_id] = (tileTakenCounts[g.tile_id] || 0) + 1;
    }
  }
  const gathersAppliedPerTick = appliedCount / TICKS;
  const totalAppliedForHhi = Object.values(tileTakenCounts).reduce((a, b) => a + b, 0);
  const herfindahl = totalAppliedForHhi > 0
    ? Object.values(tileTakenCounts).reduce((acc, c) => acc + (c / totalAppliedForHhi) ** 2, 0)
    : null;

  // Per-hive dominance note: pooled improvement must not conceal one hive
  // starving the other.
  const hiveShares = Object.entries(perHiveTaken).map(([hive, taken]) => ({ hive, taken, share: totalTaken > 0 ? taken / totalTaken : 0 }));
  hiveShares.sort((a, b) => b.share - a.share);
  const dominanceNote = hiveShares.length === 2 && hiveShares[0].share >= 0.75
    ? `${hiveShares[0].hive} dominates gathering at ${(hiveShares[0].share * 100).toFixed(1)}% of total food taken`
    : 'no single-hive dominance (>=75% share) observed';

  // Time-to-first-depletion per patch: track first transition_index a tile
  // appears in food_sources_after, and the first LATER transition_index it
  // is absent (depleted) before the run ends. transition_index units (2 per
  // tick, hive-a then hive-b), named as such.
  const firstSeen = {};
  const depletedAt = {};
  const everSeenSet = new Set();
  for (const row of telemetry) {
    const present = new Set(Object.keys(row.food_sources_after || {}));
    for (const tileId of present) {
      everSeenSet.add(tileId);
      if (!(tileId in firstSeen)) firstSeen[tileId] = row.transition_index;
    }
    for (const tileId of everSeenSet) {
      if (!present.has(tileId) && !(tileId in depletedAt) && tileId in firstSeen) {
        depletedAt[tileId] = row.transition_index;
      }
    }
  }
  const timeToFirstDepletion = Object.keys(firstSeen).map((tileId) => ({
    tile_id: tileId,
    first_seen_transition_index: firstSeen[tileId],
    depleted_transition_index: depletedAt[tileId] ?? null,
    transitions_to_depletion: depletedAt[tileId] !== undefined ? depletedAt[tileId] - firstSeen[tileId] : null,
    depleted_before_run_end: depletedAt[tileId] !== undefined
  }));

  return {
    total_food_gathered: totalTaken,
    gathers_applied_count: appliedCount,
    gathers_applied_per_tick: gathersAppliedPerTick,
    per_hive_food_gathered: perHiveTaken,
    per_hive_dominance_note: dominanceNote,
    patch_concentration_herfindahl: herfindahl,
    patch_concentration_note: 'Herfindahl index over applied gathers[].tile_id (0=perfectly diffuse, 1=single-patch concentration)',
    time_to_first_depletion_per_patch: timeToFirstDepletion
  };
}

// Stockpile integral: sum over transitions of upkeep.stockpile_food_after,
// both acting hives summed (rcds two-hive resolution).
function computeStockpileIntegral(telemetry) {
  let sum = 0;
  for (const row of telemetry) {
    if (row.upkeep && typeof row.upkeep.stockpile_food_after === 'number') sum += row.upkeep.stockpile_food_after;
  }
  return sum;
}

// Policy-entropy min/final -- NATIVE run-log fields (run-live.js:910-914),
// no preload wrap needed (v3, codewhale MINOR-2: previous contingency was
// dead code, deleted). Also action-frequency distribution and a NAMED PROXY
// state-conditioned entropy for the collapse panel (guardrail only, never
// gating): Shannon entropy of the action distribution bucketed by the row's
// own `food_exhausted` boolean -- explicitly NOT a true state-conditioned
// entropy over the full state space (no state features are persisted beyond
// this one flag); the proxy and its limitation are named in the artifact.
function computeCollapsePanel(runLogRows) {
  const entropies = runLogRows.map((r) => r.policy_entropy).filter((v) => typeof v === 'number');
  const entropyMin = entropies.length ? Math.min(...entropies) : null;
  const finalTick = runLogRows.length ? Math.max(...runLogRows.map((r) => r.tick)) : null;
  const finalRows = runLogRows.filter((r) => r.tick === finalTick && typeof r.policy_entropy === 'number');
  const entropyFinal = finalRows.length ? mean(finalRows.map((r) => r.policy_entropy)) : null;

  const actionCounts = {};
  for (const r of runLogRows) actionCounts[r.action] = (actionCounts[r.action] || 0) + 1;

  function shannonEntropy(rows) {
    const counts = {};
    for (const r of rows) counts[r.action] = (counts[r.action] || 0) + 1;
    const n = rows.length;
    if (n === 0) return null;
    let h = 0;
    for (const c of Object.values(counts)) {
      const p = c / n;
      h -= p * Math.log2(p);
    }
    return h;
  }
  const exhaustedRows = runLogRows.filter((r) => r.food_exhausted === true);
  const notExhaustedRows = runLogRows.filter((r) => r.food_exhausted === false);
  const proxyStateConditionedEntropy = {
    definition: 'PROXY, not a true state-conditioned entropy: Shannon entropy of the action distribution, bucketed only by the row-level food_exhausted boolean (the sole persisted state proxy available without violating the config-only/no-new-instrumentation principle).',
    food_exhausted_true_bucket: { row_count: exhaustedRows.length, entropy: shannonEntropy(exhaustedRows) },
    food_exhausted_false_bucket: { row_count: notExhaustedRows.length, entropy: shannonEntropy(notExhaustedRows) }
  };

  return {
    entropy_min: entropyMin,
    entropy_final: entropyFinal,
    action_frequency_distribution: actionCounts,
    proxy_state_conditioned_entropy: proxyStateConditionedEntropy,
    named_exclusions: ['KL-from-initialization (no persisted initial policy/log-probs)', 'gradient norms (train-tick.js state-dies; --no-checkpoint)', 'parameter norms (weights not persisted under --no-checkpoint)'],
    guardrail_note: 'Collapse panel is a LOGGED GUARDRAIL, never gating. The qualify screen is exactly the frozen food-gathered-only rule.'
  };
}

function assertKnobEcho({ armKey, requestedValue, knobEcho }) {
  if (!knobEcho.available) return { all_pass: false, reason: 'reward knob-echo file missing or empty' };
  const foodExhaustedOk = armKey === 'reward_food_exhausted'
    ? (knobEcho.reward_food_exhausted.effective === requestedValue && knobEcho.reward_food_exhausted.live_config_key_present === true)
    : (knobEcho.reward_food_exhausted.effective === PRIMARY_ARM.control && knobEcho.reward_food_exhausted.live_config_key_present === false);
  const gatherFoodOk = armKey === 'reward_gather_food_applied'
    ? (knobEcho.reward_gather_food_applied.effective === requestedValue && knobEcho.reward_gather_food_applied.live_config_key_present === true)
    : (knobEcho.reward_gather_food_applied.effective === SECONDARY_ARM.control && knobEcho.reward_gather_food_applied.live_config_key_present === false);
  return { all_pass: foodExhaustedOk && gatherFoodOk, reward_food_exhausted: knobEcho.reward_food_exhausted, reward_food_exhausted_ok: foodExhaustedOk, reward_gather_food_applied: knobEcho.reward_gather_food_applied, reward_gather_food_applied_ok: gatherFoodOk };
}

function buildEntry({ armId, armKey, requestedValue, seed, runTag }) {
  const sandboxAbs = path.join(SANDBOX_BASE, `${runTag}-${seed}`);
  const overrides = armKey ? { [armKey]: requestedValue } : {};
  const run = runInstrumented({ sandboxAbs, seed, runName: `rwa-${runTag}-${seed}`, overrides });
  const base = {
    arm: armId, knob: armKey || null, requested_value: armKey ? requestedValue : null, seed,
    sandbox: path.relative(REPO_ROOT, sandboxAbs), command_line: run.commandLine, elapsed_ms: run.elapsedMs
  };
  if (run.status !== 0) {
    return { ...base, valid: false, reason: `run-live.js exited ${run.status}: ${(run.stderr || '').slice(-800)}` };
  }
  const knobEcho = readKnobEcho(run.knobEchoPath);
  const echoAssertion = assertKnobEcho({ armKey: armKey, requestedValue, knobEcho });
  if (!echoAssertion.all_pass) {
    return { ...base, valid: false, reason: `KNOB_ECHO_MISMATCH: ${JSON.stringify(echoAssertion)}` };
  }
  const telemetry = readJsonl(run.telemetryPath);
  // 3 run-log rows per tick: hive-a, hive-b, and a third 'world' row (a
  // separate world-mind actor, run-live.js:1013 -- distinct verb space, no
  // food_exhausted/policy_entropy/reward fields). Only the hive rows feed
  // the collapse panel and entropy metrics; the 'world' row is excluded.
  const runLogRows = readJsonl(run.runLogPath);
  if (runLogRows.length !== TICKS * 3) {
    return { ...base, valid: false, reason: `run-log row count ${runLogRows.length} != expected ${TICKS * 3}` };
  }
  const hiveRunLogRows = runLogRows.filter((r) => r.hive === 'hive-a' || r.hive === 'hive-b');
  const balance = computeWholeSystemBalance(sandboxAbs, telemetry);
  const gatherMetrics = computeGatherMetrics(telemetry);
  const stockpileIntegral = computeStockpileIntegral(telemetry);
  const vTrue = computeVTrue(telemetry);
  const collapsePanel = computeCollapsePanel(hiveRunLogRows);
  return {
    ...base, valid: true,
    knob_echo: knobEcho,
    knob_echo_assertion: echoAssertion,
    balance_and_waste: { residual: balance.residual, closed: balance.closed, terminal_non_negative: balance.terminal_non_negative, note: 'residual <= 1e-6 is the instrument-health / waste-overharvest assertion named in the plan; balance is not the endpoint' },
    terminal_stockpile: { hive_a: balance.final_stockpile_a, hive_b: balance.final_stockpile_b, non_negative: balance.terminal_non_negative },
    ...gatherMetrics,
    stockpile_integral: stockpileIntegral,
    v_true: vTrue,
    collapse_panel: collapsePanel,
    transitions_recorded: telemetry.length
  };
}

// Selection rule for W3 (pre-registered): among qualifying variants, the
// smallest ABSOLUTE change from its default weight; tie prefers the primary
// arm.
function computeW3Selection(armsResults) {
  const qualifying = [];
  for (const armResult of Object.values(armsResults)) {
    if (armResult.status === 'QUALIFIED') {
      qualifying.push({
        arm: armResult.arm, knob: armResult.knob, qualifying_value: armResult.qualifying_value,
        control_value: armResult.control_value,
        absolute_change_from_default: Math.abs(armResult.qualifying_value - armResult.control_value)
      });
    }
  }
  if (qualifying.length === 0) return null;
  const order = { PRIMARY: 0, SECONDARY: 1 };
  qualifying.sort((a, b) => (a.absolute_change_from_default !== b.absolute_change_from_default
    ? a.absolute_change_from_default - b.absolute_change_from_default
    : order[a.arm] - order[b.arm]));
  return { selected: qualifying[0], all_qualifying_candidates: qualifying };
}

function checkSeedDisjointness() {
  const seen = new Map();
  const collisions = [];
  for (const set of SEED_REGISTRY.sets) {
    for (const s of set.seeds) {
      if (seen.has(s)) collisions.push({ seed: s, sets: [seen.get(s), set.id] });
      else seen.set(s, set.id);
    }
  }
  return { disjoint: collisions.length === 0, collisions };
}

function runArm(armDef, controlEntriesBySeed, executedRuns, earlyStopLog) {
  const armResult = { arm: armDef.id, knob: armDef.key, control_value: armDef.control, diagnostic_only: !!armDef.diagnostic_only, grid_walked: [], status: null, qualifying_value: null };
  for (const value of armDef.grid_away_from_control) {
    const runTag = `${armDef.id}-${String(value).replace(/[.-]/g, (m) => (m === '-' ? 'neg' : '_'))}`;
    const perSeedEntries = CALIBRATION_SEEDS.map((seed) => {
      const entry = buildEntry({ armId: armDef.id, armKey: armDef.key, requestedValue: value, seed, runTag });
      executedRuns.push(entry);
      return entry;
    });
    const allValid = perSeedEntries.every((e) => e.valid);
    const perSeedQualify = allValid ? perSeedEntries.map((e, i) => e.total_food_gathered > controlEntriesBySeed[i].total_food_gathered) : [];
    const qualifiesOnAllSeeds = allValid && perSeedQualify.every(Boolean);
    armResult.grid_walked.push({
      value, per_seed: perSeedEntries, all_valid: allValid,
      food_gathered_vs_control: allValid ? perSeedEntries.map((e, i) => ({ seed: e.seed, variant_total_food_gathered: e.total_food_gathered, control_total_food_gathered: controlEntriesBySeed[i].total_food_gathered, variant_greater: e.total_food_gathered > controlEntriesBySeed[i].total_food_gathered })) : null,
      qualifies: qualifiesOnAllSeeds
    });
    earlyStopLog.push({ arm: armDef.id, knob: armDef.key, value, all_valid: allValid, qualifies: qualifiesOnAllSeeds, ran_seed_count: CALIBRATION_SEEDS.length, stopped_here: qualifiesOnAllSeeds });
    if (qualifiesOnAllSeeds) { armResult.qualifying_value = value; armResult.status = 'QUALIFIED'; break; }
  }
  if (armResult.status !== 'QUALIFIED') {
    armResult.status = 'ARM-UNREACHABLE';
    armResult.scope_note = `unreachable (this grid, food-gathered-only screen, 300-tick horizon, calibration seed set ${CALIBRATION_SEEDS.join(', ')})`;
  }
  return armResult;
}

function runSmokeValidation() {
  // AC2 / plan detail: "validate the injection path with a smoke run BEFORE
  // the real sweep (assert the effective weight differs from default when
  // requested)". A genuine 300-tick run (same argv contract as every other
  // run in this tool -- no shortcut horizon), seed 777000601, value -1;
  // NOT counted against the <=18 screening run bound and NOT part of the
  // qualify screen -- infrastructure validation, recorded for transparency.
  const seed = CALIBRATION_SEEDS[0];
  const entry = buildEntry({ armId: 'SMOKE', armKey: PRIMARY_ARM.key, requestedValue: -1, seed, runTag: 'smoke' });
  const passed = entry.valid && entry.knob_echo.reward_food_exhausted.effective === -1 && entry.knob_echo.reward_food_exhausted.effective !== PRIMARY_ARM.control;
  return { ...entry, smoke_assertion_passed: passed, smoke_assertion: 'effective reward_food_exhausted (-1) differs from control default (-2) when requested' };
}

function main() {
  fs.mkdirSync(SANDBOX_BASE, { recursive: true });
  const engineFilesHashBefore = hashEngineFiles();

  process.stdout.write('W2: smoke-validating the reward-knob injection path...\n');
  const smoke = runSmokeValidation();
  process.stdout.write(`smoke complete: valid=${smoke.valid} smoke_assertion_passed=${smoke.smoke_assertion_passed}\n`);
  if (!smoke.smoke_assertion_passed) {
    process.stderr.write('FAIL-CLOSED: smoke validation did not confirm the reward-knob injection path. Aborting before the real sweep.\n');
    const failArtifact = {
      schema: 'RewardAblationSweepArtifact/1.0', task_id: 'reward-weights-ablation', step_id: 'W2',
      generated_at: new Date().toISOString(), status: 'ABORTED-SMOKE-VALIDATION-FAILED', smoke_validation: smoke
    };
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(failArtifact, null, 2));
    process.exit(1);
  }

  const executedRuns = [];
  const earlyStopLog = [];

  process.stdout.write('W2: shared control runs (once per seed)...\n');
  const controlEntries = CALIBRATION_SEEDS.map((seed) => {
    const entry = buildEntry({ armId: 'CONTROL', armKey: null, requestedValue: null, seed, runTag: 'control' });
    executedRuns.push(entry);
    return entry;
  });
  const controlAllValid = controlEntries.every((e) => e.valid);
  process.stdout.write(`control complete: all_valid=${controlAllValid}\n`);

  process.stdout.write('W2: PRIMARY arm (reward_food_exhausted), walking [-1, -0.5, 0] away from control -2...\n');
  const primaryResult = runArm(PRIMARY_ARM, controlEntries, executedRuns, earlyStopLog);
  process.stdout.write(`PRIMARY complete: status=${primaryResult.status} qualifying_value=${primaryResult.qualifying_value}\n`);

  const arms = { PRIMARY: primaryResult };
  if (primaryResult.status !== 'QUALIFIED') {
    process.stdout.write('W2: PRIMARY qualified nothing -> running SECONDARY arm (reward_gather_food_applied, diagnostic-only, non-adoptable)...\n');
    arms.SECONDARY = runArm(SECONDARY_ARM, controlEntries, executedRuns, earlyStopLog);
    process.stdout.write(`SECONDARY complete: status=${arms.SECONDARY.status} qualifying_value=${arms.SECONDARY.qualifying_value}\n`);
  } else {
    process.stdout.write('W2: PRIMARY qualified -> SECONDARY arm SKIPPED per plan (runs only if primary qualifies nothing).\n');
  }

  const engineFilesHashAfter = hashEngineFiles();
  const engineFilesUnchanged = Object.keys(ENGINE_FILES).every((k) => engineFilesHashBefore[k] === engineFilesHashAfter[k]);

  const executedCount = executedRuns.length;
  const withinBound = executedCount <= MAX_SCREENING_RUNS;
  const seedDisjointness = checkSeedDisjointness();
  // W3 selection considers only the PRIMARY arm's QUALIFIED outcome, per the
  // plan's W4 rule ("QUALIFIED+CONFIRMED (primary arm only -- a qualifying
  // secondary variant is diagnostic, never gated, per MAJOR-2)").
  const w3SelectionArms = { PRIMARY: primaryResult };
  const w3Selection = computeW3Selection(w3SelectionArms);

  const artifact = {
    schema: 'RewardAblationSweepArtifact/1.0',
    task_id: 'reward-weights-ablation',
    step_id: 'W2',
    title: 'Single-term SCREENING sweep at default dynamics, reward-independent evaluation',
    generated_at: new Date().toISOString(),
    screening_selection_bias_note: 'W2 is SCREENING: selection into W3 uses these outcomes, a winner\'s-curse-shaped bias. Named here and carried into the W3 artifact\'s evidentiary label.',
    epsilon: EPSILON,
    ticks_per_run: TICKS,
    environment: 'DEFAULTS (deviation from predecessor plan\'s "best nontrivial operating point" phrasing named with reason: no qualifying point existed; defaults match the gen-2 baseline for comparability)',
    calibration_seeds: CALIBRATION_SEEDS,
    seed_registry: SEED_REGISTRY,
    seed_registry_pairwise_disjoint: seedDisjointness.disjoint,
    seed_registry_collisions: seedDisjointness.collisions,
    smoke_validation: smoke,
    engine_files_hash_before: engineFilesHashBefore,
    engine_files_hash_after: engineFilesHashAfter,
    engine_files_unchanged: engineFilesUnchanged,
    control: { entries: controlEntries, all_valid: controlAllValid },
    arms,
    qualify_screen_rule: 'A variant qualifies iff total food gathered (shim gathers[].taken, summed over the run) is strictly greater than the same-seed shared control, on ALL 3 calibration seeds. Food-gathered-only; policy entropy is a logged guardrail (collapse_panel), never gating.',
    executed_run_count: executedCount,
    max_screening_run_bound: MAX_SCREENING_RUNS,
    within_bound: withinBound,
    early_stop_log: earlyStopLog,
    w3_selection_rule: 'Pre-registered: among QUALIFIED variants (PRIMARY arm only -- a qualifying SECONDARY variant is diagnostic-only, non-adoptable, never gated), the smallest ABSOLUTE change from its default weight; tie prefers the primary arm.',
    w3_selection: w3Selection,
    self_sha256: null
  };
  const withoutHash = JSON.stringify({ ...artifact, self_sha256: undefined });
  artifact.self_sha256 = sha256Str(withoutHash);
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2));
  process.stdout.write(`Artifact written: ${OUT_JSON}\nexecuted_run_count=${executedCount} within_bound=${withinBound} engine_files_unchanged=${engineFilesUnchanged}\nw3_selection=${w3Selection ? JSON.stringify(w3Selection.selected) : 'null (no qualifying variant)'}\nself_sha256=${artifact.self_sha256}\n`);
}

module.exports = { installRewardKnobEcho, computeWholeSystemBalance, computeVTrue, computeGatherMetrics, computeStockpileIntegral, computeCollapsePanel, checkSeedDisjointness, computeW3Selection };

// ---------------------------------------------------------------------------
// MODE DISPATCH -- placed last, after every const/function it references is
// defined (main() and its helpers use `const` declarations such as
// ENGINE_FILES that are not hoisted; calling main() before they initialize
// throws a TDZ ReferenceError, same pitfall calibration-sweep.cjs's own
// header documents and places its dispatch last to avoid).
//
// ORDER MATTERS (discovered empirically -- an earlier draft of this file got
// this backwards and silently produced empty gathers[]/food_sources_after
// telemetry on every run): require(SRD2_SHIM) MUST run FIRST. train-tick.js
// itself does `const { tick } = require('./harness.js')` at its OWN
// module-load time (train-tick.js:12) -- a destructured capture of whatever
// harness.js's exports.tick currently is. installRewardKnobEcho() requires
// train-tick.js (for resolveRewardWeights) and live-config.js (for
// readLiveConfig); if that require happens BEFORE the srd2 shim wraps
// harness.js's exports.tick in place, train-tick.js's local `tick` binding
// permanently captures the UNWRAPPED function, and every later caller of
// trainTick() -- including run-live.js's own required copy of the SAME
// cached train-tick.js module -- calls that unwrapped tick forever: srd2's
// gathers[]/food_sources_after/upkeep instrumentation silently never fires,
// even though the underlying gathers are really happening (verified: a
// smoke run showed gather actions with applied=true in its console log
// while its telemetry file was never created). Requiring SRD2_SHIM first
// wraps harness.js's exports.tick BEFORE anything destructures it, so
// train-tick.js's own later require (triggered here by
// installRewardKnobEcho, and again -- same cached module -- by run-live.js)
// captures the ALREADY-WRAPPED tick. The wrap forwards every argument and
// return value unchanged, so trainTick()'s own behavior is untouched either
// way; only whether srd2's telemetry sees the calls depends on this order.
if (require.main !== module) {
  require(SRD2_SHIM);
  const knobEchoPath = process.env.RWA_KNOB_ECHO_PATH;
  const liveConfigPath = process.env.RWA_LIVE_CONFIG_PATH;
  if (knobEchoPath && liveConfigPath) installRewardKnobEcho(knobEchoPath, liveConfigPath);
} else {
  main();
}
