/**
 * Actor Router — P1-actor-registry-routing
 *
 * Resolves dispatch routing through actor identity rather than ad hoc
 * harness/provider logic. This is the identity resolution layer that
 * sits between the routing policy and the dispatch contract.
 *
 * The router answers: "Given a workflow, which actor should handle it,
 * and what is that actor's canonical identity?"
 *
 * It does NOT implement trust-tier enforcement (P5), cost-aware routing
 * changes (P6), delegation (P3), or authority bundles (P7).
 */

'use strict';

const {
  getActor,
  getRegistry,
  resolveIdentity,
  areDistinct,
  listDistinctValidators,
  resolveRuntime,
  resolveGrantedCapabilities
} = require('../../autonomy/lib/actor-registry.cjs');

const {
  resolveRoute,
  PROVIDER_CAPABILITIES
} = require('./routing-policy');

// ─── Provider-to-Actor Mapping ──────────────────────────────────────────────

/**
 * Map provider identifiers to their primary actor.
 * This bridges the legacy provider-based routing to actor-based routing.
 */
const PROVIDER_ACTOR_MAP = Object.freeze({
  'gemini-browser': null,           // External provider, no registered actor
  'openai-compatible': null,        // Generic provider family, not a single actor
  'perplexity': null,               // External provider, no registered actor
  'chatgpt-api': null,              // External provider, no registered actor
  'claude-api': 'claude',           // Claude API routes through claude actor
  'ollama': null,                   // Local model, no single actor identity
  'openrouter': null,               // Dynamic model family (openrouter:<vendor>/<model>), not a single actor
  'codex': 'codex'                  // Codex provider maps to codex actor
});

// ─── Actor-Aware Route Resolution ───────────────────────────────────────────

/**
 * Resolve a route with actor identity enrichment.
 *
 * Takes the legacy provider-based route resolution and enriches it
 * with the canonical actor identity triple from the actor registry.
 *
 * @param {string} workflowType - Workflow type to route
 * @returns {object} Route resolution with actor identity
 */
function resolveActorRoute(workflowType) {
  const baseRoute = resolveRoute(workflowType);

  // Try provider-based actor resolution first
  const selectedProvider = baseRoute.selected_provider;
  let actorId = selectedProvider ? (PROVIDER_ACTOR_MAP[selectedProvider] || null) : null;

  // If provider mapping yields null, walk the fallback chain for an available actor
  if (!actorId) {
    const available = findAvailableActor(workflowType);
    if (available) {
      actorId = available.actor_id;
    }
  }

  const actorIdentity = actorId ? resolveIdentity(actorId) : null;
  const actorRuntime = actorId ? resolveRuntime(actorId) : null;

  return {
    ...baseRoute,
    actor_id: actorId,
    actor_identity: actorIdentity,
    actor_available: actorRuntime ? actorRuntime.available === true : false,
    actor_installed: actorRuntime ? actorRuntime.installed === true : false
  };
}

/**
 * Find the best available actor for a workflow type.
 *
 * Walks the fallback chain and returns the first actor that is:
 * 1. Mapped from a provider in the routing table
 * 2. Installed and available on this system
 * 3. Has a valid identity in the actor registry
 *
 * @param {string} workflowType - Workflow type to route
 * @returns {{ actor_id: string, identity: object, provider: string, runtime: object }|null}
 */
function findAvailableActor(workflowType) {
  const baseRoute = resolveRoute(workflowType);

  for (const provider of baseRoute.fallback_chain) {
    const cap = PROVIDER_CAPABILITIES[provider];
    if (!cap) continue;

    const actorId = PROVIDER_ACTOR_MAP[provider];
    if (!actorId) continue;

    const runtime = resolveRuntime(actorId);
    if (!runtime || !runtime.available) continue;

    const identity = resolveIdentity(actorId);
    if (!identity) continue;

    return {
      actor_id: actorId,
      identity,
      provider,
      runtime
    };
  }

  return null;
}

/**
 * Resolve which actor should validate a given producer's output.
 *
 * Returns the first available actor that is distinct from the producer
 * (different actor_id AND different harness_id).
 *
 * @param {string} producerId - Actor ID of the producer
 * @returns {{ actor_id: string, identity: object, runtime: object }|null}
 */
function resolveValidator(producerId) {
  const distinctIds = listDistinctValidators(producerId);

  for (const validatorId of distinctIds) {
    const runtime = resolveRuntime(validatorId);
    if (!runtime || !runtime.available) continue;
    if (runtime.actor_type === 'human') continue; // humans validate manually

    const identity = resolveIdentity(validatorId);
    if (!identity) continue;

    return {
      actor_id: validatorId,
      identity,
      runtime
    };
  }

  return null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  PROVIDER_ACTOR_MAP,
  resolveActorRoute,
  findAvailableActor,
  resolveValidator,
  // Re-export registry functions for convenience
  getActor,
  getRegistry,
  resolveIdentity,
  areDistinct,
  listDistinctValidators
};
