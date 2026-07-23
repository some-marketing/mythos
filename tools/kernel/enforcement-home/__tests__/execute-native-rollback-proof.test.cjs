'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../enforcement-home-registry.cjs');
const { executeRollbackProof } = require('../execute-native-rollback-proof.cjs');

test('rollback proof reads the new owner without restart, marks native degraded, and restores accepted native ownership', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-rollback-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  registry.initializeRegistry(root, { now: '2026-07-17T12:00:00.000Z' });
  registry.promoteNative(root, { now: '2026-07-17T12:01:00.000Z', reason: 'accepted-gate:test' });
  fs.mkdirSync(path.join(root, '_dev/state/debrief-closeout'), { recursive: true });
  fs.writeFileSync(path.join(root, '_dev/state/debrief-closeout/native-promotion-gate.json'), '{}\n');
  const times = ['2026-07-17T12:02:00.000Z', '2026-07-17T12:03:00.000Z', '2026-07-17T12:04:00.000Z', '2026-07-17T12:05:00.000Z'];
  const result = executeRollbackProof(root, '_dev/state/debrief-closeout/native-promotion-gate.json', {
    validateGate() { return { ok: true, errors: [] }; },
    now() { return times.shift(); }
  });
  assert.equal(result.receipt.next_evaluation_without_restart.blocking_owner, 'claude_hook');
  assert.deepEqual(result.receipt.next_evaluation_without_restart.native_fork, { mode: 'report-only', health: 'degraded' });
  assert.equal(result.receipt.final.blocking_owner, 'native_fork');
  assert.equal(result.receipt.stale_owner_epoch_proof.native_after_rollback.ok, false);
  assert.equal(result.receipt.stale_owner_epoch_proof.native_after_rollback.reason, 'stale-epoch');
  assert.equal(result.receipt.stale_owner_epoch_proof.claude_after_restore.ok, false);
  assert.equal(result.receipt.stale_owner_epoch_proof.claude_after_restore.reason, 'stale-epoch');
  assert.equal(result.receipt.stale_owner_epoch_proof.final_native_authorization.ok, true);
  assert.equal(registry.protocolView(root).protocol.blocking_owner, 'native_fork');
  assert.equal(fs.existsSync(path.join(root, result.receipt_path)), true);
});
