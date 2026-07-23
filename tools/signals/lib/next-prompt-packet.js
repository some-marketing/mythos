'use strict';

const { validate } = require('../../verify/lib/schema.cjs');
const NEXT_PROMPT_PACKET_SCHEMA = require('../schemas/next-prompt-packet.schema.json');
const { runHostStatePreflight } = require('../../preflight/host-state.cjs');

const VALID_NEXT_PROMPT_ROLES = Object.freeze([
  'worker',
  'reviewer',
  'bridge',
  'closeout',
  'handoff',
  'systemization-init'
]);

const RECURSIVE_ACTOR_WORK_ORDER_SCHEMA_VERSION = 'RecursiveActorWorkOrder/1.0';
const VALID_SCOPE_TIERS = Object.freeze(['system', 'client', 'project', 'task', 'leaf']);
const VALID_LOCAL_MODEL_CLASSES = Object.freeze(['frontier', 'logged-in', 'local-model', 'local-tiny', 'raspi', 'api-router']);
const VALID_WORK_ORDER_COST_PREFERENCES = Object.freeze(['free', 'low', 'balanced', 'best_available']);
const VALID_WORK_ORDER_DETERMINISM_LEVELS = Object.freeze(['low', 'medium', 'high', 'mechanical']);

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizeObjectArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => cloneObject(entry))
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
}

function normalizeRole(role) {
  const normalized = normalizeText(role).toLowerCase();
  return VALID_NEXT_PROMPT_ROLES.includes(normalized) ? normalized : '';
}

function normalizeScopeTier(scopeTier) {
  const normalized = normalizeText(scopeTier).toLowerCase();
  return VALID_SCOPE_TIERS.includes(normalized) ? normalized : '';
}

function normalizeLocalModelClass(modelClass) {
  const normalized = normalizeText(modelClass).toLowerCase();
  return VALID_LOCAL_MODEL_CLASSES.includes(normalized) ? normalized : '';
}

function normalizeWorkOrderCostPreference(costPreference) {
  const normalized = normalizeText(costPreference).toLowerCase();
  if (normalized === 'low-cost') return 'low';
  if (normalized === 'standard') return 'balanced';
  return VALID_WORK_ORDER_COST_PREFERENCES.includes(normalized) ? normalized : '';
}

function normalizeWorkOrderDeterminismLevel(determinismLevel) {
  const normalized = normalizeText(determinismLevel).toLowerCase();
  if (VALID_WORK_ORDER_DETERMINISM_LEVELS.includes(normalized)) return normalized;

  const numeric = Number(determinismLevel);
  if (!Number.isFinite(numeric)) return '';
  if (numeric >= 85) return 'mechanical';
  if (numeric >= 70) return 'high';
  if (numeric >= 50) return 'medium';
  return 'low';
}

function buildDefaultThreeStepPlan(exactNextCommand) {
  const command = normalizeText(exactNextCommand);
  if (!command) return [];
  return [
    'Load the declared workstream context and custody boundary.',
    `Run the exact next command: ${command}`,
    'Return evidence, blockers, and the next loop state.'
  ];
}

function deriveSummaryDecompositionState(openQuestionCount, childWorkOrderCount, readyThreeStepPlan) {
  if (readyThreeStepPlan) return 'ready';
  if (openQuestionCount > 0) return 'fan-out';
  if (childWorkOrderCount > 0) return 'fan-in';
  return 'blocked';
}

function deriveSummaryModelClass(scopeTier, determinismLevel) {
  if (scopeTier === 'leaf' || determinismLevel === 'mechanical') return 'mechanical';
  if (scopeTier === 'task' || determinismLevel === 'high') return 'narrow';
  if (scopeTier === 'project' || determinismLevel === 'medium') return 'narrowing';
  return 'broad';
}

function deriveSummarySmallestLocalClass(scopeTier, readyThreeStepPlan, raspiAvailable, localTinyAvailable) {
  if (readyThreeStepPlan || scopeTier === 'leaf') {
    if (raspiAvailable) return 'raspi';
    if (localTinyAvailable) return 'local-tiny';
    return 'local-model';
  }
  if (scopeTier === 'task') return localTinyAvailable ? 'local-tiny' : 'local-model';
  return 'frontier';
}

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : null;
}

