'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { emitSignal, listSignals, closeSignal } = require('../signal-lane.cjs');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'signal-lane-test-'));
}

function cleanupTempRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

describe('signal-lane', () => {
  it('emits a signal into the live surface under a temp root', () => {
    const root = makeTempRoot();
    try {
      const filePath = emitSignal(
        { schema: 'ActorWorkOrder/1.0', dispatch_id: 'test-dispatch-1', continuity: { current_state: 'x', question_work: 'y', desired_state: 'z' } },
        { root }
      );

      assert.equal(fs.existsSync(filePath), true);
      assert.equal(path.dirname(filePath), path.join(root, '_dev', 'reports', 'signals'));

      const written = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.equal(written.schema, 'ActorWorkOrder/1.0');
      assert.equal(written.dispatch_id, 'test-dispatch-1');
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('rejects a signal missing the schema field', () => {
    const root = makeTempRoot();
    try {
      assert.throws(() => emitSignal({ dispatch_id: 'no-schema' }, { root }), /schema/);
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('rejects a signal missing caller-declared required fields', () => {
    const root = makeTempRoot();
    try {
      assert.throws(
        () => emitSignal({ schema: 'ActorWorkOrder/1.0' }, { root, requiredFields: ['dispatch_id'] }),
        /dispatch_id/
      );
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('lists only signals currently in the live surface', () => {
    const root = makeTempRoot();
    try {
      emitSignal({ schema: 'ActorWorkOrder/1.0', dispatch_id: 'a' }, { root });
      emitSignal({ schema: 'ActorCapabilityReceipt/1.0', dispatch_id: 'b' }, { root });

      const entries = listSignals({ root });
      assert.equal(entries.length, 2);
      const dispatchIds = entries.map((e) => e.signal.dispatch_id).sort();
      assert.deepEqual(dispatchIds, ['a', 'b']);
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('closes a signal by moving it to closed/ with lifecycle fields added', () => {
    const root = makeTempRoot();
    try {
      emitSignal({ schema: 'ActorWorkOrder/1.0', dispatch_id: 'close-me' }, { root });

      const before = listSignals({ root });
      assert.equal(before.length, 1);

      const closedPath = closeSignal('close-me', { root });
      assert.ok(closedPath);
      assert.equal(path.dirname(closedPath), path.join(root, '_dev', 'reports', 'signals', 'closed'));

      const after = listSignals({ root });
      assert.equal(after.length, 0);

      const closedContent = JSON.parse(fs.readFileSync(closedPath, 'utf8'));
      assert.equal(closedContent.lifecycle_state, 'closed');
      assert.equal(typeof closedContent.closed_at, 'string');
      assert.equal(closedContent.dispatch_id, 'close-me');
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('returns null when closing a signal that does not exist', () => {
    const root = makeTempRoot();
    try {
      const result = closeSignal('does-not-exist', { root });
      assert.equal(result, null);
    } finally {
      cleanupTempRoot(root);
    }
  });
});
