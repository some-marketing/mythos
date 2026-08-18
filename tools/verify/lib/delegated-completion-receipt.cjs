'use strict';

const { validateTestReceipt } = require('./completion-audit-packet.cjs');
const RECEIPT_SCHEMA = 'DelegatedCompletionReceipt/1.0';
const COMPLETED_STATUSES = new Set(['complete', 'completed', 'done']);
const text = value => typeof value === 'string' ? value.trim() : '';
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values)];

function validateDelegatedCompletionReceipt(payload, options = {}) {
  const errors = [];
  const receipt = payload && payload.completion_receipt && typeof payload.completion_receipt === 'object' ? payload.completion_receipt : payload;
  const status = text(payload && payload.status) || text(receipt && receipt.status);
  // Normalize case for the gate membership check only (Codex review, PR #18:
  // 'Completed'/'DONE'/etc. previously skipped receipt validation entirely
  // because this check and validateActorReturn's identical pre-check were
  // both case-sensitive). The returned `status` field stays as-authored.
  if (!COMPLETED_STATUSES.has(status.toLowerCase())) return { valid: true, accepted: false, status, errors };
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { valid: false, accepted: false, status, errors: ['completion receipt must be an object'] };
  if (receipt.schema !== RECEIPT_SCHEMA) errors.push('completion receipt schema is missing or unsupported');
  // The receipt's scope identifies the delegated/child work, which may
  // intentionally differ from the parent's own scope identity — prefer the
  // delegated scope (options.scope) over the parent's own scope
  // (options.parentScope) when it's available. Codex review, PR #18.
  const expectedScope = text(options.scope || options.parentScope), actualScope = text(receipt.scope);
  if (!actualScope) errors.push('completion receipt scope is missing'); else if (expectedScope && actualScope !== expectedScope) errors.push(`completion receipt scope mismatch: expected ${expectedScope}`);
  const changedFiles = list(receipt.changed_files);
  if (changedFiles.some(entry => !entry || typeof entry !== 'object' || !text(entry.path))) errors.push('changed_files contains an invalid entry');
  const changedPaths = changedFiles.map(entry => text(entry && entry.path)).filter(Boolean);
  if (new Set(changedPaths).size !== changedPaths.length) errors.push('changed_files contains duplicate paths');
  const parent = receipt.parent_verification;
  if (!parent || parent.observed !== true || !text(parent.actor_id)) errors.push('parent_verification must identify an independent observation');
  if (changedFiles.length === 0) {
    if (!parent || parent.workspace_clean !== true || parent.changed_files_verified !== true) errors.push('empty changed_files requires parent-verified clean workspace');
  } else if (unique(list(parent && parent.observed_changed_files).map(text).filter(Boolean)).sort().join('\n') !== unique(changedPaths).sort().join('\n')) errors.push('changed_files are not substantiated by the parent observation');
  const tests = list(receipt.test_results);
  if (!tests.length) errors.push('test_results are missing');
  for (const result of tests) if (!validateTestReceipt(result)) errors.push('test_results contains an unsubstantiated or failing receipt');
  const producerIds = new Set(tests.map(result => text(result && result.producer && result.producer.actor_id)).filter(Boolean));
  for (const candidate of [payload && payload.actor_id, payload && payload.producer && payload.producer.actor_id, receipt.producer && receipt.producer.actor_id]) {
    const actorId = text(candidate);
    if (actorId) producerIds.add(actorId);
  }
  if (parent && producerIds.has(text(parent.actor_id))) errors.push('parent_verification actor must be distinct from the completion producer');
  const criteria = list(options.criteria).length ? list(options.criteria) : list(receipt.acceptance_criteria);
  const expected = unique(criteria.map(item => text(item && (item.criterion_id || item.id))).filter(Boolean));
  const evidence = list(receipt.acceptance_evidence), mapped = evidence.map(item => text(item && item.criterion_id)).filter(Boolean);
  if (!expected.length) errors.push('acceptance criteria are missing');
  if (!evidence.length) errors.push('acceptance_evidence is missing');
  if (new Set(mapped).size !== mapped.length) errors.push('acceptance_evidence contains duplicate criteria');
  for (const id of expected) { const item = evidence.find(entry => text(entry && entry.criterion_id) === id); if (!item || !list(item.evidence).length || item.independently_verified !== true) errors.push(`acceptance criterion is unmapped or unverified: ${id}`); }
  if (mapped.some(id => !expected.includes(id))) errors.push('acceptance_evidence includes an unexpected criterion');
  const verified = list(parent && parent.acceptance_criteria_verified).map(text).filter(Boolean);
  if (expected.some(id => !verified.includes(id))) errors.push('parent verification does not cover every acceptance criterion');
  return { valid: errors.length === 0, accepted: errors.length === 0, status, errors };
}

module.exports = { RECEIPT_SCHEMA, COMPLETED_STATUSES, validateDelegatedCompletionReceipt };
