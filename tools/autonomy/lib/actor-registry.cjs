/**
 * Actor Registry — control-plane actor identity.
 *
 * Makes actor identity first-class for the autonomy layer. Reads a local,
 * user-populated `actor-registry.json` (schema: schemas/actor-registry.schema.json)
 * and enriches each entry with the governance identity triple
 * (actor_id, actor_type, harness_id).
 *
 * This module is the single source of truth for "who/what is an actor" in
 * this port. Downstream routing, dispatch, validation, and provenance
 * surfaces should resolve actor identity through this module.
 *
 * Adaptation note: the private source coupled this module to a large,
 * hand-maintained JS actor table (`tools/signals/lib/actor-registry.js`) that
 * isn't part of this port. This version reads a plain JSON file instead —
 * copy `actor-registry.example.json` to `actor-registry.json` (same
 * directory) and edit it for your own actor roster. Absent that file, the
 * registry is empty and every lookup returns null/false rather than
 * throwing — an empty registry is a valid (if unconfigured) state.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_PATH = path.join(__dirname, '..', 'actor-registry.json');
const VALID_WORKLOADS = Object.freeze(['low', 'medium', 'high']);

function cloneActor(actor) {
  return JSON.parse(JSON.stringify(actor));
}

function loadRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const out = {};
    for (const [id, entry] of Object.entries(raw || {})) {
      if (!entry || typeof entry !== 'object' || String(id).startsWith('_')) continue;
      out[String(id).trim().toLowerCase()] = entry;
    }
    return out;
  } catch (err) {
    process.stderr.write(`[autonomy] ignoring malformed actor-registry.json: ${err.message}\n`);
    return {};
  }
}

function detectBinary(binary) {
  if (!binary) return '';
  const result = spawnSync('which', [binary], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

// ─── Basic lookups ──────────────────────────────────────────────────────────

/**
 * Get an actor entry (enriched with the identity triple) from the local
 * registry file. Returns null if not found or the registry is unpopulated.
 *
 * @param {string} actorId
 * @returns {object|null}
 */
function getActor(actorId) {
  const normalized = String(actorId || '').trim().toLowerCase();
  const registry = loadRegistry();
  const entry = registry[normalized];
  if (!entry) return null;
  return {
    ...cloneActor(entry),
    actor_id: entry.id || normalized,
    actor_type: entry.actor_type || 'intelligence',
    harness_id: entry.harness_id || entry.binary || normalized
  };
}

/**
 * Get the full enriched registry.
 *
 * @returns {Object<string, object>} Map of actor_id to enriched actor entry
 */
function getRegistry() {
  const registry = {};
  for (const id of Object.keys(loadRegistry())) {
    const actor = getActor(id);
    if (actor) registry[id] = actor;
  }
  return registry;
}

/**
 * Resolve an actor's canonical identity triple.
 *
 * @param {string} actorId
 * @returns {{ actor_id: string, actor_type: string, harness_id: string }|null}
 */
function resolveIdentity(actorId) {
  const actor = getActor(actorId);
  if (!actor) return null;
  return {
    actor_id: actor.actor_id,
    actor_type: actor.actor_type,
    harness_id: actor.harness_id
  };
}

/**
 * Check whether two actors represent distinct intelligence.
 *
 * @param {string} producerId
 * @param {string} validatorId
 * @returns {boolean}
 */
function areDistinct(producerId, validatorId) {
  const producer = resolveIdentity(producerId);
  const validator = resolveIdentity(validatorId);
  if (!producer || !validator) return false;

  // Human-produced work: any validator satisfies
  if (producer.actor_type === 'human') return true;

  // Human validators do not satisfy distinct-intelligence for AI-produced work
  if (validator.actor_type === 'human') return false;

  // Both intelligence: require different actor_id AND different harness_id
  return producer.actor_id !== validator.actor_id
    && producer.harness_id !== validator.harness_id;
}

/**
 * List all actors in the registry distinct from a given producer.
 *
 * @param {string} producerId
 * @returns {string[]}
 */
function listDistinctValidators(producerId) {
  return Object.keys(loadRegistry()).filter((id) => areDistinct(producerId, id));
}

/**
 * Resolve an actor's runtime availability (installed binary + reachability).
 *
 * @param {string} actorId
 * @returns {object|null}
 */
function resolveRuntime(actorId) {
  const actor = getActor(actorId);
  if (!actor) return null;
  const binaryPath = detectBinary(actor.binary);
  const installed = Boolean(binaryPath);
  return {
    ...actor,
    installed,
    available: installed && actor.verification_only !== true,
    binary_path: binaryPath
  };
}

function detectInstalledActors(actorIds) {
  const ids = actorIds || Object.keys(loadRegistry());
  const results = {};
  for (const id of ids) {
    const runtime = resolveRuntime(id);
    if (runtime) results[id] = runtime;
  }
  return results;
}

