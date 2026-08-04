#!/usr/bin/env node
'use strict';

// _dev/sim-runs/authority-probe.js — de-facto-authority probe, revision 2.
//
// REVISION 2 EXISTS BECAUSE REVISION 1's PREMISE WAS FALSE. A distinct-family
// review (Codex, _dev/reports/analysis/convene-runs/
// 20260802T143053Z-ant-sim-results-review/now__codex.md) found that the
// overnight relay's advertised invariants were executably false, and I
// confirmed both against the code and the run's own logs:
//
//   1. "No filtering" was false. The relay selected the single strongest
//      trail and discarded every other one. That IS a selection rule; the
//      sentence asserting no filtering literally described the filter in the
//      same breath. This file therefore never claims to be unfiltered --
//      perfectly unfiltered carriage is impossible once you must choose a
//      tip at all. It DECLARES its selection rule instead.
//   2. "Never amplifying" was false at the destination. depositPheromone is
//      ADDITIVE (world-state.js:184), and the relay deposits after every
//      hive has already ticked, i.e. after that round's decay
//      (harness.js:160). Verified in the overnight relay log: 45,574 of
//      46,642 deliveries (97.7%) landed exactly at the cap. That is constant
//      end-of-round reinforcement, not proportional signal carriage.
//
// Consequence: the overnight run's ~39% starvation reduction CANNOT be
// attributed to information carriage, because generic pheromone injection
// with the same cadence and magnitude would plausibly produce it too. That
// confound is now the primary thing this run is built to resolve.
//
// THE RELAY IS DECOMPOSED INTO ORTHOGONAL KNOBS so every arm differs from
// its control in exactly one respect:
//
//   select    'strongest'  -- highest-strength trail (the overnight rule)
//             'random'     -- a uniformly random tile from the same id space
//             'actionable' -- strongest trail the destination can act on
//   deposit   'add'        -- additive onto the existing trail (overnight)
//             'max'        -- non-additive: result = max(existing, delivered)
//   schedule  'every'      -- both directions every round
//             'throttled'  -- world 1 -> world 0 only every 4th round
//   sequence  'snapshot'   -- all tips read before any deposit
//             'live'       -- sequential, so relayed signal can echo back
//
// ARMS (8). The first five form a 2x2 plus a no-relay control, which is what
// separates injection from information; the last three add one power each on
// top of the purest carriage arm.
//
//   isolated       no relay at all.
//   null-add       random tile, additive.     <- null control for the overnight effect
//   carriage-add   strongest, additive.       <- the overnight relay, verbatim
//   null-max       random tile, non-additive  <- null control for the purer family
//   carriage-max   strongest, non-additive    <- purest carriage this design allows
//   filter-max     + actionable-only selection    <- the power of JUDGMENT
//   throttle-max   + directional rate limit       <- the power of AVAILABILITY
//   order-max      + live sequencing              <- the power of SEQUENCE
//
// The null arms are magnitude- and timing-matched: they compute the delivery
// magnitude exactly as their carriage counterpart would, then deposit it at a
// RANDOM tile. Only the information content of the tip differs. If a null arm
// reproduces the starvation reduction, the overnight effect was an injection
// and persistence artifact rather than carriage of information.
//
// The authority question then becomes answerable in the form it should have
// had from the start: does a choosing relay distort BEYOND what its matched
// null explains?
//
// PROTOCOL: pure ticks. No operator-input path exists; unmodelled conditions
// fail closed with a logged stop. No network calls. Writes confined to _dev/
// by a startup guard. Zero engine modification -- every relay variant,
// including non-additive deposit, is composed from world-state.js's exported
// readWorldState / depositPheromone / writeWorldState.
//
// TERMINOLOGY: `starved` counts positive-to-zero stockpile threshold
// crossings and one hive can contribute repeatedly, so it is reported
// everywhere as "starvation threshold crossings" -- never as deaths,
// mortality, or survival.
//
// Usage:
//   node _dev/sim-runs/authority-probe.js --root <dir> --deadline-iso <ISO>
//     [--episode-rounds N] [--max-episodes N] [--replicates N]
//     [--tick-interval-ms N] [--summary-every N]

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

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(argVal('--root', path.join(REPO_ROOT, '_dev', 'state', 'ant-sim-authority-probe')));
const EPISODE_ROUNDS = parseInt(argVal('--episode-rounds', '2000'), 10);
const MAX_EPISODES = parseInt(argVal('--max-episodes', '100'), 10);
const DEADLINE_ISO = argVal('--deadline-iso', null);
const REPLICATES = parseInt(argVal('--replicates', '3'), 10);
const TICK_INTERVAL_MS = parseInt(argVal('--tick-interval-ms', '10'), 10);
const SUMMARY_EVERY = parseInt(argVal('--summary-every', '200'), 10);
const KILL_SWITCH = path.resolve(argVal('--kill-switch', path.join(REPO_ROOT, '_dev', 'state', 'kill-switches', 'ant-sim-authority-probe.off')));
// --mechanism adds per-hive behavioural instrumentation (stockpile trajectory,
// action mix, forage targeting). Off by default so every existing invocation is
// byte-identical. It reads the engine's OWN per-hive audit log rather than
// altering any engine call, so the simulation it measures is the unmodified one.
const MECHANISM = process.argv.indexOf('--mechanism') !== -1;

