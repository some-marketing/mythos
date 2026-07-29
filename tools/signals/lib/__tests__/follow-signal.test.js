'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../');

// Helper to create a dummy project root for testing
function setupTestProject(id) {
  const testRoot = path.join(ROOT, '_dev/tmp/test-follow-signal-' + id);
  if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  fs.mkdirSync(testRoot, { recursive: true });
  fs.mkdirSync(path.join(testRoot, '_dev/reports/signals'), { recursive: true });
  fs.mkdirSync(path.join(testRoot, '_dev/reports/analysis/task-plans'), { recursive: true });
  return testRoot;
}

const VALID_BASE_SIGNAL = {
  schema: 'HandoffSignal/1.0',
  signal_type: 'ready-for-review',
  lifecycle_state: 'live',
  source: 'test',
  scope: 'test-scope',
  timestamp: new Date().toISOString(),
  recommended_next_actor: 'claude',
  recommended_next_command: '/test-command',
  next_step_detail: ['Step 1'],
  artifacts: [],
  decision_context_artifacts: [],
  blocked_by: []
};

const HASH_A = `sha256:${'a'.repeat(64)}`;
function handoffEvidence(overrides = {}) {
  const base = {
    workstream_scope: 'test-scope', branch: 'main', head_commit: '0123456789abcdef0123456789abcdef01234567',
    plan_sha256: HASH_A, review_sha256: HASH_A, signal_id: 'signal-1', signal_content_sha256: HASH_A, content_sha256: HASH_A
  };
  return {
    handoff: { ...base, recommended_next_command: '/test-command' },
    current: { ...base, ...(overrides.current || {}) },
    semantic_contradiction: Boolean(overrides.semantic_contradiction)
  };
}

test('follow-signal: approval inference requires both the operator stamp and approved review state', () => {
  const { inferTaskPlanApproval } = require('../follow-signal');
  const plan = { 'plan-task-review-state': { operator_stamp: { status: 'approved' } } };
  const marker = {
    post_review: {
      decision: 'approved',
      approval_reference: '_dev/reports/analysis/launch-gate.md'
    }
  };

  assert.equal(inferTaskPlanApproval(plan).approved, false, 'operator stamp alone must not pass');
  assert.equal(inferTaskPlanApproval({}, marker).approved, false, 'review marker alone must not pass');
  assert.equal(inferTaskPlanApproval(plan, marker).approved, true);
});

test('follow-signal: explicit top-level approval remains supported', () => {
  const { inferTaskPlanApproval } = require('../follow-signal');
  const result = inferTaskPlanApproval({ approval: { status: 'approved' } });
  assert.equal(result.approved, true);
  assert.equal(result.reason, 'approval.status=approved');
});

test('follow-signal: resolves valid coordination signal', (t) => {
  const projectRoot = setupTestProject('valid-signal');
  const signalPath = path.join(projectRoot, '_dev/reports/signals/test.signal.json');
  fs.writeFileSync(signalPath, JSON.stringify(VALID_BASE_SIGNAL));

  const { resolveAuthority } = require('../follow-signal');
  const decision = resolveAuthority(projectRoot, { scope: 'test-scope' });

  assert.strictEqual(decision.status, 'allowed');
  assert.strictEqual(decision.exact_command, '/test-command');
});

test('follow-signal: allows override of blocked signal with command', (t) => {
  const projectRoot = setupTestProject('override-blocked');
  const signalPath = path.join(projectRoot, '_dev/reports/signals/blocked.signal.json');
  const blockedSignal = { 
    ...VALID_BASE_SIGNAL, 
    signal_type: 'blocked',
    blocked_by: ['Testing blocker']
  };
  fs.writeFileSync(signalPath, JSON.stringify(blockedSignal));

  const { resolveAuthority } = require('../follow-signal');
  const decision = resolveAuthority(projectRoot, { 
    scope: 'test-scope', 
    allowOverride: 'Force execution despite blocker',
    execute: true 
  });

  assert.strictEqual(decision.status, 'override-executed');
  assert.strictEqual(decision.exact_command, '/test-command');
  assert.strictEqual(decision.override.active, true);
});

test('follow-signal: allows override of ambiguous signals (but stays allowed, not executed)', (t) => {
  const projectRoot = setupTestProject('override-ambiguous');
  const signal1 = { ...VALID_BASE_SIGNAL, signal_scope: 'test-scope', recommended_next_command: '/cmd1' };
  const signal2 = { ...VALID_BASE_SIGNAL, signal_scope: 'test-scope', recommended_next_command: '/cmd2' };
  
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/s1.json'), JSON.stringify(signal1));
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/s2.json'), JSON.stringify(signal2));

  const { resolveAuthority } = require('../follow-signal');
  const decision = resolveAuthority(projectRoot, { 
    scope: 'test-scope', 
    allowOverride: 'I will pick manually later',
    execute: true 
  });

  assert.strictEqual(decision.status, 'override-allowed'); // Stays allowed because no exact command is known
  assert.strictEqual(decision.exact_command, '');
});

test('follow-signal: consistent handoff evidence remains report-only and allows existing authority', () => {
  const projectRoot = setupTestProject('handoff-consistent');
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/test.signal.json'), JSON.stringify(VALID_BASE_SIGNAL));
  const { resolveAuthority } = require('../follow-signal');
  const decision = resolveAuthority(projectRoot, { scope: 'test-scope', handoffAuthority: handoffEvidence() });
  assert.equal(decision.status, 'allowed');
  assert.equal(decision.handoff_authority_assessment.state, 'consistent');
});

test('follow-signal: stale handoff blocks execution without replacing the original command', () => {
  const projectRoot = setupTestProject('handoff-stale');
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/test.signal.json'), JSON.stringify(VALID_BASE_SIGNAL));
  const { resolveAuthority } = require('../follow-signal');
  const decision = resolveAuthority(projectRoot, {
    scope: 'test-scope', execute: true,
    handoffAuthority: handoffEvidence({ current: { head_commit: 'changed-head' } })
  });
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.exact_command, '/test-command');
  assert.equal(decision.handoff_authority_assessment.original_recommendation, '/test-command');
  assert.equal(decision.handoff_authority_assessment.replacement_command, null);
  assert.equal(decision.recovery_command, '/review-progress test-scope');
});

test('follow-signal: human override remains the only way past a stale handoff block', () => {
  const projectRoot = setupTestProject('handoff-override');
  fs.writeFileSync(path.join(projectRoot, '_dev/reports/signals/test.signal.json'), JSON.stringify(VALID_BASE_SIGNAL));
  const { resolveAuthority } = require('../follow-signal');
  const decision = resolveAuthority(projectRoot, {
    scope: 'test-scope', execute: true, allowOverride: 'Human accepts the stale handoff risk.',
    handoffAuthority: handoffEvidence({ current: { plan_sha256: `sha256:${'b'.repeat(64)}` } })
  });
  assert.equal(decision.status, 'override-executed');
  assert.equal(decision.override.active, true);
  assert.equal(decision.handoff_authority_assessment.state, 'stale');
});
