'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('../lib/boundary-markers.cjs');
const { runConsumeBoundary } = require('../consume-boundary.cjs');
const { loadHandoffExcerpt } = require('../lib/resume-packet.cjs');

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-test-'));
  return { root: d };
}
function marker(scope, extra) {
  return Object.assign({
    schema: 'SessionBoundary/1.0',
    scope,
    handoff_path: `clients/${scope}/next-session-handoff.md`,
    recommended_next_command: '/whats-next',
  }, extra || {});
}

test('slugForScope is filesystem-safe and preserves client code', () => {
  assert.equal(lib.slugForScope('client:{CLIENT_CODE}'), 'client-{CLIENT_CODE}');
  assert.equal(lib.slugForScope('client:{CLIENT_CODE}'), 'client-{CLIENT_CODE}');
  assert.equal(lib.slugForScope('--system'), 'system');
  assert.equal(lib.slugForScope('system'), 'system');
  assert.equal(lib.slugForScope(''), 'unknown');
});

test('two scopes coexist — writing one never clobbers the other', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('client:{CLIENT_CODE}', { summary: '{CLIENT_CODE}' }), opts);
  lib.writeMarker(marker('client:{CLIENT_CODE}', { summary: '{CLIENT_CODE}' }), opts);
  const pending = lib.listPending(opts);
  assert.equal(pending.length, 2);
  const scopes = pending.map((m) => m.scope).sort();
  assert.deepEqual(scopes, ['client:{CLIENT_CODE}', 'client:{CLIENT_CODE}']);
});

test('consume removes only the named scope, leaving others pending', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('client:{CLIENT_CODE}'), opts);
  lib.writeMarker(marker('client:{CLIENT_CODE}'), opts);
  const consumed = lib.consume('client:{CLIENT_CODE}', opts);
  assert.ok(consumed && fs.existsSync(consumed), 'consumed file archived');
  const pending = lib.listPending(opts);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].scope, 'client:{CLIENT_CODE}');
});

test('consume of a missing scope returns null and is a no-op', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('client:{CLIENT_CODE}'), opts);
  assert.equal(lib.consume('client:NOPE', opts), null);
  assert.equal(lib.listPending(opts).length, 1);
});

test('invalid payloads are rejected on write', () => {
  const opts = tmpRoot();
  assert.throws(() => lib.writeMarker({ scope: 'client:{CLIENT_CODE}' }, opts), /invalid/);
  assert.throws(() => lib.writeMarker(marker('client:{CLIENT_CODE}', { schema: 'Wrong/9' }), opts), /invalid/);
});

test('legacy single-file marker is migrated into the per-scope dir', () => {
  const opts = tmpRoot();
  const P = lib.paths(opts);
  fs.mkdirSync(P.STATE_DIR, { recursive: true });
  fs.writeFileSync(P.LEGACY_MARKER, JSON.stringify(marker('client:{CLIENT_CODE}', { summary: 'legacy' })));
  const pending = lib.listPending(opts);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].scope, 'client:{CLIENT_CODE}');
  assert.ok(!fs.existsSync(P.LEGACY_MARKER), 'legacy file removed after migration');
});

test('peekPending is read-only: it never migrates the legacy marker, but surfaces it in place', () => {
  const opts = tmpRoot();
  const P = lib.paths(opts);
  fs.mkdirSync(P.STATE_DIR, { recursive: true });
  const body = JSON.stringify(marker('client:{CLIENT_CODE}', { summary: 'legacy' }));
  fs.writeFileSync(P.LEGACY_MARKER, body);
  const peeked = lib.peekPending(opts);
  // The legacy marker is surfaced (legacy:true) but NOT moved.
  const legacyEntry = peeked.find((m) => m.legacy);
  assert.ok(legacyEntry, 'peekPending surfaces the legacy marker');
  assert.equal(legacyEntry.scope, 'client:{CLIENT_CODE}');
  assert.equal(fs.existsSync(P.LEGACY_MARKER), true, 'peekPending must not move the legacy marker');
  assert.equal(fs.readFileSync(P.LEGACY_MARKER, 'utf8'), body, 'legacy bytes unchanged');
});

test('listPending({ migrateLegacy: false }) does not migrate; default still does', () => {
  const opts = tmpRoot();
  const P = lib.paths(opts);
  fs.mkdirSync(P.STATE_DIR, { recursive: true });
  fs.writeFileSync(P.LEGACY_MARKER, JSON.stringify(marker('client:{CLIENT_CODE}', { summary: 'legacy' })));
  // Non-mutating listing leaves the legacy file in place (per-scope dir empty).
  const noMigrate = lib.listPending(opts, { migrateLegacy: false });
  assert.equal(noMigrate.length, 0);
  assert.equal(fs.existsSync(P.LEGACY_MARKER), true, 'migrateLegacy:false must not move the legacy marker');
  // Default behavior is unchanged: it migrates.
  const migrated = lib.listPending(opts);
  assert.equal(migrated.length, 1);
  assert.ok(!fs.existsSync(P.LEGACY_MARKER), 'default listPending still migrates');
});