// FLEET-WIDE HALT. Every sim driver honours this one fixed path in addition to
// its own run-specific switch. It exists because a run-specific switch is only
// reachable by someone who already knows what is running: its name is chosen at
// launch, so a coordinator wanting to stop work that has not started yet has
// nothing to touch. This path is knowable in advance, which makes a pre-emptive
// halt possible. Checked at startup (so it blocks a launch outright) and between
// every round and episode.
//
// The concrete failure it closes: a chat-level HOLD has TURN granularity and
// cannot reach a worker mid-sequence — one was sent three minutes before a run
// started on 2026-08-02 and was not delivered until after the run had finished.
const GLOBAL_HALT = path.resolve(argVal('--global-halt', path.join(REPO_ROOT, '_dev', 'state', 'kill-switches', 'ALL-SIMS.off')));
const PID_FILE = path.join(ROOT, 'run.pid');

const ALLOWED_PREFIX = path.join(REPO_ROOT, '_dev') + path.sep;
if (!(ROOT + path.sep).startsWith(ALLOWED_PREFIX)) {
  process.stderr.write(`FAIL-CLOSED: --root ${ROOT} is not under ${ALLOWED_PREFIX}\n`);
  process.exit(2);
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

// Startup halt check, before any directory is created or any state is written:
// a pre-emptive halt must prevent the launch, not merely stop it after one round.
if (fs.existsSync(GLOBAL_HALT)) {
  process.stderr.write(`HALTED: global halt file present at ${GLOBAL_HALT}. Remove it to allow runs.\n`);
  process.exit(3);
}

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(path.dirname(KILL_SWITCH), { recursive: true });

const EVENTS_LOG = path.join(ROOT, 'events.jsonl');
const METRICS_LOG = path.join(ROOT, 'metrics.jsonl');
const RELAY_LOG = path.join(ROOT, 'relay.jsonl');
const MECH_LOG = path.join(ROOT, 'mechanism.jsonl');
const TRAJ_LOG = path.join(ROOT, 'trajectory.jsonl');
const CONFIG_PATH = path.join(ROOT, 'live-config.json');

function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}
const logEvent = (o) => appendJsonl(EVENTS_LOG, o);

