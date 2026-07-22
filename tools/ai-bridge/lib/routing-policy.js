'use strict';

const { WORKFLOW_CAPABILITY_REQUIREMENTS } = require('./model-registry');
const { selectLane, LANE_TYPES } = require('../../autonomy/lib/lane-selector.cjs');

// NOTE ON THIS PORT: the private original also carried cost-aware tiebreaking
// and granted-capability enforcement (computeEffectiveCapabilities,
// costAwareTiebreak, resolveRouteWithCost) wired to an actor-promotion tier
// ledger and a provider-cost pricing ledger. Those two subsystems are not part
// of this export slice, so that machinery was left behind rather than ported
// half-wired to nothing. What remains here — workflow classes, provider
// capabilities, the fallback table, and resolveRoute() — is the complete,
// self-contained routing core the dispatcher and actor-router actually need.

// ---------------------------------------------------------------------------
// Workflow classification
// ---------------------------------------------------------------------------

const WORKFLOW_CLASSES = {
  design: {
    description: 'Visual/CSS refinement requiring browser context',
    local_eligible: false,
    cloud_eligible: true,
    privacy_sensitive: false,
    min_capability: 'high',
    latency_tolerance: 'high'
  },
  research: {
    description: 'Deep factual research with citations and current data',
    local_eligible: false,
    cloud_eligible: true,
    privacy_sensitive: false,
    min_capability: 'high',
    latency_tolerance: 'high'
  },
  analysis: {
    description: 'Structural review, QA, prompt refinement',
    local_eligible: true,
    cloud_eligible: true,
    privacy_sensitive: false,
    min_capability: 'medium',
    latency_tolerance: 'medium'
  },
  classification: {
    description: 'Extraction, categorization, labeling, tagging',
    local_eligible: true,
    cloud_eligible: true,
    privacy_sensitive: true,
    min_capability: 'low',
    latency_tolerance: 'low'
  },
  drafting: {
    description: 'Low-risk first-draft writing, summarization, rewriting',
    local_eligible: true,
    cloud_eligible: true,
    privacy_sensitive: false,
    min_capability: 'medium',
    latency_tolerance: 'medium'
  },
  verification: {
    description: 'Bounded first-pass review with structured verdict output. Artifact-in, verdict-out only — no repo mutation.',
    local_eligible: true,
    cloud_eligible: true,
    privacy_sensitive: false,
    min_capability: 'medium',
    latency_tolerance: 'medium'
  }
};

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

const PROVIDER_CAPABILITIES = {
  'gemini-browser': {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['design', 'research', 'analysis'],
    capability_level: 'high',
    notes: 'Browser-driven Gemini dispatcher. Not part of this export slice — see the openai-compatible/gemini-api adapters for the API-key path instead.'
  },
  'openai-compatible': {
    type: 'cloud',
    implemented: true,
    supported_workflows: ['analysis', 'classification', 'drafting', 'verification'],
    capability_level: 'high',
    notes: 'Generic chat-completions compatible provider family resolved through the model registry.'
  },
  perplexity: {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['research'],
    capability_level: 'high',
    notes: 'Planned for research workflows. Not yet implemented.'
  },
  'chatgpt-api': {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['analysis', 'drafting'],
    capability_level: 'high',
    notes: 'Legacy placeholder. Prefer the generic openai-compatible runtime instead.'
  },
  'claude-api': {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['analysis', 'classification', 'drafting', 'verification'],
    capability_level: 'high',
    notes: 'Planned for direct Claude API delegation. Not yet implemented.'
  },
  ollama: {
    type: 'local',
    implemented: true,
    supported_workflows: ['classification', 'drafting', 'analysis', 'verification'],
    capability_level: 'medium',
    notes: 'Generic local-model provider implemented through the shared model runtime.'
  },
  openrouter: {
    type: 'cloud',
    implemented: true,
    supported_workflows: ['classification', 'drafting', 'analysis', 'verification', 'research'],
    capability_level: 'high',
    notes: 'OpenRouter (openai-compatible wire) as a first-class provider — dynamic openrouter:<vendor>/<model> minds, credentials resolved through tools/lib/resolve-credential.cjs, key never logged.'
  },
  codex: {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['analysis', 'classification', 'verification'],
    capability_level: 'medium',
    notes: 'A harness-CLI actor as a dispatch surface for review, classification, and verification tasks. Not yet implemented as a dispatcher here.'
  }
};

const ROUTING_TABLE = {
  design: ['gemini-browser'],
  research: ['perplexity', 'gemini-browser'],
  analysis: ['ollama', 'openai-compatible', 'codex', 'claude-api', 'chatgpt-api', 'gemini-browser'],
  classification: ['ollama', 'openai-compatible', 'codex', 'claude-api'],
  drafting: ['ollama', 'openai-compatible', 'claude-api', 'chatgpt-api'],
  verification: ['ollama', 'openai-compatible', 'codex', 'claude-api']
};

function getWorkflowClass(workflowType) {
  return WORKFLOW_CLASSES[workflowType] || null;
}

function getFallbackChain(workflowType) {
  return ROUTING_TABLE[workflowType] ? [...ROUTING_TABLE[workflowType]] : [];
}

function getFirstImplementedProvider(workflowType) {
  const chain = getFallbackChain(workflowType);
  for (const provider of chain) {
    const cap = PROVIDER_CAPABILITIES[provider];
    if (cap && cap.implemented) return provider;
  }
  return null;
}

