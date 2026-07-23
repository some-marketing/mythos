'use strict';

const { sha256Bytes, stableJson } = require('./run-evidence-index.cjs');
const { verifyAcceptanceReceipt, validateKeyring } = require('./operator-acceptance-signature.cjs');

function hash(value) { return sha256Bytes(stableJson(value)); }
function missing(state, reason, receipt = null) { return { state, reason_code: reason, receipt_sha256: receipt ? hash(receipt) : null, receipt }; }

function structuralLayer(index) {
  const valid = index && index.schema === 'RunEvidenceIndex/1.0' && index.independent_verified === true &&
    index.summary && index.summary.criteria_total > 0 && index.summary.criteria_verified === index.summary.criteria_total &&
    Array.isArray(index.criteria) && index.criteria.every((item) => item.status === 'current_hash_verified');
  if (!index) return missing('evidence_missing', 'structural_index_missing');
  return missing(valid ? 'passed' : 'failed', valid ? null : 'structural_index_not_fully_verified', index);
}

function semanticLayer(indexHash, index, receipt) {
  if (!receipt) return missing('required', 'semantic_receipt_missing');
  const receiptHash = hash(receipt);
  if (receipt.schema !== 'SemanticVerdictReceipt/1.0' || receipt.structural_index_sha256 !== indexHash) return missing('required', 'semantic_root_mismatch', receipt);
  const reviewer = receipt.reviewer || {};
  const producer = (index && index.producer) || {};
  if (!reviewer.actor_id || !reviewer.harness_id || reviewer.actor_id === producer.actor_id || reviewer.harness_id === producer.harness_id) {
    return missing('required', 'semantic_self_review', receipt);
  }
  if (!['approve', 'reject', 'block'].includes(receipt.decision)) return missing('required', 'semantic_decision_invalid', receipt);
  if (Number(receipt.findings_artifact_count || 0) > 0) {
    const childIndex = receipt.semantic_child_index;
    const childValid = childIndex && childIndex.schema === 'RunEvidenceIndex/1.0' && childIndex.independent_verified === true && childIndex.summary && childIndex.summary.criteria_verified === childIndex.summary.criteria_total;
    if (!childValid || receipt.semantic_child_index_sha256 !== hash(childIndex)) return missing('required', 'semantic_child_index_invalid', receipt);
  } else if (receipt.semantic_child_index_sha256 != null || receipt.semantic_child_index != null) return missing('required', 'unexpected_semantic_child_index', receipt);
  return { state: receipt.decision === 'approve' ? 'approved' : 'rejected', reason_code: null, receipt_sha256: receiptHash, receipt };
}

function acceptanceLayer(taskId, indexHash, semantic, receipt, keyring) {
  if (!receipt) return missing('pending', 'acceptance_receipt_missing');
  const expectedChild = semantic.receipt && semantic.receipt.semantic_child_index_sha256 || null;
  if (receipt.task_id !== taskId || receipt.structural_index_sha256 !== indexHash || receipt.semantic_receipt_sha256 !== semantic.receipt_sha256 || receipt.semantic_child_index_sha256 !== expectedChild) {
    return missing('pending', 'acceptance_subject_mismatch', receipt);
  }
  const verified = verifyAcceptanceReceipt(receipt, keyring);
  if (!verified.ok) return missing('pending', verified.reason, receipt);
  return { state: receipt.decision === 'accept' ? 'accepted' : 'rejected', reason_code: null, receipt_sha256: hash(receipt), receipt };
}

function deriveAggregate(structural, semantic, acceptance) {
  if (structural.state === 'evidence_missing') return 'evidence_missing';
  if (structural.state !== 'passed') return 'structural_failed';
  if (semantic.state === 'required') return 'semantic_review_required';
  if (semantic.state !== 'approved') return 'semantic_rejected';
  if (acceptance.state === 'pending') return 'acceptance_pending';
  if (acceptance.state !== 'accepted') return 'acceptance_rejected';
  return 'accepted';
}

function buildVerdictEnvelope(options = {}) {
  if (!options.taskId) throw new Error('taskId is required');
  const keyringValid = validateKeyring(options.keyring);
  const structural = structuralLayer(options.structuralIndex);
  const indexHash = options.structuralIndex ? hash(options.structuralIndex) : null;
  const semantic = structural.state === 'passed' ? semanticLayer(indexHash, options.structuralIndex, options.semanticReceipt) : missing('required', 'lower_layer_not_passed', options.semanticReceipt || null);
  const acceptance = semantic.state === 'approved' && keyringValid.ok
    ? acceptanceLayer(options.taskId, indexHash, semantic, options.acceptanceReceipt, options.keyring)
    : missing('pending', keyringValid.ok ? 'lower_layer_not_passed' : keyringValid.reason, options.acceptanceReceipt || null);
  return { schema: 'VerdictEnvelope/1.0', task_id: options.taskId, structural, semantic, acceptance, aggregate_state: deriveAggregate(structural, semantic, acceptance), derived_at: options.derivedAt || new Date().toISOString(), authority: 'verdict_report' };
}

function validateVerdictEnvelope(envelope, keyring) {
  if (!envelope || envelope.schema !== 'VerdictEnvelope/1.0' || !envelope.task_id) return { ok: false, accepted: false, reason: 'invalid_envelope' };
  if (!['structural', 'semantic', 'acceptance'].every((name) => envelope[name] && typeof envelope[name] === 'object')) return { ok: false, accepted: false, reason: 'invalid_envelope_layers' };
  const rebuilt = buildVerdictEnvelope({ taskId: envelope.task_id, structuralIndex: envelope.structural && envelope.structural.receipt, semanticReceipt: envelope.semantic && envelope.semantic.receipt, acceptanceReceipt: envelope.acceptance && envelope.acceptance.receipt, keyring, derivedAt: envelope.derived_at });
  for (const name of ['structural', 'semantic', 'acceptance']) {
    for (const field of ['state', 'reason_code', 'receipt_sha256']) {
      if (rebuilt[name][field] !== envelope[name][field]) return { ok: false, accepted: false, reason: 'derived_state_mismatch' };
    }
  }
  if (rebuilt.aggregate_state !== envelope.aggregate_state) return { ok: false, accepted: false, reason: 'derived_state_mismatch' };
  return { ok: true, accepted: rebuilt.aggregate_state === 'accepted', reason: rebuilt.aggregate_state };
}

module.exports = { hash, buildVerdictEnvelope, validateVerdictEnvelope };