// The single source of truth for what each arm is. Every arm names all four
// knobs explicitly -- there are no defaults to misread later.
const ARM_SPECS = {
  'isolated': null,
  'null-add': { select: 'random', deposit: 'add', schedule: 'every', sequence: 'snapshot' },
  'carriage-add': { select: 'strongest', deposit: 'add', schedule: 'every', sequence: 'snapshot' },
  'null-max': { select: 'random', deposit: 'max', schedule: 'every', sequence: 'snapshot' },
  // Consistent but uninformative. Completes the 2x2 against filter-add
  // (informative but inconsistent): if this reproduces carriage-add's effect,
  // the mechanism is compounding, not carriage of information.
  'fixed-add': { select: 'fixed', deposit: 'add', schedule: 'every', sequence: 'snapshot' },
  'carriage-max': { select: 'strongest', deposit: 'max', schedule: 'every', sequence: 'snapshot' },
  // The three power arms live in the ADDITIVE family, not the max family,
  // and that placement is evidence-driven rather than arbitrary. Smoke runs
  // showed the max family has almost no behavioral channel: carriage-max and
  // order-max were byte-identical in 8/8 groups and filter-max matched in
  // 7/8, because a non-additive deposit cannot compound. Ordering in
  // particular is mathematically closed under max semantics -- an echoed tip
  // returns the same value it arrived with, so there is nothing to compound.
  // Testing "does this power distort?" in a regime where no power can reach
  // the hives would guarantee a null and prove nothing. The additive family
  // is where the relay demonstrably influences behavior (its source trail
  // inflates to ~8 versus ~1.8 elsewhere), so that is where the powers are
  // measured -- against carriage-add and null-add, which share its semantics.
  'filter-add': { select: 'actionable', deposit: 'add', schedule: 'every', sequence: 'snapshot' },
  'throttle-add': { select: 'strongest', deposit: 'add', schedule: 'throttled', sequence: 'snapshot' },
  'order-add': { select: 'strongest', deposit: 'add', schedule: 'every', sequence: 'live' }
};
// --arms restricts the run to a named subset, so a focused study (e.g. the
// four-arm attribution contrast) shares this driver instead of forking it.
const ARMS_REQUESTED = argVal('--arms', null);
const ARMS = ARMS_REQUESTED ? ARMS_REQUESTED.split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(ARM_SPECS);
for (const a of ARMS) {
  if (!(a in ARM_SPECS)) {
    process.stderr.write(`FAIL-CLOSED: unknown arm "${a}". Known: ${Object.keys(ARM_SPECS).join(', ')}\n`);
    process.exit(2);
  }
}

const RESOURCE_POOL = { food: 40, wood: 30, stone: 15 };
const AUTHORED_BY = '_dev/sim-runs/authority-probe.js — blank-start, untrained network, no pretraining';
const RELAY_KINDS = ['food', 'wood'];

// TWO MAGNITUDE REGIMES, one per deposit family, and the split is forced by
// how a tip can reach a hive at all. The ONLY channel is the strongest trail:
// chooseForageTile follows it, and encodeState reads its strength
// (untrained-network.js). A tip that never becomes the destination's
// strongest trail is behaviorally invisible.
//
//   ADD family (gain 0.5, cap 2) -- the overnight relay's exact constants,
//   reproduced verbatim so carriage-add IS the overnight arm. It reaches
//   hives not because any single delivery is large but because additive
//   deposits compound round over round; measured in the smoke run, its own
//   source trail inflates to ~7.5 while every other arm sits near ~1.2.
//   That runaway self-reinforcement is the artifact under investigation.
//
//   MAX family (gain 1.0, cap = the network's own trail sense cap) -- a
//   first attempt at gain 0.5/cap 2 here was a dead arm: a non-additive
//   deposit bounded at half the source strength can essentially never exceed
//   the destination's own trail, so it never becomes strongest and never
//   reaches a hive. Measured: carriage-max and order-max were identical in
//   8/8 smoke groups, and null-max matched carriage-max in 4/8. Delivering
//   at parity (min(source_strength, cap), non-additive) makes the tip
//   competitive, which is what "the destination learns how strong the
//   source's trail is" actually requires. It remains proportional to the
//   source, bounded, never amplifying beyond the source, and non-accumulating.
// The max family's gain/cap are overridable (--max-gain / --max-cap) so the
// exact spec `max(existing, min(source*0.5, cap))` can be run on its own and
// its inertness confirmed or refuted with real episodes rather than a 4-episode
// smoke. The add family is deliberately NOT overridable: those constants are
// what make carriage-add the overnight arm verbatim.
const RELAY_PARAMS = {
  add: { gain: 0.5, cap: 2 },
  max: {
    gain: parseFloat(argVal('--max-gain', '1.0')),
    cap: parseFloat(argVal('--max-cap', '10')) // 10 = untrained-network.js TRAIL_SENSE_CAP
  }
};
const THROTTLE_DIVISOR = 4;
const THROTTLED_DIRECTION = { src: 1, dst: 0 };
const TILE_SPACE = 100; // world-state.js spawns tiles as `tile-${floor(rng()*100)}`

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

function episodeSeeds() {
  const base = Date.now() >>> 0;
  return Array.from({ length: REPLICATES }, (_, r) => (base + r * 104729) >>> 0);
}

function freshCum() {
  return { reward: 0, applied: 0, attempted: 0, starve_crossings: 0, builds: 0, forced: 0, entropy_sum: 0, entropy_n: 0 };
}

