'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../enforcement-home-registry.cjs');
const soak = require('../debrief-soak-runner.cjs');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-soak-runner-'));
  registry.initializeRegistry(root, { now: '2026-07-15T12:00:00.000Z' });
  return root;
}

test('worker claims are fenced by worker id and pid', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = soak.paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.workerState, JSON.stringify({
    schema: 'DebriefCloseSoakWorker/1.0',
    worker_id: 'current-worker',
    pid: 42,
    launched_at: '2026-07-17T12:00:00.000Z',
    interval_ms: 3600000,
    log: '_dev/state/debrief-closeout/soak/p4-s3-worker.log'
  }));
  assert.equal(soak.workerClaimIsCurrent(root, 'current-worker', 42), true);
  assert.equal(soak.workerClaimIsCurrent(root, 'stale-worker', 42), false);
  assert.equal(soak.workerClaimIsCurrent(root, 'current-worker', 41), false);
});

test('soak records paired production-interface events with every workload family represented', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  soak.startSoak(root, { now: '2026-07-15T12:00:00.000Z' });
  for (let index = 0; index < soak.FAMILIES.length; index += 1) {
    soak.recordSample(root, { family: soak.FAMILIES[index], now: `2026-07-15T1${index}:00:00.000Z` });
  }
  const status = soak.status(root, { now: '2026-07-15T20:00:00.000Z' });
  assert.equal(status.event_count, 7);
  assert.equal(status.unexplained_mismatch_count, 0);
  assert.deepEqual(status.missing_families, []);
  assert.equal(status.ready, false, 'count and elapsed-time gates remain independent');
});

test('finish requires 25 pairs, 24 elapsed hours, all families, and zero unexplained mismatches', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  soak.startSoak(root, { now: '2026-07-15T12:00:00.000Z' });
  for (let index = 0; index < 25; index += 1) {
    soak.recordSample(root, { family: soak.FAMILIES[index % soak.FAMILIES.length], now: `2026-07-16T${String(index % 12).padStart(2, '0')}:00:00.000Z` });
  }
  const before = soak.status(root, { now: '2026-07-16T11:59:59.000Z' });
  assert.equal(before.ready, false);
  const complete = soak.finishSoak(root, { now: '2026-07-16T12:00:01.000Z' });
  assert.equal(complete.ready, true);
  assert.equal(complete.event_count, 25);
  assert.equal(fs.existsSync(soak.paths(root).receiptJson), true);
  assert.equal(fs.existsSync(soak.paths(root).receiptMd), true);
});