function normalizeScopeIdentity(scopeIdentity) {
  if (!scopeIdentity || typeof scopeIdentity !== 'object' || Array.isArray(scopeIdentity)) {
    return null;
  }

  const normalized = {};
  const workstreamScope = normalizeText(scopeIdentity.workstream_scope);
  const workflowScope = normalizeText(scopeIdentity.workflow_scope || scopeIdentity.scope || workstreamScope);
  const sessionId = normalizeText(scopeIdentity.session_id);
  const sessionOrRunId = normalizeText(scopeIdentity.session_or_run_id);
  const executionId = normalizeText(scopeIdentity.execution_id);
  const signalId = normalizeText(scopeIdentity.signal_id);
  const actorId = normalizeText(scopeIdentity.actor_id);
  const owner = normalizeText(scopeIdentity.owner);
  const workingSurfaceValue = scopeIdentity.working_surface;
  const workingSurface = typeof workingSurfaceValue === 'string'
    ? normalizeText(workingSurfaceValue)
    : cloneObject(workingSurfaceValue);
  const custodyHierarchy = cloneObject(scopeIdentity.custody_hierarchy);
  const ownedArtifacts = normalizeList(scopeIdentity.owned_artifacts);
  const forbiddenArtifacts = normalizeList(scopeIdentity.forbidden_artifacts);

  if (workstreamScope) normalized.workstream_scope = workstreamScope;
  if (workflowScope) normalized.workflow_scope = workflowScope;
  if (normalizeText(scopeIdentity.scope)) normalized.scope = normalizeText(scopeIdentity.scope);
  if (sessionId) normalized.session_id = sessionId;
  if (sessionOrRunId) normalized.session_or_run_id = sessionOrRunId;
  if (executionId) normalized.execution_id = executionId;
  if (signalId) normalized.signal_id = signalId;
  if (actorId) normalized.actor_id = actorId;
  if (owner) normalized.owner = owner;
  if (workingSurface) normalized.working_surface = workingSurface;
  if (custodyHierarchy) normalized.custody_hierarchy = custodyHierarchy;
  if (ownedArtifacts.length > 0) normalized.owned_artifacts = ownedArtifacts;
  if (forbiddenArtifacts.length > 0) normalized.forbidden_artifacts = forbiddenArtifacts;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeGroundingPosture(groundingPosture, opts = {}) {
  const provided = cloneObject(groundingPosture) || {};
  const mode = normalizeText(provided.mode || opts.grounding_mode || 'none') || 'none';
  const interpretivePosture = normalizeText(
    provided.interpretive_posture
      || provided.posture
      || (mode === 'none' ? 'none' : 'advisory')
  ) || 'advisory';
  const files = normalizeList(provided.files);
  const notes = normalizeList(provided.notes);

  const normalized = {
    mode,
    interpretive_posture: interpretivePosture,
    advisory_only: provided.advisory_only === undefined ? true : Boolean(provided.advisory_only),
    summary: normalizeText(
      provided.summary
      || (mode === 'none'
        ? 'No grounding substrate supplied for this packet.'
        : `Grounding posture is ${interpretivePosture} and must not override local artifacts.`)
    ),
    files,
    notes
  };

  return normalized;
}

function normalizeLocalModelPreflightSummary(summary, opts = {}) {
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    const hostState = summary.host_state && typeof summary.host_state === 'object' && !Array.isArray(summary.host_state)
      ? cloneObject(summary.host_state)
      : null;
    return {
      status: ['not_applicable', 'passed', 'warned', 'blocked', 'unknown'].includes(summary.status)
        ? summary.status
        : 'unknown',
      summary: normalizeText(summary.summary || 'Local-model preflight summary provided.'),
      observed_at: normalizeText(summary.observed_at),
      host_state: hostState,
      blockers: normalizeList(summary.blockers),
      warnings: normalizeList(summary.warnings),
      notes: normalizeList(summary.notes)
    };
  }

  if (opts.include_host_preflight === true) {
    const host = runHostStatePreflight();
    const status = host.ok ? 'passed' : 'blocked';
    const notes = [];
    if (host.warnings.length > 0) {
      notes.push(`host warnings: ${host.warnings.join('; ')}`);
    }
    if (host.blockers.length > 0) {
      notes.push(`host blockers: ${host.blockers.join('; ')}`);
    }
    return {
      status,
      summary: host.ok
        ? 'Host-state preflight passed and does not currently block local-model work.'
        : 'Host-state preflight reported blockers for local-model work.',
      observed_at: host.timestamp,
      host_state: host,
      blockers: host.blockers.slice(),
      warnings: host.warnings.slice(),
      notes
    };
  }

  return {
    status: 'not_applicable',
    summary: 'No local-model preflight summary was supplied for this packet.',
    observed_at: '',
    host_state: null,
    blockers: [],
    warnings: [],
    notes: ['Local-model preflight was not requested by the packet builder.']
  };
}

