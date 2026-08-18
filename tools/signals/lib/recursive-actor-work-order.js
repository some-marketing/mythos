'use strict';

const { validate } = require('../../verify/lib/schema.cjs');
const schema = require('../schemas/recursive-actor-work-order.schema.json');
// Layer 2 (S2): the ONE canonical bubble-up gate taxonomy. A worker return must
// name its bubble_up_gate from this module (or 'none' to resolve locally).
const { isValidGate, isBubbleUpGate, GATE_IDS } = require('../../kernel/lib/bubble-up-gates.cjs');
const {
  compareScopeTiers,
  getBridgeTargetPolicy,
  getScopeTierPolicy,
  resolveRecursiveBridgeRoute
} = require('./bridge-target-policy');
const { COMPLETED_STATUSES, validateDelegatedCompletionReceipt } = require('../../verify/lib/delegated-completion-receipt.cjs');

const DEFAULT_STOP_CONDITIONS = Object.freeze([
  'halt if the child scope is no longer narrower than the parent scope',
  'halt if routing.transport is api and routing.api_allowed is false',
  'halt if the child write set escapes the parent write set',
  'halt if required evidence is missing or stale'
]);

const DEFAULT_RETURN_CONTRACT = Object.freeze({
  kind: 'recursive-actor-work-order-return/1.1',
  delivery: 'single JSON object with status, evidence, parent impact, bubble-up gate, and exact next command',
  required_fields: ['status', 'evidence_locations', 'next_command', 'parent_impact', 'bubble_up_gate'],
  optional_fields: ['observations', 'changed_files', 'notes', 'stop_reason'],
  notes: [
    'Return one structured object only.',
    'Keep evidence references exact and local to the declared workstream.',
    'Do not widen scope or authority in the return payload.',
    'parent_impact: state how this result changes the parent task (resulting state + what the parent must do next).',
    `bubble_up_gate: 'none' means resolve at this level — do NOT bubble up. Only set it to one of [${GATE_IDS.join(', ')}] when the question genuinely requires that gate; naming a gate is the ONLY way to legitimately bubble a question up to the human.`
  ]
});

const DEFAULT_BRANCH_GROUNDING_SUMMARY = Object.freeze({
  live: 'Live GitHub grounding was used for repo-specific claims.',
  unverified: 'GitHub grounding was unavailable, so repo-specific claims are marked unverified.',
  assumed: 'Branch claims are assumptions and remain unverified.'
});

const SELECTION_PRECEDENCE = Object.freeze([
  'frontier_for_broad_or_ambiguous',
  'cheapest_sufficient_within_capability_floor',
  'downshift_as_scope_narrows'
]);

const COST_PREFERENCE_ORDER = Object.freeze({
  free: 0,
  low: 1,
  balanced: 2,
  best_available: 3
});

const DETERMINISM_ORDER = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  mechanical: 3
});

const ORDERED_TIER_NAMES = Object.freeze(['system', 'client', 'project', 'task', 'leaf']);

const DEFAULT_AGGREGATION_CONTRACT = Object.freeze({
  kind: 'recursive-fan-in/1.0',
  merge_strategy: 'aggregate child evidence, blockers, and next-state candidates upward',
  required_fields: ['evidence', 'blockers', 'next_state_candidates', 'next_command'],
  optional_fields: ['observations', 'notes', 'resolved_questions'],
  notes: [
    'Child outputs are fan-in data, not authority.',
    'The parent aggregates evidence and residual blockers upward.',
    'Next-state candidates should preserve the cheapest sufficient path.'
  ]
});

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeMaybeList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => normalizeInputObject(entry))
    .filter((entry) => Object.keys(entry).length > 0);
}

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : null;
}

function compactValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '""';
  if (/^[A-Za-z0-9._:/-]+$/.test(normalized)) return normalized;
  return JSON.stringify(normalized);
}

function normalizeTier(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ORDERED_TIER_NAMES.includes(normalized) ? normalized : '';
}

function normalizeTransport(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ['local-cli', 'local-model', 'api', 'api-router'].includes(normalized) ? normalized : '';
}