// ─── Workload + model choice ────────────────────────────────────────────────

function normalizeWorkload(workload = '') {
  const normalized = String(workload || '').trim().toLowerCase();
  return VALID_WORKLOADS.includes(normalized) ? normalized : '';
}

function chooseActorModel(actorId, workload = 'low', explicitModel = '') {
  if (String(explicitModel || '').trim()) return String(explicitModel).trim();
  const actor = getActor(actorId);
  if (!actor) return '';
  const tier = normalizeWorkload(workload) || 'low';
  return (actor.model_defaults && actor.model_defaults[tier]) || '';
}

function chooseClaudeBudgetUsd(workload = 'low') {
  const actor = getActor('claude');
  const tier = normalizeWorkload(workload) || 'low';
  if (actor && actor.budget_defaults_usd && typeof actor.budget_defaults_usd[tier] === 'number') {
    return actor.budget_defaults_usd[tier];
  }
  // Sane defaults when no registry entry is populated for claude.
  return tier === 'high' ? 8 : tier === 'medium' ? 3 : 1;
}

function inferWorkload(signal = {}) {
  const explicitWorkload = normalizeWorkload(
    signal.execution && signal.execution.workload
      ? signal.execution.workload
      : signal.workload || ''
  );
  if (explicitWorkload) return explicitWorkload;

  const mode = String(signal.execution && signal.execution.mode || 'read-only').trim().toLowerCase();
  const type = String(signal.signal_type || '').trim().toLowerCase();
  const scope = String(signal.scope || signal.signal_scope || '').trim().toLowerCase();
  const blockers = Array.isArray(signal.blocked_by) ? signal.blocked_by.length : 0;
  const artifacts = Array.isArray(signal.artifacts) ? signal.artifacts.length : 0;
  const decisionArtifacts = Array.isArray(signal.decision_context_artifacts)
    ? signal.decision_context_artifacts.length
    : 0;

  if (mode === 'full-auto') return 'high';
  if (mode === 'patch-allowed') {
    return artifacts > 6 || decisionArtifacts > 2 ? 'high' : 'medium';
  }
  if (type === 'blocked' || blockers > 0) return 'medium';
  if (artifacts > 5 || decisionArtifacts > 2) return 'medium';
  if (scope.includes('maintenance') || scope.includes('lessons')) return 'low';
  if (scope.includes('verify') || scope.includes('validation')) return 'low';
  return 'low';
}

// ─── Granted capabilities ───────────────────────────────────────────────────

function resolveProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'CLAUDE.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Resolve the granted capabilities for an actor.
 *
 * `capabilities` are what an actor claims it can do (from its registry entry).
 * `granted_capabilities` are what a promotion/scorecard process has verified.
 * Missing evidence = not granted (empty granted_capabilities), never assumed.
 *
 * @param {string} actorId
 * @param {string} [projectRoot]
 * @returns {{ capabilities: string[], granted_capabilities: string[], current_tier: string, source: string } | null}
 */
function resolveGrantedCapabilities(actorId, projectRoot) {
  const actor = getActor(actorId);
  if (!actor) return null;

  const capabilities = [
    ...(actor.preferred_for || []),
    ...Object.entries(actor.supports || {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
  ];

  const root = projectRoot || resolveProjectRoot();
  const scorecardPath = path.join(
    root, '_dev', 'reports', 'analysis', 'actor-scorecards',
    actorId + '__scorecard.json'
  );

  try {
    if (fs.existsSync(scorecardPath)) {
      const scorecard = JSON.parse(fs.readFileSync(scorecardPath, 'utf8'));
      const currentTier = scorecard.current_tier || 'candidate';
      if (Array.isArray(scorecard.granted_capabilities) && scorecard.granted_capabilities.length > 0) {
        return {
          capabilities,
          granted_capabilities: scorecard.granted_capabilities,
          current_tier: currentTier,
          source: 'scorecard'
        };
      }
      return {
        capabilities,
        granted_capabilities: [],
        current_tier: currentTier,
        source: 'scorecard_no_grants'
      };
    }
  } catch (_err) {
    // Fall through to missing-evidence path
  }

  return {
    capabilities,
    granted_capabilities: [],
    current_tier: 'candidate',
    source: 'no_scorecard'
  };
}

function hasGrantedCapability(actorId, capability, projectRoot) {
  const resolved = resolveGrantedCapabilities(actorId, projectRoot);
  if (!resolved) return false;
  return resolved.granted_capabilities.includes(capability);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  REGISTRY_PATH,
  getActor,
  getRegistry,
  resolveIdentity,
  areDistinct,
  listDistinctValidators,
  resolveRuntime,
  detectInstalledActors,
  resolveGrantedCapabilities,
  hasGrantedCapability,
  inferWorkload,
  normalizeWorkload,
  chooseActorModel,
  chooseClaudeBudgetUsd
};
