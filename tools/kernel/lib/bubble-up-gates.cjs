#!/usr/bin/env node
'use strict';

/**
 * bubble-up-gates.cjs — the ONE canonical bubble-up gate taxonomy for Mythos.
 *
 * Layer 2 of the ambient-orchestrator autonomy contract (S0).
 * Plan: _dev/reports/analysis/task-plans/ambient-orchestrator-layer-2-runtime-bubble-up-contract__plan.json
 *
 * WHY THIS EXISTS
 *   The bubble-up rule in instructions/canonical/guardrails.md says a question
 *   resolves at the lowest level and rises to the human ONLY when it is one of a
 *   fixed set of true gates. Layer 2 enforces that rule in code. For the
 *   enforcement to be coherent, the signal validator (S1), the worker-return
 *   contract (S2), and the delegation-altitude breaker (S3) must all reference
 *   the SAME gate vocabulary — never divergent copies (enforce-canonical-ids).
 *   This module is that single source.
 *
 * The seven gates are a verbatim transcription of the guardrails bubble-up rule:
 *   "Questions resolve at the lowest possible level. Bubble upward only questions
 *    that require human judgment, explicit approval, budget/scope/timeline
 *    commitment, client-facing risk acceptance, destructive or irreversible
 *    action, credential access, or an unresolved conflict between same-rank
 *    authority surfaces."
 *
 * `none` is the sentinel meaning "no gate — this resolves locally, do not bubble up."
 *
 * Stdlib-only. No side effects on require.
 */

/** Sentinel: this question does NOT bubble up; resolve it at the current level. */
const NO_GATE = 'none';

/**
 * The seven canonical bubble-up gates. Order is stable; ids are the canonical
 * machine identifiers. `summary` is operator-facing; `guardrail_phrase` ties each
 * id back to the exact wording in the canonical bubble-up rule.
 */
const GATES = [
  {
    id: 'human_judgment',
    summary: 'A judgment call only the human operator should make.',
    guardrail_phrase: 'human judgment',
  },
  {
    id: 'explicit_approval',
    summary: 'An action that requires the operator to explicitly approve before proceeding.',
    guardrail_phrase: 'explicit approval',
  },
  {
    id: 'budget_scope_timeline_commitment',
    summary: 'Committing budget, scope, or timeline on the operator\'s behalf.',
    guardrail_phrase: 'budget/scope/timeline commitment',
  },
  {
    id: 'client_facing_risk',
    summary: 'Accepting risk that a client would see or be affected by.',
    guardrail_phrase: 'client-facing risk acceptance',
  },
  {
    id: 'irreversible_destructive',
    summary: 'A destructive or otherwise not-easily-reversible action.',
    guardrail_phrase: 'destructive or irreversible action',
  },
  {
    id: 'credential_access',
    summary: 'Access to credentials, secrets, or protected auth surfaces.',
    guardrail_phrase: 'credential access',
  },
  {
    id: 'same_rank_authority_conflict',
    summary: 'An unresolved conflict between same-rank authority surfaces.',
    guardrail_phrase: 'conflict between same-rank authority surfaces',
  },
];

/** Set of valid gate ids (the seven), for O(1) membership checks. */
const GATE_IDS = GATES.map((g) => g.id);
const GATE_ID_SET = new Set(GATE_IDS);

/**
 * True if `x` is an acceptable bubble_up_gate VALUE — i.e. one of the seven
 * gates OR the `none` sentinel. Use this to validate a field that is allowed to
 * say "no gate".
 */
function isValidGate(x) {
  return x === NO_GATE || GATE_ID_SET.has(x);
}

/**
 * True if `x` names a real gate that SHOULD bubble up (one of the seven).
 * `none` and invalid values return false. Use this to decide whether a return /
 * signal actually warrants rising to the human.
 */
function isBubbleUpGate(x) {
  return GATE_ID_SET.has(x);
}

/** Look up a gate's metadata by id, or null. */
function describeGate(id) {
  return GATES.find((g) => g.id === id) || null;
}

module.exports = {
  NO_GATE,
  GATES,
  GATE_IDS,
  GATE_ID_SET,
  isValidGate,
  isBubbleUpGate,
  describeGate,
};
