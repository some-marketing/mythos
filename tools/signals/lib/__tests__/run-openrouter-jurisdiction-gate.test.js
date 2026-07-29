'use strict';

// S4 enforcement tests for the cross-jurisdiction DATA-BAN gate wired into the
// OpenRouter bridge. These prove that a sensitive payload bound for a PRC-hosted
// endpoint (the GLM-5.2 hosted target) can NEVER reach egress, that normal
// non-PRC openrouter calls pass through UNCHANGED, that a missing/garbled
// descriptor fails closed, and that a valid operator exception is honored AND
// produces a durable receipt. NO real network call is ever made — egress is a
// recording mock adapter.

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runOpenRouterForSignal,
  resolveDispatchTarget
} = require('../../run-openrouter-bridge');
const { createHandoffSignal } = require('../../../verify/lib/signal.cjs');

// The real, valid PRC descriptor content (mirrors _dev/config/dispatch-targets/).
const VALID_GLM_DESCRIPTOR = {
  id: 'glm-5.2-hosted',
  provider: 'openrouter',
  model_slug: 'z-ai/glm-5.2',
  labels: [
    'hosted-open-weight', 'not-local', 'text-only',
    'prc-origin-risk', 'anthropic-compatible'
  ],
  jurisdiction: 'PRC',
  migration_path: 'self-host on onshore metal then repoint slug',
  credential: '<operator-gated, stubbed>'
};

const GLM_MODEL = 'z-ai/glm-5.2';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-jurisdiction-test-'));
}