function buildExactReturnContract(role, opts = {}) {
  const exactRole = normalizeRole(role);
  const baseNotes = [
    'Return one structured object only.',
    'Do not mix analysis prose with the structured return contract.',
    'Keep evidence references exact and local to the declared workstream.'
  ];

  switch (exactRole) {
    case 'worker':
      return {
        kind: 'worker-return/1.0',
        delivery: 'single JSON object with findings-first worker closeout',
        required_fields: [
          'status',
          'observations',
          'changed_files',
          'tests',
          'expected_evidence',
          'evidence_locations',
          'blockers',
          'closeout_owner',
          'next_command'
        ],
        optional_fields: ['notes', 'advisory_notes', 'scope_identity'],
        blocked_when_missing: ['workstream_scope', 'write_set', 'forbidden_surfaces'],
        notes: baseNotes.concat([
          'Worker output should preserve the bounded write set and the exact next command.',
          'If blocked, report the blocker rather than inventing partial completion.'
        ])
      };
    case 'reviewer':
      return {
        kind: 'reviewer-return/1.0',
        delivery: 'single JSON object with findings, severity, and verdict',
        required_fields: [
          'verdict',
          'findings',
          'evidence_locations',
          'open_questions',
          'review_lane',
          'next_command'
        ],
        optional_fields: ['summary', 'caveats', 'scope_identity'],
        blocked_when_missing: ['target_artifacts', 'review_lane'],
        notes: baseNotes.concat([
          'Reviewer output should classify findings by severity and cite evidence locations.',
          'Do not convert review findings into repair instructions inside the review artifact.'
        ])
      };
    case 'bridge':
      return {
        kind: 'bridge-return/1.0',
        delivery: 'single JSON object with lane selection, trust posture, and exact authority text',
        required_fields: [
          'lane',
          'findings',
          'evidence_locations',
          'trust_rules',
          'grounding_posture',
          'exact_next_command'
        ],
        optional_fields: ['budget', 'risk_notes', 'scope_identity'],
        blocked_when_missing: ['review_lane', 'grounding_posture'],
        notes: baseNotes.concat([
          'Bridge output should preserve the exact authority boundary and the requested lane.',
          'Trust posture is advisory information, not authority.'
        ])
      };
    case 'closeout':
      return {
        kind: 'closeout-return/1.0',
        delivery: 'single JSON object with closeout truth and handoff state',
        required_fields: [
          'closeout_state',
          'evidence_locations',
          'handoff_path',
          'remaining_blockers',
          'next_command'
        ],
        optional_fields: ['debrief_summary', 'scope_identity'],
        blocked_when_missing: ['closeout_owner', 'evidence_locations'],
        notes: baseNotes.concat([
          'Closeout output should say whether the workstream is actually complete or blocked.',
          'If not complete, preserve the exact repair or handoff boundary.'
        ])
      };
    case 'handoff':
      return {
        kind: 'handoff-return/1.0',
        delivery: 'single JSON object with transfer-of-custody summary and next command',
        required_fields: [
          'handoff_state',
          'summary',
          'evidence_locations',
          'ownership_transfer',
          'exact_next_command'
        ],
        optional_fields: ['remaining_risks', 'scope_identity'],
        blocked_when_missing: ['closeout_owner', 'workstream_scope'],
        notes: baseNotes.concat([
          'Handoff output should preserve custody and the exact next command.',
          'If the next command is not exact, the handoff is incomplete.'
        ])
      };
    case 'systemization-init':
      return {
        kind: 'systemization-init-return/1.0',
        delivery: 'single JSON object with advisory systemization proposal',
        required_fields: [
          'candidate_state',
          'advisory_not_authority',
          'rationale',
          'evidence_locations',
          'proposed_next_command'
        ],
        optional_fields: ['scope_identity', 'systemization_notes'],
        blocked_when_missing: ['advisory_not_authority', 'workstream_scope'],
        notes: baseNotes.concat([
          'Systemization-init packets are advisory only and must not self-authorize promotion or execution.',
          'The packet may suggest a next step, but it cannot decide authority.'
        ])
      };
    default:
      return {
        kind: 'packet-return/1.0',
        delivery: 'single JSON object',
        required_fields: ['status', 'next_command'],
        optional_fields: ['scope_identity'],
        blocked_when_missing: ['workstream_scope'],
        notes: baseNotes
      };
  }
}

