'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validate } = require('../schema.cjs');
const { sha256Bytes } = require('../run-evidence-index.cjs');
const { hash, buildVerdictEnvelope } = require('../verdict-envelope.cjs');
const { appendPublicKey, signAcceptanceReceipt } = require('../operator-acceptance-signature.cjs');
const { assembleCompletionAuditPacket } = require('../completion-audit-packet.cjs');

const PACKET_SCHEMA = require('../../schemas/completion-audit-packet.schema.json');
const TEST_SCHEMA = require('../../schemas/test-execution-receipt.schema.json');

function write(root, relative, value) {
  const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); return target;
}
function fileHash(root, relative) { return sha256Bytes(fs.readFileSync(path.join(root, relative))); }

function fixture({ accepted = false, selfReview = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-packet-'));
  const taskId = 'task-1'; const planPath = '_dev/reports/analysis/task-plans/task-1__plan.json';
  write(root, planPath, { task_id: taskId, bounded_plan: { steps: [] } });
  write(root, 'work/change.js', 'module.exports = true;\n');
  const testReceipt = { schema: 'TestExecutionReceipt/1.0', command: 'node --test example.test.js', exit_code: 0, status: 'passed', started_at: '2026-07-14T00:00:00Z', completed_at: '2026-07-14T00:00:01Z', counts: { passed: 2, failed: 0, skipped: 0, todo: 0 }, producer: { actor_id: 'worker', harness_id: 'worker-h' } };
  const testPath = '_dev/reports/analysis/tests/run-1.json'; write(root, testPath, testReceipt);
  const index = { schema: 'RunEvidenceIndex/1.0', run_id: 'run-1', producer: { actor_id: 'worker', harness_id: 'worker-h' }, verifier: { actor_id: 'verifier', harness_id: 'verifier-h' }, independent_verified: true, criteria: [{ criterion_id: 'C1', artifact_path: testPath, current_sha256: fileHash(root, testPath), status: 'current_hash_verified' }, { criterion_id: 'C2', artifact_path: 'work/change.js', current_sha256: fileHash(root, 'work/change.js'), status: 'current_hash_verified' }], summary: { criteria_total: 2, criteria_verified: 2 } };
  const indexPath = '_dev/reports/analysis/evidence/run-1.json'; write(root, indexPath, index);
  const pair = crypto.generateKeyPairSync('ed25519'); const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }); const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyring = appendPublicKey({ schema: 'OperatorPublicKeyring/1.0', current_fingerprint: null, keys: [] }, publicPem, '2026-07-14T00:00:00Z');
  const keyringPath = 'tools/verify/keys/operator-public-keyring.json'; write(root, keyringPath, keyring);
  const semantic = { schema: 'SemanticVerdictReceipt/1.0', structural_index_sha256: hash(index), plan_sha256: fileHash(root, planPath), decision: 'approve', reviewer: selfReview ? index.producer : { actor_id: 'reviewer', harness_id: 'reviewer-h' }, findings_artifact_count: 0, semantic_child_index_sha256: null, semantic_child_index: null };
  let acceptance = null;
  if (accepted) acceptance = signAcceptanceReceipt({ schema: 'HumanAcceptanceReceipt/1.0', task_id: taskId, acceptance_scope: 'implementation', decision: 'accept', structural_index_sha256: hash(index), semantic_receipt_sha256: hash(semantic), semantic_child_index_sha256: null, public_key_fingerprint: keyring.current_fingerprint, actor_id: '{OPERATOR_NAME}', signed_at: '2026-07-14T00:01:00Z' }, privatePem);
  const envelope = buildVerdictEnvelope({ taskId, structuralIndex: index, semanticReceipt: semantic, acceptanceReceipt: acceptance, keyring, derivedAt: '2026-07-14T00:02:00Z' });
  const envelopePath = '_dev/reports/analysis/verdict-envelopes/task-1.json'; write(root, envelopePath, envelope);
  const options = { projectRoot: root, taskId, planPath, runEvidencePath: indexPath, verdictEnvelopePath: envelopePath, keyringPath, criteria: [{ criterion_id: 'AC1', description: 'tests pass', evidence_criterion_ids: ['C1'] }], changedFiles: [{ path: 'work/change.js', sha256: fileHash(root, 'work/change.js') }], testReceiptPaths: [testPath], blockers: [], rollbackEvidence: ['delete additive packet files'], packetProducer: { actor_id: 'assembler', harness_id: 'packet-cli' }, builtAt: '2026-07-14T00:03:00Z' };
  return { root, options, index, envelope, testReceipt, paths: { planPath, indexPath, envelopePath, keyringPath, testPath } };
}

