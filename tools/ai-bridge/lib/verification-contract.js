'use strict';

/**
 * verification-contract.js — Verification output contract for Mythos dispatch.
 *
 * Defines the structured result shape that any verifier (local or cloud)
 * must return when handling a 'verification' workflow dispatch.
 *
 * This is the output contract only. It does NOT execute verification.
 * It answers the question: "What shape must a verifier result have?"
 *
 * The contract enforces the local-verifier escalation policy:
 *   - verdict is one of: pass, fail, uncertain
 *   - needs_escalation is an explicit boolean
 *   - escalation_triggers enumerate why escalation is needed
 *   - findings are structured with severity levels
 *   - confidence is a 0.0–1.0 numeric value
 *
 * Design principle: a verifier result records what was found and whether
 * escalation is needed. It does NOT self-certify completion — that
 * decision belongs to the orchestrator reviewing the result.
 *
 * Aligned with:
 *   - _dev/research/local-model-verification/04_routing_and_escalation_policy.md
 *   - tools/ai-bridge/lib/dispatch-contract.js (companion contract)
 *   - tools/workspace/schemas/verification-result.schema.json (JSON Schema)
 *
 * Adding verifier output from a new provider:
 *   1. The provider dispatcher calls createVerificationResult() with its output
 *   2. validateVerificationResult() checks the result shape
 *   3. The routing artifact records the decision; this contract records the outcome
 */

// ---------------------------------------------------------------------------
// Valid enums
// ---------------------------------------------------------------------------

/**
 * Verifier verdicts.
 *   pass:      bounded review found no issues
 *   fail:      bounded review found issues
 *   uncertain: cannot determine — needs escalation to frontier
 */
const VALID_VERDICTS = ['pass', 'fail', 'uncertain'];

/**
 * Finding severity levels.
 *   error:   issue that should block acceptance
 *   warning: issue worth noting but not blocking
 *   info:    observation, no action needed
 */
const VALID_FINDING_SEVERITIES = ['error', 'warning', 'info'];

/**
 * Escalation trigger reasons — enumerated so they are machine-checkable.
 * Aligned with the mandatory needs_escalation triggers from the
 * routing and escalation policy.
 */
const VALID_ESCALATION_TRIGGERS = [
  'evidence_missing',          // Required evidence was not found
  'evidence_conflicting',      // Evidence is internally contradictory
  'confidence_below_threshold',// Benchmark-calibrated confidence too low
  'context_too_broad',         // Task spans too many files or too much context
  'output_contract_violation', // Verifier could not stay within output contract
  'high_risk_override'         // Case is explicitly marked high-risk
];

// ---------------------------------------------------------------------------
// Finding factory
// ---------------------------------------------------------------------------

/**
 * Create a Finding object.
 *
 * @param {object} fields
 * @param {string} fields.id       - Unique finding identifier
 * @param {string} fields.severity - One of VALID_FINDING_SEVERITIES
 * @param {string} fields.message  - Human-readable finding description
 * @param {string} [fields.evidence] - Supporting evidence text
 * @returns {object} Validated Finding
 */
function createFinding(fields) {
  const { id, severity, message, evidence } = fields || {};

  if (!id) throw new Error('Finding requires an id');
  if (!severity || !VALID_FINDING_SEVERITIES.includes(severity)) {
    throw new Error(
      `Finding requires severity: ${VALID_FINDING_SEVERITIES.join(', ')}. Got: "${severity}"`
    );
  }
  if (!message) throw new Error('Finding requires a message');

  return {
    id,
    severity,
    message,
    evidence: evidence || null
  };
}

// ---------------------------------------------------------------------------
// VerificationResult factory
// ---------------------------------------------------------------------------

/**
 * Create a VerificationResult object.
 *
 * Every verifier result must include verdict, confidence, findings, reason,
 * and needs_escalation. Optional provenance fields are included when provided.
 *
 * @param {object} fields
 * @param {string} fields.verdict            - One of VALID_VERDICTS
 * @param {number} fields.confidence         - 0.0 to 1.0
 * @param {Array}  fields.findings           - Array of Finding objects
 * @param {string} fields.reason             - Human-readable explanation of verdict
 * @param {boolean} fields.needs_escalation  - Whether frontier review is needed
 * @param {string} [fields.model_id]         - Model identifier (e.g. 'qwen2.5:14b')
 * @param {string} [fields.provider]         - Provider name (e.g. 'ollama')
 * @param {number} [fields.runtime_ms]       - Verification runtime in milliseconds
 * @param {string} [fields.benchmark_tag]    - Benchmark cohort tag for calibration
 * @param {string[]} [fields.evidence_refs]  - Paths to input artifacts that were reviewed
 * @param {string[]} [fields.escalation_triggers] - Which escalation triggers fired
 * @returns {object} Validated VerificationResult
 */