// Per-hive behavioural accumulators (--mechanism only).
//
// The question these answer: `starve_crossings` counts positive-to-zero
// transitions, so a hive can lower it EITHER by staying comfortably fed OR by
// sitting at zero permanently and never rising above it to fall again. Those
// are opposite conditions with the same score. Time-at-zero and mean stockpile
// separate them; nothing in the existing metrics does.
function freshMech() {
  return {
    ticks: 0,
    food_sum: 0, food_sq_sum: 0, food_max: 0,
    ticks_at_zero: 0, pos_to_zero: 0, zero_to_pos: 0,
    longest_zero_run: 0, _cur_zero_run: 0, _prev_food: null
  };
}

function mechObserve(m, food) {
  m.ticks += 1;
  m.food_sum += food;
  m.food_sq_sum += food * food;
  if (food > m.food_max) m.food_max = food;
  if (food === 0) {
    m.ticks_at_zero += 1;
    m._cur_zero_run += 1;
    if (m._cur_zero_run > m.longest_zero_run) m.longest_zero_run = m._cur_zero_run;
  } else {
    m._cur_zero_run = 0;
  }
  if (m._prev_food !== null) {
    if (m._prev_food > 0 && food === 0) m.pos_to_zero += 1;
    if (m._prev_food === 0 && food > 0) m.zero_to_pos += 1;
  }
  m._prev_food = food;
}

// Read the engine's own per-hive audit log. harness.tick writes one `tick`
// event per hive-tick with the verb, whether it applied, the stockpile credit
// (which names the resource actually gained), and the tile a gather targeted.
// Parsing it after the episode costs one file read per hive and requires no
// change to any engine call.
function readAudit(auditPath) {
  const out = {
    tick_events: 0, verbs: {}, applied_by_verb: {},
    food_gains: 0, wood_gains: 0,
    gather_tiles: {}, gather_with_tile: 0
  };
  let txt = '';
  try { txt = fs.readFileSync(auditPath, 'utf8'); } catch { return out; }
  for (const line of txt.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; } // torn final line, not fatal
    if (e.event !== 'tick') continue; // ignore material-discovered et al.
    out.tick_events += 1;
    out.verbs[e.verb] = (out.verbs[e.verb] || 0) + 1;
    if (e.applied) out.applied_by_verb[e.verb] = (out.applied_by_verb[e.verb] || 0) + 1;
    const c = e.stockpile_credit;
    if (c && c.resourceKey === 'food') out.food_gains += c.amount || 1;
    if (c && c.resourceKey === 'wood') out.wood_gains += c.amount || 1;
    if (e.verb === 'gather' && e.tileId) {
      out.gather_tiles[e.tileId] = (out.gather_tiles[e.tileId] || 0) + 1;
      out.gather_with_tile += 1;
    }
  }
  return out;
}

function writeMechanism(group, episode) {
  for (const w of group.worlds) {
    for (const h of w.hives) {
      const m = h.mech;
      const a = readAudit(h.handle.auditLogPath);
      const tiles = Object.entries(a.gather_tiles).sort((x, y) => y[1] - x[1]);
      const top = tiles[0] || [null, 0];
      const meanFood = m.ticks ? m.food_sum / m.ticks : null;
      const varFood = m.ticks ? (m.food_sq_sum / m.ticks) - (meanFood * meanFood) : null;
      appendJsonl(MECH_LOG, {
        episode, group: group.id, arm: group.arm, replicate: group.replicate,
        world: w.index, hive: h.id,
        ticks: m.ticks,
        mean_food: meanFood,
        sd_food: varFood !== null && varFood > 0 ? Math.sqrt(varFood) : 0,
        max_food: m.food_max,
        ticks_at_zero: m.ticks_at_zero,
        frac_at_zero: m.ticks ? m.ticks_at_zero / m.ticks : null,
        longest_zero_run: m.longest_zero_run,
        pos_to_zero: m.pos_to_zero,
        zero_to_pos: m.zero_to_pos,
        verbs: a.verbs,
        applied_by_verb: a.applied_by_verb,
        food_gains: a.food_gains,
        wood_gains: a.wood_gains,
        gather_with_tile: a.gather_with_tile,
        distinct_gather_tiles: tiles.length,
        top_gather_tile: top[0],
        top_gather_share: a.gather_with_tile ? top[1] / a.gather_with_tile : null,
        // The relay's own target, so "did the hive forage where the relay
        // pointed?" is answerable by comparing these two directly.
        relay_fixed_tiles: group.fixedTiles
      });
    }
  }
}

