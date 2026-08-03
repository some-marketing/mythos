'use strict';

// G-ISO verification: isolation demonstrated as a concrete checklist +
// fault-injection, not just asserted. Checklist items:
//   1. Separate sandbox directory per hive (no shared files between them).
//   2. No shared module/process with crow-alien-world's or cat-world's harness.
//   3. A corrupted/torn write from one hive does not corrupt the other hive's
//      state or the shared world-state file for the next reader.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { setupTwoHives, tick } = require('../harness.js');
const { readWorldState } = require('../world-state.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-iso-'));
}

test('checklist 1: hive sandboxes are separate directories with no cross-references', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, {});

  assert.notEqual(path.resolve(hiveA.dir), path.resolve(hiveB.dir));
  assert.ok(!hiveA.dir.startsWith(hiveB.dir + path.sep) && !hiveB.dir.startsWith(hiveA.dir + path.sep));
});

test('checklist 2: this module does not require()/import cat-world or crow-alien-world harness code', () => {
  // Comments are allowed to EXPLAIN why isolation matters (and do, by design);
  // what must never exist is an actual require()/import path reaching into
  // another lane's harness code. Check require() call targets specifically.
  const harnessSrc = fs.readFileSync(path.join(__dirname, '..', 'harness.js'), 'utf8');
  const worldStateSrc = fs.readFileSync(path.join(__dirname, '..', 'world-state.js'), 'utf8');
  const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const src of [harnessSrc, worldStateSrc]) {
    let m;
    while ((m = requirePattern.exec(src))) {
      const target = m[1];
      assert.ok(!/cat-world/.test(target), `require() target must not reach into cat-world: ${target}`);
      assert.ok(!/crow-alien-world/.test(target), `require() target must not reach into crow-alien-world: ${target}`);
    }
  }
});

test('checklist 3 (fault injection): a torn write to hive-a\'s own state does not corrupt hive-b or the shared world-state', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 3 });

  // Simulate a crash mid-write: hive-a's OWN state file gets truncated/torn.
  // (Not the shared world-state file's atomic-write path, which world-state.js
  // already protects via temp+rename -- this test targets the per-hive file,
  // which harness.js writes directly, to prove the blast radius stays local.)
  fs.writeFileSync(hiveA.hiveStatePath, '{"identity": "hive-a", "hive_state": { TORN');

  // hive-b must be completely unaffected: its own file is untouched and still
  // parses, and the shared world-state (last written before the injected fault)
  // is still valid for the next reader.
  const hiveBState = JSON.parse(fs.readFileSync(hiveB.hiveStatePath, 'utf8'));
  assert.equal(hiveBState.identity, 'hive-b');

  const world = readWorldState(worldStatePath);
  assert.notEqual(world, null);
  assert.equal(world.complete, true);

  // hive-b can still tick normally after hive-a's fault -- the fault does not
  // propagate through the shared file.
  const idle = () => ({ verb: 'idle' });
  const result = tick(hiveB, worldStatePath, idle);
  assert.equal(result.hiveState.identity, 'hive-b');

  // hive-a's own corruption is contained to hive-a: reading it directly
  // throws (as expected for a torn file), but this must never have touched
  // hive-b's directory or the shared state.
  assert.throws(() => JSON.parse(fs.readFileSync(hiveA.hiveStatePath, 'utf8')));
});
