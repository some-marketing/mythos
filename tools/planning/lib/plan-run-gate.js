'use strict';

const { sha256Bytes, stableJson } = require('../../verify/lib/run-evidence-index.cjs');

const DECISION_SCHEMA = 'PlanRunGateDecision/1.0';
const HASH_REF = /^sha256:[a-f0-9]{64}$/;
const APPROVE = new Set(['approve', 'approved', 'pass', 'passed', 'accept', 'accepted', 'lgtm', 'ok']);
const REJECT = new Set(['reject', 'rejected', 'fail', 'failed', 'block', 'blocked']);

function hashPlanPair(jsonBytes, markdownBytes) {
  if (!(typeof jsonBytes === 'string' || Buffer.isBuffer(jsonBytes))) throw new Error('json_bytes are required');
  if (!(typeof markdownBytes === 'string' || Buffer.isBuffer(markdownBytes))) throw new Error('markdown_bytes are required');
  const json_sha256 = sha256Bytes(jsonBytes);
  const markdown_sha256 = sha256Bytes(markdownBytes);
  return {
    json_sha256,
    markdown_sha256,
    plan_pair_sha256: sha256Bytes(stableJson({ json_sha256, markdown_sha256 }))
  };
}

function verdictKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (APPROVE.has(normalized)) return 'approve';
  if (REJECT.has(normalized)) return 'reject';
  return 'unknown';
}

function check(id, ok, reasonCode, bypassed = false) {
  return { id, status: bypassed ? 'BYPASSED' : (ok ? 'PASS' : 'FAIL'), reason_code: ok || bypassed ? null : reasonCode };
}

function latestBoundReview(reviews, planPairSha256, artifactHashes) {
  const candidates = (Array.isArray(reviews) ? reviews : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.plan_pair_sha256 !== planPairSha256) return false;
    if (!HASH_REF.test(String(entry.artifact_sha256 || ''))) return false;
    if (!entry.artifact || artifactHashes[entry.artifact] !== entry.artifact_sha256) return false;
    if (!entry.model || !entry.reviewer_family || !entry.producer_family) return false;
    if (String(entry.reviewer_family).toLowerCase() === String(entry.producer_family).toLowerCase()) return false;
    return verdictKind(entry.verdict) !== 'unknown' && Number.isFinite(Date.parse(String(entry.at || '')));
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function evaluatePlanRunGate(input = {}) {
  const taskId = String(input.task_id || '').trim();
  const evaluatedAt = String(input.evaluated_at || '').trim();
  let digests = { json_sha256: null, markdown_sha256: null, plan_pair_sha256: null };
  const checks = [];

  try {
    digests = hashPlanPair(input.json_bytes, input.markdown_bytes);
    checks.push(check('plan.bytes', true));
  } catch (_) {
    checks.push(check('plan.bytes', false, 'plan_pair_missing'));
  }

  checks.push(check('plan.task_id', Boolean(taskId), 'task_id_missing'));
  checks.push(check('decision.evaluated_at', Boolean(evaluatedAt && Number.isFinite(Date.parse(evaluatedAt))), 'evaluation_time_missing'));
  checks.push(check('plan.pairing', input.pairing_status === 'aligned', input.pairing_status === 'warning' ? 'plan_pair_divergent' : 'plan_pair_unknown'));
  checks.push(check('marker.shape', input.marker_valid === true, input.marker_present === false ? 'marker_missing' : 'marker_malformed'));
  const marker = input.marker && typeof input.marker === 'object' && !Array.isArray(input.marker) ? input.marker : null;
  checks.push(check('marker.identity', Boolean(marker && marker.plan_id === taskId), 'marker_plan_mismatch'));

  const repairPending = Boolean(marker && marker.last_event === 'post_repair' && marker.post_repair && marker.post_repair.review_status === 'pending');
  const repairRejected = Boolean(marker && (marker.last_event === 'post_review_rejected' || (marker.post_repair && marker.post_repair.review_status === 'rejected')));
  checks.push(check('repair.pending', !repairPending, 'repair_pending_review'));
  checks.push(check('repair.rejected', !repairRejected, 'repair_review_rejected'));

  const override = input.operator_override_present === true;
  const artifactHashes = input.review_artifact_hashes && typeof input.review_artifact_hashes === 'object' ? input.review_artifact_hashes : {};
  const review = digests.plan_pair_sha256 ? latestBoundReview(marker && marker.distinct_reviews, digests.plan_pair_sha256, artifactHashes) : null;
  if (override) {
    checks.push(check('review.distinct', true, null, true));
  } else {
    const reviewKind = verdictKind(review && review.verdict);
    checks.push(check('review.distinct', reviewKind === 'approve', reviewKind === 'reject' ? 'distinct_review_rejected' : (input.legacy_review_present ? 'unbound_legacy_review' : 'distinct_review_missing')));
  }

  const requiresConvene = input.requires_convene === true;
  const convenePresent = input.convene_present === true;
  if (!requiresConvene || override) checks.push(check('review.convene', true, null, override && requiresConvene));
  else checks.push(check('review.convene', convenePresent, 'convene_review_missing'));

  const perimeterKnown = typeof input.operator_stamp_required === 'boolean';
  checks.push(check('perimeter.known', perimeterKnown, 'perimeter_unknown'));
  const stampRequired = input.operator_stamp_required === true;
  const stampResult = String(input.operator_stamp_verification || '');
  checks.push(check('operator.stamp', !stampRequired || stampResult === 'verified', stampResult === 'unverified' ? 'operator_stamp_unverified' : 'operator_stamp_missing'));

  const reasonCodes = checks.filter((item) => item.status === 'FAIL').map((item) => item.reason_code);
  return {
    schema: DECISION_SCHEMA,
    task_id: taskId,
    status: reasonCodes.length === 0 ? 'ready' : 'blocked',
    evaluated_at: evaluatedAt,
    ...digests,
    marker_sha256: marker ? sha256Bytes(stableJson(marker)) : null,
    reason_codes: reasonCodes,
    checks,
    authority: 'run_authorization_only'
  };
}

module.exports = {
  DECISION_SCHEMA,
  evaluatePlanRunGate,
  hashPlanPair,
  latestBoundReview,
  verdictKind
};
