// tools/sessions/lib/__tests__/active-session-registry.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const registry = require('../active-session-registry');

function withTempRegistry(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-registry-'));
  registry.setDataDir(dataDir);
  t.after(() => {
    registry.resetDataDir();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return dataDir;
}

function writeSession(dataDir, session) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, `${session.session_id}.json`),
    `${JSON.stringify(session, null, 2)}\n`
  );
}

function writeTtlPolicy(dataDir, policy) {
  fs.writeFileSync(
    path.join(dataDir, '_ttl-policy.json'),
    `${JSON.stringify(policy, null, 2)}\n`
  );
}

test('register creates file with required fields', (t) => {
  const dataDir = withTempRegistry(t);
  const session = registry.registerSession({
    sessionId: 'session-a',
    workingSurface: ['frameworks/meta'],
    now: '2026-04-27T12:00:00.000Z'
  });

  assert.equal(session.session_id, 'session-a');
  assert.equal(session.status, 'active');
  assert.equal(session.started_at, '2026-04-27T12:00:00.000Z');
  assert.equal(session.last_heartbeat, '2026-04-27T12:00:00.000Z');
  assert.deepEqual(session.working_surface, ['frameworks/meta']);
  assert.equal(typeof session.pid, 'number');
  assert.ok(fs.existsSync(path.join(dataDir, 'session-a.json')));
});

test('register is idempotent and refreshes heartbeat', (t) => {
  withTempRegistry(t);
  registry.registerSession({
    sessionId: 'session-a',
    workingSurface: ['one'],
    now: '2026-04-27T12:00:00.000Z'
  });

  const refreshed = registry.registerSession({
    sessionId: 'session-a',
    workingSurface: ['two'],
    now: '2026-04-27T12:01:00.000Z'
  });

  assert.equal(refreshed.started_at, '2026-04-27T12:00:00.000Z');
  assert.equal(refreshed.last_heartbeat, '2026-04-27T12:01:00.000Z');
  assert.deepEqual(refreshed.working_surface, ['two']);
});

test('register recovers from partial session file', (t) => {
  const dataDir = withTempRegistry(t);
  fs.writeFileSync(path.join(dataDir, 'session-a.json'), '{"session_id":');

  const session = registry.registerSession({
    sessionId: 'session-a',
    workingSurface: ['/recovered'],
    now: '2026-04-27T12:00:00.000Z'
  });

  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'session-a.json'), 'utf8'));
  assert.equal(session.session_id, 'session-a');
  assert.equal(stored.session_id, 'session-a');
  assert.deepEqual(stored.working_surface, ['/recovered']);
});

test('register updates mutable fields and preserves immutable fields', (t) => {
  withTempRegistry(t);
  const original = registry.registerSession({
    sessionId: 'session-x',
    workingSurface: '/a',
    now: '2026-04-27T12:00:00.000Z'
  });

  const refreshed = registry.registerSession({
    sessionId: 'session-x',
    workingSurface: '/b',
    now: '2026-04-27T12:05:00.000Z'
  });

  assert.equal(refreshed.session_id, 'session-x');
  assert.equal(refreshed.started_at, original.started_at);
  assert.equal(refreshed.pid, original.pid);
  assert.equal(refreshed.last_heartbeat, '2026-04-27T12:05:00.000Z');
  assert.deepEqual(refreshed.working_surface, ['/b']);
});

test('register stores new optional session fields', (t) => {
  withTempRegistry(t);
  const session = registry.registerSession({
    sessionId: 'session-fields',
    actorId: 'claude-opus-4-7',
    currentBranch: 'feat/x',
    sessionType: 'claude-opus-4-7',
    now: '2026-04-27T12:00:00.000Z'
  });

  assert.equal(session.actor_id, 'claude-opus-4-7');
  assert.equal(session.current_branch, 'feat/x');
  assert.equal(session.session_type, 'claude-opus-4-7');
});

test('heartbeat fails on missing session', (t) => {
  withTempRegistry(t);
  assert.throws(
    () => registry.heartbeat('missing-session'),
    /active session not found: missing-session/
  );
});

test('close moves file to closed directory', (t) => {
  const dataDir = withTempRegistry(t);
  registry.registerSession({
    sessionId: 'session-a',
    now: '2026-04-27T12:00:00.000Z'
  });

  const closed = registry.closeSession('session-a', {
    now: '2026-04-27T12:02:00.000Z'
  });

  assert.equal(closed.status, 'closed');
  assert.equal(closed.closed_at, '2026-04-27T12:02:00.000Z');
  assert.equal(fs.existsSync(path.join(dataDir, 'session-a.json')), false);
  assert.ok(fs.existsSync(path.join(dataDir, 'closed', 'session-a.json')));
});

