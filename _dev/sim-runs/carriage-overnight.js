#!/usr/bin/env node
'use strict';

// _dev/sim-runs/carriage-overnight.js — unattended overnight driver for the
// carriage-vs-stigmergy experiment.
//
// WHY IT LIVES HERE, NOT IN tools/ant-hive-world/: everything under
// tools/ant-hive-world/ is tracked, exported engine code. This is a
// one-off experiment driver for a single overnight run, so it sits on the
// _dev surface and composes the engine's exported modules only -- it does
// not modify, monkey-patch, or fork any engine file.
//
// PROTOCOL (per _dev/concepts/world-minds-tick-turn-operator-boundary/
// tick-turn-checkpoint-vocabulary.md): this run is PURE TICKS. There is no
// operator present and no operator input by design. Every condition that
// would require a TURN -- money, live or irreversible external action,
// secrets, canonical writes -- has no code path here at all; and anything
// unexpected (an exception, a torn world-state, a write target outside the
// sandbox root) FAILS CLOSED: it logs a stop event and exits rather than
// improvising past it. There is deliberately no retry-on-unknown-error path.
//
// EXPERIMENT (per _dev/concepts/solar-system-scoped-mind/concept.md, whose
// proposed ruling is that a solar-scoped mind is CARRIAGE, not authority):
// does a bounded inter-world relay change collective outcomes versus a
// stigmergy-only baseline? Three matched-seed arms, all four hives each:
//
//   isolated  2 worlds x 2 hives, no exchange between worlds.
//             Within a world, hives still share the pheromone field.
//             -> the stigmergy-only baseline, with a real scope boundary.
//   carriage  identical to isolated, PLUS a solar relay that carries a
//             bounded pheromone tip across the world boundary each round.
//             -> the treatment.
//   shared    1 world x 4 hives, one pheromone field, no boundary at all.
//             -> the full-contact upper bound, for calibration.
//
// Replicate r uses the SAME seed base in all three arms, so the comparison
// is paired rather than three independent samples.
//
// EPISODES, NOT ONE LONG RUN. A single run of this engine converges within
// a couple of thousand rounds, so spending the whole night on one run would
// buy ticks nobody needs and still leave a sample size of one per arm. The
// driver instead runs repeated EPISODES: each episode builds a completely
// fresh set of minds (new seeds, new networks, re-initialized worlds) and
// ticks them for --episode-rounds, then tears down and starts another. The
// night therefore buys paired replicates -- the thing a between-condition
// comparison actually needs. Fresh-minds compliance is preserved: nothing
// is carried from one episode into the next except the log files.
//
// THE RELAY IS CARRIAGE, NOT AUTHORITY. Three invariants, enforced in code
// and named here because the concept doc's own argument is that a sole
// relay can exercise de facto power even without a formal veto:
//   1. No filtering. Whatever the strongest trail is, it is carried. There
//      is no admission decision and no notion of a "good" tip.
//   2. No ordering advantage. Every round's tips are read from a snapshot
//      of all worlds taken BEFORE any deposit, so no world's tip is
//      computed from another world's already-relayed signal.
//   3. Bounded, never amplifying. Delivered strength is
//      min(source_strength * RELAY_GAIN, RELAY_CAP) with GAIN < 1, so the
//      relay can never manufacture a signal stronger than its source.
// The relay also cannot approve, veto, or reverse any hive action -- it only
// ever deposits pheromone, which every hive remains free to ignore.
//
// Usage:
//   node _dev/sim-runs/carriage-overnight.js \
//     --root <dir> --deadline-iso <ISO> [--episode-rounds N] [--max-episodes N] \
//     [--replicates N] [--tick-interval-ms N] [--summary-every N]

const fs = require('fs');
const path = require('path');