function normalizeCostPreference(value) {
  const normalized = normalizeText(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(COST_PREFERENCE_ORDER, normalized) ? normalized : '';
}

function normalizeDeterminismLevel(value) {
  const normalized = normalizeText(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(DETERMINISM_ORDER, normalized) ? normalized : '';
}

function nextNarrowerTier(scopeTier) {
  const index = ORDERED_TIER_NAMES.indexOf(normalizeTier(scopeTier));
  if (index < 0 || index >= ORDERED_TIER_NAMES.length - 1) return '';
  return ORDERED_TIER_NAMES[index + 1];
}

function deriveDeterminismLevel(scopeTier) {
  const tier = normalizeTier(scopeTier);
  if (tier === 'leaf') return 'mechanical';
  if (tier === 'task') return 'high';
  if (tier === 'project') return 'medium';
  return 'low';
}

function deriveCostPreference(scopeTier, determinismLevel, openQuestionCount = 0) {
  const tier = normalizeTier(scopeTier);
  const determinism = normalizeDeterminismLevel(determinismLevel);
  if (tier === 'leaf' || determinism === 'mechanical') return 'free';
  if (tier === 'task' || determinism === 'high' || openQuestionCount > 1) return 'low';
  if (tier === 'project') return 'balanced';
  return 'balanced';
}

function deriveCapabilityFloor(scopeTier, determinismLevel) {
  const tier = normalizeTier(scopeTier);
  const determinism = normalizeDeterminismLevel(determinismLevel);
  if (tier === 'leaf' || determinism === 'mechanical') return 'mechanical';
  if (tier === 'task' || determinism === 'high') return 'narrow';
  if (tier === 'project' || determinism === 'medium') return 'narrowing';
  return 'broad';
}

function deriveDecompositionState(openQuestionCount, childWorkOrderCount, threeStepPlanCount) {
  if (threeStepPlanCount === 3 && openQuestionCount === 0 && childWorkOrderCount === 0) return 'ready';
  if (openQuestionCount > 0) return 'fan-out';
  if (childWorkOrderCount > 0) return 'fan-in';
  if (threeStepPlanCount === 3) return 'ready';
  return 'blocked';
}

function buildAggregationContract(input) {
  const data = normalizeInputObject(input);
  const contract = cloneObject(data) || cloneObject(DEFAULT_AGGREGATION_CONTRACT);
  if (!contract.kind) contract.kind = DEFAULT_AGGREGATION_CONTRACT.kind;
  if (!contract.merge_strategy) contract.merge_strategy = DEFAULT_AGGREGATION_CONTRACT.merge_strategy;
  if (!Array.isArray(contract.required_fields) || contract.required_fields.length === 0) {
    contract.required_fields = DEFAULT_AGGREGATION_CONTRACT.required_fields.slice();
  }
  if (!Array.isArray(contract.notes) || contract.notes.length === 0) {
    contract.notes = DEFAULT_AGGREGATION_CONTRACT.notes.slice();
  }
  if (!Array.isArray(contract.optional_fields)) {
    contract.optional_fields = DEFAULT_AGGREGATION_CONTRACT.optional_fields.slice();
  }
  return contract;
}

function normalizeInputObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactCommand(order) {
  const workstreamScope = normalizeText(order?.workstream?.scope);
  const parentScope = normalizeText(order?.parent?.scope);
  const branchTarget = normalizeText(order?.branch?.target_branch);
  const actor = normalizeText(order?.actor?.target);
  const transport = normalizeTransport(order?.routing?.transport || order?.actor?.transport);
  const parts = [
    '/recursive-actor-work-order',
    `critical=${compactValue(order?.critical_ref)}`,
    `conversation=${compactValue(order?.conversation_ref)}`,
    `prompt=${compactValue(order?.prompt_ref)}`,
    `workstream=${compactValue(workstreamScope)}`,
    `parent=${compactValue(parentScope)}`,
    `branch=${compactValue(branchTarget)}`,
    `actor=${compactValue(actor)}/${compactValue(transport)}`,
    `floor=${compactValue(order?.routing?.capability_floor)}`,
    `cost=${compactValue(order?.routing?.cost_priority)}`,
    `task=${compactValue(order?.task?.summary)}`
  ];

  if (order?.routing?.api_allowed === true) {
    parts.push('api=1');
  }

  return parts.join(' ');
}

function normalizeWorkstream(input) {
  const data = normalizeInputObject(input);
  const scope = normalizeText(data.scope || data.workstream_scope || data.workstreamScope);
  const scopeTier = normalizeTier(data.scope_tier || data.scopeTier || data.workflow_scope_tier);
  const normalized = {};

  if (scope) normalized.scope = scope;
  if (scopeTier) normalized.scope_tier = scopeTier;

  return normalized;
}

function normalizeParent(input) {
  const data = normalizeInputObject(input);
  const scope = normalizeText(data.scope || data.parent_scope || data.workflow_scope);
  const scopeTier = normalizeTier(data.scope_tier || data.scopeTier || data.parent_scope_tier);
  const normalized = {};

  if (scope) normalized.scope = scope;
  if (scopeTier) normalized.scope_tier = scopeTier;

  return normalized;
}

function normalizeDelegation(input, workstream) {
  const data = normalizeInputObject(input);
  const childScope = normalizeText(data.child_scope || data.scope || workstream.scope);
  const childScopeTier = normalizeTier(data.child_scope_tier || data.scope_tier || workstream.scope_tier);
  const childWriteSet = normalizeList(data.child_write_set || data.write_set || []);
  const normalized = {};

  if (childScope) normalized.child_scope = childScope;
  if (childScopeTier) normalized.child_scope_tier = childScopeTier;
  if (typeof data.child_depth_budget === 'number' && Number.isInteger(data.child_depth_budget)) {
    normalized.child_depth_budget = data.child_depth_budget;
  }
  if (normalizeText(data.child_authority)) normalized.child_authority = normalizeText(data.child_authority);
  if (childWriteSet.length > 0) normalized.child_write_set = childWriteSet;

  return normalized;
}

function normalizeCustody(input) {
  const data = normalizeInputObject(input);
  const writeSet = normalizeList(data.write_set || data.allowed_write_set || []);
  const forbiddenSurfaces = normalizeList(data.forbidden_surfaces || []);
  const normalized = {};

  if (normalizeText(data.owner)) normalized.owner = normalizeText(data.owner);
  if (normalizeText(data.held_by || data.holder)) normalized.held_by = normalizeText(data.held_by || data.holder);
  if (writeSet.length > 0) normalized.write_set = writeSet;
  if (forbiddenSurfaces.length > 0) normalized.forbidden_surfaces = forbiddenSurfaces;

  return normalized;
}

function normalizeEvidence(input) {
  const data = normalizeInputObject(input);
  const references = normalizeList(data.references || data.refs || []);
  const locations = normalizeList(data.locations || data.evidence_locations || []);
  const normalized = {};

  if (references.length > 0) normalized.references = references;
  if (locations.length > 0) normalized.locations = locations;

  return normalized;
}

function normalizeOpenQuestions(input) {
  const data = normalizeInputObject(input);
  return normalizeList(data.open_questions || data.openQuestions || []);
}

function normalizeThreeStepPlan(input) {
  const data = normalizeInputObject(input);
  return normalizeList(data.three_step_plan || data.threeStepPlan || []);
}

function normalizeBranch(input) {
  const data = normalizeInputObject(input);
  const referenceSet = normalizeList(data.reference_set || data.branch_reference_set || []);
  const targetBranch = normalizeText(data.target_branch || data.branch || data.name);
  const groundingState = normalizeText(data.grounding_state || data.branch_grounding_state).toLowerCase();
  const githubConnectorAvailable = data.github_connector_available === true || data.githubConnectorAvailable === true;
  const summary = normalizeText(data.grounding_summary || data.branch_grounding_summary);
  const normalized = {};

  if (targetBranch) normalized.target_branch = targetBranch;
  if (referenceSet.length > 0) normalized.reference_set = referenceSet;
  if (summary) normalized.grounding_summary = summary;
  if (['live', 'unverified', 'assumed'].includes(groundingState)) normalized.grounding_state = groundingState;

  if (githubConnectorAvailable) {
    normalized.github_connector_available = true;
  } else if (data.github_connector_available === false || data.githubConnectorAvailable === false) {
    normalized.github_connector_available = false;
  }

  return normalized;
}

function normalizeTask(input) {
  const data = normalizeInputObject(input);
  const normalized = {};

  if (normalizeText(data.summary || data.task)) normalized.summary = normalizeText(data.summary || data.task);
  if (normalizeText(data.objective)) normalized.objective = normalizeText(data.objective);
  if (normalizeText(data.command)) normalized.command = normalizeText(data.command);

  return normalized;
}

function normalizeActor(input) {
  const data = normalizeInputObject(input);
  const normalized = {
    role: normalizeText(data.role || data.actor_role || data.actorRole),
    target: normalizeText(data.target || data.actor || data.recipient),
    transport: normalizeTransport(data.transport || data.route_transport),
    model: normalizeText(data.model || '')
  };

  if (normalizeText(data.kind)) normalized.kind = normalizeText(data.kind);
  if (normalizeText(data.launch_contract)) normalized.launch_contract = normalizeText(data.launch_contract);

  return normalized;
}

function normalizeRouting(input, workstreamTier, actor, opts = {}) {
  const data = normalizeInputObject(input);
  const routingScopeTier = normalizeTier(data.scope_tier || data.scopeTier || workstreamTier);
  const openQuestionCount = Number.isInteger(opts.open_question_count) ? opts.open_question_count : 0;
  const deterministicLevel = normalizeDeterminismLevel(
    opts.determinism_level || data.determinism_level || deriveDeterminismLevel(routingScopeTier)
  ) || deriveDeterminismLevel(routingScopeTier);
  const costPreference = normalizeCostPreference(
    opts.cost_preference || data.cost_preference || deriveCostPreference(routingScopeTier, deterministicLevel, openQuestionCount)
  ) || deriveCostPreference(routingScopeTier, deterministicLevel, openQuestionCount);
  const capabilityFloor = normalizeText(
    opts.capability_floor || data.capability_floor || deriveCapabilityFloor(routingScopeTier, deterministicLevel)
  ) || deriveCapabilityFloor(routingScopeTier, deterministicLevel);
  const localTinyAvailable = data.local_tiny_available === true || data.localTinyAvailable === true;
  const raspiAvailable = data.raspi_available === true || data.raspiAvailable === true;
  const selectedTransport = normalizeTransport(data.transport || actor.transport);
  const apiRouterRequested = selectedTransport === 'api-router' || normalizeText(data.provider).toLowerCase() === 'openrouter';
  const scopeTierPolicy = getScopeTierPolicy(routingScopeTier);
  const baseTransportPreference = Array.isArray(scopeTierPolicy && scopeTierPolicy.transport_preference)
    ? scopeTierPolicy.transport_preference.slice()
    : ['local-cli', 'local-model', 'api', 'api-router'];
  const transportPreference = baseTransportPreference.includes('api-router')
    ? baseTransportPreference
    : baseTransportPreference.concat(['api-router']);

  if (apiRouterRequested) {
    const selectedModel = normalizeText(data.model || actor.model || '');
    return {
      scope_tier: routingScopeTier,
      scope_tier_rank: scopeTierPolicy ? scopeTierPolicy.rank : null,
      child_depth_budget: scopeTierPolicy ? scopeTierPolicy.child_depth_budget : null,
      transport: 'api-router',
      provider: 'openrouter',
      api_allowed: data.api_allowed === true || data.apiAllowed === true,
      capability_floor: capabilityFloor,
      smallest_sufficient_local_class: 'api-router',
      local_tiny_available: localTinyAvailable,
      raspi_available: raspiAvailable,
      cost_priority: costPreference,
      selection_precedence: SELECTION_PRECEDENCE.slice(),
      selected_as_cheapest_sufficient: false,
      rejected_overqualified_options: [],
      model_class: scopeTierPolicy ? scopeTierPolicy.model_class : 'narrowing',
      preferred_transport: 'api-router',
      prefers_logged_in_before_api: false,
      transport_preference: transportPreference,
      model: selectedModel,
      selected_model: selectedModel,
      model_downshift_reason: 'OpenRouter is represented as a data-only API-router lane; local/logged-in/free lanes are preferred before it unless policy overrides.'
    };
  }

  const route = resolveRecursiveBridgeRoute(actor.target, {
    transport: selectedTransport || undefined,
    scope_tier: routingScopeTier || undefined,
    model: data.model || actor.model || '',
    risk_tier: costPreference === 'free' || costPreference === 'low' || deterministicLevel === 'high' || deterministicLevel === 'mechanical'
      ? 'low'
      : 'medium',
    task_shape: deterministicLevel === 'mechanical' ? 'mechanical verification' : '',
    cost_priority: costPreference
  });
  const targetPolicy = getBridgeTargetPolicy(actor.target);
  const currentModels = Array.isArray(targetPolicy && targetPolicy.transports && targetPolicy.transports[route.transport] && targetPolicy.transports[route.transport].current_models)
    ? targetPolicy.transports[route.transport].current_models.slice()
    : [];
  const selectedModelIndex = currentModels.indexOf(route.model);
  const rejectedOverqualifiedOptions = selectedModelIndex > 0
    ? currentModels.slice(0, selectedModelIndex)
    : [];
  const smallestLocalClass = capabilityFloor === 'broad'
    ? 'frontier'
    : (raspiAvailable && capabilityFloor === 'mechanical'
      ? 'raspi'
      : (localTinyAvailable && (capabilityFloor === 'mechanical' || capabilityFloor === 'narrow')
        ? 'local-tiny'
        : (route.transport === 'local-model'
          ? 'local-model'
          : 'logged-in')));

  return {
    scope_tier: route.routing.scope_tier || routingScopeTier,
    scope_tier_rank: route.routing.scope_tier_rank,
    child_depth_budget: route.routing.child_depth_budget,
    transport: route.transport,
    api_allowed: data.api_allowed === true || data.apiAllowed === true,
    capability_floor: capabilityFloor,
    smallest_sufficient_local_class: smallestLocalClass,
    local_tiny_available: localTinyAvailable,
    raspi_available: raspiAvailable,
    cost_priority: costPreference,
    selection_precedence: SELECTION_PRECEDENCE.slice(),
    selected_as_cheapest_sufficient: true,
    rejected_overqualified_options: rejectedOverqualifiedOptions,
    model_class: route.routing.model_class,
    preferred_transport: route.routing.preferred_transport,
    prefers_logged_in_before_api: route.routing.prefers_logged_in_before_api,
    transport_preference: Array.isArray(route.routing.transport_preference)
      ? route.routing.transport_preference.slice()
      : transportPreference,
    model: route.model,
    selected_model: route.model,
    model_downshift_reason: route.model
      ? (route.model.includes('flash')
        ? `Selected the cheapest sufficient current model for scope_tier=${routingScopeTier} with cost_preference=${costPreference}, determinism_level=${deterministicLevel}, and smallest_sufficient_local_class=${smallestLocalClass}.`
        : `Kept the frontier-capable model because scope_tier=${routingScopeTier}, determinism_level=${deterministicLevel}, and capability_floor=${capabilityFloor} still require it.`)
      : `Route is model-free; cheapest sufficient lane was selected without a bound model and smallest_sufficient_local_class=${smallestLocalClass}.`
  };
}

function buildDefaultReturnContract() {
  return cloneObject(DEFAULT_RETURN_CONTRACT);
}

/**
 * validateActorReturn — Layer 2 (S2) MECHANICAL enforcer of the worker-return
 * contract. Codex review: parent_impact + bubble_up_gate were prose policy, not
 * enforced. This makes them enforced: a return is invalid unless it carries the
 * required fields AND its bubble_up_gate is a legal taxonomy value.
 *
 * The structural property this buys: a worker CANNOT bubble a question up to the
 * human without naming one of the seven gates. bubble_up_gate='none' means the
 * work resolved locally. Anything else must be a real gate from S0.
 *
 * @param {object} payload - the worker's return object
 * @param {object} [opts]
 * @param {string[]} [opts.requiredFields] - override required fields (defaults to the contract's)
 * @returns {{ valid: boolean, errors: string[], bubbles_up: boolean }}
 */
function validateActorReturn(payload, opts = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Actor return must be a single object.'], bubbles_up: false };
  }

  const required = Array.isArray(opts.requiredFields) && opts.requiredFields.length
    ? opts.requiredFields
    : DEFAULT_RETURN_CONTRACT.required_fields;

  for (const field of required) {
    const value = payload[field];
    const empty = value == null
      || (typeof value === 'string' && value.trim() === '')
      || (Array.isArray(value) && value.length === 0);
    if (empty) errors.push(`Actor return is missing required field: ${field}.`);
  }

  // bubble_up_gate must be a legal taxonomy value (one of the seven, or 'none').
  if (payload.bubble_up_gate != null && !isValidGate(payload.bubble_up_gate)) {
    errors.push(`bubble_up_gate must be 'none' or one of: ${GATE_IDS.join(', ')}.`);
  }

  if (COMPLETED_STATUSES.has(String(payload.status || '').trim().toLowerCase())) {
    // A completion receipt's scope identifies the delegated/child work, which
    // may intentionally differ from the parent's own scope identity. Forward
    // both, and let validateDelegatedCompletionReceipt prefer the delegated
    // scope (opts.scope) over the parent's own scope (opts.parentScope) when
    // comparing against receipt.scope. Codex review, PR #18.
    const completion = validateDelegatedCompletionReceipt(payload, {
      scope: opts.scope,
      parentScope: opts.parentScope,
      criteria: opts.acceptanceCriteria || opts.criteria
    });
    errors.push(...completion.errors.map(error => `completion receipt: ${error}`));
  }

  return {
    valid: errors.length === 0,
    errors,
    bubbles_up: isBubbleUpGate(payload.bubble_up_gate)
  };
}

function validateChildWriteSet(childWriteSet, parentWriteSet) {
  const parent = new Set(normalizeList(parentWriteSet));
  const child = normalizeList(childWriteSet);
  const extra = child.filter((entry) => !parent.has(entry));
  return {
    valid: extra.length === 0,
    extra
  };
}

function createRecursiveActorWorkOrder(fields) {
  const input = normalizeInputObject(fields);
  const routingInput = normalizeInputObject(input.routing || input);
  const criticalRef = normalizeText(input.critical_ref || input.criticalRef);
  const conversationRef = normalizeText(input.conversation_ref || input.conversationRef);
  const promptRef = normalizeText(input.prompt_ref || input.promptRef);
  const workstream = normalizeWorkstream(input.workstream || input.workstreamScope || input);
  const parent = normalizeParent(input.parent || input.parentScope || input);
  const actorInput = normalizeInputObject(input.actor || input.actorSpec || input);
  if (!normalizeTransport(actorInput.transport)) {
    actorInput.transport = normalizeTransport(routingInput.transport) || 'local-cli';
  }
  const actor = normalizeActor(actorInput);
  const delegation = normalizeDelegation(input.delegation || input, workstream);
  const custody = normalizeCustody(input.custody || input);
  const task = normalizeTask(input.task || input);
  const evidence = normalizeEvidence(input.evidence || input);
  const branch = normalizeBranch(input.branch || input);
  const openQuestions = normalizeOpenQuestions(input);
  const threeStepPlan = normalizeThreeStepPlan(input);
  const aggregationContract = buildAggregationContract(input.aggregation_contract || input.aggregationContract);
  const determinismLevel = normalizeDeterminismLevel(
    input.determinism_level || input.determinismLevel || deriveDeterminismLevel(workstream.scope_tier)
  ) || deriveDeterminismLevel(workstream.scope_tier);
  const costPreference = normalizeCostPreference(
    input.cost_preference || input.costPreference || deriveCostPreference(workstream.scope_tier, determinismLevel, openQuestions.length)
  ) || deriveCostPreference(workstream.scope_tier, determinismLevel, openQuestions.length);
  const stopConditions = normalizeList(input.stop_conditions || input.stopConditions);
  const returnContract = cloneObject(input.return_contract || input.returnContract) || buildDefaultReturnContract();

  if (!criticalRef) throw new Error('RecursiveActorWorkOrder requires critical_ref');
  if (!conversationRef) throw new Error('RecursiveActorWorkOrder requires conversation_ref');
  if (!promptRef) throw new Error('RecursiveActorWorkOrder requires prompt_ref');
  if (!workstream.scope) throw new Error('RecursiveActorWorkOrder requires workstream.scope');
  if (!workstream.scope_tier) throw new Error('RecursiveActorWorkOrder requires workstream.scope_tier');
  if (!parent.scope) throw new Error('RecursiveActorWorkOrder requires parent.scope');
  if (!parent.scope_tier) throw new Error('RecursiveActorWorkOrder requires parent.scope_tier');
  if (!actor.role) throw new Error('RecursiveActorWorkOrder requires actor.role');
  if (!actor.target) throw new Error('RecursiveActorWorkOrder requires actor.target');
  if (!actor.transport) throw new Error('RecursiveActorWorkOrder requires actor.transport');
  if (!custody.owner) throw new Error('RecursiveActorWorkOrder requires custody.owner');
  if (!custody.held_by) throw new Error('RecursiveActorWorkOrder requires custody.held_by');
  if (!custody.write_set || custody.write_set.length === 0) throw new Error('RecursiveActorWorkOrder requires custody.write_set');
  if (!custody.forbidden_surfaces || custody.forbidden_surfaces.length === 0) throw new Error('RecursiveActorWorkOrder requires custody.forbidden_surfaces');
  if (!task.summary) throw new Error('RecursiveActorWorkOrder requires task.summary');
  if (!evidence.references || evidence.references.length === 0) throw new Error('RecursiveActorWorkOrder requires evidence.references');
  if (!evidence.locations || evidence.locations.length === 0) throw new Error('RecursiveActorWorkOrder requires evidence.locations');
  if (!branch.target_branch) throw new Error('RecursiveActorWorkOrder requires branch.target_branch');
  if (!branch.reference_set || branch.reference_set.length === 0) throw new Error('RecursiveActorWorkOrder requires branch.reference_set');
  if (!branch.grounding_state) throw new Error('RecursiveActorWorkOrder requires branch.grounding_state');
  if (!branch.grounding_summary) throw new Error('RecursiveActorWorkOrder requires branch.grounding_summary');

  if (openQuestions.length > 0 && normalizeTier(workstream.scope_tier) === 'leaf') {
    throw new Error('RecursiveActorWorkOrder cannot fan out further at leaf scope');
  }

  if (branch.github_connector_available === true && branch.grounding_state !== 'live') {
    throw new Error('RecursiveActorWorkOrder requires live GitHub grounding when the connector is available');
  }
  if (branch.github_connector_available !== true && branch.grounding_state === 'live') {
    throw new Error('RecursiveActorWorkOrder marks branch claims unverified when GitHub grounding is unavailable');
  }
  if (branch.github_connector_available === true && !/live GitHub grounding|verified/i.test(branch.grounding_summary)) {
    throw new Error('RecursiveActorWorkOrder branch_grounding_summary must record live GitHub grounding when the connector is available');
  }
  if (branch.github_connector_available !== true && !/unverified|assum/i.test(branch.grounding_summary)) {
    throw new Error('RecursiveActorWorkOrder branch_grounding_summary must mark assumptions unverified when GitHub grounding is unavailable');
  }

  const scopeComparison = compareScopeTiers(parent.scope_tier, workstream.scope_tier);
  if (!scopeComparison.valid) {
    throw new Error(`RecursiveActorWorkOrder requires a narrower child scope tier: ${scopeComparison.reason}`);
  }

  if (!delegation.child_scope) delegation.child_scope = workstream.scope;
  if (!delegation.child_scope_tier) delegation.child_scope_tier = workstream.scope_tier;
  if (delegation.child_scope_tier !== workstream.scope_tier) {
    throw new Error('RecursiveActorWorkOrder requires delegation.child_scope_tier to match workstream.scope_tier');
  }
  if (!Number.isInteger(delegation.child_depth_budget)) {
    const tierPolicy = getScopeTierPolicy(workstream.scope_tier);
    delegation.child_depth_budget = tierPolicy ? tierPolicy.child_depth_budget : null;
  }
  if (!normalizeText(delegation.child_authority)) {
    delegation.child_authority = 'narrower-than-parent';
  }
  if (!Array.isArray(delegation.child_write_set) || delegation.child_write_set.length === 0) {
    delegation.child_write_set = custody.write_set.slice();
  }

  const writeSetCheck = validateChildWriteSet(delegation.child_write_set, custody.write_set);
  if (!writeSetCheck.valid) {
    throw new Error(`RecursiveActorWorkOrder child write set escapes parent custody write set: ${writeSetCheck.extra.join(', ')}`);
  }

  const routing = normalizeRouting(routingInput, workstream.scope_tier, actor, {
    cost_preference: costPreference,
    determinism_level: determinismLevel,
    open_question_count: openQuestions.length,
    capability_floor: deriveCapabilityFloor(workstream.scope_tier, determinismLevel)
  });
  if (routing.scope_tier !== workstream.scope_tier) {
    throw new Error('RecursiveActorWorkOrder requires routing.scope_tier to match workstream.scope_tier');
  }
  if ((routing.transport === 'api' || routing.transport === 'api-router') && routing.api_allowed !== true) {
    throw new Error('RecursiveActorWorkOrder requires routing.api_allowed=true before selecting api or api-router transport');
  }
  if (routing.transport === 'api-router' && routing.provider !== 'openrouter') {
    throw new Error('RecursiveActorWorkOrder requires routing.provider=openrouter for api-router transport');
  }

  actor.transport = routing.transport;
  actor.model = routing.model;
  actor.kind = actor.kind || (routing.prefers_logged_in_before_api ? 'logged-in-agent' : routing.transport === 'api-router' ? 'api-router-agent' : 'agent');
  actor.launch_contract = actor.launch_contract || routeLaunchContractForActor(actor.target, routing.transport);

  if (!task.command) {
    task.command = compactCommand({
      critical_ref: criticalRef,
      conversation_ref: conversationRef,
      prompt_ref: promptRef,
      workstream,
      parent,
      actor,
      routing,
      task,
      delegation,
      custody,
      branch
    });
  }

  const childWorkOrdersInput = normalizeMaybeList(input.child_work_orders || input.childWorkOrders);
  const childWorkOrders = childWorkOrdersInput.length > 0
    ? childWorkOrdersInput.map((childInput) => createRecursiveActorWorkOrder({
      ...childInput,
      critical_ref: childInput.critical_ref || criticalRef,
      conversation_ref: childInput.conversation_ref || conversationRef,
      prompt_ref: childInput.prompt_ref || promptRef,
      branch: childInput.branch || branch,
      custody: childInput.custody || {
        owner: custody.owner,
        held_by: custody.held_by,
        write_set: custody.write_set.slice(),
        forbidden_surfaces: custody.forbidden_surfaces.slice()
      },
      parent: childInput.parent || {
        scope: workstream.scope,
        scope_tier: workstream.scope_tier
      },
      open_questions: childInput.open_questions || [],
      child_work_orders: childInput.child_work_orders || [],
      aggregation_contract: childInput.aggregation_contract || aggregationContract,
      cost_preference: childInput.cost_preference || costPreference,
      determinism_level: childInput.determinism_level || determinismLevel,
      ready_to_execute_when_three_steps: childInput.ready_to_execute_when_three_steps,
      fractal_until_executable: childInput.fractal_until_executable,
      three_step_plan: childInput.three_step_plan || [],
      stop_conditions: childInput.stop_conditions || stopConditions,
      evidence: childInput.evidence || evidence,
      delegation: childInput.delegation || {
        child_scope: childInput.workstream && childInput.workstream.scope ? childInput.workstream.scope : `${workstream.scope}::${normalizeText(childInput.task && childInput.task.summary) || 'child'}`,
        child_scope_tier: nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier,
        child_depth_budget: getScopeTierPolicy(nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier)?.child_depth_budget ?? 0,
        child_authority: 'narrower-than-parent',
        child_write_set: custody.write_set.slice()
      },
      workstream: childInput.workstream || {
        scope: `${workstream.scope}::${normalizeText(childInput.task && childInput.task.summary) || 'child'}`,
        scope_tier: nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier
      },
      task: childInput.task || {
        summary: normalizeText(childInput.task && childInput.task.summary) || normalizeText(childInput.summary) || 'child question',
        objective: normalizeText(childInput.objective) || 'resolve one narrower question'
      }
    }))
    : (openQuestions.length > 0
      ? openQuestions.map((question, index) => createRecursiveActorWorkOrder({
        critical_ref: criticalRef,
        conversation_ref: conversationRef,
        prompt_ref: promptRef,
        branch,
        custody: {
          owner: custody.owner,
          held_by: custody.held_by,
          write_set: custody.write_set.slice(),
          forbidden_surfaces: custody.forbidden_surfaces.slice()
        },
        parent: {
          scope: workstream.scope,
          scope_tier: workstream.scope_tier
        },
        open_questions: [],
        child_work_orders: [],
        aggregation_contract: aggregationContract,
        cost_preference: deriveCostPreference(nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier, determinismLevel, 0),
        determinism_level: deriveDeterminismLevel(nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier),
        model_downshift_reason: '',
        ready_to_execute_when_three_steps: true,
        fractal_until_executable: false,
        three_step_plan: [
          'answer the open question directly',
          'ground the answer in local evidence',
          'return the next-state candidate upward'
        ],
        stop_conditions: stopConditions,
        evidence,
        delegation: {
          child_scope: `${workstream.scope}::q${index + 1}`,
          child_scope_tier: nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier,
          child_depth_budget: getScopeTierPolicy(nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier)?.child_depth_budget ?? 0,
          child_authority: 'narrower-than-parent',
          child_write_set: custody.write_set.slice()
        },
        workstream: {
          scope: `${workstream.scope}::q${index + 1}`,
          scope_tier: nextNarrowerTier(workstream.scope_tier) || workstream.scope_tier
        },
        actor: {
          role: actor.role,
          target: actor.target,
          transport: routing.transport,
          model: routing.model
        },
        task: {
          summary: question,
          objective: `Resolve open question ${index + 1} and return the next state candidate`
        }
      }))
      : []);

  const readyThreeStepPlan = threeStepPlan.length === 3 && openQuestions.length === 0 && childWorkOrders.length === 0;

  const order = {
    schema: 'RecursiveActorWorkOrder/1.0',
    critical_ref: criticalRef,
    conversation_ref: conversationRef,
    prompt_ref: promptRef,
    workstream,
    parent,
    actor,
    routing,
    cost_preference: costPreference,
    determinism_level: determinismLevel,
    model_downshift_reason: routing.model_downshift_reason,
    open_questions: openQuestions,
    child_work_orders: childWorkOrders,
    aggregation_contract: aggregationContract,
    decomposition_state: deriveDecompositionState(openQuestions.length, childWorkOrders.length, threeStepPlan.length),
    three_step_plan: threeStepPlan,
    ready_to_execute_when_three_steps: readyThreeStepPlan,
    fractal_until_executable: !readyThreeStepPlan,
    delegation,
    task,
    custody,
    evidence,
    branch,
    stop_conditions: stopConditions.length > 0 ? stopConditions : DEFAULT_STOP_CONDITIONS.slice(),
    return_contract: returnContract
  };

  const validation = validateRecursiveActorWorkOrder(order);
  if (!validation.valid) {
    throw new Error(`Invalid RecursiveActorWorkOrder: ${validation.errors.join('; ')}`);
  }

  return order;
}

function routeLaunchContractForActor(target, transport) {
  if (normalizeTransport(transport) === 'api-router') {
    return 'openrouter api-router <prompt>';
  }
  const route = resolveRecursiveBridgeRoute(target, { transport });
  return route.launch_contract || '';
}

function buildRecursiveActorWorkOrder(fields) {
  return createRecursiveActorWorkOrder(fields);
}

function validateRecursiveActorWorkOrder(order) {
  const errors = validate(order, schema, { rootSchema: schema, path: '' }).map((error) => `${error.path || '/'} ${error.message}`.trim());

  if (!order || typeof order !== 'object') {
    return { valid: false, errors: ['RecursiveActorWorkOrder must be an object'] };
  }

  const criticalRef = normalizeText(order.critical_ref);
  const conversationRef = normalizeText(order.conversation_ref);
  const promptRef = normalizeText(order.prompt_ref);
  const workstream = normalizeInputObject(order.workstream);
  const parent = normalizeInputObject(order.parent);
  const actor = normalizeInputObject(order.actor);
  const routing = normalizeInputObject(order.routing);
  const delegation = normalizeInputObject(order.delegation);
  const custody = normalizeInputObject(order.custody);
  const task = normalizeInputObject(order.task);
  const evidence = normalizeInputObject(order.evidence);
  const branch = normalizeInputObject(order.branch);
  const aggregationContract = normalizeInputObject(order.aggregation_contract);
  const openQuestions = Array.isArray(order.open_questions) ? normalizeList(order.open_questions) : [];
  const childWorkOrders = Array.isArray(order.child_work_orders) ? order.child_work_orders : [];
  const threeStepPlan = Array.isArray(order.three_step_plan) ? normalizeList(order.three_step_plan) : [];
  const costPreference = normalizeCostPreference(order.cost_preference);
  const determinismLevel = normalizeDeterminismLevel(order.determinism_level);

  if (!criticalRef) errors.push('critical_ref must be a non-empty string');
  if (!conversationRef) errors.push('conversation_ref must be a non-empty string');
  if (!promptRef) errors.push('prompt_ref must be a non-empty string');

  const scopeComparison = compareScopeTiers(parent.scope_tier, workstream.scope_tier);
  if (!scopeComparison.valid) {
    errors.push(scopeComparison.reason);
  }

  if (delegation.child_scope_tier !== workstream.scope_tier) {
    errors.push('delegation.child_scope_tier must match workstream.scope_tier');
  }

  if (!Array.isArray(custody.write_set) || !Array.isArray(delegation.child_write_set)) {
    errors.push('custody.write_set and delegation.child_write_set must be arrays');
  } else {
    const childSet = normalizeList(delegation.child_write_set);
    const parentSet = normalizeList(custody.write_set);
    const extra = childSet.filter((entry) => !parentSet.includes(entry));
    if (extra.length > 0) {
      errors.push(`delegation.child_write_set escapes custody.write_set: ${extra.join(', ')}`);
    }
  }

  if (routing.api_allowed !== true && (routing.transport === 'api' || routing.transport === 'api-router')) {
    errors.push('routing.transport may be api or api-router only when routing.api_allowed is true');
  }
  if (routing.transport === 'api-router' && routing.provider !== 'openrouter') {
    errors.push('routing.transport api-router requires routing.provider=openrouter');
  }
  if (!Array.isArray(routing.selection_precedence) || routing.selection_precedence.join(',') !== SELECTION_PRECEDENCE.join(',')) {
    errors.push('routing.selection_precedence must preserve the router precedence order');
  }
  if (!normalizeText(routing.capability_floor)) {
    errors.push('routing.capability_floor must be set');
  }
  if (!normalizeText(routing.smallest_sufficient_local_class)) {
    errors.push('routing.smallest_sufficient_local_class must be set');
  }
  if (typeof routing.local_tiny_available !== 'boolean') {
    errors.push('routing.local_tiny_available must be a boolean');
  }
  if (typeof routing.raspi_available !== 'boolean') {
    errors.push('routing.raspi_available must be a boolean');
  }
  if (!normalizeCostPreference(routing.cost_priority)) {
    errors.push('routing.cost_priority must be one of: free, low, balanced, best_available');
  }
  if (typeof routing.selected_as_cheapest_sufficient !== 'boolean') {
    errors.push('routing.selected_as_cheapest_sufficient must be a boolean');
  }
  if (!Array.isArray(routing.rejected_overqualified_options)) {
    errors.push('routing.rejected_overqualified_options must be an array');
  }

  if (!task.command || typeof task.command !== 'string' || !task.command.trim()) {
    errors.push('task.command must be a non-empty compact command string');
  } else if (task.command.includes('\n')) {
    errors.push('task.command must remain a single-line compact command string');
  }

  if (!Array.isArray(order.stop_conditions) || order.stop_conditions.length === 0) {
    errors.push('stop_conditions must be a non-empty array');
  }

  if (!evidence.references || !Array.isArray(evidence.references) || evidence.references.length === 0) {
    errors.push('evidence.references must be a non-empty array');
  }

  if (!evidence.locations || !Array.isArray(evidence.locations) || evidence.locations.length === 0) {
    errors.push('evidence.locations must be a non-empty array');
  }
  if (!Array.isArray(openQuestions)) {
    errors.push('open_questions must be an array');
  }
  if (!Array.isArray(childWorkOrders)) {
    errors.push('child_work_orders must be an array');
  }
  if (!aggregationContract.kind || !aggregationContract.merge_strategy) {
    errors.push('aggregation_contract must include kind and merge_strategy');
  }
  if (!Array.isArray(aggregationContract.required_fields) || aggregationContract.required_fields.length === 0) {
    errors.push('aggregation_contract.required_fields must be a non-empty array');
  }
  if (!Array.isArray(aggregationContract.notes) || aggregationContract.notes.length === 0) {
    errors.push('aggregation_contract.notes must be a non-empty array');
  }
  if (!normalizeCostPreference(costPreference)) {
    errors.push('cost_preference must be one of: free, low, balanced, best_available');
  }
  if (!normalizeDeterminismLevel(determinismLevel)) {
    errors.push('determinism_level must be one of: low, medium, high, mechanical');
  }

  if (!branch.target_branch || typeof branch.target_branch !== 'string') {
    errors.push('branch.target_branch must be a non-empty string');
  }
  if (!Array.isArray(branch.reference_set) || branch.reference_set.length === 0) {
    errors.push('branch.reference_set must be a non-empty array');
  }
  if (!branch.grounding_summary || typeof branch.grounding_summary !== 'string') {
    errors.push('branch.grounding_summary must be a non-empty string');
  }
  if (!['live', 'unverified', 'assumed'].includes(branch.grounding_state)) {
    errors.push('branch.grounding_state must be live, unverified, or assumed');
  }
  if (branch.github_connector_available === true && branch.grounding_state !== 'live') {
    errors.push('branch claims must use live grounding when the GitHub connector is available');
  }
  if (branch.github_connector_available !== true && branch.grounding_state === 'live') {
    errors.push('branch claims must be marked unverified when GitHub grounding is unavailable');
  }

  if (!Array.isArray(threeStepPlan)) {
    errors.push('three_step_plan must be an array');
  }
  if (typeof order.ready_to_execute_when_three_steps !== 'boolean') {
    errors.push('ready_to_execute_when_three_steps must be a boolean');
  }
  if (typeof order.fractal_until_executable !== 'boolean') {
    errors.push('fractal_until_executable must be a boolean');
  }
  if (!['fan-out', 'fan-in', 'ready', 'blocked'].includes(order.decomposition_state)) {
    errors.push('decomposition_state must be fan-out, fan-in, ready, or blocked');
  }
  const readyThreeStepPlan = threeStepPlan.length === 3 && openQuestions.length === 0 && childWorkOrders.length === 0;
  if (readyThreeStepPlan && order.ready_to_execute_when_three_steps !== true) {
    errors.push('ready_to_execute_when_three_steps must be true when three_step_plan has exactly three steps and no unresolved fan-out/fan-in remains');
  }
  if (readyThreeStepPlan && order.fractal_until_executable === true) {
    errors.push('fractal_until_executable must be false when a branch is ready as a three-step executable plan');
  }
  if (!readyThreeStepPlan && order.ready_to_execute_when_three_steps === true) {
    errors.push('ready_to_execute_when_three_steps may only be true for a three-step plan with no open questions or child work orders');
  }
  if (openQuestions.length > 0 && order.decomposition_state !== 'fan-out') {
    errors.push('decomposition_state must be fan-out while open_questions are still being diffused');
  }
  if (openQuestions.length === 0 && childWorkOrders.length > 0 && order.decomposition_state !== 'fan-in') {
    errors.push('decomposition_state must be fan-in when child work orders are returning upward');
  }
  if (threeStepPlan.length === 3 && openQuestions.length === 0 && childWorkOrders.length === 0 && order.decomposition_state !== 'ready') {
    errors.push('decomposition_state must be ready when a branch is expressible as a clear three-step plan');
  }
  if (childWorkOrders.length > 0) {
    for (const child of childWorkOrders) {
      const childValidation = validateRecursiveActorWorkOrder(child);
      if (!childValidation.valid) {
        errors.push(`child_work_orders invalid: ${childValidation.errors.join('; ')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function renderRecursiveActorWorkOrderCommand(order) {
  if (!order || typeof order !== 'object') {
    throw new Error('RecursiveActorWorkOrder command rendering requires an order object');
  }

  return compactCommand(order);
}

module.exports = {
  DEFAULT_RETURN_CONTRACT,
  DEFAULT_STOP_CONDITIONS,
  buildRecursiveActorWorkOrder,
  createRecursiveActorWorkOrder,
  renderRecursiveActorWorkOrderCommand,
  validateRecursiveActorWorkOrder,
  validateActorReturn
};
