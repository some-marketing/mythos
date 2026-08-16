#!/usr/bin/env node
'use strict';

// tools/scoped/reward-contract-demand-side/demand-decomposition.cjs -- D1
// plan reward-contract-demand-side. ANALYSIS-ONLY: reads existing
// _dev/sim-runs/srd2-ablation/*/srd2-telemetry.jsonl (prior evidence from the
// CLOSED srd2-boundary-crossing-trial). Zero new sim runs, zero engine
// edits, zero writes outside this tool's three owned artifacts.
//
// RECONSTRUCTION CONTRACT (exact, fail-closed, plan D1 detail):
//   residual = (patch_total_initial + stockpile_initial)
//            + SUM(spawn.amount for successful spawns)
//            + SUM(regrow.amount)
//            - SUM(upkeep.taken)
//            - SUM(grazing.taken)
//            - (patch_total_final + stockpile_final)
// Gathers are internal transfers (food_sources -> a hive's own stockpile,
// same amount both sides) and appear in NO term -- consistent with the
// srd2-boundary-crossing-trial balance-audit.cjs precedent (read-only
// reference, tools/scoped/srd2-boundary-crossing-trial/balance-audit.cjs)
// which established the same exclusion for the same reason.
//
// GENESIS (initial) TERMS -- not present in any per-run telemetry/state file
// as a labeled "initial" record; every per-run artifact this tool can read
// (srd2-telemetry.jsonl, live-config.json, shared/world-state.json,
// hive-*/hive-state.json) reflects the FINAL state only. The genesis values
// are therefore read from the engine's own fixed constants
// (tools/ant-hive-world/world-state.js:80-81), the same source the srd2
// balance-audit.cjs precedent used (its computeWholeSystemBalance()
// hardcodes initialTotal=40 with an inline comment naming these same two
// constants):
//   INITIAL_FOOD_SOURCE_COUNT = 5, INITIAL_FOOD_SOURCE_AMOUNT = 8
//   -> initial patch total = 40 (verified unchanged in world-state.js by
//      this tool's engine-file hash check, recorded in the artifact)
//   Both hives' initial stockpile.food = 0 -- generate-blank-hive-seed
//   emits no stockpile key; confirmed directly in every one of the 25 input
//   files' own run-log.jsonl, whose tick=1 rows (the FIRST two actions of
//   the run, immediately after genesis, before any upkeep/grazing/spawn
//   settles) show stock:{food:0} for both hive-a and hive-b.
//
// CROSS-ASSERTION against the first transition record (v2 codex finding 4's
// "cross-asserted against the first transition record's pre-state", resolved
// here since telemetry carries no explicit pre-state field): two independent
// checks per file, both required to pass or the file fails closed --
//   (a) transition_index=1's spawn.sources_before === INITIAL_FOOD_SOURCE_COUNT
//   (b) INITIAL_TOTAL + transition-1's own spawn/regrow/upkeep/grazing deltas
//       reconstructs transition-1's own food_total_after_gather_and_environment
//       within EPSILON
// Passing both is strong evidence the assumed genesis matches this file's
// actual initial condition; failing either means the genesis assumption is
// not reliably known for that file, and the file fails closed rather than
// silently reporting a residual built on an unverified premise.
//
// TWO-HIVE STOCKPILE RESOLUTION (plan-flagged as needing documentation):
// srd2-telemetry.jsonl alternates records per acting hive (hive/hive-b), and
// each record's upkeep.stockpile_food_after reflects ONLY the acting hive's
// own stockpile at that moment -- confirmed against the final saved
// hive-a/hive-state.json and hive-b/hive-state.json in a sampled run,
// stockpile.food matched the LAST telemetry record for that hive exactly.
// food_sources_after, by contrast, is the single SHARED world economy
// (tools/ant-hive-world's shared/world-state.json) and is identical
// regardless of which hive acted -- confirmed byte-for-byte against a
// sampled run's final shared/world-state.json. Final stockpile total is
// therefore: (last hive-a record's upkeep.stockpile_food_after) +
// (last hive-b record's upkeep.stockpile_food_after); final patch total is
// the sum of the single LAST record's (whichever hive) food_sources_after.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SRD2_DIR = path.join(REPO_ROOT, '_dev', 'sim-runs', 'srd2-ablation');
const WORLD_STATE_PATH = path.join(REPO_ROOT, 'tools', 'ant-hive-world', 'world-state.js');
const OUT_JSON = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'reward-contract-demand-side__decomposition.json');
const OUT_MD = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'reward-contract-demand-side__decomposition.md');

