#!/usr/bin/env node
'use strict';

// tools/scoped/reward-contract-demand-side/calibration-sweep.cjs -- D2
// (single-knob calibration sweeps), plan reward-contract-demand-side.
// DUAL-MODE FILE, same shape as tools/scoped/srd2-boundary-crossing-trial/
// balance-audit.cjs:
//
//   1. SHIM MODE -- `node --require calibration-sweep.cjs run-live.js ...`.
//      require.main !== module, so main() never runs. Instead this file
//      REQUIRES the srd2 shim (tools/scoped/srd2-boundary-crossing-trial/
//      balance-audit.cjs) directly -- requiring it with SRD2_TELEMETRY_PATH
//      set auto-installs srd2's own validated per-transition instrumentation
//      (spawn/regrow/grazing/upkeep, whole-system accounting) on the SAME
//      cached world-state.js/harness.js/untrained-network.js module-cache
//      exports, exactly as it does for its own orchestrator. This tool adds
//      ONE thin additional wrap on top of the now-already-wrapped
//      worldState.applyEcosystemDynamics / worldState.maybeSpawnFoodSource,
//      purely to echo the RESOLVED opts.preyGrazeRate / opts.maxPrey /
//      opts.maxSources values the engine actually received on the first
//      call of a run (these are static for the whole run -- one knob per
//      run-config, D2 design) -- using the identical default-resolution
//      formula world-state.js itself documents (opts.X === undefined ?
//      DEFAULT_X : opts.X), the same pattern srd2 already used for its own
//      spawn.max_sources field. The outer wrap calls the (already
//      instrumented) inner function EXACTLY ONCE, forwards every argument
//      and the return value unchanged -- RNG draws and outcomes stay
//      byte-identical. No engine file (world-state.js, live-config.js,
//      harness.js, train-tick.js, run-live.js) is edited; both wraps live
//      entirely in preload shims.
//
//   2. ORCHESTRATOR MODE -- `node calibration-sweep.cjs` runs the D2 sweep:
//      one shared control run per calibration seed, then Arm G / Arm P /
//      Arm S, each walking its grid away from control with early stop at
//      the first qualifying value, and writes
//      _dev/reports/analysis/reward-contract-demand-side__calibration.json.
//
// ACCOUNTING: identical whole-system conserved formula to srd2's
// balance-audit.cjs (INFLOW = spawn successes' amount + regrow delta;
// OUTFLOW = grazing taken + upkeep taken; gathers are a net-zero internal
// transfer and enter no term). Per-run balance closure |predicted_final -
// actual_final| <= EPSILON is asserted and reported, never hidden on a miss.
// Genesis is independent of the swept knobs (INITIAL_FOOD_SOURCE_COUNT=5,
// INITIAL_FOOD_SOURCE_AMOUNT=8 are constants in world-state.js, not opts-
// driven), so initial_total=40 holds for every D2 run regardless of arm.
//
// QUALIFY RULE (frozen in the plan): a knob value qualifies iff the
// measured whole-system net balance is >= 0 on ALL 3 calibration seeds AND
// the median margin (net balance) across those 3 seeds is positive. Each
// arm walks its grid away from the shared control in the plan's listed
// order and stops at the first qualifying value. An arm that exhausts its
// grid without qualifying is ARM-UNREACHABLE, scoped to "this grid, this
// horizon (300 ticks), and this calibration seed set" -- never universal.
//
// KNOB ECHO (fail the run if it does not match): every run's knob-echo
// telemetry is asserted against the requested value (or the documented
// default when a run carries no override for that knob). max_prey has NO
// live-config.js key -- harness.js passes liveConfig.max_prey (undefined
// absent an override) straight through to world-state.js's own opts
// resolution, which falls back to 200 -- so every run records
// {requested, live_config_key_present, effective} for max_prey, and the
// shared control explicitly asserts effective 200 with the key absent.

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

const SANDBOX_BASE = path.join(REPO_ROOT, '_dev', 'sim-runs', 'rcds-ablation');
const OUT_JSON = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'reward-contract-demand-side__calibration.json');
const PILOT_ABLATION_JSON = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'sim-replenishment-dynamics__ablation.json');

const TICKS = 300;
const EPSILON = 1e-6;
const MAX_POSSIBLE_RUNS = 33;

