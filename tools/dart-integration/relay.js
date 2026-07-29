'use strict';

/**
 * relay.js — dependency-driven task assignment for Dart ("Relay").
 *
 * The relay-race model: every task knows (a) who SHOULD do it (intended
 * assignee, held in reserve) and (b) which upstream tasks must be Done before
 * it can start (blocked_by). Tasks sit UNASSIGNED until they are ready. When
 * all of a task's blockers reach status "Done", the relay hands off the baton:
 * it assigns the task to its intended owner and posts a "you're up" comment —
 * so a person is pinged exactly when their work becomes doable, never before.
 *
 * Design notes:
 *   - The dependency graph lives in a relay manifest we own (relay-graph.json),
 *     NOT in Dart. Dart holds live status; we own readiness + assignment logic.
 *   - Generic engine: any project supplies its own manifest. HomeNet is the
 *     first consumer.
 *   - Idempotent: a per-manifest state file records which nodes were already
 *     activated, so re-runs never double-assign or double-comment.
 *   - Safe by default: dry-run unless --apply is passed. Never assigns to a
 *     person who is not yet a known Dart workspace user (e.g. before Chris is
 *     invited) — such nodes are marked ready_pending_user and skipped until the
 *     user exists.
 *
 * CLI:
 *   node tools/dart-integration/relay.js --manifest <path> [--apply] [--state <path>]
 *   (default = dry-run; prints the plan without mutating Dart)
 *
 * No external dependencies. lib/dart-api.js is the only Dart surface used, and
 * it is required lazily so unit tests can stub it via require.cache.
 */

const fs = require('fs');
const path = require('path');

const COMPLETED_STATUS = 'Done';

// ---------------------------------------------------------------------------
// Pure logic (no IO, no network) — this is what the unit tests exercise.
// ---------------------------------------------------------------------------

/**
 * Decide what the relay should do, given a snapshot of the world.
 *
 * @param {Object}   args
 * @param {Object}   args.manifest         - parsed relay manifest
 * @param {Object}   args.statuses         - { [taskId]: { status, assignees:[] } }
 * @param {Set<string>} args.knownAssignees - assignee names Dart recognizes
 * @param {Object}   args.state            - prior relay state ({} on first run)
 * @returns {{ actions: Array, nextState: Object }}
 *
 * Action types:
 *   - 'assign'        : node is ready and owner is a known user -> assign + comment
 *   - 'pending_user'  : node is ready but owner not yet in Dart -> hold, no mutation
 *   - 'already_owned'  : node is ready but already has an assignee -> record, no mutation
 */
function evaluateRelay({ manifest, statuses, knownAssignees, state }) {
  const prior = (state && state.nodes) || {};
  const nextNodes = {};
  const actions = [];

  const isDone = (taskId) => {
    const t = statuses[taskId];
    return !!(t && t.status === COMPLETED_STATUS);
  };

  for (const node of manifest.nodes || []) {
    const taskId = node.task_id;
    const priorNode = prior[taskId] || {};
    const live = statuses[taskId] || {};
    const blockedBy = node.blocked_by || [];

    // Carry forward terminal state: once activated, never re-act.
    if (priorNode.activated) {
      nextNodes[taskId] = priorNode;
      continue;
    }

    const unmetBlockers = blockedBy.filter((id) => !isDone(id));
    const ready = unmetBlockers.length === 0;

    if (!ready) {
      nextNodes[taskId] = {
        ready: false,
        activated: false,
        waiting_on: unmetBlockers,
      };
      continue;
    }

    // Ready. Decide how to hand off the baton.
    const existingAssignees = live.assignees || [];
    const owner = node.intended_assignee;

    if (existingAssignees.length > 0) {
      // Someone is already on it (assigned out-of-band). Record, don't disturb.
      nextNodes[taskId] = {
        ready: true,
        activated: true,
        assigned_to: existingAssignees[0],
        via: 'already_owned',
      };
      actions.push({ type: 'already_owned', taskId, label: node.label, assignee: existingAssignees[0] });
      continue;
    }

    if (owner && knownAssignees.has(owner)) {
      const reason = buildHandoffReason(node, manifest, statuses);
      nextNodes[taskId] = {
        ready: true,
        activated: true,
        assigned_to: owner,
        via: 'relay',
      };
      actions.push({ type: 'assign', taskId, label: node.label, assignee: owner, reason });
    } else {
      // Ready, but the owner is not (yet) a Dart user — hold, do not assign.
      nextNodes[taskId] = {
        ready: true,
        activated: false,
        ready_pending_user: true,
        intended_assignee: owner || null,
      };
      actions.push({ type: 'pending_user', taskId, label: node.label, assignee: owner || null });
    }
  }

  return {
    actions,
    nextState: { relay_id: manifest.relay_id, nodes: nextNodes },
  };
}

