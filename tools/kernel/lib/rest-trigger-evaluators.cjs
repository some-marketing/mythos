'use strict';

const { checkWriteTarget } = require('./scope-expansion-detector.cjs');

const REST_TRIGGER_THRESHOLDS = {
  context_budget_pct: 70,
  consecutive_review_failures: 3,
  ambiguity_load: 2,
  contradiction_density: 2
};

function evaluateContextBudget(pctUsed, thresholds) {
  const threshold = Number(
    (thresholds && thresholds.context_budget_pct) ||
      REST_TRIGGER_THRESHOLDS.context_budget_pct
  );
  const pct = Number(pctUsed);
  const triggered = Number.isFinite(pct) && pct >= threshold;
  return {
    triggered,
    trigger_id: 'context-budget',
    threshold,
    evidence: { pct_used: pct }
  };
}

function normalizeScopeKey(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  return String(
    value.scope_key ||
      value.scopeKey ||
      value.scope ||
      value.task_id ||
      value.taskId ||
      value.workstream_scope ||
      value.workstreamScope ||
      (value.scope_identity && (value.scope_identity.slug || value.scope_identity.task_id)) ||
      ''
  );
}

function isFailureVerdict(value) {
  const normalized = String(value || '').toUpperCase();
  return (
    normalized === 'NEEDS-ADJUSTMENT' ||
    normalized === 'BLOCK' ||
    normalized === 'REJECTED'
  );
}

function isInternalPhaseCascade(item) {
  if (!item || typeof item !== 'object') return false;
  const candidates = [
    item.failure_class,
    item.failureClass,
    item.phase,
    item.review_phase,
    item.reviewPhase,
    item.classification
  ].map((value) => String(value || '').toLowerCase());
  return candidates.some((value) =>
    value === 'internal-phase-cascade' ||
    value === 'internal_phase_cascade' ||
    value === 'internal-review-cascade' ||
    value === 'internal_review_cascade' ||
    value === 'internal-review' ||
    value === 'internal_review'
  );
}

function evaluateConsecutiveReviewFailures(reviewHistory, thresholds, opts) {
  const threshold = Number(
    (thresholds && thresholds.consecutive_review_failures) ||
      REST_TRIGGER_THRESHOLDS.consecutive_review_failures
  );
  const options = opts || {};
  const requiredScopeKey = normalizeScopeKey(
    options.scope_key || options.scopeKey || options.scope || options.task_id || options.taskId
  );
  const history = Array.isArray(reviewHistory) ? reviewHistory : [];
  let trailingFailures = 0;
  let skippedMismatchedScope = 0;
  let skippedInternalPhaseCascade = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const itemScopeKey = normalizeScopeKey(item);
    if (requiredScopeKey && itemScopeKey && itemScopeKey !== requiredScopeKey) {
      skippedMismatchedScope += 1;
      continue;
    }
    if (isInternalPhaseCascade(item)) {
      skippedInternalPhaseCascade += 1;
      continue;
    }
    const verdict = typeof item === 'string'
      ? item
      : (item && (item.verdict || item.status || item.decision)) || '';
    if (isFailureVerdict(verdict)) {
      trailingFailures += 1;
      continue;
    }
    break;
  }
  return {
    triggered: trailingFailures >= threshold,
    trigger_id: 'consecutive-review-failures',
    threshold,
    evidence: {
      trailing_failures: trailingFailures,
      scope_key: requiredScopeKey || null,
      skipped_mismatched_scope: skippedMismatchedScope,
      skipped_internal_phase_cascade: skippedInternalPhaseCascade
    }
  };
}

function evaluateAmbiguityLoad(nextActions, thresholds) {
  const threshold = Number(
    (thresholds && thresholds.ambiguity_load) ||
      REST_TRIGGER_THRESHOLDS.ambiguity_load
  );
  const actions = Array.isArray(nextActions) ? nextActions : [];
  return {
    triggered: actions.length >= threshold,
    trigger_id: 'ambiguity-load',
    threshold,
    evidence: { candidate_actions: actions.length }
  };
}

function evaluateScopeExpansionAttempted(actorId, intendedPath, opts) {
  const result = checkWriteTarget(actorId, intendedPath, opts);
  const triggered = !!(result.current_arc && !result.allowed);
  return {
    triggered,
    trigger_id: 'scope-expansion-attempted',
    threshold: 1,
    advisory_outcome: 'checkpoint_and_request_authorization',
    evidence: {
      actor_id: actorId,
      intended_path: intendedPath,
      reason: result.reason,
      violation: result.violation || null,
      recommended_outcome: 'checkpoint_and_request_authorization'
    }
  };
}

function evaluateContradictionDensity(siblingArtifacts, thresholds) {
  const threshold = Number(
    (thresholds && thresholds.contradiction_density) ||
      REST_TRIGGER_THRESHOLDS.contradiction_density
  );
  const artifacts = Array.isArray(siblingArtifacts) ? siblingArtifacts : [];
  const contradictionCount = artifacts.filter((item) => {
    if (typeof item === 'string') return true;
    return !!(item && item.contradiction);
  }).length;
  return {
    triggered: contradictionCount >= threshold,
    trigger_id: 'contradiction-density',
    threshold,
    evidence: { contradiction_count: contradictionCount }
  };
}

module.exports = {
  REST_TRIGGER_THRESHOLDS,
  evaluateContextBudget,
  evaluateConsecutiveReviewFailures,
  evaluateAmbiguityLoad,
  evaluateScopeExpansionAttempted,
  evaluateContradictionDensity
};
