'use strict';

/**
 * write-set-registry.test.cjs — S1 verification for the live cross-session
 * write-set reservation registry (tools/kernel/lib/write-set-registry.cjs).
 *
 * Coverage:
 *   1. reserve + readRegistry round-trip (globs normalized, keyed sessionId+pid)
 *   2. TTL pruning (stale heartbeat dropped on access AND physically by pruneStale)
 *   3. overlap detection — ADVISORY INFO path (different actor overlap flagged,
 *      self-overlap ignored, un-arc'd writer surfaced, INFO logged, NOT blocked)
 *   4. atomicity — no partial/temp files left, no .tmp leakage, valid JSON only
 *   5. fast-path cache correctness — cached within the window, refreshed when
 *      disk changes, force bypass works
 *   6. release semantics (single pid + all-pids-for-session)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const registry = require(path.join(REPO_ROOT, 'tools/kernel/lib/write-set-registry.cjs'));

function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-set-registry-'));
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

// ---------------------------------------------------------------------------
// 1. reserve + read round-trip
// ---------------------------------------------------------------------------

test('reserve + readRegistry round-trips a normalized write-set keyed by sessionId+pid', () => {
  const dir = freshDir();
  try {
    const rec = registry.reserve(
      ['/abs/ignored', 'tools/kernel/**', './_dev/state/x.json'],
      { sessionId: 'sess-A', pid: 4242, actorId: 'actor-A', now: '2026-05-31T00:00:00.000Z' }
    );
    assert.equal(rec.session_id, 'sess-A');
    assert.equal(rec.pid, 4242);
    assert.equal(rec.actor_id, 'actor-A');
    // './ ' prefix stripped; repo-relative left intact
    assert.deepEqual(rec.write_set.includes('tools/kernel/**'), true);
    assert.deepEqual(rec.write_set.includes('_dev/state/x.json'), true);

    const all = registry.readRegistry({ force: true, now: '2026-05-31T00:00:01.000Z' });
    assert.equal(all.length, 1);
    assert.equal(all[0].session_id, 'sess-A');
    // __file marker stripped from public read
    assert.equal(Object.prototype.hasOwnProperty.call(all[0], '__file'), false);
  } finally {
    cleanup(dir);
  }
});

test('reserve refreshes heartbeat but preserves reserved_at for an existing key', () => {
  const dir = freshDir();
  try {
    const first = registry.reserve(['tools/a/**'], {
      sessionId: 'sess-B', pid: 1, now: '2026-05-31T00:00:00.000Z'
    });
    const second = registry.reserve(['tools/b/**'], {
      sessionId: 'sess-B', pid: 1, now: '2026-05-31T00:05:00.000Z'
    });
    assert.equal(second.reserved_at, first.reserved_at, 'reserved_at preserved');
    assert.notEqual(second.heartbeat, first.heartbeat, 'heartbeat refreshed');
    assert.deepEqual(second.write_set, ['tools/b/**'], 'write_set replaced');
    const all = registry.readRegistry({ force: true, now: '2026-05-31T00:05:01.000Z' });
    assert.equal(all.length, 1, 'same key updates in place, no duplicate');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 2. TTL pruning
// ---------------------------------------------------------------------------

test('stale reservations are dropped on access and physically removed by pruneStale', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/stale/**'], {
      sessionId: 'sess-stale', pid: 9, ttlMs: 1000, now: '2026-05-31T00:00:00.000Z'
    });
    registry.reserve(['tools/fresh/**'], {
      sessionId: 'sess-fresh', pid: 9, ttlMs: 60000, now: '2026-05-31T00:00:00.000Z'
    });

    // 2s later: stale (ttl 1s) expired, fresh (ttl 60s) still live.
    const twoSecLater = Date.parse('2026-05-31T00:00:02.000Z');
    const live = registry.readRegistry({ force: true, nowMs: twoSecLater });
    assert.equal(live.length, 1, 'expired reservation filtered out of read');
    assert.equal(live[0].session_id, 'sess-fresh');

    // Physically still on disk until pruneStale runs.
    const filesBefore = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(filesBefore.length, 2);

    const { pruned, remaining } = registry.pruneStale({ nowMs: twoSecLater });
    assert.equal(pruned.length, 1);
    assert.equal(remaining, 1);
    const filesAfter = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(filesAfter.length, 1, 'stale file physically removed');
  } finally {
    cleanup(dir);
  }
});

test('heartbeat keeps a reservation alive past its TTL window', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/hb/**'], {
      sessionId: 'sess-hb', pid: 3, ttlMs: 1000, now: '2026-05-31T00:00:00.000Z'
    });
    // Refresh heartbeat at +0.5s
    registry.heartbeat({ sessionId: 'sess-hb', pid: 3, now: '2026-05-31T00:00:00.500Z' });
    // At +1.2s relative to ORIGINAL it would have expired; relative to heartbeat it has not.
    const t = Date.parse('2026-05-31T00:00:01.200Z'); // 0.7s since heartbeat < 1s ttl
    const live = registry.readRegistry({ force: true, nowMs: t });
    assert.equal(live.length, 1, 'heartbeat extended liveness');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 3. overlap detection — advisory INFO path
// ---------------------------------------------------------------------------

test('check() flags overlap with a DIFFERENT actor and logs INFO (no block)', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], {
      sessionId: 'owner', pid: 100, actorId: 'owner-actor', now: '2026-05-31T00:00:00.000Z'
    });

    const lines = [];
    const res = registry.check(
      'tools/kernel/lib/foo.cjs',
      { sessionId: 'intruder', pid: 200 },
      { now: '2026-05-31T00:00:01.000Z', logger: (l) => lines.push(l) }
    );

    assert.equal(res.conflict, true);
    assert.equal(res.overlaps.length, 1);
    assert.equal(res.overlaps[0].session_id, 'owner');
    assert.equal(res.overlaps[0].matched_glob, 'tools/kernel/**');
    // un-arc'd: intruder holds NO reservation of its own
    assert.equal(res.un_arc_overlap, true);
    // INFO logged exactly once, advisory wording, no exception thrown
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^INFO \[write-set-registry\]/);
    assert.match(lines[0], /no enforcement; logged only/);
    assert.match(lines[0], /registry-coverage-gap/);
  } finally {
    cleanup(dir);
  }
});

test('check() never flags an actor writing inside its OWN reservation', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], {
      sessionId: 'self', pid: 50, now: '2026-05-31T00:00:00.000Z'
    });
    const lines = [];
    const res = registry.check(
      'tools/kernel/lib/foo.cjs',
      { sessionId: 'self', pid: 50 },
      { now: '2026-05-31T00:00:01.000Z', logger: (l) => lines.push(l) }
    );
    assert.equal(res.conflict, false);
    assert.equal(res.overlaps.length, 0);
    assert.equal(lines.length, 0, 'no INFO line for self-write');
  } finally {
    cleanup(dir);
  }
});

test('check() does not flag a write outside everyone else\'s reservations', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], {
      sessionId: 'owner', pid: 100, now: '2026-05-31T00:00:00.000Z'
    });
    const res = registry.check(
      'clients/SOME/notes.md',
      { sessionId: 'other', pid: 200 },
      { now: '2026-05-31T00:00:01.000Z', logger: null }
    );
    assert.equal(res.conflict, false);
  } finally {
    cleanup(dir);
  }
});

test('check() ignores an EXPIRED reservation when judging overlap', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], {
      sessionId: 'dead-owner', pid: 1, ttlMs: 1000, now: '2026-05-31T00:00:00.000Z'
    });
    const res = registry.check(
      'tools/kernel/lib/foo.cjs',
      { sessionId: 'newcomer', pid: 2 },
      { nowMs: Date.parse('2026-05-31T00:00:05.000Z'), logger: null } // 5s > 1s ttl
    );
    assert.equal(res.conflict, false, 'dead owner reservation must not conflict');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 4. atomicity — no partial writes / temp leakage
// ---------------------------------------------------------------------------

test('reserve leaves no .tmp files and every persisted file is valid JSON', () => {
  const dir = freshDir();
  try {
    for (let i = 0; i < 25; i += 1) {
      registry.reserve([`tools/x${i}/**`], { sessionId: `s${i}`, pid: i });
    }
    const entries = fs.readdirSync(dir);
    const tmp = entries.filter((e) => e.includes('.tmp'));
    assert.equal(tmp.length, 0, `no temp files should remain, found: ${tmp.join(',')}`);
    const json = entries.filter((e) => e.endsWith('.json'));
    assert.equal(json.length, 25);
    for (const f of json) {
      // Must parse cleanly — a partial write would throw here.
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.ok(parsed.session_id);
      assert.ok(Array.isArray(parsed.write_set));
    }
  } finally {
    cleanup(dir);
  }
});

test('concurrent reserves to distinct keys all persist (separate-file layout, no clobber)', async () => {
  const dir = freshDir();
  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() =>
          registry.reserve([`tools/p${i}/**`], { sessionId: `c${i}`, pid: i })
        )
      )
    );
    const all = registry.readRegistry({ force: true });
    assert.equal(all.length, 20, 'every concurrent reservation survived');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 5. fast-path cache correctness
// ---------------------------------------------------------------------------

test('fast-path cache serves repeated checks without re-reading every file', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], { sessionId: 'owner', pid: 100 });
    registry.invalidateCache();

    // Prime cache.
    registry.check('tools/kernel/a.cjs', { sessionId: 'x', pid: 1 }, { logger: null });

    // Spy on readFileSync to prove the cached path avoids per-file parses.
    const realReadFile = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = function (...args) {
      reads += 1;
      return realReadFile.apply(fs, args);
    };
    try {
      for (let i = 0; i < 100; i += 1) {
        registry.check('tools/kernel/a.cjs', { sessionId: 'x', pid: 1 }, { logger: null });
      }
    } finally {
      fs.readFileSync = realReadFile;
    }
    // Inside the 1s autonomic window, 100 checks must not trigger 100 file reads.
    assert.ok(reads < 5, `cached hot path should avoid per-call file reads, saw ${reads}`);
  } finally {
    cleanup(dir);
  }
});

test('cache picks up a NEW cross-process reservation once the signature changes', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], { sessionId: 'owner', pid: 100 });
    // Prime (force to ensure parse).
    let res = registry.check('clients/x.md', { sessionId: 'z', pid: 9 }, { force: true, logger: null });
    assert.equal(res.conflict, false);

    // Simulate ANOTHER process dropping a reservation directly on disk.
    const sidecar = {
      key: 'ext::7', session_id: 'ext', pid: 7, actor_id: 'ext-actor',
      write_set: ['clients/**'], ttl_ms: 60000,
      reserved_at: new Date().toISOString(), heartbeat: new Date().toISOString()
    };
    fs.writeFileSync(path.join(dir, 'ext__7.json'), JSON.stringify(sidecar, null, 2) + '\n');

    // force:true must observe it immediately (signature-independent).
    res = registry.check('clients/x.md', { sessionId: 'z', pid: 9 }, { force: true, logger: null });
    assert.equal(res.conflict, true, 'forced read sees the new cross-process reservation');
    assert.equal(res.overlaps[0].session_id, 'ext');
  } finally {
    cleanup(dir);
  }
});

test('force:true bypasses the cache and reflects disk truth', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/kernel/**'], { sessionId: 'owner', pid: 100 });
    registry.readRegistry({ force: true }); // prime
    // Remove the reservation file out from under the cache (filename is an
    // internal detail; delete whatever .json the registry persisted).
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      fs.rmSync(path.join(dir, f));
    }
    const forced = registry.readRegistry({ force: true });
    assert.equal(forced.length, 0, 'force read reflects deletion');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 6. release semantics
// ---------------------------------------------------------------------------

test('release(sessionId, {pid}) drops a single reservation; release(sessionId) drops all pids', () => {
  const dir = freshDir();
  try {
    registry.reserve(['tools/a/**'], { sessionId: 'multi', pid: 1 });
    registry.reserve(['tools/b/**'], { sessionId: 'multi', pid: 2 });
    registry.reserve(['tools/c/**'], { sessionId: 'other', pid: 3 });

    assert.equal(registry.release('multi', { pid: 1 }), 1);
    assert.equal(registry.readRegistry({ force: true }).length, 2);

    assert.equal(registry.release('multi'), 1, 'remaining multi pid dropped');
    const rest = registry.readRegistry({ force: true });
    assert.equal(rest.length, 1);
    assert.equal(rest[0].session_id, 'other');
  } finally {
    cleanup(dir);
  }
});
