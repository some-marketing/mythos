#!/usr/bin/env node
'use strict';
// Dart <-> Apple (Reminders + Notes) two-way mirror.
//
//   node tools/apple-sync/sync.js [--dry-run] [--no-writeback] [--force] [--verbose]
//
// --dry-run      Compute the plan and print it; write nothing to Apple or Dart.
// --no-writeback Apply Dart->Apple changes but never write completion back to Dart.
// --force        Bypass the write-back safety cap.
// --verbose      Print per-op detail.
//
// On the very first run the mapping store is empty, so the plan is pure
// Dart->Apple population (no write-backs are possible).

const fs = require('fs');
const path = require('path');

const dart = require('../dart-integration/lib/dart-api.js');
const apple = require('./lib/apple-bridge.js');
const reconcileMod = require('./lib/reconcile.js');
const store = require('./lib/mapping-store.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(REPO_ROOT, '_dev', 'state', 'apple-sync', 'sync-log.jsonl');

const argv = process.argv.slice(2);
const FLAGS = {
  dryRun: argv.includes('--dry-run'),
  noWriteback: argv.includes('--no-writeback'),
  force: argv.includes('--force'),
  verbose: argv.includes('--verbose'),
};

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function leaf(board) {
  const parts = board.split('/');
  return parts[parts.length - 1];
}

// Map each board to a collision-free Reminders list name.
function computeListNames(boards, prefix) {
  const leafCounts = {};
  for (const b of boards) {
    const l = leaf(b);
    leafCounts[l] = (leafCounts[l] || 0) + 1;
  }
  const map = {};
  for (const b of boards) {
    const parts = b.split('/');
    const l = parts[parts.length - 1];
    const name = leafCounts[l] > 1 && parts.length > 1
      ? `${parts[parts.length - 2]} / ${l}`
      : l;
    map[b] = prefix + name;
  }
  return map;
}

function resultsOf(res) {
  return (res && (res.results || res.items || res.tasks)) || [];
}

function normalizeTask(t, board, listName) {
  const status = t.status || (t.statusName) || null;
  const due = t.dueAt || t.due_at || t.dueDate || t.due || null;
  return {
    dartId: String(t.id),
    title: t.title || t.name || '(untitled)',
    due: due || null,
    status,
    isCompleted: !!t.is_completed || status === 'Done' || status === 'Abandoned',
    board,
    listName,
    url: t.htmlUrl || t.permalink || t.url || null,
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildDigestHtml(tasksByBoard, generatedAt) {
  const parts = [];
  parts.push('<div><h1>Dart Tasks — Active</h1>');
  parts.push(`<div>Synced from Dart · ${escapeHtml(generatedAt)}</div>`);
  const boards = Object.keys(tasksByBoard).sort();
  const total = boards.reduce((n, b) => n + tasksByBoard[b].length, 0);
  parts.push(`<div><b>${total}</b> active tasks across <b>${boards.length}</b> boards.</div><br>`);
  for (const b of boards) {
    const tasks = tasksByBoard[b];
    parts.push(`<div><b>${escapeHtml(b)}</b> (${tasks.length})</div>`);
    parts.push('<ul>');
    for (const t of tasks) {
      const dueStr = t.due ? ` — due ${escapeHtml(String(t.due).slice(0, 10))}` : '';
      parts.push(`<li>${escapeHtml(t.title)}${dueStr}</li>`);
    }
    parts.push('</ul>');
  }
  parts.push('</div>');
  return parts.join('\n');
}

function logLine(obj) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(obj) + '\n');
  } catch (_) {}
}

async function pullDartTasks(config) {
  const cfg = await dart.getConfig();
  let boards = [...new Set(cfg.dartboards)];
  if (Array.isArray(config.includeBoards) && config.includeBoards.length) {
    boards = boards.filter((b) => config.includeBoards.includes(b));
  }
  if (Array.isArray(config.excludeBoards)) {
    boards = boards.filter((b) => !config.excludeBoards.includes(b));
  }
  const listNames = computeListNames(boards, config.listPrefix);
  const tasks = [];
  const tasksByBoard = {};
  for (const b of boards) {
    const res = await dart.listTasks(b, { is_completed: false, limit: config.activeLimitPerBoard || 300 });
    const items = resultsOf(res);
    tasksByBoard[b] = [];
    for (const it of items) {
      const t = normalizeTask(it, b, listNames[b]);
      tasks.push(t);
      tasksByBoard[b].push(t);
    }
  }
  return { tasks, tasksByBoard, boards, listNames };
}

async function applyDartWriteBacks(writeBacks, config) {
  const doneStatus = config.doneStatus || 'Done';
  const applied = [];
  for (const w of writeBacks) {
    try {
      await dart.updateTask(w.dartId, { id: w.dartId, status: doneStatus });
      applied.push(w.dartId);
    } catch (e) {
      logLine({ ts: nowIso(), kind: 'writeback-error', dartId: w.dartId, detail: String(e.message || e) });
    }
  }
  return applied;
}

function nowIso() {
  // Date.now()/new Date() are fine in plain node (only restricted inside Workflow scripts).
  return new Date().toISOString();
}