function buildGroup(arm, r, seedBase, episode) {
  const groupId = `${arm}-r${r}`;
  const worlds = [];
  let hiveOrdinal = 0;
  for (let w = 0; w < 2; w++) {
    const worldDir = path.join(ROOT, 'sandboxes', groupId, `world-${w}`);
    const worldStatePath = path.join(worldDir, 'shared', 'world-state.json');
    const seeds = [];
    for (let h = 0; h < 2; h++) {
      const identity = `${groupId}-w${w}-h${h}`;
      const seed = generateBlankHiveSeed(identity, AUTHORED_BY, new Date().toISOString());
      const shape = validateHiveMind(seed);
      const blank = isBlankSeed(seed);
      if (!shape.valid || !blank.valid) {
        throw new Error(`seed validation failed for ${identity}: ${JSON.stringify([...shape.errors, ...blank.errors])}`);
      }
      seeds.push(seed);
    }
    const hiveHandles = setupHives(worldDir, seeds, worldStatePath, RESOURCE_POOL);
    // A fresh episode is a fresh world and gets a fresh audit trail. Without
    // this the engine's per-hive logs accumulate across every episode
    // (~250 KB per hive per episode). The analysis reads metrics.jsonl.
    for (const seed of seeds) fs.writeFileSync(hiveHandles[seed.identity].auditLogPath, '');

    const hives = seeds.map((seed) => {
      const netSeed = (seedBase + hiveOrdinal * 7919) >>> 0;
      const rngSeed = (netSeed + 12345) >>> 0;
      hiveOrdinal += 1;
      return {
        id: seed.identity,
        handle: hiveHandles[seed.identity],
        network: createNetwork(netSeed),
        rng: mulberry32(rngSeed),
        controller: { active: false, prev_post_update_entropy: undefined },
        net_seed: netSeed,
        mech: freshMech()
      };
    });
    worlds.push({ index: w, dir: worldDir, statePath: worldStatePath, hives, cum: freshCum() });
  }
  return {
    id: groupId,
    arm,
    spec: ARM_SPECS[arm],
    replicate: r,
    episode,
    seed_base: seedBase,
    worlds,
    // A relay rng distinct from every hive's stream, so randomizing a tip
    // never perturbs any hive's decision sampling.
    relayRng: mulberry32((seedBase + 999983) >>> 0),
    fixedTiles: {}, // memo for select:'fixed' — one tile per kind, per episode
    episode,
    relay: { tips_offered: 0, tips_delivered: 0, tips_suppressed: 0, actionable: 0, capped: 0, no_op: 0 }
  };
}

// --- relay -----------------------------------------------------------------

function strongestTrail(state, kind) {
  const trails = (state.pheromones || {})[kind] || {};
  let best = { tileId: null, strength: 0 };
  for (const [tileId, strength] of Object.entries(trails)) {
    if (strength > best.strength) best = { tileId, strength };
  }
  return best;
}

// A food tip is actionable only if the destination has a live source at that
// tile. Recorded by every arm; acted on only by `filter-max`.
function isActionable(destState, kind, tileId) {
  if (kind !== 'food') return true;
  return Boolean((destState.food_sources || {})[tileId]);
}

// Selection. Magnitude always comes from the strongest trail so that the
// random arms stay magnitude-matched to their carriage counterparts and the
// ONLY thing that differs is which tile the signal names.
function selectTip(group, srcState, destState, kind) {
  const strongest = strongestTrail(srcState, kind);
  if (!strongest.tileId || strongest.strength <= 0) return null;
  const spec = group.spec;

  if (spec.select === 'random') {
    const tileId = `tile-${Math.floor(group.relayRng() * TILE_SPACE)}`;
    return { tileId, strength: strongest.strength, kind };
  }
  if (spec.select === 'fixed') {
    // One arbitrary tile chosen once per group per kind and reused for the
    // whole episode: CONSISTENT but provably uninformative, since the tile is
    // drawn uniformly at random at the first eligible relay and never updated.
    // Uninformative by randomness, NOT by emptiness: worlds are seeded with 5
    // food patches (world-state.js:40), so the tile is not chosen before food
    // exists. This is the control
    // that separates "the relay carried information" from "the relay named
    // the same tile often enough for additive deposits to compound".
    if (!group.fixedTiles[kind]) {
      group.fixedTiles[kind] = `tile-${Math.floor(group.relayRng() * TILE_SPACE)}`;
    }
    return { tileId: group.fixedTiles[kind], strength: strongest.strength, kind };
  }
  if (spec.select === 'actionable') {
    // Walk trails strongest-first and take the first one the destination can
    // actually act on. This is judgment about content, stated as such.
    const trails = Object.entries((srcState.pheromones || {})[kind] || {})
      .sort((a, b) => b[1] - a[1]);
    for (const [tileId, strength] of trails) {
      if (isActionable(destState, kind, tileId)) return { tileId, strength, kind };
    }
    return null; // nothing passed the filter this round
  }
  return { tileId: strongest.tileId, strength: strongest.strength, kind };
}

