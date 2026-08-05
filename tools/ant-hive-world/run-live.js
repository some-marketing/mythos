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
// Usage: node run-live.js [--ticks N] [--forever] [--tick-interval-ms N]
//                         [--sandbox-root <dir>] [--arm <name>]
//                         [--checkpoint-root <dir>] [--resume-from <generation-id>]
//                         [--root-seed <int>] [--run-name <name>]
//                         [--status-path <file>] [--no-checkpoint]
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
//
// CHECKPOINTING (plan ant-world-checkpoint-loader, S0-S2). Every run commits
// one generation at the end of its ticks, atomically, under --checkpoint-root
// (default <sandbox-root>/checkpoints; the guest runner passes the shared
// guest-local /opt/antworld/_dev/state/checkpoints explicitly). Checkpoints
// never cross the courier. --resume-from names a generation to continue; absent, the
// run is an explicit fresh start, recorded as fresh_start=true in provenance
// rather than assumed by silence. A resume that fails ANY of the five
// validation stages halts: STATUS=resume-failed-halt:<stage>:<reason>, nonzero
// exit, and zero state constructed. There is no silent fresh-start fallback,
// by construction rather than by discipline -- the gate returns before the
// state-construction block can run at all.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { setupHives, restoreHives, tick } = require('./harness.js');
const { generateBlankHiveSeed } = require('./generate-blank-hive-seed.js');
const { createNetwork } = require('./untrained-network.js');
const { createWorldMind, decideWorld, applyWorldVerb, WORLD_VERB_ORDER } = require('./world-mind.js');
const { readWorldState, writeWorldState } = require('./world-state.js');
const { trainTick } = require('./train-tick.js');
const { readLiveConfig, writeLiveConfig } = require('./live-config.js');
const { createEventContext, decorateEvent, processEventContext } = require('./event-schema.js');
const checkpoint = require('./checkpoint.js');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function hasFlag(flag) {
  return process.argv.indexOf(flag) !== -1;
}

// ---------------------------------------------------------------------------
// 1. ARGUMENT / job.env PARSING -- the only thing that happens before the gate
// ---------------------------------------------------------------------------
const FOREVER = hasFlag('--forever');
const TICKS = parseInt(argVal('--ticks', '300'), 10);
const TICK_INTERVAL_MS = parseInt(argVal('--tick-interval-ms', '0'), 10);
const SANDBOX_ROOT = argVal('--sandbox-root', path.join(__dirname, '..', '..', '_dev', 'state', 'ant-hive-world-run'));
const WORLD_STATE_PATH = path.join(SANDBOX_ROOT, 'shared', 'world-state.json');
const RUN_LOG_PATH = path.join(SANDBOX_ROOT, 'run-log.jsonl');
const DECISION_STREAM_PATH = path.join(SANDBOX_ROOT, 'decision-stream.jsonl');
const CONFIG_PATH = path.join(SANDBOX_ROOT, 'live-config.json');
const ARM_ID = argVal('--arm', 'uninstructed');
const NO_CHECKPOINT = hasFlag('--no-checkpoint');

// job.env is the guest's job spec, sourced into the runner's environment before
// the driver is invoked. A CLI flag always wins over the environment: the flag
// is what a local operator typed this minute, the environment is what a job
// spec said when it was written.
const jobEnv = {
  RESUME_FROM: argVal('--resume-from', process.env.RESUME_FROM || null),
  ROOT_SEED: argVal('--root-seed', process.env.ROOT_SEED || null),
  RUN_NAME: argVal('--run-name', process.env.RUN_NAME || ARM_ID),
  // Default is SANDBOX-LOCAL, deliberately. An earlier draft defaulted to
  // <sandbox>/../checkpoints to mirror the guest's shared
  // /opt/antworld/_dev/state/checkpoints, and that immediately produced a real
  // defect: every sandbox under _dev/state/ shared one lineage directory, so
  // two unrelated local runs with the same run name collided and refused. The
  // collision rule was right; the default was wrong. The guest keeps its shared
  // root by passing --checkpoint-root explicitly from the runner, where run
  // names are unique per turn and a shared lineage is the point.
  CHECKPOINT_ROOT: argVal('--checkpoint-root', process.env.CHECKPOINT_ROOT
    || path.join(SANDBOX_ROOT, 'checkpoints')),
  STATUS_PATH: argVal('--status-path', process.env.STATUS_PATH || null)
};

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

