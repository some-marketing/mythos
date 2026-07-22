'use strict';

const fs = require('fs');
const path = require('path');
const scorecard = require('./scorecard');
const { checkIndependence } = require('../verify/lib/validation-independence.cjs');
const { isDistinctIntelligence } = require('../planning/lib/provenance-utils');

/**
 * Relative path from project root to promotion decision artifacts.
 * @type {string}
 */
const DECISION_DIR = path.join('_dev', 'reports', 'analysis', 'actor-promotion-decisions');

/**
 * Controller version. Increment when decision logic changes.
 * @type {string}
 */
const CONTROLLER_VERSION = '3.0.0';

/**
 * Capabilities allowed per tier.
 * Higher tiers inherit all lower-tier capabilities.
 * @type {Object<string, string[]>}
 */
const TIER_CAPABILITIES = Object.freeze({
  restricted: Object.freeze([]),
  candidate: Object.freeze(['read_only']),
  probationary: Object.freeze(['read_only', 'review', 'triage']),
  trusted_low_risk: Object.freeze(['read_only', 'review', 'triage', 'patch_allowed', 'code-edit']),
  trusted_patch: Object.freeze(['read_only', 'review', 'triage', 'patch_allowed', 'code-edit', 'full-auto']),
  trusted_complex: Object.freeze(['read_only', 'review', 'triage', 'patch_allowed', 'code-edit', 'full-auto', 'deep-review', 'planning'])
});

/**
 * Load the trust-tier-policy.json. Returns the parsed policy or null on error.
 * @returns {object|null}
 */