test('listActive filters by maxAgeMs', (t) => {
  withTempRegistry(t);
  registry.registerSession({
    sessionId: 'fresh',
    now: '2026-04-27T12:00:00.000Z'
  });
  registry.registerSession({
    sessionId: 'stale',
    now: '2026-04-27T11:00:00.000Z'
  });

  const active = registry.listActive({
    maxAgeMs: 10 * 60 * 1000,
    now: '2026-04-27T12:05:00.000Z'
  });

  assert.deepEqual(active.map((session) => session.session_id), ['fresh']);
});

test('listActive skips malformed session files', (t) => {
  const dataDir = withTempRegistry(t);
  registry.registerSession({
    sessionId: 'valid-a',
    now: '2026-04-27T12:00:00.000Z'
  });
  registry.registerSession({
    sessionId: 'valid-b',
    now: '2026-04-27T12:00:00.000Z'
  });
  fs.writeFileSync(path.join(dataDir, 'malformed.json'), 'not valid json');

  const active = registry.listActive({
    now: '2026-04-27T12:01:00.000Z'
  });

  assert.deepEqual(active.map((session) => session.session_id), ['valid-a', 'valid-b']);
  assert.ok(Array.isArray(active._malformed_diagnostics));
  assert.equal(active._malformed_diagnostics.length, 1);
  assert.equal(active._malformed_diagnostics[0].file, path.join(dataDir, 'malformed.json'));
});

test('listActive filters by actor_type TTL policy', (t) => {
  const dataDir = withTempRegistry(t);
  writeTtlPolicy(dataDir, {
    default_ttl_ms: 1800000,
    policies: {
      'ci-shortjob': { ttl_ms: 600000 }
    }
  });

  writeSession(dataDir, {
    session_id: 'claude',
    status: 'active',
    started_at: '2026-04-27T11:50:00.000Z',
    last_heartbeat: '2026-04-27T11:50:00.000Z',
    actor_type: 'claude-opus-4-7',
    working_surface: [],
    pid: 100
  });
  writeSession(dataDir, {
    session_id: 'ci',
    status: 'active',
    started_at: '2026-04-27T11:48:00.000Z',
    last_heartbeat: '2026-04-27T11:48:00.000Z',
    actor_type: 'ci-shortjob',
    working_surface: [],
    pid: 101
  });
  writeSession(dataDir, {
    session_id: 'unknown',
    status: 'active',
    started_at: '2026-04-27T11:50:00.000Z',
    last_heartbeat: '2026-04-27T11:50:00.000Z',
    actor_type: 'unknown-class',
    working_surface: [],
    pid: 102
  });

  const active = registry.listActive({
    now: '2026-04-27T12:00:00.000Z'
  });

  assert.deepEqual(active.map((session) => session.session_id), ['claude', 'unknown']);
});

test('register stores computed TTL for scheduled jobs', (t) => {
  const dataDir = withTempRegistry(t);
  writeTtlPolicy(dataDir, {
    default_ttl_ms: 1800000,
    policies: {
      'scheduled-job': {
        ttl_ms: null,
        ttl_strategy: 'compute_at_register'
      }
    }
  });

  const session = registry.registerSession({
    sessionId: 'scheduled',
    actorType: 'scheduled-job',
    expectedIntervalMs: 600000,
    now: '2026-04-27T12:00:00.000Z'
  });

  assert.equal(session.actor_type, 'scheduled-job');
  assert.equal(session.expected_interval_ms, 600000);
  assert.equal(session.ttl_ms, 1200000);
});

test('sweepExpired moves stale sessions to closed/ when archive=true', (t) => {
  const dataDir = withTempRegistry(t);
  registry.registerSession({
    sessionId: 'stale',
    now: '2026-04-27T11:00:00.000Z'
  });

  const result = registry.sweepExpired({
    now: '2026-04-27T12:00:00.000Z',
    archive: true,
    maxAgeMs: 10 * 60 * 1000
  });

  assert.deepEqual(result, {
    swept: [{ session_id: 'stale', reason: 'ttl-expired' }],
    errors: [],
    sweptDirs: []
  });
  assert.equal(fs.existsSync(path.join(dataDir, 'stale.json')), false);
  assert.ok(fs.existsSync(path.join(dataDir, 'closed', 'stale.json')));

  const closed = JSON.parse(fs.readFileSync(path.join(dataDir, 'closed', 'stale.json'), 'utf8'));
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closed_at, '2026-04-27T12:00:00.000Z');
  assert.equal(closed.close_reason, 'ttl-expired');
});

