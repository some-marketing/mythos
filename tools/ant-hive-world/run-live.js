#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/run-live.js — attended run driver.
//
// Sets up N hives (blank-start), one genuinely-untrained REINFORCE network
// per hive (untrained-network.js), and drives ticks via train-tick.js --
// the sim IS the training ground. This intentionally supersedes an
// LLM-decide-based tick (llm-decide.js/Ollama): a pretrained LLM still
// carries baked-in knowledge in its weights, which is pre-loaded instinct by
// another name -- see README.md's "fresh minds" section.
//
// Meant to be run attended: monitoring is log-based/operator-reviewed, not
// an automated pass/fail gate -- this writes a durable per-tick JSONL run
// log AND drives the live dashboard's world-state file so the dashboard is
// servable in parallel (start tools/ant-hive-world/dashboard.js against the
// same --sandbox-root separately; not spawned from here so the operator can
// stop/restart the dashboard independently of the run).
//
// Usage: node run-live.js [--ticks N] [--forever] [--tick-interval-ms N] [--sandbox-root <dir>]
//
// --forever: keep running until the process receives SIGINT/SIGTERM (Ctrl-C
// or `kill <pid>`) -- operator (2026-07-16): "just leave it running see what
// happens." Per enforce-interruptability, a SIGINT/SIGTERM handler below
// stops cleanly after the in-flight tick and appends a `run-stopped` marker
// to the run log rather than being killed mid-write.
// --tick-interval-ms: pause between full rounds (both hives ticked once)
// so the dashboard visibly progresses in real wall-clock time instead of
// finishing in under a second -- there is no in-sim notion of elapsed time
// otherwise.

const fs = require('fs');
const path = require('path');
const { setupHives, tick } = require('./harness.js');
const { generateBlankHiveSeed } = require('./generate-blank-hive-seed.js');
const { createNetwork, mulberry32 } = require('./untrained-network.js');
const { trainTick } = require('./train-tick.js');
const { readLiveConfig, writeLiveConfig } = require('./live-config.js');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function hasFlag(flag) {
  return process.argv.indexOf(flag) !== -1;
}

const FOREVER = hasFlag('--forever');
const TICKS = parseInt(argVal('--ticks', '300'), 10);
const TICK_INTERVAL_MS = parseInt(argVal('--tick-interval-ms', '0'), 10);
const SANDBOX_ROOT = argVal('--sandbox-root', path.join(__dirname, '..', '..', '_dev', 'state', 'ant-hive-world-run'));
const WORLD_STATE_PATH = path.join(SANDBOX_ROOT, 'shared', 'world-state.json');
const RUN_LOG_PATH = path.join(SANDBOX_ROOT, 'run-log.jsonl');
const CONFIG_PATH = path.join(SANDBOX_ROOT, 'live-config.json');

let stopRequested = false;
function requestStop(signal) {
  stopRequested = true;
  process.stdout.write(`\nReceived ${signal} -- stopping cleanly after the in-flight tick.\n`);
}
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HIVE_IDS = ['hive-a', 'hive-b'];
const RESOURCE_POOL = { food: 40, wood: 30, stone: 15 };
const AUTHORED_BY = 'ant-hive-world/run-live.js -- untrained-network, no pretraining, early-minds generation';

const seeds = HIVE_IDS.map((id) => generateBlankHiveSeed(id, AUTHORED_BY, new Date().toISOString()));
const hives = setupHives(SANDBOX_ROOT, seeds, WORLD_STATE_PATH, RESOURCE_POOL);

// Seed the live-config file from CLI args so the dashboard's initial form
// reflects what this run actually started with, not just internal defaults.
writeLiveConfig(CONFIG_PATH, { tick_interval_ms: TICK_INTERVAL_MS });

// "Early minds" -- operator (2026-07-16): "delete the old minds we ran in
// the ant sim and create new neural networks... to start fresh." Networks
// are never persisted to disk (they only ever live in this process's
// memory), so there was nothing to delete on disk -- but the PREVIOUS
// version of this file hardcoded fixed seeds (20260716/20260717), which
// meant re-running it would have replayed the exact same initial random
// weights every time, not a genuinely new mind. Seeds now default to
// fresh, never-repeating values (Date.now()-derived, offset per hive so
// the two minds are never identical to each other either) -- overridable
// via --seed-a/--seed-b only for deliberate, explicit reproducibility
// (e.g. debugging one specific run), never as the default.
const seedAOverride = argVal('--seed-a', null);
const seedBOverride = argVal('--seed-b', null);
const baseSeed = Date.now();
const seedA = seedAOverride !== null ? parseInt(seedAOverride, 10) : (baseSeed >>> 0);
const seedB = seedBOverride !== null ? parseInt(seedBOverride, 10) : ((baseSeed + 104729) >>> 0); // + a prime offset, never identical to seedA