const ENGINE = path.resolve(__dirname, '..', '..', 'tools', 'ant-hive-world');
const { setupHives } = require(path.join(ENGINE, 'harness.js'));
const { generateBlankHiveSeed } = require(path.join(ENGINE, 'generate-blank-hive-seed.js'));
const { validateHiveMind, isBlankSeed } = require(path.join(ENGINE, 'validate-hive-mind.js'));
const { createNetwork, mulberry32 } = require(path.join(ENGINE, 'untrained-network.js'));
const { trainTick } = require(path.join(ENGINE, 'train-tick.js'));
const { readLiveConfig, writeLiveConfig } = require(path.join(ENGINE, 'live-config.js'));
const { readWorldState, writeWorldState, depositPheromone } = require(path.join(ENGINE, 'world-state.js'));

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// CODE REVIEW (confirmation pass, codex P2, round 10): the prior fix
// validated Number.isInteger(parseInt(raw)), but parseInt truncates rather
// than rejects -- '1e3' becomes 1, '2.5' becomes 2 -- so a materially
// different (and silently wrong) experiment size passed the guard. Validate
// the raw CLI string against a strict positive-integer grammar BEFORE any
// numeric conversion.
function positiveIntArg(flag, def) {
  const raw = argVal(flag, def);
  if (!/^[1-9][0-9]*$/.test(String(raw))) {
    process.stderr.write(`FAIL-CLOSED: ${flag} must be a positive integer (no decimals, exponents, or other trailing characters), got '${raw}'\n`);
    process.exit(2);
  }
  return parseInt(raw, 10);
}

// CODE REVIEW (codex P2, round 11): --tick-interval-ms and --summary-every
// still parsed unchecked raw strings ('nope' -> NaN silently disables
// sleeping/periodic metrics; '1e3' truncates to 1, changing how many
// episodes finish before the deadline) while the run still reported
// success. Validate the raw CLI string the same way as the other numeric
// options. Zero is legal for --tick-interval-ms (no sleep between ticks).
function nonNegativeIntArg(flag, def) {
  const raw = argVal(flag, def);
  if (!/^(0|[1-9][0-9]*)$/.test(String(raw))) {
    process.stderr.write(`FAIL-CLOSED: ${flag} must be a non-negative integer (no decimals, exponents, or other trailing characters), got '${raw}'\n`);
    process.exit(2);
  }
  return parseInt(raw, 10);
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(argVal('--root', path.join(REPO_ROOT, '_dev', 'state', 'ant-sim-overnight')));
const EPISODE_ROUNDS = positiveIntArg('--episode-rounds', '2000');
const MAX_EPISODES = positiveIntArg('--max-episodes', '1000');
const DEADLINE_ISO = argVal('--deadline-iso', null);
const REPLICATES = positiveIntArg('--replicates', '5');
const TICK_INTERVAL_MS = nonNegativeIntArg('--tick-interval-ms', '10');
const SUMMARY_EVERY = positiveIntArg('--summary-every', '200');
const KILL_SWITCH = path.resolve(argVal('--kill-switch', path.join(REPO_ROOT, '_dev', 'state', 'kill-switches', 'ant-sim-overnight.off')));

// FLEET-WIDE HALT — one fixed path every sim driver honours, in addition to its
// run-specific switch. A run-specific switch is only reachable by someone who
// already knows what is running, because its name is chosen at launch; this path
// is knowable in advance, so a coordinator can halt work that has not started.
// Checked at startup and between every round and episode.
const GLOBAL_HALT = path.resolve(argVal('--global-halt', path.join(REPO_ROOT, '_dev', 'state', 'kill-switches', 'ALL-SIMS.off')));
const PID_FILE = path.join(ROOT, 'run.pid');

// Write-containment guard. Every path this process writes must be under
// ROOT (or the pid/kill-switch paths it was handed), and ROOT itself must
// be under the repo's _dev surface. A run that would write anywhere else --
// Mythos-memories/**, instructions/canonical/**, tools/kernel/**,
// tools/verify/** or anything outside the repo -- fails closed at startup
// rather than at the moment of the write.
const ALLOWED_PREFIX = path.join(REPO_ROOT, '_dev') + path.sep;
if (!(ROOT + path.sep).startsWith(ALLOWED_PREFIX)) {
  process.stderr.write(`FAIL-CLOSED: --root ${ROOT} is not under ${ALLOWED_PREFIX}\n`);
  process.exit(2);
}

// CODE REVIEW (PR #12, codex P1): reusing a nonempty run root silently
// appends events/metrics while episode/replicate numbering restarts at
// zero, and summarizers pair rows by episode:replicate alone -- separate
// runs get double-counted. Refuse a nonempty root: a run is a run.
if (fs.existsSync(ROOT)) {
  const existing = fs.readdirSync(ROOT);
  if (existing.length > 0) {
    process.stderr.write("FAIL-CLOSED: --root " + ROOT + " is not empty (" + existing.length + " entries); reuse would double-count run rows -- choose a fresh root or move it aside\n");
    process.exit(2);
  }
}
if (!DEADLINE_ISO) {
  process.stderr.write('FAIL-CLOSED: --deadline-iso is mandatory (unattended runs must carry a wall-clock bound)\n');
  process.exit(2);
}
const DEADLINE_MS = Date.parse(DEADLINE_ISO);
if (!Number.isFinite(DEADLINE_MS)) {
  process.stderr.write(`FAIL-CLOSED: --deadline-iso ${DEADLINE_ISO} is not a parseable timestamp\n`);
  process.exit(2);
}

// Startup halt check, before any state is written: a pre-emptive halt must
// prevent the launch, not merely stop it after one round.
if (fs.existsSync(GLOBAL_HALT)) {
  process.stderr.write(`HALTED: global halt file present at ${GLOBAL_HALT}. Remove it to allow runs.\n`);
  process.exit(3);
}

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(path.dirname(KILL_SWITCH), { recursive: true });

const EVENTS_LOG = path.join(ROOT, 'events.jsonl');
const METRICS_LOG = path.join(ROOT, 'metrics.jsonl');
const RELAY_LOG = path.join(ROOT, 'relay.jsonl');
const CONFIG_PATH = path.join(ROOT, 'live-config.json');

// appendFileSync per line: a crash between rounds can lose at most the line
// being written, never corrupt earlier ones.
function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}
const logEvent = (o) => appendJsonl(EVENTS_LOG, o);