function cleanupTempRoot(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function writeDescriptor(root, content) {
  const dir = path.join(root, '_dev', 'config', 'dispatch-targets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'glm-5.2-hosted.json'),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  );
}

// Build a dispatch-ready openrouter signal whose prompt body is `promptContent`.
function setupSignal(root, promptContent, scope) {
  const signalDir = path.join(root, '_dev', 'reports', 'signals');
  const analysisDir = path.join(root, '_dev', 'reports', 'analysis');
  fs.mkdirSync(signalDir, { recursive: true });
  fs.mkdirSync(analysisDir, { recursive: true });

  const promptRel = '_dev/reports/analysis/prompt-artifact.md';
  fs.writeFileSync(path.join(root, promptRel), promptContent);

  const sig = createHandoffSignal('test', scope, 'ready-for-review', {
    artifacts: [promptRel],
    recommended_next_actor: 'openrouter',
    recommended_next_command: '/review-progress',
    next_step_detail: ['Run the openrouter bridge for this scope.'],
    blocked_by: [],
    signal_scope: scope,
    workflow_scope: scope,
    workflow_kind: 'bridge'
  });

  // Backdate the source signal so a (now-stamped) completion signal supersedes
  // it monotonically — production source signals are always older than the
  // completion they spawn; tests must reproduce that ordering.
  sig.timestamp = '2026-01-01T00:00:00.000Z';

  const signalFilePath = path.join(signalDir, 'test-signal.json');
  fs.writeFileSync(signalFilePath, JSON.stringify(sig, null, 2) + '\n');

  return {
    name: 'test-signal.json',
    filePath: signalFilePath,
    signal: JSON.parse(fs.readFileSync(signalFilePath, 'utf8'))
  };
}

function recordingAdapter() {
  const calls = [];
  return {
    calls,
    invoke: async (req) => {
      calls.push(req);
      return {
        status: 'success',
        output_text: '## Recommended Next Command\n\n/review-progress\n'
      };
    }
  };
}

const SENSITIVE_PROMPT = 'Please reach the customer at jane.doe@example.com about the booking.';
const BENIGN_PROMPT = 'Summarize the three key themes from the attached meeting notes.';

describe('run-openrouter-bridge — jurisdiction data-ban enforcement (S4)', () => {
  let savedKey;
  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it('KEY PROOF: GLM/PRC + sensitive payload is BLOCKED before egress (no call made)', async () => {
    const root = makeTempRoot();
    try {
      writeDescriptor(root, VALID_GLM_DESCRIPTOR);
      const signalInfo = setupSignal(root, SENSITIVE_PROMPT, 'glm-sensitive');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: GLM_MODEL,
        adapter,
        timestamp: 'STAMP-BLOCK'
      });

      assert.equal(result.mode, 'blocked');
      assert.equal(result.reason, 'jurisdiction_data_ban');
      assert.equal(result.success, false);
      assert.equal(result.prcJurisdiction, true);
      assert.match(result.banReason, /blocked-sensitive-payload-to-prc/);
      // The egress adapter was NEVER invoked — payload never reached the wire.
      assert.equal(adapter.calls.length, 0);
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('GLM/PRC + non-sensitive payload proceeds to (mocked) egress', async () => {
    const root = makeTempRoot();
    try {
      writeDescriptor(root, VALID_GLM_DESCRIPTOR);
      const signalInfo = setupSignal(root, BENIGN_PROMPT, 'glm-benign');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: GLM_MODEL,
        adapter,
        timestamp: 'STAMP-OK'
      });

      assert.equal(result.mode, 'executed');
      assert.equal(result.success, true);
      assert.equal(result.model, GLM_MODEL);
      assert.equal(adapter.calls.length, 1, 'egress adapter must be invoked exactly once');
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('non-PRC openrouter call passes through UNCHANGED (existing behavior preserved)', async () => {
    const root = makeTempRoot();
    try {
      // No GLM descriptor needed; default model is non-PRC.
      const signalInfo = setupSignal(root, BENIGN_PROMPT, 'default-passthrough');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: 'openrouter/auto',
        adapter,
        timestamp: 'STAMP-PASS'
      });

      assert.equal(result.mode, 'executed');
      assert.equal(result.success, true);
      assert.equal(adapter.calls.length, 1, 'non-PRC egress must proceed unchanged');
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('non-PRC call with sensitive content still passes (gate is PRC-scoped only)', async () => {
    const root = makeTempRoot();
    try {
      const signalInfo = setupSignal(root, SENSITIVE_PROMPT, 'nonprc-sensitive');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: 'openrouter/auto',
        adapter,
        timestamp: 'STAMP-NONPRC'
      });

      assert.equal(result.mode, 'executed');
      assert.equal(adapter.calls.length, 1, 'gate must not over-reach into non-PRC egress');
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('missing descriptor for a known-PRC slug fails closed (BLOCK) on a sensitive payload', async () => {
    const root = makeTempRoot();
    try {
      // Intentionally DO NOT write the descriptor.
      const signalInfo = setupSignal(root, SENSITIVE_PROMPT, 'glm-missing-descriptor');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: GLM_MODEL,
        adapter,
        timestamp: 'STAMP-MISSING'
      });

      assert.equal(result.mode, 'blocked');
      assert.equal(result.reason, 'jurisdiction_data_ban');
      assert.equal(result.descriptorSource, 'missing-descriptor');
      assert.match(result.banReason, /fail-closed/);
      assert.equal(adapter.calls.length, 0);
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('garbled descriptor for a known-PRC slug fails closed (BLOCK) on a sensitive payload', async () => {
    const root = makeTempRoot();
    try {
      writeDescriptor(root, '{ this is not valid json ');
      const signalInfo = setupSignal(root, SENSITIVE_PROMPT, 'glm-garbled-descriptor');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: GLM_MODEL,
        adapter,
        timestamp: 'STAMP-GARBLED'
      });

      assert.equal(result.mode, 'blocked');
      assert.equal(result.descriptorSource, 'garbled-descriptor');
      assert.equal(adapter.calls.length, 0);
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('dry-run + sensitive payload to PRC is STILL blocked (gate is pre-egress)', async () => {
    const root = makeTempRoot();
    try {
      writeDescriptor(root, VALID_GLM_DESCRIPTOR);
      const signalInfo = setupSignal(root, SENSITIVE_PROMPT, 'glm-dryrun-sensitive');
      const adapter = recordingAdapter();

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: GLM_MODEL,
        dryRun: true,
        adapter,
        timestamp: 'STAMP-DRYRUN'
      });

      assert.equal(result.mode, 'blocked');
      assert.equal(result.reason, 'jurisdiction_data_ban');
      assert.equal(adapter.calls.length, 0);
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('valid operator exception allows the dispatch AND writes a durable receipt', async () => {
    const root = makeTempRoot();
    try {
      writeDescriptor(root, VALID_GLM_DESCRIPTOR);
      const signalInfo = setupSignal(root, SENSITIVE_PROMPT, 'glm-exception');
      const adapter = recordingAdapter();
      const stamp = 'STAMP-EXCEPTION-001';

      const exception = {
        approval_source: 'operator:{OPERATOR_NAME}',
        reason: 'one-time approved analysis of redacted booking dataset',
        timestamp: '2026-06-29T12:00:00Z',
        target: 'glm-5.2-hosted',
        payload_classes: ['*']
      };

      const result = await runOpenRouterForSignal(root, signalInfo, {
        model: GLM_MODEL,
        adapter,
        exception,
        timestamp: stamp
      });

      assert.equal(result.mode, 'executed', 'exception should allow egress');
      assert.equal(adapter.calls.length, 1, 'egress proceeds under a valid exception');

      const receiptPath = path.join(
        root, '_dev', 'state', 'jurisdiction-exceptions', `${stamp}.json`
      );
      assert.ok(fs.existsSync(receiptPath), 'durable receipt file must be written');
      assert.equal(result.exceptionReceiptPath, receiptPath);

      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.equal(receipt.approval_source, 'operator:{OPERATOR_NAME}');
      assert.equal(receipt.reason, exception.reason);
      assert.equal(receipt.timestamp, exception.timestamp);
      assert.equal(receipt.target, 'glm-5.2-hosted');
      assert.equal(receipt.provider, 'openrouter');
      assert.equal(receipt.model, GLM_MODEL);
      assert.equal(receipt.jurisdiction, 'PRC');
      assert.ok(Array.isArray(receipt.sensitivity_class) && receipt.sensitivity_class.length > 0,
        'sensitivity_class must record the tripped classes');
      assert.ok(receipt.sensitivity_class.includes('pii'));
      assert.ok(typeof receipt.migration_path === 'string' && receipt.migration_path.length > 0);
      // Redaction contract: raw payload NOT persisted; only a hash + length.
      assert.ok(receipt.payload_reference, 'payload_reference present');
      assert.match(receipt.payload_reference.sha256, /^[a-f0-9]{64}$/);
      assert.ok(receipt.payload_reference.byte_length > 0);
      assert.ok(/not persisted/i.test(receipt.payload_reference.redaction));
      // The receipt must NOT contain the raw sensitive payload.
      assert.ok(!JSON.stringify(receipt).includes('jane.doe@example.com'),
        'raw sensitive payload must never appear in the receipt');
    } finally {
      cleanupTempRoot(root);
    }
  });

  it('resolveDispatchTarget returns a non-PRC descriptor for unknown slugs', () => {
    const res = resolveDispatchTarget('/nonexistent-root', 'openrouter/auto');
    assert.equal(res.source, 'non-prc-default');
    assert.ok(Array.isArray(res.descriptor.labels));
    assert.ok(!res.descriptor.labels.includes('prc-origin-risk'));
  });
});