function loadTrustTierPolicy() {
  try {
    const policyPath = path.join(__dirname, 'trust-tier-policy.json');
    return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Map promotion tier to governance trust tier using trust-tier-policy.json.
 * @param {string} promotionTier - One of the promotion tiers (candidate, probationary, etc.)
 * @returns {string|null} Governance trust tier or null if not found
 */
function mapToGovernanceTier(promotionTier) {
  var policy = loadTrustTierPolicy();
  if (!policy || !policy.promotion_tiers || !policy.promotion_tiers[promotionTier]) return null;
  return policy.promotion_tiers[promotionTier].governance_trust_tier || null;
}

/**
 * Check validation independence requirements for a promotion tier.
 * Uses the governance trust tier mapping and the validation-independence checker.
 *
 * @param {string} promotionTier - The tier being promoted TO
 * @param {object} validationRecord - A validation-independence record
 * @returns {{ required: boolean, result: object|null }}
 */
function checkTierValidationIndependence(promotionTier, validationRecord) {
  var governanceTier = mapToGovernanceTier(promotionTier);
  if (!governanceTier) return { required: false, result: null };

  var record = Object.assign({}, validationRecord, { trust_tier: governanceTier });
  var result = checkIndependence(record);
  return { required: result.independence_required, result: result };
}

/**
 * Emit a trace event for a promotion decision.
 * Writes to _dev/logs/promotion-trace.jsonl (append-only).
 *
 * @param {string} projectRoot
 * @param {object} decision - The PromotionDecision object
 */
function emitPromotionTrace(projectRoot, decision) {
  var traceEvent = {
    event_id: 'promotion-' + decision.actor_id + '-' + decision.decided_at.replace(/[:.]/g, '-'),
    timestamp: decision.decided_at,
    event_type: 'task_outcome',
    source_surface: 'reports/analysis',
    actor: decision.actor_id,
    scope: 'actor-promotion',
    payload: {
      action: decision.decision,
      task_id: 'actor-promotion-' + decision.actor_id,
      description: decision.reason_summary,
      outcome_class: decision.decision === 'promote' ? 'pass'
        : decision.decision === 'hold' ? 'partial'
        : 'fail',
      artifacts: [
        path.join(DECISION_DIR, decision.decided_at.replace(/[:.]/g, '-') + '__' + decision.actor_id + '.json')
      ]
    }
  };

  var logPath = path.join(projectRoot, '_dev', 'logs', 'promotion-trace.jsonl');
  try {
    var dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(traceEvent) + '\n');
  } catch { /* trace is best-effort */ }
}

/**
 * Ensure the decision artifact directory exists.
 * @param {string} projectRoot
 */
function ensureDecisionDir(projectRoot) {
  const dir = path.join(projectRoot, DECISION_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Compute the intersection of two arrays.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
function intersect(a, b) {
  var setB = {};
  for (var i = 0; i < b.length; i++) {
    setB[b[i]] = true;
  }
  var result = [];
  for (var j = 0; j < a.length; j++) {
    if (setB[a[j]]) {
      result.push(a[j]);
    }
  }
  return result;
}

/**
 * Compute granted capabilities.
 * granted = claimed_capabilities ∩ tier_allowed_capabilities ∩ lane_policy
 *
 * @param {string[]} claimed - Actor's claimed capabilities.
 * @param {string} tier - Current tier.
 * @param {object} lanePolicies - Lane policies. Expected shape: { allowed_capabilities: string[] }.
 * @returns {string[]}
 */
function computeGrantedCapabilities(claimed, tier, lanePolicies) {
  var tierAllowed = TIER_CAPABILITIES[tier] || [];
  var laneAllowed = (lanePolicies && Array.isArray(lanePolicies.allowed_capabilities))
    ? lanePolicies.allowed_capabilities
    : tierAllowed; // If no lane policy, default to tier-allowed

  return intersect(intersect(claimed, tierAllowed), laneAllowed);
}

/**
 * Check promotion thresholds for the current tier.
 * Returns an array of threshold check results.
 *
 * @param {string} currentTier
 * @param {object} metrics - From the scorecard.
 * @returns {{ checks: Array<{ threshold: string, required: *, actual: *, met: boolean }>, allMet: boolean }}
 */
function checkPromotionThresholds(currentTier, metrics) {
  var thresholds = scorecard.PROMOTION_THRESHOLDS[currentTier];
  if (!thresholds) {
    return { checks: [], allMet: false };
  }

  var checks = [];

  if (typeof thresholds.meaningful_runs === 'number') {
    var actual = metrics.meaningful_runs || 0;
    checks.push({
      threshold: 'meaningful_runs',
      required: thresholds.meaningful_runs,
      actual: actual,
      met: actual >= thresholds.meaningful_runs
    });
  }

  if (typeof thresholds.max_policy_violations === 'number') {
    var violations = metrics.policy_violations || 0;
    checks.push({
      threshold: 'max_policy_violations',
      required: thresholds.max_policy_violations,
      actual: violations,
      met: violations <= thresholds.max_policy_violations
    });
  }

  if (typeof thresholds.review_agreement_rate === 'number') {
    var rate = metrics.review_agreement_rate || 0;
    checks.push({
      threshold: 'review_agreement_rate',
      required: thresholds.review_agreement_rate,
      actual: rate,
      met: rate >= thresholds.review_agreement_rate
    });
  }

  if (typeof thresholds.operator_acceptance_rate === 'number') {
    var acceptRate = metrics.operator_acceptance_rate || 0;
    checks.push({
      threshold: 'operator_acceptance_rate',
      required: thresholds.operator_acceptance_rate,
      actual: acceptRate,
      met: acceptRate >= thresholds.operator_acceptance_rate
    });
  }

  if (typeof thresholds.max_false_pass_rate === 'number') {
    var fpRate = metrics.false_pass_rate || 0;
    checks.push({
      threshold: 'max_false_pass_rate',
      required: thresholds.max_false_pass_rate,
      actual: fpRate,
      met: fpRate <= thresholds.max_false_pass_rate
    });
  }

  if (typeof thresholds.patch_runs === 'number') {
    var patchRuns = metrics.patch_runs || 0;
    checks.push({
      threshold: 'patch_runs',
      required: thresholds.patch_runs,
      actual: patchRuns,
      met: patchRuns >= thresholds.patch_runs
    });
  }

  if (typeof thresholds.max_false_completion_rate === 'number') {
    var fcRate = metrics.false_completion_rate || 0;
    checks.push({
      threshold: 'max_false_completion_rate',
      required: thresholds.max_false_completion_rate,
      actual: fcRate,
      met: fcRate <= thresholds.max_false_completion_rate
    });
  }

  if (typeof thresholds.complex_runs === 'number') {
    var complexRuns = metrics.complex_runs || 0;
    checks.push({
      threshold: 'complex_runs',
      required: thresholds.complex_runs,
      actual: complexRuns,
      met: complexRuns >= thresholds.complex_runs
    });
  }

  if (thresholds.sane_escalation_behavior === true) {
    var saneCount = metrics.escalation_sane_count || 0;
    var totalCount = metrics.escalation_total_count || 0;
    var sane = totalCount > 0 && saneCount === totalCount;
    checks.push({
      threshold: 'sane_escalation_behavior',
      required: true,
      actual: sane,
      met: sane
    });
  }

  var allMet = checks.length > 0 && checks.every(function (c) { return c.met; });
  return { checks: checks, allMet: allMet };
}

/**
 * Determine what evidence is needed next for promotion.
 *
 * @param {string} currentTier
 * @param {Array<{ threshold: string, required: *, actual: *, met: boolean }>} checks
 * @returns {string[]}
 */
function requiredNextEvidence(currentTier, checks) {
  var needed = [];
  for (var i = 0; i < checks.length; i++) {
    if (!checks[i].met) {
      needed.push(checks[i].threshold + ' (need ' + checks[i].required + ', have ' + checks[i].actual + ')');
    }
  }
  if (needed.length === 0 && scorecard.PROMOTION_THRESHOLDS[currentTier]) {
    needed.push('all thresholds met - awaiting decision commit');
  }
  return needed;
}

/**
 * Build a reason summary for the decision.
 *
 * @param {string} decision
 * @param {string} fromTier
 * @param {string} toTier
 * @param {string[]} demotionTriggers
 * @param {Array<{ threshold: string, met: boolean }>} checks
 * @returns {string}
 */
function buildReasonSummary(decision, fromTier, toTier, demotionTriggers, checks) {
  if (decision === 'restrict') {
    return 'Restricted due to active demotion triggers: ' + demotionTriggers.join(', ');
  }
  if (decision === 'demote') {
    return 'Demoted from ' + fromTier + ' to ' + toTier + ' due to: ' + demotionTriggers.join(', ');
  }
  if (decision === 'promote') {
    return 'All thresholds met for promotion from ' + fromTier + ' to ' + toTier;
  }
  // hold
  var unmet = checks.filter(function (c) { return !c.met; });
  if (unmet.length > 0) {
    return 'Holding at ' + fromTier + '; unmet: ' + unmet.map(function (c) { return c.threshold; }).join(', ');
  }
  if (demotionTriggers.length > 0) {
    return 'Holding at ' + fromTier + '; demotion triggers present: ' + demotionTriggers.join(', ');
  }
  return 'Holding at ' + fromTier + '; no promotion path from current tier';
}

/**
 * Check whether promotion evidence includes valid distinct-intelligence validation.
 *
 * For each promotion-grade evidence entry (meaningful_run, patch_run, or complex_run)
 * that was produced by an intelligence actor, a distinct intelligence must have validated it.
 * "Distinct" means: different actor_id AND different harness_id.
 * Human review is supplemental only -- it does NOT satisfy distinct-intelligence validation
 * for intelligence-produced artifacts.
 *
 * @param {object[]} evidence - The evidence array from the scorecard.
 * @returns {{ valid: boolean, violations: string[] }}
 */
function checkDistinctIntelligenceValidation(evidence) {
  var violations = [];

  for (var i = 0; i < evidence.length; i++) {
    var entry = evidence[i];
    var isPromotionGrade = entry.meaningful_run || entry.patch_run || entry.complex_run;
    var isAIProduced = entry.produced_by_actor_type === 'intelligence';

    if (!isPromotionGrade || !isAIProduced) continue;

    // Must have validation fields
    if (!entry.validated_by_actor_id || !entry.validated_by_actor_type
        || !entry.validated_by_harness_id || !entry.validation_artifact) {
      violations.push(
        'Evidence at index ' + i + ' (recorded_at: ' + (entry.recorded_at || 'unknown')
        + ') is promotion-grade and AI-produced but lacks distinct-intelligence validation fields'
      );
      continue;
    }

    // Validator must be an intelligence actor (human review does not satisfy this requirement)
    if (entry.validated_by_actor_type !== 'intelligence') {
      violations.push(
        'Evidence at index ' + i + ' (recorded_at: ' + (entry.recorded_at || 'unknown')
        + ') was validated by actor_type="' + entry.validated_by_actor_type
        + '" — human review does not satisfy distinct-intelligence validation'
      );
      continue;
    }

    var distinct = isDistinctIntelligence(
      {
        actor_id: entry.produced_by_actor_id,
        actor_type: entry.produced_by_actor_type,
        harness_id: entry.produced_by_harness_id
      },
      {
        actor_id: entry.validated_by_actor_id,
        actor_type: entry.validated_by_actor_type,
        harness_id: entry.validated_by_harness_id
      }
    );

    if (!distinct) {
      violations.push(
        'Evidence at index ' + i + ' (recorded_at: ' + (entry.recorded_at || 'unknown')
        + ') validation is self-sourced — validated_by_actor_id="' + entry.validated_by_actor_id
        + '" harness_id="' + entry.validated_by_harness_id
        + '" vs produced_by_actor_id="' + entry.produced_by_actor_id
        + '" harness_id="' + entry.produced_by_harness_id + '"'
      );
    }
  }

  return { valid: violations.length === 0, violations: violations };
}

/**
 * Persist a promotion decision artifact to disk.
 *
 * @param {string} projectRoot
 * @param {PromotionDecision} decision
 */
function saveDecisionArtifact(projectRoot, decision) {
  ensureDecisionDir(projectRoot);
  var timestamp = decision.decided_at.replace(/[:.]/g, '-');
  var filename = timestamp + '__' + decision.actor_id + '.json';
  var filePath = path.join(projectRoot, DECISION_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(decision, null, 2) + '\n', 'utf8');
}

/**
 * Run the promotion controller for an actor.
 * Evaluates whether the actor should be promoted, demoted, or remain stable.
 *
 * Steps:
 * 1. Loads the scorecard for the actor.
 * 2. Checks current tier and thresholds for the next tier.
 * 3. Checks demotion triggers.
 * 4. Emits a promotion decision artifact.
 * 5. Updates the scorecard with the decision.
 * 6. Returns the decision.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} actorId - Actor identifier.
 * @param {object} inputs
 * @param {object} inputs.actor_scorecard - Pre-loaded scorecard (optional; loaded from disk if absent).
 * @param {object} inputs.actor_registry - From the actor registry (see ../autonomy/lib/actor-registry.cjs).
 * @param {object} inputs.local_first_dispatch_registry - From the local-first dispatch registry data.
 * @param {object} inputs.escalation_policy - Escalation policy configuration.
 * @param {object[]} inputs.review_outcomes - Array of recent review outcomes.
 * @param {object} inputs.lane_policies - Lane policies. Expected: { allowed_capabilities: string[] }.
 * @param {object} inputs.telemetry_summaries - Telemetry data (for evidence logging).
 * @returns {PromotionDecision}
 */
function evaluatePromotion(projectRoot, actorId, inputs) {
  var normalized = String(actorId || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('actorId is required');
  }

  var inp = inputs || {};
  var card = inp.actor_scorecard || scorecard.loadScorecard(projectRoot, normalized);
  var currentTier = card.current_tier || 'candidate';
  var tierIndex = scorecard.TIERS.indexOf(currentTier);

  // Detect demotion triggers
  var demotionTriggers = scorecard.detectDemotionTriggers(card);

  // Check promotion thresholds
  var thresholdResult = checkPromotionThresholds(currentTier, card.metrics || {});

  // Decision logic
  var decision;
  var fromTier = currentTier;
  var toTier = currentTier;
  var decisionState;
  var validationCheck = null;

  if (currentTier === scorecard.RESTRICTED_TIER) {
    // Restricted actors can only be manually restored
    decision = 'hold';
    toTier = scorecard.RESTRICTED_TIER;
    decisionState = 'demotion';
  } else if (demotionTriggers.length > 0) {
    // Demotion triggers present
    var hasSevere = demotionTriggers.indexOf('policy_violation') !== -1
      || demotionTriggers.indexOf('closeout_dishonesty') !== -1;

    if (hasSevere) {
      decision = 'restrict';
      toTier = scorecard.RESTRICTED_TIER;
      decisionState = 'demotion';
    } else if (tierIndex > 0) {
      decision = 'demote';
      toTier = scorecard.TIERS[tierIndex - 1];
      decisionState = 'demotion';
    } else {
      // Already at candidate, cannot demote further without restricting
      decision = 'hold';
      decisionState = 'evidence_gating';
    }
  } else if (tierIndex === scorecard.TIERS.length - 1) {
    // Already at highest tier
    decision = 'hold';
    decisionState = 'committed';
  } else if (thresholdResult.allMet) {
    // Gate: distinct-intelligence validation required before promotion
    validationCheck = checkDistinctIntelligenceValidation(card.evidence || []);
    if (!validationCheck.valid) {
      decision = 'hold';
      toTier = currentTier;
      decisionState = 'evidence_gating';
      // Record the validation failures as promotion blockers
      card.promotion_blockers = (card.promotion_blockers || []).concat(
        validationCheck.violations.map(function (v) { return 'distinct_intelligence_validation:' + v; })
      );
    } else {
      decision = 'promote';
      toTier = scorecard.PROMOTION_THRESHOLDS[currentTier].next_tier;
      decisionState = 'decision_pending';
    }
  } else {
    decision = 'hold';
    decisionState = thresholdResult.checks.length > 0 ? 'evidence_gating' : 'candidate_review';
  }

  // Compute granted capabilities
  var claimed = card.claimed_capabilities || [];
  var lanePolicies = inp.lane_policies || {};
  var granted = computeGrantedCapabilities(claimed, toTier, lanePolicies);

  var now = new Date().toISOString();

  // Extract the most recent distinct-intelligence validation from evidence (for the decision artifact)
  var latestValidation = null;
  var evidenceArr = card.evidence || [];
  for (var vi = evidenceArr.length - 1; vi >= 0; vi--) {
    var ev = evidenceArr[vi];
    if (ev.validated_by_actor_id && ev.validated_by_actor_type === 'intelligence'
        && ev.validated_by_harness_id && ev.validation_artifact) {
      latestValidation = {
        validated_by_actor_id: ev.validated_by_actor_id,
        validated_by_actor_type: ev.validated_by_actor_type,
        validated_by_harness_id: ev.validated_by_harness_id,
        validation_artifact: ev.validation_artifact,
        validated_at: ev.recorded_at
      };
      break;
    }
  }

  // Build reason summary — include distinct-intelligence gate failure if applicable
  var reasonSummary;
  if (decision === 'hold' && validationCheck && !validationCheck.valid) {
    reasonSummary = 'Promotion blocked: distinct-intelligence validation required but not satisfied. '
      + validationCheck.violations.length + ' violation(s): '
      + validationCheck.violations[0]
      + (validationCheck.violations.length > 1 ? ' (and ' + (validationCheck.violations.length - 1) + ' more)' : '');
  } else {
    reasonSummary = buildReasonSummary(decision, fromTier, toTier, demotionTriggers, thresholdResult.checks);
  }

  var promotionDecision = {
    actor_id: normalized,
    decided_at: now,
    controller_version: CONTROLLER_VERSION,
    from_tier: fromTier,
    to_tier: toTier,
    decision: decision,
    reason_summary: reasonSummary,
    threshold_checks: thresholdResult.checks,
    granted_capabilities: granted,
    required_next_evidence: requiredNextEvidence(currentTier, thresholdResult.checks),
    demotion_triggers_active: demotionTriggers,
    evidence_refs: card.evidence_refs || [],
    operator_override: null,
    // Distinct-intelligence validation fields (contract requirement)
    validated_by_actor_id: latestValidation ? latestValidation.validated_by_actor_id : null,
    validated_by_actor_type: latestValidation ? latestValidation.validated_by_actor_type : null,
    validated_by_harness_id: latestValidation ? latestValidation.validated_by_harness_id : null,
    validation_artifact: latestValidation ? latestValidation.validation_artifact : null,
    validated_at: latestValidation ? latestValidation.validated_at : null,
    controller_inputs: {
      actor_registry_present: Boolean(inp.actor_registry),
      local_first_dispatch_registry_present: Boolean(inp.local_first_dispatch_registry),
      escalation_policy_present: Boolean(inp.escalation_policy),
      review_outcomes_count: Array.isArray(inp.review_outcomes) ? inp.review_outcomes.length : 0,
      lane_policies_present: Boolean(inp.lane_policies),
      telemetry_summaries_present: Boolean(inp.telemetry_summaries)
    },
    controller_outputs: {
      metrics_snapshot: Object.assign({}, card.metrics),
      tier_before: fromTier,
      tier_after: toTier,
      promotion_blockers: card.promotion_blockers || []
    },
    evidence_log: (card.evidence || []).slice(-5),
    decision_state: decisionState
  };

  // Record policy version in the decision
  var policy = loadTrustTierPolicy();
  if (policy) {
    promotionDecision.policy_version = policy.version;
    promotionDecision.governance_trust_tier = mapToGovernanceTier(toTier);
  }

  // Persist decision artifact
  saveDecisionArtifact(projectRoot, promotionDecision);

  // Emit trace event for observability (P4 integration)
  emitPromotionTrace(projectRoot, promotionDecision);

  // Update the scorecard with the decision outcome
  if (decision === 'promote') {
    card.current_tier = toTier;
    card.promotion_status = 'stable';
    card.last_promotion_at = now;
    card.granted_capabilities = granted;
    card.promotion_blockers = [];
  } else if (decision === 'demote' || decision === 'restrict') {
    card.current_tier = toTier;
    card.promotion_status = 'under_review';
    card.last_demotion_at = now;
    card.granted_capabilities = granted;
    card.promotion_blockers = demotionTriggers.map(function (t) { return 'demotion_trigger:' + t; });
  } else {
    // hold
    card.promotion_status = demotionTriggers.length > 0 ? 'demotion_pending' : 'stable';
    card.granted_capabilities = granted;
  }

  scorecard.saveScorecard(projectRoot, card);

  return promotionDecision;
}

module.exports = {
  DECISION_DIR,
  CONTROLLER_VERSION,
  TIER_CAPABILITIES,
  evaluatePromotion,
  checkPromotionThresholds,
  computeGrantedCapabilities,
  checkDistinctIntelligenceValidation,
  loadTrustTierPolicy,
  mapToGovernanceTier,
  checkTierValidationIndependence,
  emitPromotionTrace
};

/**
 * @typedef {object} PromotionDecision
 * @property {string} actor_id
 * @property {string} decided_at
 * @property {string} controller_version
 * @property {string} from_tier
 * @property {string} to_tier
 * @property {string} decision - 'promote' | 'demote' | 'hold' | 'restrict'
 * @property {string} reason_summary
 * @property {object[]} threshold_checks - Array of { threshold, required, actual, met: boolean }
 * @property {string[]} granted_capabilities
 * @property {string[]} required_next_evidence
 * @property {string[]} demotion_triggers_active
 * @property {string[]} evidence_refs
 * @property {string|null} operator_override
 * @property {string|null} validated_by_actor_id - Actor that provided distinct-intelligence validation
 * @property {string|null} validated_by_actor_type - Type of the validating actor ('intelligence')
 * @property {string|null} validated_by_harness_id - Harness that ran the validating actor
 * @property {string|null} validation_artifact - Reference to the validation artifact
 * @property {string|null} validated_at - ISO timestamp of the validation
 * @property {object} controller_inputs
 * @property {object} controller_outputs
 * @property {object[]} evidence_log
 * @property {string} decision_state - 'candidate_review' | 'evidence_gating' | 'decision_pending' | 'committed' | 'demotion'
 */
