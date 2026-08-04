#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/lore-engine/watch.js — plan
// ant-hive-world-lore-wiki-layer, S2. The decoupled watcher (S0 axis 5):
// polls each hive's audit-log.jsonl on its OWN interval, entirely separate
// from run-live.js/harness.js's tick loop -- the sim is never touched,
// never slowed, and never depends on this process being alive.
//
// Per-hive state lives in the hive's own sandbox directory (G-ISO: no
// cross-project shared state):
//   <hive-dir>/wiki-log.jsonl          -- append-only, the actual wiki content
//   <hive-dir>/wiki-checkpoint.json    -- dedup/idempotency + retry queue
//   <hive-dir>/pending-milestone-narration.jsonl -- milestone triggers queued
//                                          for manual/attended frontier
//                                          narration (S0 axis 2: unattended
//                                          frontier dispatch is out of scope)
//
// Usage: node watch.js --sandbox-root <dir> [--world-state <path>]
//   [--interval-ms 5000] [--model <ollama-model>] [--once] [--max-retries 3]

const fs = require('fs');
const path = require('path');
const { readWorldState } = require('../world-state.js');
const { freshCheckpoint, detectTriggers } = require('./detect-triggers.js');
const { generateEntry, dispatchViaOrwellSubmind } = require('./generate-entry.js');

const DEFAULT_ROLLING_CONTEXT_SIZE = 5;
const DEFAULT_MAX_RETRIES = 3;

function readJsonlLines(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function appendJsonlAtomic(filePath, entry) {
  // Same discipline as harness.js's appendAudit -- a single appendFileSync
  // call is line-atomic enough for this single-writer-per-file use (only
  // this watcher process ever writes wiki-log.jsonl/checkpoint retries for
  // a given hive), consistent with the existing audit-log.jsonl pattern.
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

function readCheckpoint(checkpointPath) {
  try {
    const raw = fs.readFileSync(checkpointPath, 'utf8');
    return { ...freshCheckpoint(), last_line_count: 0, pending_retries: [], retry_counts: {}, ...JSON.parse(raw) };
  } catch {
    return { ...freshCheckpoint(), last_line_count: 0, pending_retries: [], retry_counts: {} };
  }
}

function writeCheckpointAtomic(checkpointPath, checkpoint) {
  const tmp = checkpointPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2));
  fs.renameSync(tmp, checkpointPath);
}

function triggerKey(trigger) {
  return `${trigger.hive}:${trigger.entry_type}:${trigger.subject}:${trigger.ts}`;
}

// One poll cycle for ONE hive. Pure enough to unit-test against a temp
// directory with an injected dispatchFn -- no SSH round-trip required in
// tests. Returns a summary of what happened, for logging/observability.
function pollHiveOnce({ hiveId, hiveDir, worldStatePath, opts = {} }) {
  const auditLogPath = path.join(hiveDir, 'audit-log.jsonl');
  const wikiLogPath = path.join(hiveDir, 'wiki-log.jsonl');
  const checkpointPath = path.join(hiveDir, 'wiki-checkpoint.json');
  const milestoneQueuePath = path.join(hiveDir, 'pending-milestone-narration.jsonl');
  const dispatchFn = opts.dispatchFn || dispatchViaOrwellSubmind;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  const checkpoint = readCheckpoint(checkpointPath);
  const allAuditEntries = readJsonlLines(auditLogPath);
  const newAuditEntries = allAuditEntries.slice(checkpoint.last_line_count);
  const worldStateSnapshot = worldStatePath ? readWorldState(worldStatePath) : null;

  const { triggers, checkpoint: nextDetectionState } = detectTriggers({
    hiveId,
    newAuditEntries,
    checkpoint,
    worldStateSnapshot,
    opts
  });

  const routineTriggers = triggers.filter((t) => t.tier === 'routine');
  const milestoneTriggers = triggers.filter((t) => t.tier === 'milestone');

  // Milestone triggers are never auto-dispatched -- queued for attended
  // resolution per the S0 memo's explicit scope boundary.
  for (const trigger of milestoneTriggers) {
    appendJsonlAtomic(milestoneQueuePath, trigger);
  }

  // Retry queue first (oldest failures get another attempt before any
  // brand-new triggers this poll), then this poll's fresh routine triggers.
  const toAttempt = [...checkpoint.pending_retries, ...routineTriggers];
  const stillPending = [];
  const retryCounts = { ...checkpoint.retry_counts };
  const results = { generated: 0, failed_permanently: 0, retrying: 0 };

  // codex distinct review (2026-07-17), non-blocking finding: the wiki
  // append and the checkpoint write are two separate file operations --
  // a crash between them would reprocess the same audit lines on restart
  // and append a duplicate entry. Guard with a dispatch_key already seen in
  // the wiki log (read once per poll, updated in-memory as this poll
  // generates its own entries) rather than a heavier cross-file
  // transaction -- this is the actual duplicate-prevention boundary,
  // whether the duplicate risk comes from a crash-restart or, per the same
  // finding, two watcher instances racing against the same checkpoint.
  const existingKeys = new Set(readJsonlLines(wikiLogPath).map((e) => e.dispatch_key).filter(Boolean));

  for (const trigger of toAttempt) {
    const key = triggerKey(trigger);
    if (existingKeys.has(key)) {
      delete retryCounts[key];
      continue; // already generated (e.g. a prior crash between append and checkpoint write) -- do not duplicate
    }
    const recentEntries = readJsonlLines(wikiLogPath).slice(-DEFAULT_ROLLING_CONTEXT_SIZE);
    const outcome = generateEntry(trigger, { recentEntries, dispatchFn, model: opts.model, timeoutMs: opts.timeoutMs });
    if (outcome.ok) {
      appendJsonlAtomic(wikiLogPath, { ...outcome.entry, dispatch_key: key });
      existingKeys.add(key);
      results.generated += 1;
      delete retryCounts[key];
    } else {
      const attempts = (retryCounts[key] || 0) + 1;
      if (attempts >= maxRetries) {
        // Permanently failed -- logged for observability, not silently
        // dropped, and not retried forever either.
        appendJsonlAtomic(path.join(hiveDir, 'wiki-generation-failures.jsonl'), {
          ts: new Date().toISOString(), trigger, error: outcome.error, attempts
        });
        results.failed_permanently += 1;
        delete retryCounts[key];
      } else {
        retryCounts[key] = attempts;
        stillPending.push(trigger);
        results.retrying += 1;
      }
    }
  }

  const finalCheckpoint = {
    ...nextDetectionState,
    last_line_count: allAuditEntries.length,
    pending_retries: stillPending,
    retry_counts: retryCounts
  };
  writeCheckpointAtomic(checkpointPath, finalCheckpoint);

  return {
    hiveId,
    new_audit_entries: newAuditEntries.length,
    triggers_detected: triggers.length,
    milestones_queued: milestoneTriggers.length,
    ...results
  };
}

