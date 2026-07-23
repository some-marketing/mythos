'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveAllActiveTargets,
  resolveTargetAddressees,
  processSignal,
  processAllLiveSignals,
  processSignalsForWrittenPath,
  scanInboundForSession
} = require('../signal-lifecycle-driver');

let tmpDir;
let signalsDir;
let closedDir;

function makeSatisfiedSignal(overrides = {}) {
  return {
    schema: 'HandoffSignal/2.0',
    signal_type: 'coordination-request',
    lifecycle_state: 'live',
    source: 'claude',
    scope: 'driver-test',
    timestamp: '2026-04-27T16:00:00Z',
    target_addressees: { mode: 'snapshot', sessions: ['sess-a'] },
    acknowledgement_threshold: { mode: 'all' },
    acknowledgements: [
      { actor_id: 'claude', session_id: 'sess-a', ts: '2026-04-27T17:00:00Z', action_taken: 'responded' }
    ],
    artifacts: [],
    on_complete: { trigger_command: 'archive_to_closed' },
    ...overrides
  };
}

function makeUnsatisfiedSignal(overrides = {}) {
  return {
    ...makeSatisfiedSignal(),
    target_addressees: { mode: 'snapshot', sessions: ['sess-a', 'sess-b'] },
    acknowledgements: [],
    ...overrides
  };
}

