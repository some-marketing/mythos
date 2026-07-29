'use strict';

const fs = require('fs');
const path = require('path');
const { VALID_WORKFLOW_TYPES, VALID_PROVIDERS } = require('./dispatch-contract');
const { WORKFLOW_CAPABILITY_REQUIREMENTS } = require('./model-registry');
const { resolveGrantedCapabilities } = require('../../signals/lib/actor-registry');

// Canonical actor registry — P1-actor-registry-routing
// The canonical module is tools/autonomy/lib/actor-registry.cjs.
// This import preserves backward compatibility with existing consumers.
const { resolveIdentity: resolveActorIdentity } = require('../../autonomy/lib/actor-registry.cjs');
const { computeGrantedCapabilities, TIER_CAPABILITIES } = require('../../actor-promotion/promotion-controller');
const { VALID_PRICING_MODES } = require('../../provider-cost/ledger');
const { selectLane, LANE_TYPES } = require('../../autonomy/lib/lane-selector.cjs');

// ---------------------------------------------------------------------------
// Cost-routing decision log path
// ---------------------------------------------------------------------------

/**
 * Append-only JSONL log for cost-aware routing decisions.
 * @type {string}
 */
const COST_ROUTING_LOG_PATH = path.join(__dirname, '../../../_dev/logs/cost-routing-decisions.jsonl');

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