function discoverHiveDirs(sandboxRoot) {
  let entries = [];
  try {
    entries = fs.readdirSync(sandboxRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'shared')
    .map((e) => ({ hiveId: e.name, hiveDir: path.join(sandboxRoot, e.name) }));
}

function pollAllHives(sandboxRoot, worldStatePath, opts = {}) {
  return discoverHiveDirs(sandboxRoot).map(({ hiveId, hiveDir }) =>
    pollHiveOnce({ hiveId, hiveDir, worldStatePath, opts })
  );
}

module.exports = {
  pollHiveOnce,
  pollAllHives,
  discoverHiveDirs,
  readCheckpoint,
  writeCheckpointAtomic,
  triggerKey,
  DEFAULT_MAX_RETRIES
};

if (require.main === module) {
  function argVal(flag, def) {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
  }
  function hasFlag(flag) {
    return process.argv.indexOf(flag) !== -1;
  }

  const SANDBOX_ROOT = argVal('--sandbox-root', null);
  if (!SANDBOX_ROOT) {
    process.stderr.write('Usage: node watch.js --sandbox-root <dir> [--world-state <path>] [--interval-ms 5000] [--model <name>] [--once] [--max-retries 3]\n');
    process.exit(1);
  }
  const WORLD_STATE_PATH = argVal('--world-state', path.join(SANDBOX_ROOT, 'shared', 'world-state.json'));
  const INTERVAL_MS = parseInt(argVal('--interval-ms', '5000'), 10);
  const MODEL = argVal('--model', null);
  const MAX_RETRIES = parseInt(argVal('--max-retries', String(DEFAULT_MAX_RETRIES)), 10);
  const ONCE = hasFlag('--once');

  // codex distinct review (2026-07-17), non-blocking finding: two watcher
  // instances against the same sandbox would race over the same checkpoint
  // file and could double-generate entries. A single lock file (this
  // process's PID) at the sandbox root refuses a second concurrent
  // instance; stale locks from a crashed process are detected via
  // kill(pid, 0) and reclaimed rather than left blocking forever.
  const LOCK_PATH = path.join(SANDBOX_ROOT, 'lore-engine.lock');
  function isPidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }
  try {
    const existing = fs.existsSync(LOCK_PATH) ? JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) : null;
    if (existing && existing.pid && isPidAlive(existing.pid)) {
      process.stderr.write(`lore-engine watch: another instance (pid ${existing.pid}) already holds the lock for ${SANDBOX_ROOT}. Refusing to start a second instance.\n`);
      process.exit(1);
    }
  } catch {
    // torn/unreadable lock file -- treat as stale, proceed to reclaim it
  }
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  function releaseLock() {
    try {
      const current = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      if (current.pid === process.pid) fs.unlinkSync(LOCK_PATH);
    } catch {
      // already gone or unreadable -- nothing to release
    }
  }
  process.on('exit', releaseLock);

  let stopRequested = false;
  process.on('SIGINT', () => { stopRequested = true; process.stdout.write('\nlore-engine watch: stopping cleanly after this poll.\n'); });
  process.on('SIGTERM', () => { stopRequested = true; });

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function loop() {
    process.stdout.write(`lore-engine watch: sandbox=${SANDBOX_ROOT} interval=${INTERVAL_MS}ms model=${MODEL || '(host default)'}\n`);
    do {
      const summaries = pollAllHives(SANDBOX_ROOT, WORLD_STATE_PATH, { model: MODEL, maxRetries: MAX_RETRIES });
      for (const s of summaries) {
        process.stdout.write(`[${new Date().toISOString()}] ${s.hiveId}: +${s.new_audit_entries} audit lines, ${s.triggers_detected} triggers (${s.generated} generated, ${s.retrying} retrying, ${s.failed_permanently} failed, ${s.milestones_queued} milestones queued)\n`);
      }
      if (ONCE || stopRequested) break;
      await sleep(INTERVAL_MS);
    } while (!stopRequested);
    process.stdout.write('lore-engine watch: stopped.\n');
  }

  loop().catch((e) => {
    process.stderr.write(`watch.js error: ${e.message}\n`);
    process.exit(1);
  });
}
