#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// operator-response-poller.js
//
// Watches Dart for OPERATOR ANSWERS to "Decision Needed" tasks assigned to the
// operator, and turns each answer into a resume packet + a handoff-signal file +
// acknowledgement comment so a human or /orchestrate-loop can pick the work
// back up exactly when the operator replies.
//
// Also enforces the standing rule: the Mythos user owns any active (Doing) task
// (opt-in via --assign-active).
//
// BOUNDED v1 (autonomy gate): this poller DETECTS answers and EMITS a resume
// packet + signal + ack. It does NOT autonomously execute the resumed work.
// Pickup stays human/orchestrator-gated (/follow-signal, /orchestrate-loop).
// Unbounded auto-resume is a deliberate later step requiring review — do not
// add it here without that review.
//
// Pure detection lives in lib/operator-response.js (unit-tested, no network).
//
// Usage:
//   node tools/dart-integration/operator-response-poller.js            # one pass, dry-run-safe report
//   node tools/dart-integration/operator-response-poller.js --apply    # emit packets/signals/acks
//   node tools/dart-integration/operator-response-poller.js --watch --interval-seconds 300 --apply
//   node tools/dart-integration/operator-response-poller.js --apply --assign-active
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const dart = require('./lib/dart-api');
const engine = require('./lib/operator-response');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_PATH = path.join(REPO_ROOT, '_dev', 'state', 'dart-operator-responses', 'state.json');
const PACKET_DIR = path.join(REPO_ROOT, '_dev', 'state', 'operator-responses');
const SIGNAL_DIR = path.join(REPO_ROOT, '_dev', 'reports', 'signals');
const ACK_MARKER = 'Mythos-RESPONSE-CHECKER: acknowledged operator answer';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    apply: false,
    watch: false,
    intervalSeconds: 300,
    assignActive: false,
    operator: engine.OPERATOR_DEFAULT,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a === '--watch') args.watch = true;
    else if (a === '--interval-seconds') args.intervalSeconds = Number(argv[++i]);
    else if (a === '--assign-active') args.assignActive = true;
    else if (a === '--operator') args.operator = String(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isFinite(args.intervalSeconds) || args.intervalSeconds < 10) {
    throw new Error('--interval-seconds must be at least 10.');
  }
  return args;
}

function help() {
  console.log(`
Watch Dart for operator answers to "Decision Needed" tasks and emit resume packets.

BOUNDED: detects + emits packet/signal/ack only. Does NOT auto-execute the work.

Usage:
  node tools/dart-integration/operator-response-poller.js [options]

Options:
  --apply                 Write packets/signals/acks + state (default: dry-run report)
  --watch                 Keep polling until stopped (Ctrl-C)
  --interval-seconds <n>  Watch interval; default 300, min 10
  --assign-active         Also assign the Mythos user to any Doing task lacking it
  --operator <name>       Operator Dart user to watch; default "${engine.OPERATOR_DEFAULT}"
  --json                  Print structured output
  --help                  Show this help
`.trim());
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function loadState(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { seen: {} };
  }
}

function saveState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Dart IO
// ---------------------------------------------------------------------------

function normalizeTask(item) {
  const t = item && item.item ? item.item : item;
  return {
    id: String(t.id || ''),
    title: String(t.title || ''),
    status: String(t.status || ''),
    description: String(t.description || ''),
    dartboard: String(t.dartboard || ''),
    assignees: Array.isArray(t.assignees) ? t.assignees.map(String) : [],
  };
}

function commentsFrom(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.results)) return result.results;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

/** All dartboards from /config. */
async function fetchBoards(deps = dart) {
  const cfg = await deps.getConfig();
  const c = cfg && cfg.item ? cfg.item : cfg;
  return Array.isArray(c.dartboards) ? c.dartboards : [];
}

/**
 * Build the watch set: every non-completed Decision-Needed task assigned to the
 * operator across all boards, UNION any task id already tracked in state (so we
 * still catch a status that moved OFF Decision-Needed). Returns full task
 * objects + their comments.
 */