const PROVIDER_CAPABILITIES = {
  'gemini-browser': {
    type: 'cloud',
    implemented: true,
    supported_workflows: ['design', 'research', 'analysis'],
    capability_level: 'high',
    notes: 'Playwright-driven Gemini interaction. Specialized browser dispatcher.'
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
    notes: 'Planned for Deep Research workflows. Not yet implemented.'
  },
  'chatgpt-api': {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['analysis', 'drafting'],
    capability_level: 'high',
    notes: 'Legacy placeholder. Generic OpenAI-compatible runtime should be preferred instead.'
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
    notes: 'OpenRouter (openai-compatible wire) as first-class provider — mind-router S5; dynamic openrouter:<vendor>/<model> minds, auth op->env->file, key never logged.'
  },
  codex: {
    type: 'cloud',
    implemented: false,
    supported_workflows: ['analysis', 'classification', 'verification'],
    capability_level: 'medium',
    notes: 'Codex agent as a dispatch surface for review, classification, and verification tasks. Not yet implemented as a dispatcher.'
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
    effectiveChain = chain.filter(function(provider) {
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
    effectiveLocalAvailable = effectiveChain.some(function(provider) {
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

  const effectiveAllUnimplemented = !effectiveChain.some(function(provider) {
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
// Effective capability computation
// ---------------------------------------------------------------------------

/**
 * Compute effective capabilities for an actor within a lane.
 *
 * effective_capability = claimed ∩ granted ∩ lane_policy
 *
 * @param {string} actorId - Actor identifier (e.g. 'claude', 'codex').
 * @param {string} tier - Current promotion tier.
 * @param {object} [lanePolicies] - Lane policies. Expected: { allowed_capabilities: string[] }.
 * @param {string} [projectRoot] - Absolute path to Mythos repo root.
 * @returns {{ claimed: string[], granted: string[], effective: string[], source: string } | null}
 */
function computeEffectiveCapabilities(actorId, tier, lanePolicies, projectRoot) {
  const resolved = resolveGrantedCapabilities(actorId, projectRoot);
  if (!resolved) return null;

  // effective = granted ∩ tier ∩ lane (NOT claimed ∩ tier ∩ lane)
  // The scorecard's granted_capabilities are the evidence-backed set;
  // computeGrantedCapabilities further narrows by tier and lane policy.
  const effective = computeGrantedCapabilities(
    resolved.granted_capabilities,
    tier || 'candidate',
    lanePolicies || {}
  );

  return {
    claimed: resolved.capabilities,
    granted: resolved.granted_capabilities,
    effective: effective,
    source: resolved.source
  };
}

// ---------------------------------------------------------------------------
// Cost-aware tiebreaking
// ---------------------------------------------------------------------------

/**
 * Determine whether a candidate is eligible for cost-aware ranking.
 *
 * Candidates with `pricing_mode: 'unknown'` are ineligible.
 * Candidates with `pricing_mode: 'zero_local'` are eligible (cost = 0).
 *
 * @param {object} candidate - Candidate descriptor with cost metadata.
 * @param {string} candidate.pricing_mode - One of VALID_PRICING_MODES.
 * @returns {boolean}
 */
function isCostEligible(candidate) {
  if (!candidate || !candidate.pricing_mode) return false;
  return candidate.pricing_mode !== 'unknown';
}

/**
 * Build a canonical-vs-display stability snapshot for audit.
 *
 * Records both canonical USD and display currency amounts plus FX metadata
 * so that a later audit can prove the display cost matched canonical at
 * decision time.
 *
 * @param {object} costInfo - Cost information for the selected candidate.
 * @param {number} costInfo.canonical_cost_usd - Canonical cost in USD.
 * @param {string} costInfo.pricing_mode - Pricing mode.
 * @param {object} [costInfo.display_cost] - Display-currency cost info.
 * @returns {object} Stability snapshot.
 */
function buildStabilitySnapshot(costInfo) {
  const snapshot = {
    snapshot_at: new Date().toISOString(),
    canonical: {
      currency: 'USD',
      amount: costInfo.canonical_cost_usd || 0,
      pricing_mode: costInfo.pricing_mode || 'unknown'
    },
    display: null,
    fx: null
  };

  if (costInfo.display_cost && typeof costInfo.display_cost === 'object') {
    snapshot.display = {
      currency: costInfo.display_cost.currency || 'USD',
      amount: costInfo.display_cost.total_amount || 0,
      formatted: costInfo.display_cost.formatted_total || null,
      locale: costInfo.display_cost.locale || null
    };
    snapshot.fx = {
      rate: costInfo.display_cost.fx_rate || 1,
      source: costInfo.display_cost.fx_source || 'none',
      timestamp: costInfo.display_cost.fx_timestamp || null
    };
  }

  return snapshot;
}

/**
 * Log a cost-routing decision to the append-only JSONL log.
 *
 * @param {CostRoutingDecision} decision
 */
function logCostRoutingDecision(decision) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...decision
  }) + '\n';
  try {
    const dir = path.dirname(COST_ROUTING_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(COST_ROUTING_LOG_PATH, line);
  } catch { /* telemetry is best-effort */ }
}

/**
 * Perform cost-aware tiebreaking among equally-trusted candidates.
 *
 * Ordering rules (from the JSON plan):
 *   1. Correctness first — only candidates that pass correctness checks enter.
 *   2. Safety second — only candidates that pass safety checks enter.
 *   3. Cost third — among remaining candidates, prefer lower canonical USD cost.
 *
 * Never compares display-currency values for routing; only canonical USD.
 * `pricing_mode: 'unknown'` actors are ineligible for cost ranking.
 * `pricing_mode: 'zero_local'` actors are eligible with cost = 0.
 *
 * @param {CostCandidate[]} candidates - Array of candidate descriptors.
 * @param {object} [opts]
 * @param {string} [opts.workflow_type] - Workflow type for telemetry.
 * @param {string} [opts.trust_tier] - Shared trust tier of the candidates.
 * @param {object} [opts.lane_policies] - Lane policies for capability filtering.
 * @returns {CostTiebreakResult}
 */
function costAwareTiebreak(candidates, opts) {
  const options = opts || {};
  const candidateSet = (candidates || []).map(function (c) {
    return {
      actor_id: c.actor_id || '',
      model_id: c.model_id || '',
      provider: c.provider || '',
      trust_tier: c.trust_tier || options.trust_tier || '',
      pricing_mode: c.pricing_mode || 'unknown',
      canonical_cost_usd: typeof c.canonical_cost_usd === 'number' ? c.canonical_cost_usd : null,
      display_cost: c.display_cost || null
    };
  });

  // No candidates
  if (candidateSet.length === 0) {
    return {
      selected: null,
      candidate_set: [],
      tie_break_reason: 'no_candidates',
      cost_used_for_routing: false,
      cost_confidence: 'none',
      stability_snapshot: null
    };
  }

  // Single candidate — no tiebreak needed
  if (candidateSet.length === 1) {
    const only = candidateSet[0];
    const result = {
      selected: only,
      candidate_set: candidateSet,
      tie_break_reason: 'single_candidate',
      cost_used_for_routing: false,
      cost_confidence: isCostEligible(only) ? 'available' : 'unavailable',
      stability_snapshot: null
    };

    logCostRoutingDecision({
      candidate_set: candidateSet,
      selected_actor_id: only.actor_id,
      selected_model_id: only.model_id,
      selected_provider: only.provider,
      selected_trust_tier: only.trust_tier,
      expected_canonical_cost_usd: only.canonical_cost_usd,
      cost_confidence: result.cost_confidence,
      display_cost_preview: only.display_cost,
      tie_break_reason: result.tie_break_reason,
      cost_used_for_routing: false,
      workflow_type: options.workflow_type || null
    });

    return result;
  }

  // Partition into cost-eligible and cost-ineligible
  var eligible = [];
  var ineligible = [];
  for (var i = 0; i < candidateSet.length; i++) {
    if (isCostEligible(candidateSet[i]) && candidateSet[i].canonical_cost_usd !== null) {
      eligible.push(candidateSet[i]);
    } else {
      ineligible.push(candidateSet[i]);
    }
  }

  var selected;
  var tieBreakReason;
  var costUsed;
  var costConfidence;

  if (eligible.length > 0) {
    // Sort eligible by canonical_cost_usd ascending
    eligible.sort(function (a, b) {
      return a.canonical_cost_usd - b.canonical_cost_usd;
    });
    selected = eligible[0];
    costUsed = eligible.length > 1 || ineligible.length > 0;
    tieBreakReason = costUsed
      ? 'cost_tiebreak_lowest_canonical_usd'
      : 'cost_eligible_single';

    // Determine cost confidence from pricing modes present
    var allActual = eligible.every(function (c) { return c.pricing_mode === 'actual'; });
    var anyEstimated = eligible.some(function (c) { return c.pricing_mode === 'estimated'; });
    var anyZeroLocal = eligible.some(function (c) { return c.pricing_mode === 'zero_local'; });

    if (allActual) {
      costConfidence = 'verified';
    } else if (anyEstimated) {
      costConfidence = 'estimated';
    } else if (anyZeroLocal) {
      costConfidence = 'mixed_with_local';
    } else {
      costConfidence = 'available';
    }
  } else {
    // No cost-eligible candidates — fall back to first candidate (order from fallback chain)
    selected = candidateSet[0];
    costUsed = false;
    tieBreakReason = 'no_cost_eligible_candidates';
    costConfidence = 'unavailable';
  }

  // Build stability snapshot for cost-aware decisions
  var snapshot = null;
  if (costUsed) {
    snapshot = buildStabilitySnapshot({
      canonical_cost_usd: selected.canonical_cost_usd,
      pricing_mode: selected.pricing_mode,
      display_cost: selected.display_cost
    });
  }

  var decision = {
    candidate_set: candidateSet,
    selected_actor_id: selected.actor_id,
    selected_model_id: selected.model_id,
    selected_provider: selected.provider,
    selected_trust_tier: selected.trust_tier,
    expected_canonical_cost_usd: selected.canonical_cost_usd,
    cost_confidence: costConfidence,
    display_cost_preview: selected.display_cost,
    tie_break_reason: tieBreakReason,
    cost_used_for_routing: costUsed,
    workflow_type: options.workflow_type || null,
    stability_snapshot: snapshot || null
  };

  logCostRoutingDecision(decision);

  return {
    selected: selected,
    candidate_set: candidateSet,
    tie_break_reason: tieBreakReason,
    cost_used_for_routing: costUsed,
    cost_confidence: costConfidence,
    stability_snapshot: snapshot
  };
}

// ---------------------------------------------------------------------------
// Cost-aware route resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a route with cost-aware tiebreaking and granted-capability enforcement.
 *
 * Extends {@link resolveRoute} with:
 * - Effective capability filtering (claimed ∩ granted ∩ lane_policy)
 * - Cost-aware tiebreaking among equally-trusted candidates
 * - Durable cost-routing decision recording
 * - Canonical-vs-display stability snapshots
 *
 * @param {string} workflowType - Workflow type to route.
 * @param {object} [opts]
 * @param {CostCandidate[]} [opts.candidates] - Pre-built candidate list with cost metadata.
 * @param {string} [opts.trust_tier] - Shared trust tier for all candidates.
 * @param {object} [opts.lane_policies] - Lane policies for capability filtering.
 * @returns {object} Extended route resolution with cost-aware fields.
 */
function resolveRouteWithCost(workflowType, opts) {
  var options = opts || {};
  var baseRoute = resolveRoute(workflowType, options.lane_context || null);

  // If no candidates provided, return the base route with cost metadata stubs
  if (!options.candidates || options.candidates.length === 0) {
    return Object.assign({}, baseRoute, {
      cost_aware: false,
      cost_tiebreak: null,
      effective_capabilities: null
    });
  }

  // Filter candidates by effective capabilities — each candidate must have
  // ALL required capabilities for the workflow, not just "any capability"
  var filteredCandidates = options.candidates;
  var requiredCaps = baseRoute.required_capabilities || [];

  if (options.lane_policies || requiredCaps.length > 0) {
    filteredCandidates = options.candidates.filter(function (c) {
      if (!c.actor_id) return true; // pass through candidates without actor identity
      var eff = computeEffectiveCapabilities(
        c.actor_id,
        c.trust_tier || options.trust_tier || 'candidate',
        options.lane_policies || {},
        options.project_root
      );
      if (!eff) return false;
      // Must have ALL required capabilities, not just non-empty effective set
      if (requiredCaps.length > 0) {
        return requiredCaps.every(function (cap) {
          return eff.effective.includes(cap);
        });
      }
      return eff.effective.length > 0;
    });

    // NO fallback: if no candidate satisfies required capabilities, return
    // empty result — never silently restore unfiltered candidates
  }

  var tiebreak = costAwareTiebreak(filteredCandidates, {
    workflow_type: workflowType,
    trust_tier: options.trust_tier,
    lane_policies: options.lane_policies
  });

  // Compute effective capabilities for the selected actor
  var effectiveCaps = null;
  if (tiebreak.selected && tiebreak.selected.actor_id) {
    effectiveCaps = computeEffectiveCapabilities(
      tiebreak.selected.actor_id,
      tiebreak.selected.trust_tier || options.trust_tier || 'candidate',
      options.lane_policies || {},
      options.project_root
    );
  }

  return Object.assign({}, baseRoute, {
    cost_aware: tiebreak.cost_used_for_routing,
    cost_tiebreak: {
      selected_actor_id: tiebreak.selected ? tiebreak.selected.actor_id : null,
      selected_model_id: tiebreak.selected ? tiebreak.selected.model_id : null,
      selected_provider: tiebreak.selected ? tiebreak.selected.provider : null,
      expected_canonical_cost_usd: tiebreak.selected ? tiebreak.selected.canonical_cost_usd : null,
      tie_break_reason: tiebreak.tie_break_reason,
      cost_confidence: tiebreak.cost_confidence,
      candidate_count: tiebreak.candidate_set.length,
      stability_snapshot: tiebreak.stability_snapshot
    },
    effective_capabilities: effectiveCaps
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  WORKFLOW_CLASSES,
  PROVIDER_CAPABILITIES,
  ROUTING_TABLE,
  COST_ROUTING_LOG_PATH,
  getWorkflowClass,
  getFallbackChain,
  getFirstImplementedProvider,
  resolveRoute,
  resolveRouteWithCost,
  listRoutingSummary,
  listProviderCapabilities,
  computeEffectiveCapabilities,
  isCostEligible,
  costAwareTiebreak,
  buildStabilitySnapshot,
  logCostRoutingDecision,
  resolveActorIdentity,
  selectLane,
  LANE_TYPES
};

/**
 * @typedef {object} CostCandidate
 * @property {string} actor_id - Actor identifier (e.g. 'claude', 'codex').
 * @property {string} model_id - Canonical model identifier.
 * @property {string} provider - Provider name.
 * @property {string} trust_tier - Actor's current promotion tier.
 * @property {string} pricing_mode - One of VALID_PRICING_MODES.
 * @property {number|null} canonical_cost_usd - Expected canonical cost in USD.
 * @property {object|null} display_cost - Display-currency cost object.
 * @property {string} [display_cost.currency] - Display currency code.
 * @property {number} [display_cost.total_amount] - Total in display currency.
 * @property {string} [display_cost.formatted_total] - Locale-formatted total.
 * @property {string} [display_cost.locale] - Display locale.
 * @property {number} [display_cost.fx_rate] - FX rate from USD.
 * @property {string} [display_cost.fx_source] - Source of FX rate.
 * @property {string} [display_cost.fx_timestamp] - When FX rate was fetched.
 */

/**
 * @typedef {object} CostTiebreakResult
 * @property {object|null} selected - The selected candidate.
 * @property {object[]} candidate_set - All candidates considered.
 * @property {string} tie_break_reason - Reason for the tiebreak decision.
 * @property {boolean} cost_used_for_routing - Whether cost influenced the selection.
 * @property {string} cost_confidence - Confidence level of cost data.
 * @property {object|null} stability_snapshot - Canonical-vs-display audit snapshot.
 */

/**
 * @typedef {object} CostRoutingDecision
 * @property {object[]} candidate_set - All candidates considered.
 * @property {string} selected_actor_id - Selected actor identifier.
 * @property {string} selected_model_id - Selected model identifier.
 * @property {string} selected_provider - Selected provider.
 * @property {string} selected_trust_tier - Selected actor's trust tier.
 * @property {number|null} expected_canonical_cost_usd - Expected canonical cost.
 * @property {string} cost_confidence - Confidence level.
 * @property {object|null} display_cost_preview - Display cost preview.
 * @property {string} tie_break_reason - Reason for the decision.
 * @property {boolean} cost_used_for_routing - Whether cost influenced selection.
 */
