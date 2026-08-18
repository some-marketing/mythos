'use strict';

// Coverage for tools/ant-hive-world/dream/dream-memory.js -- plan
// world-mind-dream-communication, S1. AC1, AC10, AC12.
//
// NOTE ON OWNERSHIP: the plan's S1 owned_artifacts list names the vault data
// file, its schema, and run-live.js, but not the writer module itself, even
// though S1's own detail text requires a "vault-commit step" and a
// "resume reconciliation pass" to exist as code somewhere. Every other dream
// module in this plan (consequence-ledger.js, calibration.js,
// dream-composer.js, dream-lane.js) lives under tools/ant-hive-world/dream/,
// so the vault writer follows that established convention as
// tools/ant-hive-world/dream/dream-memory.js -- a declared deviation, not an
// improvisation against the plan's substance (see the implementation
// receipt).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dreamMemory = require('../dream/dream-memory.js');

function tmpVaultPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-memory-test-'));
  return path.join(dir, 'dream-memory.jsonl');
}

test('seedVault creates the vault with entry 0 = operator doctrine, supersession chain intact', () => {
  const vaultPath = tmpVaultPath();
  const result = dreamMemory.seedVault(vaultPath);
  assert.equal(result.created, true);
  assert.ok(fs.existsSync(vaultPath));

  const entries = dreamMemory.materialize(vaultPath);
  assert.equal(entries.length, 1);
  const entry0 = entries[0];
  assert.equal(entry0.entry_id, 0);
  assert.equal(entry0.entry_type, 'doctrine');
  assert.equal(entry0.domain, 'sim-world-mind');
  assert.equal(entry0.generation_id, null);
  assert.equal(entry0.provenance.source, 'operator');
  assert.deepEqual(entry0.text_or_data.captured_at, '2026-08-12T16:13Z');
  assert.deepEqual(entry0.text_or_data.corrected_at, '2026-08-12T16:17Z');
  assert.deepEqual(entry0.text_or_data.addendum_at, '2026-08-12T16:19Z');
  assert.deepEqual(entry0.text_or_data.consolidated_at, '2026-08-12T18:04Z');
  assert.equal(entry0.text_or_data.text, dreamMemory.CONSOLIDATED_WORDING);
});

test('seedVault is idempotent -- calling it twice never rewrites an existing vault', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  const bytesBefore = fs.readFileSync(vaultPath);
  const second = dreamMemory.seedVault(vaultPath);
  assert.equal(second.created, false);
  assert.deepEqual(fs.readFileSync(vaultPath), bytesBefore);
});

test('AC1: append-only invariant -- a second write never alters entry 0\'s original bytes', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  const firstLineBefore = fs.readFileSync(vaultPath, 'utf8').split('\n')[0];

  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence',
    lane: 'darkness',
    text_or_data: { patch_id: 'tile-1', event: 'patch_extinction' },
    provenance: { source: 'world-state', ref: 'tick-42' },
    generation_id: 'gen-1-run'
  });
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream',
    lane: 'hope',
    text_or_data: { text: 'a hive survived the winter' },
    provenance: { source: 'run-log.jsonl', ref: 'rows 10-20' },
    generation_id: 'gen-1-run'
  });

  const firstLineAfter = fs.readFileSync(vaultPath, 'utf8').split('\n')[0];
  assert.equal(firstLineAfter, firstLineBefore, 'entry 0\'s original line must be byte-identical after later writes');

  const entries = dreamMemory.materialize(vaultPath);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].commit_status, 'pending');
  assert.equal(entries[2].commit_status, 'pending');
});

test('appendEntry rejects a missing provenance rather than writing a null-provenance entry', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  assert.throws(() => {
    dreamMemory.appendEntry(vaultPath, {
      entry_type: 'consequence',
      lane: 'darkness',
      text_or_data: { patch_id: 'tile-1' },
      provenance: null,
      generation_id: 'gen-1-run'
    });
  }, /provenance/);
});

test('appendEntry rejects a missing generation_id for a non-doctrine entry', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  assert.throws(() => {
    dreamMemory.appendEntry(vaultPath, {
      entry_type: 'consequence',
      lane: 'darkness',
      text_or_data: { patch_id: 'tile-1' },
      provenance: { source: 'world-state', ref: 'tick-1' },
      generation_id: null
    });
  }, /generation_id/);
});