test('sweepExpired deletes stale session files when archive=false', (t) => {
  const dataDir = withTempRegistry(t);
  registry.registerSession({
    sessionId: 'stale',
    now: '2026-04-27T11:00:00.000Z'
  });

  const result = registry.sweepExpired({
    now: '2026-04-27T12:00:00.000Z',
    archive: false,
    maxAgeMs: 10 * 60 * 1000
  });

  assert.deepEqual(result, {
    swept: [{ session_id: 'stale', reason: 'ttl-expired' }],
    errors: [],
    sweptDirs: []
  });
  assert.equal(fs.existsSync(path.join(dataDir, 'stale.json')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'closed', 'stale.json')), false);
});

test('sweepExpired skips fresh sessions', (t) => {
  const dataDir = withTempRegistry(t);
  registry.registerSession({
    sessionId: 'fresh',
    now: '2026-04-27T11:55:00.000Z'
  });

  const result = registry.sweepExpired({
    now: '2026-04-27T12:00:00.000Z',
    archive: true,
    maxAgeMs: 10 * 60 * 1000
  });

  assert.deepEqual(result, { swept: [], errors: [], sweptDirs: [] });
  assert.ok(fs.existsSync(path.join(dataDir, 'fresh.json')));
  assert.equal(fs.existsSync(path.join(dataDir, 'closed', 'fresh.json')), false);
});

test('listActive with options.sweepExpired=true cleans before listing', (t) => {
  const dataDir = withTempRegistry(t);
  registry.registerSession({
    sessionId: 'fresh',
    now: '2026-04-27T11:55:00.000Z'
  });
  registry.registerSession({
    sessionId: 'stale',
    now: '2026-04-27T11:00:00.000Z'
  });

  const active = registry.listActive({
    now: '2026-04-27T12:00:00.000Z',
    maxAgeMs: 10 * 60 * 1000,
    sweepExpired: true
  });

  assert.deepEqual(active.map((session) => session.session_id), ['fresh']);
  assert.equal(fs.existsSync(path.join(dataDir, 'stale.json')), false);
  assert.ok(fs.existsSync(path.join(dataDir, 'closed', 'stale.json')));
});

test('registerSession persists new compound actor_id', (t) => {
  withTempRegistry(t);
  const session = registry.registerSession({
    sessionId: 'compound',
    actorId: 'claude-opus-4-7:kerneling-rupert',
    actorType: 'claude-opus-4-7',
    currentBranch: 'coordination-dispatcher',
    expectedIntervalMs: 180000,
    now: '2026-04-27T12:00:00.000Z'
  });

  assert.equal(session.actor_id, 'claude-opus-4-7:kerneling-rupert');
  assert.equal(session.actor_type, 'claude-opus-4-7');
  assert.equal(session.current_branch, 'coordination-dispatcher');
  assert.equal(session.expected_interval_ms, 180000);
});

test('registerSession preserves immutable session_id + started_at on re-register with new actor_id', (t) => {
  withTempRegistry(t);
  const original = registry.registerSession({
    sessionId: 'session-a',
    actorId: 'claude-opus-4-7',
    now: '2026-04-27T12:00:00.000Z'
  });

  const refreshed = registry.registerSession({
    sessionId: 'session-a',
    actorId: 'claude-opus-4-7:kerneling-rupert',
    now: '2026-04-27T12:10:00.000Z'
  });

  assert.equal(refreshed.session_id, original.session_id);
  assert.equal(refreshed.started_at, original.started_at);
  assert.equal(refreshed.actor_id, 'claude-opus-4-7:kerneling-rupert');
  assert.equal(refreshed.last_heartbeat, '2026-04-27T12:10:00.000Z');
});

test('registerSession on re-register preserves original actor_id when caller passes nothing', (t) => {
  withTempRegistry(t);
  registry.registerSession({
    sessionId: 'session-a',
    actorId: 'claude-opus-4-7:kerneling-rupert',
    now: '2026-04-27T12:00:00.000Z'
  });

  const refreshed = registry.registerSession({
    sessionId: 'session-a',
    now: '2026-04-27T12:10:00.000Z'
  });

  assert.equal(refreshed.actor_id, 'claude-opus-4-7:kerneling-rupert');
  assert.equal(refreshed.last_heartbeat, '2026-04-27T12:10:00.000Z');
});

