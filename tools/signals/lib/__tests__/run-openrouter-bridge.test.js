'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SUPPORTED_TARGETS, runnerForTarget } = require('../dispatch-bridge');
const { getBridgeTargetPolicy } = require('../bridge-target-policy');
const {
  extractRecommendedNextCommand,
  inlineContextArtifacts,
  buildBlockedMissingKeyResult,
  buildArtifacts,
  runOpenRouterForSignal
} = require('../../run-openrouter-bridge');
const { createHandoffSignal } = require('../../../verify/lib/signal.cjs');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-bridge-test-'));
}

function cleanupTempRoot(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) { /* best-effort */ }
}

describe('run-openrouter-bridge — dispatch plumbing', () => {
  it('SUPPORTED_TARGETS includes openrouter', () => {
    assert.ok(SUPPORTED_TARGETS.includes('openrouter'));
  });

  it('runnerForTarget("openrouter") returns the openrouter runner', () => {
    const runner = runnerForTarget('openrouter');
    assert.ok(runner, 'runner should not be null');
    assert.equal(runner.id, 'signals:run:openrouter');
    assert.ok(
      runner.script.endsWith('run-openrouter-bridge.js'),
      `script should end with run-openrouter-bridge.js, got: ${runner.script}`
    );
  });

  it('bridge-target-policy exposes openrouter with api transport and default_model openrouter/auto', () => {
    const policy = getBridgeTargetPolicy('openrouter');
    assert.ok(policy, 'openrouter policy should exist');
    const apiTransport = policy.transports && policy.transports['api'];
    assert.ok(apiTransport, 'openrouter should have api transport');
    assert.equal(apiTransport.kind, 'api-agent');
    assert.equal(policy.default_transport, 'api');
    assert.equal(apiTransport.default_model, 'openrouter/auto');
  });
});

describe('run-openrouter-bridge — extractRecommendedNextCommand', () => {
  it('returns a valid leaf slash command as-is with rejected: null', () => {
    const output = '## Recommended Next Command\n\n/review-progress\n\nSome text.';
    const result = extractRecommendedNextCommand(output);
    assert.equal(result.command, '/review-progress');
    assert.equal(result.rejected, null);
  });

  it('falls back to /review-progress with rejected: null when no slash command is present', () => {
    const output = '## Recommended Next Command\n\ndo something\n';
    const result = extractRecommendedNextCommand(output);
    assert.equal(result.command, '/review-progress');
    assert.equal(result.rejected, null);
  });

  it('falls back to /review-progress for resolver command with isResolverCommand reason', () => {
    const output = '## Recommended Next Command\n\n/run-plan some-target\n';
    const result = extractRecommendedNextCommand(output);
    assert.equal(result.command, '/review-progress');
    assert.ok(result.rejected, 'should have a rejected entry');
    assert.match(result.rejected.reason, /resolver/i);
  });
});

describe('run-openrouter-bridge — inlineContextArtifacts denylist', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = makeTempRoot();
    // .env.example — allowed
    fs.writeFileSync(path.join(tmpRoot, '.env.example'), 'SAMPLE_VAR=example_value\n');
    // secrets.json — denied by path
    fs.writeFileSync(path.join(tmpRoot, 'secrets.json'), '{"key":"value"}\n');
  });

  after(() => {
    cleanupTempRoot(tmpRoot);
  });

  it('inlines .env.example but skips secrets.json with sensitive-path marker', () => {
    const signalInfo = {
      signal: {
        artifacts: [],
        decision_context_artifacts: ['.env.example', 'secrets.json']
      }
    };
    const result = inlineContextArtifacts(tmpRoot, signalInfo, 'BASE');
    assert.ok(result.includes('SAMPLE_VAR=example_value'), '.env.example content should be inlined');
    assert.ok(
      result.includes('[skipped: sensitive-path (denylist)]'),
      'secrets.json should be skipped with denylist marker'
    );
    assert.ok(!result.includes('"key":"value"'), 'secrets.json content must not appear');
  });
});

describe('run-openrouter-bridge — content-scan depth (8KB)', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = makeTempRoot();
    // Write a file whose first 4KB is benign and a denied pattern appears at ~5000 bytes
    const prefix = Buffer.alloc(4200, 97); // 4200 bytes of 'a'
    const secret = Buffer.from('-----BEGIN PRIVATE KEY-----');
    const suffix = Buffer.alloc(100, 98); // trailing 'b' bytes
    const content = Buffer.concat([prefix, secret, suffix]);
    fs.writeFileSync(path.join(tmpRoot, 'deep-scan-fixture.txt'), content);
  });

  after(() => {
    cleanupTempRoot(tmpRoot);
  });

  it('skips a file whose denied content appears after byte 4096 but before byte 8192', () => {
    const signalInfo = {
      signal: {
        artifacts: [],
        decision_context_artifacts: ['deep-scan-fixture.txt']
      }
    };
    const result = inlineContextArtifacts(tmpRoot, signalInfo, 'BASE');
    assert.ok(
      result.includes('[skipped: sensitive-content (denylist)]'),
      'file with denied content after byte 4096 must be skipped'
    );
    assert.ok(
      !result.includes('BEGIN PRIVATE KEY'),
      'denied content must not appear in the inlined output'
    );
  });
});