// Deposit. 'add' is the engine's native additive behavior (the overnight
// relay). 'max' is non-additive: the trail ends at max(existing, delivered),
// achieved by depositing only the positive shortfall -- so it is still built
// entirely from the exported depositPheromone, with no engine change.
function applyDeposit(group, state, kind, tileId, delivered) {
  if (group.spec.deposit === 'add') return depositPheromone(state, kind, tileId, delivered);
  const existing = ((state.pheromones || {})[kind] || {})[tileId] || 0;
  const shortfall = delivered - existing;
  if (shortfall <= 0) {
    group.relay.no_op += 1;
    return state; // already at or above the relayed level: a genuine no-op
  }
  return depositPheromone(state, kind, tileId, shortfall);
}

function deliver(group, state, tip, round, src, dst, log) {
  const { gain, cap } = RELAY_PARAMS[group.spec.deposit];
  const delivered = Math.min(tip.strength * gain, cap);
  const actionable = isActionable(state, tip.kind, tip.tileId);
  group.relay.tips_delivered += 1;
  if (actionable) group.relay.actionable += 1;
  if (delivered >= cap) group.relay.capped += 1;
  if (log) {
    appendJsonl(RELAY_LOG, {
      // `episode` is required to measure within-episode tile concentration:
      // without it, group ids repeat across episodes and any concentration
      // statistic is confounded across the whole run. Found the hard way while
      // analysing the first probe/attribution pair.
      episode: group.episode, round, group: group.id, arm: group.arm, src_world: src, dst_world: dst,
      kind: tip.kind, tile: tip.tileId, source_strength: tip.strength, delivered,
      actionable, suppressed: false
    });
  }
  return applyDeposit(group, state, tip.kind, tip.tileId, delivered);
}

function logSuppressed(group, round, src, dst, kind, reason, log) {
  group.relay.tips_offered += 1;
  group.relay.tips_suppressed += 1;
  if (log) {
    appendJsonl(RELAY_LOG, {
      episode: group.episode, round, group: group.id, arm: group.arm, src_world: src, dst_world: dst,
      kind, delivered: 0, suppressed: true, reason
    });
  }
}

function runRelay(group, round) {
  if (!group.spec) return;
  const log = round % SUMMARY_EVERY === 0;
  const pairs = [{ src: 0, dst: 1 }, { src: 1, dst: 0 }];

  if (group.spec.sequence === 'live') {
    // Sequential against live state: world 1's outgoing tip is read from a
    // world 1 that already holds world 0's just-relayed signal, so relayed
    // signal can echo and compound. Traffic volume is unchanged, which is
    // exactly why this variant is invisible to any audit that counts
    // messages.
    for (const { src, dst } of pairs) {
      const srcState = readWorldState(group.worlds[src].statePath);
      let dstState = readWorldState(group.worlds[dst].statePath);
      if (!srcState || !dstState) throw new Error(`world-state missing or torn during relay: ${group.id}`);
      let touched = false;
      for (const kind of RELAY_KINDS) {
        const tip = selectTip(group, srcState, dstState, kind);
        if (!tip) continue;
        group.relay.tips_offered += 1;
        dstState = deliver(group, dstState, tip, round, src, dst, log);
        touched = true;
      }
      if (touched) writeWorldState(group.worlds[dst].statePath, dstState);
    }
    return;
  }

  // Snapshot sequencing: every tip is read before any deposit, so no world's
  // tip can be derived from another world's already-relayed signal.
  const snapshots = group.worlds.map((w) => {
    const s = readWorldState(w.statePath);
    if (!s) throw new Error(`world-state missing or torn during relay: ${w.statePath}`);
    return s;
  });

  const staged = [[], []];
  for (const { src, dst } of pairs) {
    if (group.spec.schedule === 'throttled'
      && src === THROTTLED_DIRECTION.src && dst === THROTTLED_DIRECTION.dst
      && round % THROTTLE_DIVISOR !== 0) {
      for (const kind of RELAY_KINDS) logSuppressed(group, round, src, dst, kind, 'throttled', log);
      continue;
    }
    for (const kind of RELAY_KINDS) {
      const tip = selectTip(group, snapshots[src], snapshots[dst], kind);
      if (!tip) {
        if (group.spec.select === 'actionable') logSuppressed(group, round, src, dst, kind, 'filtered', log);
        continue;
      }
      group.relay.tips_offered += 1;
      staged[dst].push({ tip, src });
    }
  }

  for (let dst = 0; dst < 2; dst++) {
    if (!staged[dst].length) continue;
    let state = snapshots[dst];
    for (const { tip, src } of staged[dst]) state = deliver(group, state, tip, round, src, dst, log);
    writeWorldState(group.worlds[dst].statePath, state);
  }
}

