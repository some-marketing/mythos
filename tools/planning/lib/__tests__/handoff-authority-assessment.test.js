'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assessHandoffAuthority } = require('../handoff-authority-assessment');
const { validate } = require('../../../verify/lib/schema.cjs');
const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas/handoff-authority-assessment.schema.json'), 'utf8'));

const HASH_A = `sha256:${'a'.repeat(64)}`;

function evidence(overrides = {}) {
  return {
    workstream_scope: 'system:sample',
    branch: 'main',
    head_commit: '0123456789abcdef0123456789abcdef01234567',
    plan_sha256: HASH_A,
    review_sha256: HASH_A,
    signal_id: 'signal-1',
    signal_content_sha256: HASH_A,
    content_sha256: HASH_A,
    ...overrides
  };
}

function assessment(overrides = {}) {
  const handoff = { ...evidence(), recommended_next_command: '/run-plan sample', ...(overrides.handoff || {}) };
  const current = { ...evidence(), ...(overrides.current || {}) };
  return assessHandoffAuthority({ handoff, current, semantic_contradiction: overrides.semantic_contradiction });
}

test('exact matching evidence is consistent and preserves the original recommendation as evidence', () => {
  const result = assessment();
  assert.equal(result.state, 'consistent');
  assert.equal(result.original_recommendation, '/run-plan sample');
  assert.equal(result.replacement_command, null);
  assert.equal(result.recovery_route, null);
});

test('repo ahead, repaired plan, changed review, signal, handoff, branch, and HEAD are stale', () => {
  for (const field of ['head_commit', 'plan_sha256', 'review_sha256', 'signal_id', 'signal_content_sha256', 'content_sha256', 'branch']) {
    const changed = field.includes('sha256')
      ? `sha256:${'b'.repeat(64)}`
      : field === 'head_commit' ? 'fedcba9876543210fedcba9876543210fedcba98' : `changed-${field}`;
    const result = assessment({ current: { [field]: changed } });
    assert.equal(result.state, 'stale', field);
    assert.ok(result.reason_codes.includes(`${field}_mismatch`), field);
  }
});

test('wrong workstream is cross_scope', () => {
  assert.equal(assessment({ current: { workstream_scope: 'system:other' } }).state, 'cross_scope');
});

test('superseded signal is stale even when exact identifiers still match', () => {
  const result = assessment({ current: { signal_superseded: true } });
  assert.equal(result.state, 'stale');
  assert.deepEqual(result.reason_codes, ['signal_superseded']);
});

test('missing identity and semantic contradiction require bounded review with original handoff retained', () => {
  const missing = assessment({ current: { plan_sha256: '' } });
  assert.equal(missing.state, 'review_required');
  assert.equal(missing.replacement_command, null);
  const semantic = assessment({ semantic_contradiction: true });
  assert.equal(semantic.state, 'review_required');
  assert.equal(semantic.original_recommendation, '/run-plan sample');
});

test('explicit current authority conflict is conflict', () => {
  assert.equal(assessment({ current: { authority_conflict: true } }).state, 'conflict');
});

test('helper source has no filesystem, child process, or git invocation', () => {
  const source = require('node:fs').readFileSync(require.resolve('../handoff-authority-assessment'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:fs|child_process)['"]\)|spawn|execFile|git\s/);
});

test('consistent, stale, cross-scope, conflict, and review-required outputs satisfy the schema', () => {
  const samples = [
    assessment(),
    assessment({ current: { plan_sha256: `sha256:${'b'.repeat(64)}` } }),
    assessment({ current: { workstream_scope: 'system:other' } }),
    assessment({ current: { authority_conflict: true } }),
    assessment({ current: { plan_sha256: '' } })
  ];
  for (const sample of samples) assert.deepEqual(validate(sample, schema, { rootSchema: schema, path: '' }), []);
});