const networks = {
  'hive-a': createNetwork(seedA),
  'hive-b': createNetwork(seedB)
};
process.stdout.write(`Early minds this run: hive-a seed=${seedA}, hive-b seed=${seedB} (fresh, never-repeating unless --seed-a/--seed-b explicitly overridden).\n`);
// Decision-sampling rngs also default to fresh seeds, offset from the
// network-init seeds so all four random streams (2 network inits, 2
// decision-samplers) are independent of each other.
const rngs = {
  'hive-a': mulberry32((seedA + 12345) >>> 0),
  'hive-b': mulberry32((seedB + 12345) >>> 0)
};

// Reactive-entropy-controller state, ONE object per hive (resolved
// s4-reactive-controller gate): each controller reads only its OWN hive's
// last measured policy_entropy_post_update, threaded explicitly through
// trainTick -- never a module global (which could leak the feedback signal
// between hives) and never persisted (fresh-minds rule: created fresh here,
// dies with the process).
const controllers = {
  'hive-a': { active: false, prev_post_update_entropy: undefined },
  'hive-b': { active: false, prev_post_update_entropy: undefined }
};

process.stdout.write(`ant-hive-world S3 first attended run starting.\n`);
process.stdout.write(`Sandbox: ${SANDBOX_ROOT}\n`);
process.stdout.write(`Shared resources at start: ${JSON.stringify(RESOURCE_POOL)}\n`);
process.stdout.write(`Mind: untrained-network.js (from-scratch REINFORCE, no pretraining, no LLM).\n`);
process.stdout.write(FOREVER
  ? `Running until stopped (SIGINT/SIGTERM), ${TICK_INTERVAL_MS}ms between rounds. Run log: ${RUN_LOG_PATH}\n`
  : `Running ${TICKS} ticks per hive (alternating). Run log: ${RUN_LOG_PATH}\n`);
process.stdout.write(`Config file (live-tunable via the dashboard): ${CONFIG_PATH}\n`);
process.stdout.write(`Start the dashboard separately to watch live: node tools/ant-hive-world/dashboard.js --sandbox-root ${SANDBOX_ROOT}\n\n`);

function appendRunLog(entry) {
  fs.appendFileSync(RUN_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

async function runTicks() {
  let i = 0;
  while (FOREVER ? !stopRequested : i < TICKS) {
    // Read fresh every round -- operator (2026-07-16): "i need to be able
    // to modify variables in this dashboard." No restart needed; the
    // dashboard's /config POST writes this same file.
    const liveConfig = readLiveConfig(CONFIG_PATH);
    for (const id of HIVE_IDS) {
      const result = trainTick(hives[id], WORLD_STATE_PATH, networks[id], rngs[id], liveConfig, i, controllers[id]);
      process.stdout.write(`[tick ${i + 1}] ${id} -> ${result.action} applied=${result.applied} starved=${result.starved} reward=${result.reward} entropy=${result.policy_entropy?.toFixed(3)}${result.forced_exploration ? ' [forced]' : ''}${result.entropy_controller_active ? ' [ctl]' : ''}\n`);
      appendRunLog({
        tick: i + 1,
        hive: id,
        action: result.action,
        applied: result.applied,
        starved: result.starved,
        reward: result.reward,
        policy_entropy: result.policy_entropy,
        policy_entropy_post_update: result.policy_entropy_post_update,
        forced_exploration: result.forced_exploration,
        entropy_controller_active: result.entropy_controller_active,
        effective_entropy_bonus_weight: result.effective_entropy_bonus_weight,
        stockpile: result.hiveState.hive_state.stockpile
      });
    }
    i += 1;
    const intervalMs = liveConfig.tick_interval_ms ?? TICK_INTERVAL_MS;
    if (intervalMs > 0) await sleep(intervalMs);
  }
  if (FOREVER && stopRequested) {
    appendRunLog({ event: 'run-stopped', tick: i, reason: 'signal' });
  }
  process.stdout.write(`\nDone after ${i} rounds. Final world-state: ${WORLD_STATE_PATH}\nRun log: ${RUN_LOG_PATH}\n`);
}

runTicks().catch((e) => {
  process.stderr.write(`run-live.js error: ${e.message}\n`);
  process.exit(1);
});