/**
 * Human-readable "you're up" reason for a comment. Resolves a blocker's label
 * from (1) its relay node label, (2) its live Dart task title, then (3) the raw
 * id — so gate tasks that are not themselves relay nodes still read cleanly.
 */
function buildHandoffReason(node, manifest, statuses) {
  const s = statuses || {};
  const labelOf = (id) => {
    const n = (manifest.nodes || []).find((x) => x.task_id === id);
    if (n) return n.label;
    if (s[id] && s[id].title) return s[id].title;
    return id;
  };
  const preds = (node.blocked_by || []).map(labelOf);
  if (preds.length === 0) {
    return `You're up — "${node.label}" is ready to start.`;
  }
  return `You're up — "${node.label}" is ready because ${preds.map((p) => `"${p}"`).join(' and ')} ${preds.length === 1 ? 'is' : 'are'} complete.`;
}

// ---------------------------------------------------------------------------
// IO + network (kept thin so the pure layer stays testable)
// ---------------------------------------------------------------------------

function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!manifest.relay_id) throw new Error(`manifest ${manifestPath} missing relay_id`);
  if (!Array.isArray(manifest.nodes)) throw new Error(`manifest ${manifestPath} missing nodes[]`);
  return manifest;
}

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const stamped = Object.assign({ updated_at: new Date().toISOString() }, state);
  fs.writeFileSync(statePath, JSON.stringify(stamped, null, 2) + '\n');
}

/** Fetch live status + assignees for every task referenced by the manifest. */
async function fetchStatuses(dart, manifest) {
  const ids = new Set();
  for (const node of manifest.nodes || []) {
    ids.add(node.task_id);
    for (const b of node.blocked_by || []) ids.add(b);
  }
  const statuses = {};
  for (const id of ids) {
    try {
      const res = await dart.getTask(id);
      const d = res.item || res;
      statuses[id] = { status: d.status, assignees: d.assignees || [], title: d.title };
    } catch (e) {
      statuses[id] = { status: '__ERROR__', assignees: [], error: e.message };
    }
  }
  return statuses;
}

/** Set of assignee names Dart recognizes (from /config). */
async function fetchKnownAssignees(dart) {
  const cfg = await dart.getConfig();
  const c = cfg.item || cfg;
  return new Set(c.assignees || []);
}

/** Perform the assign + comment mutations for 'assign' actions. */
async function applyActions(dart, actions, { apply }) {
  const performed = [];
  for (const a of actions) {
    if (a.type !== 'assign') continue;
    if (!apply) {
      performed.push({ ...a, applied: false, dryRun: true });
      continue;
    }
    await dart.updateTask(a.taskId, { id: a.taskId, assignees: [a.assignee] });
    await dart.addComment(a.taskId, a.reason);
    performed.push({ ...a, applied: true });
  }
  return performed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { apply: false, manifest: null, state: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--state') args.state = argv[++i];
  }
  return args;
}

function defaultStatePath(repoRoot, relayId) {
  return path.join(repoRoot, '_dev', 'state', 'dart-relay', `${relayId}.state.json`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    console.error('usage: node relay.js --manifest <path> [--apply] [--state <path>]');
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, '..', '..');
  const manifest = loadManifest(args.manifest);
  const statePath = args.state || defaultStatePath(repoRoot, manifest.relay_id);
  const state = loadState(statePath);

  const dart = require('./lib/dart-api');
  const [statuses, knownAssignees] = await Promise.all([
    fetchStatuses(dart, manifest),
    fetchKnownAssignees(dart),
  ]);

  const { actions, nextState } = evaluateRelay({ manifest, statuses, knownAssignees, state });
  const performed = await applyActions(dart, actions, { apply: args.apply });

  // Report
  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`Relay "${manifest.relay_id}" — ${mode}`);
  if (actions.length === 0) {
    console.log('  No tasks are ready to hand off right now.');
  }
  for (const a of actions) {
    if (a.type === 'assign') {
      console.log(`  → assign "${a.label}" to ${a.assignee}${args.apply ? '' : ' (dry-run)'}`);
    } else if (a.type === 'pending_user') {
      console.log(`  ⏸ "${a.label}" is ready but owner "${a.assignee}" is not in Dart yet — holding.`);
    } else if (a.type === 'already_owned') {
      console.log(`  ✓ "${a.label}" already owned by ${a.assignee} — recorded.`);
    }
  }

  if (args.apply) {
    saveState(statePath, nextState);
    console.log(`  state -> ${path.relative(repoRoot, statePath)}`);
  } else {
    console.log('  (dry-run: state not written, Dart not mutated)');
  }
  return { actions, performed };
}

if (require.main === module) {
  main().catch((e) => {
    console.error('relay failed:', e.message);
    process.exit(1);
  });
}

module.exports = {
  evaluateRelay,
  buildHandoffReason,
  loadManifest,
  loadState,
  saveState,
  fetchStatuses,
  fetchKnownAssignees,
  applyActions,
  parseArgs,
  COMPLETED_STATUS,
};
