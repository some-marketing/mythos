'use strict';

// T5 (mech-rebase-tranche-1) — doctrine-reflex narrow promotion fixture.
//
// Replays drift-log entries (fixtures/drift-log-replay-t5.json, exact
// SessionDriftLog/1.0 entry format — see fixture_provenance for why the
// entries are replay-derived rather than copied from production) and asserts:
//   - check2-fail and check5-fail findings → exit 2 when enforcing
//   - check6-stall (aggregate verdict 'stall') → exit 0, always advisory
//   - exit-2 is per-finding (checks 2/5 only), NEVER verdict-driven
//   - observe-only default (flag unset) → exit 0 with loud WOULD-BLOCK
//   - inline bypass_justification degrade → exit 0 loud-warn + drift-ledger
//     entry flagged for async review

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIRE_CLI = path.join(REPO_ROOT, 'tools/kernel/fire-reflex.cjs');
const fire = require(FIRE_CLI);
const reflex = require(path.join(REPO_ROOT, 'tools/kernel/doctrine-reflex.cjs'));

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'drift-log-replay-t5.json');

function loadFixture() {
  // fixture-source immutability: read + parse, never mutate the file
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function entryByName(fixture, id) {
  const e = fixture.entries.find((x) => x.id === id);
  assert.ok(e, `fixture entry ${id} present`);
  return e;
}

// ── Sandbox for end-to-end CLI runs ──────────────────────────────────────────
// fire-reflex resolves its root via canonical-root (MYTHOS_ROOT override, hard
// mode → anchors required) and doctrine-reflex uses process.cwd(); point both
// at a throwaway root so replay runs never touch real _dev/state.

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fire-reflex-t5-'));
  fs.mkdirSync(path.join(dir, 'instructions', 'canonical'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
  return dir;
}

function runCli(envelope, extraEnv) {
  const sandbox = makeSandbox();
  const env = { ...process.env, MYTHOS_ROOT: sandbox };
  delete env[fire.ENFORCE_ENV];
  delete env[fire.BYPASS_ENV];
  env.MYTHOS_REFLEX_ENVELOPE_JSON = JSON.stringify(envelope);
  Object.assign(env, extraEnv || {});
  const res = spawnSync(process.execPath, [FIRE_CLI, envelope.event_type || 'PostToolUse'], {
    cwd: sandbox,
    env,
    encoding: 'utf8'
  });
  return { ...res, sandbox };
}

// ── Fixture integrity: replay envelopes reproduce the logged findings ────────

test('drift-log entries are reproduced by replaying their envelopes through the real checks', () => {
  const fixture = loadFixture();
  for (const entry of fixture.entries) {
    const envelope = fixture.fixture_provenance.replay_envelopes[entry.replay_envelope];
    assert.ok(envelope, `replay envelope ${entry.replay_envelope} present`);
    const result = reflex.runReflex(envelope);
    assert.deepEqual(
      result.findings,
      entry.findings,
      `replay of ${entry.id} reproduces logged findings`
    );
  }
});

// ── Per-finding decision (drift-log entry replay through the allowlist) ──────

test('check2-fail drift entry → exit 2 when enforcing', () => {
  const entry = entryByName(loadFixture(), 'drift-t5-check2-fail');
  const d = fire.resolveReflexExitCode(entry.findings, { env: { [fire.ENFORCE_ENV]: '1' } });
  assert.equal(d.exitCode, 2);
  assert.equal(d.mode, 'enforced');
  assert.deepEqual(d.promoted.map((f) => f.check), [2]);
});

test('check5-fail drift entry → exit 2 when enforcing', () => {
  const entry = entryByName(loadFixture(), 'drift-t5-check5-fail');
  const d = fire.resolveReflexExitCode(entry.findings, { env: { [fire.ENFORCE_ENV]: '1' } });
  assert.equal(d.exitCode, 2);
  assert.equal(d.mode, 'enforced');
  assert.deepEqual(d.promoted.map((f) => f.check), [5]);
});

test('check6-stall drift entry → exit 0 even when enforcing (advisory; verdict never drives exit)', () => {
  const fixture = loadFixture();
  const entry = entryByName(fixture, 'drift-t5-check6-stall');
  // The aggregate verdict for this envelope IS 'stall' — prove it, then prove
  // the exit decision ignores it (forbidden naive verdict===stall promotion).
  const envelope = fixture.fixture_provenance.replay_envelopes[entry.replay_envelope];
  assert.equal(reflex.runReflex(envelope).verdict, 'stall');
  const d = fire.resolveReflexExitCode(entry.findings, { env: { [fire.ENFORCE_ENV]: '1' } });
  assert.equal(d.exitCode, 0);
  assert.equal(d.mode, 'advisory');
  assert.equal(d.promoted.length, 0);
});

test('observe-only default: flag unset → exit 0 for promoted findings', () => {
  const entry = entryByName(loadFixture(), 'drift-t5-check2-fail');
  const d = fire.resolveReflexExitCode(entry.findings, { env: {} });
  assert.equal(d.exitCode, 0);
  assert.equal(d.mode, 'observe');
  assert.equal(d.promoted.length, 1);
});

test('bypass_justification degrades exit-2 to exit-0 for promoted checks only', () => {
  const fixture = loadFixture();
  const check2 = entryByName(fixture, 'drift-t5-check2-fail');
  const d = fire.resolveReflexExitCode(check2.findings, {
    env: { [fire.ENFORCE_ENV]: '1', [fire.BYPASS_ENV]: 'fixture cycle: justified for replay' }
  });
  assert.equal(d.exitCode, 0);
  assert.equal(d.mode, 'bypassed');
  assert.equal(d.bypass_justification, 'fixture cycle: justified for replay');
});

// ── End-to-end CLI: real process, real exit codes ─────────────────────────────

test('CLI: check2-fail envelope + gate=1 → exit 2 with rule/evidence/next-step block message', () => {
  const fixture = loadFixture();
  const envelope = fixture.fixture_provenance.replay_envelopes.check2_fail;
  const res = runCli(envelope, { [fire.ENFORCE_ENV]: '1' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /BLOCKED_DOCTRINE_REFLEX/);
  assert.match(res.stderr, /check 2 \[missing_review_artifact\]/);
  assert.match(res.stderr, /sanctioned next step: reference the distinct-intelligence review artifact/);
});

test('CLI: check5-fail envelope + gate=1 → exit 2 with rule/evidence/next-step block message', () => {
  const fixture = loadFixture();
  const envelope = fixture.fixture_provenance.replay_envelopes.check5_fail;
  const res = runCli(envelope, { [fire.ENFORCE_ENV]: '1' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /BLOCKED_DOCTRINE_REFLEX/);
  assert.match(res.stderr, /check 5 \[external_content_unwrapped\]/);
  assert.match(res.stderr, /sanctioned next step: wrap the external content in <observed>/);
});

test('CLI: check6-stall envelope + gate=1 → exit 0; stall stays advisory (stderr banner + drift log)', () => {
  const fixture = loadFixture();
  const envelope = fixture.fixture_provenance.replay_envelopes.check6_stall;
  const res = runCli(envelope, { [fire.ENFORCE_ENV]: '1' });
  assert.equal(res.status, 0, `check6 stall must NOT exit 2 — stderr: ${res.stderr}`);
  assert.match(res.stderr, /REFLEX STALL/);
  assert.doesNotMatch(res.stderr, /BLOCKED_DOCTRINE_REFLEX/);
  // Advisory stall path intact: drift entry appended in the sandbox
  const log = JSON.parse(
    fs.readFileSync(path.join(res.sandbox, '_dev/state/session-drift-log.json'), 'utf8')
  );
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].status, 'open');
});

test('CLI: observe-only default (flag unset) → exit 0 with loud WOULD-BLOCK for check2', () => {
  const fixture = loadFixture();
  const envelope = fixture.fixture_provenance.replay_envelopes.check2_fail;
  const res = runCli(envelope, {});
  assert.equal(res.status, 0);
  assert.match(res.stderr, /WOULD BLOCK \(promoted check 2\)/);
  assert.match(res.stderr, new RegExp(`set ${fire.ENFORCE_ENV}=1 to enforce`));
});

test('CLI: gate=1 + bypass_justification → exit 0 loud-warn, drift-ledger entry flagged for async review', () => {
  const fixture = loadFixture();
  const envelope = fixture.fixture_provenance.replay_envelopes.check2_fail;
  const res = runCli(envelope, {
    [fire.ENFORCE_ENV]: '1',
    [fire.BYPASS_ENV]: 'blocked-then-bypassed fixture cycle for T5 acceptance'
  });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /PROMOTED CHECK BYPASSED/);
  assert.match(res.stderr, /flagged for async review/);
  const log = JSON.parse(
    fs.readFileSync(path.join(res.sandbox, '_dev/state/session-drift-log.json'), 'utf8')
  );
  const bypassEntry = log.entries.find((e) => e.gate === 'doctrine-reflex-promoted-check');
  assert.ok(bypassEntry, 'bypass entry appended to drift ledger');
  assert.equal(bypassEntry.status, 'open');
  assert.equal(bypassEntry.review, 'async_pending');
  assert.equal(bypassEntry.bypass_justification, 'blocked-then-bypassed fixture cycle for T5 acceptance');
  assert.deepEqual(bypassEntry.findings.map((f) => f.check), [2]);
});
