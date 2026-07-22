'use strict';

/**
 * provenance-utils.js — Shared provenance and distinct-intelligence utilities.
 *
 * Extracted to avoid circular dependencies between completion-classifier.js
 * and codex-bridge.js, both of which need these functions.
 */

/**
 * Normalize provenance from either flat fields (produced_by_actor_id) or
 * nested objects (produced_by: { actor_id }). Returns { actor_id, actor_type,
 * harness_id } or null if insufficient data.
 */
function normalizeProvenance(source, prefix) {
  if (!source) return null;
  // Nested object form: source.produced_by or source.validated_by
  if (source[prefix] && typeof source[prefix] === 'object') {
    const obj = source[prefix];
    if (obj.actor_id && obj.harness_id) {
      return { actor_id: obj.actor_id, actor_type: obj.actor_type || 'intelligence', harness_id: obj.harness_id };
    }
  }
  // Flat field form: source.produced_by_actor_id, etc.
  const actorId = source[prefix + '_actor_id'];
  const harnessId = source[prefix + '_harness_id'];
  if (actorId && harnessId) {
    return {
      actor_id: actorId,
      actor_type: source[prefix + '_actor_type'] || 'intelligence',
      harness_id: harnessId
    };
  }
  return null;
}

/**
 * Check whether two provenance actors represent distinct intelligence.
 *
 * When the producer is type=intelligence, the validator must ALSO be
 * type=intelligence with a different actor_id AND different harness_id.
 * Human validation is supplemental only — it does NOT satisfy the
 * distinct-intelligence gate for intelligence-produced artifacts.
 *
 * When the producer is type=human, any validator satisfies the gate
 * (human-produced work does not require distinct-intelligence validation).
 *
 * @param {{ actor_id: string, harness_id: string, actor_type?: string }} producedBy
 * @param {{ actor_id: string, harness_id: string, actor_type?: string }} validatedBy
 * @returns {boolean}
 */
function isDistinctIntelligence(producedBy, validatedBy) {
  if (!producedBy || !validatedBy) return false;
  // Human-produced work: any validator satisfies
  if (producedBy.actor_type === 'human') return true;
  // Intelligence-produced work: validator must be intelligence with distinct identity
  // Human validation is supplemental only — does not satisfy the gate
  const validatorType = validatedBy.actor_type || 'intelligence';
  if (validatorType === 'human') return false;
  // Both are intelligence — require different actor_id AND different harness_id
  return producedBy.actor_id !== validatedBy.actor_id &&
    producedBy.harness_id !== validatedBy.harness_id;
}

module.exports = {
  normalizeProvenance,
  isDistinctIntelligence
};
