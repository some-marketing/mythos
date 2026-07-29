'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { validate } = require('../schema.cjs');
const { hash, buildVerdictEnvelope, validateVerdictEnvelope } = require('../verdict-envelope.cjs');
const { appendPublicKey, publicKeyFingerprint, signAcceptanceReceipt, validateKeyring } = require('../operator-acceptance-signature.cjs');

const ENVELOPE_SCHEMA = require('../../schemas/verdict-envelope.schema.json');
const KEYRING_SCHEMA = require('../../schemas/operator-public-keyring.schema.json');

function keyFixture() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyring = appendPublicKey({ schema: 'OperatorPublicKeyring/1.0', current_fingerprint: null, keys: [] }, publicPem, '2026-07-14T00:00:00Z');
  return { pair, publicPem, privatePem, keyring };
}

function structural(overrides = {}) {
  return { schema: 'RunEvidenceIndex/1.0', run_id: 'run-1', receipt_sha256: 'sha256:' + 'a'.repeat(64), verified_at: '2026-07-14T00:00:00Z', producer: { actor_id: 'worker', harness_id: 'worker-h' }, verifier: { actor_id: 'verifier', harness_id: 'verifier-h' }, independent_verified: true, criteria: [{ criterion_id: 'C1', artifact_path: 'a', expected_sha256: 'sha256:' + 'b'.repeat(64), current_sha256: 'sha256:' + 'b'.repeat(64), status: 'current_hash_verified', reason_code: null }], summary: { criteria_total: 1, criteria_verified: 1, criteria_missing: 0, criteria_unverified: 0 }, authority: 'report_only', ...overrides };
}

function semantic(index, overrides = {}) {
  return { schema: 'SemanticVerdictReceipt/1.0', structural_index_sha256: hash(index), decision: 'approve', reviewer: { actor_id: 'reviewer', harness_id: 'reviewer-h' }, findings_artifact_count: 0, semantic_child_index_sha256: null, semantic_child_index: null, ...overrides };
}

function acceptedFixture(overrides = {}) {
  const keys = keyFixture(); const index = structural(); const review = semantic(index);
  const unsigned = { schema: 'HumanAcceptanceReceipt/1.0', task_id: 'task-1', acceptance_scope: 'implementation', decision: 'accept', structural_index_sha256: hash(index), semantic_receipt_sha256: hash(review), semantic_child_index_sha256: null, public_key_fingerprint: keys.keyring.current_fingerprint, actor_id: '{OPERATOR_NAME}', signed_at: '2026-07-14T00:01:00Z' };
  const receipt = signAcceptanceReceipt(unsigned, keys.privatePem);
  return { keys, index, review, receipt, options: { taskId: 'task-1', structuralIndex: index, semanticReceipt: review, acceptanceReceipt: receipt, keyring: keys.keyring, derivedAt: '2026-07-14T00:02:00Z', ...overrides } };
}

test('schema accepts the empty tracked keyring and a valid accepted envelope', () => {
  const f = acceptedFixture(); const envelope = buildVerdictEnvelope(f.options);
  assert.equal(validate(f.keys.keyring, KEYRING_SCHEMA, { rootSchema: KEYRING_SCHEMA }).length, 0);
  assert.equal(validate(envelope, ENVELOPE_SCHEMA, { rootSchema: ENVELOPE_SCHEMA }).length, 0);
  assert.equal(envelope.aggregate_state, 'accepted');
  assert.deepEqual(validateVerdictEnvelope(envelope, f.keys.keyring), { ok: true, accepted: true, reason: 'accepted' });
});

test('structural failure dominates supplied semantic and acceptance approvals', () => {
  const f = acceptedFixture(); f.options.structuralIndex = structural({ independent_verified: false });
  assert.equal(buildVerdictEnvelope(f.options).aggregate_state, 'structural_failed');
});

test('missing review, self review, and semantic rejection derive ordered non-accepted states', () => {
  const f = acceptedFixture();
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: null, acceptanceReceipt: null }).aggregate_state, 'semantic_review_required');
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: semantic(f.index, { reviewer: f.index.producer }) }).aggregate_state, 'semantic_review_required');
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: semantic(f.index, { reviewer: { actor_id: f.index.producer.actor_id, harness_id: 'other-h' } }) }).aggregate_state, 'semantic_review_required');
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: semantic(f.index, { reviewer: { actor_id: 'other', harness_id: f.index.producer.harness_id } }) }).aggregate_state, 'semantic_review_required');
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: semantic(f.index, { decision: 'reject' }) }).aggregate_state, 'semantic_rejected');
});

