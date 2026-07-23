'use strict';

/**
 * verification-signal-bridge.js — Bridge from VerificationResult to VerificationSignal.
 *
 * Converts a VerificationResult (from verification-contract.js) and an
 * EscalationDecision (from escalation-policy.js) into a VerificationSignal
 * (from tools/verify/lib/signal.cjs).
 *
 * This is a mechanical mapping. It does NOT execute verification or make
 * routing decisions. It answers the question:
 *   "Given a verifier result and an escalation decision, what does the
 *    corresponding VerificationSignal look like?"
 *
 * The bridge uses the signal.cjs builder pattern (createSignal → addCheck →
 * finalize) so that verdict and gate_decision are computed automatically
 * from the mapped checks.
 *
 * Mapping rules:
 *   - Each Finding becomes a signal check
 *   - Finding severity maps to signal severity:
 *       error   → critical (FAIL)
 *       warning → warning  (WARN)
 *       info    → warning  (PASS)
 *   - A confidence-threshold check is added from the escalation decision
 *   - If escalation is required, an escalation-required critical check is added
 *   - finalize() derives the signal verdict and gate_decision from checks
 *
 * Design principle: local output must not self-certify completion. When
 * escalation is not needed, the gate proceeds but the signal remains a
 * first-pass result — the orchestrator decides whether to accept it.
 *
 * Aligned with:
 *   - tools/ai-bridge/lib/verification-contract.js (input: result shape)
 *   - tools/ai-bridge/lib/escalation-policy.js (input: escalation decision)
 *   - tools/verify/lib/signal.cjs (output: signal builder)
 */

const { createSignal, addCheck, finalize } = require('../../verify/lib/signal.cjs');
const { validateVerificationResult } = require('./verification-contract');
const { validateEscalationDecision } = require('./escalation-policy');

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

/**
 * Map Finding severity to signal check severity and status.
 *
 *   error   → severity: 'critical', status: 'FAIL'
 *   warning → severity: 'warning',  status: 'WARN'
 *   info    → severity: 'warning',  status: 'PASS'
 */
function mapFindingSeverity(findingSeverity) {
  switch (findingSeverity) {
    case 'error':
      return { severity: 'critical', status: 'FAIL' };
    case 'warning':
      return { severity: 'warning', status: 'WARN' };
    case 'info':
    default:
      return { severity: 'warning', status: 'PASS' };
  }
}

// ---------------------------------------------------------------------------
// Bridge function
// ---------------------------------------------------------------------------

/**
 * Convert a VerificationResult and EscalationDecision into a VerificationSignal.
 *
 * @param {object} verificationResult - A VerificationResult from verification-contract.js
 * @param {object} escalationDecision - An EscalationDecision from escalation-policy.js
 * @param {object} [options]
 * @param {string} [options.source] - Signal source (default: 'verification:{provider}')
 * @param {string} [options.scope]  - Signal scope (default: 'verification')
 * @returns {object} A finalized VerificationSignal
 * @throws {Error} If the inputs are invalid
 */
function bridgeToSignal(verificationResult, escalationDecision, options = {}) {
  if (!verificationResult) {
    throw new Error('bridgeToSignal requires a verificationResult');
  }
  if (!escalationDecision) {
    throw new Error('bridgeToSignal requires an escalationDecision');
  }

  const resultValidation = validateVerificationResult(verificationResult);
  if (!resultValidation.valid) {
    throw new Error(
      `Invalid VerificationResult: ${resultValidation.errors.join('; ')}`
    );
  }

  const decisionValidation = validateEscalationDecision(escalationDecision);
  if (!decisionValidation.valid) {
    throw new Error(
      `Invalid EscalationDecision: ${decisionValidation.errors.join('; ')}`
    );
  }

  // Build the signal
  const provider = verificationResult.provider || 'unknown';
  const source = options.source || `verification:${provider}`;
  const scope = options.scope || 'verification';

  const signal = createSignal(source, scope, 'verification');

  // Map each finding to a signal check
  for (const finding of verificationResult.findings) {
    const mapped = mapFindingSeverity(finding.severity);
    addCheck(signal, {
      id: finding.id,
      category: 'verification-finding',
      severity: mapped.severity,
      status: mapped.status,
      message: finding.message,
      ...(finding.evidence ? { evidence: finding.evidence } : {})
    });
  }

  // Add confidence-threshold check from escalation decision
  const confAboveThreshold = verificationResult.confidence >= escalationDecision.confidence_threshold;
  addCheck(signal, {
    id: 'confidence-threshold',
    category: 'escalation-policy',
    severity: confAboveThreshold ? 'warning' : 'critical',
    status: confAboveThreshold ? 'PASS' : 'FAIL',
    message: `Confidence ${verificationResult.confidence.toFixed(2)} vs threshold ${escalationDecision.confidence_threshold.toFixed(2)} (risk: ${escalationDecision.risk_class})`,
    detail: verificationResult.reason
  });

  // Add escalation-required check if escalation is needed
  if (escalationDecision.needs_escalation) {
    addCheck(signal, {
      id: 'escalation-required',
      category: 'escalation-policy',
      severity: 'critical',
      status: 'FAIL',
      message: `Escalation required: ${escalationDecision.escalation_triggers.join(', ')}`,
      detail: escalationDecision.reason
    });
  }

  // Finalize — this computes verdict and gate_decision from checks
  finalize(signal);

  // Attach provenance metadata to the signal for traceability
  signal.verification_provenance = {
    verdict: verificationResult.verdict,
    confidence: verificationResult.confidence,
    needs_escalation: escalationDecision.needs_escalation,
    risk_class: escalationDecision.risk_class,
    model_id: verificationResult.model_id,
    provider: verificationResult.provider,
    runtime_ms: verificationResult.runtime_ms,
    benchmark_tag: verificationResult.benchmark_tag
  };

  return signal;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  bridgeToSignal,
  mapFindingSeverity
};