test('legacy migration does not clobber a newer per-scope marker', () => {
  const opts = tmpRoot();
  const P = lib.paths(opts);
  lib.writeMarker(marker('client:{CLIENT_CODE}', { summary: 'new-per-scope' }), opts);
  fs.writeFileSync(P.LEGACY_MARKER, JSON.stringify(marker('client:{CLIENT_CODE}', { summary: 'old-legacy' })));
  const pending = lib.listPending(opts);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].payload.summary, 'new-per-scope');
  assert.ok(!fs.existsSync(P.LEGACY_MARKER), 'superseded legacy archived');
});

test('write is atomic-safe roundtrip and listPending sorts newest first', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('client:A', { written_at: '2020-01-01T00:00:00.000Z' }), opts);
  const second = lib.writeMarker(marker('client:B'), opts);
  // touch B to be newest
  const now = Date.now() / 1000;
  fs.utimesSync(second, now + 10, now + 10);
  const pending = lib.listPending(opts);
  assert.equal(pending[0].scope, 'client:B');
});

test('consume boundary emits full resume packet for consumed scope', () => {
  const opts = tmpRoot();
  const handoffPath = path.join(opts.root, '_dev', 'handoffs', 'scope-a.md');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, '# Handoff\n\n## Current State\nReady.\n');
  lib.writeMarker(marker('system-a', {
    handoff_path: '_dev/handoffs/scope-a.md',
    summary: 'resume scope a',
    recommended_next_command: '/run-plan scope-a'
  }), opts);

  const result = runConsumeBoundary('system-a', opts);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /consumed boundary marker for system-a/);
  assert.match(result.stdout, /<RESUMED_SESSION_HANDOFF scope="system-a" path="_dev\/handoffs\/scope-a\.md" mode="full"/);
  assert.match(result.stdout, /## Current State\nReady\./);
  assert.match(result.stdout, /recommended_next_command: \/run-plan scope-a/);
});

test('resume packet excerpts large handoffs and keeps next-command read-full warning', () => {
  const opts = tmpRoot();
  const handoffPath = path.join(opts.root, '_dev', 'handoffs', 'large.md');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, [
    '# Large',
    '',
    'noise '.repeat(200),
    '',
    '## Current State',
    'Important state.',
    '',
    '## Next Command',
    '/continue-work',
    '',
    'tail '.repeat(200)
  ].join('\n'));

  const excerpt = loadHandoffExcerpt(marker('system-large', {
    handoff_path: '_dev/handoffs/large.md',
    recommended_next_command: '/continue-work'
  }), {
    ...opts,
    fullCapBytes: 120,
    excerptCapBytes: 180,
    latestRepoTimeMs: 0
  });

  assert.equal(excerpt.mode, 'excerpt');
  assert.match(excerpt.content, /## Current State/);
  assert.match(excerpt.content, /Important state/);
  assert.ok(excerpt.warnings.some((warning) => warning.includes('HANDOFF_EXCERPT')));
  assert.ok(excerpt.warnings.some((warning) => warning.includes('/continue-work')));
});

test('resume packet reports missing handoff loudly', () => {
  const opts = tmpRoot();
  const result = loadHandoffExcerpt(marker('system-missing', {
    handoff_path: '_dev/handoffs/missing.md'
  }), opts);

  assert.equal(result.mode, 'missing');
  assert.equal(result.missing_reason, 'handoff_file_not_found');
  assert.ok(result.warnings.some((warning) => warning.includes('HANDOFF_MISSING')));
});

test('resume packet warns when repository state is newer than handoff mtime', () => {
  const opts = tmpRoot();
  const handoffPath = path.join(opts.root, '_dev', 'handoffs', 'stale.md');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, '## Current State\nOld.\n');
  const old = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(handoffPath, old, old);

  const result = loadHandoffExcerpt(marker('system-stale', {
    handoff_path: '_dev/handoffs/stale.md'
  }), {
    ...opts,
    latestRepoTimeMs: Date.parse('2026-06-01T00:00:00Z')
  });

  assert.equal(result.mode, 'full');
  assert.ok(result.warnings.some((warning) => warning.includes('HANDOFF_STALE')));
});

