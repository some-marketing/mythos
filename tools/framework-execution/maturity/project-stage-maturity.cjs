'use strict';

function projectStageMaturity({ stage_id, evidence = [], lifecycle_drift, previous_level } = {}) {
  if (process.env.STAGE_MATURITY_ADVISORY_V1 === '0') return record(stage_id, 'unverified', [], ['feature_disabled'], 'enable_advisory_projection', 'new verified evidence');
  const verified = (Array.isArray(evidence) ? evidence : []).filter((item) => item && item.verified === true && /^[a-f0-9]{64}$/.test(String(item.sha256 || '')));
  const types = new Set(verified.map((item) => item.type));
  if (!lifecycle_drift || lifecycle_drift.state !== 'healthy') {
    const level = previous_level && previous_level !== 'unverified' ? 'reopened' : 'unverified';
    return record(stage_id, level, verified, ['lifecycle_evidence_not_healthy'], 'obtain_healthy_lifecycle_verdict', 'lifecycle drift, missing evidence, or reviewer correction');
  }
  let level = 'L0';
  let nextGate = 'verified_output_check';
  if (types.has('verifier_pass')) { level = 'L1'; nextGate = 'schema_and_real_instance'; }
  if (types.has('verifier_pass') && types.has('schema_validated') && types.has('real_instance')) { level = 'L2'; nextGate = 'code_primary_with_bounded_model_fallback'; }
  if (types.has('code_primary') && !types.has('model_primary') && level === 'L2') { level = 'L3'; nextGate = 'exception_only_replay_evidence'; }
  if (types.has('exception_only') && types.has('fallback_observed') && level === 'L3') { level = 'L4'; nextGate = 'distinct_review_and_operator_promotion_plan'; }
  return record(stage_id, level, verified, [], nextGate, 'failed replay, lifecycle drift, semantic correction, or changed stage contract');
}

function record(stageId, level, evidence, exceptions, nextGate, reopenCondition) {
  return {
    schema: 'StageMaturity/1.0', stage_id: String(stageId || 'unknown'), projected_level: level,
    evidence_sha256: evidence.map((item) => item.sha256), exceptions, next_gate: nextGate, reopen_condition: reopenCondition,
    authority: 'advisory_only', promotion_eligible: false, promotion_receipt: null, operator_acceptance: 'not_evaluated'
  };
}

module.exports = { projectStageMaturity };