async function fetchWorld(operator, state, deps = dart) {
  const boards = await fetchBoards(deps);
  const candidateIds = new Set();

  for (const board of boards) {
    let res;
    try {
      // Server-side status + assignee filter so we never miss a Decision-Needed
      // task behind a >limit page of other open tasks on a busy board.
      res = await deps.listTasks(board, {
        assignee: operator,
        status: engine.DECISION_STATUS,
        is_completed: false,
        limit: 200,
      });
    } catch {
      continue;
    }
    const summaries = (res && res.results) || [];
    for (const s of summaries) {
      const id = String(s.id || '');
      if (id && String(s.status || '') === engine.DECISION_STATUS) candidateIds.add(id);
    }
  }
  // Always re-check tasks we already track (to detect a status that moved OFF
  // Decision-Needed, which the summary filter above would no longer surface).
  for (const id of Object.keys((state && state.seen) || {})) candidateIds.add(id);

  const tasks = [];
  const commentsByTask = {};
  for (const id of candidateIds) {
    let task;
    try {
      task = normalizeTask(await deps.getTask(id));
    } catch {
      continue;
    }
    if (!task.id) continue;
    const tracked = state && state.seen && state.seen[id];
    const isDecisionForOperator =
      task.status === engine.DECISION_STATUS && task.assignees.includes(operator);
    if (!isDecisionForOperator && !tracked) continue; // not ours to watch
    tasks.push(task);
    try {
      commentsByTask[id] = commentsFrom(await deps.listComments(id)).map((c) => ({
        id: String(c.id || ''),
        author: String(c.author || ''),
        text: String(c.text || ''),
      }));
    } catch {
      commentsByTask[id] = [];
    }
  }
  return { tasks, commentsByTask };
}

// Deterministic per-response key → packet/signal filenames are idempotent, so a
// crash between emit and state-save cannot duplicate them (a re-emit overwrites).
function responseKey(response) {
  const ids = response.answer_comments.map((c) => String(c.id)).join('-');
  const raw = ids ? `c-${ids}` : `status-${response.status_after}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

// Redact secrets out of the response before it touches a durable artifact.
function redactedResponse(response) {
  return {
    ...response,
    answer_comments: response.answer_comments.map((c) => ({ id: c.id, text: engine.redactSecrets(c.text) })),
  };
}

function writeResumePacket(response) {
  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const p = path.join(PACKET_DIR, `${response.task_id}.answered__${responseKey(response)}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({ schema: 'OperatorAnswer/1.0', detected_at: new Date().toISOString(), ...redactedResponse(response) }, null, 2) + '\n',
  );
  return path.relative(REPO_ROOT, p);
}

function writeSignal(response) {
  fs.mkdirSync(SIGNAL_DIR, { recursive: true });
  const answerText = engine.redactSecrets(response.answer_comments.map((c) => c.text).join('\n').trim());
  const signal = {
    schema: 'DartHandoffSignal/1.0',
    signal_type: 'operator-answered',
    lifecycle_state: 'open',
    timestamp: new Date().toISOString(),
    source: 'operator-response-poller',
    scope: response.dartboard || 'dart',
    recommended_next_actor: 'coordinator',
    recommended_next_command: response.plan_ref
      ? `/orchestrate-loop ${response.plan_ref}`
      : `/orchestrate-loop dart:${response.task_id}`,
    topic: `operator-answered__${response.task_id}`,
    description: `Operator (${response.operator}) answered Dart task "${response.title}" (${response.task_id}). Resume the linked workstream. Answer: ${answerText || '(status moved off Decision Needed: ' + response.status_after + ')'}`,
    artifacts: response.plan_ref ? [response.plan_ref] : [],
    decision_context_artifacts: [],
    blocked_by: [],
    next_step_detail: [
      'Read the operator answer (above / resume packet).',
      response.plan_ref ? `Resume plan: ${response.plan_ref}` : 'Identify the linked workstream for this task.',
      'BOUNDED: this signal does not execute work — a coordinator/operator must pick it up.',
    ],
    dart_task_id: response.task_id,
  };
  const p = path.join(SIGNAL_DIR, `operator-answered__${response.task_id}__${responseKey(response)}.signal.json`);
  fs.writeFileSync(p, JSON.stringify(signal, null, 2) + '\n');
  return path.relative(REPO_ROOT, p);
}