test('AC12: commitGenerationEntries flips exactly the pending entries carrying that generation_id, no others', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'world-state', ref: 'r1' }, generation_id: 'gen-A'
  });
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 2 },
    provenance: { source: 'world-state', ref: 'r2' }, generation_id: 'gen-A'
  });
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream', lane: 'hope', text_or_data: { a: 3 },
    provenance: { source: 'run-log.jsonl', ref: 'r3' }, generation_id: 'gen-B'
  });

  // Fixture stubbed checkpoint.commitGeneration() -- mirrors run-live.js's
  // real commitCheckpoint()/checkpoint.commitGeneration() call, per S1's
  // commit-wiring spec.
  const stubbedResult = { generation_id: 'gen-A', dir: '/fixture/gen-A', manifest: {} };
  const flip = dreamMemory.commitGenerationEntries(vaultPath, stubbedResult.generation_id);

  const entries = dreamMemory.materialize(vaultPath);
  const genA = entries.filter((e) => e.generation_id === 'gen-A');
  const genB = entries.filter((e) => e.generation_id === 'gen-B');
  assert.equal(genA.length, 2);
  assert.ok(genA.every((e) => e.commit_status === 'committed'));
  assert.equal(genB.length, 1);
  assert.equal(genB[0].commit_status, 'pending', 'a different generation_id must be untouched');
  assert.deepEqual(flip.flipped.sort(), genA.map((e) => e.entry_id).sort());
});

test('commitGenerationEntries against a nonexistent vault is a guarded no-op', () => {
  const vaultPath = tmpVaultPath();
  const result = dreamMemory.commitGenerationEntries(vaultPath, 'gen-A');
  assert.deepEqual(result, { flipped: [] });
  assert.equal(fs.existsSync(vaultPath), false, 'a stock run must never create the vault as a side effect');
});

// --- finalizeRunTerminal (S4b amendment, operator ratification
// 2026-08-13T16:46Z, call S4b-3): the terminal status for entries written
// under a run with no checkpoint commit lifecycle (ablation/trial runs). ---

test('finalizeRunTerminal flips exactly the pending entries carrying that run_id, no others', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'forecast', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'run-log.jsonl', ref: 'r1' }, generation_id: '/fixture/run-A/world-state.json'
  });
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream', lane: 'hope', text_or_data: { a: 2 },
    provenance: { source: 'run-log.jsonl', ref: 'r2' }, generation_id: '/fixture/run-A/world-state.json'
  });
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream', lane: 'hope', text_or_data: { a: 3 },
    provenance: { source: 'run-log.jsonl', ref: 'r3' }, generation_id: '/fixture/run-B/world-state.json'
  });

  const result = dreamMemory.finalizeRunTerminal(vaultPath, '/fixture/run-A/world-state.json');
  assert.equal(result.flipped.length, 2);

  const entries = dreamMemory.materialize(vaultPath);
  const runA = entries.filter((e) => e.generation_id === '/fixture/run-A/world-state.json');
  const runB = entries.filter((e) => e.generation_id === '/fixture/run-B/world-state.json');
  assert.ok(runA.every((e) => e.commit_status === 'run-terminal'), 'every run-A entry must reach the terminal run-terminal status');
  assert.ok(runB.every((e) => e.commit_status === 'pending'), 'run-B\'s own entries must be untouched by run-A\'s finalization');
});

test('finalizeRunTerminal never touches an entry already committed or quarantined', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'forecast', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'run-log.jsonl', ref: 'r1' }, generation_id: 'run-C'
  });
  dreamMemory.commitGenerationEntries(vaultPath, 'run-C'); // simulate a real commit landing for this generation_id

  const result = dreamMemory.finalizeRunTerminal(vaultPath, 'run-C');
  assert.deepEqual(result.flipped, [], 'an already-committed entry is not pending, so finalization has nothing to flip');
  const entries = dreamMemory.materialize(vaultPath);
  assert.ok(entries.find((e) => e.generation_id === 'run-C').commit_status === 'committed');
});

test('finalizeRunTerminal against a nonexistent vault is a guarded no-op', () => {
  const vaultPath = tmpVaultPath();
  const result = dreamMemory.finalizeRunTerminal(vaultPath, 'run-X');
  assert.deepEqual(result, { flipped: [] });
  assert.equal(fs.existsSync(vaultPath), false, 'a run that wrote nothing must never create the vault just to finalize it');
});