test('stored layer hashes and reason codes cannot drift from rederived values', () => {
  const f = acceptedFixture(); const envelope = buildVerdictEnvelope(f.options);
  assert.equal(validateVerdictEnvelope({ ...envelope, semantic: { ...envelope.semantic, receipt_sha256: 'sha256:' + '0'.repeat(64) } }, f.keys.keyring).ok, false);
  assert.equal(validateVerdictEnvelope({ ...envelope, acceptance: { ...envelope.acceptance, reason_code: 'caller_claim' } }, f.keys.keyring).ok, false);
});

test('malformed envelope layers fail closed without throwing', () => {
  const f = acceptedFixture(); const envelope = buildVerdictEnvelope(f.options);
  for (const name of ['structural', 'semantic', 'acceptance']) {
    const malformed = { ...envelope }; delete malformed[name];
    assert.deepEqual(validateVerdictEnvelope(malformed, f.keys.keyring), { ok: false, accepted: false, reason: 'invalid_envelope_layers' });
  }
});

test('semantic approval without a receipt and human rejection remain distinct', () => {
  const f = acceptedFixture();
  assert.equal(buildVerdictEnvelope({ ...f.options, acceptanceReceipt: null }).aggregate_state, 'acceptance_pending');
  const rejected = signAcceptanceReceipt({ ...f.receipt, decision: 'reject', signature: undefined }, f.keys.privatePem);
  assert.equal(buildVerdictEnvelope({ ...f.options, acceptanceReceipt: rejected }).aggregate_state, 'acceptance_rejected');
});

test('forged signatures and mismatched task, scope-bearing subject, or root fail closed', () => {
  const f = acceptedFixture();
  for (const receipt of [{ ...f.receipt, signature: Buffer.alloc(64).toString('base64') }, { ...f.receipt, task_id: 'other' }, { ...f.receipt, acceptance_scope: 'other' }, { ...f.receipt, structural_index_sha256: 'sha256:' + '0'.repeat(64) }]) {
    assert.equal(buildVerdictEnvelope({ ...f.options, acceptanceReceipt: receipt }).aggregate_state, 'acceptance_pending');
  }
});

test('keyring rejects duplicate and changed fingerprints', () => {
  const f = acceptedFixture();
  assert.equal(validateKeyring({ ...f.keys.keyring, keys: f.keys.keyring.keys.concat(f.keys.keyring.keys[0]) }).ok, false);
  assert.equal(validateKeyring({ ...f.keys.keyring, keys: [{ ...f.keys.keyring.keys[0], public_key_pem: keyFixture().publicPem }] }).reason, 'changed_key_entry');
});

test('rotation preserves verification under the prior fingerprint', () => {
  const f = acceptedFixture(); const next = keyFixture();
  const rotated = appendPublicKey(f.keys.keyring, next.publicPem, '2026-07-15T00:00:00Z');
  assert.equal(rotated.keys.find((entry) => entry.fingerprint === publicKeyFingerprint(f.keys.publicPem)).status, 'verification_only');
  assert.equal(buildVerdictEnvelope({ ...f.options, keyring: rotated }).aggregate_state, 'accepted');
});

test('semantic findings require an independently verified child index bound by hash', () => {
  const f = acceptedFixture(); const child = structural({ run_id: 'review-run' });
  const review = semantic(f.index, { findings_artifact_count: 1, semantic_child_index: child, semantic_child_index_sha256: hash(child) });
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: review, acceptanceReceipt: null }).aggregate_state, 'acceptance_pending');
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: { ...review, semantic_child_index_sha256: 'sha256:' + '0'.repeat(64) } }).aggregate_state, 'semantic_review_required');
  assert.doesNotThrow(() => buildVerdictEnvelope({ ...f.options, semanticReceipt: { ...review, semantic_child_index: { schema: 'RunEvidenceIndex/1.0', independent_verified: true } } }));
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: { ...review, semantic_child_index: { schema: 'RunEvidenceIndex/1.0', independent_verified: true } } }).aggregate_state, 'semantic_review_required');
});

test('zero-findings semantic receipt may omit child-index fields', () => {
  const f = acceptedFixture();
  const review = semantic(f.index); delete review.semantic_child_index; delete review.semantic_child_index_sha256;
  assert.equal(buildVerdictEnvelope({ ...f.options, semanticReceipt: review, acceptanceReceipt: null }).aggregate_state, 'acceptance_pending');
});

test('stamping CLI help is non-secret and non-TTY execution refuses before Keychain access', () => {
  const cli = path.resolve(__dirname, '../../stamp-verdict-acceptance.cjs');
  assert.equal(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).status, 0);
  const denied = spawnSync(process.execPath, [cli, 'stamp'], { encoding: 'utf8' });
  assert.notEqual(denied.status, 0); assert.match(denied.stderr, /interactive operator TTY required before Keychain access/);
});
