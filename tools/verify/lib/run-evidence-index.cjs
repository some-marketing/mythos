'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HASH_REF = /^sha256:[a-f0-9]{64}$/;

function sha256Bytes(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function assertProvenance(value, label) {
  if (!value || typeof value !== 'object' || !value.actor_id || !value.harness_id) {
    throw new Error(`${label} requires actor_id and harness_id`);
  }
  return { actor_id: String(value.actor_id), harness_id: String(value.harness_id) };
}

function assertRelativePath(relativePath, label = 'path') {
  if (typeof relativePath !== 'string' || !relativePath) throw new Error(`${label} is required`);
  if (path.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0')) {
    throw new Error(`${label} must be repo-relative`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || normalized === '.' || normalized.startsWith('../')) {
    throw new Error(`${label} must not traverse outside the project root`);
  }
  if (normalized === '.env' || normalized.startsWith('clients/')) {
    throw new Error(`${label} is outside the allowed system evidence surface`);
  }
  return normalized;
}

function resolveContainedFile(projectRoot, relativePath) {
  const safe = assertRelativePath(relativePath, 'artifact_path');
  const rootReal = fs.realpathSync(projectRoot);
  const candidate = path.resolve(rootReal, safe);
  if (!fs.existsSync(candidate)) return { safe, candidate, real: null, exists: false };
  const real = fs.realpathSync(candidate);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error('artifact_path resolves outside the project root');
  }
  if (!fs.statSync(real).isFile()) throw new Error('artifact_path must resolve to a file');
  return { safe, candidate, real, exists: true };
}

function loadExplicitRunState(projectRoot, runStatePath, runId) {
  if (Array.isArray(runStatePath)) throw new Error('ambiguous run state: exactly one path is required');
  const safe = assertRelativePath(runStatePath, 'run_state_path');
  const resolved = resolveContainedFile(projectRoot, safe);
  if (!resolved.exists) throw new Error('run_state_path does not exist');
  const state = JSON.parse(fs.readFileSync(resolved.real, 'utf8'));
  if (!runId) throw new Error('explicit run_id is required');
  if (state.run_id !== runId) throw new Error(`run_id mismatch: requested ${runId}, run state contains ${state.run_id || '(missing)'}`);
  return { safe, state };
}

function uniqueCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) throw new Error('criteria must be a non-empty array');
  const seen = new Set();
  return criteria.map((criterion) => {
    if (!criterion || !criterion.criterion_id) throw new Error('every criterion requires criterion_id');
    const id = String(criterion.criterion_id);
    if (seen.has(id)) throw new Error(`duplicate criterion_id: ${id}`);
    seen.add(id);
    return { ...criterion, criterion_id: id };
  }).sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));
}

function snapshotRunEvidence(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const { safe: runStatePath, state } = loadExplicitRunState(projectRoot, options.runStatePath, options.runId);
  const producer = assertProvenance(options.producer, 'producer');
  const artifacts = new Map((state.artifacts_produced || []).map((entry) => [entry.path, entry]));
  const criteria = uniqueCriteria(options.criteria).map((criterion) => {
    if (!criterion.artifact_path) {
      return { criterion_id: criterion.criterion_id, artifact_path: null, artifact_type: null, generation_sha256: null, status: 'evidence_missing', reason_code: 'unmapped_criterion' };
    }
    let safe;
    try { safe = assertRelativePath(criterion.artifact_path, 'artifact_path'); }
    catch (_) {
      return { criterion_id: criterion.criterion_id, artifact_path: String(criterion.artifact_path), artifact_type: null, generation_sha256: null, status: 'evidence_missing', reason_code: 'path_boundary_violation' };
    }
    const declared = artifacts.get(safe);
    if (!declared) {
      return { criterion_id: criterion.criterion_id, artifact_path: safe, artifact_type: null, generation_sha256: null, status: 'evidence_missing', reason_code: 'not_declared_by_run' };
    }
    let resolved;
    try { resolved = resolveContainedFile(projectRoot, safe); }
    catch (_) {
      return { criterion_id: criterion.criterion_id, artifact_path: safe, artifact_type: declared.type || null, generation_sha256: null, status: 'evidence_missing', reason_code: 'path_boundary_violation' };
    }
    if (!resolved.exists) {
      return { criterion_id: criterion.criterion_id, artifact_path: safe, artifact_type: declared.type || null, generation_sha256: null, status: 'evidence_missing', reason_code: 'artifact_missing' };
    }
    return {
      criterion_id: criterion.criterion_id,
      artifact_path: safe,
      artifact_type: declared.type || null,
      generation_sha256: sha256Bytes(fs.readFileSync(resolved.real)),
      status: 'snapshotted',
      reason_code: null
    };
  });
  return {
    schema: 'RunEvidenceReceipt/1.0',
    source_type: 'generation_receipt',
    run_id: options.runId,
    run_state_path: runStatePath,
    produced_at: options.producedAt || new Date().toISOString(),
    producer,
    criteria
  };
}