async function main() {
  const config = loadConfig();
  const generatedAt = nowIso();
  const st = store.load();

  console.log(`[apple-sync] pulling active Dart tasks…`);
  const { tasks, tasksByBoard, boards } = await pullDartTasks(config);
  console.log(`[apple-sync] ${tasks.length} active tasks across ${boards.length} boards`);

  // The Notes digest never depends on Reminders, so always (re)build it first.
  // This guarantees the operator gets a live, readable mirror even when the
  // Reminders scripting bridge is wedged (a recurring macOS condition).
  const noteHtml = buildDigestHtml(tasksByBoard, generatedAt);
  let noteRes = { action: 'skipped' };
  if (!FLAGS.dryRun) {
    try {
      noteRes = apple.upsertNote(config.digestNoteTitle, noteHtml, config.digestNoteFolder);
      console.log('[apple-sync] digest note:', noteRes.action);
    } catch (e) {
      console.log('[apple-sync] note upsert failed:', String(e.message || e));
    }
  }

  // Reminders read is guarded: if the bridge is unavailable, skip the whole
  // Reminders reconcile/apply/write-back path and leave the mapping store
  // untouched so the next poll retries cleanly. Notes is already updated.
  console.log(`[apple-sync] reading existing Apple reminders…`);
  let appleReminders;
  try {
    appleReminders = apple.readReminders(config.listPrefix).map((r) => {
      // Match the current [dartId:X] marker and the legacy "dartId X)" form so
      // reminders created by earlier runs are still adoptable, not duplicated.
      const m = /\[dartId:([^\]]+)\]/.exec(r.body || '') || /dartId\s+([^\s)]+)/.exec(r.body || '');
      return m ? Object.assign({}, r, { dartId: m[1] }) : r;
    });
    console.log(`[apple-sync] ${appleReminders.length} reminders in managed lists`);
  } catch (e) {
    const detail = String(e.message || e);
    console.log('[apple-sync] Reminders unavailable, skipping reminder sync (Notes digest still updated):', detail);
    logLine({ ts: generatedAt, kind: 'reminders-unavailable', detail, note: noteRes.action, dartTasks: tasks.length });
    return;
  }

  const plan = reconcileMod.reconcile({
    dartTasks: tasks,
    appleReminders,
    entries: st.entries,
    config,
    force: FLAGS.force,
  });

  console.log('[apple-sync] plan:', JSON.stringify(plan.stats));
  if (plan.warnings.length) console.log('[apple-sync] warnings:', JSON.stringify(plan.warnings));
  if (FLAGS.verbose) console.log('[apple-sync] reminderOps:', JSON.stringify(plan.reminderOps, null, 2));

  if (FLAGS.dryRun) {
    console.log('[apple-sync] --dry-run: no changes applied.');
    logLine({ ts: generatedAt, kind: 'dry-run', stats: plan.stats, warnings: plan.warnings });
    return;
  }

  // 1. Apply reminder ops (Dart -> Apple).
  const applyRes = apple.applyReminderOps(plan.reminderOps);
  if (applyRes.errors && applyRes.errors.length) {
    console.log('[apple-sync] reminder op errors:', JSON.stringify(applyRes.errors.slice(0, 10)));
  }

  // 2. Resolve created reminder ids into mapping entries.
  const nextEntries = plan.nextEntries;
  for (const dartId of Object.keys(nextEntries)) {
    const e = nextEntries[dartId];
    if (e.reminderTempId && applyRes.created[e.reminderTempId]) {
      e.reminderId = applyRes.created[e.reminderTempId];
      delete e.reminderTempId;
    }
    // Drop entries whose create failed (no resolved reminderId).
    if (!e.reminderId) delete nextEntries[dartId];
  }

  // 3. Apply Dart write-backs (Apple -> Dart completion), unless suppressed.
  let writtenBack = [];
  if (!FLAGS.noWriteback && plan.dartWriteBacks.length) {
    console.log(`[apple-sync] writing back ${plan.dartWriteBacks.length} completion(s) to Dart…`);
    writtenBack = await applyDartWriteBacks(plan.dartWriteBacks, config);
  } else if (FLAGS.noWriteback && plan.dartWriteBacks.length) {
    console.log(`[apple-sync] --no-writeback: skipped ${plan.dartWriteBacks.length} Dart completion(s)`);
    // Revert snapshots so they retry next run.
    for (const w of plan.dartWriteBacks) {
      if (nextEntries[w.dartId]) nextEntries[w.dartId].lastDart.isCompleted = false;
    }
  }

  // 4. Persist mapping store.
  st.entries = nextEntries;
  st.lastSyncAt = generatedAt;
  store.save(st);

  const summary = {
    ts: generatedAt,
    kind: 'sync',
    stats: plan.stats,
    appliedReminderOps: applyRes.applied,
    reminderErrors: (applyRes.errors || []).length,
    writtenBack: writtenBack.length,
    note: noteRes.action,
    warnings: plan.warnings,
    entries: Object.keys(nextEntries).length,
  };
  logLine(summary);
  console.log('[apple-sync] done:', JSON.stringify(summary));
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[apple-sync] FATAL:', e && (e.stack || e.message || e));
    logLine({ ts: nowIso(), kind: 'fatal', detail: String(e && (e.message || e)) });
    process.exit(1);
  });
}

module.exports = { computeListNames, normalizeTask, buildDigestHtml, leaf };
