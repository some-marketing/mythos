'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  stampAcknowledgement,
  resolveTargetAddressees,
  isThresholdSatisfied,
  completeIfSatisfied,
  runOnComplete
} = require('../signal-lifecycle');

function makeSignal(overrides = {}) {
  return {
    schema: 'HandoffSignal/2.0',
    signal_type: 'coordination-request',
    lifecycle_state: 'live',
    source: 'claude',
    scope: 'test-scope',
    timestamp: '2026-04-27T16:00:00Z',
    target_addressees: { mode: 'snapshot', sessions: ['sess-a', 'sess-b'] },
    acknowledgement_threshold: { mode: 'all' },
    acknowledgements: [],
    ...overrides
  };
}

function makeRegistryStub(sessionIds) {
  return () => sessionIds.map((id) => ({ session_id: id, status: 'active' }));
}

describe('resolveTargetAddressees', () => {
  it('all-active snapshot resolution returns the verbatim list', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['a', 'b'] }
    });
    const resolved = resolveTargetAddressees(sig);
    assert.equal(resolved.mode, 'snapshot');
    assert.deepEqual(Array.from(resolved.sessions), ['a', 'b']);
  });

  it('dynamic mode pulls from registryListActive (DI)', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'dynamic' }
    });
    const resolved = resolveTargetAddressees(sig, {
      now: '2026-04-27T17:00:00Z',
      registryListActive: makeRegistryStub(['live-1', 'live-2'])
    });
    assert.equal(resolved.mode, 'dynamic');
    assert.deepEqual(Array.from(resolved.sessions), ['live-1', 'live-2']);
    assert.equal(resolved.resolved_at, '2026-04-27T17:00:00Z');
  });

  it('at-least mode returns null (caller checks count/deadline)', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'at-least' }
    });
    assert.equal(resolveTargetAddressees(sig), null);
  });
});

describe('stampAcknowledgement (idempotent + advance-only)', () => {
  it('first stamp appends a new entry', () => {
    const sig = makeSignal();
    const out = stampAcknowledgement(sig, {
      session_id: 'sess-a',
      actor_id: 'claude',
      action_taken: 'noted',
      ts: '2026-04-27T16:01:00Z'
    });
    assert.equal(out.acknowledgements.length, 1);
    assert.equal(out.acknowledgements[0].action_taken, 'noted');
  });

  it('same session noted → responded advances in place (one entry)', () => {
    let sig = makeSignal();
    sig = stampAcknowledgement(sig, { session_id: 'sess-a', action_taken: 'noted', ts: '2026-04-27T16:01:00Z' });
    sig = stampAcknowledgement(sig, { session_id: 'sess-a', action_taken: 'responded', ts: '2026-04-27T16:02:00Z' });
    assert.equal(sig.acknowledgements.length, 1);
    assert.equal(sig.acknowledgements[0].action_taken, 'responded');
    assert.equal(sig.acknowledgements[0].ts, '2026-04-27T16:02:00Z');
  });

  it('does NOT downgrade responded → noted', () => {
    let sig = makeSignal();
    sig = stampAcknowledgement(sig, { session_id: 'sess-a', action_taken: 'responded', ts: '2026-04-27T16:02:00Z' });
    sig = stampAcknowledgement(sig, { session_id: 'sess-a', action_taken: 'noted', ts: '2026-04-27T16:03:00Z' });
    assert.equal(sig.acknowledgements.length, 1);
    assert.equal(sig.acknowledgements[0].action_taken, 'responded');
    assert.equal(sig.acknowledgements[0].ts, '2026-04-27T16:02:00Z'); // ts unchanged
  });

  it('rejects invalid action_taken', () => {
    assert.throws(() => stampAcknowledgement(makeSignal(), { session_id: 'x', action_taken: 'bogus' }));
  });

  it('rejects missing session_id', () => {
    assert.throws(() => stampAcknowledgement(makeSignal(), { action_taken: 'noted' }));
  });
});

