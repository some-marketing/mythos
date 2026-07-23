'use strict';

/**
 * progression-result.js — Bridge progression result contract for Mythos.
 *
 * Defines the structured result shape that the Codex bridge returns after
 * reviewing a bounded slice. This tells Claude:
 *   - whether the slice is complete enough to progress
 *   - what the exact next bounded command or implementation step should be
 *   - whether progression can happen automatically or needs an operator gate
 *
 * This is an output contract. It does NOT evaluate whether progression is
 * safe — that judgment belongs to the bridge reviewer. It answers:
 *   "What shape must a progression recommendation have?"
 *
 * The governance rules for when auto_once is allowed are documented in:
 *   _dev/reports/analysis/codex-bridge-progression-governance-plan.md
 * Those rules are policy decisions the bridge evaluates — this module
 * only enforces the structural contract.
 *
 * Aligned with:
 *   - _dev/reports/analysis/codex-bridge-progression-governance-plan.md
 *   - _dev/reports/analysis/ai-layer-self-coding-plan.md
 *   - tools/signals/lib/codex-bridge.js (consumer)
 *   - tools/verify/lib/review-packet.cjs (sibling contract pattern)
 */

// ---------------------------------------------------------------------------
// Valid enums
// ---------------------------------------------------------------------------

const VALID_REVIEW_VERDICTS = ['confirmed', 'confirmed_with_caveats', 'needs_correction'];

const VALID_PROGRESSION_MODES = ['advisory', 'auto_once', 'operator_gate'];

const VALID_NEXT_STEP_KINDS = ['command', 'implementation_slice'];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ProgressionResult object.
 *
 * @param {object} fields
 * @param {string} fields.review_verdict           - One of VALID_REVIEW_VERDICTS
 * @param {string} fields.next_recommended_command  - Exact command or implementation step description
 * @param {string} fields.next_step_kind            - One of VALID_NEXT_STEP_KINDS
 * @param {string} fields.progression_mode          - One of VALID_PROGRESSION_MODES
 * @param {string} fields.progression_reason        - Why the next move is safe or not safe
 * @param {string} [fields.next_prompt_stub]        - Optional bounded prompt stub
 * @param {string} [fields.stop_reason]             - Required when progression_mode is not 'auto_once'
 * @param {string[]} [fields.evidence_refs]         - Artifact paths supporting the recommendation
 * @param {string[]} [fields.decision_context_artifacts] - Governance/lesson artifacts used for the decision
 * @returns {object} Validated ProgressionResult
 */
function createProgressionResult(fields) {
  const {
    review_verdict, next_recommended_command, next_step_kind,
    progression_mode, progression_reason, next_prompt_stub,
    stop_reason, evidence_refs, decision_context_artifacts
  } = fields || {};

  // --- Required field validation ---

  if (!review_verdict || !VALID_REVIEW_VERDICTS.includes(review_verdict)) {
    throw new Error(
      `ProgressionResult requires review_verdict: ${VALID_REVIEW_VERDICTS.join(', ')}. Got: "${review_verdict}"`
    );
  }

  if (!next_recommended_command || typeof next_recommended_command !== 'string') {
    throw new Error('ProgressionResult requires a non-empty next_recommended_command string');
  }

  if (!next_step_kind || !VALID_NEXT_STEP_KINDS.includes(next_step_kind)) {
    throw new Error(
      `ProgressionResult requires next_step_kind: ${VALID_NEXT_STEP_KINDS.join(', ')}. Got: "${next_step_kind}"`
    );
  }

  if (!progression_mode || !VALID_PROGRESSION_MODES.includes(progression_mode)) {
    throw new Error(
      `ProgressionResult requires progression_mode: ${VALID_PROGRESSION_MODES.join(', ')}. Got: "${progression_mode}"`
    );
  }

  if (!progression_reason || typeof progression_reason !== 'string') {
    throw new Error('ProgressionResult requires a non-empty progression_reason string');
  }

  // --- Conditional validation ---

  if (progression_mode !== 'auto_once') {
    if (!stop_reason || typeof stop_reason !== 'string') {
      throw new Error(
        `ProgressionResult with progression_mode "${progression_mode}" requires a non-empty stop_reason`
      );
    }
  }

  if (review_verdict === 'needs_correction' && progression_mode === 'auto_once') {
    throw new Error(
      'ProgressionResult with review_verdict "needs_correction" cannot use progression_mode "auto_once"'
    );
  }

  // --- Build result ---

  return {
    schema: 'ProgressionResult/1.0',
    review_verdict,
    next_recommended_command,
    next_step_kind,
    progression_mode,
    progression_reason,
    next_prompt_stub: typeof next_prompt_stub === 'string' ? next_prompt_stub : '',
    stop_reason: typeof stop_reason === 'string' ? stop_reason : '',
    evidence_refs: Array.isArray(evidence_refs) ? evidence_refs : [],
    decision_context_artifacts: Array.isArray(decision_context_artifacts) ? decision_context_artifacts : [],
    timestamp: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a ProgressionResult object.
 *
 * Returns { valid: boolean, errors: string[] }. Does not throw.
 *
 * @param {object} result - Object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateProgressionResult(result) {
  const errors = [];

  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['ProgressionResult must be an object'] };
  }

  if (result.schema !== 'ProgressionResult/1.0') {
    errors.push('schema must be "ProgressionResult/1.0"');
  }

  if (!result.review_verdict || !VALID_REVIEW_VERDICTS.includes(result.review_verdict)) {
    errors.push(`review_verdict must be one of: ${VALID_REVIEW_VERDICTS.join(', ')}`);
  }

  if (!result.next_recommended_command || typeof result.next_recommended_command !== 'string') {
    errors.push('next_recommended_command must be a non-empty string');
  }

  if (!result.next_step_kind || !VALID_NEXT_STEP_KINDS.includes(result.next_step_kind)) {
    errors.push(`next_step_kind must be one of: ${VALID_NEXT_STEP_KINDS.join(', ')}`);
  }

  if (!result.progression_mode || !VALID_PROGRESSION_MODES.includes(result.progression_mode)) {
    errors.push(`progression_mode must be one of: ${VALID_PROGRESSION_MODES.join(', ')}`);
  }

  if (!result.progression_reason || typeof result.progression_reason !== 'string') {
    errors.push('progression_reason must be a non-empty string');
  }

  // Conditional: stop_reason required when not auto_once
  if (VALID_PROGRESSION_MODES.includes(result.progression_mode) && result.progression_mode !== 'auto_once') {
    if (!result.stop_reason || typeof result.stop_reason !== 'string') {
      errors.push(`progression_mode "${result.progression_mode}" requires a non-empty stop_reason`);
    }
  }

  // Conditional: needs_correction cannot be auto_once
  if (result.review_verdict === 'needs_correction' && result.progression_mode === 'auto_once') {
    errors.push('review_verdict "needs_correction" cannot use progression_mode "auto_once"');
  }

  if (!Array.isArray(result.evidence_refs)) {
    errors.push('evidence_refs must be an array');
  }

  if (!Array.isArray(result.decision_context_artifacts)) {
    errors.push('decision_context_artifacts must be an array');
  }

  if (!result.timestamp || typeof result.timestamp !== 'string') {
    errors.push('timestamp must be a non-empty ISO string');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  VALID_REVIEW_VERDICTS,
  VALID_PROGRESSION_MODES,
  VALID_NEXT_STEP_KINDS,
  createProgressionResult,
  validateProgressionResult
};