// --- metrics ---------------------------------------------------------------

function worldSnapshot(world) {
  const s = readWorldState(world.statePath);
  if (!s) throw new Error(`world-state missing or torn during snapshot: ${world.statePath}`);
  const stockpile = {};
  for (const h of world.hives) {
    const hs = JSON.parse(fs.readFileSync(h.handle.hiveStatePath, 'utf8'));
    for (const [k, v] of Object.entries(hs.hive_state.stockpile || {})) {
      stockpile[k] = (stockpile[k] || 0) + v;
    }
  }
  const c = world.cum;
  return {
    world: world.index,
    cum_reward: c.reward,
    applied_rate: c.attempted ? c.applied / c.attempted : null,
    starve_crossings: c.starve_crossings,
    builds: c.builds,
    forced_exploration: c.forced,
    mean_entropy: c.entropy_n ? c.entropy_sum / c.entropy_n : null,
    structures: (s.geometry_log || []).length,
    territory: Object.keys(s.territory || {}).length,
    food_sources: Object.keys(s.food_sources || {}).length,
    world_food: (s.resources || {}).food || 0,
    stockpile_wood: stockpile.wood || 0
  };
}

const SUMMABLE = ['cum_reward', 'starve_crossings', 'builds', 'forced_exploration', 'structures', 'territory', 'food_sources', 'world_food', 'stockpile_wood'];

function writeMetrics(group, episode, round, final) {
  const worlds = group.worlds.map(worldSnapshot);
  const totals = {};
  for (const key of SUMMABLE) totals[key] = worlds.reduce((a, w) => a + w[key], 0);
  const attempted = group.worlds.reduce((a, w) => a + w.cum.attempted, 0);
  const applied = group.worlds.reduce((a, w) => a + w.cum.applied, 0);
  const entropySum = group.worlds.reduce((a, w) => a + w.cum.entropy_sum, 0);
  const entropyN = group.worlds.reduce((a, w) => a + w.cum.entropy_n, 0);
  appendJsonl(METRICS_LOG, {
    episode,
    round,
    final: Boolean(final),
    group: group.id,
    arm: group.arm,
    spec: group.spec,
    replicate: group.replicate,
    seed_base: group.seed_base,
    ...totals,
    applied_rate: attempted ? applied / attempted : null,
    mean_entropy: entropyN ? entropySum / entropyN : null,
    relay: group.relay,
    worlds
  });
}

// --- main ------------------------------------------------------------------

writeLiveConfig(CONFIG_PATH, { tick_interval_ms: 0 });
fs.writeFileSync(PID_FILE, String(process.pid) + '\n');