describe('isThresholdSatisfied (mode=all)', () => {
  it('returns false until both targets ack; true once both have', () => {
    let sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['sess-a', 'sess-b'] },
      acknowledgement_threshold: { mode: 'all' }
    });
    let r = isThresholdSatisfied(sig);
    assert.equal(r.satisfied, false);

    sig = stampAcknowledgement(sig, { session_id: 'sess-a', action_taken: 'noted' });
    r = isThresholdSatisfied(sig);
    assert.equal(r.satisfied, false);

    sig = stampAcknowledgement(sig, { session_id: 'sess-b', action_taken: 'responded' });
    r = isThresholdSatisfied(sig);
    assert.equal(r.satisfied, true);
    assert.equal(r.reason, 'all-targets-acknowledged');
  });

  it('mode=at-least with count=2 satisfies after 2 distinct acks', () => {
    let sig = makeSignal({
      target_addressees: { mode: 'at-least' },
      acknowledgement_threshold: { mode: 'at-least', count: 2 }
    });
    sig = stampAcknowledgement(sig, { session_id: 'a', action_taken: 'noted' });
    assert.equal(isThresholdSatisfied(sig).satisfied, false);
    sig = stampAcknowledgement(sig, { session_id: 'b', action_taken: 'noted' });
    assert.equal(isThresholdSatisfied(sig).satisfied, true);
  });

  it('mode=named-list requires every named session to ack', () => {
    let sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['x', 'y'] },
      acknowledgement_threshold: { mode: 'named-list', sessions: ['x', 'y'] }
    });
    sig = stampAcknowledgement(sig, { session_id: 'x', action_taken: 'noted' });
    assert.equal(isThresholdSatisfied(sig).satisfied, false);
    sig = stampAcknowledgement(sig, { session_id: 'y', action_taken: 'noted' });
    assert.equal(isThresholdSatisfied(sig).satisfied, true);
  });
});

describe('isThresholdSatisfied — unreachable target stays live', () => {
  it('mode=all does NOT auto-shrink when target session is missing from registry', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['sess-a', 'sess-b'] },
      acknowledgement_threshold: { mode: 'all' },
      acknowledgements: [
        { session_id: 'sess-a', actor_id: 'claude', action_taken: 'responded', ts: '2026-04-27T16:01:00Z' }
      ]
    });
    // Registry only knows about sess-a — sess-b is unreachable.
    const r = isThresholdSatisfied(sig, {
      registryListActive: makeRegistryStub(['sess-a'])
    });
    assert.equal(r.satisfied, false, 'all-mode must NOT auto-shrink for unreachable targets');
    assert.deepEqual(r.unreachable_sessions, ['sess-b']);
    assert.equal(r.reason, 'unreachable-sessions-block-all-mode');
  });

  it('mode=all WITH allow_unreachable_shrink:true completes when reachable acks satisfy', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['sess-a', 'sess-b'], allow_unreachable_shrink: true },
      acknowledgement_threshold: { mode: 'all' },
      acknowledgements: [
        { session_id: 'sess-a', actor_id: 'claude', action_taken: 'responded', ts: '2026-04-27T16:01:00Z' }
      ]
    });
    const r = isThresholdSatisfied(sig, {
      registryListActive: makeRegistryStub(['sess-a'])
    });
    assert.equal(r.satisfied, true);
    assert.deepEqual(r.unreachable_sessions, ['sess-b']);
  });
});

describe('isThresholdSatisfied — malformed registry skip (fail-closed)', () => {
  it('registry throws → fail-closed (not satisfied) with diagnostic', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'dynamic' },
      acknowledgement_threshold: { mode: 'all' }
    });
    const r = isThresholdSatisfied(sig, {
      registryListActive: () => { throw new Error('disk-IO'); }
    });
    assert.equal(r.satisfied, false);
    assert.match(r.reason, /registry-threw/);
  });

  it('registry returns malformed (non-array) → fail-closed', () => {
    const sig = makeSignal({
      target_addressees: { mode: 'dynamic' },
      acknowledgement_threshold: { mode: 'all' }
    });
    const r = isThresholdSatisfied(sig, {
      registryListActive: () => ({ not: 'an-array' })
    });
    assert.equal(r.satisfied, false);
    assert.equal(r.reason, 'registry-malformed');
  });

  it('resolveTargetAddressees handles registry throw gracefully', () => {
    const sig = makeSignal({ target_addressees: { mode: 'dynamic' } });
    const resolved = resolveTargetAddressees(sig, {
      now: '2026-04-27T17:00:00Z',
      registryListActive: () => { throw new Error('boom'); }
    });
    assert.equal(resolved.mode, 'dynamic');
    assert.deepEqual(Array.from(resolved.sessions), []);
    assert.match(resolved.diagnostic, /registry-listActive-threw/);
  });
});

