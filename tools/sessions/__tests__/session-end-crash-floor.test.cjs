'use strict';

// S2 crash-path (plan session-boundary-leak-repairs):
// the session-end crash floor writes an ENRICHED SessionBoundary/1.0 stub, and
// (gate G5) a session that dies without /shutdown converges to the same
// effective boundary state as a clean /shutdown — a resolvable pending marker
// with a surfaced next command. Also covers the session-end-boundary-log
// repoint from the legacy single-file marker to the per-scope boundary lib.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildStubMarker, runCrashFloor, hasFreshMarker, STUB_SCOPE } = require('../../hooks/session-lifecycle/session-end-close.cjs');
const { runShutdown } = require('../../commands/handlers/shutdown.cjs');
const { resolveScope } = require('../lib/boundary-markers.cjs');
const { reapDeadSessions } = require('../boot-dead-session-reaper.cjs');
const { buildLogEntry } = require('../session-end-boundary-log.cjs');
const { writeMarker } = require('../lib/boundary-markers.cjs');

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smos-crash-floor-'));
}

function fixtureGitRunner(args) {
  if (String(args).startsWith('log')) return 'abc1234 fixture commit at exit';
  if (String(args).startsWith('status')) return ' M tools/x.cjs\n M Mythos-memories/secret.md';
  return '';
}

function passCloseoutRunner() {
  return () => ({ status: 0, stdout: JSON.stringify({ verdict: 'PASS', findings: [] }), stderr: '' });
}

test('crash stub is enriched: last commit, changed files (redacted), live signals, missing-fields note', () => {
  const root = makeRoot();
  const marker = buildStubMarker(root, { sessionId: 'sess1234-abcd', gitRunner: fixtureGitRunner, closeoutRunner: passCloseoutRunner() });
  assert.equal(marker.schema, 'SessionBoundary/1.0');
  assert.equal(marker.scope, STUB_SCOPE);
  assert.equal(marker.recommended_next_command, '/whats-next');
  assert.equal(marker.crash_floor, true);
  assert.equal(marker.last_commit, 'abc1234 fixture commit at exit');
  assert.equal(marker.changed_file_count, 2);
  // The forbidden family is redacted, never emitted verbatim.
  const serialized = JSON.stringify(marker);
  assert.ok(!serialized.includes('Mythos-memories/secret.md'), 'crash marker must not leak memory paths');
  assert.ok(marker.changed_files.some((e) => e && e.redacted_family === 'Mythos-memories/**'));
  // Standing handoff is absent in the fixture -> missing-fields note present.
  assert.ok(marker.missing_fields.some((f) => /handoff_path/.test(f)));
});

test('runCrashFloor writes the stub and the scope becomes resolvable with a next command', () => {
  const root = makeRoot();
  const result = runCrashFloor(root, { sessionId: 'sess1234', skipAutoCommit: true, gitRunner: fixtureGitRunner, closeoutRunner: passCloseoutRunner() });
  assert.equal(result.wrote, true);
  const resolved = resolveScope(STUB_SCOPE, { root });
  assert.equal(resolved.status, 'exact');
  assert.equal(resolved.marker.payload.recommended_next_command, '/whats-next');
});

test('crash floor stands down when a fresh per-scope marker already exists', () => {
  const root = makeRoot();
  writeMarker({
    schema: 'SessionBoundary/1.0',
    scope: 'system',
    handoff_path: '_dev/reports/analysis/next-session-handoff__system.md',
    recommended_next_command: '/whats-next'
  }, { root });
  assert.equal(hasFreshMarker(root), true);
  const result = runCrashFloor(root, { skipAutoCommit: true, gitRunner: fixtureGitRunner, closeoutRunner: passCloseoutRunner() });
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'fresh_marker_present');
});

// The equivalence property both rituals must satisfy: a durable, resolvable
// pending marker whose recommended next command is non-empty.
function boundaryStateOf(root, scope) {
  const resolved = resolveScope(scope, { root });
  return {
    marker_present: resolved.status === 'exact',
    scope_resolvable: resolved.status === 'exact',
    next_command_surfaced: Boolean(resolved.status === 'exact' && resolved.marker.payload.recommended_next_command)
  };
}

