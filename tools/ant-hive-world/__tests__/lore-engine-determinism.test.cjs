'use strict';

// Plan ant-hive-world-lore-wiki-layer, S4 required gate: prove the
// COSMETIC-ONLY claim mechanically, not by prose. The lore-engine watcher
// must never write to world-state.json, any hive's hive-state.json, or
// any hive's audit-log.jsonl -- those are byte-identical before and after
// a full poll cycle, even though the watcher genuinely ran (proven by its
// OWN output files existing afterward).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { setupTwoHives, tick } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');
const { pollAllHives } = require('../lore-engine/watch.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-lore-determinism-'));
}

// A trivial deterministic decideFn -- cycles through verbs so the run
// produces a real mix of gather/build/claim-territory/idle audit entries,
// without depending on untrained-network.js at all (this test is about the
// lore engine's write-boundary, not about RL behavior).
function makeCyclingDecideFn() {
  const verbs = ['gather', 'build', 'claim-territory', 'idle'];
  let i = 0;
  return ({ hiveState }) => {
    const verb = verbs[i % verbs.length];
    i += 1;
    if (verb === 'gather') return { verb, resourceKey: 'wood', amount: 1 };
    if (verb === 'claim-territory') return { verb, tileId: `tile-${i % 5}` };
    if (verb === 'build') return { verb, entry: { kind: 'tunnel', coords: [i, 0, 0] } };
    return { verb };
  };
}

test('a full lore-engine poll cycle never mutates world-state.json, hive-state.json, or audit-log.jsonl', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-17T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-17T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { wood: 40, stone: 10, food: 20 });

  const decideFnA = makeCyclingDecideFn();
  const decideFnB = makeCyclingDecideFn();
  for (let i = 0; i < 30; i++) {
    tick(hiveA, worldStatePath, decideFnA, {}, () => 0.5);
    tick(hiveB, worldStatePath, decideFnB, {}, () => 0.5);
  }

  const filesToCheck = [
    worldStatePath,
    hiveA.hiveStatePath,
    hiveB.hiveStatePath,
    hiveA.auditLogPath,
    hiveB.auditLogPath
  ];
  const before = Object.fromEntries(filesToCheck.map((p) => [p, fs.readFileSync(p, 'utf8')]));

  const dispatchFn = () => ({ verdict: 'ok', response: 'The colony records another quiet day.', model: 'test-model' });
  const summaries = pollAllHives(root, worldStatePath, { dispatchFn });

  // Sanity: the watcher genuinely ran and detected/generated something --
  // this is not a vacuous pass from the watcher doing nothing.
  assert.ok(summaries.some((s) => s.triggers_detected > 0), 'expected the poll to detect at least one trigger across both hives');
  assert.ok(summaries.some((s) => s.generated > 0), 'expected at least one wiki entry to actually be generated');

  for (const p of filesToCheck) {
    assert.equal(fs.readFileSync(p, 'utf8'), before[p], `expected ${p} to be byte-identical after the lore-engine poll, but it changed`);
  }

  // Confirm the watcher's OWN output files DO exist -- proving determinism
  // holds because of a genuine read-only boundary, not because the watcher
  // silently no-op'd.
  assert.ok(fs.existsSync(path.join(root, 'hive-a', 'wiki-log.jsonl')) || fs.existsSync(path.join(root, 'hive-b', 'wiki-log.jsonl')));
  assert.ok(fs.existsSync(path.join(root, 'hive-a', 'wiki-checkpoint.json')));
  assert.ok(fs.existsSync(path.join(root, 'hive-b', 'wiki-checkpoint.json')));
});

test('running the poll cycle twice in a row still never mutates sim-mechanics files, even with a populated checkpoint/retry state', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-17T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-17T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { wood: 40, stone: 10, food: 20 });

  const decideFnA = makeCyclingDecideFn();
  const decideFnB = makeCyclingDecideFn();
  for (let i = 0; i < 15; i++) {
    tick(hiveA, worldStatePath, decideFnA, {}, () => 0.5);
    tick(hiveB, worldStatePath, decideFnB, {}, () => 0.5);
  }

  // First poll uses a failing dispatch (populates the retry queue), second
  // poll uses a succeeding one -- neither should ever touch sim files.
  pollAllHives(root, worldStatePath, { dispatchFn: () => ({ verdict: 'timeout', error: 'unreachable' }) });

  const filesToCheck = [worldStatePath, hiveA.hiveStatePath, hiveB.hiveStatePath, hiveA.auditLogPath, hiveB.auditLogPath];
  const before = Object.fromEntries(filesToCheck.map((p) => [p, fs.readFileSync(p, 'utf8')]));

  pollAllHives(root, worldStatePath, { dispatchFn: () => ({ verdict: 'ok', response: 'Recovered.', model: 'test-model' }) });

  for (const p of filesToCheck) {
    assert.equal(fs.readFileSync(p, 'utf8'), before[p], `expected ${p} to remain byte-identical across a second poll cycle`);
  }
});