test('complete verified evidence yields audit_ready without claiming acceptance', () => {
  const f = fixture(); const packet = assembleCompletionAuditPacket(f.options);
  assert.equal(packet.packet_state, 'audit_ready'); assert.equal(packet.verdict.supplied_verdict_state, 'acceptance_pending'); assert.equal(packet.authority, 'report_only');
  assert.equal(validate(packet, PACKET_SCHEMA, { rootSchema: PACKET_SCHEMA }).length, 0);
  assert.equal(validate(f.testReceipt, TEST_SCHEMA, { rootSchema: TEST_SCHEMA }).length, 0);
});

test('unmapped criterion dominates an accepted supplied verdict', () => {
  const f = fixture({ accepted: true });
  const packet = assembleCompletionAuditPacket({ ...f.options, criteria: [{ criterion_id: 'AC1', evidence_criterion_ids: ['missing'] }] });
  assert.equal(packet.verdict.supplied_verdict_state, 'accepted'); assert.equal(packet.packet_state, 'evidence_missing');
});

test('raw command/result strings and ambiguous run selection are rejected', () => {
  const f = fixture();
  assert.throws(() => assembleCompletionAuditPacket({ ...f.options, rawCommand: 'passed' }), /raw command/);
  assert.throws(() => assembleCompletionAuditPacket({ ...f.options, runEvidencePath: [f.paths.indexPath, 'other.json'] }), /exactly one/);
});

test('test receipt must be valid and current exact run evidence', () => {
  const f = fixture(); write(f.root, f.paths.testPath, { ...f.testReceipt, status: 'failed' });
  const packet = assembleCompletionAuditPacket(f.options);
  assert.equal(packet.packet_state, 'evidence_missing'); assert.match(packet.missing_reasons.join(','), /test_receipt_not_current_run_evidence/);
});

test('a passing receipt cannot hide failed counts or reversed timestamps', () => {
  for (const kind of ['failed-count', 'reversed-time', 'zero-tests']) {
    const f = fixture();
    const bad = kind === 'failed-count' ? { ...f.testReceipt, counts: { ...f.testReceipt.counts, failed: 1 } } : kind === 'zero-tests' ? { ...f.testReceipt, counts: { passed: 0, failed: 0, skipped: 0, todo: 0 } } : { ...f.testReceipt, completed_at: '2026-07-13T00:00:00Z' };
    write(f.root, f.paths.testPath, bad); f.index.criteria[0].current_sha256 = fileHash(f.root, f.paths.testPath); write(f.root, f.paths.indexPath, f.index);
    const packet = assembleCompletionAuditPacket(f.options); assert.equal(packet.packet_state, 'evidence_missing'); assert.match(packet.missing_reasons.join(','), /invalid_test_receipt/);
  }
});

test('stale plan hash and stale changed-file bytes fail readiness', () => {
  const f = fixture(); write(f.root, f.paths.planPath, { task_id: 'task-1', changed: true }); write(f.root, 'work/change.js', 'changed\n');
  const packet = assembleCompletionAuditPacket(f.options);
  assert.equal(packet.packet_state, 'evidence_missing'); assert.match(packet.missing_reasons.join(','), /semantic_plan_hash_mismatch/); assert.match(packet.missing_reasons.join(','), /changed_file_stale/);
});