// STATUS is the runner's existing refusal channel (the guest runner writes
// $COURIER/out/STATUS). The driver writes to --status-path when given one and
// to <sandbox>/STATUS otherwise, and always echoes the token on stderr. This
// adds no courier surface: it writes to the file the runner already publishes.
function writeStatus(status) {
  const target = jobEnv.STATUS_PATH || path.join(SANDBOX_ROOT, 'STATUS');
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${status}\n`);
  } catch (e) {
    process.stderr.write(`could not write STATUS to ${target}: ${e.message}\n`);
  }
  process.stderr.write(`STATUS=${status}\n`);
}

// ---------------------------------------------------------------------------
// 2. THE RESUME GATE -- the FIRST act after parsing
// ---------------------------------------------------------------------------
// Returns either an explicit fresh-start token or a validated restore handle.
// It NEVER returns on failure: it writes STATUS and exits nonzero from inside
// the gate, with no state object constructed, no sandbox written, no world
// seeded, no network allocated. That ordering is the whole mechanism -- a
// fallback cannot be taken accidentally if the code that would fall back has
// not run yet.
function resolveResumeOrFreshStart(env) {
  const checkpointRoot = path.resolve(env.CHECKPOINT_ROOT);

  // RECOVERY RULE, applied before anything reads the directory: uncommitted
  // generations and staging residue are swept on start. Committed generations
  // are never touched, including the last-known-good one.
  // The requested generation is exempted from the sweep so that, if it is
  // itself uncommitted, the refusal names the real defect (stage 2) instead of
  // deleting the evidence and then reporting stage 1 "absent".
  fs.mkdirSync(checkpointRoot, { recursive: true });
  const sweep = checkpoint.sweepUncommitted(checkpointRoot, {
    exempt: env.RESUME_FROM ? [String(env.RESUME_FROM).trim()] : []
  });
  for (const s of sweep.swept) {
    process.stdout.write(`swept uncommitted checkpoint ${s.name} (${s.reason})\n`);
  }
  if (sweep.exempted.length) {
    process.stdout.write(`sweep exempted (resume target): ${sweep.exempted.join(', ')}\n`);
  }

  if (!env.RESUME_FROM) {
    process.stdout.write(`resume: none requested -- explicit FRESH START (fresh_start=true)\n`);
    return { mode: 'fresh_start', fresh_start: true, checkpointRoot, restored: null };
  }

  const id = String(env.RESUME_FROM).trim();
  process.stdout.write(`resume: requested generation ${id} from ${checkpointRoot}\n`);
  // FROZEN INPUT ENFORCEMENT: the manifest records the input packet (or its
  // explicit absence) that was in force when the generation was written. A
  // resume must be validated against THIS run's current packet -- computed
  // here, before the gate, so a mismatch (or a presence/absence flip) halts
  // exactly like every other stage: named status, zero state constructed.
  // currentInputPacket() only reads SANDBOX_ROOT, which is set at argument
  // parse time above the gate, so this is safe to call this early.
  const currentPacket = currentInputPacket();
  const validation = checkpoint.validateGeneration(checkpointRoot, id, { currentInputPacket: currentPacket });
  if (!validation.ok) {
    process.stderr.write(
      `RESUME REFUSED at stage '${validation.stage}': ${validation.reason}\n` +
      `No state was constructed. Last-known-good generations are retained for manual recovery:\n` +
      checkpoint.listCommittedGenerations(checkpointRoot)
        .map((g) => `  ${g.generation_id} (day ${g.absolute_day})\n`).join('') +
      `Halt-for-repair: this driver will not fall back to a fresh start.\n`
    );
    writeStatus(validation.status);
    process.exit(1);
  }

  let restored;
  try {
    restored = checkpoint.loadGeneration(checkpointRoot, id, { currentInputPacket: currentPacket });
  } catch (e) {
    // Only reachable if the generation changed on disk between validation and
    // load. Same refusal shape: named stage, no state, nonzero exit.
    writeStatus(`resume-failed-halt:${checkpoint.STAGES.CHECKSUMS}:load-race-${e.message.replace(/[^A-Za-z0-9.-]+/g, '-')}`);
    process.exit(1);
  }

  process.stdout.write(
    `resume: validated ${id} -- all ${validation.stages_passed.length} stages passed ` +
    `(${validation.stages_passed.join(' -> ')})\n` +
    `resume: continuing at absolute tick ${restored.identity.absolute_tick} ` +
    `(day ${restored.manifest.absolute_day}, lineage depth ${restored.manifest.parent.lineage_depth}, ` +
    `turn ${restored.identity.turn_index})\n`
  );
  return { mode: 'resume', fresh_start: false, checkpointRoot, restored };
}

const resolution = resolveResumeOrFreshStart(jobEnv);

// ---------------------------------------------------------------------------
// 3. GATED STATE CONSTRUCTION -- reachable only via the gate's return
// ---------------------------------------------------------------------------

// Falsifier for "the serializable RNG is mulberry32": if this throws, every
// continuity claim downstream is void, so it throws rather than warns. Runs
// after the gate (a refusal must reach STATUS before anything else can fail)
// and before any state exists.
checkpoint.assertRngParity();

// Root seed. The former `Date.now()` base seed is GONE (plan S3 clause (a)):
// wall-clock seeding meant no run was reproducible and no two arms could be
// given "the same seeds", which makes a continuity claim untestable. The seed
// is now explicit, or -- when nothing supplies one -- drawn from the OS CSPRNG,
// which is still never-repeating (the fresh-minds property that motivated
// Date.now()) but is not a function of invocation time. Either way it is
// recorded in provenance and in every checkpoint, so any run can be replayed.
let rootSeed;
let rootSeedSource;
if (resolution.mode === 'resume') {
  rootSeed = resolution.restored.identity.root_seed;
  rootSeedSource = 'restored';
} else if (jobEnv.ROOT_SEED !== null && jobEnv.ROOT_SEED !== '') {
  rootSeed = parseInt(jobEnv.ROOT_SEED, 10) >>> 0;
  if (!Number.isFinite(rootSeed)) {
    writeStatus('invalid-root-seed');
    process.exit(1);
  }
  rootSeedSource = process.argv.includes('--root-seed') ? 'arg' : 'env';
} else {
  rootSeed = crypto.randomInt(0, 4294967296);
  rootSeedSource = 'generated';
}

// Derivation is unchanged in form from the pre-checkpoint driver (a prime
// offset per stream so no two streams are ever identical); only the base
// changed from wall-clock to the explicit root seed. --seed-a/--seed-b still
// override, for deliberate single-run reproducibility.
const seedAOverride = argVal('--seed-a', null);
const seedBOverride = argVal('--seed-b', null);
const seedA = seedAOverride !== null ? (parseInt(seedAOverride, 10) >>> 0) : (rootSeed >>> 0);
const seedB = seedBOverride !== null ? (parseInt(seedBOverride, 10) >>> 0) : ((rootSeed + 104729) >>> 0);
const seedW = (rootSeed + 1000003) >>> 0; // distinct prime offset from hive seeds

// Per-stream seed assignment, named so arm C (shuffled-RNG control) can permute
// the ASSIGNMENT while holding the root seed fixed -- which is what isolates
// "state carries behavior" from "seeds carry behavior".
const STREAM_ORDER = ['hive-a', 'hive-b', 'world'];
const streamSeedOffsets = { 'hive-a': 12345, 'hive-b': 12345, world: 12345 };
const streamBaseSeeds = { 'hive-a': seedA, 'hive-b': seedB, world: seedW };
const shuffleSpec = argVal('--shuffle-streams', null); // e.g. "world,hive-a,hive-b"
if (shuffleSpec) {
  const perm = shuffleSpec.split(',').map((s) => s.trim());
  if (perm.length !== STREAM_ORDER.length || !STREAM_ORDER.every((s) => perm.includes(s))) {
    writeStatus('invalid-shuffle-streams');
    process.exit(1);
  }
  const bases = STREAM_ORDER.map((s) => streamBaseSeeds[s]);
  perm.forEach((streamId, idx) => { streamBaseSeeds[streamId] = bases[idx]; });
  process.stdout.write(`stream seed assignment permuted: ${STREAM_ORDER.join(',')} -> ${perm.join(',')}\n`);
}

const EVENT_CONTEXT = createEventContext({
  armId: ARM_ID,
  runId: processEventContext.run_id,
  episodeId: processEventContext.episode_id
});

let hives;
let networks;
let worldMind;
let controllers;
let startTick;
let turnIndex;
let parentLink;
let parentRunId = null;
let parentEpisodeId = null;
const rngs = {};
let worldRng;

if (resolution.mode === 'resume') {
  const r = resolution.restored;
  hives = restoreHives(SANDBOX_ROOT, r.hiveStates, WORLD_STATE_PATH, r.worldState, EVENT_CONTEXT);
  for (const [id, hive] of Object.entries(hives)) {
    const saved = r.identity.hives && r.identity.hives[id];
    if (saved && Number.isInteger(saved.next_event_tick)) hive.nextEventTick = saved.next_event_tick;
  }
  // Append-only logs: truncate back to the recorded cursor so a resume into a
  // reused sandbox cannot double-append. Into a fresh sandbox this is a no-op
  // that reports 'absent', which is itself worth recording.
  const cursorReport = checkpoint.applyLogCursors(SANDBOX_ROOT, r.logCursors);
  process.stdout.write(`resume: log cursors ${JSON.stringify(cursorReport)}\n`);

  // The checkpointed live config is restored so operator tuning survives the
  // turn boundary; tick_interval_ms is deliberately re-applied from the CLI
  // because it is an invocation knob (how fast to run in wall-clock), not a
  // property of the world.
  writeLiveConfig(CONFIG_PATH, { ...r.liveConfig, tick_interval_ms: TICK_INTERVAL_MS });

  networks = r.networks;
  worldMind = r.worldMind;
  controllers = r.controllers;
  for (const id of STREAM_ORDER) {
    const saved = r.rngStates[id];
    if (!saved) {
      writeStatus(`resume-failed-halt:${checkpoint.STAGES.CHECKSUMS}:rng-stream-missing-${id}`);
      process.exit(1);
    }
    const stream = checkpoint.createSerializableRng(saved.seed);
    stream.setState(saved.state);
    if (id === 'world') worldRng = stream; else rngs[id] = stream;
  }
  startTick = r.identity.absolute_tick;
  turnIndex = r.identity.turn_index + 1;
  parentLink = {
    generation_id: r.manifest.generation_id,
    manifest_checksum: r.manifest.manifest_self_checksum,
    lineage_depth: r.manifest.parent.lineage_depth
  };
  parentRunId = r.identity.event_context.run_id;
  parentEpisodeId = r.identity.event_context.episode_id;
  process.stdout.write(
    `Resumed minds: hive-a/hive-b/world networks, controllers and all three RNG streams ` +
    `restored from ${r.generation_id}; root seed ${rootSeed} (restored).\n`
  );
} else {
  const seeds = HIVE_IDS.map((id) => generateBlankHiveSeed(id, AUTHORED_BY, new Date().toISOString()));
  hives = setupHives(SANDBOX_ROOT, seeds, WORLD_STATE_PATH, RESOURCE_POOL, EVENT_CONTEXT);

  // Seed the live-config file from CLI args so the dashboard's initial form
  // reflects what this run actually started with, not just internal defaults.
  writeLiveConfig(CONFIG_PATH, { tick_interval_ms: TICK_INTERVAL_MS });

  // "Early minds" -- operator (2026-07-16): "delete the old minds we ran in
  // the ant sim and create new neural networks... to start fresh." A fresh
  // start still builds every mind from random weights; what changed is only
  // WHERE the randomness comes from (see the root-seed block above).
  networks = {
    'hive-a': createNetwork(seedA),
    'hive-b': createNetwork(seedB)
  };
  // World mind (operator 2026-08-03) — a fresh, untrained network one level
  // above the hive minds, reading the full shared world-state and emitting
  // world-level coordination verbs (environmental/signaling, never hive
  // commands — no-godmode/carriage doctrine).
  worldMind = createWorldMind(seedW);
  // Reactive-entropy-controller state, ONE object per hive (resolved
  // s4-reactive-controller gate): each controller reads only its OWN hive's
  // last measured policy_entropy_post_update, threaded explicitly through
  // trainTick -- never a module global (which could leak the feedback signal
  // between hives).
  controllers = {
    'hive-a': { active: false, prev_post_update_entropy: undefined },
    'hive-b': { active: false, prev_post_update_entropy: undefined }
  };
  for (const id of STREAM_ORDER) {
    const stream = checkpoint.createSerializableRng((streamBaseSeeds[id] + streamSeedOffsets[id]) >>> 0);
    if (id === 'world') worldRng = stream; else rngs[id] = stream;
  }
  startTick = 0;
  turnIndex = 0;
  parentLink = null;
  process.stdout.write(
    `Early minds this run: root_seed=${rootSeed} (${rootSeedSource}), hive-a seed=${seedA}, ` +
    `hive-b seed=${seedB}, world seed=${seedW}.\n`
  );
}

process.stdout.write(`ant-hive-world attended run starting (${resolution.mode}).\n`);
process.stdout.write(`Sandbox: ${SANDBOX_ROOT}\n`);
process.stdout.write(`Checkpoint root: ${resolution.checkpointRoot}\n`);
process.stdout.write(`Shared resources at start: ${JSON.stringify(RESOURCE_POOL)}\n`);
process.stdout.write(`Mind: untrained-network.js (from-scratch REINFORCE, no pretraining, no LLM).\n`);
process.stdout.write(FOREVER
  ? `Running until stopped (SIGINT/SIGTERM), ${TICK_INTERVAL_MS}ms between rounds. Run log: ${RUN_LOG_PATH}\n`
  : `Running ${TICKS} ticks per hive from absolute tick ${startTick}. Run log: ${RUN_LOG_PATH}\n`);
process.stdout.write(`Config file (live-tunable via the dashboard): ${CONFIG_PATH}\n`);
process.stdout.write(`Event identity: run=${EVENT_CONTEXT.run_id} episode=${EVENT_CONTEXT.episode_id} arm=${EVENT_CONTEXT.arm_id}\n`);
process.stdout.write(`Start the dashboard separately to watch live: node tools/ant-hive-world/dashboard.js --sandbox-root ${SANDBOX_ROOT}\n\n`);

function appendRunLog(entry) {
  const row = decorateEvent('run', EVENT_CONTEXT, entry.tick, entry);
  fs.appendFileSync(RUN_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
}

// The decision stream is the continuity evidence surface: one line per actor
// per tick, keyed on the ABSOLUTE tick, carrying only quantities that a
// decision actually depends on. Deliberately excludes every wall-clock field
// (run-log `ts`, geometry `at`, world-state `written_at`) and every identity
// field (run_id/episode_id/tick_key), because those differ between a resumed
// run and an uninterrupted one WITHOUT any behavioral difference -- including
// them would guarantee a false divergence and destroy the test's meaning.
// Writing it consumes no RNG and takes no branch, so its presence cannot
// change behavior.
function appendDecision(row) {
  fs.appendFileSync(DECISION_STREAM_PATH, JSON.stringify(row) + '\n');
}

function currentInputPacket() {
  const packetPath = path.join(SANDBOX_ROOT, 'world-mind-decision.json');
  try {
    const buf = fs.readFileSync(packetPath);
    return { present: true, sha256: checkpoint.sha256Hex(buf) };
  } catch {
    return { present: false, sha256: null };
  }
}

function commitCheckpoint(absoluteTick) {
  const runName = jobEnv.RUN_NAME;
  const hiveStates = {};
  for (const id of HIVE_IDS) {
    hiveStates[id] = JSON.parse(fs.readFileSync(hives[id].hiveStatePath, 'utf8'));
  }
  const rngStates = {};
  for (const id of STREAM_ORDER) {
    const stream = id === 'world' ? worldRng : rngs[id];
    rngStates[id] = { seed: stream.seed, state: stream.getState() };
  }
  return checkpoint.commitGeneration(resolution.checkpointRoot, {
    runName,
    absoluteTick,
    absoluteDay: absoluteTick, // one tick is one simulated day (MODE=turn contract)
    networks,
    worldMind,
    controllers,
    rngStates,
    constructionSeeds: { 'hive-a': seedA, 'hive-b': seedB, world: seedW, root: rootSeed },
    worldState: readWorldState(WORLD_STATE_PATH),
    hiveStates,
    liveConfig: readLiveConfig(CONFIG_PATH),
    logCursors: checkpoint.captureLogCursors(SANDBOX_ROOT, HIVE_IDS),
    nextEventTicks: Object.fromEntries(HIVE_IDS.map((id) => [id, hives[id].nextEventTick])),
    identity: {
      event_context: EVENT_CONTEXT,
      turn_index: turnIndex,
      root_seed: rootSeed,
      root_seed_source: rootSeedSource,
      fresh_start: resolution.fresh_start,
      parent_run_id: parentRunId,
      parent_episode_id: parentEpisodeId
    },
    parent: parentLink,
    inputPacket: currentInputPacket(),
    goal: null
  });
}

async function runTicks() {
  let i = startTick;
  const endTick = startTick + TICKS;
  while (FOREVER ? !stopRequested : i < endTick) {
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
        food_exhausted: result.food_exhausted,
        reward: result.reward,
        // Persisted per row, NOT just returned in-process: without this a
        // summarizer cannot tell a v1 reward from a v2 one and will silently
        // pool them into one cumulative series. Reward semantics changed at
        // v2, so pooled cum_reward across the boundary is meaningless.
        reward_contract_version: result.reward_contract_version,
        policy_entropy: result.policy_entropy,
        policy_entropy_post_update: result.policy_entropy_post_update,
        forced_exploration: result.forced_exploration,
        entropy_controller_active: result.entropy_controller_active,
        effective_entropy_bonus_weight: result.effective_entropy_bonus_weight,
        stockpile: result.hiveState.hive_state.stockpile
      });
      appendDecision({
        t: i,
        actor: id,
        action: result.action,
        applied: result.applied,
        reward: result.reward,
        pe: result.policy_entropy,
        peu: result.policy_entropy_post_update,
        fe: Boolean(result.forced_exploration),
        ctl: Boolean(result.entropy_controller_active),
        w: result.effective_entropy_bonus_weight,
        starved: result.starved,
        exhausted: result.food_exhausted,
        stock: result.hiveState.hive_state.stockpile
      });
    }
    // World mind (operator 2026-08-03): one world-level decision per round,
    // after the hives have acted. Preference order:
    //   1. The Mythos-harnessed world mind's pushed decision
    //      (world-mind-decision.json in the sandbox root, written host-
    //      initiated by tools/ant-hive-world/world-mind-harness.cjs on the
    //      Mac — the LLM world mind with memory/vault/goal access).
    //   2. Fallback: the in-process untrained world-mind network, so the sim
    //      keeps coordinating even when the harness is not running.
    // Both emit the same environmental/signaling verbs — never override a
    // hive's decision (no-godmode/carriage doctrine). Logged as observations.
    const worldStateNow = readWorldState(WORLD_STATE_PATH);
    if (worldStateNow) {
      let wm = null;
      let source = 'harness';
      try {
        const pushed = JSON.parse(fs.readFileSync(path.join(SANDBOX_ROOT, 'world-mind-decision.json'), 'utf8'));
        if (pushed && pushed.verb && WORLD_VERB_ORDER.includes(pushed.verb)) {
          wm = { verb: pushed.verb, prob: 1, entropy: 0, note: String(pushed.rationale || '') };
        }
      } catch {}
      if (!wm) {
        wm = decideWorld(worldMind, worldStateNow, worldRng, i);
        source = 'network-fallback';
      }
      const applied = applyWorldVerb(worldStateNow, wm, worldRng);
      writeWorldState(WORLD_STATE_PATH, worldStateNow);
      process.stdout.write(`[tick ${i + 1}] world -> ${wm.verb} source=${source} applied=${applied.applied} (${applied.note})\n`);
      appendRunLog({
        tick: i + 1,
        hive: 'world',
        action: wm.verb,
        source,
        applied: applied.applied,
        note: applied.note
      });
      appendDecision({
        t: i,
        actor: 'world',
        action: wm.verb,
        source,
        applied: applied.applied,
        // The note carries the RNG-drawn tile id for seed-wood/seed-stone/
        // signal-food, which is what makes this line sensitive to a world-RNG
        // divergence and not just to a verb divergence.
        note: applied.note,
        prob: wm.prob,
        entropy: wm.entropy
      });
    }
    i += 1;
    const intervalMs = liveConfig.tick_interval_ms ?? TICK_INTERVAL_MS;
    if (intervalMs > 0) await sleep(intervalMs);
  }
  if (FOREVER && stopRequested) {
    appendRunLog({ event: 'run-stopped', tick: i, reason: 'signal' });
  }
  process.stdout.write(`\nDone after ${i - startTick} rounds (absolute tick ${startTick} -> ${i}). Final world-state: ${WORLD_STATE_PATH}\nRun log: ${RUN_LOG_PATH}\n`);
  return i;
}

runTicks()
  .then((absoluteTick) => {
    if (NO_CHECKPOINT) {
      process.stdout.write('checkpoint skipped (--no-checkpoint)\n');
      return;
    }
    // The generation is committed AFTER the ticks, from the state as it stands
    // at the boundary. This REPLACES the turn runner's former shell-level
    // checkpoint block outright: mind state, RNG lineage and world state now
    // commit together or not at all, which is the lockstep the shell copy could
    // never provide (it copied the run tree and wrote
    // "mind_state": "process-local-not-checkpointed").
    const committed = commitCheckpoint(absoluteTick);
    process.stdout.write(
      `checkpoint committed: ${committed.dir}\n` +
      `  generation ${committed.manifest.generation_id} day=${committed.manifest.absolute_day} ` +
      `tick=${committed.manifest.absolute_tick} depth=${committed.manifest.parent.lineage_depth}\n` +
      `  files ${committed.manifest.files.map((f) => `${f.path}:${f.sha256.slice(0, 12)}`).join(' ')}\n` +
      `  manifest ${committed.manifest.manifest_self_checksum}\n`
    );
  })
  .catch((e) => {
    if (e instanceof checkpoint.CheckpointCollisionError) {
      process.stderr.write(
        `CHECKPOINT REFUSED: generation ${e.generationId} already exists and is committed.\n` +
        `Never overwritten, never auto-suffixed -- choose a new run name.\n`
      );
      writeStatus(e.status);
      process.exit(1);
    }
    process.stderr.write(`run-live.js error: ${e.message}\n${e.stack}\n`);
    process.exit(1);
  });
