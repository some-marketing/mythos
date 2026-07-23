'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Bytes, assertRelativePath, resolveContainedFile } = require('./run-evidence-index.cjs');
const { validateVerdictEnvelope } = require('./verdict-envelope.cjs');

function provenance(value, label) {
  if (!value || !value.actor_id || !value.harness_id) throw new Error(`${label} requires actor_id and harness_id`);
  return { actor_id: String(value.actor_id), harness_id: String(value.harness_id) };
}

function readBounded(projectRoot, relativePath, label) {
  const safe = assertRelativePath(relativePath, label);
  const resolved = resolveContainedFile(projectRoot, safe);
  if (!resolved.exists) throw new Error(`${label} does not exist`);
  const bytes = fs.readFileSync(resolved.real);
  return { safe, bytes, sha256: sha256Bytes(bytes) };
}

function readJsonBounded(projectRoot, relativePath, label) {
  const file = readBounded(projectRoot, relativePath, label);
  return { ...file, value: JSON.parse(file.bytes.toString('utf8')) };
}

function validateTestReceipt(receipt) {
  if (!receipt || receipt.schema !== 'TestExecutionReceipt/1.0') return false;
  if (!receipt.command || !Number.isInteger(receipt.exit_code) || !['passed', 'failed'].includes(receipt.status)) return false;
  const counts = receipt.counts;
  if (!counts || !['passed', 'failed', 'skipped', 'todo'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) return false;
  if ((receipt.exit_code === 0) !== (receipt.status === 'passed')) return false;
  if (receipt.status === 'passed' && counts.failed !== 0) return false;
  if (receipt.status === 'passed' && counts.passed < 1) return false;
  const started = Date.parse(receipt.started_at); const completed = Date.parse(receipt.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return false;
  return Boolean(receipt.producer && receipt.producer.actor_id && receipt.producer.harness_id);
}

function assembleCompletionAuditPacket(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  if (Array.isArray(options.runEvidencePath) || !options.runEvidencePath) throw new Error('exactly one runEvidencePath is required');
  if (!options.taskId) throw new Error('taskId is required');
  if (options.rawCommand || options.rawResult) throw new Error('raw command and result strings are forbidden');

  const planFile = readJsonBounded(projectRoot, options.planPath, 'plan_path');
  const indexFile = readJsonBounded(projectRoot, options.runEvidencePath, 'run_evidence_path');
  const envelopeFile = readJsonBounded(projectRoot, options.verdictEnvelopePath, 'verdict_envelope_path');
  const keyringFile = readJsonBounded(projectRoot, options.keyringPath || 'tools/verify/keys/operator-public-keyring.json', 'keyring_path');
  const index = indexFile.value;
  const envelope = envelopeFile.value;
  const missing = [];

  if (planFile.value.task_id !== options.taskId) missing.push('plan_task_mismatch');
  if (index.schema !== 'RunEvidenceIndex/1.0' || !index.run_id || index.independent_verified !== true) missing.push('run_evidence_invalid');
  const verdictValidation = validateVerdictEnvelope(envelope, keyringFile.value);
  if (!verdictValidation.ok || envelope.task_id !== options.taskId) missing.push('verdict_envelope_invalid');
  const semanticReceipt = envelope.semantic && envelope.semantic.receipt;
  if (!semanticReceipt || semanticReceipt.plan_sha256 !== planFile.sha256) missing.push('semantic_plan_hash_mismatch');
  if (!envelope.semantic || envelope.semantic.state !== 'approved') missing.push('semantic_review_not_approved');

  const indexCriteria = Array.isArray(index.criteria) ? index.criteria : [];
  const evidenceById = new Map(); const duplicateEvidenceIds = new Set();
  for (const item of indexCriteria) { if (evidenceById.has(item.criterion_id)) duplicateEvidenceIds.add(item.criterion_id); else evidenceById.set(item.criterion_id, item); }
  if (duplicateEvidenceIds.size) missing.push('run_evidence_duplicate_criterion_ids');
  const criterionIds = new Set();
  const criteria = (options.criteria || []).map((criterion) => {
    const criterionId = String(criterion.criterion_id || '');
    const duplicate = !criterionId || criterionIds.has(criterionId); criterionIds.add(criterionId);
    const ids = Array.isArray(criterion.evidence_criterion_ids) ? criterion.evidence_criterion_ids : [];
    const entries = ids.map((id) => evidenceById.get(id)).filter(Boolean);
    const mapped = !duplicate && ids.length > 0 && new Set(ids).size === ids.length && !ids.some((id) => duplicateEvidenceIds.has(id)) && entries.length === ids.length && entries.every((entry) => entry.status === 'current_hash_verified');
    if (!mapped) missing.push(`${duplicate ? 'criterion_duplicate_or_missing_id' : 'criterion_unmapped'}:${criterionId || 'unknown'}`);
    return { criterion_id: criterionId, description: String(criterion.description || ''), evidence_criterion_ids: ids, status: mapped ? 'mapped' : 'unmapped' };
  });
  if (criteria.length === 0) missing.push('criteria_missing');

  const changedFiles = (options.changedFiles || []).map((expected) => {
    let current = null; let status = 'missing';
    try { current = readBounded(projectRoot, expected.path, 'changed_file'); status = current.sha256 === expected.sha256 ? 'verified' : 'stale'; }
    catch (_) { status = 'boundary_or_missing'; }
    if (status !== 'verified') missing.push(`changed_file_${status}:${expected.path}`);
    return { path: String(expected.path || ''), expected_sha256: String(expected.sha256 || ''), current_sha256: current && current.sha256, status };
  });
  if (changedFiles.length === 0) missing.push('changed_files_missing');

  const evidenceByPath = new Map(); const duplicateEvidencePaths = new Set();
  for (const item of indexCriteria) { if (evidenceByPath.has(item.artifact_path)) duplicateEvidencePaths.add(item.artifact_path); else evidenceByPath.set(item.artifact_path, item); }
  if (duplicateEvidencePaths.size) missing.push('run_evidence_duplicate_artifact_paths');
  const tests = (options.testReceiptPaths || []).map((receiptPath) => {
    let file; let status = 'evidence_missing'; let receipt = null; let reason = null;
    try {
      file = readJsonBounded(projectRoot, receiptPath, 'test_receipt'); receipt = file.value;
      const indexed = evidenceByPath.get(file.safe);
      if (duplicateEvidencePaths.has(file.safe)) reason = 'ambiguous_run_evidence_path';
      else if (!indexed || indexed.status !== 'current_hash_verified' || indexed.current_sha256 !== file.sha256) reason = 'not_current_run_evidence';
      else if (!validateTestReceipt(receipt)) reason = 'invalid_test_receipt';
      else { status = 'verified'; reason = null; }
    } catch (_) { reason = 'boundary_or_missing'; }
    if (status !== 'verified') missing.push(`test_receipt_${reason}:${receiptPath}`);
    return { path: String(receiptPath), sha256: file && file.sha256, status, reason_code: reason, command: status === 'verified' ? receipt.command : null, result: status === 'verified' ? receipt.status : null, exit_code: status === 'verified' ? receipt.exit_code : null, counts: status === 'verified' ? receipt.counts : null, producer: status === 'verified' ? receipt.producer : null };
  });
  if (tests.length === 0) missing.push('test_receipts_missing');

  const uniqueMissing = [...new Set(missing)].sort();
  return {
    schema: 'CompletionAuditPacket/1.0', task_id: options.taskId,
    plan: { path: planFile.safe, sha256: planFile.sha256 },
    run_evidence: { path: indexFile.safe, sha256: indexFile.sha256, run_id: index.run_id || null, producer: index.producer || null, verifier: index.verifier || null },
    verdict: { path: envelopeFile.safe, sha256: envelopeFile.sha256, supplied_verdict_state: envelope.aggregate_state || 'invalid', valid: verdictValidation.ok, semantic_reviewer: semanticReceipt && semanticReceipt.reviewer || null, acceptance_owner: envelope.acceptance && envelope.acceptance.receipt ? envelope.acceptance.receipt.actor_id : null },
    criteria, changed_files: changedFiles, tests,
    blockers: Array.isArray(options.blockers) ? options.blockers : [],
    rollback_evidence: Array.isArray(options.rollbackEvidence) ? options.rollbackEvidence : [],
    packet_producer: provenance(options.packetProducer, 'packetProducer'),
    packet_state: uniqueMissing.length ? 'evidence_missing' : 'audit_ready',
    missing_reasons: uniqueMissing,
    built_at: options.builtAt || new Date().toISOString(), authority: 'report_only'
  };
}

module.exports = { readBounded, readJsonBounded, validateTestReceipt, assembleCompletionAuditPacket };