const CONDITIONS = ['isolated', 'carriage', 'shared'];
const RESOURCE_POOL = { food: 40, wood: 30, stone: 15 };
const AUTHORED_BY = '_dev/sim-runs/carriage-overnight.js — blank-start, untrained network, no pretraining';
const RELAY_KINDS = ['food', 'wood'];
const RELAY_GAIN = 0.5; // < 1: the relay attenuates, never amplifies
const RELAY_CAP = 2;    // hard ceiling on delivered strength per tip

let stopRequested = false;
let stopReason = null;
function requestStop(reason) {
  stopRequested = true;
  stopReason = stopReason || reason;
}
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- setup -----------------------------------------------------------------

// One seed base per (episode, replicate), shared across all three conditions
// so the arms are paired within a replicate. Date.now()-derived per the
// engine's fresh-minds rule -- never a hardcoded default seed, and never
// reused between episodes.
function episodeSeeds() {
  const base = Date.now() >>> 0;
  return Array.from({ length: REPLICATES }, (_, r) => (base + r * 104729) >>> 0);
}

function buildGroup(condition, r, seedBase, episode) {
  const groupId = `${condition}-r${r}`;
  const worldCount = condition === 'shared' ? 1 : 2;
  const hivesPerWorld = condition === 'shared' ? 4 : 2;
  const worlds = [];
  let hiveOrdinal = 0;
  for (let w = 0; w < worldCount; w++) {
    const worldDir = path.join(ROOT, 'sandboxes', groupId, `world-${w}`);
    const worldStatePath = path.join(worldDir, 'shared', 'world-state.json');
    const seeds = [];
    for (let h = 0; h < hivesPerWorld; h++) {
      const identity = `${groupId}-w${w}-h${h}`;
      const seed = generateBlankHiveSeed(identity, AUTHORED_BY, new Date().toISOString());
      // Validate every seed before it is written into a sandbox: shape, and
      // the no-pre-loaded-instinct invariant. A bad seed fails the run
      // closed -- it does not get silently repaired.
      const shape = validateHiveMind(seed);
      const blank = isBlankSeed(seed);
      if (!shape.valid || !blank.valid) {
        throw new Error(`seed validation failed for ${identity}: ${JSON.stringify([...shape.errors, ...blank.errors])}`);
      }
      seeds.push(seed);
    }
    const hiveHandles = setupHives(worldDir, seeds, worldStatePath, RESOURCE_POOL);
    // setupHives re-initializes hive-state and world-state for the new
    // episode but leaves each hive's engine-written audit log in place, so
    // it would otherwise accumulate across every episode of the night
    // (measured: ~250 KB per hive per episode, ~4 GB by morning across 60
    // hives). Truncating here matches the semantics -- a fresh episode is a
    // fresh world, so it gets a fresh audit trail -- and keeps the most
    // recent episode's trail available for inspection. The analysis reads
    // metrics.jsonl, never these.
    for (const seed of seeds) {
      fs.writeFileSync(hiveHandles[seed.identity].auditLogPath, '');
    }
    const hives = seeds.map((seed) => {
      // Four independent random streams per hive, all offset from the
      // replicate's seed base: network init and decision sampling never
      // share a stream, and no two hives share one either.
      const netSeed = (seedBase + hiveOrdinal * 7919) >>> 0;
      const rngSeed = (netSeed + 12345) >>> 0;
      hiveOrdinal += 1;
      return {
        id: seed.identity,
        handle: hiveHandles[seed.identity],
        network: createNetwork(netSeed),
        rng: mulberry32(rngSeed),
        controller: { active: false, prev_post_update_entropy: undefined },
        net_seed: netSeed
      };
    });
    worlds.push({ index: w, dir: worldDir, statePath: worldStatePath, hives });
  }
  return {
    id: groupId,
    condition,
    replicate: r,
    episode,
    seed_base: seedBase,
    worlds,
    cum: { reward: 0, applied: 0, attempted: 0, starved: 0, builds: 0, forced: 0, entropy_sum: 0, entropy_n: 0 },
    relay: { tips: 0, actionable: 0 }
  };
}