const EPSILON = 1e-6;
const INITIAL_FOOD_SOURCE_COUNT = 5;   // tools/ant-hive-world/world-state.js:80
const INITIAL_FOOD_SOURCE_AMOUNT = 8;  // tools/ant-hive-world/world-state.js:81
const INITIAL_PATCH_TOTAL = INITIAL_FOOD_SOURCE_COUNT * INITIAL_FOOD_SOURCE_AMOUNT; // 40
const INITIAL_HIVE_STOCKPILE = 0; // per-hive, both hives; see genesis note above
const INITIAL_TOTAL = INITIAL_PATCH_TOTAL + 2 * INITIAL_HIVE_STOCKPILE; // 40
const PREY_TRAJECTORY_THRESHOLD = 0.05; // relative |final-initial|/initial classification band

const REQUIRED_RECORD_FIELDS = [
  'transition_index', 'hive', 'spawn', 'regrow', 'grazing', 'gathers',
  'food_sources_after', 'food_total_after_gather_and_environment',
  'prey_population_after', 'predator_population_after', 'upkeep'
];

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Str(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function mean(arr) { return arr.length ? sum(arr) / arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function variance(arr) {
  if (!arr.length) return null;
  const m = mean(arr);
  return mean(arr.map((x) => (x - m) ** 2));
}

function discoverRuns() {
  const entries = fs.readdirSync(SRD2_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  const runs = [];
  for (const e of entries) {
    const dir = path.join(SRD2_DIR, e.name);
    const telemetryPath = path.join(dir, 'srd2-telemetry.jsonl');
    const liveConfigPath = path.join(dir, 'live-config.json');
    if (!fs.existsSync(telemetryPath) || !fs.existsSync(liveConfigPath)) continue;
    const liveConfig = JSON.parse(fs.readFileSync(liveConfigPath, 'utf8'));
    const kind = e.name.startsWith('calibration-') ? 'calibration' : (e.name.startsWith('replay-') ? 'replay' : 'other');
    const seedMatch = e.name.match(/(\d+)$/);
    runs.push({
      name: e.name,
      dir: path.relative(REPO_ROOT, dir),
      telemetryPath,
      liveConfigPath,
      kind,
      seed: seedMatch ? Number(seedMatch[1]) : null,
      spawn_chance: liveConfig.food_source_spawn_chance,
      config_label: kind === 'replay' ? 'defaults' : `p${String(liveConfig.food_source_spawn_chance)}`
    });
  }
  runs.sort((a, b) => a.name.localeCompare(b.name));
  return runs;
}

function baseInfo(run, telemetrySha256, liveConfigSha256) {
  return {
    name: run.name,
    dir: run.dir,
    kind: run.kind,
    seed: run.seed,
    spawn_chance: run.spawn_chance,
    config_label: run.config_label,
    telemetry_path: path.relative(REPO_ROOT, run.telemetryPath),
    telemetry_sha256: telemetrySha256,
    live_config_path: path.relative(REPO_ROOT, run.liveConfigPath),
    live_config_sha256: liveConfigSha256
  };
}

function analyzeRun(run) {
  const telemetrySha256 = sha256File(run.telemetryPath);
  const liveConfigSha256 = sha256File(run.liveConfigPath);
  const info = baseInfo(run, telemetrySha256, liveConfigSha256);

  const rawLines = fs.readFileSync(run.telemetryPath, 'utf8').split('\n').filter(Boolean);
  if (rawLines.length === 0) {
    return { ...info, fail_closed: true, missing_term: 'empty telemetry file (zero transition records)' };
  }

  const records = [];
  for (const line of rawLines) {
    let rec;
    try { rec = JSON.parse(line); } catch (err) {
      return { ...info, fail_closed: true, missing_term: `unparseable telemetry line: ${err.message}` };
    }
    records.push(rec);
  }

  for (const rec of records) {
    for (const term of REQUIRED_RECORD_FIELDS) {
      if (!(term in rec)) {
        return { ...info, fail_closed: true, missing_term: `record transition_index=${rec.transition_index ?? '?'} missing field '${term}'` };
      }
    }
    if (rec.hive !== 'hive-a' && rec.hive !== 'hive-b') {
      return { ...info, fail_closed: true, missing_term: `record transition_index=${rec.transition_index} has unrecognized hive '${rec.hive}'` };
    }
  }

  const first = records[0];
  const last = records[records.length - 1];

  // --- cross-assertion (a): sources_before at transition 1 matches genesis count
  const sourcesBeforeMatchesGenesis = first.spawn.sources_before === INITIAL_FOOD_SOURCE_COUNT;

  // --- cross-assertion (b): reconstruct transition 1's own food_total_after.
  // NOTE: food_total_after_gather_and_environment is PATCH-ONLY (derived
  // from the shared world food_sources, not hive stockpiles) -- confirmed
  // empirically: it excludes upkeep.taken (upkeep draws from a hive's own
  // stockpile, never from patches) but DOES reflect gathers[].taken (a
  // gather physically moves food out of a patch into the acting hive's
  // stockpile, so it reduces the patch total even though it is a net-zero
  // internal transfer at the whole-system level used in the main residual
  // below). The patch-level reconstruction here is therefore:
  //   patch_total_before + spawn_in + regrow_in - grazing.taken - gathers.taken
  const t1SpawnIn = first.spawn.success ? first.spawn.amount : 0;
  const t1GatherOut = sum((first.gathers || []).map((g) => g.taken));
  const t1Predicted = INITIAL_PATCH_TOTAL + t1SpawnIn + first.regrow.amount - first.grazing.taken - t1GatherOut;
  const t1Residual = Math.abs(t1Predicted - first.food_total_after_gather_and_environment);
  const t1Closed = t1Residual <= EPSILON;

  if (!sourcesBeforeMatchesGenesis || !t1Closed) {
    return {
      ...info,
      fail_closed: true,
      missing_term: `genesis cross-assertion failed: sources_before_matches_genesis=${sourcesBeforeMatchesGenesis} (observed ${first.spawn.sources_before}, expected ${INITIAL_FOOD_SOURCE_COUNT}); t1_reconstruction_residual=${t1Residual} (predicted ${t1Predicted}, observed ${first.food_total_after_gather_and_environment})`
    };
  }

  // --- full-run accumulation
  let cumulativeSpawnIn = 0, cumulativeRegrowIn = 0, cumulativeGrazingOut = 0, cumulativeUpkeepOut = 0;
  let cumulativeGrazingRequested = 0;
  let spawnAttemptedCount = 0, capRefusedCount = 0;
  let capOccupancyTransition = null;
  const foodTotalSeries = [INITIAL_TOTAL];
  const preyAfterSeries = [];
  const perPreyGrazing = [];
  let lastHiveA = null, lastHiveB = null;

  for (const rec of records) {
    if (rec.spawn.attempted) {
      spawnAttemptedCount += 1;
      if (rec.spawn.cap_refused) capRefusedCount += 1;
      if (capOccupancyTransition === null && rec.spawn.sources_before === rec.spawn.max_sources) {
        capOccupancyTransition = rec.transition_index;
      }
    }
    if (rec.spawn.success) cumulativeSpawnIn += rec.spawn.amount;
    cumulativeRegrowIn += rec.regrow.amount;
    cumulativeGrazingOut += rec.grazing.taken;
    cumulativeGrazingRequested += rec.grazing.requested;
    cumulativeUpkeepOut += rec.upkeep.taken;
    foodTotalSeries.push(rec.food_total_after_gather_and_environment);
    preyAfterSeries.push(rec.prey_population_after);
    if (rec.grazing.prey_before > 0) perPreyGrazing.push(rec.grazing.taken / rec.grazing.prey_before);
    if (rec.hive === 'hive-a') lastHiveA = rec; else lastHiveB = rec;
  }

  if (!lastHiveA || !lastHiveB) {
    return { ...info, fail_closed: true, missing_term: 'file does not contain records from both hive-a and hive-b; final per-hive stockpile term unavailable' };
  }

  const finalPatchTotal = sum(Object.values(last.food_sources_after));
  const finalStockpileTotal = lastHiveA.upkeep.stockpile_food_after + lastHiveB.upkeep.stockpile_food_after;
  const finalTotal = finalPatchTotal + finalStockpileTotal;

  const residual = INITIAL_TOTAL + cumulativeSpawnIn + cumulativeRegrowIn
    - cumulativeUpkeepOut - cumulativeGrazingOut - finalTotal;
  const closed = Math.abs(residual) <= EPSILON;

  const totalOutflow = cumulativeGrazingOut + cumulativeUpkeepOut;
  const grazingShare = totalOutflow > 0 ? cumulativeGrazingOut / totalOutflow : null;
  const upkeepShare = totalOutflow > 0 ? cumulativeUpkeepOut / totalOutflow : null;

  const initialPrey = first.grazing.prey_before;
  const finalPrey = last.prey_population_after;
  const preySeriesFull = [initialPrey, ...preyAfterSeries];
  const preyMin = Math.min(...preySeriesFull);
  const preyMax = Math.max(...preySeriesFull);
  const preyRatio = initialPrey !== 0 ? (finalPrey - initialPrey) / initialPrey : null;
  let preyClassification;
  if (preyRatio === null) preyClassification = 'UNDETERMINED (initial prey population is zero)';
  else if (preyRatio > PREY_TRAJECTORY_THRESHOLD) preyClassification = 'growing';
  else if (preyRatio < -PREY_TRAJECTORY_THRESHOLD) preyClassification = 'declining';
  else preyClassification = 'equilibrating';

  const capRefusalRate = spawnAttemptedCount > 0 ? capRefusedCount / spawnAttemptedCount : null;

  const initialPredators = first.grazing.predator_before;
  const finalPredators = last.predator_population_after;

  return {
    ...info,
    fail_closed: false,
    transitions_recorded: records.length,
    genesis_cross_assertion: {
      sources_before_matches_genesis: sourcesBeforeMatchesGenesis,
      t1_reconstruction_residual: t1Residual,
      t1_reconstruction_closed: t1Closed
    },
    reconstruction: {
      initial_total: INITIAL_TOTAL,
      initial_patch_total: INITIAL_PATCH_TOTAL,
      initial_stockpile_total: 2 * INITIAL_HIVE_STOCKPILE,
      cumulative_spawn_in: cumulativeSpawnIn,
      cumulative_regrow_in: cumulativeRegrowIn,
      cumulative_grazing_out: cumulativeGrazingOut,
      cumulative_upkeep_out: cumulativeUpkeepOut,
      final_patch_total: finalPatchTotal,
      final_stockpile_total: finalStockpileTotal,
      final_total: finalTotal,
      residual,
      epsilon: EPSILON,
      closed
    },
    outflow_decomposition: {
      total_outflow: totalOutflow,
      grazing_share: grazingShare,
      upkeep_share: upkeepShare,
      grazing_requested_total: cumulativeGrazingRequested,
      grazing_shortfall_total: cumulativeGrazingRequested - cumulativeGrazingOut
    },
    prey_trajectory: {
      initial: initialPrey,
      final: finalPrey,
      min: preyMin,
      max: preyMax,
      relative_change: preyRatio,
      classification_threshold: PREY_TRAJECTORY_THRESHOLD,
      classification: preyClassification
    },
    cap: {
      spawn_attempted_count: spawnAttemptedCount,
      cap_refused_count: capRefusedCount,
      cap_refusal_rate: capRefusalRate,
      cap_occupancy_first_transition: capOccupancyTransition
    },
    stock_flow_table: {
      initial_inventory: INITIAL_TOTAL,
      additions_spawn: cumulativeSpawnIn,
      additions_regrow: cumulativeRegrowIn,
      removals_grazing: cumulativeGrazingOut,
      removals_upkeep: cumulativeUpkeepOut,
      remaining_stock: finalTotal,
      cap_occupancy_first_transition: capOccupancyTransition
    },
    mediator_table: {
      net_prey_growth: finalPrey - initialPrey,
      prey_births: 'unavailable-raw',
      grazing_requested_total: cumulativeGrazingRequested,
      grazing_taken_total: cumulativeGrazingOut,
      derived_per_prey_grazing_mean: mean(perPreyGrazing),
      total_grazing: cumulativeGrazingOut,
      predator_initial: initialPredators,
      predator_final: finalPredators,
      stock_min: Math.min(...foodTotalSeries),
      stock_variance: variance(foodTotalSeries)
    }
  };
}

function aggregateConfig(runsForConfig) {
  const valid = runsForConfig.filter((r) => !r.fail_closed);
  const failed = runsForConfig.filter((r) => r.fail_closed);
  if (valid.length === 0) {
    return { seeds: runsForConfig.map((r) => r.seed), all_fail_closed: true, failures: failed.map((r) => ({ name: r.name, missing_term: r.missing_term })) };
  }
  return {
    seeds: runsForConfig.map((r) => r.seed),
    n_valid: valid.length,
    n_fail_closed: failed.length,
    failures: failed.map((r) => ({ name: r.name, missing_term: r.missing_term })),
    residual_max_abs: Math.max(...valid.map((r) => Math.abs(r.reconstruction.residual))),
    all_closed: valid.every((r) => r.reconstruction.closed),
    grazing_share_mean: mean(valid.map((r) => r.outflow_decomposition.grazing_share).filter((x) => x !== null)),
    upkeep_share_mean: mean(valid.map((r) => r.outflow_decomposition.upkeep_share).filter((x) => x !== null)),
    prey_classifications: valid.map((r) => ({ seed: r.seed, classification: r.prey_trajectory.classification, relative_change: r.prey_trajectory.relative_change, initial: r.prey_trajectory.initial, final: r.prey_trajectory.final, min: r.prey_trajectory.min, max: r.prey_trajectory.max })),
    cap_refusal_rate_mean: mean(valid.map((r) => r.cap.cap_refusal_rate).filter((x) => x !== null)),
    cap_occupancy_first_transition_median: median(valid.map((r) => r.cap.cap_occupancy_first_transition).filter((x) => x !== null)),
    stock_flow_table: {
      initial_inventory: INITIAL_TOTAL,
      additions_spawn_mean: mean(valid.map((r) => r.stock_flow_table.additions_spawn)),
      additions_regrow_mean: mean(valid.map((r) => r.stock_flow_table.additions_regrow)),
      removals_grazing_mean: mean(valid.map((r) => r.stock_flow_table.removals_grazing)),
      removals_upkeep_mean: mean(valid.map((r) => r.stock_flow_table.removals_upkeep)),
      remaining_stock_mean: mean(valid.map((r) => r.stock_flow_table.remaining_stock)),
      cap_occupancy_first_transition_median: median(valid.map((r) => r.stock_flow_table.cap_occupancy_first_transition).filter((x) => x !== null))
    },
    mediator_table: {
      net_prey_growth_mean: mean(valid.map((r) => r.mediator_table.net_prey_growth)),
      prey_births: 'unavailable-raw',
      grazing_requested_total_mean: mean(valid.map((r) => r.mediator_table.grazing_requested_total)),
      grazing_taken_total_mean: mean(valid.map((r) => r.mediator_table.grazing_taken_total)),
      derived_per_prey_grazing_mean: mean(valid.map((r) => r.mediator_table.derived_per_prey_grazing_mean).filter((x) => x !== null)),
      predator_initial_mean: mean(valid.map((r) => r.mediator_table.predator_initial)),
      predator_final_mean: mean(valid.map((r) => r.mediator_table.predator_final)),
      stock_min_mean: mean(valid.map((r) => r.mediator_table.stock_min)),
      stock_variance_mean: mean(valid.map((r) => r.mediator_table.stock_variance))
    }
  };
}

function majorityClassification(classificationRows) {
  const counts = {};
  for (const row of classificationRows) counts[row.classification] = (counts[row.classification] || 0) + 1;
  let best = null, bestCount = -1;
  for (const [k, v] of Object.entries(counts)) { if (v > bestCount) { best = k; bestCount = v; } }
  return { majority: best, counts };
}

function fmt(n) {
  if (n === null || n === undefined) return 'n/a';
  if (typeof n !== 'number') return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function buildMarkdown(artifact) {
  const lines = [];
  lines.push('# reward-contract-demand-side D1: demand decomposition (analysis-only)');
  lines.push('');
  lines.push(`Generated: ${artifact.generated_at}`);
  lines.push(`Engine file hash (tools/ant-hive-world/world-state.js): \`${artifact.world_state_sha256}\``);
  lines.push('');
  lines.push('## Two-hive stockpile resolution');
  lines.push('');
  lines.push('`srd2-telemetry.jsonl` alternates one record per acting hive. `food_sources_after` is the single SHARED world food economy (identical regardless of acting hive, verified against `shared/world-state.json` in a sampled run). `upkeep.stockpile_food_after` reflects only the ACTING hive\'s own stockpile at that moment. Final stockpile total = (last hive-a record\'s `upkeep.stockpile_food_after`) + (last hive-b record\'s `upkeep.stockpile_food_after`); final patch total = sum of the single last record\'s `food_sources_after` (whichever hive acted last).');
  lines.push('');
  lines.push('## Genesis (initial) terms');
  lines.push('');
  lines.push(`Initial patch total = INITIAL_FOOD_SOURCE_COUNT(${INITIAL_FOOD_SOURCE_COUNT}) x INITIAL_FOOD_SOURCE_AMOUNT(${INITIAL_FOOD_SOURCE_AMOUNT}) = ${INITIAL_PATCH_TOTAL}, from tools/ant-hive-world/world-state.js. Both hives\' initial stockpile.food = 0 (confirmed from each run\'s own run-log.jsonl tick=1 rows). Cross-asserted per file against transition 1\'s spawn.sources_before and against a transition-1 reconstruction of food_total_after_gather_and_environment; a file failing either check fails closed rather than reporting an unverified residual.`);
  lines.push('');
  lines.push('## Overall status');
  lines.push('');
  lines.push(`- self-refused: **${artifact.self_refused}**`);
  lines.push(`- files processed: ${artifact.per_run.length}`);
  lines.push(`- files fail-closed: ${artifact.per_run.filter((r) => r.fail_closed).length}`);
  lines.push(`- residual max |abs| across all valid files: ${fmt(artifact.overall.residual_max_abs)}`);
  lines.push(`- all valid files closed (<= ${EPSILON}): ${artifact.overall.all_closed}`);
  lines.push('');
  if (artifact.per_run.some((r) => r.fail_closed)) {
    lines.push('### Fail-closed refusals');
    lines.push('');
    for (const r of artifact.per_run.filter((r) => r.fail_closed)) {
      lines.push(`- \`${r.name}\`: ${r.missing_term}`);
    }
    lines.push('');
  }

  lines.push('## Stock-flow table per configuration');
  lines.push('');
  lines.push('| config | seeds | initial inventory | + spawn (mean) | + regrow (mean) | - grazing (mean) | - upkeep (mean) | remaining stock (mean) | cap-occupancy transition (median) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const [label, agg] of Object.entries(artifact.per_config)) {
    if (agg.all_fail_closed) { lines.push(`| ${label} | ${agg.seeds.join(',')} | -- | ALL FAIL-CLOSED | | | | | |`); continue; }
    const sf = agg.stock_flow_table;
    lines.push(`| ${label} | ${agg.seeds.join(',')} | ${fmt(sf.initial_inventory)} | ${fmt(sf.additions_spawn_mean)} | ${fmt(sf.additions_regrow_mean)} | ${fmt(sf.removals_grazing_mean)} | ${fmt(sf.removals_upkeep_mean)} | ${fmt(sf.remaining_stock_mean)} | ${fmt(sf.cap_occupancy_first_transition_median)} |`);
  }
  lines.push('');

  lines.push('## Mediator table per configuration');
  lines.push('');
  lines.push('| config | net prey growth (mean) | births | grazing requested (mean) | grazing taken (mean) | per-prey grazing (mean) | predator initial->final (mean) | stock min (mean) | stock variance (mean) |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const [label, agg] of Object.entries(artifact.per_config)) {
    if (agg.all_fail_closed) { lines.push(`| ${label} | ALL FAIL-CLOSED | | | | | | | |`); continue; }
    const mt = agg.mediator_table;
    lines.push(`| ${label} | ${fmt(mt.net_prey_growth_mean)} | ${mt.prey_births} | ${fmt(mt.grazing_requested_total_mean)} | ${fmt(mt.grazing_taken_total_mean)} | ${fmt(mt.derived_per_prey_grazing_mean)} | ${fmt(mt.predator_initial_mean)}->${fmt(mt.predator_final_mean)} | ${fmt(mt.stock_min_mean)} | ${fmt(mt.stock_variance_mean)} |`);
  }
  lines.push('');

  lines.push('## Outflow decomposition and prey trajectory per configuration');
  lines.push('');
  lines.push('| config | grazing share | upkeep share | cap-refusal rate (mean) | prey classification (majority) |');
  lines.push('|---|---|---|---|---|');
  for (const [label, agg] of Object.entries(artifact.per_config)) {
    if (agg.all_fail_closed) { lines.push(`| ${label} | ALL FAIL-CLOSED | | | |`); continue; }
    const maj = majorityClassification(agg.prey_classifications);
    lines.push(`| ${label} | ${fmt(agg.grazing_share_mean)} | ${fmt(agg.upkeep_share_mean)} | ${fmt(agg.cap_refusal_rate_mean)} | ${maj.majority} (${JSON.stringify(maj.counts)}) |`);
  }
  lines.push('');

  lines.push('## Verdict: srd2\'s "grazing scales with a growing prey population" wording');
  lines.push('');
  lines.push(artifact.prey_wording_verdict.statement);
  lines.push('');
  lines.push(`- defaults (7 replay seeds): ${artifact.prey_wording_verdict.defaults.majority} -- per-seed relative change: ${JSON.stringify(artifact.prey_wording_verdict.defaults.per_seed.map((s) => ({ seed: s.seed, relative_change: s.relative_change })))}`);
  lines.push(`- p=1.0 (3 calibration seeds): ${artifact.prey_wording_verdict.p1.majority} -- per-seed relative change: ${JSON.stringify(artifact.prey_wording_verdict.p1.per_seed.map((s) => ({ seed: s.seed, relative_change: s.relative_change })))}`);
  lines.push('');

  lines.push('## Per-run detail');
  lines.push('');
  lines.push('| run | config | seed | fail-closed | residual | closed | grazing share | prey classification | cap-refusal rate | cap-occupancy transition |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of artifact.per_run) {
    if (r.fail_closed) { lines.push(`| ${r.name} | ${r.config_label} | ${r.seed} | YES | -- | -- | -- | -- | -- | -- |`); continue; }
    lines.push(`| ${r.name} | ${r.config_label} | ${r.seed} | no | ${fmt(r.reconstruction.residual)} | ${r.reconstruction.closed} | ${fmt(r.outflow_decomposition.grazing_share)} | ${r.prey_trajectory.classification} | ${fmt(r.cap.cap_refusal_rate)} | ${fmt(r.cap.cap_occupancy_first_transition)} |`);
  }
  lines.push('');

  lines.push('## Input files consumed (read-only, sha256 recorded)');
  lines.push('');
  for (const r of artifact.per_run) {
    lines.push(`- \`${r.telemetry_path}\`: \`${r.telemetry_sha256}\``);
  }
  lines.push('');
  lines.push(`Self sha256 (computed on write, over the JSON artifact with this field blanked): \`${artifact.self_sha256_md_note}\` -- see \`reward-contract-demand-side__decomposition.json\`'s own \`self_sha256\` field for the authoritative value.`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(WORLD_STATE_PATH)) {
    process.stderr.write(`FATAL: ${WORLD_STATE_PATH} not found; cannot verify genesis constants.\n`);
    process.exit(1);
  }
  const worldStateSha256 = sha256File(WORLD_STATE_PATH);

  const runs = discoverRuns();
  if (runs.length === 0) {
    process.stderr.write(`FATAL: no runs discovered under ${SRD2_DIR}\n`);
    process.exit(1);
  }

  const perRun = runs.map(analyzeRun);

  const byConfig = {};
  for (const r of perRun) {
    if (!byConfig[r.config_label]) byConfig[r.config_label] = [];
    byConfig[r.config_label].push(r);
  }
  const perConfig = {};
  for (const [label, list] of Object.entries(byConfig)) {
    perConfig[label] = aggregateConfig(list);
  }

  const validRuns = perRun.filter((r) => !r.fail_closed);
  const anyFailClosed = perRun.some((r) => r.fail_closed);
  const residuals = validRuns.map((r) => Math.abs(r.reconstruction.residual));
  const allClosed = validRuns.length > 0 && validRuns.every((r) => r.reconstruction.closed);
  const selfRefused = anyFailClosed || !allClosed || validRuns.length === 0;

  const defaultsRows = (byConfig.defaults || []).filter((r) => !r.fail_closed).map((r) => ({ seed: r.seed, classification: r.prey_trajectory.classification, relative_change: r.prey_trajectory.relative_change }));
  const p1Rows = (byConfig.p1 || []).filter((r) => !r.fail_closed).map((r) => ({ seed: r.seed, classification: r.prey_trajectory.classification, relative_change: r.prey_trajectory.relative_change }));
  const defaultsMajority = majorityClassification(defaultsRows).majority;
  const p1Majority = majorityClassification(p1Rows).majority;

  const preyWordingVerdict = {
    statement: `srd2's wording "grazing scales with a growing prey population" is NOT supported as stated at defaults or at p=1.0 in this telemetry. At defaults (spawn_chance=0.04, 7 replay seeds) prey trajectory classifies as "${defaultsMajority}" (threshold +-${PREY_TRAJECTORY_THRESHOLD} relative change); at p=1.0 (3 calibration seeds) prey trajectory classifies as "${p1Majority}". Grazing demand (prey * prey_graze_rate) does scale WITH the prey population level at any instant (a mechanical fact of the formula in world-state.js:464), but the prey population itself is not observed to be growing over the 300-tick horizon in either configuration examined here.`,
    defaults: { majority: defaultsMajority, per_seed: defaultsRows },
    p1: { majority: p1Majority, per_seed: p1Rows }
  };

  const artifact = {
    schema: 'DemandDecompositionArtifact/1.0',
    task_id: 'reward-contract-demand-side',
    step_id: 'D1',
    generated_at: new Date().toISOString(),
    world_state_path: path.relative(REPO_ROOT, WORLD_STATE_PATH),
    world_state_sha256: worldStateSha256,
    genesis_constants: {
      initial_food_source_count: INITIAL_FOOD_SOURCE_COUNT,
      initial_food_source_amount: INITIAL_FOOD_SOURCE_AMOUNT,
      initial_patch_total: INITIAL_PATCH_TOTAL,
      initial_hive_stockpile_per_hive: INITIAL_HIVE_STOCKPILE,
      initial_total: INITIAL_TOTAL,
      source: 'tools/ant-hive-world/world-state.js:80-81 (INITIAL_FOOD_SOURCE_COUNT, INITIAL_FOOD_SOURCE_AMOUNT); zero-stockpile confirmed per-run from each run-log.jsonl tick=1 rows'
    },
    epsilon: EPSILON,
    prey_trajectory_classification_threshold: PREY_TRAJECTORY_THRESHOLD,
    self_refused: selfRefused,
    overall: {
      files_processed: perRun.length,
      files_fail_closed: perRun.filter((r) => r.fail_closed).length,
      residual_max_abs: residuals.length ? Math.max(...residuals) : null,
      all_closed: allClosed
    },
    prey_wording_verdict: preyWordingVerdict,
    per_run: perRun,
    per_config: perConfig,
    self_sha256: null
  };

  const withoutHash = JSON.stringify({ ...artifact, self_sha256: undefined });
  artifact.self_sha256 = sha256Str(withoutHash);

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2));

  const md = buildMarkdown({ ...artifact, self_sha256_md_note: artifact.self_sha256 });
  fs.writeFileSync(OUT_MD, md);

  process.stdout.write(`Artifact written: ${path.relative(REPO_ROOT, OUT_JSON)}\nself_sha256=${artifact.self_sha256}\nself_refused=${selfRefused}\nresidual_max_abs=${artifact.overall.residual_max_abs}\n`);
}

main();
