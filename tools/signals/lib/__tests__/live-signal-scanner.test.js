'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listLiveSignals, matchSignalsForSession } = require('../live-signal-scanner');

let tmpDir;

function makeSignal(overrides = {}) {
  return {
    schema: 'HandoffSignal/2.0',
    signal_type: 'coordination-request',
    lifecycle_state: 'live',
    source: 'claude',
    scope: 'test-scope',
    timestamp: '2026-04-27T16:00:00Z',
    target_addressees: { mode: 'snapshot', sessions: [] },
    acknowledgement_threshold: { mode: 'all' },
    acknowledgements: [],
    artifacts: [],
    ...overrides
  };
}

function writeSignal(name, payload) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-signal-scanner-'));
  fs.mkdirSync(path.join(tmpDir, 'closed'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listLiveSignals', () => {
  it('returns only files with lifecycle_state==="live"', () => {
    writeSignal('coordination-request__a__live.json', makeSignal({ lifecycle_state: 'live' }));
    writeSignal('coordination-request__b__complete.json', makeSignal({ lifecycle_state: 'complete' }));
    writeSignal('coordination-request__c__closed.json', makeSignal({ lifecycle_state: 'closed' }));

    const live = listLiveSignals({ signalsDir: tmpDir });
    assert.equal(live.length, 1);
    assert.match(live[0].path, /__a__live\.json$/);
  });

  it('skips files in closed/ subdirectory', () => {
    writeSignal('coordination-request__a__live.json', makeSignal({ lifecycle_state: 'live' }));
    const closedPath = path.join(tmpDir, 'closed', 'coordination-request__b__live.json');
    fs.writeFileSync(closedPath, JSON.stringify(makeSignal({ lifecycle_state: 'live' })));

    const live = listLiveSignals({ signalsDir: tmpDir });
    assert.equal(live.length, 1);
    assert.ok(!live[0].path.includes(`${path.sep}closed${path.sep}`));
  });

  it('ignores files not matching coordination-request__*.json', () => {
    writeSignal('coordination-request__ok__live.json', makeSignal());
    writeSignal('ready-for-review__noise.json', makeSignal());
    writeSignal('something-else.json', makeSignal());

    const live = listLiveSignals({ signalsDir: tmpDir });
    assert.equal(live.length, 1);
  });

  it('returns empty array when signalsDir does not exist', () => {
    const live = listLiveSignals({ signalsDir: path.join(tmpDir, 'nonexistent') });
    assert.deepEqual(live, []);
  });
});

describe('matchSignalsForSession', () => {
  it('matches by sessionId in target_addressees.sessions', () => {
    writeSignal('coordination-request__a__sess.json', makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['sess-target'] }
    }));
    writeSignal('coordination-request__b__other.json', makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['sess-other'] }
    }));

    const matches = matchSignalsForSession({ sessionId: 'sess-target', signalsDir: tmpDir });
    assert.equal(matches.length, 1);
    assert.ok(matches[0].match_reasons.includes('session_id-in-target'));
  });

  it('matches actor_id with substring tolerance on compound keys', () => {
    writeSignal('coordination-request__a__base.json', makeSignal({
      target_addressees: { mode: 'snapshot', sessions: [], actors: ['claude-opus-4-7'] }
    }));
    const matches = matchSignalsForSession({
      actorId: 'claude-opus-4-7:kerneling-rupert',
      signalsDir: tmpDir
    });
    assert.equal(matches.length, 1);
    assert.ok(matches[0].match_reasons.includes('actor_id-match'));
  });

  it('matches by writtenPath in artifacts list', () => {
    writeSignal('coordination-request__a__art.json', makeSignal({
      artifacts: ['tools/signals/lib/foo.js', 'docs/bar.md']
    }));
    writeSignal('coordination-request__b__noart.json', makeSignal({
      artifacts: ['unrelated.txt']
    }));

    const matches = matchSignalsForSession({
      writtenPath: 'tools/signals/lib/foo.js',
      signalsDir: tmpDir
    });
    assert.equal(matches.length, 1);
    assert.ok(matches[0].match_reasons.includes('written-path-in-artifacts'));
  });

  it('returns empty array when no matches', () => {
    writeSignal('coordination-request__a__nope.json', makeSignal({
      target_addressees: { mode: 'snapshot', sessions: ['someone-else'] },
      artifacts: ['unrelated.txt']
    }));
    const matches = matchSignalsForSession({
      sessionId: 'sess-x',
      actorId: 'claude-x',
      writtenPath: 'never.js',
      signalsDir: tmpDir
    });
    assert.deepEqual(matches, []);
  });

  it('matches by branch overlap with signal scope', () => {
    writeSignal('coordination-request__a__branch.json', makeSignal({
      scope: 'feat/multi-session-coordination/layer-3',
      target_addressees: { mode: 'snapshot', sessions: [] }
    }));
    const matches = matchSignalsForSession({
      currentBranch: 'feat/multi-session-coordination',
      signalsDir: tmpDir
    });
    assert.equal(matches.length, 1);
    assert.ok(matches[0].match_reasons.includes('branch-overlap'));
  });
});
