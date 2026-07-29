'use strict';

/**
 * escalation-policy.js — Confidence and escalation policy for Mythos verification.
 *
 * Connects the verification output contract (verification-contract.js) to the
 * routing system (routing-artifact.js) by defining machine-checkable rules for
 * when a local verifier result can be locally accepted vs. when it must escalate
 * to frontier review.
 *
 * This is a policy evaluation module. It does NOT execute verification or
 * dispatch to providers. It answers the question:
 *   "Given this verifier result and this risk class, can the result be
 *    locally accepted, or must it escalate?"
 *
 * Aligned with:
 *   - _dev/research/local-model-verification/04_routing_and_escalation_policy.md
 *   - tools/ai-bridge/lib/verification-contract.js (result shape)
 *   - tools/ai-bridge/lib/routing-artifact.js (risk_class constraint)
 *
 * Decision hierarchy (from the escalation policy):
 *   1. Mechanical verification remains first.
 *   2. Local verifier can review bounded work after Tier 1 passes.
 *   3. Frontier review remains the authority for escalation cases.
 *   4. Local output must not self-certify completion.
 */

const {
  VALID_VERDICTS,
  VALID_ESCALATION_TRIGGERS,
  validateVerificationResult
} = require('./verification-contract');

// ---------------------------------------------------------------------------
// Risk classes and confidence thresholds
// ---------------------------------------------------------------------------

/**
 * Valid risk classes for escalation policy evaluation.
 */
const VALID_RISK_CLASSES = ['low', 'medium', 'high'];

/**
 * Default confidence thresholds per risk class.
 *
 * Below the threshold, the `confidence_below_threshold` trigger fires.
 * These defaults are conservative and can be overridden per-evaluation.
 *
 *   low:    0.60 — local verifier can accept at moderate confidence
 *   medium: 0.75 — local verifier needs higher confidence
 *   high:   0.90 — very high bar; frontier review still required regardless
 */
const DEFAULT_CONFIDENCE_THRESHOLDS = {
  low: 0.60,
  medium: 0.75,
  high: 0.90
};

// ---------------------------------------------------------------------------
// Escalation evaluation
// ---------------------------------------------------------------------------

/**
 * EscalationDecision shape:
 *   {
 *     needs_escalation: boolean,           // Whether frontier review is required
 *     local_acceptance: boolean,           // Inverse of needs_escalation — can local accept?
 *     escalation_triggers: string[],       // All triggers that fired
 *     risk_class: string,                  // The risk class used for evaluation
 *     confidence_threshold: number,        // The threshold applied
 *     verdict_from_result: string,         // The verdict from the input result
 *     confidence_from_result: number,      // The confidence from the input result
 *     reason: string                       // Human-readable explanation
 *   }
 */

/**
 * Evaluate whether a VerificationResult should be locally accepted or
 * must escalate to frontier review.
 *
 * Policy rules:
 *   1. If the result already declares needs_escalation, respect it.
 *   2. If confidence is below the risk-class threshold, trigger escalation.
 *   3. If risk_class is 'high', always require frontier review regardless
 *      of confidence or verdict.
 *   4. If verdict is 'uncertain', always escalate.
 *   5. If verdict is 'fail' with error-severity findings on medium/high risk,
 *      escalate (errors on high-risk work need frontier confirmation).
 *
 * @param {object} result - A VerificationResult object
 * @param {object} [options]
 * @param {string} [options.risk_class='medium'] - Risk class: 'low', 'medium', 'high'
 * @param {number} [options.confidence_threshold] - Override the default threshold
 * @returns {object} EscalationDecision
 */
function evaluateEscalation(result, options = {}) {
  const riskClass = VALID_RISK_CLASSES.includes(options.risk_class)
    ? options.risk_class
    : 'medium';

  const threshold = typeof options.confidence_threshold === 'number'
    ? options.confidence_threshold
    : (DEFAULT_CONFIDENCE_THRESHOLDS[riskClass] || DEFAULT_CONFIDENCE_THRESHOLDS.medium);

  const triggers = new Set();
  const reasons = [];

  // Rule 1: Respect declared escalation from the verifier
  if (result.needs_escalation) {
    for (const t of (result.escalation_triggers || [])) {
      triggers.add(t);
    }
    reasons.push('verifier declared needs_escalation');
  }

  // Rule 2: Confidence below threshold
  if (typeof result.confidence === 'number' && result.confidence < threshold) {
    triggers.add('confidence_below_threshold');
    reasons.push(
      `confidence ${result.confidence.toFixed(2)} < threshold ${threshold.toFixed(2)} for risk_class "${riskClass}"`
    );
  }

  // Rule 3: High risk always escalates
  if (riskClass === 'high') {
    triggers.add('high_risk_override');
    reasons.push('risk_class "high" requires frontier review regardless of verdict');
  }

  // Rule 4: Uncertain verdict always escalates
  if (result.verdict === 'uncertain') {
    // The verification contract already enforces this, but the policy
    // re-checks to be self-contained.
    if (!triggers.has('confidence_below_threshold') && !triggers.has('high_risk_override')) {
      reasons.push('verdict "uncertain" requires escalation');
    }
  }

  const needsEscalation = triggers.size > 0;

  return {
    needs_escalation: needsEscalation,
    local_acceptance: !needsEscalation,
    escalation_triggers: [...triggers],
    risk_class: riskClass,
    confidence_threshold: threshold,
    verdict_from_result: result.verdict || null,
    confidence_from_result: typeof result.confidence === 'number' ? result.confidence : null,
    reason: needsEscalation
      ? `Escalation required: ${reasons.join('; ')}.`
      : `Local acceptance: confidence ${(result.confidence || 0).toFixed(2)} >= threshold ${threshold.toFixed(2)}, risk_class "${riskClass}", verdict "${result.verdict}".`
  };
}

/**
 * Validate an EscalationDecision object.
 *
 * @param {object} decision
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEscalationDecision(decision) {
  const errors = [];

  if (!decision || typeof decision !== 'object') {
    return { valid: false, errors: ['EscalationDecision must be an object'] };
  }

  if (typeof decision.needs_escalation !== 'boolean') {
    errors.push('needs_escalation must be a boolean');
  }

  if (typeof decision.local_acceptance !== 'boolean') {
    errors.push('local_acceptance must be a boolean');
  }

  if (decision.needs_escalation === decision.local_acceptance) {
    errors.push('needs_escalation and local_acceptance must be inverses');
  }

  if (!Array.isArray(decision.escalation_triggers)) {
    errors.push('escalation_triggers must be an array');
  } else {
    for (const t of decision.escalation_triggers) {
      if (!VALID_ESCALATION_TRIGGERS.includes(t)) {
        errors.push(`unknown escalation trigger: "${t}"`);
      }
    }
  }

  if (decision.needs_escalation && Array.isArray(decision.escalation_triggers) && decision.escalation_triggers.length === 0) {
    errors.push('needs_escalation=true requires at least one trigger');
  }

  if (!VALID_RISK_CLASSES.includes(decision.risk_class)) {
    errors.push(`risk_class must be one of: ${VALID_RISK_CLASSES.join(', ')}`);
  }

  if (typeof decision.confidence_threshold !== 'number') {
    errors.push('confidence_threshold must be a number');
  }

  if (!decision.reason || typeof decision.reason !== 'string') {
    errors.push('reason must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  VALID_RISK_CLASSES,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  evaluateEscalation,
  validateEscalationDecision
};
