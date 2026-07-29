/**
 * Lane Selector — P2-local-first-fast-slow-lanes
 *
 * Core lane classification module that operationalizes local-first execution
 * lanes and fast/slow governance in the system control plane.
 *
 * Lane types encode two independent axes:
 *   location : local | cloud
 *   speed    : fast  | slow
 *
 * Governance invariants:
 *   1. Local execution is the evidence-driven default for eligible workloads.
 *   2. Cloud/frontier routing requires a documented override reason.
 *   3. Acceptance-grade outcomes must flow through the slow lane.
 *   4. Fast lanes propose and execute; slow lanes validate and finalize.
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Valid lane type strings. */
const LANE_TYPES = Object.freeze([
  'local-fast',
  'local-slow',
  'cloud-fast',
  'cloud-slow'
]);

/** Event types that require acceptance-grade governance. */
const ACCEPTANCE_GRADE_EVENTS = Object.freeze([
  'outcome_delta.completed',
  'bridge_feedback_received',
  'actor_promotion',
  'framework_hardening'
]);

/** Valid reasons for overriding local-first default and routing to cloud. */
const CLOUD_OVERRIDE_CONDITIONS = Object.freeze([
  'risk_tier_exceeds_local_capability',
  'safety_constraints_require_guardrails',
  'latency_requirements_unmet_locally',
  'distinct_intelligence_required',
  'operator_explicit_request'
]);

// ─── Lane Policies ─────────────────────────────────────────────────────────