function buildRecursiveActorWorkOrderSummary(role, opts = {}) {
  const exactRole = normalizeRole(role);
  const workstreamScope = normalizeText(opts.workstream_scope || opts.workstreamScope || opts.scope);
  const nextActorRole = normalizeText(opts.next_actor_role || opts.nextActorRole || exactRole || role);
  const exactNextCommand = normalizeText(opts.exact_next_command || opts.exactNextCommand);
  const explicitScopeTier = normalizeScopeTier(opts.scope_tier || opts.scopeTier);
  const targetBranch = normalizeText(opts.target_branch || opts.targetBranch);
  const branchReferenceSet = normalizeList(opts.branch_reference_set || opts.branchReferenceSet);
  const promptHint = normalizeText(opts.prompt_hint || opts.promptHint);
  const writeSet = normalizeList(opts.write_set || opts.writeSet);
  const forbiddenSurfaces = normalizeList(opts.forbidden_surfaces || opts.forbiddenSurfaces);
  const expectedEvidence = normalizeList(opts.expected_evidence || opts.expectedEvidence);
  const tests = normalizeList(opts.tests);
  const reviewLane = normalizeText(opts.review_lane || opts.reviewLane);
  const closeoutOwner = normalizeText(opts.closeout_owner || opts.closeoutOwner);
  const blockedBy = normalizeList(opts.blocked_by || opts.blockedBy);
  const openQuestions = normalizeList(opts.open_questions || opts.openQuestions);
  const childWorkOrders = normalizeObjectArray(opts.child_work_orders || opts.childWorkOrders);
  const threeStepPlanInput = normalizeList(opts.three_step_plan || opts.threeStepPlan);
  const aggregationContract = cloneObject(opts.aggregation_contract || opts.aggregationContract);
  const repoSpecificAssumptions = normalizeList(opts.repo_specific_assumptions || opts.repoSpecificAssumptions);
  const repoSpecificAssumptionsVerified = opts.repo_specific_assumptions_verified === undefined
    ? false
    : Boolean(opts.repo_specific_assumptions_verified);
  const rawDeterminismLevel = opts.determinism_level !== undefined
    ? opts.determinism_level
    : opts.determinismLevel;
  const determinismLevel = normalizeWorkOrderDeterminismLevel(
    rawDeterminismLevel !== undefined
      ? rawDeterminismLevel
      : (exactNextCommand && openQuestions.length === 0 ? 'mechanical' : 'medium')
  ) || (exactNextCommand && openQuestions.length === 0 ? 'mechanical' : 'medium');
  const scopeTier = explicitScopeTier || (
    exactNextCommand && openQuestions.length === 0
      ? 'leaf'
      : openQuestions.length > 0
        ? 'project'
        : 'task'
  );
  const threeStepPlan = threeStepPlanInput.length > 0
    ? threeStepPlanInput
    : buildDefaultThreeStepPlan(exactNextCommand);
  const readyThreeStepPlan = threeStepPlan.length === 3 && openQuestions.length === 0 && childWorkOrders.length === 0;
  const localTinyAvailable = opts.local_tiny_available === true || opts.localTinyAvailable === true;
  const raspiAvailable = opts.raspi_available === true || opts.raspiAvailable === true;
  const modelClass = normalizeText(opts.model_class || opts.modelClass)
    || deriveSummaryModelClass(scopeTier, determinismLevel);
  const smallestSufficientLocalClass = normalizeLocalModelClass(opts.smallest_sufficient_local_class || opts.smallestSufficientLocalClass)
    || deriveSummarySmallestLocalClass(scopeTier, readyThreeStepPlan, raspiAvailable, localTinyAvailable);
  const costPreference = normalizeWorkOrderCostPreference(opts.cost_preference || opts.costPreference) || (
    determinismLevel === 'mechanical'
      ? 'free'
      : determinismLevel === 'high'
        ? 'low'
        : 'balanced'
  );
  const modelDownshiftReason = normalizeText(opts.model_downshift_reason || opts.modelDownshiftReason) || (
    determinismLevel === 'mechanical'
      ? 'The task is deterministic enough to downshift to a free or low-cost model.'
      : determinismLevel === 'high'
        ? 'The task is bounded enough for a low-cost model, but still benefits from guidance.'
        : 'The task still needs higher-capability routing because questions or ambiguity remain.'
  );

  const summaryText = normalizeText(
    opts.summary
    || (exactNextCommand
      ? `Execute ${exactNextCommand}${workstreamScope ? ` for ${workstreamScope}` : ''}.`
      : `No exact next command is available yet for ${workstreamScope || 'this workstream'}.`)
  );

  const workOrderSummary = {
    schema: RECURSIVE_ACTOR_WORK_ORDER_SCHEMA_VERSION,
    validated: true,
    next_actor_role: nextActorRole,
    workstream_scope: workstreamScope,
    scope_tier: scopeTier,
    exact_next_command: exactNextCommand,
    summary: summaryText,
    model_class: modelClass,
    smallest_sufficient_local_class: smallestSufficientLocalClass,
    local_tiny_available: localTinyAvailable,
    raspi_available: raspiAvailable,
    decomposition_state: deriveSummaryDecompositionState(openQuestions.length, childWorkOrders.length, readyThreeStepPlan),
    three_step_plan: threeStepPlan,
    ready_to_execute_when_three_steps: readyThreeStepPlan,
    fractal_until_executable: !readyThreeStepPlan,
    write_set: writeSet,
    forbidden_surfaces: forbiddenSurfaces,
    expected_evidence: expectedEvidence,
    tests,
    review_lane: reviewLane,
    closeout_owner: closeoutOwner,
    blocked_by: blockedBy,
    open_questions: openQuestions,
    child_work_orders: childWorkOrders,
    aggregation_contract: aggregationContract || {
      schema: 'RecursiveActorWorkOrderAggregation/1.0',
      mode: 'upward',
      strategy: 'aggregate child results, blockers, and next-step candidates back to the parent task',
      upstream_owner: closeoutOwner || 'Codex agent',
      child_result_fields: ['status', 'observations', 'blockers', 'next_command'],
      aggregation_fields: ['open_questions', 'child_work_orders', 'model_downshift_reason', 'cost_preference', 'determinism_level']
    },
    target_branch: targetBranch,
    branch_reference_set: branchReferenceSet,
    repo_specific_assumptions: repoSpecificAssumptions,
    repo_specific_assumptions_verified: repoSpecificAssumptionsVerified,
    model_downshift_reason: modelDownshiftReason,
    cost_preference: costPreference,
    determinism_level: determinismLevel
  };

  if (promptHint) {
    workOrderSummary.prompt_hint = promptHint;
  }

  const validation = validateRecursiveActorWorkOrderSummary(workOrderSummary);
  if (!validation.valid) {
    throw new Error(`Invalid RecursiveActorWorkOrder/1.0: ${validation.errors.join('; ')}`);
  }

  return workOrderSummary;
}