test('consume boundary packet loads only the consumed scope', () => {
  const opts = tmpRoot();
  const handoffA = path.join(opts.root, '_dev', 'handoffs', 'a.md');
  const handoffB = path.join(opts.root, '_dev', 'handoffs', 'b.md');
  fs.mkdirSync(path.dirname(handoffA), { recursive: true });
  fs.writeFileSync(handoffA, '## Current State\nA only.\n');
  fs.writeFileSync(handoffB, '## Current State\nB only.\n');
  lib.writeMarker(marker('system-a', { handoff_path: '_dev/handoffs/a.md' }), opts);
  lib.writeMarker(marker('system-b', { handoff_path: '_dev/handoffs/b.md' }), opts);

  const result = runConsumeBoundary('system-a', opts);
  const pending = lib.listPending(opts);

  assert.match(result.stdout, /A only/);
  assert.doesNotMatch(result.stdout, /B only/);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].scope, 'system-b');
});

test('consume boundary packet accepts slug-equivalent scope names', () => {
  const opts = tmpRoot();
  const handoffPath = path.join(opts.root, '_dev', 'handoffs', '{CLIENT_CODE}.md');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, '## Current State\nECH resumed.\n');
  lib.writeMarker(marker('client:{CLIENT_CODE}', { handoff_path: '_dev/handoffs/{CLIENT_CODE}.md' }), opts);

  const result = runConsumeBoundary('client-{CLIENT_CODE}', opts);

  assert.match(result.stdout, /consumed boundary marker for client-{CLIENT_CODE}/);
  assert.match(result.stdout, /<RESUMED_SESSION_HANDOFF scope="client:{CLIENT_CODE}"/);
  assert.match(result.stdout, /{CLIENT_CODE} resumed/);
  assert.equal(lib.listPending(opts).length, 0);
});

// --- S1: fail-loud boundary-scope resolution -------------------------------

test('resolveScope: exact match (including slug-equivalent) returns status exact', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('client:{CLIENT_CODE}'), opts);
  const exact = lib.resolveScope('client:{CLIENT_CODE}', opts);
  assert.equal(exact.status, 'exact');
  assert.equal(exact.marker.scope, 'client:{CLIENT_CODE}');

  const slugEquivalent = lib.resolveScope('client-{CLIENT_CODE}', opts);
  assert.equal(slugEquivalent.status, 'exact');
  assert.equal(slugEquivalent.marker.scope, 'client:{CLIENT_CODE}');
});

test('resolveScope: unknown scope returns not_found with ranked candidates, never consumes', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('system'), opts);
  lib.writeMarker(marker('system-dlx-hygiene'), opts);
  lib.writeMarker(marker('client:{CLIENT_CODE}'), opts);

  const result = lib.resolveScope('system-fable-lite', opts);
  assert.equal(result.status, 'not_found');
  assert.ok(result.candidates.length >= 3, 'all pending scopes surfaced as candidates');

  const scopes = result.candidates.map((c) => c.scope);
  // "system-dlx-hygiene" and "system" both share the "system" token/prefix
  // with "system-fable-lite" and must outrank the unrelated "client:{CLIENT_CODE}".
  const idxSystem = scopes.indexOf('system');
  const idxHygiene = scopes.indexOf('system-dlx-hygiene');
  const idxYarmaz = scopes.indexOf('client:{CLIENT_CODE}');
  assert.ok(idxSystem < idxYarmaz, 'system ranks above unrelated client:{CLIENT_CODE}');
  assert.ok(idxHygiene < idxYarmaz, 'system-dlx-hygiene ranks above unrelated client:{CLIENT_CODE}');

  for (const c of result.candidates) {
    assert.equal(c.consume_command, `node tools/sessions/consume-boundary.cjs ${c.scope}`);
    assert.equal(typeof c.score_reason, 'string');
  }

  // Read-only: fuzzy resolution must never consume anything.
  assert.equal(lib.listPending(opts).length, 3, 'pending markers untouched by resolveScope');
});

test('resolveScope: no pending markers at all still returns not_found with empty candidates', () => {
  const opts = tmpRoot();
  const result = lib.resolveScope('anything', opts);
  assert.equal(result.status, 'not_found');
  assert.deepEqual(result.candidates, []);
});

test('runConsumeBoundary: unknown scope exits 3 with SCOPE_NOT_FOUND, empty stdout, ranked candidates in stderr; pending untouched', () => {
  const opts = tmpRoot();
  lib.writeMarker(marker('system'), opts);
  lib.writeMarker(marker('system-dlx-hygiene'), opts);

  const result = runConsumeBoundary('system-fable-lite', opts);

  assert.equal(result.exitCode, 3);
  assert.equal(result.code, 'SCOPE_NOT_FOUND');
  assert.equal(result.requested_scope, 'system-fable-lite');
  assert.ok(Array.isArray(result.candidates) && result.candidates.length >= 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /SCOPE_NOT_FOUND: no pending marker for scope: system-fable-lite/);
  assert.match(result.stderr, /node tools\/sessions\/consume-boundary\.cjs system/);

  assert.equal(lib.listPending(opts).length, 2, 'a fuzzy miss must never consume a pending marker');
});