test('finalizeRunTerminal is idempotent -- a second call for the same run_id flips nothing further', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'forecast', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'run-log.jsonl', ref: 'r1' }, generation_id: 'run-D'
  });
  const first = dreamMemory.finalizeRunTerminal(vaultPath, 'run-D');
  assert.equal(first.flipped.length, 1);
  const second = dreamMemory.finalizeRunTerminal(vaultPath, 'run-D');
  assert.deepEqual(second.flipped, []);
});

test('COMMIT_STATUSES includes run-terminal', () => {
  assert.ok(dreamMemory.COMMIT_STATUSES.includes('run-terminal'));
});

test('AC10(a): resume reconciliation quarantines pending entries whose generation has no committed manifest (rolled-back generation)', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'world-state', ref: 'r1' }, generation_id: 'gen-rolled-back'
  });

  const fixtureCheckpointRoot = '/fixture/checkpoints';
  const checkpointStub = { isCommitted: () => false };
  const result = dreamMemory.reconcileOnResume(vaultPath, fixtureCheckpointRoot, checkpointStub);

  assert.equal(result.quarantined.length, 1);
  assert.equal(result.promoted.length, 0);
  const entries = dreamMemory.materialize(vaultPath);
  const target = entries.find((e) => e.generation_id === 'gen-rolled-back');
  assert.equal(target.commit_status, 'quarantined');
});

test('AC10(b): resume reconciliation promotes pending entries whose checkpoint manifest DOES exist (the crash-window case)', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream', lane: 'hope', text_or_data: { a: 1 },
    provenance: { source: 'run-log.jsonl', ref: 'r1' }, generation_id: 'gen-crashed-after-commit'
  });

  const fixtureCheckpointRoot = '/fixture/checkpoints';
  const checkpointStub = { isCommitted: () => true };
  const result = dreamMemory.reconcileOnResume(vaultPath, fixtureCheckpointRoot, checkpointStub);

  assert.equal(result.promoted.length, 1);
  assert.equal(result.quarantined.length, 0);
  const entries = dreamMemory.materialize(vaultPath);
  const target = entries.find((e) => e.generation_id === 'gen-crashed-after-commit');
  assert.equal(target.commit_status, 'committed');
});

test('reconciliation never touches already-committed or already-quarantined entries', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'world-state', ref: 'r1' }, generation_id: 'gen-A'
  });
  dreamMemory.commitGenerationEntries(vaultPath, 'gen-A');

  const checkpointStub = { isCommitted: () => false };
  const result = dreamMemory.reconcileOnResume(vaultPath, '/fixture/checkpoints', checkpointStub);
  assert.deepEqual(result, { promoted: [], quarantined: [] });

  const entries = dreamMemory.materialize(vaultPath);
  const target = entries.find((e) => e.generation_id === 'gen-A');
  assert.equal(target.commit_status, 'committed', 'a settled entry must not be reconsidered');
});

// --- codex fold review MINOR fix: lineage MEMBERSHIP, not just existence ---

test('lineage-membership fixtures: isOnActiveLineage walks the manifest parent chain', () => {
  const checkpointRoot = '/fixture/checkpoints';
  // gen-3 -> gen-2 -> gen-1 -> root (parent.generation_id: null)
  const manifests = {
    'gen-1': { generation_id: 'gen-1', parent: { generation_id: null } },
    'gen-2': { generation_id: 'gen-2', parent: { generation_id: 'gen-1' } },
    'gen-3': { generation_id: 'gen-3', parent: { generation_id: 'gen-2' } }
  };
  const checkpointStub = {
    readManifest: (dir) => {
      const id = dir.split('/').pop();
      return manifests[id] ? { committed: true, manifest: manifests[id] } : { committed: false, manifest: null };
    }
  };
  const resumedManifest = manifests['gen-3'];
  assert.equal(dreamMemory.isOnActiveLineage(checkpointRoot, checkpointStub, resumedManifest, 'gen-3'), true, 'the resumed generation itself is on its own lineage');
  assert.equal(dreamMemory.isOnActiveLineage(checkpointRoot, checkpointStub, resumedManifest, 'gen-2'), true, 'a direct ancestor is on the lineage');
  assert.equal(dreamMemory.isOnActiveLineage(checkpointRoot, checkpointStub, resumedManifest, 'gen-1'), true, 'a transitive ancestor is on the lineage');
  assert.equal(dreamMemory.isOnActiveLineage(checkpointRoot, checkpointStub, resumedManifest, 'gen-abandoned'), false, 'a generation outside the ancestor chain is not on the lineage');
});

