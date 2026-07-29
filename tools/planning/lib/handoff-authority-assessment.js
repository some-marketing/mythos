'use strict';

const IDENTITY_FIELDS = Object.freeze([
  'workstream_scope',
  'branch',
  'head_commit',
  'plan_sha256',
  'review_sha256',
  'signal_id',
  'signal_content_sha256',
  'content_sha256'
]);

function text(value) {
  return String(value || '').trim();
}

function projectEvidence(value = {}) {
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, text(value[field])]));
}

function assessHandoffAuthority(input = {}) {
  const handoff = projectEvidence(input.handoff);
  const current = projectEvidence(input.current);
  const comparisons = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, Boolean(handoff[field]) && handoff[field] === current[field]]));
  const missing = IDENTITY_FIELDS.filter((field) => !handoff[field] || !current[field]);
  const reasons = [];
  let state = 'consistent';

  if (missing.length > 0) {
    state = 'review_required';
    reasons.push(...missing.map((field) => `missing_identity:${field}`));
  } else if (!comparisons.workstream_scope) {
    state = 'cross_scope';
    reasons.push('workstream_scope_mismatch');
  } else if (input.current && input.current.authority_conflict === true) {
    state = 'conflict';
    reasons.push('current_authority_conflict');
  } else if (input.semantic_contradiction === true) {
    state = 'review_required';
    reasons.push('semantic_contradiction');
  } else if (input.current && input.current.signal_superseded === true) {
    state = 'stale';
    reasons.push('signal_superseded');
  } else {
    const staleFields = IDENTITY_FIELDS.filter((field) => field !== 'workstream_scope' && !comparisons[field]);
    if (staleFields.length > 0) {
      state = 'stale';
      reasons.push(...staleFields.map((field) => `${field}_mismatch`));
    }
  }

  const workstreamScope = current.workstream_scope || handoff.workstream_scope;
  return {
    schema: 'HandoffAuthorityAssessment/1.0',
    state,
    reason_codes: reasons,
    workstream_scope: workstreamScope,
    original_recommendation: text(input.handoff && input.handoff.recommended_next_command),
    replacement_command: null,
    requires_human_review: state !== 'consistent',
    recovery_route: state === 'consistent' ? null : (workstreamScope ? `/review-progress ${workstreamScope}` : '/review-progress'),
    comparisons,
    evidence: { handoff, current }
  };
}

module.exports = {
  IDENTITY_FIELDS,
  assessHandoffAuthority,
  projectEvidence
};