// SEED REGISTRY (v2/v3, codex finding 2 + codewhale MINOR-1): raw,
// plan-scoped numbers, disjoint from every other allocated set. rcds
// confirmatory (777000501-507) is ALLOCATED here per the plan's D2 registry
// but only DRAWN at D3 -- listed for the disjointness assertion, never run
// by this tool.
const CALIBRATION_SEEDS = [777000401, 777000402, 777000403];
const SRD2_CALIBRATION_SEEDS = [777000301, 777000302, 777000303];
const RCDS_CONFIRMATORY_SEEDS_ALLOCATED_NOT_DRAWN = [777000501, 777000502, 777000503, 777000504, 777000505, 777000506, 777000507];

const ARMS = {
  G: { knob: 'prey_graze_rate', control: 0.4, grid_away_from_control: [0.3, 0.2, 0.1, 0.05, 0.0] },
  P: { knob: 'max_prey', control: 200, grid_away_from_control: [20, 10, 5] },
  S: { knob: 'max_food_sources', control: 7, grid_away_from_control: [14, 28] }
};

// ---------------------------------------------------------------------------
// SHIM MODE
// ---------------------------------------------------------------------------
function installKnobEcho(telemetryPath) {
  const worldState = require(WORLD_STATE_PATH_MOD);
  // worldState.applyEcosystemDynamics / maybeSpawnFoodSource are ALREADY
  // wrapped by srd2's installInstrumentation at this point (required just
  // above, same cached exports object) -- wrapping them again here chains a
  // second, outer wrapper. Each layer still calls its argument exactly
  // once and forwards the return value unchanged.
  const innerGrazing = worldState.applyEcosystemDynamics;
  const innerSpawn = worldState.maybeSpawnFoodSource;
  let grazingEchoed = false;
  let spawnEchoed = false;

  worldState.applyEcosystemDynamics = function knobEchoGrazing(state, rng, opts = {}) {
    if (!grazingEchoed) {
      const preyGrazeRateEffective = opts.preyGrazeRate === undefined ? worldState.DEFAULT_PREY_GRAZE_RATE : opts.preyGrazeRate;
      const maxPreyEffective = opts.maxPrey === undefined ? worldState.DEFAULT_MAX_PREY : opts.maxPrey;
      fs.appendFileSync(telemetryPath, `${JSON.stringify({
        knob_echo_source: 'applyEcosystemDynamics',
        prey_graze_rate_requested_opt: opts.preyGrazeRate === undefined ? null : opts.preyGrazeRate,
        prey_graze_rate_effective: preyGrazeRateEffective,
        max_prey_key_present: opts.maxPrey !== undefined,
        max_prey_requested_opt: opts.maxPrey === undefined ? null : opts.maxPrey,
        max_prey_effective: maxPreyEffective
      })}\n`);
      grazingEchoed = true;
    }
    return innerGrazing.call(this, state, rng, opts);
  };

  worldState.maybeSpawnFoodSource = function knobEchoSpawn(state, rng, opts = {}) {
    if (!spawnEchoed) {
      const maxSourcesEffective = opts.maxSources === undefined ? worldState.DEFAULT_MAX_FOOD_SOURCES : opts.maxSources;
      fs.appendFileSync(telemetryPath, `${JSON.stringify({
        knob_echo_source: 'maybeSpawnFoodSource',
        max_food_sources_requested_opt: opts.maxSources === undefined ? null : opts.maxSources,
        max_food_sources_effective: maxSourcesEffective
      })}\n`);
      spawnEchoed = true;
    }
    return innerSpawn.call(this, state, rng, opts);
  };
}

// ---------------------------------------------------------------------------
// ORCHESTRATOR MODE helpers
// ---------------------------------------------------------------------------
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Str(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

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

function runInstrumented({ sandboxAbs, seed, runName, ticks, overrides }) {
  fs.mkdirSync(sandboxAbs, { recursive: true });
  if (overrides && Object.keys(overrides).length > 0) {
    fs.writeFileSync(path.join(sandboxAbs, 'live-config.json'), JSON.stringify(overrides, null, 2));
  }
  const telemetryPath = path.join(sandboxAbs, 'srd2-telemetry.jsonl');
  const knobEchoPath = path.join(sandboxAbs, 'rcds-knob-echo.jsonl');
  if (fs.existsSync(telemetryPath)) fs.rmSync(telemetryPath);
  if (fs.existsSync(knobEchoPath)) fs.rmSync(knobEchoPath);
  const args = ['--require', THIS_FILE, RUN_LIVE, '--ticks', String(ticks), '--sandbox-root', sandboxAbs, '--root-seed', String(seed), '--run-name', runName, '--no-checkpoint'];
  const commandLine = `${process.execPath} ${args.join(' ')}`;
  const t0 = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT, encoding: 'utf8',
    env: { ...process.env, SRD2_TELEMETRY_PATH: telemetryPath, RCDS_KNOB_ECHO_PATH: knobEchoPath }
  });
  const elapsedMs = Date.now() - t0;
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, sandboxAbs, telemetryPath, knobEchoPath, elapsedMs, commandLine };
}