function verifyRunEvidence(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const receipt = options.receipt;
  if (!receipt || typeof receipt !== 'object') throw new Error('receipt is required');
  if (!options.runId) throw new Error('explicit run_id is required');
  const verifier = assertProvenance(options.verifier, 'verifier');
  const producer = assertProvenance(receipt.producer, 'receipt producer');
  const runMatches = receipt.run_id === options.runId;
  const sourceVerified = receipt.schema === 'RunEvidenceReceipt/1.0' && receipt.source_type === 'generation_receipt';
  const criteria = uniqueCriteria(receipt.criteria).map((criterion) => {
    const base = {
      criterion_id: criterion.criterion_id,
      artifact_path: criterion.artifact_path || null,
      expected_sha256: HASH_REF.test(String(criterion.generation_sha256 || '')) ? criterion.generation_sha256 : null,
      current_sha256: null,
      status: 'evidence_missing',
      reason_code: null
    };
    if (!runMatches) return { ...base, reason_code: 'run_id_mismatch' };
    if (!sourceVerified) return { ...base, status: 'unverified_source_claim', reason_code: 'caller_only_hash_claim' };
    if (criterion.status !== 'snapshotted' || !base.artifact_path || !base.expected_sha256) {
      return { ...base, reason_code: criterion.reason_code || 'receipt_evidence_missing' };
    }
    let resolved;
    try { resolved = resolveContainedFile(projectRoot, base.artifact_path); }
    catch (_) { return { ...base, reason_code: 'path_boundary_violation' }; }
    if (!resolved.exists) return { ...base, reason_code: 'artifact_missing' };
    const current = sha256Bytes(fs.readFileSync(resolved.real));
    if (current !== base.expected_sha256) return { ...base, current_sha256: current, reason_code: 'stale_hash' };
    return { ...base, current_sha256: current, status: 'current_hash_verified', reason_code: null };
  });
  const independent = producer.actor_id !== verifier.actor_id || producer.harness_id !== verifier.harness_id;
  const summary = {
    criteria_total: criteria.length,
    criteria_verified: criteria.filter((item) => item.status === 'current_hash_verified').length,
    criteria_missing: criteria.filter((item) => item.status === 'evidence_missing').length,
    criteria_unverified: criteria.filter((item) => item.status === 'unverified_source_claim').length
  };
  return {
    schema: 'RunEvidenceIndex/1.0',
    run_id: options.runId,
    receipt_sha256: sha256Bytes(stableJson(receipt)),
    verified_at: options.verifiedAt || new Date().toISOString(),
    producer,
    verifier,
    independent_verified: independent && runMatches && sourceVerified,
    criteria,
    summary,
    authority: 'report_only'
  };
}

module.exports = {
  sha256Bytes,
  stableJson,
  assertRelativePath,
  resolveContainedFile,
  snapshotRunEvidence,
  verifyRunEvidence
};