// --- relay (carriage arm only) ---------------------------------------------

function strongestTrail(state, kind) {
  const trails = (state.pheromones || {})[kind] || {};
  let best = { tileId: null, strength: 0 };
  for (const [tileId, strength] of Object.entries(trails)) {
    if (strength > best.strength) best = { tileId, strength };
  }
  return best;
}

// Simultaneous read, then deposit. Invariant 2 (no ordering advantage) lives
// here: tips are computed from `snapshots`, taken before any write.
function runRelay(group, round) {
  const snapshots = group.worlds.map((w) => {
    const s = readWorldState(w.statePath);
    if (!s) throw new Error(`world-state missing or torn during relay: ${w.statePath}`);
    return s;
  });
  const tips = snapshots.map((s) => {
    const out = {};
    for (const kind of RELAY_KINDS) out[kind] = strongestTrail(s, kind);
    return out;
  });

  for (let dst = 0; dst < group.worlds.length; dst++) {
    let state = snapshots[dst];
    let touched = false;
    for (let src = 0; src < group.worlds.length; src++) {
      if (src === dst) continue;
      for (const kind of RELAY_KINDS) {
        const tip = tips[src][kind];
        if (!tip.tileId || tip.strength <= 0) continue;
        const delivered = Math.min(tip.strength * RELAY_GAIN, RELAY_CAP);
        // Informativeness, the falsifier for "carriage helps": a tip about
        // a tile is only actionable in the destination world if that world
        // actually has a live food source there. Recorded, never used to
        // filter -- filtering would make the relay an authority.
        const actionable = kind === 'food'
          ? Boolean((state.food_sources || {})[tip.tileId])
          : true; // wood is an abstract shared pool, not tile-located
        state = depositPheromone(state, kind, tip.tileId, delivered);
        touched = true;
        group.relay.tips += 1;
        if (actionable) group.relay.actionable += 1;
        if (round % SUMMARY_EVERY === 0) {
          appendJsonl(RELAY_LOG, {
            round, group: group.id, src_world: src, dst_world: dst,
            kind, tile: tip.tileId, source_strength: tip.strength, delivered, actionable
          });
        }
      }
    }
    if (touched) writeWorldState(group.worlds[dst].statePath, state);
  }
}