function readTelemetry(telemetryPath) {
  if (!fs.existsSync(telemetryPath)) return [];
  return fs.readFileSync(telemetryPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function readKnobEcho(knobEchoPath) {
  if (!fs.existsSync(knobEchoPath)) return { available: false };
  const rows = fs.readFileSync(knobEchoPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const merged = { available: true };
  for (const r of rows) Object.assign(merged, r);
  return merged;
}

// Identical to srd2 balance-audit.cjs's computeWholeSystemBalance; genesis
// (initial_total=40) is independent of the D2 swept knobs.
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
    predicted_final_total: predicted, residual, closed: residual <= EPSILON
  };
}

function summarizePreyTrajectory(telemetry) {
  const seq = [];
  if (telemetry.length && telemetry[0].grazing) seq.push(telemetry[0].grazing.prey_before);
  for (const row of telemetry) {
    if (typeof row.prey_population_after === 'number') seq.push(row.prey_population_after);
  }
  if (seq.length === 0) return { available: false };
  const initial = seq[0];
  const final = seq[seq.length - 1];
  const min = Math.min(...seq);
  const max = Math.max(...seq);
  const deltaFraction = initial !== 0 ? (final - initial) / initial : (final - initial);
  let shape;
  if (deltaFraction > 0.05) shape = 'growing';
  else if (deltaFraction < -0.05) shape = 'declining';
  else shape = 'equilibrating';
  return { available: true, initial, final, min, max, delta: final - initial, delta_fraction: deltaFraction, shape };
}

// KNOB ECHO ASSERTION (fail the run if it does not match): for the knob
// under test, effective must equal requested; for the two knobs NOT under
// test this run, effective must equal the documented default (0.4 / 200
// with key absent / 7).
function assertKnobEcho({ knob, requestedValue, knobEcho }) {
  if (!knobEcho.available) {
    return { all_pass: false, reason: 'knob-echo telemetry file missing or empty' };
  }
  const preyGrazeOk = knob === 'prey_graze_rate'
    ? Math.abs(knobEcho.prey_graze_rate_effective - requestedValue) < 1e-9
    : knobEcho.prey_graze_rate_effective === 0.4;
  const maxPreyOk = knob === 'max_prey'
    ? (knobEcho.max_prey_effective === requestedValue && knobEcho.max_prey_key_present === true)
    : (knobEcho.max_prey_effective === 200 && knobEcho.max_prey_key_present === false);
  const maxFoodSourcesOk = knob === 'max_food_sources'
    ? knobEcho.max_food_sources_effective === requestedValue
    : knobEcho.max_food_sources_effective === 7;
  const allPass = preyGrazeOk && maxPreyOk && maxFoodSourcesOk;
  return {
    all_pass: allPass,
    prey_graze_rate_effective: knobEcho.prey_graze_rate_effective, prey_graze_rate_ok: preyGrazeOk,
    max_prey_effective: knobEcho.max_prey_effective, max_prey_key_present: knobEcho.max_prey_key_present, max_prey_ok: maxPreyOk,
    max_food_sources_effective: knobEcho.max_food_sources_effective, max_food_sources_ok: maxFoodSourcesOk
  };
}

function buildEntry({ armId, knob, requestedValue, seed, runTag }) {
  const sandboxAbs = path.join(SANDBOX_BASE, `${runTag}-${seed}`);
  const overrides = knob ? { [knob]: requestedValue } : {};
  const run = runInstrumented({ sandboxAbs, seed, runName: `rcds-${runTag}-${seed}`, ticks: TICKS, overrides });
  const base = {
    arm: armId, knob: knob || null, requested_value: knob ? requestedValue : null, seed,
    sandbox: path.relative(REPO_ROOT, sandboxAbs), command_line: run.commandLine, elapsed_ms: run.elapsedMs
  };
  if (run.status !== 0) {
    return { ...base, valid: false, reason: `run-live.js exited ${run.status}: ${(run.stderr || '').slice(-800)}` };
  }
  const telemetry = readTelemetry(run.telemetryPath);
  const knobEcho = readKnobEcho(run.knobEchoPath);
  const echoAssertion = assertKnobEcho({ knob, requestedValue, knobEcho });
  if (!echoAssertion.all_pass) {
    return { ...base, valid: false, reason: `KNOB_ECHO_MISMATCH: ${JSON.stringify(echoAssertion)}` };
  }
  const balance = computeWholeSystemBalance(sandboxAbs, telemetry);
  return {
    ...base, valid: true,
    balance,
    outflow_decomposed: { grazing: balance.cumulative_grazing_out, upkeep: balance.cumulative_upkeep_out },
    prey_trajectory: summarizePreyTrajectory(telemetry),
    knob_echo: knobEcho,
    knob_echo_assertion: echoAssertion,
    max_prey_triple: { requested: knobEcho.max_prey_requested_opt, live_config_key_present: knobEcho.max_prey_key_present, effective: knobEcho.max_prey_effective },
    transitions_recorded: telemetry.length
  };
}

function checkSeedDisjointness() {
  const pilotHeader = JSON.parse(fs.readFileSync(PILOT_ABLATION_JSON, 'utf8'));
  const pilotSeeds = pilotHeader.pre_registration.seeds_all;
  const sets = {
    pilot_sim_replenishment_dynamics: { seeds: pilotSeeds, status: 'drawn' },
    srd2_calibration: { seeds: SRD2_CALIBRATION_SEEDS, status: 'drawn' },
    rcds_calibration: { seeds: CALIBRATION_SEEDS, status: 'drawn (this D2 run)' },
    rcds_confirmatory: { seeds: RCDS_CONFIRMATORY_SEEDS_ALLOCATED_NOT_DRAWN, status: 'allocated, NOT drawn (deferred to D3)' }
  };
  const seen = new Map();
  const collisions = [];
  for (const [setName, entry] of Object.entries(sets)) {
    for (const s of entry.seeds) {
      if (seen.has(s)) collisions.push({ seed: s, sets: [seen.get(s), setName] });
      else seen.set(s, setName);
    }
  }
  return { sets, disjoint: collisions.length === 0, collisions };
}

function computeD3Selection(arms) {
  const qualifying = Object.values(arms).filter((a) => a.status === 'QUALIFIED');
  if (qualifying.length === 0) return null;
  const withDeviation = qualifying.map((a) => {
    const def = ARMS[a.arm].control;
    const deviation = Math.abs(a.qualifying_value - def) / def;
    return { arm: a.arm, knob: a.knob, qualifying_value: a.qualifying_value, default_value: def, relative_deviation: deviation };
  });
  const order = { G: 0, P: 1, S: 2 };
  withDeviation.sort((x, y) => (x.relative_deviation !== y.relative_deviation
    ? x.relative_deviation - y.relative_deviation
    : order[x.arm] - order[y.arm]));
  return { selected: withDeviation[0], all_qualifying_candidates: withDeviation };
}

function main() {
  fs.mkdirSync(SANDBOX_BASE, { recursive: true });
  const engineFilesHashBefore = hashEngineFiles();
  const executedRuns = [];
  const earlyStopLog = [];

  process.stdout.write('D2: shared control runs (once per seed)...\n');
  const controlEntries = CALIBRATION_SEEDS.map((seed) => {
    const entry = buildEntry({ armId: 'CONTROL', knob: null, requestedValue: null, seed, runTag: 'control' });
    executedRuns.push(entry);
    return entry;
  });
  const controlAllValid = controlEntries.every((e) => e.valid);
  const controlNetBalances = controlEntries.filter((e) => e.valid).map((e) => e.balance.net_balance);
  process.stdout.write(`control complete: all_valid=${controlAllValid}\n`);

  const arms = {};
  for (const [armId, armDef] of Object.entries(ARMS)) {
    process.stdout.write(`D2: Arm ${armId} (${armDef.knob}), walking ${JSON.stringify(armDef.grid_away_from_control)} away from control ${armDef.control}...\n`);
    const armResult = { arm: armId, knob: armDef.knob, control_value: armDef.control, grid_walked: [], status: null, qualifying_value: null };
    for (const value of armDef.grid_away_from_control) {
      const runTag = `${armId}-${String(value).replace(/\./g, '_')}`;
      const perSeedEntries = CALIBRATION_SEEDS.map((seed) => {
        const entry = buildEntry({ armId, knob: armDef.knob, requestedValue: value, seed, runTag });
        executedRuns.push(entry);
        return entry;
      });
      const validEntries = perSeedEntries.filter((e) => e.valid);
      const allValid = validEntries.length === CALIBRATION_SEEDS.length;
      const netBalances = validEntries.map((e) => e.balance.net_balance);
      const allNonNegative = allValid && netBalances.every((n) => n >= 0);
      const medianMargin = allValid ? median(netBalances) : null;
      const qualifies = allValid && allNonNegative && medianMargin > 0;
      armResult.grid_walked.push({ value, per_seed: perSeedEntries, all_valid: allValid, all_non_negative: allNonNegative, net_balances: netBalances, median_margin: medianMargin, qualifies });
      earlyStopLog.push({ arm: armId, knob: armDef.knob, value, all_valid: allValid, qualifies, ran_seed_count: CALIBRATION_SEEDS.length, stopped_here: qualifies });
      if (qualifies) { armResult.qualifying_value = value; armResult.status = 'QUALIFIED'; break; }
    }
    if (armResult.status !== 'QUALIFIED') {
      armResult.status = 'ARM-UNREACHABLE';
      armResult.scope_note = `unreachable on this grid, horizon (300 ticks), and calibration seed set (${CALIBRATION_SEEDS.join(', ')})`;
    }
    process.stdout.write(`Arm ${armId} complete: status=${armResult.status} qualifying_value=${armResult.qualifying_value}\n`);
    arms[armId] = armResult;
  }

  const engineFilesHashAfter = hashEngineFiles();
  const engineFilesUnchanged = Object.keys(ENGINE_FILES).every((k) => engineFilesHashBefore[k] === engineFilesHashAfter[k]);

  const executedCount = executedRuns.length;
  const withinBound = executedCount <= MAX_POSSIBLE_RUNS;
  const seedRegistry = checkSeedDisjointness();
  const d3Selection = computeD3Selection(arms);

  const artifact = {
    schema: 'CalibrationSweepArtifact/1.0',
    task_id: 'reward-contract-demand-side',
    step_id: 'D2',
    generated_at: new Date().toISOString(),
    epsilon: EPSILON,
    ticks_per_run: TICKS,
    calibration_seeds: CALIBRATION_SEEDS,
    seed_registry: seedRegistry,
    engine_files_hash_before: engineFilesHashBefore,
    engine_files_hash_after: engineFilesHashAfter,
    engine_files_unchanged: engineFilesUnchanged,
    control: { entries: controlEntries, all_valid: controlAllValid, net_balances: controlNetBalances },
    arms,
    executed_run_count: executedCount,
    max_possible_runs: MAX_POSSIBLE_RUNS,
    within_bound: withinBound,
    early_stop_log: earlyStopLog,
    d3_selection: d3Selection,
    self_sha256: null
  };
  const withoutHash = JSON.stringify({ ...artifact, self_sha256: undefined });
  artifact.self_sha256 = sha256Str(withoutHash);
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2));
  process.stdout.write(`Artifact written: ${OUT_JSON}\nexecuted_run_count=${executedCount} within_bound=${withinBound} engine_files_unchanged=${engineFilesUnchanged}\nself_sha256=${artifact.self_sha256}\n`);
}