// ---------------------------------------------------------------------------
// One pass
// ---------------------------------------------------------------------------

async function runOnce(args, deps = dart) {
  const state = loadState(STATE_PATH);
  const world = await fetchWorld(args.operator, state, deps);
  const { responses, nextState } = engine.detectResponses(
    { tasks: world.tasks, commentsByTask: world.commentsByTask, state },
    { operator: args.operator },
  );
  const activeAssignments = args.assignActive ? engine.decideActiveAssignments(world.tasks) : [];

  const emitted = [];
  const errors = [];
  if (args.apply) {
    for (const r of responses) {
      // Packet + signal first (deterministic filenames → idempotent re-emit).
      const packet = writeResumePacket(r);
      const signal = writeSignal(r);
      const ackIds = r.answer_comments.map((c) => c.id).join(', ');
      // Idempotent ack: skip if an ack for these comment ids already exists.
      const existing = world.commentsByTask[r.task_id] || [];
      const alreadyAcked = existing.some(
        (c) => String(c.text || '').includes(ACK_MARKER) && (!ackIds || String(c.text).includes(ackIds)),
      );
      if (!alreadyAcked) {
        try {
          await deps.addComment(
            r.task_id,
            `${ACK_MARKER}${ackIds ? ' [' + ackIds + ']' : ''}. Mythos picked up your answer — resume signal emitted (${signal}). This is a bounded handoff; the work is being routed, not auto-run.`,
          );
        } catch (e) {
          errors.push({ op: 'addComment', task_id: r.task_id, error: e.message });
        }
      }
      emitted.push({ task_id: r.task_id, packet, signal });
    }
    for (const a of activeAssignments) {
      try {
        // MERGE assignees — never clobber an existing human owner.
        await deps.updateTask(a.task_id, { id: a.task_id, assignees: a.assignees });
      } catch (e) {
        errors.push({ op: 'assign-active', task_id: a.task_id, error: e.message });
      }
    }
    // State saved AFTER emission is durably on disk; idempotent filenames make
    // this safe even if a crash interrupts the loop.
    saveState(STATE_PATH, nextState);
  }

  return {
    ok: errors.length === 0,
    errors,
    operator: args.operator,
    watched: world.tasks.length,
    responses_detected: responses.length,
    responses,
    active_assignments: activeAssignments,
    emitted,
    applied: args.apply,
  };
}

function report(result) {
  if (result.responses_detected === 0 && result.active_assignments.length === 0) {
    console.log(`operator-response: watched ${result.watched} task(s), no new answers.${result.applied ? '' : ' (dry-run)'}`);
    return;
  }
  console.log(`operator-response (${result.applied ? 'APPLY' : 'DRY-RUN'}) — operator "${result.operator}", watched ${result.watched}:`);
  for (const r of result.responses) {
    const how = r.status_moved_off_decision ? `status → ${r.status_after}` : `${r.answer_comments.length} answer comment(s)`;
    console.log(`  ✓ answered: "${r.title}" (${r.task_id}) — ${how}${r.plan_ref ? ` → ${r.plan_ref}` : ''}`);
  }
  for (const a of result.active_assignments) {
    console.log(`  → assign Mythos to active "${a.title}" (${a.task_id})`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return help();
  if (args.watch) {
    // Interruptible: Ctrl-C exits the loop cleanly.
    let stop = false;
    process.on('SIGINT', () => { stop = true; console.log('\nstopping…'); });
    while (!stop) {
      const result = await runOnce(args);
      if (args.json) console.log(JSON.stringify(result)); else report(result);
      if (stop) break;
      await sleep(args.intervalSeconds * 1000);
    }
    return;
  }
  const result = await runOnce(args);
  if (args.json) console.log(JSON.stringify(result, null, 2)); else report(result);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('operator-response-poller failed:', e.message);
    process.exit(1);
  });
}

module.exports = { runOnce, fetchWorld, parseArgs, loadState, saveState };