test('findByWorkingSurface matches substring', (t) => {
  withTempRegistry(t);
  registry.registerSession({
    sessionId: 'matching',
    workingSurface: ['frameworks/meta/execution-normalization'],
    now: '2026-04-27T12:00:00.000Z'
  });
  registry.registerSession({
    sessionId: 'other',
    workingSurface: ['clients/acme/project'],
    now: '2026-04-27T12:00:00.000Z'
  });

  const matches = registry.findByWorkingSurface('execution-normalization', {
    now: '2026-04-27T12:01:00.000Z'
  });

  assert.deepEqual(matches.map((session) => session.session_id), ['matching']);
});

// ── Orphan write-ledger directory sweep ──────────────────────────────────────────
// Regression: <id>/write_log.json dirs (from the write-ledger hook) were never
// swept, so the custody gate read dead sessions' ledgers as foreign-owning →
// permanent false foreign-blocks. sweepExpired now also sweeps orphaned dirs.
function writeLedgerDir(dataDir, id, updatedAt) {
  const dir = path.join(dataDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'write_log.json'),
    `${JSON.stringify({ session_id: id, paths: [{ path: 'x' }], updated_at: updatedAt }, null, 2)}\n`
  );
  // Age the directory mtime to match updated_at. The sweep uses the MOST RECENT
  // of (updated_at, dir mtime), so a real stale orphan must be stale on BOTH;
  // a freshly-created dir (fresh mtime) is intentionally NOT swept.
  const t = new Date(updatedAt);
  fs.utimesSync(dir, t, t);
  return dir;
}

test('sweepExpired removes stale orphan ledger dirs and archives them', (t) => {
  const dataDir = withTempRegistry(t);
  const now = '2026-04-27T12:00:00.000Z';
  const staleAt = '2026-04-27T11:00:00.000Z'; // 1h old, > default 10m TTL
  writeLedgerDir(dataDir, 'orphan-stale', staleAt);

  const result = registry.sweepExpired({ now });

  assert.equal(fs.existsSync(path.join(dataDir, 'orphan-stale')), false, 'stale orphan removed');
  assert.equal(
    fs.existsSync(path.join(dataDir, 'closed', 'orphan-stale', 'write_log.json')),
    true,
    'stale orphan archived to closed/'
  );
  assert.deepEqual(result.sweptDirs.map((s) => s.session_id), ['orphan-stale']);
});

test('sweepExpired keeps fresh orphan dirs and dirs with a live record', (t) => {
  const dataDir = withTempRegistry(t);
  const now = '2026-04-27T12:00:00.000Z';
  // fresh orphan (updated_at == now) must survive
  writeLedgerDir(dataDir, 'orphan-fresh', now);
  // stale ledger dir but a LIVE <id>.json record exists → must survive
  writeLedgerDir(dataDir, 'has-live-record', '2026-04-27T11:00:00.000Z');
  writeSession(dataDir, { session_id: 'has-live-record', status: 'active', last_heartbeat: now });

  const result = registry.sweepExpired({ now });

  assert.equal(fs.existsSync(path.join(dataDir, 'orphan-fresh')), true, 'fresh orphan survives');
  assert.equal(fs.existsSync(path.join(dataDir, 'has-live-record')), true, 'dir with live record survives');
  assert.deepEqual(result.sweptDirs, []);
});

test('sweepExpired does NOT sweep a registration-gap dir (old updated_at, fresh mtime)', (t) => {
  const dataDir = withTempRegistry(t);
  const now = '2026-04-27T12:00:00.000Z';
  const dir = path.join(dataDir, 'reg-gap');
  fs.mkdirSync(dir, { recursive: true });
  // Old updated_at (e.g. copied/restored ledger) but the dir was just created.
  fs.writeFileSync(
    path.join(dir, 'write_log.json'),
    `${JSON.stringify({ session_id: 'reg-gap', paths: [], updated_at: '2026-04-27T11:00:00.000Z' }, null, 2)}\n`
  );
  // NOTE: deliberately do NOT age the dir mtime — it is fresh (just created).

  const result = registry.sweepExpired({ now });

  assert.equal(fs.existsSync(dir), true, 'fresh dir with old updated_at must survive (registration-gap safety)');
  assert.deepEqual(result.sweptDirs, []);
});

test('sweepExpired does NOT sweep a dir whose ledger session_id mismatches the dir name', (t) => {
  const dataDir = withTempRegistry(t);
  const now = '2026-04-27T12:00:00.000Z';
  const staleAt = '2026-04-27T11:00:00.000Z';
  const dir = path.join(dataDir, 'dir-name-x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'write_log.json'),
    `${JSON.stringify({ session_id: 'different-id', paths: [], updated_at: staleAt }, null, 2)}\n`
  );
  const t2 = new Date(staleAt);
  fs.utimesSync(dir, t2, t2);

  const result = registry.sweepExpired({ now });

  assert.equal(fs.existsSync(dir), true, 'mismatched-session_id dir must not be swept');
  assert.deepEqual(result.sweptDirs, []);
});