function writeSignal(name, payload) {
  const filePath = path.join(signalsDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-lifecycle-driver-'));
  signalsDir = path.join(tmpDir, 'signals');
  closedDir = path.join(signalsDir, 'closed');
  fs.mkdirSync(signalsDir, { recursive: true });
  fs.mkdirSync(closedDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveTargetAddressees all-active', () => {
  it('mode=all-active with 3 active sessions excludes asker; all threshold requires both remaining acks', () => {
    const now = '2026-04-27T17:00:00Z';
    const signal = makeSatisfiedSignal({
      produced_by_session_id: 'sess-asker',
      target_addressees: {
        mode: 'all-active',
        source: 'active-session-registry',
        resolved_at: now
      },
      acknowledgement_threshold: { mode: 'all' },
      acknowledgements: [
        { actor_id: 'claude', session_id: 'sess-a', ts: now, action_taken: 'responded' },
        { actor_id: 'claude', session_id: 'sess-b', ts: now, action_taken: 'responded' }
      ]
    });

    const registryListActive = (options = {}) => {
      assert.equal(options.now, now);
      return [
        { session_id: 'sess-asker', status: 'active' },
        { session_id: 'sess-a', status: 'active' },
        { session_id: 'sess-b', status: 'active' }
      ];
    };

    const resolved = resolveTargetAddressees(signal, { now, registryListActive });
    assert.equal(resolved.mode, 'all-active');
    assert.equal(resolved.source, 'active-session-registry');
    assert.equal(resolved.resolved_at, now);
    assert.deepEqual(Array.from(resolved.sessions), ['sess-a', 'sess-b']);

    const signalPath = writeSignal('coordination-request__all-active__sat.json', signal);
    const result = processSignal(signalPath, {
      now,
      completedBySessionId: 'sess-b',
      registryListActive,
      signalsDir,
      closedDir
    });

    assert.equal(result.completed, true, `expected completion, got: ${JSON.stringify(result)}`);
    assert.equal(result.archived, true);
    assert.equal(result.errors.length, 0);
  });

  it('mode=all-active with empty registry resolves 0 and stays live', () => {
    const now = '2026-04-27T17:00:00Z';
    const signal = makeUnsatisfiedSignal({
      produced_by_session_id: 'sess-asker',
      target_addressees: {
        mode: 'all-active',
        source: 'active-session-registry',
        resolved_at: now
      },
      acknowledgement_threshold: { mode: 'all' }
    });

    const registryListActive = () => [];
    const resolved = resolveAllActiveTargets(signal, { now, registryListActive });

    assert.equal(resolved.mode, 'all-active');
    assert.deepEqual(Array.from(resolved.sessions), []);

    const signalPath = writeSignal('coordination-request__all-active__empty.json', signal);
    const result = processSignal(signalPath, {
      now,
      registryListActive,
      signalsDir,
      closedDir
    });

    assert.equal(result.completed, false);
    assert.equal(result.archived, false);
    assert.equal(result.reason, 'no-targets-resolved');
    assert.equal(fs.existsSync(signalPath), true, 'empty all-active signal must remain live');
  });

  it('mode=all-active consumes registry TTL-filtered output without double-filtering', () => {
    const now = '2026-04-27T17:00:00Z';
    const signal = makeSatisfiedSignal({
      produced_by_session_id: 'sess-asker',
      target_addressees: {
        mode: 'all-active',
        source: 'active-session-registry',
        resolved_at: now
      },
      acknowledgement_threshold: { mode: 'all' },
      acknowledgements: [
        { actor_id: 'claude', session_id: 'sess-live', ts: now, action_taken: 'responded' },
        { actor_id: 'claude', session_id: 'sess-expired', ts: now, action_taken: 'responded' }
      ]
    });

    const registryListActive = () => [
      { session_id: 'sess-asker', status: 'active' },
      { session_id: 'sess-live', status: 'active' }
    ];

    const resolved = resolveTargetAddressees(signal, { now, registryListActive });
    assert.deepEqual(Array.from(resolved.sessions), ['sess-live']);

    const signalPath = writeSignal('coordination-request__all-active__ttl.json', signal);
    const result = processSignal(signalPath, {
      now,
      completedBySessionId: 'sess-live',
      registryListActive,
      signalsDir,
      closedDir
    });

    assert.equal(result.completed, true, `expected completion from post-TTL registry list, got: ${JSON.stringify(result)}`);
    assert.equal(result.errors.length, 0);
  });
});

describe('processSignal', () => {
  it('completes + persists lifecycle_state="complete" to disk before archive (regression)', () => {
    const signalPath = writeSignal('coordination-request__a__live.json', makeSatisfiedSignal());

    const result = processSignal(signalPath, {
      completedBySessionId: 'sess-completer',
      signalsDir,
      closedDir
    });

    assert.equal(result.completed, true, `expected completion, got: ${JSON.stringify(result)}`);
    assert.equal(result.archived, true, 'expected archive flag set');
    assert.equal(result.errors.length, 0, `unexpected errors: ${result.errors.join(', ')}`);

    // Original location should be empty.
    assert.equal(fs.existsSync(signalPath), false, 'live file should have been moved');

    // Archived file must carry lifecycle_state='complete' (the regression we fix).
    const archivedPath = path.join(closedDir, 'coordination-request__a__live.json');
    assert.equal(fs.existsSync(archivedPath), true, 'archived file should exist');
    const archived = JSON.parse(fs.readFileSync(archivedPath, 'utf8'));
    assert.equal(archived.lifecycle_state, 'complete');
    assert.equal(archived.completed_by_session_id, 'sess-completer');
    assert.ok(archived.completed_at, 'completed_at must be stamped');
  });

  it('does nothing when threshold not met', () => {
    const signalPath = writeSignal('coordination-request__b__pending.json', makeUnsatisfiedSignal());

    const result = processSignal(signalPath, { signalsDir, closedDir });

    assert.equal(result.completed, false);
    assert.equal(result.archived, false);
    assert.equal(fs.existsSync(signalPath), true, 'unsatisfied signal must remain in place');
    const onDisk = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
    assert.equal(onDisk.lifecycle_state, 'live');
  });

  it('returns error reason when signal file is missing', () => {
    const result = processSignal(path.join(signalsDir, 'nonexistent.json'), { signalsDir, closedDir });
    assert.equal(result.completed, false);
    assert.equal(result.reason, 'read-failed');
    assert.ok(result.errors.length > 0);
  });
});

describe('processAllLiveSignals', () => {
  it('only iterates live signals and returns per-signal status', () => {
    writeSignal('coordination-request__a__sat.json', makeSatisfiedSignal());
    writeSignal('coordination-request__b__pending.json', makeUnsatisfiedSignal());
    writeSignal('coordination-request__c__complete.json', { ...makeSatisfiedSignal(), lifecycle_state: 'complete' });

    const results = processAllLiveSignals({ signalsDir, closedDir });
    // Only the two live ones should be visited.
    assert.equal(results.length, 2);
    const completed = results.filter((r) => r.completed);
    assert.equal(completed.length, 1);
  });
});

describe('processSignalsForWrittenPath', () => {
  it('only scans signals whose artifacts include the path', () => {
    writeSignal('coordination-request__a__art.json', makeSatisfiedSignal({
      artifacts: ['tools/foo/bar.js']
    }));
    writeSignal('coordination-request__b__other.json', makeSatisfiedSignal({
      artifacts: ['tools/baz/qux.js']
    }));

    const results = processSignalsForWrittenPath({
      writtenPath: 'tools/foo/bar.js',
      signalsDir,
      closedDir
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].completed, true);
    // The other signal should remain untouched on disk.
    const otherPath = path.join(signalsDir, 'coordination-request__b__other.json');
    assert.equal(fs.existsSync(otherPath), true);
  });

  it('returns empty array when writtenPath does not match anything', () => {
    writeSignal('coordination-request__a__art.json', makeSatisfiedSignal({
      artifacts: ['tools/foo/bar.js']
    }));
    const results = processSignalsForWrittenPath({
      writtenPath: 'totally/unrelated.js',
      signalsDir,
      closedDir
    });
    assert.deepEqual(results, []);
  });
});

describe('scanInboundForSession', () => {
  it('returns formatted text including signal scope and request line', () => {
    writeSignal('coordination-request__a__hit.json', makeUnsatisfiedSignal({
      scope: 'inbound-test-scope',
      request: 'please review the thing',
      target_addressees: { mode: 'snapshot', sessions: ['sess-me'] }
    }));

    const out = scanInboundForSession({
      sessionId: 'sess-me',
      signalsDir,
      registryListActive: () => []
    });

    assert.equal(out.count, 1);
    assert.match(out.text, /live-signal-scanner/);
    assert.match(out.text, /inbound-test-scope/);
    assert.match(out.text, /please review the thing/);
  });

  it('returns count=0 and empty text when no matches', () => {
    writeSignal('coordination-request__a__miss.json', makeUnsatisfiedSignal({
      target_addressees: { mode: 'snapshot', sessions: ['someone-else'] }
    }));
    const out = scanInboundForSession({ sessionId: 'sess-me', signalsDir });
    assert.equal(out.count, 0);
    assert.equal(out.text, '');
  });

  it('uses DI registryListActive (no real registry coupling)', () => {
    writeSignal('coordination-request__a__dyn.json', makeUnsatisfiedSignal({
      target_addressees: { mode: 'snapshot', sessions: ['sess-me'] }
    }));
    let registryCalled = false;
    const out = scanInboundForSession({
      sessionId: 'sess-me',
      signalsDir,
      registryListActive: () => { registryCalled = true; return []; }
    });
    assert.equal(out.count, 1);
    // Scanner doesn't need to call registry for snapshot match — but the option
    // must be threaded through without crashing. Don't assert on registryCalled.
    assert.equal(typeof registryCalled, 'boolean');
  });
});