function makeShutdownFixture(root) {
  const specPath = path.join(root, 'instructions', 'canonical', 'commands', 'shutdown.yaml');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, JSON.stringify({
    id: 'shutdown',
    process: [
      'Resolve scope from $ARGUMENTS: fixture preamble.',
      'Step 1 — /normalize-signals: fixture.',
      'Step 2 — /clean-house: fixture.',
      'Step 3 — /debrief-run: fixture.',
      'Step 4 — /next-session: fixture.',
      'Step 4b — /disk-quota-guard: fixture.',
      'Step 5 — Sync private remotes: fixture.',
      'Report a concise three-line summary: fixture.'
    ]
  }, null, 2));
  const w = (rel, content) => { const full = path.join(root, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); };
  w('_dev/reports/analysis/next-session-handoff__system.md', '# System handoff\nResume the system scope here.\n');
  w('_dev/reports/analysis/next-session-continuity.json', JSON.stringify({
    entries: [{ scope_type: 'system', recommended_next_command: '/whats-next', path: '_dev/reports/analysis/next-session-handoff__system.md', mtime: '2026-07-11T00:00:00Z' }]
  }, null, 2));
  const exitStub = (name, code) => { const p = path.join(root, `${name}.stub.cjs`); fs.writeFileSync(p, `process.exit(${code});\n`); return [process.execPath, p]; };
  return { commands: { '4b': exitStub('dq', 0), '5': exitStub('sync', 0) } };
}

test('G5 crash-equivalence: crash floor + clean shutdown converge to the same effective boundary state', () => {
  // Clean /shutdown path.
  const cleanRoot = makeRoot();
  const { commands } = makeShutdownFixture(cleanRoot);
  const shutdown = runShutdown(cleanRoot, { system: true, commands, closeoutRunner: passCloseoutRunner() });
  assert.equal(shutdown.exitCode, 0, shutdown.stderr);
  const cleanState = boundaryStateOf(cleanRoot, 'system');

  // Crash path (session dies without /shutdown).
  const crashRoot = makeRoot();
  runCrashFloor(crashRoot, { sessionId: 'deadsess', skipAutoCommit: true, gitRunner: fixtureGitRunner, closeoutRunner: passCloseoutRunner() });
  const crashState = boundaryStateOf(crashRoot, STUB_SCOPE);

  // Same effective boundary state: marker present, scope resolvable, next command surfaced.
  assert.deepEqual(crashState, { marker_present: true, scope_resolvable: true, next_command_surfaced: true });
  assert.deepEqual(crashState, cleanState);

  // Convergence continues at boot: the reaper catches the crash orphan.
  const report = reapDeadSessions({ root: crashRoot });
  const orphan = report.surfaced.find((s) => s.scope === STUB_SCOPE);
  assert.ok(orphan, 'boot reaper must surface the crash-floor orphan');
  assert.ok(orphan.classifications.includes('crash_stub_orphan'));
});

test('session-end-boundary-log repoint: logs ALL per-scope pending markers via the boundary lib', () => {
  const root = makeRoot();
  writeMarker({ schema: 'SessionBoundary/1.0', scope: 'system', handoff_path: '_dev/h.md', recommended_next_command: '/whats-next' }, { root });
  writeMarker({ schema: 'SessionBoundary/1.0', scope: 'client:{CLIENT_CODE}', handoff_path: '_dev/h2.md', recommended_next_command: '/triage-client-board' }, { root });
  const entry = buildLogEntry({ root });
  assert.equal(entry.schema, 'SessionBoundaryLog/1.0');
  assert.equal(entry.event, 'session_end');
  assert.equal(entry.pending_marker_present, true);
  assert.equal(entry.pending_marker_count, 2);
  const scopes = entry.pending_scopes.map((s) => s.scope).sort();
  assert.deepEqual(scopes, ['client:{CLIENT_CODE}', 'system']);
});