logEvent({
  event: 'run-start',
  revision: 2,
  pid: process.pid,
  root: ROOT,
  kill_switch: KILL_SWITCH,
  global_halt: GLOBAL_HALT,
  pid_file: PID_FILE,
  arms: ARMS,
  arm_specs: ARM_SPECS,
  replicates: REPLICATES,
  groups_per_episode: ARMS.length * REPLICATES,
  episode_rounds: EPISODE_ROUNDS,
  max_episodes: MAX_EPISODES,
  deadline: new Date(DEADLINE_MS).toISOString(),
  tick_interval_ms: TICK_INTERVAL_MS,
  summary_every: SUMMARY_EVERY,
  relay: { params_by_deposit: RELAY_PARAMS, kinds: RELAY_KINDS, throttle_divisor: THROTTLE_DIVISOR, throttled_direction: THROTTLED_DIRECTION, tile_space: TILE_SPACE },
  selection_rule_declared: 'strongest-trail-first; the random arms reuse that magnitude at a uniformly random tile; no arm claims to be unfiltered',
  mechanism_instrumentation: MECHANISM,
  hypothesis: 'does a choosing relay distort beyond what its magnitude- and timing-matched null control explains?',
  protocol: 'pure-ticks; no operator input by design; unknown conditions fail closed with a logged stop'
});

process.stdout.write(`authority-probe rev2: pid=${process.pid} arms=${ARMS.length} replicates=${REPLICATES} deadline=${new Date(DEADLINE_MS).toISOString()}\n`);
process.stdout.write(`kill switch: touch ${KILL_SWITCH}\n`);

function checkStop(episode) {
  if (fs.existsSync(GLOBAL_HALT)) requestStop('global-halt');
  else if (fs.existsSync(KILL_SWITCH)) requestStop('kill-switch');
  else if (Date.now() >= DEADLINE_MS) requestStop('deadline');
  else if (episode >= MAX_EPISODES) requestStop('max-episodes');
  return stopRequested;
}

async function runEpisode(episode) {
  const seeds = episodeSeeds();
  const groups = [];
  for (const arm of ARMS) {
    for (let r = 0; r < REPLICATES; r++) groups.push(buildGroup(arm, r, seeds[r], episode));
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
          w.cum.attempted += 1;
          w.cum.reward += res.reward;
          if (res.applied) w.cum.applied += 1;
          if (res.starved) w.cum.starve_crossings += 1;
          if (res.action === 'build' && res.applied) w.cum.builds += 1;
          if (res.forced_exploration) w.cum.forced += 1;
          if (Number.isFinite(res.policy_entropy)) {
            w.cum.entropy_sum += res.policy_entropy;
            w.cum.entropy_n += 1;
          }
          if (MECHANISM) {
            // res.hiveState is post-upkeep, which is exactly the point at
            // which the engine decides `starved`, so the trajectory and the
            // crossing count are measured at the same instant.
            const food = (res.hiveState.hive_state.stockpile || {}).food || 0;
            mechObserve(h.mech, food);
            // One fully-resolved trajectory for the first replicate of the
            // first episode: enough to show the SHAPE of the stockpile series
            // (oscillating versus pinned) without logging millions of rows.
            if (episode === 0 && group.replicate === 0) {
              appendJsonl(TRAJ_LOG, {
                episode, round, arm: group.arm, hive: h.id,
                food, action: res.action, applied: res.applied, starved: res.starved
              });
            }
          }
        }
      }
      runRelay(group, round);
    }
    round += 1;
    if (round % SUMMARY_EVERY === 0) {
      for (const group of groups) writeMetrics(group, episode, round, false);
    }
    if (TICK_INTERVAL_MS > 0) await sleep(TICK_INTERVAL_MS);
  }

  for (const group of groups) writeMetrics(group, episode, round, true);
  // Before the next episode's buildGroup truncates the audit logs.
  if (MECHANISM) for (const group of groups) writeMechanism(group, episode);
  logEvent({ event: 'episode-end', episode, rounds_completed: round, complete: round === EPISODE_ROUNDS, stop_requested: stopRequested });
  process.stdout.write(`[episode ${episode}] ${round} rounds done ${new Date().toISOString()}\n`);
  return round;
}

async function main() {
  let episode = 0;
  while (!checkStop(episode)) {
    await runEpisode(episode);
    episode += 1;
  }
  logEvent({ event: 'run-stopped', reason: stopReason, episodes_completed: episode });
  process.stdout.write(`\nauthority-probe: stopped after ${episode} episodes (${stopReason}).\n`);
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
}

main().catch((e) => {
  logEvent({ event: 'fail-closed-stop', error: e.message, stack: e.stack });
  process.stderr.write(`authority-probe FAIL-CLOSED: ${e.message}\n`);
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
  process.exit(1);
});