/**
 * Resolve the routing decision for a workflow type, optionally enforcing a
 * local/cloud lane via `laneContext` (see tools/autonomy/lib/lane-selector.cjs).
 *
 * @param {string} workflowType
 * @param {object} [laneContext]
 * @returns {object} route resolution
 */
function resolveRoute(workflowType, laneContext) {
  const workflowClass = getWorkflowClass(workflowType);
  if (!workflowClass) {
    return {
      workflow_type: workflowType,
      workflow_class: null,
      required_capabilities: [],
      fallback_chain: [],
      selected_provider: null,
      selection_reason: `Unknown workflow type: "${workflowType}".`,
      local_available: false,
      all_providers_unimplemented: true
    };
  }

  const chain = getFallbackChain(workflowType);
  const selected = getFirstImplementedProvider(workflowType);
  const localAvailable = chain.some((provider) => PROVIDER_CAPABILITIES[provider] && PROVIDER_CAPABILITIES[provider].type === 'local');
  const allUnimplemented = !chain.some((provider) => PROVIDER_CAPABILITIES[provider] && PROVIDER_CAPABILITIES[provider].implemented);

  let reason = `No implemented provider available for ${workflowType}. Fallback chain: [${chain.join(', ')}].`;
  if (selected) {
    if (selected === chain[0]) {
      reason = `Selected preferred provider "${selected}" for ${workflowType}.`;
    } else {
      reason = `Preferred provider "${chain[0]}" is not implemented. Falling back to "${selected}".`;
    }
  }

  // Lane classification — null if no laneContext provided (backward-compatible)
  let lane = null;
  if (laneContext) {
    const wc = workflowClass || {};
    lane = selectLane({
      workflow_type: workflowType,
      acceptance_grade: laneContext.acceptance_grade || false,
      risk_tier: laneContext.risk_tier || 'low',
      local_eligible: wc.local_eligible !== false,
      cloud_override_reason: laneContext.cloud_override_reason,
      operator_requested_cloud: laneContext.operator_requested_cloud || false
    });
  }

  // Enforce lane-provider consistency when lane context is active
  let effectiveChain = chain;
  let effectiveSelected = selected;
  let effectiveLocalAvailable = localAvailable;
  if (lane) {
    const requiredLocation = lane.location; // 'local' or 'cloud'
    effectiveChain = chain.filter(function (provider) {
      var cap = PROVIDER_CAPABILITIES[provider];
      return cap && cap.type === requiredLocation;
    });
    effectiveSelected = null;
    for (var i = 0; i < effectiveChain.length; i++) {
      var cap = PROVIDER_CAPABILITIES[effectiveChain[i]];
      if (cap && cap.implemented) {
        effectiveSelected = effectiveChain[i];
        break;
      }
    }
    effectiveLocalAvailable = effectiveChain.some(function (provider) {
      var cap = PROVIDER_CAPABILITIES[provider];
      return cap && cap.type === 'local';
    });
    if (effectiveSelected) {
      reason = 'Lane "' + lane.lane + '" selected ' + requiredLocation + ' provider "' + effectiveSelected + '" for ' + workflowType + '.';
    } else if (effectiveChain.length > 0) {
      reason = 'Lane "' + lane.lane + '" requires ' + requiredLocation + ' provider but no implemented ' + requiredLocation + ' provider for ' + workflowType + '.';
    } else {
      reason = 'Lane "' + lane.lane + '" requires ' + requiredLocation + ' provider but no ' + requiredLocation + ' provider exists for ' + workflowType + '.';
    }
  }

  const effectiveAllUnimplemented = !effectiveChain.some(function (provider) {
    var cap = PROVIDER_CAPABILITIES[provider];
    return cap && cap.implemented;
  });

  return {
    workflow_type: workflowType,
    workflow_class: workflowClass,
    required_capabilities: [...(WORKFLOW_CAPABILITY_REQUIREMENTS[workflowType] || [])],
    fallback_chain: effectiveChain,
    selected_provider: effectiveSelected,
    selection_reason: reason,
    local_available: effectiveLocalAvailable,
    all_providers_unimplemented: effectiveAllUnimplemented,
    lane: lane
  };
}

function listRoutingSummary() {
  return Object.keys(WORKFLOW_CLASSES).map((workflowType) => {
    const workflowClass = WORKFLOW_CLASSES[workflowType];
    return {
      workflow_type: workflowType,
      local_eligible: workflowClass.local_eligible,
      cloud_eligible: workflowClass.cloud_eligible,
      privacy_sensitive: workflowClass.privacy_sensitive,
      required_capabilities: [...(WORKFLOW_CAPABILITY_REQUIREMENTS[workflowType] || [])],
      fallback_chain: getFallbackChain(workflowType),
      first_implemented: getFirstImplementedProvider(workflowType)
    };
  });
}

function listProviderCapabilities() {
  return Object.entries(PROVIDER_CAPABILITIES).map(([provider, capability]) => ({
    provider,
    ...capability
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  WORKFLOW_CLASSES,
  PROVIDER_CAPABILITIES,
  ROUTING_TABLE,
  getWorkflowClass,
  getFallbackChain,
  getFirstImplementedProvider,
  resolveRoute,
  listRoutingSummary,
  listProviderCapabilities,
  selectLane,
  LANE_TYPES
};