function validateRecursiveActorWorkOrderSummary(summary) {
  const errors = [];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    errors.push('/ RecursiveActorWorkOrder/1.0 summary must be an object');
    return { valid: false, errors };
  }

  if (summary.schema !== RECURSIVE_ACTOR_WORK_ORDER_SCHEMA_VERSION) {
    errors.push('/schema must be RecursiveActorWorkOrder/1.0');
  }
  if (summary.validated !== true) {
    errors.push('/validated must be true');
  }
  if (!normalizeText(summary.next_actor_role)) {
    errors.push('/next_actor_role must be a non-empty string');
  }
  if (!normalizeText(summary.workstream_scope)) {
    errors.push('/workstream_scope must be a non-empty string');
  }
  if (!normalizeScopeTier(summary.scope_tier)) {
    errors.push('/scope_tier must be one of system, client, project, task, leaf');
  }
  if (!normalizeText(summary.summary)) {
    errors.push('/summary must be a non-empty string');
  }
  if (!normalizeText(summary.model_class)) {
    errors.push('/model_class must be a non-empty string');
  }
  if (!normalizeLocalModelClass(summary.smallest_sufficient_local_class)) {
    errors.push('/smallest_sufficient_local_class must be one of frontier, logged-in, local-model, local-tiny, raspi, api-router');
  }
  if (typeof summary.local_tiny_available !== 'boolean') {
    errors.push('/local_tiny_available must be a boolean');
  }
  if (typeof summary.raspi_available !== 'boolean') {
    errors.push('/raspi_available must be a boolean');
  }
  if (!['fan-out', 'fan-in', 'ready', 'blocked'].includes(summary.decomposition_state)) {
    errors.push('/decomposition_state must be one of fan-out, fan-in, ready, blocked');
  }
  if (!Array.isArray(summary.three_step_plan)) {
    errors.push('/three_step_plan must be an array');
  }
  const openQuestions = Array.isArray(summary.open_questions) ? summary.open_questions : [];
  const childWorkOrders = Array.isArray(summary.child_work_orders) ? summary.child_work_orders : [];
  const threeStepPlan = Array.isArray(summary.three_step_plan) ? summary.three_step_plan : [];
  const readyThreeStepPlan = threeStepPlan.length === 3 && openQuestions.length === 0 && childWorkOrders.length === 0;
  if (typeof summary.ready_to_execute_when_three_steps !== 'boolean') {
    errors.push('/ready_to_execute_when_three_steps must be a boolean');
  }
  if (typeof summary.fractal_until_executable !== 'boolean') {
    errors.push('/fractal_until_executable must be a boolean');
  }
  if (readyThreeStepPlan && summary.ready_to_execute_when_three_steps !== true) {
    errors.push('/ready_to_execute_when_three_steps must be true when the branch is a clear three-step executable plan');
  }
  if (!readyThreeStepPlan && summary.ready_to_execute_when_three_steps === true) {
    errors.push('/ready_to_execute_when_three_steps may only be true after fan-out/fan-in is resolved');
  }
  if (readyThreeStepPlan && summary.fractal_until_executable !== false) {
    errors.push('/fractal_until_executable must be false for ready three-step executable branches');
  }
  if (!Array.isArray(summary.write_set)) {
    errors.push('/write_set must be an array');
  }
  if (!Array.isArray(summary.forbidden_surfaces)) {
    errors.push('/forbidden_surfaces must be an array');
  }
  if (!Array.isArray(summary.expected_evidence)) {
    errors.push('/expected_evidence must be an array');
  }
  if (!Array.isArray(summary.tests)) {
    errors.push('/tests must be an array');
  }
  if (!normalizeText(summary.review_lane)) {
    errors.push('/review_lane must be a non-empty string');
  }
  if (!normalizeText(summary.closeout_owner)) {
    errors.push('/closeout_owner must be a non-empty string');
  }
  if (!Array.isArray(summary.blocked_by)) {
    errors.push('/blocked_by must be an array');
  }
  if (!Array.isArray(summary.open_questions)) {
    errors.push('/open_questions must be an array');
  }
  if (!Array.isArray(summary.child_work_orders)) {
    errors.push('/child_work_orders must be an array');
  }
  if (!summary.aggregation_contract || typeof summary.aggregation_contract !== 'object' || Array.isArray(summary.aggregation_contract)) {
    errors.push('/aggregation_contract must be an object');
  }
  if (typeof summary.target_branch !== 'string') {
    errors.push('/target_branch must be a string');
  }
  if (!Array.isArray(summary.branch_reference_set)) {
    errors.push('/branch_reference_set must be an array');
  }
  if (!Array.isArray(summary.repo_specific_assumptions)) {
    errors.push('/repo_specific_assumptions must be an array');
  }
  if (typeof summary.repo_specific_assumptions_verified !== 'boolean') {
    errors.push('/repo_specific_assumptions_verified must be a boolean');
  }
  if (typeof summary.model_downshift_reason !== 'string') {
    errors.push('/model_downshift_reason must be a string');
  }
  if (!normalizeWorkOrderCostPreference(summary.cost_preference)) {
    errors.push('/cost_preference must be one of free, low, balanced, best_available');
  }
  if (!normalizeWorkOrderDeterminismLevel(summary.determinism_level)) {
    errors.push('/determinism_level must be one of low, medium, high, mechanical');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function createNextPromptPacket(fields) {
  const input = fields && typeof fields === 'object' ? fields : {};
  const role = normalizeRole(input.role);
  const workstreamScope = normalizeText(input.workstream_scope || input.workstreamScope || input.scope);
  const actorRole = normalizeText(input.actor_role || input.actorRole || role);

  if (!role) {
    throw new Error('NextPromptPacket requires role: worker, reviewer, bridge, closeout, handoff, systemization-init');
  }
  if (!workstreamScope) {
    throw new Error('NextPromptPacket requires a non-empty workstream_scope string');
  }
  if (!actorRole) {
    throw new Error('NextPromptPacket requires a non-empty actor_role string');
  }

  const advisoryNotAuthority = role === 'systemization-init'
    ? true
    : Boolean(input.advisory_not_authority);

  if (role !== 'systemization-init' && input.advisory_not_authority === true) {
    throw new Error('advisory_not_authority may only be true for systemization-init packets');
  }

  const packet = {
    schema: 'NextPromptPacket/1.0',
    role,
    workstream_scope: workstreamScope,
    actor_role: actorRole,
    scope_identity: normalizeScopeIdentity(input.scope_identity || input.scopeIdentity) || undefined,
    write_set: normalizeList(input.write_set || input.writeSet),
    forbidden_surfaces: normalizeList(input.forbidden_surfaces || input.forbiddenSurfaces),
    expected_evidence: normalizeList(input.expected_evidence || input.expectedEvidence),
    tests: normalizeList(input.tests),
    review_lane: normalizeText(input.review_lane || input.reviewLane),
    closeout_owner: normalizeText(input.closeout_owner || input.closeoutOwner),
    grounding_posture: normalizeGroundingPosture(input.grounding_posture || input.groundingPosture, input),
    local_model_preflight_summary: normalizeLocalModelPreflightSummary(
      input.local_model_preflight_summary || input.localModelPreflightSummary,
      input
    ),
    work_order_summary: cloneObject(input.work_order_summary || input.workOrderSummary)
      || (input.include_work_order_summary === true
        ? buildRecursiveActorWorkOrderSummary(role, {
          workstream_scope: workstreamScope,
          next_actor_role: normalizeText(input.next_actor_role || input.nextActorRole || role),
          exact_next_command: normalizeText(input.exact_next_command || input.exactNextCommand || ''),
          summary: normalizeText(input.work_order_summary_summary || input.workOrderSummaryText || input.prompt_hint || input.promptHint || ''),
          prompt_hint: normalizeText(input.prompt_hint || input.promptHint),
          write_set: input.write_set || input.writeSet,
          forbidden_surfaces: input.forbidden_surfaces || input.forbiddenSurfaces,
          expected_evidence: input.expected_evidence || input.expectedEvidence,
          tests: input.tests,
          review_lane: input.review_lane || input.reviewLane,
          closeout_owner: input.closeout_owner || input.closeoutOwner,
          blocked_by: input.blocked_by || input.blockedBy,
          open_questions: input.open_questions || input.openQuestions,
          child_work_orders: input.child_work_orders || input.childWorkOrders,
          aggregation_contract: input.aggregation_contract || input.aggregationContract,
          target_branch: input.target_branch || input.targetBranch,
          branch_reference_set: input.branch_reference_set || input.branchReferenceSet,
          repo_specific_assumptions: input.repo_specific_assumptions || input.repoSpecificAssumptions,
          repo_specific_assumptions_verified: input.repo_specific_assumptions_verified,
          model_downshift_reason: input.model_downshift_reason || input.modelDownshiftReason,
          cost_preference: input.cost_preference || input.costPreference,
          determinism_level: input.determinism_level !== undefined ? input.determinism_level : input.determinismLevel
        })
        : undefined),
    exact_return_contract: cloneObject(input.exact_return_contract || input.exactReturnContract)
      || buildExactReturnContract(role, input),
    advisory_not_authority: advisoryNotAuthority
  };

  if (typeof input.prompt_hint === 'string' && input.prompt_hint.trim()) {
    packet.prompt_hint = input.prompt_hint.trim();
  }

  if (packet.scope_identity === undefined) {
    delete packet.scope_identity;
  }

  if (packet.work_order_summary === undefined) {
    delete packet.work_order_summary;
  }

  const validation = validateNextPromptPacket(packet);
  if (!validation.valid) {
    throw new Error(`Invalid NextPromptPacket: ${validation.errors.join('; ')}`);
  }

  return packet;
}

function buildNextPromptPacket(role, opts = {}) {
  return createNextPromptPacket({ ...opts, role });
}

function buildWorkerNextPromptPacket(opts = {}) {
  return buildNextPromptPacket('worker', opts);
}

function buildReviewerNextPromptPacket(opts = {}) {
  return buildNextPromptPacket('reviewer', opts);
}

function buildBridgeNextPromptPacket(opts = {}) {
  return buildNextPromptPacket('bridge', opts);
}

function buildCloseoutNextPromptPacket(opts = {}) {
  return buildNextPromptPacket('closeout', opts);
}

function buildHandoffNextPromptPacket(opts = {}) {
  return buildNextPromptPacket('handoff', opts);
}

function buildSystemizationInitNextPromptPacket(opts = {}) {
  return buildNextPromptPacket('systemization-init', opts);
}

function validateNextPromptPacket(packet) {
  const errors = validate(packet, NEXT_PROMPT_PACKET_SCHEMA, {
    rootSchema: NEXT_PROMPT_PACKET_SCHEMA,
    path: ''
  });

  return {
    valid: errors.length === 0,
    errors: errors.map((error) => `${error.path || '/'} ${error.message}`.trim())
  };
}

module.exports = {
  VALID_NEXT_PROMPT_ROLES,
  NEXT_PROMPT_PACKET_SCHEMA,
  normalizeText,
  normalizeList,
  normalizeRole,
  normalizeScopeIdentity,
  normalizeGroundingPosture,
  normalizeLocalModelPreflightSummary,
  buildExactReturnContract,
  buildRecursiveActorWorkOrderSummary,
  createNextPromptPacket,
  buildNextPromptPacket,
  buildWorkerNextPromptPacket,
  buildReviewerNextPromptPacket,
  buildBridgeNextPromptPacket,
  buildCloseoutNextPromptPacket,
  buildHandoffNextPromptPacket,
  buildSystemizationInitNextPromptPacket,
  validateRecursiveActorWorkOrderSummary,
  validateNextPromptPacket
};
