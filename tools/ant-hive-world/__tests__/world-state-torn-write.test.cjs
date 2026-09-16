'use strict';

// Crash-safety test for the SHARED world-state file's atomic write
// (temp + rename), plan sim-foundation-repairs S9 (E2).
//
// README.md:20-21 claims: "Tear-free atomic writes (temp file + rename) so a
// crash mid-write never corrupts the shared state for the next reader."
// isolation.test.cjs checklist 3 injects a torn write only into the PER-HIVE
// file; nothing exercised world-state.json itself. This file closes that gap
// by driving the REAL reader (world-state.js readWorldState) against injected
// torn/mid-rename states.
//
// Red-first note (recorded per plan S9): a probe of the shipped reader
// (world-state.js readWorldState) shows it ALREADY refuses torn files -- it
// returns null on any parse failure and on complete !== true (the envelope
// guard, world-state.js:63-72), so callers fall back to last-good. There is
// no reader defect to fix; this test pins the existing behavior so the README
// claim is exercised, and is green immediately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { readWorldState, writeWorldState, initialWorldState } = require('../world-state.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-torn-'));
}

test('a torn .tmp (crash between temp write and rename) never corrupts the read path', () => {
  const root = freshSandbox();
  const p = path.join(root, 'shared', 'world-state.json');
  writeWorldState(p, initialWorldState({}));
  const before = readWorldState(p);
  assert.notEqual(before, null);
  assert.equal(before.complete, true);

  // Simulate a crash mid-write: the temp file exists with torn content and
  // the rename never ran. The reader must keep returning the last-good state
  // file at the target path -- the .tmp is an orphan that never appears in
  // the read path.
  fs.writeFileSync(p + '.tmp', '{"schema_version":"1.1.0","seq":99,"complete":true, TORN');

  const after = readWorldState(p);
  assert.notEqual(after, null, 'a torn .tmp must not corrupt the next read of world-state.json');
  assert.equal(after.complete, true);
  assert.equal(after.seq, before.seq, 'reader must return the last-good state, not the torn temp');
});

test('a torn target file (mid-rename/crash leaves the target itself torn) is refused, and a fresh write recovers', () => {
  const root = freshSandbox();
  const p = path.join(root, 'shared', 'world-state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });

  // Torn content at the target path itself (e.g. a crash that truncated the
  // destination, or a non-atomic writer interrupted mid-write).
  fs.writeFileSync(p, '{"schema_version":"1.1.0","seq":7,"complete":true, TORN');
  assert.equal(readWorldState(p), null, 'reader must REFUSE a torn target, not return corrupt partial data');

  // Recovery: the next writer re-establishes a complete state with the
  // atomic discipline; the reader returns it cleanly.
  writeWorldState(p, initialWorldState({}));
  const recovered = readWorldState(p);
  assert.notEqual(recovered, null);
  assert.equal(recovered.complete, true);
});

test('a file that parses but is not complete (complete !== true) is refused by the envelope guard', () => {
  const root = freshSandbox();
  const p = path.join(root, 'shared', 'world-state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });

  // Two refusal shapes: explicit complete:false and a structurally valid
  // object that simply lacks the complete envelope (e.g. an old-format file).
  for (const body of [
    '{"schema_version":"1.1.0","seq":1,"complete":false}',
    '{"schema_version":"1.1.0","seq":1}'
  ]) {
    fs.writeFileSync(p, body);
    assert.equal(readWorldState(p), null, `expected refusal for body: ${body}`);
  }
});

test('a missing state file reads as null -- "no state yet" is a clean fallback, never a throw', () => {
  const root = freshSandbox();
  assert.equal(readWorldState(path.join(root, 'never-written.json')), null);
});

test('writeWorldState leaves no .tmp residue and produces a complete, parseable target', () => {
  const root = freshSandbox();
  const p = path.join(root, 'shared', 'world-state.json');
  writeWorldState(p, initialWorldState({}));

  assert.equal(fs.existsSync(p + '.tmp'), false, 'temp+rename must consume the .tmp (no residue)');
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(parsed.complete, true);
  assert.equal(parsed.seq, 1, 'fresh write starts the sequence at 1');
});