test('consume adopts custody of the prior session referenced by the marker', () => {
  const opts = tmpRoot();
  const regDir = path.join(opts.root, '_dev', 'state', 'active-sessions');
  const priorSid = 'prior-session-custody-1';
  const registry = require('../lib/active-session-registry.js');
  registry.setDataDir(regDir);
  // register the crossing (current) session so resolveCurrentSessionId finds it
  registry.registerSession({
    sessionId: 'current-session-custody-1'
  });

  const handoffPath = path.join(opts.root, '_dev', 'handoffs', 'custody-a.md');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, '# Handoff\n\n## Current State\nTake over.\n');

  // seed the prior session's write-log (what the crossed session left dirty)
  const priorDir = path.join(regDir, priorSid);
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, 'write_log.json'),
    JSON.stringify({ session_id: priorSid, paths: [
      { path: '_dev/reports/analysis/from-prior.md', at: '2026-08-03T00:00:00.000Z', tool: 'Write' },
      { path: 'tools/from-prior.cjs', at: '2026-08-03T00:00:00.000Z', tool: 'Edit' }
    ] }, null, 2) + '\n'
  );

  lib.writeMarker(marker('system-custody-a', {
    handoff_path: '_dev/handoffs/custody-a.md',
    session_id: priorSid,
    recommended_next_command: '/run-plan custody-a'
  }), opts);

  try {
    const result = runConsumeBoundary('system-custody-a', opts);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /consumed boundary marker for system-custody-a/);
    assert.match(result.stdout, /adopted custody from session prior-session-custody-1: 2 path\(s\)/);
    assert.ok(result.adoption && result.adoption.adopted, 'adoption reported in result');
    assert.equal(result.adoption.adopted_count, 2);

    // current session ledger now owns the prior paths with provenance
    const currentSid = registry.getCurrentSessionId();
    assert.ok(currentSid, '_current-id grounded to the crossing session');
    const log = JSON.parse(fs.readFileSync(path.join(regDir, currentSid, 'write_log.json'), 'utf8'));
    const adopted = log.paths.filter((e) => e.adopted_from === priorSid);
    assert.equal(adopted.length, 2, 'prior paths adopted into current ledger');
  } finally {
    registry.resetDataDir();
  }
});

test('consume without a marker session_id performs no custody adoption', () => {
  const opts = tmpRoot();
  const regDir = path.join(opts.root, '_dev', 'state', 'active-sessions');
  const registry = require('../lib/active-session-registry.js');
  registry.setDataDir(regDir);

  lib.writeMarker(marker('system-no-custody', {
    handoff_path: '_dev/handoffs/no-custody.md',
    recommended_next_command: '/whats-next'
  }), opts);

  try {
    const result = runConsumeBoundary('system-no-custody', opts);
    assert.equal(result.exitCode, 0);
    assert.equal(result.prior_session_id, null, 'no prior session to adopt');
    assert.equal(result.adoption, null, 'no adoption attempted');
    assert.doesNotMatch(result.stdout, /adopted custody/);
  } finally {
    registry.resetDataDir();
  }
});

test('runConsumeBoundary: unknown scope with zero pending markers still exits 3 and reports no pending scopes', () => {
  const opts = tmpRoot();
  const result = runConsumeBoundary('anything', opts);
  assert.equal(result.exitCode, 3);
  assert.equal(result.code, 'SCOPE_NOT_FOUND');
  assert.deepEqual(result.candidates, []);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /no pending scopes/);
});

test('CLI e2e: consume-boundary.cjs exits 3 (not 0) on an unknown scope, surviving the process boundary', () => {
  // The CLI resolves its root via tools/lib/canonical-root.cjs, which only
  // supports override through the MYTHOS_ROOT env var (rootOpts.root
  // injection is a test-only lib.paths() affordance, not reachable from the
  // CLI's argv-only entry point). Rather than risk resolving against the
  // wrong repo, this exercises the CLI against the real repo root with a
  // scope name that is guaranteed not to collide with any real pending
  // marker. The path under test (SCOPE_NOT_FOUND / exit 3) is read-only —
  // resolveScope() never consumes on a miss — so running against the real
  // repo's pending markers, if any exist, is safe.
  const cliPath = path.join(__dirname, '..', 'consume-boundary.cjs');
  const bogusScope = `__s1-e2e-test-scope-${process.pid}-${Date.now()}__`;

  const proc = spawnSync(process.execPath, [cliPath, bogusScope], { encoding: 'utf8' });

  assert.equal(proc.status, 3, `expected exit 3, got ${proc.status}; stderr: ${proc.stderr}`);
  assert.match(proc.stderr, /SCOPE_NOT_FOUND: no pending marker for scope: /);
  assert.equal(proc.stdout, '');
});
