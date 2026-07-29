'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildClaudeDirective,
  buildLoopState,
  deriveLoopRecommendation,
  fingerprintJson
} = require('../pipeline-loop.js');
const { COORDINATION_SCHEMA_VERSION } = require('../../../verify/lib/signal.cjs');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-loop-'));
  fs.mkdirSync(path.join(root, 'instructions', 'canonical', 'commands'), { recursive: true });
  for (const id of ['review-progress', 'plan-pipeline', 'advance-pipeline', 'route', 'help-me-route']) {
    fs.writeFileSync(path.join(root, 'instructions', 'canonical', 'commands', id + '.yaml'), '{}\n');
  }
  return root;
}

function paths(root) {
  return {
    signalDir: path.join(root, 'signals'),
    reviewArtifactPath: path.join(root, 'review.json'),
    planArtifactPath: path.join(root, 'plan.json'),
    activeWorkstreamsArtifactPath: path.join(root, 'active.json')
  };
}

function signal() {
  return {
    schema: COORDINATION_SCHEMA_VERSION,
    lifecycle_state: 'live',
    signal_type: 'ready_for_review',
    source: 'claude-sonnet',
    timestamp: '2026-07-14T10:00:00Z',
    recommended_next_command: '/advance-pipeline'
  };
}

test('false-fresh mtime cannot replace missing review relationship', () => {
  const root = fixtureRoot();
  const p = paths(root);
  const sig = signal();
  writeJson(path.join(p.signalDir, 'signal.json'), sig);
  writeJson(p.reviewArtifactPath, { failures: [], timestamp: '2026-07-14T11:00:00Z' });
  const future = new Date('2030-01-01T00:00:00Z');
  fs.utimesSync(p.reviewArtifactPath, future, future);

  const result = deriveLoopRecommendation(buildLoopState(root, p));
  assert.equal(result.command, '/review-progress advance-pipeline');
  assert.match(result.reason, /waiting for an independent progress review/);
  assert.equal(result.required_transition_evidence.review_of_fingerprint, fingerprintJson(sig));
  assert.match(buildClaudeDirective(result).join('\n'), new RegExp(fingerprintJson(sig)));
});

test('false-stale mtime is ignored when review names exact signal fingerprint', () => {
  const root = fixtureRoot();
  const p = paths(root);
  const sig = signal();
  writeJson(path.join(p.signalDir, 'signal.json'), sig);
  writeJson(p.reviewArtifactPath, {
    failures: [],
    transition_evidence: {
      review_of_fingerprint: fingerprintJson(sig),
      producer: 'codex',
      produced_at: '2026-07-14T10:05:00Z',
      relationship: 'review_of'
    }
  });
  const past = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(p.reviewArtifactPath, past, past);

  const result = deriveLoopRecommendation(buildLoopState(root, p));
  assert.equal(result.command, '/advance-pipeline');
  assert.equal(result.invocation.terminal_state, null);
  assert.equal(result.invocation.resolution_state, 'resolved');
});

test('unknown recommended command is preserved through route fallback', () => {
  const root = fixtureRoot();
  const p = paths(root);
  writeJson(p.planArtifactPath, { next_recommended_command: '/unknown-command a b' });
  const result = deriveLoopRecommendation(buildLoopState(root, p));
  assert.equal(result.command, '/route "/unknown-command a b"');
  assert.equal(result.invocation.original_input, '/unknown-command a b');
  assert.equal(result.invocation.terminal_state, 'unsupported');
});

test('normalized JSON fingerprint ignores key order but not content', () => {
  assert.equal(fingerprintJson({ b: 2, a: 1 }), fingerprintJson({ a: 1, b: 2 }));
  assert.notEqual(fingerprintJson({ a: 1 }), fingerprintJson({ a: 2 }));
});

test('supersession evidence cannot masquerade as independent review evidence', () => {
  const root = fixtureRoot();
  const p = paths(root);
  const sig = signal();
  writeJson(path.join(p.signalDir, 'signal.json'), sig);
  writeJson(p.reviewArtifactPath, {
    failures: [],
    transition_evidence: {
      supersedes_fingerprint: fingerprintJson(sig),
      producer: 'codex',
      produced_at: '2026-07-14T10:05:00Z',
      relationship: 'supersedes'
    }
  });
  const result = deriveLoopRecommendation(buildLoopState(root, p));
  assert.equal(result.command, '/review-progress advance-pipeline');
});
