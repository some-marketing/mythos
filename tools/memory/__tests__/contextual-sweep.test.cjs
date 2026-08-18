'use strict';

// Regression coverage for the two codex PR #21 review findings on
// tools/memory/contextual-sweep.js (2026-08-18):
//   1. writeHints() must not let a later sweep pass (empty OR nonempty)
//      discard hints from an earlier pass that contextual-inject.cjs has not
//      yet consumed (per the <sid>.injected.txt receipt).
//   2. The synchronous SessionStart sweep and the 120s launchd sweep can run
//      concurrently; withSessionLock() must serialize them (single-flight)
//      rather than letting two writers race on one session's pending/summary
//      files.
//
// Uses the real HINTS_DIR (gitignored _dev/state/contextual-hints/, excluded
// from the parity baseline) under synthetic session ids unique to this test
// file, cleaned up in `after`.

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const sweep = require('../contextual-sweep.js');
const { writeHints, withSessionLock, HINTS_DIR } = sweep;

const TEST_SID_PREFIX = 'test-contextual-sweep-regression-';

function sid(name) {
  return `${TEST_SID_PREFIX}${name}-${process.pid}`;
}

function paths(id) {
  return {
    summary: path.join(HINTS_DIR, `${id}.tier0.txt`),
    tier0: path.join(HINTS_DIR, `${id}.tier0.jsonl`),
    pending: path.join(HINTS_DIR, `${id}.tier0.pending.json`),
    history: path.join(HINTS_DIR, `${id}.history.jsonl`),
    injected: path.join(HINTS_DIR, `${id}.injected.txt`),
    lock: path.join(HINTS_DIR, `${id}.sweep.lock`),
  };
}

function cleanup(id) {
  for (const p of Object.values(paths(id))) {
    try { fs.unlinkSync(p); } catch { /* not present */ }
  }
}

function hit(refSuffix, score) {
  return { hit_id: `hit-${refSuffix}`, source: 'ledger', ref: `ref-${refSuffix}`, score, label: `label-${refSuffix}` };
}

test('writeHints merges a nonempty later batch instead of discarding unconsumed hits', () => {
  const id = sid('merge-nonempty');
  cleanup(id);
  try {
    writeHints(id, [hit('a', 0.9)]);
    let summary = fs.readFileSync(paths(id).summary, 'utf8');
    assert.match(summary, /ref-a/, 'first batch present after first write');

    // No <sid>.injected.txt receipt exists yet, so the first batch is still
    // "pending" (unconsumed). A second, nonempty sweep must merge, not replace.
    writeHints(id, [hit('b', 0.5)]);
    summary = fs.readFileSync(paths(id).summary, 'utf8');
    assert.match(summary, /ref-a/, 'first batch survives a later nonempty sweep');
    assert.match(summary, /ref-b/, 'second batch is present too');
  } finally {
    cleanup(id);
  }
});

test('writeHints preserves pending hints across an empty later batch', () => {
  const id = sid('merge-empty');
  cleanup(id);
  try {
    writeHints(id, [hit('a', 0.9)]);
    writeHints(id, []);
    const summary = fs.readFileSync(paths(id).summary, 'utf8');
    assert.match(summary, /ref-a/, 'pending hit survives an empty re-sweep');
  } finally {
    cleanup(id);
  }
});

test('writeHints drops prior pending hits once an injected.txt receipt confirms consumption', () => {
  const id = sid('consumed-reset');
  cleanup(id);
  try {
    writeHints(id, [hit('a', 0.9)]);
    const consumedSha = require('crypto').createHash('sha256')
      .update(fs.readFileSync(paths(id).summary)).digest('hex');
    fs.writeFileSync(paths(id).injected, JSON.stringify({ source_hint_sha256: consumedSha }));

    writeHints(id, [hit('b', 0.5)]);
    const summary = fs.readFileSync(paths(id).summary, 'utf8');
    assert.doesNotMatch(summary, /ref-a/, 'consumed hit is not carried forward');
    assert.match(summary, /ref-b/, 'new hit is present');
  } finally {
    cleanup(id);
  }
});

test('withSessionLock is single-flight: a held lock skips a concurrent caller', () => {
  const id = sid('lock-single-flight');
  cleanup(id);
  try {
    // Simulate another process already holding the lock for this session.
    fs.mkdirSync(HINTS_DIR, { recursive: true });
    fs.writeFileSync(paths(id).lock, '');

    let ran = false;
    const result = withSessionLock(id, () => { ran = true; });
    assert.equal(result.skipped, true, 'a held lock is reported as skipped');
    assert.equal(ran, false, 'the callback never runs while the lock is held');

    fs.unlinkSync(paths(id).lock);
    const second = withSessionLock(id, () => { ran = true; });
    assert.equal(second.skipped, false, 'lock is available once released');
    assert.equal(ran, true, 'the callback runs once the lock is free');
    assert.equal(fs.existsSync(paths(id).lock), false, 'the lock is released after the callback completes');
  } finally {
    cleanup(id);
  }
});

test('withSessionLock steals a stale lock instead of skipping forever', () => {
  const id = sid('lock-stale-steal');
  cleanup(id);
  try {
    fs.mkdirSync(HINTS_DIR, { recursive: true });
    fs.writeFileSync(paths(id).lock, '');
    const staleMs = Date.now() - 120000; // older than the 60s staleness window
    fs.utimesSync(paths(id).lock, staleMs / 1000, staleMs / 1000);

    let ran = false;
    const result = withSessionLock(id, () => { ran = true; });
    assert.equal(result.skipped, false, 'a stale lock is stolen, not respected');
    assert.equal(ran, true);
  } finally {
    cleanup(id);
  }
});
