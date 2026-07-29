'use strict';

/**
 * pretool-arc-guard-cross-session.test.cjs — S2.5(a) verification.
 *
 * Slice S2.5(a) wires the EXISTING cross-session conflict detector
 * (scope-expansion-detector.checkCrossSessionConflict, reading the S1
 * write-set-registry) into the live PreToolUse hook tools/kernel/hooks/
 * pretool-arc-guard.cjs in LOGGING-ONLY mode. These tests assert the wiring is
 * advisory and safe:
 *
 *   (a) on a simulated cross-session conflict, the hook STILL exits 0 and writes
 *       the typed advisory INFO line to stderr (no block);
 *   (b) the no-conflict case is silent (no cross-session advisory) and exits 0;
 *   (c) the hook NEVER throws — even with a benign input it degrades to exit 0.
 *
 * The hook is run as a real subprocess (matching pre-tool-arc-scope-guard's
 * spawnSync style). Both the arc state dir (MYTHOS_ACTOR_ARC_DIR) and the
 * write-set registry dir (MYTHOS_WRITE_SET_REGISTRY_DIR) are pinned to temp dirs
 * via env so the subprocess detector reads our seeded reservation, not the real
 * live registry.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'tools/kernel/hooks/pretool-arc-guard.cjs');
const writer = require(path.join(REPO_ROOT, 'tools/kernel/lib/arc-state-writer.cjs'));
const registry = require(path.join(REPO_ROOT, 'tools/kernel/lib/write-set-registry.cjs'));

const SESSION_ID = 'cross-session-test';
const ACTOR_ID = `claude-main-chain-session:${SESSION_ID}`;

function withTempDirs(t) {
  const arcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pretool-arc-guard-arc-'));
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pretool-arc-guard-reg-'));
  // hook-telemetry.cjs constrains MYTHOS_HOOK_EVENT_LOG to live UNDER the
  // canonical PROJECT_ROOT (an escaping override falls back to the real default
  // path). So the test telemetry sink is a temp dir created INSIDE the repo and
  // removed afterward — it must not pollute the tracked _dev/reports tree.
  const telemetryDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-pretool-arc-guard-tel-'));
  const telemetryLog = path.join(telemetryDir, 'claude-hook-events.jsonl');
  t.after(() => fs.rmSync(arcDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(registryDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(telemetryDir, { recursive: true, force: true }));
  return { arcDir, registryDir, telemetryLog };
}

// Seed an actionable arc for the current actor whose declared write-set COVERS
// the write target, so the hook reaches the cross-session check (the arc check
// itself passes — the two dimensions are orthogonal).
function seedArc(arcDir) {
  const prev = process.env.MYTHOS_ACTOR_ARC_DIR;
  process.env.MYTHOS_ACTOR_ARC_DIR = arcDir;
  try {
    writer.createArc({
      arc_id: 'arc-cross-session-001',
      workstream_scope: 'cross-session-scope-isolation',
      scope_identity: { workstream_scope: 'cross-session-scope-isolation' },
      declared_write_set: ['tools/kernel/**'],
      forbidden_artifacts: [],
      authority_source: { kind: 'approved-plan', ref: 'plan.json' },
      parent_arc_id: null,
      authorized_at: '2026-05-31T16:00:00-0300',
      lifecycle_state: 'executing',
      actor_id: ACTOR_ID,
      actor_tier: 'main-chain',
      arc_ended_at: null,
      end_reason: null
    });
  } finally {
    if (prev === undefined) delete process.env.MYTHOS_ACTOR_ARC_DIR;
    else process.env.MYTHOS_ACTOR_ARC_DIR = prev;
  }
}

// Seed a DIFFERENT live actor's reservation over the target path directly into
// the pinned registry dir (the in-process registry helper resolves the same dir
// the subprocess will read via MYTHOS_WRITE_SET_REGISTRY_DIR).
function seedConflictingReservation(registryDir, globs) {
  registry.setRegistryDir(registryDir);
  try {
    registry.reserve(globs, {
      sessionId: 'other-session',
      pid: 999999,
      actorId: 'claude-other',
      now: new Date().toISOString()
    });
  } finally {
    registry.resetRegistryDir();
  }
}

function runHook(dirs, filePath) {
  const env = {
    ...process.env,
    MYTHOS_ACTOR_ARC_DIR: dirs.arcDir,
    MYTHOS_WRITE_SET_REGISTRY_DIR: dirs.registryDir,
    MYTHOS_HOOK_EVENT_LOG: dirs.telemetryLog,
    CLAUDE_SESSION_ID: SESSION_ID,
    CLAUDE_TOOL_INPUT: JSON.stringify({ file_path: filePath })
  };
  return spawnSync(process.execPath, [HOOK_PATH], { env, encoding: 'utf8' });
}

test('(a) cross-session conflict: hook exits 0 and writes the advisory INFO line', (t) => {
  const dirs = withTempDirs(t);
  seedArc(dirs.arcDir);
  seedConflictingReservation(dirs.registryDir, ['tools/kernel/lib/**']);

  const res = runHook(dirs, 'tools/kernel/lib/scope-expansion-detector.cjs');

  assert.equal(res.status, 0, 'logging-only mode must never block (exit 0)');
  assert.match(
    res.stderr,
    /\[scope-isolation S2\] cross-session write conflict \(advisory\)/,
    'typed cross-session advisory line must be emitted on conflict'
  );
  assert.match(res.stderr, /claude-other#999999/, 'advisory names the conflicting actor');
});

test('(b) no conflict: hook is silent on cross-session and exits 0', (t) => {
  const dirs = withTempDirs(t);
  seedArc(dirs.arcDir);
  // A reservation that does NOT cover the target path -> no conflict.
  seedConflictingReservation(dirs.registryDir, ['clients/{CLIENT_CODE}/**']);

  const res = runHook(dirs, 'tools/kernel/lib/scope-expansion-detector.cjs');

  assert.equal(res.status, 0);
  assert.doesNotMatch(
    res.stderr,
    /cross-session write conflict/,
    'no cross-session advisory when the target is not reserved by another actor'
  );
});

test('(c) hook never throws on a benign input and exits 0 (empty registry)', (t) => {
  const dirs = withTempDirs(t);
  seedArc(dirs.arcDir);
  // empty registry dir -> no reservations at all

  const res = runHook(dirs, 'tools/kernel/lib/arc-state-writer.cjs');

  assert.equal(res.status, 0, 'benign write must exit 0');
  assert.doesNotMatch(res.stderr, /cross-session write conflict/);
});

test('(d) telemetry event is appended on a real conflict (detail shape)', (t) => {
  const dirs = withTempDirs(t);
  seedArc(dirs.arcDir);
  seedConflictingReservation(dirs.registryDir, ['tools/kernel/lib/**']);

  const res = runHook(dirs, 'tools/kernel/lib/scope-expansion-detector.cjs');
  assert.equal(res.status, 0);

  assert.ok(fs.existsSync(dirs.telemetryLog), 'telemetry log file must be written on conflict');
  const lines = fs.readFileSync(dirs.telemetryLog, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  const ev = events.find((e) => e.event === 'cross-session-conflict-detected');
  assert.ok(ev, 'a cross-session-conflict-detected telemetry event must be emitted');
  assert.equal(ev.matcher, 'Write|Edit');
  assert.equal(ev.detail.intended_path, 'tools/kernel/lib/scope-expansion-detector.cjs');
  assert.equal(ev.detail.conflicting_actor_count, 1);
  assert.equal(typeof ev.detail.registry_coverage_gap, 'boolean');
});