test('semantic self-review remains insufficient', () => {
  const f = fixture({ selfReview: true }); const packet = assembleCompletionAuditPacket(f.options);
  assert.equal(packet.packet_state, 'evidence_missing'); assert.match(packet.missing_reasons.join(','), /semantic_review_not_approved/);
});

test('client, env, traversal, absolute, and symlink escapes are never read', () => {
  const f = fixture(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-packet-outside-')); write(outside, 'secret.txt', 'secret');
  const link = path.join(f.root, 'work/escape.txt'); fs.symlinkSync(path.join(outside, 'secret.txt'), link);
  for (const bad of ['clients/ABC/file', '.env', '../outside', '/tmp/outside', 'work/escape.txt']) {
    const packet = assembleCompletionAuditPacket({ ...f.options, changedFiles: [{ path: bad, sha256: 'sha256:' + '0'.repeat(64) }] });
    assert.equal(packet.packet_state, 'evidence_missing'); assert.match(packet.changed_files[0].status, /boundary_or_missing/);
  }
});

test('empty changed files, criteria, or tests remain explicit missing evidence', () => {
  const f = fixture(); const packet = assembleCompletionAuditPacket({ ...f.options, changedFiles: [], criteria: [], testReceiptPaths: [] });
  assert.equal(packet.packet_state, 'evidence_missing');
  assert.deepEqual(packet.missing_reasons.filter((x) => x.endsWith('_missing')), ['changed_files_missing', 'criteria_missing', 'test_receipts_missing']);
});

test('duplicate criterion ids or evidence mappings are ambiguous and fail closed', () => {
  const f = fixture();
  const duplicateId = assembleCompletionAuditPacket({ ...f.options, criteria: [f.options.criteria[0], f.options.criteria[0]] });
  assert.equal(duplicateId.packet_state, 'evidence_missing');
  const duplicateEvidence = assembleCompletionAuditPacket({ ...f.options, criteria: [{ criterion_id: 'AC1', evidence_criterion_ids: ['C1', 'C1'] }] });
  assert.equal(duplicateEvidence.packet_state, 'evidence_missing');
});

test('duplicate ids or artifact paths inside run evidence fail closed', () => {
  const f = fixture();
  f.index.criteria.push({ ...f.index.criteria[0] }); write(f.root, f.paths.indexPath, f.index);
  const packet = assembleCompletionAuditPacket(f.options); assert.equal(packet.packet_state, 'evidence_missing');
  assert.match(packet.missing_reasons.join(','), /run_evidence_duplicate/);
});

function cliConfig(f) {
  return { task_id: f.options.taskId, plan_path: f.options.planPath, run_evidence_path: f.options.runEvidencePath, verdict_envelope_path: f.options.verdictEnvelopePath, keyring_path: f.options.keyringPath, criteria: f.options.criteria, changed_files: f.options.changedFiles, test_receipt_paths: f.options.testReceiptPaths, blockers: [], rollback_evidence: [], packet_producer: f.options.packetProducer, built_at: f.options.builtAt };
}

test('CLI rejects outside symlink parents before creating directories', () => {
  const f = fixture(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-output-outside-'));
  write(f.root, 'config.json', cliConfig(f)); fs.symlinkSync(outside, path.join(f.root, 'outside-link'));
  const cli = path.resolve(__dirname, '../../build-completion-audit-packet.cjs');
  const result = spawnSync(process.execPath, [cli, '--root', f.root, '--config', 'config.json', '--output', 'outside-link/new-dir/packet.json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(fs.existsSync(path.join(outside, 'new-dir')), false);
});

test('CLI rejects a broken output symlink without creating its outside target', () => {
  const f = fixture(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'packet-broken-output-'));
  write(f.root, 'config.json', cliConfig(f)); const target = path.join(outside, 'new-packet.json');
  fs.symlinkSync(target, path.join(f.root, 'packet.json'));
  const cli = path.resolve(__dirname, '../../build-completion-audit-packet.cjs');
  const result = spawnSync(process.execPath, [cli, '--root', f.root, '--config', 'config.json', '--output', 'packet.json'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(fs.existsSync(target), false); assert.match(result.stderr, /output path is a symlink/);
});