// --- metrics ---------------------------------------------------------------

function groupSnapshot(group) {
  let stockpile = {};
  let structures = 0;
  let territory = 0;
  let foodSources = 0;
  let worldFood = 0;
  for (const w of group.worlds) {
    const s = readWorldState(w.statePath);
    if (!s) throw new Error(`world-state missing or torn during snapshot: ${w.statePath}`);
    structures += (s.geometry_log || []).length;
    territory += Object.keys(s.territory || {}).length;
    foodSources += Object.keys(s.food_sources || {}).length;
    worldFood += (s.resources || {}).food || 0;
    for (const h of w.hives) {
      const hs = JSON.parse(fs.readFileSync(h.handle.hiveStatePath, 'utf8'));
      for (const [k, v] of Object.entries(hs.hive_state.stockpile || {})) {
        stockpile[k] = (stockpile[k] || 0) + v;
      }
    }
  }
  return { stockpile, structures, territory, food_sources: foodSources, world_food: worldFood };
}

// --- main ------------------------------------------------------------------

writeLiveConfig(CONFIG_PATH, { tick_interval_ms: 0 });
fs.writeFileSync(PID_FILE, String(process.pid) + '\n');

logEvent({
  event: 'run-start',
  pid: process.pid,
  root: ROOT,
  kill_switch: KILL_SWITCH,
  global_halt: GLOBAL_HALT,
  pid_file: PID_FILE,
  conditions: CONDITIONS,
  replicates: REPLICATES,
  groups_per_episode: CONDITIONS.length * REPLICATES,
  episode_rounds: EPISODE_ROUNDS,
  max_episodes: MAX_EPISODES,
  deadline: new Date(DEADLINE_MS).toISOString(),
  tick_interval_ms: TICK_INTERVAL_MS,
  summary_every: SUMMARY_EVERY,
  relay: { gain: RELAY_GAIN, cap: RELAY_CAP, kinds: RELAY_KINDS },
  protocol: 'pure-ticks; no operator input by design; unknown conditions fail closed with a logged stop'
});

process.stdout.write(`carriage-overnight: pid=${process.pid} deadline=${new Date(DEADLINE_MS).toISOString()}\n`);
process.stdout.write(`kill switch: touch ${KILL_SWITCH}\n`);

// One stop check, consulted between every round and every episode. Order is
// deliberate: the operator's kill switch outranks the schedule.
function checkStop(episode) {
  if (fs.existsSync(GLOBAL_HALT)) requestStop('global-halt');
  else if (fs.existsSync(KILL_SWITCH)) requestStop('kill-switch');
  else if (Date.now() >= DEADLINE_MS) requestStop('deadline');
  else if (episode >= MAX_EPISODES) requestStop('max-episodes');
  return stopRequested;
}

