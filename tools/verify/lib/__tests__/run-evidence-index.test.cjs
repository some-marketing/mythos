'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validate } = require('../schema.cjs');
const {
  snapshotRunEvidence,
  verifyRunEvidence
} = require('../run-evidence-index.cjs');

const RECEIPT_SCHEMA = require('../../schemas/run-evidence-receipt.schema.json');
const INDEX_SCHEMA = require('../../schemas/run-evidence-index.schema.json');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evidence-index-'));
  fs.mkdirSync(path.join(root, 'runs/run-1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runs/run-1/result.txt'), 'verified bytes\n');
  fs.writeFileSync(path.join(root, 'runs/run-1/run_state.json'), JSON.stringify({
    run_id: 'run-1',
    framework_id: 'meta/test',
    status: 'completed',
    started_at: '2026-07-14T00:00:00Z',
    artifacts_produced: [{ path: 'runs/run-1/result.txt', type: 'result' }]
  }));
  return root;
}

function snapshot(root, overrides = {}) {
  return snapshotRunEvidence({
    projectRoot: root,
    runStatePath: 'runs/run-1/run_state.json',
    runId: 'run-1',
    criteria: [{ criterion_id: 'C1', artifact_path: 'runs/run-1/result.txt' }],
    producer: { actor_id: 'worker', harness_id: 'test-worker' },
    producedAt: '2026-07-14T00:01:00Z',
    ...overrides
  });
}

test('snapshot and later verification bind exact run, path, and current bytes', () => {
  const root = fixture();
  const receipt = snapshot(root);
  const index = verifyRunEvidence({
    projectRoot: root,
    receipt,
    runId: 'run-1',
    verifier: { actor_id: 'reviewer', harness_id: 'test-reviewer' },
    verifiedAt: '2026-07-14T00:02:00Z'
  });
  assert.equal(validate(receipt, RECEIPT_SCHEMA, { rootSchema: RECEIPT_SCHEMA }).length, 0);
  assert.equal(validate(index, INDEX_SCHEMA, { rootSchema: INDEX_SCHEMA }).length, 0);
  assert.equal(index.criteria[0].status, 'current_hash_verified');
  assert.equal(index.independent_verified, true);
  assert.equal(index.authority, 'report_only');
});

test('run identity is explicit and multiple or mismatched run states fail closed', () => {
  const root = fixture();
  assert.throws(() => snapshot(root, { runStatePath: ['a', 'b'] }), /ambiguous run state/);
  assert.throws(() => snapshot(root, { runId: 'run-2' }), /run_id mismatch/);
  assert.throws(() => snapshot(root, { runId: '' }), /explicit run_id/);
});

test('unmapped and run-undeclared criteria remain evidence_missing', () => {
  const root = fixture();
  const receipt = snapshot(root, { criteria: [
    { criterion_id: 'C1' },
    { criterion_id: 'C2', artifact_path: 'runs/run-1/other.txt' }
  ] });
  assert.deepEqual(receipt.criteria.map((item) => item.reason_code), ['unmapped_criterion', 'not_declared_by_run']);
});

test('stale bytes are evidence_missing rather than accepted', () => {
  const root = fixture();
  const receipt = snapshot(root);
  fs.writeFileSync(path.join(root, 'runs/run-1/result.txt'), 'changed bytes\n');
  const index = verifyRunEvidence({ projectRoot: root, receipt, runId: 'run-1', verifier: { actor_id: 'reviewer', harness_id: 'reviewer' } });
  assert.equal(index.criteria[0].status, 'evidence_missing');
  assert.equal(index.criteria[0].reason_code, 'stale_hash');
});

test('caller-only hash claims never become verified evidence', () => {
  const root = fixture();
  const receipt = { ...snapshot(root), source_type: 'caller_claim' };
  const index = verifyRunEvidence({ projectRoot: root, receipt, runId: 'run-1', verifier: { actor_id: 'reviewer', harness_id: 'reviewer' } });
  assert.equal(index.criteria[0].status, 'unverified_source_claim');
  assert.equal(index.independent_verified, false);
});

test('producer self-review is visible and cannot satisfy independent verification', () => {
  const root = fixture();
  const receipt = snapshot(root);
  const index = verifyRunEvidence({ projectRoot: root, receipt, runId: 'run-1', verifier: receipt.producer });
  assert.equal(index.criteria[0].status, 'current_hash_verified');
  assert.equal(index.independent_verified, false);
});

test('absolute, traversal, client, and symlink escape paths are rejected or missing', () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evidence-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'runs/run-1/escape.txt'));
  const statePath = path.join(root, 'runs/run-1/run_state.json');
  const state = JSON.parse(fs.readFileSync(statePath));
  state.artifacts_produced.push({ path: 'runs/run-1/escape.txt', type: 'result' });
  fs.writeFileSync(statePath, JSON.stringify(state));
  for (const artifact_path of ['/tmp/x', '../x', 'clients/ABC/x', 'runs/run-1/escape.txt']) {
    const receipt = snapshot(root, { criteria: [{ criterion_id: 'C1', artifact_path }] });
    assert.equal(receipt.criteria[0].status, 'evidence_missing');
    assert.equal(receipt.criteria[0].reason_code, 'path_boundary_violation');
  }
});

test('fixed timestamps make snapshot and verify output deterministic', () => {
  const root = fixture();
  const first = snapshot(root);
  const second = snapshot(root);
  assert.deepEqual(first, second);
  const options = { projectRoot: root, receipt: first, runId: 'run-1', verifier: { actor_id: 'reviewer', harness_id: 'reviewer' }, verifiedAt: '2026-07-14T00:02:00Z' };
  assert.deepEqual(verifyRunEvidence(options), verifyRunEvidence(options));
});
