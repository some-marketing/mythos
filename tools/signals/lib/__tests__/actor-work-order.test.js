'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCapabilityReceipt,
  classifyFailure,
  hashWorkOrder,
  immutableTargetTuple,
  loadFailureDecision,
  persistFailureDecisionAtomic,
  scrubSensitive,
  validateActorWorkOrder
} = require('../actor-work-order');
const { buildActorRunArtifacts } = require('../actor-auto');

function order(overrides = {}) {
  const target = overrides.target || 'claude';
  const value = {
    schema: 'ActorWorkOrder/1.0',
    dispatch_id: 'dispatch-1',
    continuity: { current_state: 'A reviewed plan exists.', question_work: 'Review one bounded plan.', desired_state: 'A verdict exists.' },
    actor: { target, model: 'claude-sonnet', mind: 'claude', command: '/review-task-plan sample' },
    execution: { mode: 'REVIEW_ONLY', required_mcp: [] },
    custody: { scope: 'system:sample', owner: 'coordinator' },
    privacy: { access: 'repository', allowed_refs: ['tools/signals'] },
    disclosure: { model: 'claude-sonnet', mind: 'claude' },
    max_retries: 1
  };
  if (target === 'claude') value.fable_conduct = false;
  return { ...value, ...overrides, actor: overrides.actor || value.actor };
}

describe('ActorWorkOrder validation', () => {
  it('accepts a continuity-bearing Claude order with explicit no-Fable conduct', () => {
    assert.deepEqual(validateActorWorkOrder(order()), { valid: true, errors: [] });
  });

  it('blocks missing continuity, unresolved model, unsupported mode, custody, privacy, and retry range', () => {
    const value = order();
    value.continuity.current_state = '';
    value.actor.model = '';
    value.execution.mode = 'unsafe';
    value.custody.scope = '';
    value.privacy = null;
    value.max_retries = 3;
    const result = validateActorWorkOrder(value);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /current_state|actor.model|mode|custody|privacy|max_retries/);
  });

  it('requires fable_conduct=false for Claude and forbids it for other targets', () => {
    const missing = order();
    delete missing.fable_conduct;
    assert.match(validateActorWorkOrder(missing).errors.join('\n'), /fable_conduct=false/);
    assert.match(validateActorWorkOrder(order({ fable_conduct: true })).errors.join('\n'), /fable_conduct=false/);
    assert.match(validateActorWorkOrder(order({ target: 'gemini', actor: { target: 'gemini', model: 'gemini-3', mind: 'gemini', command: 'freeform' }, disclosure: { model: 'gemini-3', mind: 'gemini' }, fable_conduct: false })).errors.join('\n'), /only valid for Claude/);
  });

  it('rejects mixed-case target values so schema and executable validation agree', () => {
    const value = order();
    value.actor.target = 'Claude';
    assert.match(validateActorWorkOrder(value).errors.join('\n'), /target must be lowercase/);
  });

  it('binds model and mind disclosure to the authorized actor tuple', () => {
    const value = order();
    value.disclosure.model = 'other';
    assert.match(validateActorWorkOrder(value).errors.join('\n'), /disclosure.model/);
  });
});

describe('capability receipts and redaction', () => {
  it('emits only redacted facts and repository-relative references', () => {
    const receipt = buildCapabilityReceipt(order(), {
      references: ['tools/signals/lib/actor-auto.js', '/tmp/private'],
      errors: ['Authorization: Bearer abcdefghijklmnop', 'url?access_token=super-secret-value'],
      environment: process.env
    });
    const serialized = JSON.stringify(receipt);
    assert.equal(receipt.references.length, 1);
    assert.doesNotMatch(serialized, /abcdefghijklmnop|super-secret-value|HOME|PATH/);
    assert.match(serialized, /REDACTED/);
  });

  it('fails readiness for missing MCP, privacy mismatch, or unsupported command', () => {
    const receipt = buildCapabilityReceipt(order(), { mcp_ready: false, privacy_compatible: false, command_supported: false });
    assert.equal(receipt.ready, false);
    assert.equal(receipt.checks.mcp_ready, false);
  });

  it('scrubs sensitive keys and common provider or URL token forms recursively', () => {
    const safe = scrubSensitive({ api_key: 'value', environment: { HOME: '/private/home' }, nested: ['sk-abcdefghijk', 'AIza123456789012345678901234', 'https://x.test/?token=abcdefghi'] });
    assert.equal(safe.api_key, '[REDACTED]');
    assert.equal(safe.environment, '[REDACTED]');
    assert.doesNotMatch(JSON.stringify(safe), /abcdefghijk|abcdefghi|AIza|private\/home/);
  });
});

describe('failure decisions and restart-safe budgets', () => {
  it('retries only timeout or transport failures on the immutable tuple', () => {
    const value = order();
    const before = immutableTargetTuple(value);
    const decision = classifyFailure({ timedOut: true, message: 'timeout' }, value, 1);
    assert.equal(decision.disposition, 'retry_same_target');
    assert.deepEqual(decision.target_tuple, before);
    assert.equal(decision.work_order_sha256, hashWorkOrder(value));
  });

  it('never retries terminal authority and safety classes', () => {
    for (const message of ['authentication failed', 'permission denied', 'safety policy refusal', 'privacy mismatch', 'unsupported mode', 'custody violation']) {
      assert.equal(classifyFailure({ message }, order(), 1).disposition, 'stop_terminal', message);
    }
  });

  it('escalates semantic selection rather than guessing a new target', () => {
    const decision = classifyFailure({ message: 'unknown target requires semantic selection' }, order(), 1);
    assert.equal(decision.disposition, 'escalate_coordinator');
    assert.equal(decision.target_tuple.target, 'claude');
  });

  it('persists a failure decision atomically and reloads an exhausted budget after restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-work-order-'));
    try {
      const resultPath = path.join(root, 'run.result.json');
      const value = order();
      persistFailureDecisionAtomic(resultPath, { actor: 'claude' }, classifyFailure({ timedOut: true }, value, 1));
      const prior = loadFailureDecision(resultPath);
      assert.equal(prior.attempt_count, 1);
      const exhausted = classifyFailure({ timedOut: true }, value, prior.attempt_count + 1);
      assert.equal(exhausted.disposition, 'escalate_coordinator');
      assert.equal(exhausted.target_tuple.target, prior.target_tuple.target);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses dispatch_id rather than process timestamp for actor run-result continuity', () => {
    const root = path.join(os.tmpdir(), 'actor-artifact-root');
    const signalInfo = {
      signal: {
        scope: 'stable-scope',
        execution: { actor_work_order: order() }
      }
    };
    const first = buildActorRunArtifacts(root, 'claude', signalInfo, '20260715T010000Z');
    const restarted = buildActorRunArtifacts(root, 'claude', signalInfo, '20260715T020000Z');
    assert.equal(first.runResultPath, restarted.runResultPath);
    assert.match(first.runResultPath, /dispatch-1/);
    assert.notEqual(first.completionReportPath, restarted.completionReportPath);
  });
});
