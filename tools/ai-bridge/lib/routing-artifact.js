'use strict';

/**
 * routing-artifact.js — Durable routing decision artifacts for Mythos dispatch.
 *
 * Records routing decisions as structured JSON artifacts. This makes
 * provider selection, fallback ordering, and constraint application
 * reviewable and auditable — without executing any actual dispatch.
 *
 * The routing artifact captures:
 *   - What workflow type was requested
 *   - Which provider was selected (and why)
 *   - The full fallback chain that was evaluated
 *   - Which constraints were applied (local-vs-cloud, privacy, capability)
 *   - A timestamp for when the decision was made
 *
 * This module depends on:
 *   - routing-policy.js for workflow classes, provider capabilities, fallback chains
 *   - provider-contract.js for runtime provider registry and health info
 *   - dispatch-contract.js for valid enums
 *
 * This module does NOT execute dispatches. It answers the question:
 *   "What was the routing decision, and why?"
 */

const fs = require('fs');
const path = require('path');

const {
  WORKFLOW_CLASSES,
  PROVIDER_CAPABILITIES,
  getWorkflowClass,
  getFallbackChain,
  resolveRoute
} = require('./routing-policy');

const { VALID_WORKFLOW_TYPES } = require('./dispatch-contract');

// ---------------------------------------------------------------------------
// RoutingDecision shape
// ---------------------------------------------------------------------------

/**
 * RoutingDecision shape:
 *   {
 *     workflow_type: string,         // The requested workflow type
 *     selected_provider: string|null,// The chosen provider (null if none available)
 *     fallback_chain: string[],      // Ordered providers that were evaluated
 *     selection_reasoning: string,   // Human-readable explanation of why
 *     constraints_applied: object[], // List of constraints that influenced the decision
 *     timestamp: string              // ISO timestamp of when the decision was made
 *   }
 */

// ---------------------------------------------------------------------------
// Constraint evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate local-vs-cloud constraints for a workflow type.
 *
 * Returns a list of constraint objects that describe what was evaluated
 * and what effect it had on provider filtering.
 *
 * @param {string} workflowType - One of VALID_WORKFLOW_TYPES
 * @param {object} [constraints] - Caller-supplied constraints
 * @param {boolean} [constraints.require_local] - Force local-only providers
 * @param {boolean} [constraints.require_cloud] - Force cloud-only providers
 * @param {boolean} [constraints.prefer_local] - Prefer local, but allow cloud fallback
 * @param {string} [constraints.min_capability] - Minimum capability level override
 * @param {string} [constraints.risk_class] - Risk class: 'low', 'medium', 'high'
 * @returns {object[]} Array of { constraint, value, effect }
 */