module.exports = { installKnobEcho, computeWholeSystemBalance, assertKnobEcho, checkSeedDisjointness, computeD3Selection };

// ---------------------------------------------------------------------------
// MODE DISPATCH -- placed last, after every const/function it references is
// defined (main() and its helpers use `const` declarations such as
// ENGINE_FILES that are not hoisted; calling main() before they initialize
// throws a TDZ ReferenceError, so this dispatch cannot sit above them).
// ---------------------------------------------------------------------------
if (require.main !== module) {
  // ORDER MATTERS (same destructuring pitfall balance-audit.cjs's own
  // header documents): harness.js does `const { applyEcosystemDynamics,
  // maybeSpawnFoodSource } = require('./world-state.js')` at ITS OWN
  // require time, capturing whatever is CURRENTLY set on world-state.js's
  // exports at that instant. srd2's installInstrumentation() (triggered
  // below by requiring SRD2_SHIM with SRD2_TELEMETRY_PATH set) itself
  // requires harness.js as part of its own setup -- so this wrap MUST be
  // installed BEFORE that require() call, or harness.js permanently binds
  // to a function reference that never includes this outer layer. Chain
  // becomes: original -> knobEcho (installed here) -> srd2 (installed
  // next, wraps knobEcho's current value) -> harness.js destructures the
  // outermost (srd2's) wrapper once, at the correct moment.
  const knobEchoPath = process.env.RCDS_KNOB_ECHO_PATH;
  if (knobEchoPath) installKnobEcho(knobEchoPath);
  require(SRD2_SHIM);
} else {
  main();
}
