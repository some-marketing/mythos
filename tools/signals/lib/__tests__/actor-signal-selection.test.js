'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { selectActorTargetSignal } = require('../actor-auto');

function withLiveSignal(run) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-signal-selection-'));
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const name = 'dispatch-bridge__20260904T172223Z__sample.signal.json';
  fs.mkdirSync(signalDir, { recursive: true });
  fs.writeFileSync(path.join(signalDir, name), JSON.stringify({
    schema: 'HandoffSignal/1.0',
    lifecycle_state: 'live',
    timestamp: '2026-09-04T17:22:23.895Z',
    recommended_next_actor: 'opencode'
  }));
  try {
    run({ projectRoot, signalDir, name });
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

describe('selectActorTargetSignal explicit file selection', () => {
  it('selects the same live signal by basename, repository-relative path, or absolute path', () => {
    withLiveSignal(({ projectRoot, signalDir, name }) => {
      const expectedPath = path.join(signalDir, name);
      for (const fileName of [name, path.join('_dev', 'reports', 'signals', name), expectedPath]) {
        assert.equal(selectActorTargetSignal(projectRoot, 'opencode', fileName).filePath, expectedPath);
      }
    });
  });

  it('preserves actor filtering for an explicitly named live signal', () => {
    withLiveSignal(({ projectRoot, name }) => {
      assert.equal(selectActorTargetSignal(projectRoot, 'codex', name), null);
    });
  });

  it('refuses an outside-directory path with the same basename', () => {
    withLiveSignal(({ projectRoot, name }) => {
      assert.equal(selectActorTargetSignal(projectRoot, 'opencode', path.join(projectRoot, 'elsewhere', name)), null);
    });
  });

  it('refuses a repository-relative traversal path', () => {
    withLiveSignal(({ projectRoot, name }) => {
      assert.equal(selectActorTargetSignal(projectRoot, 'opencode', `_dev/reports/signals/../signals/${name}`), null);
    });
  });
});