/** Policy descriptors for each lane type. */
const LANE_POLICIES = Object.freeze({
  'local-fast': Object.freeze({
    lane: 'local-fast',
    speed: 'fast',
    location: 'local',
    role: 'propose_and_execute',
    description: 'Local model, propose-and-execute — default for eligible work',
    may_finalize_acceptance: false,
    requires_justification: false
  }),
  'local-slow': Object.freeze({
    lane: 'local-slow',
    speed: 'slow',
    location: 'local',
    role: 'validate_and_finalize',
    description: 'Local model, validation and finalization — non-acceptance-grade high-risk',
    may_finalize_acceptance: false,
    requires_justification: false
  }),
  'cloud-fast': Object.freeze({
    lane: 'cloud-fast',
    speed: 'fast',
    location: 'cloud',
    role: 'propose_and_execute',
    description: 'Cloud model, propose-and-execute — requires documented justification',
    may_finalize_acceptance: false,
    requires_justification: true
  }),
  'cloud-slow': Object.freeze({
    lane: 'cloud-slow',
    speed: 'slow',
    location: 'cloud',
    role: 'validate_and_finalize',
    description: 'Cloud model, validation and finalization — acceptance-grade validation',
    may_finalize_acceptance: true,
    requires_justification: true
  })
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a human-readable justification string from selection parameters.
 *
 * @param {object} params
 * @param {string} params.lane - Selected lane type
 * @param {boolean} params.acceptance_grade - Whether this is acceptance-grade
 * @param {string} params.risk_tier - Risk tier
 * @param {boolean} params.local_eligible - Whether local execution is eligible
 * @param {string|null} params.cloud_override_reason - Cloud override reason
 * @param {boolean} params.operator_requested_cloud - Whether operator requested cloud
 * @param {string|null} params.workflow_type - Workflow type
 * @returns {string}
 */
function buildJustification(params) {
  const {
    lane,
    acceptance_grade,
    risk_tier,
    local_eligible,
    cloud_override_reason,
    operator_requested_cloud,
    workflow_type
  } = params;

  const parts = [];

  // Location rationale
  if (lane.startsWith('cloud-')) {
    if (acceptance_grade) {
      parts.push('Cloud routing: acceptance-grade outcome requires distinct intelligence');
    } else if (operator_requested_cloud) {
      parts.push('Cloud routing: operator explicitly requested cloud execution');
    } else if (cloud_override_reason) {
      parts.push(`Cloud routing: ${cloud_override_reason}`);
    } else if (!local_eligible) {
      parts.push('Cloud routing: workload not eligible for local execution');
    }
  } else {
    parts.push('Local-first: workload eligible for local execution');
  }

  // Speed rationale
  if (lane.endsWith('-slow')) {
    if (acceptance_grade) {
      parts.push('Slow lane: acceptance-grade outcome requires validation');
    } else if (risk_tier === 'high') {
      parts.push('Slow lane: high risk tier requires validation');
    }
  } else {
    parts.push('Fast lane: propose-and-execute');
  }

  if (workflow_type) {
    parts.push(`Workflow: ${workflow_type}`);
  }

  return parts.join('. ') + '.';
}

// ─── Classification Functions ──────────────────────────────────────────────

/**
 * Check whether the slow lane is required for the given parameters.
 *
 * Slow lane is required when:
 *   - acceptance_grade is true (must validate before finalizing), OR
 *   - risk_tier is 'high' (non-trivial risk requires validation gate)
 *
 * @param {object} params
 * @param {boolean} [params.acceptance_grade=false] - Whether this is acceptance-grade
 * @param {string} [params.risk_tier='low'] - Risk tier ('low', 'medium', 'high')
 * @returns {boolean}
 */
function isSlowLaneRequired(params) {
  const { acceptance_grade = false, risk_tier = 'low' } = params || {};
  return acceptance_grade === true || risk_tier === 'high';
}

/**
 * Check whether cloud routing is required for the given parameters.
 *
 * Cloud routing is needed when:
 *   - local_eligible is false (workload cannot run locally), OR
 *   - operator_requested_cloud is true, OR
 *   - a valid cloud_override_reason is provided, OR
 *   - acceptance_grade is true (distinct intelligence required)
 *
 * @param {object} params
 * @param {boolean} [params.local_eligible=true] - Whether local execution is eligible
 * @param {string|null} [params.cloud_override_reason=null] - Cloud override reason
 * @param {boolean} [params.operator_requested_cloud=false] - Operator requested cloud
 * @param {boolean} [params.acceptance_grade=false] - Whether this is acceptance-grade
 * @returns {boolean}
 */
function requiresCloudRouting(params) {
  const {
    local_eligible = true,
    cloud_override_reason = null,
    operator_requested_cloud = false,
    acceptance_grade = false
  } = params || {};

  if (!local_eligible) return true;
  if (operator_requested_cloud) return true;
  if (cloud_override_reason && CLOUD_OVERRIDE_CONDITIONS.includes(cloud_override_reason)) return true;
  if (acceptance_grade) return true;

  return false;
}

/**
 * Check whether an event type is acceptance-grade.
 *
 * @param {string} eventType - The event type to check
 * @returns {boolean}
 */
function isAcceptanceGrade(eventType) {
  return ACCEPTANCE_GRADE_EVENTS.includes(eventType);
}

/**
 * Get the policy descriptor for a lane type.
 *
 * @param {string} laneType - The lane type string
 * @returns {object|null} Policy object or null if invalid lane type
 */
function getLanePolicy(laneType) {
  return LANE_POLICIES[laneType] || null;
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Validate a lane assignment against governance rules.
 *
 * Checks:
 *   1. Lane type must be a valid LANE_TYPES value.
 *   2. Acceptance-grade outcomes must not be in a fast lane.
 *   3. Cloud-routed work must have justification when local is eligible.
 *
 * @param {object} assignment - A LaneAssignment object
 * @returns {{ valid: boolean, violations: string[] }}
 */
function validateLaneAssignment(assignment) {
  const violations = [];

  if (!assignment || typeof assignment !== 'object') {
    return { valid: false, violations: ['Assignment is null or not an object'] };
  }

  // Check valid lane type
  if (!LANE_TYPES.includes(assignment.lane)) {
    violations.push(`Invalid lane type: "${assignment.lane}". Valid types: ${LANE_TYPES.join(', ')}`);
  }

  // Acceptance-grade must not be in fast lane
  if (assignment.acceptance_grade && assignment.speed === 'fast') {
    violations.push('Governance violation: acceptance-grade outcome assigned to fast lane. Acceptance-grade must flow through slow-lane validation.');
  }

  // Cloud routing must have justification when local is eligible
  if (assignment.location === 'cloud' && assignment.local_eligible && !assignment.cloud_override_reason) {
    violations.push('Governance violation: cloud routing without documented justification for locally-eligible workload.');
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

// ─── Main Selector ─────────────────────────────────────────────────────────

/**
 * Select the appropriate execution lane for a workload.
 *
 * This is the primary classification entry point. It evaluates governance
 * constraints, local eligibility, risk tier, and acceptance-grade status
 * to produce a LaneAssignment with an embedded governance check.
 *
 * @param {object} params
 * @param {string} [params.workflow_type=null] - Workflow type identifier
 * @param {boolean} [params.acceptance_grade=false] - Whether this is acceptance-grade
 * @param {string} [params.risk_tier='low'] - Risk tier ('low', 'medium', 'high')
 * @param {boolean} [params.local_eligible=true] - Whether local execution is eligible
 * @param {string|null} [params.cloud_override_reason=null] - Cloud override reason
 * @param {boolean} [params.operator_requested_cloud=false] - Operator requested cloud
 * @returns {object} LaneAssignment
 */
function selectLane(params) {
  const {
    workflow_type = null,
    acceptance_grade = false,
    risk_tier = 'low',
    local_eligible = true,
    cloud_override_reason = null,
    operator_requested_cloud = false
  } = params || {};

  // Determine speed axis
  const slow = isSlowLaneRequired({ acceptance_grade, risk_tier });
  const speed = slow ? 'slow' : 'fast';

  // Determine location axis
  const cloud = requiresCloudRouting({
    local_eligible,
    cloud_override_reason,
    operator_requested_cloud,
    acceptance_grade
  });
  const location = cloud ? 'cloud' : 'local';

  // Resolve effective cloud override reason
  let effectiveOverrideReason = cloud_override_reason || null;
  if (cloud && !effectiveOverrideReason) {
    if (!local_eligible) {
      effectiveOverrideReason = null; // No override needed — local ineligible
    } else if (operator_requested_cloud) {
      effectiveOverrideReason = 'operator_explicit_request';
    } else if (acceptance_grade) {
      effectiveOverrideReason = 'distinct_intelligence_required';
    }
  }

  const lane = `${location}-${speed}`;

  const justification = buildJustification({
    lane,
    acceptance_grade,
    risk_tier,
    local_eligible,
    cloud_override_reason: effectiveOverrideReason,
    operator_requested_cloud,
    workflow_type
  });

  const assignment = {
    lane,
    speed,
    location,
    justification,
    local_eligible,
    acceptance_grade,
    slow_lane_required: slow,
    cloud_override_reason: effectiveOverrideReason,
    workflow_type,
    risk_tier,
    governance_check: null // Placeholder — filled below
  };

  assignment.governance_check = validateLaneAssignment(assignment);

  return assignment;
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  LANE_TYPES,
  ACCEPTANCE_GRADE_EVENTS,
  CLOUD_OVERRIDE_CONDITIONS,
  LANE_POLICIES,
  selectLane,
  isSlowLaneRequired,
  requiresCloudRouting,
  validateLaneAssignment,
  isAcceptanceGrade,
  getLanePolicy
};