function createVerificationResult(fields) {
  const {
    verdict, confidence, findings, reason, needs_escalation,
    model_id, provider, runtime_ms, benchmark_tag,
    evidence_refs, escalation_triggers, actor_id, harness_id
  } = fields || {};

  // --- Required field validation ---

  if (!verdict || !VALID_VERDICTS.includes(verdict)) {
    throw new Error(
      `VerificationResult requires verdict: ${VALID_VERDICTS.join(', ')}. Got: "${verdict}"`
    );
  }

  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error(
      `VerificationResult requires confidence between 0.0 and 1.0. Got: ${confidence}`
    );
  }

  if (!Array.isArray(findings)) {
    throw new Error('VerificationResult requires findings as an array');
  }

  if (!reason || typeof reason !== 'string') {
    throw new Error('VerificationResult requires a non-empty reason string');
  }

  if (typeof needs_escalation !== 'boolean') {
    throw new Error('VerificationResult requires needs_escalation as a boolean');
  }

  // --- Escalation consistency checks ---

  if (verdict === 'uncertain' && !needs_escalation) {
    throw new Error(
      'VerificationResult with verdict "uncertain" must set needs_escalation to true'
    );
  }

  const triggers = Array.isArray(escalation_triggers) ? escalation_triggers : [];
  for (const trigger of triggers) {
    if (!VALID_ESCALATION_TRIGGERS.includes(trigger)) {
      throw new Error(
        `Unknown escalation trigger: "${trigger}". Valid triggers: ${VALID_ESCALATION_TRIGGERS.join(', ')}`
      );
    }
  }

  if (needs_escalation && triggers.length === 0) {
    throw new Error(
      'VerificationResult with needs_escalation=true must include at least one escalation_triggers entry'
    );
  }

  // --- Build result ---

  const result = {
    workflow_type: 'verification',
    verdict,
    confidence,
    findings,
    reason,
    needs_escalation,
    escalation_triggers: triggers,
    timestamp: new Date().toISOString()
  };

  // Optional provenance fields — included only when provided
  result.model_id = model_id || null;
  result.provider = provider || null;
  result.runtime_ms = typeof runtime_ms === 'number' ? runtime_ms : null;
  result.benchmark_tag = benchmark_tag || null;
  result.evidence_refs = Array.isArray(evidence_refs) ? evidence_refs : [];
  result.actor_id = actor_id || null;
  result.harness_id = harness_id || null;

  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a VerificationResult object.
 *
 * Returns an object with { valid: boolean, errors: string[] }.
 * Does not throw — collects all errors for reporting.
 *
 * @param {object} result - Object to validate as a VerificationResult
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateVerificationResult(result) {
  const errors = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['VerificationResult must be an object'] };
  }

  // Required fields
  if (!result.verdict || !VALID_VERDICTS.includes(result.verdict)) {
    errors.push(`verdict must be one of: ${VALID_VERDICTS.join(', ')}`);
  }

  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
    errors.push('confidence must be a number between 0.0 and 1.0');
  }

  if (!Array.isArray(result.findings)) {
    errors.push('findings must be an array');
  } else {
    for (let i = 0; i < result.findings.length; i++) {
      const f = result.findings[i];
      if (!f || typeof f !== 'object') {
        errors.push(`findings[${i}] must be an object`);
        continue;
      }
      if (!f.id) errors.push(`findings[${i}].id is required`);
      if (!f.severity || !VALID_FINDING_SEVERITIES.includes(f.severity)) {
        errors.push(`findings[${i}].severity must be one of: ${VALID_FINDING_SEVERITIES.join(', ')}`);
      }
      if (!f.message) errors.push(`findings[${i}].message is required`);
    }
  }

  if (!result.reason || typeof result.reason !== 'string') {
    errors.push('reason must be a non-empty string');
  }

  if (typeof result.needs_escalation !== 'boolean') {
    errors.push('needs_escalation must be a boolean');
  }

  // Escalation consistency
  if (result.verdict === 'uncertain' && result.needs_escalation !== true) {
    errors.push('verdict "uncertain" requires needs_escalation to be true');
  }

  if (Array.isArray(result.escalation_triggers)) {
    for (const trigger of result.escalation_triggers) {
      if (!VALID_ESCALATION_TRIGGERS.includes(trigger)) {
        errors.push(`unknown escalation_triggers entry: "${trigger}"`);
      }
    }
  }

  if (result.needs_escalation === true) {
    if (!Array.isArray(result.escalation_triggers) || result.escalation_triggers.length === 0) {
      errors.push('needs_escalation=true requires at least one escalation_triggers entry');
    }
  }

  // workflow_type check
  if (result.workflow_type !== 'verification') {
    errors.push('workflow_type must be "verification"');
  }

  // timestamp check
  if (!result.timestamp || typeof result.timestamp !== 'string') {
    errors.push('timestamp must be a non-empty ISO string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  VALID_VERDICTS,
  VALID_FINDING_SEVERITIES,
  VALID_ESCALATION_TRIGGERS,
  createFinding,
  createVerificationResult,
  validateVerificationResult
};