function evaluateConstraints(workflowType, constraints = {}) {
  const workflowClass = getWorkflowClass(workflowType);
  const applied = [];

  if (!workflowClass) {
    applied.push({
      constraint: 'workflow_type',
      value: workflowType,
      effect: 'rejected — unknown workflow type'
    });
    return applied;
  }

  // Workflow-level local/cloud eligibility
  if (!workflowClass.local_eligible) {
    applied.push({
      constraint: 'local_eligible',
      value: false,
      effect: 'local providers excluded by workflow class definition'
    });
  }
  if (!workflowClass.cloud_eligible) {
    applied.push({
      constraint: 'cloud_eligible',
      value: false,
      effect: 'cloud providers excluded by workflow class definition'
    });
  }

  // Privacy sensitivity
  if (workflowClass.privacy_sensitive) {
    applied.push({
      constraint: 'privacy_sensitive',
      value: true,
      effect: 'local providers preferred to avoid data exposure'
    });
  }

  // Risk class — encodes the escalation policy:
  //   low:    local-first allowed, reversible impact
  //   medium: local-first with explicit escalation path
  //   high:   no final local-only acceptance, frontier must review
  if (constraints.risk_class) {
    const rc = constraints.risk_class;
    let effect;
    if (rc === 'high') {
      effect = 'high risk — local can assist but frontier provider must review; no local-only final acceptance';
    } else if (rc === 'medium') {
      effect = 'medium risk — local-first allowed with explicit escalation path on ambiguity';
    } else {
      effect = 'low risk — local-first allowed, bounded review with reversible impact';
    }
    applied.push({ constraint: 'risk_class', value: rc, effect });
  }

  // Caller-supplied local/cloud constraints
  if (constraints.require_local) {
    applied.push({
      constraint: 'require_local',
      value: true,
      effect: 'only local providers are eligible (caller constraint)'
    });
  }
  if (constraints.require_cloud) {
    applied.push({
      constraint: 'require_cloud',
      value: true,
      effect: 'only cloud providers are eligible (caller constraint)'
    });
  }
  if (constraints.prefer_local) {
    applied.push({
      constraint: 'prefer_local',
      value: true,
      effect: 'local providers will be tried first (caller preference)'
    });
  }

  // Minimum capability
  const minCap = constraints.min_capability || workflowClass.min_capability;
  if (minCap) {
    applied.push({
      constraint: 'min_capability',
      value: minCap,
      effect: `providers below "${minCap}" capability level are excluded`
    });
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Provider filtering
// ---------------------------------------------------------------------------

/**
 * Capability level ordering for comparison.
 */
const CAPABILITY_LEVELS = { low: 1, medium: 2, high: 3 };

/**
 * Filter and order providers based on constraints.
 *
 * Starts from the routing policy fallback chain and filters based on
 * caller-supplied and workflow-derived constraints.
 *
 * @param {string} workflowType - One of VALID_WORKFLOW_TYPES
 * @param {string[]} baseFallbackChain - The policy fallback chain
 * @param {object} [constraints] - Caller-supplied constraints
 * @returns {{ chain: string[], selected: string|null, reasoning: string }}
 */
function filterProviders(workflowType, baseFallbackChain, constraints = {}) {
  const workflowClass = getWorkflowClass(workflowType);

  if (!workflowClass || baseFallbackChain.length === 0) {
    return {
      chain: [],
      selected: null,
      reasoning: `No providers available for workflow type "${workflowType}".`
    };
  }

  let chain = [...baseFallbackChain];
  const reasons = [];

  // Filter by local/cloud constraints
  if (constraints.require_local) {
    const before = chain.length;
    chain = chain.filter(p => {
      const cap = PROVIDER_CAPABILITIES[p];
      return cap && cap.type === 'local';
    });
    if (chain.length < before) {
      reasons.push(`filtered to local-only providers (${before} -> ${chain.length})`);
    }
  } else if (constraints.require_cloud) {
    const before = chain.length;
    chain = chain.filter(p => {
      const cap = PROVIDER_CAPABILITIES[p];
      return cap && cap.type === 'cloud';
    });
    if (chain.length < before) {
      reasons.push(`filtered to cloud-only providers (${before} -> ${chain.length})`);
    }
  }

  // Risk-class enforcement: high risk forces min_capability to 'high'
  if (constraints.risk_class === 'high' && !constraints.min_capability) {
    constraints = { ...constraints, min_capability: 'high' };
    reasons.push(`risk_class "high" raised min_capability to "high"`);
  }

  // Filter by minimum capability level
  const minCap = constraints.min_capability || workflowClass.min_capability;
  if (minCap && CAPABILITY_LEVELS[minCap]) {
    const minLevel = CAPABILITY_LEVELS[minCap];
    const before = chain.length;
    chain = chain.filter(p => {
      const cap = PROVIDER_CAPABILITIES[p];
      if (!cap) return false;
      const level = CAPABILITY_LEVELS[cap.capability_level] || 0;
      return level >= minLevel;
    });
    if (chain.length < before) {
      reasons.push(`filtered by min capability "${minCap}" (${before} -> ${chain.length})`);
    }
  }

  // Reorder: local providers first when prefer_local is set
  if (constraints.prefer_local && !constraints.require_local && !constraints.require_cloud) {
    const localProviders = chain.filter(p => {
      const cap = PROVIDER_CAPABILITIES[p];
      return cap && cap.type === 'local';
    });
    const cloudProviders = chain.filter(p => {
      const cap = PROVIDER_CAPABILITIES[p];
      return cap && cap.type !== 'local';
    });
    chain = [...localProviders, ...cloudProviders];
    if (localProviders.length > 0) {
      reasons.push(`reordered: local providers first (prefer_local)`);
    }
  }

  // Select first implemented provider
  let selected = null;
  for (const provider of chain) {
    const cap = PROVIDER_CAPABILITIES[provider];
    if (cap && cap.implemented) {
      selected = provider;
      break;
    }
  }

  // Build reasoning
  let reasoning;
  if (selected) {
    const cap = PROVIDER_CAPABILITIES[selected];
    const idx = chain.indexOf(selected);
    if (idx === 0) {
      reasoning = `Selected preferred provider "${selected}" (${cap.type}, ${cap.capability_level} capability).`;
    } else {
      const skipped = chain.slice(0, idx).join(', ');
      reasoning = `Skipped unimplemented providers [${skipped}]. Selected "${selected}" (${cap.type}, ${cap.capability_level} capability).`;
    }
  } else if (chain.length > 0) {
    reasoning = `No implemented provider in filtered chain [${chain.join(', ')}]. All candidates are unimplemented.`;
  } else {
    reasoning = `No providers remain after applying constraints.`;
  }

  if (reasons.length > 0) {
    reasoning += ` Filters applied: ${reasons.join('; ')}.`;
  }

  return { chain, selected, reasoning };
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a routing decision for a workflow type.
 *
 * Evaluates available providers against the workflow type, applies
 * local-vs-cloud constraints, selects the best provider with fallback
 * ordering, and records the selection reasoning.
 *
 * This does NOT execute any dispatch — it only records the decision.
 *
 * @param {string} workflowType - One of VALID_WORKFLOW_TYPES
 * @param {object} [constraints] - Routing constraints
 * @param {boolean} [constraints.require_local] - Force local-only providers
 * @param {boolean} [constraints.require_cloud] - Force cloud-only providers
 * @param {boolean} [constraints.prefer_local] - Prefer local, but allow cloud fallback
 * @param {string} [constraints.min_capability] - Minimum capability level override
 * @param {string} [constraints.risk_class] - Risk class: 'low', 'medium', 'high'. High forces min_capability to 'high'.
 * @returns {object} RoutingDecision
 */
function createRoutingDecision(workflowType, constraints = {}) {
  const baseFallbackChain = getFallbackChain(workflowType);
  const constraintsApplied = evaluateConstraints(workflowType, constraints);
  const { chain, selected, reasoning } = filterProviders(
    workflowType, baseFallbackChain, constraints
  );

  return {
    workflow_type: workflowType,
    selected_provider: selected,
    fallback_chain: chain,
    selection_reasoning: reasoning,
    constraints_applied: constraintsApplied,
    timestamp: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Artifact I/O
// ---------------------------------------------------------------------------

/**
 * Write a routing decision as a durable JSON artifact.
 *
 * Creates intermediate directories as needed. The artifact is a
 * pretty-printed JSON file with a .routing-decision.json suffix convention.
 *
 * @param {object} decision - A RoutingDecision object
 * @param {string} outputPath - File path to write the artifact
 * @returns {string} The absolute path of the written artifact
 */
function writeRoutingArtifact(decision, outputPath) {
  if (!decision) throw new Error('writeRoutingArtifact requires a decision object');
  if (!outputPath) throw new Error('writeRoutingArtifact requires an outputPath');

  const resolvedPath = path.resolve(outputPath);
  const dir = path.dirname(resolvedPath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(decision, null, 2) + '\n', 'utf8');

  return resolvedPath;
}

/**
 * Read a routing decision artifact from disk.
 *
 * @param {string} artifactPath - Path to the artifact file
 * @returns {object} The parsed RoutingDecision
 * @throws {Error} If the file does not exist or is not valid JSON
 */
function readRoutingArtifact(artifactPath) {
  if (!artifactPath) throw new Error('readRoutingArtifact requires an artifactPath');

  const resolvedPath = path.resolve(artifactPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Routing artifact not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8');

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in routing artifact: ${resolvedPath} — ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createRoutingDecision,
  writeRoutingArtifact,
  readRoutingArtifact,
  evaluateConstraints,
  filterProviders,
  CAPABILITY_LEVELS
};
