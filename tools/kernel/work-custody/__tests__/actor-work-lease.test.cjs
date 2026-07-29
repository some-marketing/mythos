'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const lease = require('../actor-work-lease.cjs');

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-work-lease-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function actor(invocation, provenance = {}) { return { invocation_id: invocation, session_id: `session-${invocation}`, provenance }; }
function token(result) { return { lease_id: result.state.current_lease.lease_id, epoch: result.state.epoch }; }
function ledger(root) { return fs.readFileSync(lease.ledgerPath(root), 'utf8').trim().split('\n').map(JSON.parse); }

test('simultaneous conflicting claims admit exactly one actor and record the denial', async (t) => {
  const root = sandbox(t);
  const modulePath = require.resolve('../actor-work-lease.cjs');
  const gate = new SharedArrayBuffer(4);
  const run = (id) => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const lease = require(workerData.modulePath);
      const view = new Int32Array(workerData.gate);
      Atomics.add(view, 0, 1);
      Atomics.notify(view, 0);
      Atomics.wait(view, 0, 1);
      const actor = { invocation_id: workerData.id, session_id: 'session-' + workerData.id, provenance: {} };
      parentPort.postMessage(lease.claim(workerData.root, { work_unit_id: 'unit-a', bounded_artifacts: ['tools/a.js'], actor }));
    `, { eval: true, workerData: { root, id, modulePath, gate } });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  const pending = [run('claude'), run('codex')];
  const view = new Int32Array(gate);
  while (Atomics.load(view, 0) < 2) await new Promise((resolve) => setTimeout(resolve, 1));
  Atomics.notify(view, 0, 2);
  const [a, b] = await Promise.all(pending);
  assert.equal([a, b].filter((result) => result.ok).length, 1);
  assert.equal([a, b].filter((result) => !result.ok).length, 1);
  assert.ok(ledger(root).some((row) => row.to === 'conflicting'));
});

test('overlapping artifacts conflict while non-overlapping work units coexist', (t) => {
  const root = sandbox(t);
  assert.equal(lease.claim(root, { work_unit_id: 'a', bounded_artifacts: ['one'], actor: actor('a') }).ok, true);
  assert.equal(lease.claim(root, { work_unit_id: 'b', bounded_artifacts: ['one'], actor: actor('b') }).ok, false);
  assert.equal(lease.claim(root, { work_unit_id: 'c', bounded_artifacts: ['two'], actor: actor('c') }).ok, true);
});

test('heartbeat retains a lease and a missed heartbeat expires it', (t) => {
  const root = sandbox(t);
  let clock = Date.parse('2026-07-17T12:00:00Z');
  const options = { now: () => clock };
  const claimed = lease.claim(root, { work_unit_id: 'heartbeat', bounded_artifacts: ['one'], actor: actor('a'), ttl_ms: 100 }, options);
  clock += 50;
  const beat = lease.heartbeat(root, { work_unit_id: 'heartbeat', actor: actor('a'), ...token(claimed), ttl_ms: 100 }, options);
  clock += 75;
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'heartbeat', actor: actor('a'), ...token(beat) }, options).ok, true);
  clock += 30;
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'heartbeat', actor: actor('a'), ...token(beat) }, options).reason, 'lease-expired');
  assert.equal(lease.readState(root, 'heartbeat').state.status, 'expired');
});

test('completion releases custody and cross-model, provider, and agent takeover is portable', (t) => {
  const root = sandbox(t);
  const producer = actor('producer', { model: 'claude-fable-5', provider: 'anthropic', harness: 'claude', agent: 'parent' });
  const first = lease.claim(root, { work_unit_id: 'portable', bounded_artifacts: ['one'], actor: producer });
  assert.equal(lease.complete(root, { work_unit_id: 'portable', actor: producer, ...token(first) }).ok, true);
  const takeover = lease.claim(root, { work_unit_id: 'portable', bounded_artifacts: ['one'], actor: actor('child', { model: 'gemini-3-pro-preview', provider: 'google', harness: 'bridge', agent: 'subagent' }) });
  assert.equal(takeover.ok, true);
  assert.equal(takeover.state.epoch, first.state.epoch + 1);
  assert.equal(takeover.state.current_lease.actor.invocation_id, 'child');
  assert.equal(lease.complete(root, { work_unit_id: 'portable', actor: takeover.state.current_lease.actor, ...token(takeover) }).ok, true);
  const third = lease.claim(root, { work_unit_id: 'portable', bounded_artifacts: ['one'], actor: actor('third', { model: 'gpt-5', provider: 'openai', harness: 'codex', agent: 'independent-worker' }) });
  assert.equal(third.ok, true);
  assert.equal(third.state.current_lease.actor.provenance.provider, 'openai');
});

test('explicit handoff transfers custody with lineage and invalidates the parent lease', (t) => {
  const root = sandbox(t);
  const parent = actor('parent', { agent: 'coordinator' });
  const child = actor('child', { agent: 'subagent' });
  const first = lease.claim(root, { work_unit_id: 'handoff', bounded_artifacts: ['one'], actor: parent });
  const moved = lease.handoff(root, { work_unit_id: 'handoff', actor: parent, to_actor: child, ...token(first) });
  assert.equal(moved.ok, true);
  assert.equal(moved.state.current_lease.actor.invocation_id, 'child');
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'handoff', actor: parent, ...token(first) }).ok, false);
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'handoff', actor: child, ...token(moved) }).ok, true);
  assert.ok(ledger(root).some((row) => row.to === 'handed_off' && row.from_actor.invocation_id === 'parent' && row.to_actor.invocation_id === 'child'));
});

test('actor crash permits deterministic reclamation and stale writes fail after epoch advance', (t) => {
  const root = sandbox(t);
  let clock = 1_800_000_000_000;
  const options = { now: () => clock };
  const crashed = lease.claim(root, { work_unit_id: 'crash', bounded_artifacts: ['one'], actor: actor('crashed'), ttl_ms: 10 }, options);
  clock += 11;
  const reclaimed = lease.claim(root, { work_unit_id: 'crash', bounded_artifacts: ['one'], actor: actor('reclaimer'), ttl_ms: 10 }, options);
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.state.epoch, crashed.state.epoch + 1);
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'crash', actor: actor('crashed'), ...token(crashed) }, options).ok, false);
  assert.ok(ledger(root).some((row) => row.to === 'reclaimed'));
});

test('missing and corrupt state fail closed for writes but corrupt state is explicitly reclaimable', (t) => {
  const root = sandbox(t);
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'missing', actor: actor('a'), lease_id: 'x', epoch: 1 }).reason, 'missing-state');
  const target = lease.leasePath(root, 'corrupt');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{bad');
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'corrupt', actor: actor('a'), lease_id: 'x', epoch: 1 }).reason, 'corrupt-state');
  const recovered = lease.reclaimCorrupt(root, { work_unit_id: 'corrupt', bounded_artifacts: ['one'], actor: actor('recovery') });
  assert.equal(recovered.ok, true);
  assert.equal(lease.authorizeWrite(root, { work_unit_id: 'corrupt', actor: actor('recovery'), ...token(recovered) }).ok, true);
});

test('abandonment releases work and replayed reclamation remains idempotently exclusive', (t) => {
  const root = sandbox(t);
  const first = lease.claim(root, { work_unit_id: 'replay', bounded_artifacts: ['one'], actor: actor('a') });
  assert.equal(lease.abandon(root, { work_unit_id: 'replay', actor: actor('a'), ...token(first) }).ok, true);
  const next = lease.claim(root, { work_unit_id: 'replay', bounded_artifacts: ['one'], actor: actor('b') });
  const replay = lease.claim(root, { work_unit_id: 'replay', bounded_artifacts: ['one'], actor: actor('b') });
  assert.equal(next.ok, true);
  assert.equal(replay.ok, false);
  assert.equal(lease.readState(root, 'replay').state.epoch, next.state.epoch);
});

test('every declared state is represented by validation or durable transition receipts', (t) => {
  const root = sandbox(t);
  const first = lease.claim(root, { work_unit_id: 'states', bounded_artifacts: ['one'], actor: actor('a') });
  lease.handoff(root, { work_unit_id: 'states', actor: actor('a'), to_actor: actor('b'), ...token(first) });
  const observed = new Set(ledger(root).flatMap((row) => [row.from, row.to]).filter(Boolean));
  for (const state of ['available', 'active', 'handed_off', 'conflicting', 'reclaimed', 'expired', 'abandoned', 'completed']) {
    assert.ok(lease.STATES.includes(state));
  }
  assert.ok(observed.has('available') && observed.has('active') && observed.has('handed_off'));
});