test('AC10 extended: a committed manifest from an ABANDONED branch is quarantined, not promoted, when resumedManifest is supplied', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'world-state', ref: 'r1' }, generation_id: 'gen-abandoned-branch'
  });

  const resumedManifest = { generation_id: 'gen-2', parent: { generation_id: 'gen-1' } };
  const manifests = {
    'gen-1': { generation_id: 'gen-1', parent: { generation_id: null } },
    'gen-2': resumedManifest
    // 'gen-abandoned-branch' deliberately absent from the ancestor chain --
    // it committed on a branch that was since abandoned in favor of gen-1/gen-2.
  };
  const checkpointStub = {
    // The manifest DOES exist on disk (it committed once) -- existence alone
    // would wrongly promote it.
    isCommitted: () => true,
    readManifest: (dir) => {
      const id = dir.split('/').pop();
      return manifests[id] ? { committed: true, manifest: manifests[id] } : { committed: false, manifest: null };
    }
  };
  const result = dreamMemory.reconcileOnResume(vaultPath, '/fixture/checkpoints', checkpointStub, resumedManifest);

  assert.equal(result.quarantined.length, 1, 'existence without lineage membership must still quarantine');
  assert.equal(result.promoted.length, 0);
  const entries = dreamMemory.materialize(vaultPath);
  assert.equal(entries.find((e) => e.generation_id === 'gen-abandoned-branch').commit_status, 'quarantined');
});

test('AC10 extended: a committed manifest that IS an ancestor of the resumed generation is promoted when resumedManifest is supplied', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream', lane: 'hope', text_or_data: { a: 1 },
    provenance: { source: 'run-log.jsonl', ref: 'r1' }, generation_id: 'gen-1'
  });

  const resumedManifest = { generation_id: 'gen-2', parent: { generation_id: 'gen-1' } };
  const manifests = {
    'gen-1': { generation_id: 'gen-1', parent: { generation_id: null } },
    'gen-2': resumedManifest
  };
  const checkpointStub = {
    isCommitted: () => true,
    readManifest: (dir) => {
      const id = dir.split('/').pop();
      return manifests[id] ? { committed: true, manifest: manifests[id] } : { committed: false, manifest: null };
    }
  };
  const result = dreamMemory.reconcileOnResume(vaultPath, '/fixture/checkpoints', checkpointStub, resumedManifest);

  assert.equal(result.promoted.length, 1);
  assert.equal(result.quarantined.length, 0);
  const entries = dreamMemory.materialize(vaultPath);
  assert.equal(entries.find((e) => e.generation_id === 'gen-1').commit_status, 'committed');
});

test('reconciliation without resumedManifest falls back to existence-only checking (the documented boundary)', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'world-state', ref: 'r1' }, generation_id: 'gen-exists-but-unverifiable'
  });
  // No readManifest on this stub -- proves the fallback path never calls it.
  const checkpointStub = { isCommitted: () => true };
  const result = dreamMemory.reconcileOnResume(vaultPath, '/fixture/checkpoints', checkpointStub);
  assert.equal(result.promoted.length, 1, 'existence-only fallback promotes on isCommitted() alone when no resumedManifest is given');
});

test('activeEntries excludes quarantined entries but includes pending and committed ones', () => {
  const vaultPath = tmpVaultPath();
  dreamMemory.seedVault(vaultPath);
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'consequence', lane: 'darkness', text_or_data: { a: 1 },
    provenance: { source: 'world-state', ref: 'r1' }, generation_id: 'gen-quarantined'
  });
  dreamMemory.appendEntry(vaultPath, {
    entry_type: 'dream', lane: 'hope', text_or_data: { a: 2 },
    provenance: { source: 'run-log.jsonl', ref: 'r2' }, generation_id: 'gen-pending'
  });
  dreamMemory.reconcileOnResume(vaultPath, '/fixture/checkpoints', {
    isCommitted: (dir) => dir.endsWith('gen-pending')
  });

  const active = dreamMemory.activeEntries(vaultPath);
  assert.ok(active.some((e) => e.generation_id === 'gen-pending'));
  assert.ok(!active.some((e) => e.generation_id === 'gen-quarantined'));
  assert.ok(active.some((e) => e.entry_id === 0), 'doctrine entry 0 stays active');
});