describe('run-openrouter-bridge — missing-key blocked result shape', () => {
  it('buildBlockedMissingKeyResult returns expected shape without I/O', () => {
    const fakeProjectRoot = '/tmp/fake-project';
    const fakeSignalInfo = { name: 'test-signal.json' };
    const fakeArtifacts = {
      completionSignalPath: '/tmp/fake-project/_dev/reports/signals/blocked.json',
      completionReportJsonPath: '/tmp/fake-project/_dev/reports/analysis/blocked.json',
      completionReportMdPath: '/tmp/fake-project/_dev/reports/analysis/blocked.md'
    };
    const result = buildBlockedMissingKeyResult(fakeProjectRoot, fakeSignalInfo, fakeArtifacts);
    assert.equal(result.mode, 'blocked');
    assert.equal(result.reason, 'missing_api_key');
    assert.equal(result.success, false);
    assert.equal(result.completionSignalPath, fakeArtifacts.completionSignalPath);
    assert.equal(result.completionReportPath, fakeArtifacts.completionReportJsonPath);
    assert.equal(result.promptPath, null);
  });
});

describe('run-openrouter-bridge — lock-acquire-failure returns skipped', () => {
  let tmpRoot;
  let signalFilePath;

  before(() => {
    tmpRoot = makeTempRoot();
    // Create the directory structure the runner needs
    const signalDir = path.join(tmpRoot, '_dev', 'reports', 'signals');
    const analysisDir = path.join(tmpRoot, '_dev', 'reports', 'analysis');
    fs.mkdirSync(signalDir, { recursive: true });
    fs.mkdirSync(analysisDir, { recursive: true });

    // Write a dummy artifact so validateSignalForDispatch artifact-existence check passes
    const dummyArtifact = path.join(analysisDir, 'dummy-artifact.md');
    fs.writeFileSync(dummyArtifact, '# dummy\n');

    // Create a valid HandoffSignal targeting openrouter
    const sig = createHandoffSignal(
      'test',
      'lock-test-scope',
      'ready-for-review',
      {
        artifacts: ['_dev/reports/analysis/dummy-artifact.md'],
        recommended_next_actor: 'openrouter',
        recommended_next_command: '/review-progress',
        next_step_detail: ['Run the openrouter bridge for this scope.'],
        blocked_by: [],
        signal_scope: 'lock-test-scope',
        workflow_scope: 'lock-test-scope',
        workflow_kind: 'bridge'
      }
    );

    signalFilePath = path.join(signalDir, 'test-lock-signal.json');
    fs.writeFileSync(signalFilePath, JSON.stringify(sig, null, 2) + '\n');

    // Pre-create a fresh lock file so acquireLock returns false
    fs.writeFileSync(signalFilePath + '.lock', JSON.stringify({
      pid: 99999,
      acquired_at: new Date().toISOString()
    }));
  });

  after(() => {
    cleanupTempRoot(tmpRoot);
  });

  it('returns mode=skipped reason=lock-acquire-failed when lock is already held', async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key-for-lock-test';
    try {
      const signalInfo = {
        name: 'test-lock-signal.json',
        filePath: signalFilePath,
        signal: JSON.parse(fs.readFileSync(signalFilePath, 'utf8'))
      };
      const result = await runOpenRouterForSignal(tmpRoot, signalInfo, { dryRun: false });
      assert.equal(result.mode, 'skipped');
      assert.equal(result.reason, 'lock-acquire-failed');
    } finally {
      if (savedKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = savedKey;
      }
    }
  });
});

describe('dispatch-bridge — parsed.success === false marks bridge_failed', () => {
  it('dispatch-bridge source contains the parsed.success === false guard for bridge_failed classification', () => {
    // This test asserts the code-path exists in dispatch-bridge.js.
    // Preferred mocking was not used because spawnSync stubbing requires a
    // module-mock library not available in this repo; source inspection is
    // the documented fallback per F3 spec.
    const dispatchBridgeSrc = fs.readFileSync(
      path.join(__dirname, '../dispatch-bridge.js'),
      'utf8'
    );
    assert.ok(
      dispatchBridgeSrc.includes('parsed.success === false'),
      'dispatch-bridge.js must contain the parsed.success === false guard for bridge_failed classification'
    );
    assert.ok(
      dispatchBridgeSrc.includes("bridge_failed"),
      'dispatch-bridge.js must classify bridge_failed when parsed.success === false'
    );
  });
});
