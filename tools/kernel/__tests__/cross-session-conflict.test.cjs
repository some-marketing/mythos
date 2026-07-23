'use strict';

/**
 * cross-session-conflict.test.cjs — S2 verification for the cross-session
 * conflict check added to tools/kernel/lib/scope-expansion-detector.cjs.
 *
 * S2 reads the S1 write-set-registry (the UNION of OTHER live actors'
 * TTL-pruned reservations) and returns a TYPED conflict naming the conflicting
 * actor + overlapping path. It is ADVISORY ONLY — these tests assert it
 * DETECTS and STRUCTURES conflicts; they also assert it NEVER blocks (no throw,
 * a plain structured result) since enforcement is S3.
 *
 * Coverage:
 *   1. acceptance: a second actor's write over a path a DIFFERENT live actor
 *      reserved is detected as a typed cross_session_write_conflict naming the
 *      other actor + matched glob
 *   2. self is excluded — writing inside your OWN reservation is not a conflict
 *   3. TTL: a stale (expired) reservation does NOT produce a conflict
 *   4. registry_coverage_gap — an un-arc'd writer overlapping another's
 *      reservation is flagged as a coverage gap, still conflict:true
 *   5. typed INFO logging on conflict; { logger: null } suppresses it; result
 *      is still returned (advisory, never blocks)
 *   6. checkWriteTargetAndConflicts superset: arc `allowed` is unchanged and
 *      the cross_session field carries the typed conflict
 *   7. circular-require safety: requiring the detector first still resolves the
 *      registry at call time
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// Require the detector FIRST (before the registry) to exercise the circular
// require: registry require()s the detector at load, so detector-first is the
// load order most likely to surface a partial-export bug if the S2 require
// were not lazy.
const detector = require(path.join(REPO_ROOT, 'tools/kernel/lib/scope-expansion-detector.cjs'));
const registry = require(path.join(REPO_ROOT, 'tools/kernel/lib/write-set-registry.cjs'));

function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-session-conflict-'));
  registry.setRegistryDir(dir);
  return dir;
}

function cleanup(dir) {
  registry.resetRegistryDir();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const T0 = Date.parse('2026-05-31T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

test('1. detects a typed cross-session conflict naming the other actor + glob', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/lib/**'], {
      sessionId: 'sess-A',
      pid: 1001,
      actorId: 'claude-A',
      now: iso(T0)
    });

    const res = detector.checkCrossSessionConflict(
      'tools/kernel/lib/scope-expansion-detector.cjs',
      { sessionId: 'sess-B', pid: 2002 },
      { nowMs: T0, force: true, logger: null }
    );

    assert.equal(res.class, 'cross_session_write_conflict');
    assert.equal(res.conflict, true);
    assert.equal(res.intended_path, 'tools/kernel/lib/scope-expansion-detector.cjs');
    assert.equal(res.conflicting_actors.length, 1);
    assert.deepEqual(res.conflicting_actors[0], {
      session_id: 'sess-A',
      pid: 1001,
      actor_id: 'claude-A',
      matched_glob: 'tools/kernel/lib/**'
    });
    // current writer (sess-B) holds its own arc? no — but it is still the
    // writer; coverage-gap asserted separately in test 4.
    assert.equal(res.registry_coverage_gap, true);
  } finally {
    cleanup(dir);
  }
});

test('2. self is excluded — writing inside your OWN reservation is not a conflict', () => {
  const dir = freshDir();
  try {
    registry.reserve(['clients/{CLIENT_CODE}/**'], {
      sessionId: 'sess-A',
      pid: 1001,
      actorId: 'claude-A',
      now: iso(T0)
    });

    const res = detector.checkCrossSessionConflict(
      'clients/{CLIENT_CODE}/config/ui.json',
      { sessionId: 'sess-A', pid: 1001 },
      { nowMs: T0, force: true, logger: null }
    );

    assert.equal(res.conflict, false);
    assert.equal(res.conflicting_actors.length, 0);
    assert.equal(res.registry_coverage_gap, false);
  } finally {
    cleanup(dir);
  }
});

test('3. a stale (TTL-expired) reservation produces no conflict', () => {
  const dir = freshDir();
  try {
    registry.reserve(['frameworks/**'], {
      sessionId: 'sess-A',
      pid: 1001,
      actorId: 'claude-A',
      ttlMs: 60 * 1000, // 1 min
      now: iso(T0)
    });

    // 5 minutes later: A's heartbeat is well past its 1-min TTL.
    const res = detector.checkCrossSessionConflict(
      'frameworks/paid-media/ad-creative/manifest.json',
      { sessionId: 'sess-B', pid: 2002 },
      { nowMs: T0 + 5 * 60 * 1000, force: true, logger: null }
    );

    assert.equal(res.conflict, false);
    assert.equal(res.conflicting_actors.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('4. registry_coverage_gap: un-arc\'d writer overlapping another is flagged, still conflict:true', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/sessions/**'], {
      sessionId: 'sess-A',
      pid: 1001,
      actorId: 'claude-A',
      now: iso(T0)
    });
    // sess-B holds NO reservation of its own.

    const res = detector.checkCrossSessionConflict(
      'tools/sessions/active-session-registry.cjs',
      { sessionId: 'sess-B', pid: 2002 },
      { nowMs: T0, force: true, logger: null }
    );

    assert.equal(res.conflict, true);
    assert.equal(res.registry_coverage_gap, true);
  } finally {
    cleanup(dir);
  }
});

test('5. typed INFO logging on conflict; logger:null suppresses; result still returned (advisory, no throw)', () => {
  const dir = freshDir();
  try {
    registry.reserve(['_dev/state/**'], {
      sessionId: 'sess-A',
      pid: 1001,
      actorId: 'claude-A',
      now: iso(T0)
    });

    const lines = [];
    const res = detector.checkCrossSessionConflict(
      '_dev/state/kernel-heartbeat.json',
      { sessionId: 'sess-B', pid: 2002 },
      { nowMs: T0, force: true, logger: (l) => lines.push(l) }
    );

    assert.equal(res.conflict, true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[scope-isolation S2\] cross-session write conflict \(advisory\)/);
    assert.match(lines[0], /claude-A#1001/);
    assert.match(lines[0], /no enforcement; logged only/);

    // logger:null suppresses the line but the structural result is unchanged.
    const lines2 = [];
    const res2 = detector.checkCrossSessionConflict(
      '_dev/state/kernel-heartbeat.json',
      { sessionId: 'sess-B', pid: 2002 },
      { nowMs: T0, force: true, logger: null }
    );
    assert.equal(res2.conflict, true);
    assert.equal(lines2.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('6. checkWriteTargetAndConflicts superset: arc allowed unchanged + typed cross_session attached', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], {
      sessionId: 'sess-A',
      pid: 1001,
      actorId: 'claude-A',
      now: iso(T0)
    });

    // Provide an explicit arc so the result does not depend on ambient arc
    // state. The arc ALLOWS the write (within its own declared write-set) — S2
    // must NOT change that — yet a DIFFERENT live actor has reserved the path.
    const currentArc = {
      declared_write_set: ['tools/kernel/**'],
      forbidden_artifacts: []
    };

    const res = detector.checkWriteTargetAndConflicts(
      'claude-B',
      'tools/kernel/lib/scope-expansion-detector.cjs',
      {
        currentArc,
        actor: { sessionId: 'sess-B', pid: 2002 },
        nowMs: T0,
        force: true,
        logger: null
      }
    );

    // arc dimension unchanged (advisory superset does not block)
    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'within_declared_write_set');
    // cross-session dimension carries the typed conflict
    assert.equal(res.cross_session.class, 'cross_session_write_conflict');
    assert.equal(res.cross_session.conflict, true);
    assert.equal(res.cross_session.conflicting_actors[0].session_id, 'sess-A');
  } finally {
    cleanup(dir);
  }
});

test('7. no conflict when no OTHER actor has reserved the path', () => {
  const dir = freshDir();
  try {
    // empty registry
    const res = detector.checkCrossSessionConflict(
      'tools/kernel/lib/scope-expansion-detector.cjs',
      { sessionId: 'sess-B', pid: 2002 },
      { nowMs: T0, force: true, logger: null }
    );
    assert.equal(res.conflict, false);
    assert.equal(res.conflicting_actors.length, 0);
  } finally {
    cleanup(dir);
  }
});