function writeMetrics(group, episode, round, final) {
  appendJsonl(METRICS_LOG, {
    episode,
    round,
    final: Boolean(final),
    group: group.id,
    condition: group.condition,
    replicate: group.replicate,
    seed_base: group.seed_base,
    cum_reward: group.cum.reward,
    applied_rate: group.cum.attempted ? group.cum.applied / group.cum.attempted : null,
    starved: group.cum.starved,
    builds: group.cum.builds,
    forced_exploration: group.cum.forced,
    mean_entropy: group.cum.entropy_n ? group.cum.entropy_sum / group.cum.entropy_n : null,
    relay_tips: group.relay.tips,
    relay_actionable: group.relay.actionable,
    ...groupSnapshot(group)
  });
}

async function runEpisode(episode) {
  const seeds = episodeSeeds();
  const groups = [];
  for (const condition of CONDITIONS) {
    for (let r = 0; r < REPLICATES; r++) groups.push(buildGroup(condition, r, seeds[r], episode));
  }
  logEvent({ event: 'episode-start', episode, replicate_seeds: seeds, groups: groups.length });

  let round = 0;
  while (round < EPISODE_ROUNDS) {
    if (checkStop(episode)) break;
    const liveConfig = readLiveConfig(CONFIG_PATH);
    for (const group of groups) {
      for (const w of group.worlds) {
        for (const h of w.hives) {
          const res = trainTick(h.handle, w.statePath, h.network, h.rng, liveConfig, round, h.controller);
          group.cum.attempted += 1;
          group.cum.reward += res.reward;
          if (res.applied) group.cum.applied += 1;
          if (res.starved) group.cum.starved += 1;
          if (res.action === 'build' && res.applied) group.cum.builds += 1;
          if (res.forced_exploration) group.cum.forced += 1;
          if (Number.isFinite(res.policy_entropy)) {
            group.cum.entropy_sum += res.policy_entropy;
            group.cum.entropy_n += 1;
          }
        }
      }
      if (group.condition === 'carriage') runRelay(group, round);
    }
    round += 1;
    if (round % SUMMARY_EVERY === 0) {
      for (const group of groups) writeMetrics(group, episode, round, false);
    }
    if (TICK_INTERVAL_MS > 0) await sleep(TICK_INTERVAL_MS);
  }

  // End-of-episode row for every group, flagged final:true -- this is the
  // row the morning analysis compares across conditions.
  for (const group of groups) writeMetrics(group, episode, round, true);
  logEvent({ event: 'episode-end', episode, rounds_completed: round, stop_requested: stopRequested });
  process.stdout.write(`[episode ${episode}] ${round} rounds done ${new Date().toISOString()}\n`);
  return round;
}

async function main() {
  let episode = 0;
  let completedEpisodes = 0;
  while (!checkStop(episode)) {
    const roundsDone = await runEpisode(episode);
    if (roundsDone >= EPISODE_ROUNDS) completedEpisodes += 1;
    episode += 1;
  }
  logEvent({ event: 'run-stopped', reason: stopReason, episodes_completed: episode, full_episodes_completed: completedEpisodes });
  process.stdout.write(`\ncarriage-overnight: stopped after ${episode} episodes (${stopReason}).\n`);
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
  // CODE REVIEW (confirmation pass, codex P2, round 9): a deadline or
  // kill-switch firing during the very first episode previously still
  // exited 0 -- the guest wrote STATUS=0, and the host reported an empty
  // experiment (zero-round final rows, no analyzable results) as a
  // successful run. Require at least one fully-completed episode.
  if (completedEpisodes === 0) {
    process.stderr.write('FAIL-CLOSED: stopped before completing a single full episode; refusing to report success for an empty experiment\n');
    process.exitCode = 5;
  }
}

main().catch((e) => {
  // FAIL CLOSED. Anything that lands here is an unmodelled condition; this
  // run has no operator to escalate to, so it stops and records why rather
  // than continuing on a guess.
  logEvent({ event: 'fail-closed-stop', error: e.message, stack: e.stack });
  process.stderr.write(`carriage-overnight FAIL-CLOSED: ${e.message}\n`);
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
  process.exit(1);
});
