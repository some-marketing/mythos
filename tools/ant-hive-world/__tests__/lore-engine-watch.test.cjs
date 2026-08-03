'use strict';

// Lore/wiki layer watcher integration tests (plan
// ant-hive-world-lore-wiki-layer, S2). Uses a real temp sandbox directory
// (fs is the actual integration surface here) but an INJECTED dispatchFn --
// never a real SSH/Ollama round-trip in tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pollHiveOnce, discoverHiveDirs, readCheckpoint } = require('../lore-engine/watch.js');

function makeHiveDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-watch-test-'));
  return dir;
}

function appendAudit(hiveDir, entry) {
  fs.appendFileSync(path.join(hiveDir, 'audit-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

test('pollHiveOnce generates a wiki entry for a discovery trigger and appends it to wiki-log.jsonl', () => {
  const hiveDir = makeHiveDir();
  appendAudit(hiveDir, { event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } });

  const dispatchFn = () => ({ verdict: 'ok', response: 'The colony unearths its first clay deposit.', model: 'test-model' });
  const summary = pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });

  assert.equal(summary.generated, 1);
  const wikiEntries = fs.readFileSync(path.join(hiveDir, 'wiki-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(wikiEntries.length, 1);
  assert.equal(wikiEntries[0].subject, 'clay');
});

test('pollHiveOnce checkpoint prevents the same audit lines from being re-processed on the next poll', () => {
  const hiveDir = makeHiveDir();
  appendAudit(hiveDir, { event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } });

  const dispatchFn = () => ({ verdict: 'ok', response: 'Clay is found.', model: 'test-model' });
  pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });

  // No new audit lines appended -- second poll should detect zero new triggers.
  const summary2 = pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });
  assert.equal(summary2.new_audit_entries, 0);
  assert.equal(summary2.triggers_detected, 0);
});

test('pollHiveOnce retries a failed generation on the next poll rather than dropping it', () => {
  const hiveDir = makeHiveDir();
  appendAudit(hiveDir, { event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } });

  let callCount = 0;
  const dispatchFn = () => {
    callCount += 1;
    if (callCount === 1) return { verdict: 'timeout', error: 'Orwell unreachable' };
    return { verdict: 'ok', response: 'Clay is found, eventually.', model: 'test-model' };
  };

  const summary1 = pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });
  assert.equal(summary1.retrying, 1);
  assert.equal(summary1.generated, 0);
  assert.ok(!fs.existsSync(path.join(hiveDir, 'wiki-log.jsonl')));

  const checkpointAfter1 = readCheckpoint(path.join(hiveDir, 'wiki-checkpoint.json'));
  assert.equal(checkpointAfter1.pending_retries.length, 1);

  // Second poll -- no new audit entries, but the retry queue should still be attempted.
  const summary2 = pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });
  assert.equal(summary2.generated, 1);
  const wikiEntries = fs.readFileSync(path.join(hiveDir, 'wiki-log.jsonl'), 'utf8').trim().split('\n');
  assert.equal(wikiEntries.length, 1);
});

test('pollHiveOnce gives up after max-retries and logs a permanent failure without crashing', () => {
  const hiveDir = makeHiveDir();
  appendAudit(hiveDir, { event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } });

  const dispatchFn = () => ({ verdict: 'error', error: 'model unavailable' });

  let lastSummary;
  for (let i = 0; i < 5; i++) {
    lastSummary = pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn, maxRetries: 3 } });
  }
  assert.equal(lastSummary.failed_permanently >= 0, true);
  const failuresPath = path.join(hiveDir, 'wiki-generation-failures.jsonl');
  assert.ok(fs.existsSync(failuresPath));
  const failures = fs.readFileSync(failuresPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(failures.length >= 1);
  assert.equal(failures[0].trigger.subject, 'clay');

  const checkpointFinal = readCheckpoint(path.join(hiveDir, 'wiki-checkpoint.json'));
  assert.equal(checkpointFinal.pending_retries.length, 0); // no longer retried after giving up
});