test('setCurrentSessionId grounds the machine-wide _current-id sidecar', (t) => {
  const dataDir = withTempRegistry(t);
  registry.setCurrentSessionId('session-alpha');
  assert.equal(registry.getCurrentSessionId(), 'session-alpha');
  const sidecar = path.join(dataDir, '_current-id');
  assert.ok(fs.existsSync(sidecar), '_current-id sidecar written');
  assert.equal(fs.readFileSync(sidecar, 'utf8').trim(), 'session-alpha');
  // idempotent overwrite
  registry.setCurrentSessionId('session-beta');
  assert.equal(registry.getCurrentSessionId(), 'session-beta');
});

test('setCurrentSessionId refuses an empty/absent session id', (t) => {
  withTempRegistry(t);
  assert.throws(() => registry.setCurrentSessionId(''), /sessionId is required/);
  assert.throws(() => registry.setCurrentSessionId(null), /sessionId is required/);
});

test('adoptSessionCustody merges prior write-log paths with adopted_from provenance', (t) => {
  const dataDir = withTempRegistry(t);
  const prior = 'prior-session-1';
  const current = 'current-session-2';
  const priorDir = path.join(dataDir, prior);
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, 'write_log.json'),
    `${JSON.stringify({ session_id: prior, paths: [
      { path: '_dev/reports/analysis/foo.md', at: '2026-08-03T00:00:00.000Z', tool: 'Write' },
      { path: 'tools/something.cjs', at: '2026-08-03T00:00:00.000Z', tool: 'Edit' }
    ] }, null, 2)}\n`
  );

  const res = registry.adoptSessionCustody({ fromSessionId: prior, toSessionId: current, now: '2026-08-03T12:00:00.000Z' });
  assert.equal(res.adopted, true);
  assert.equal(res.adopted_count, 2);
  assert.deepEqual(res.paths.sort(), ['_dev/reports/analysis/foo.md', 'tools/something.cjs']);

  const log = JSON.parse(fs.readFileSync(path.join(dataDir, current, 'write_log.json'), 'utf8'));
  assert.equal(log.paths.length, 2);
  assert.ok(log.paths.every((e) => e.adopted_from === prior), 'every merged entry carries adopted_from provenance');
  assert.ok(log.paths.every((e) => e.at === '2026-08-03T12:00:00.000Z'), 'entries stamped with adoption time');
});

test('adoptSessionCustody is idempotent — re-adoption adds nothing', (t) => {
  const dataDir = withTempRegistry(t);
  const prior = 'prior-dup';
  const current = 'current-dup';
  const priorDir = path.join(dataDir, prior);
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, 'write_log.json'),
    `${JSON.stringify({ session_id: prior, paths: [
      { path: 'a.txt', at: 'x', tool: 'Write' }
    ] }, null, 2)}\n`
  );
  registry.adoptSessionCustody({ fromSessionId: prior, toSessionId: current });
  const res = registry.adoptSessionCustody({ fromSessionId: prior, toSessionId: current });
  assert.equal(res.adopted, false);
  assert.equal(res.adopted_count, 0);
  assert.equal(res.reason, 'all-paths-already-owned');
  const log = JSON.parse(fs.readFileSync(path.join(dataDir, current, 'write_log.json'), 'utf8'));
  assert.equal(log.paths.length, 1, 'dedupe keeps exactly one entry');
});

test('adoptSessionCustody with no prior write-log is a fail-open no-op', (t) => {
  const dataDir = withTempRegistry(t);
  const res = registry.adoptSessionCustody({ fromSessionId: 'ghost-session', toSessionId: 'current-x' });
  assert.equal(res.adopted, false);
  assert.equal(res.adopted_count, 0);
  assert.equal(res.reason, 'no-prior-write-log');
  assert.equal(fs.existsSync(path.join(dataDir, 'current-x', 'write_log.json')), false);
});

test('adoptSessionCustody rejects invalid or self-adoption session ids', (t) => {
  withTempRegistry(t);
  assert.equal(registry.adoptSessionCustody({ fromSessionId: '', toSessionId: 'x' }).reason, 'invalid-session-ids');
  assert.equal(registry.adoptSessionCustody({ fromSessionId: 'x', toSessionId: '' }).reason, 'invalid-session-ids');
  assert.equal(registry.adoptSessionCustody({ fromSessionId: 'same', toSessionId: 'same' }).reason, 'invalid-session-ids');
});