describe('completeIfSatisfied', () => {
  it('flips lifecycle_state to complete + stamps completed_at + completed_by_session_id', () => {
    let sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['a', 'b'] },
      acknowledgement_threshold: { mode: 'all' }
    });
    sig = stampAcknowledgement(sig, { session_id: 'a', action_taken: 'responded' });
    sig = stampAcknowledgement(sig, { session_id: 'b', action_taken: 'responded' });

    const result = completeIfSatisfied(sig, {
      completed_by_session_id: 'b',
      now: '2026-04-27T17:30:00Z'
    });

    assert.equal(result.completed, true);
    assert.equal(result.signal.lifecycle_state, 'complete');
    assert.equal(result.signal.completed_at, '2026-04-27T17:30:00Z');
    assert.equal(result.signal.completed_by_session_id, 'b');
  });

  it('does not flip when threshold not met', () => {
    let sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['a', 'b'] },
      acknowledgement_threshold: { mode: 'all' }
    });
    sig = stampAcknowledgement(sig, { session_id: 'a', action_taken: 'noted' });
    const result = completeIfSatisfied(sig, { completed_by_session_id: 'a' });
    assert.equal(result.completed, false);
    assert.equal(result.signal.lifecycle_state, 'live');
  });

  it('idempotent: already-complete → not re-fired', () => {
    let sig = makeSignal({
      lifecycle_state: 'complete',
      target_addressees: { mode: 'snapshot', sessions: ['a'] },
      acknowledgement_threshold: { mode: 'all' },
      acknowledgements: [{ session_id: 'a', action_taken: 'responded', ts: '2026-04-27T16:01:00Z' }]
    });
    const result = completeIfSatisfied(sig, { completed_by_session_id: 'a' });
    assert.equal(result.completed, false);
    assert.equal(result.reason, 'already-complete');
  });
});

describe('runOnComplete — allowlist enforcement', () => {
  it('rejects non-allowlisted command (e.g. "rm -rf /")', () => {
    const sig = makeSignal({
      on_complete: { trigger_command: 'rm -rf /' }
    });
    assert.throws(
      () => runOnComplete(sig),
      /allowlist-violation/
    );
  });

  it('rejects unknown command not on allowlist', () => {
    const sig = makeSignal({
      on_complete: { trigger_command: 'send_email' }
    });
    assert.throws(
      () => runOnComplete(sig),
      /allowlist/
    );
  });

  it('trigger_normalize_signals returns pending stub', () => {
    const sig = makeSignal({
      on_complete: { trigger_command: 'trigger_normalize_signals' }
    });
    const result = runOnComplete(sig);
    assert.deepEqual(result.executed, ['trigger_normalize_signals']);
    assert.equal(result.results[0].pending, true);
  });

  it('no on_complete → no-op', () => {
    const sig = makeSignal();
    const result = runOnComplete(sig);
    assert.deepEqual(result.executed, []);
  });
});

describe('runOnComplete — archive_to_closed', () => {
  it('moves the signal file from signals/ to signals/closed/', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-lifecycle-'));
    const signalsDir = path.join(tmpRoot, 'signals');
    const closedDir = path.join(signalsDir, 'closed');
    fs.mkdirSync(signalsDir, { recursive: true });

    const filename = 'coordination-request__test.json';
    const filePath = path.join(signalsDir, filename);
    const sig = makeSignal({
      on_complete: { trigger_command: 'archive_to_closed' }
    });
    fs.writeFileSync(filePath, JSON.stringify(sig, null, 2));

    const result = runOnComplete(sig, {
      signalFilePath: filePath,
      closedDir
    });

    assert.deepEqual(result.executed, ['archive_to_closed']);
    assert.equal(fs.existsSync(filePath), false, 'original file must be moved');
    const archived = path.join(closedDir, filename);
    assert.equal(fs.existsSync(archived), true, 'archived file must exist in closed dir');

    // Cleanup
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('completeIfSatisfied + archive_to_closed integration', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-lifecycle-'));
    const signalsDir = path.join(tmpRoot, 'signals');
    const closedDir = path.join(signalsDir, 'closed');
    fs.mkdirSync(signalsDir, { recursive: true });
    const filename = 'coordination-request__integration.json';
    const filePath = path.join(signalsDir, filename);

    let sig = makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['a'] },
      acknowledgement_threshold: { mode: 'all' },
      on_complete: { trigger_command: 'archive_to_closed' }
    });
    sig = stampAcknowledgement(sig, { session_id: 'a', action_taken: 'responded' });
    fs.writeFileSync(filePath, JSON.stringify(sig, null, 2));

    const result = completeIfSatisfied(sig, {
      completed_by_session_id: 'a',
      now: '2026-04-27T18:00:00Z',
      signalFilePath: filePath,
      closedDir
    });

    assert.equal(result.completed, true);
    assert.equal(result.fired, true);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(fs.existsSync(path.join(closedDir, filename)), true);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