test('pollHiveOnce queues milestone-tier triggers separately and never dispatches them', () => {
  const hiveDir = makeHiveDir();
  for (let i = 0; i < 5; i++) {
    appendAudit(hiveDir, { event: 'tick', verb: 'build', applied: true });
  }
  let dispatchCalled = false;
  const dispatchFn = () => { dispatchCalled = true; return { verdict: 'ok', response: 'A structure rises.' }; };

  const summary = pollHiveOnce({
    hiveId: 'hive-a', hiveDir, worldStatePath: null,
    opts: { dispatchFn, structureMilestoneCounts: [5] }
  });

  assert.equal(summary.milestones_queued, 1);
  const milestoneQueue = fs.readFileSync(path.join(hiveDir, 'pending-milestone-narration.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(milestoneQueue.length, 1);
  assert.equal(milestoneQueue[0].subject, '5th-structure');
  // 5 routine 'structure' triggers WERE dispatched (structure entries are
  // routine-tier); only the milestone-tier one must never be auto-dispatched.
  // We confirm the milestone queue entry itself was never passed to generateEntry
  // by checking it never appears in wiki-log.jsonl's subjects.
  const wikiEntries = fs.readFileSync(path.join(hiveDir, 'wiki-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(!wikiEntries.some((e) => e.subject === '5th-structure'));
  assert.ok(dispatchCalled);
});

// codex distinct review (2026-07-17), non-blocking finding: the wiki
// append and the checkpoint write are two separate file operations -- a
// crash between them (simulated here by writing a checkpoint whose
// last_line_count already reflects the audit line but whose wiki-log is
// missing the entry) would otherwise cause the SAME trigger to regenerate
// and duplicate on the next poll. The dispatch_key dedup guard should
// prevent that duplicate even though the checkpoint's dedup state
// (discovered_subjects) no longer reflects it needing generation.

test('pollHiveOnce never appends a duplicate wiki entry for a trigger it already generated, even across a simulated crash-restart', () => {
  const hiveDir = makeHiveDir();
  appendAudit(hiveDir, { event: 'tick', verb: 'gather', applied: true, stockpile_credit: { resourceKey: 'clay', amount: 1 } });

  const dispatchFn = () => ({ verdict: 'ok', response: 'Clay is found.', model: 'test-model' });
  pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });

  // Simulate a crash-restart: reset the checkpoint's last_line_count back to
  // 0 (as if the checkpoint write never happened) so the SAME audit line is
  // reprocessed as "new" on the next poll -- the discovered_subjects state
  // still correctly blocks a fresh discovery TRIGGER, so instead simulate
  // the more dangerous case directly: force the same trigger back into the
  // retry queue as if it were still pending from before the crash.
  const originalAuditEntry = fs.readFileSync(path.join(hiveDir, 'audit-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))[0];
  const checkpointPath = path.join(hiveDir, 'wiki-checkpoint.json');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  // Same ts as the ORIGINAL audit entry -- triggerKey() is keyed on
  // hive:entry_type:subject:ts, so this reproduces the exact same trigger
  // identity a crash-restart replay would produce, not a coincidentally
  // similar one.
  checkpoint.pending_retries = [{
    ts: originalAuditEntry.ts, hive: 'hive-a', entry_type: 'discovery', subject: 'clay', tier: 'routine',
    source_event: originalAuditEntry
  }];
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));

  pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath: null, opts: { dispatchFn } });

  const wikiEntries = fs.readFileSync(path.join(hiveDir, 'wiki-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(wikiEntries.length, 1, 'expected the dispatch_key dedup guard to prevent a duplicate append');
});

test('discoverHiveDirs finds hive subdirectories but excludes the shared directory', () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-watch-sandbox-'));
  fs.mkdirSync(path.join(sandboxRoot, 'hive-a'));
  fs.mkdirSync(path.join(sandboxRoot, 'hive-b'));
  fs.mkdirSync(path.join(sandboxRoot, 'shared'));
  const dirs = discoverHiveDirs(sandboxRoot);
  const ids = dirs.map((d) => d.hiveId).sort();
  assert.deepEqual(ids, ['hive-a', 'hive-b']);
});

test('pollHiveOnce reads the world-state snapshot read-only and never writes to it', () => {
  const hiveDir = makeHiveDir();
  const sandboxRoot = path.dirname(hiveDir);
  const worldStatePath = path.join(sandboxRoot, 'world-state.json');
  const snapshot = { prey_population: 1, predator_population: 1, written_at: new Date().toISOString(), complete: true };
  fs.writeFileSync(worldStatePath, JSON.stringify(snapshot));
  const before = fs.readFileSync(worldStatePath, 'utf8');

  const dispatchFn = () => ({ verdict: 'ok', response: 'nothing to see' });
  pollHiveOnce({ hiveId: 'hive-a', hiveDir, worldStatePath, opts: { dispatchFn, maxPrey: 200, maxPredators: 40 } });

  const after = fs.readFileSync(worldStatePath, 'utf8');
  assert.equal(before, after);
});
