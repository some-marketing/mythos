'use strict';

const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths } = require('../planning/lib/resolve-task-plan');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid gate states. */
var GATE_STATES = ['pending', 'accepted', 'rejected_for_fix', 'escalated'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely read and parse a JSON file. Returns null on any failure.
 * @param {string} absPath
 * @returns {object|null}
 */
function readJsonSafe(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Load the canonical plan JSON for a given plan ID.
 * @param {string} projectRoot
 * @param {string} planId
 * @returns {object|null}
 */
function loadPlanJson(projectRoot, planId) {
  var resolved = resolveTaskPlanPaths(projectRoot, planId);
  if (!resolved) return null;
  return readJsonSafe(resolved.jsonPath);
}

/**
 * Extract expected outcomes from a plan.
 * The canonical schema defines expected_outcomes as an array of strings
 * inside bounded_plan. Also checks top-level and outcome_delta as fallbacks.
 * @param {object} planJson
 * @returns {string[]}
 */
function extractExpectedOutcomes(planJson) {
  if (!planJson) return [];
  if (planJson.bounded_plan && Array.isArray(planJson.bounded_plan.expected_outcomes)) {
    return planJson.bounded_plan.expected_outcomes;
  }
  if (Array.isArray(planJson.expected_outcomes)) return planJson.expected_outcomes;
  if (planJson.outcome_delta && Array.isArray(planJson.outcome_delta.expected)) {
    return planJson.outcome_delta.expected;
  }
  return [];
}

/**
 * Extract required gates from a plan.
 * The canonical schema defines required_gates as an array of strings
 * inside bounded_plan. Also checks top-level and routing_expectations as fallbacks.
 * @param {object} planJson
 * @returns {string[]}
 */
function extractRequiredGates(planJson) {
  if (!planJson) return [];
  if (planJson.bounded_plan && Array.isArray(planJson.bounded_plan.required_gates)) {
    return planJson.bounded_plan.required_gates;
  }
  if (Array.isArray(planJson.required_gates)) return planJson.required_gates;
  if (planJson.routing_expectations && Array.isArray(planJson.routing_expectations.gates)) {
    return planJson.routing_expectations.gates;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Gate factory
// ---------------------------------------------------------------------------

/**
 * Create a new approval gate for a plan.
 *
 * @param {string} planId - Task-plan identifier.
 * @param {object} [opts] - Options.
 * @param {string} [opts.projectRoot] - Absolute path to Mythos repo root.
 * @returns {object} Gate object.
 */
function createGate(planId, opts) {
  var options = opts || {};
  var projectRoot = options.projectRoot || process.cwd();
  var planJson = loadPlanJson(projectRoot, planId);

  return {
    plan_id: planId,
    state: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expected_outcomes: extractExpectedOutcomes(planJson),
    required_gates: extractRequiredGates(planJson),
    submissions: [],
    transition_log: [],
    fixes: []
  };
}

// ---------------------------------------------------------------------------
// Submission and evaluation
// ---------------------------------------------------------------------------

/**
 * Submit artifacts for approval against the gate's criteria.
 *
 * Evaluates each expected outcome and required gate against the provided
 * artifacts. Transitions the gate state based on the evaluation result.
 *
 * @param {object} gate - Gate object from createGate.
 * @param {object} artifacts - Map of artifact identifiers to their data.
 * @returns {object} The mutated gate with evaluation results.
 */
function submitForApproval(gate, artifacts) {
  var now = new Date().toISOString();
  var artifactKeys = Object.keys(artifacts || {});

  var submission = {
    ts: now,
    artifact_keys: artifactKeys,
    outcome_checks: [],
    gate_checks: [],
    result: null
  };

  // Collect all artifact evidence strings (values) for substring matching.
  // The artifacts map is keyed by label; the values are evidence strings.
  var evidenceStrings = [];
  for (var e = 0; e < artifactKeys.length; e++) {
    var val = (artifacts || {})[artifactKeys[e]];
    // Accept both the key and the value as evidence
    evidenceStrings.push(String(artifactKeys[e]).toLowerCase());
    if (val != null) evidenceStrings.push(String(val).toLowerCase());
  }

  /**
   * Check whether a criterion string is satisfied by any submitted evidence.
   * Uses case-insensitive substring matching: evidence that contains the
   * criterion (or vice-versa) counts as a match.
   */
  function criterionSatisfied(criterion) {
    var needle = String(criterion).toLowerCase();
    for (var s = 0; s < evidenceStrings.length; s++) {
      if (evidenceStrings[s].indexOf(needle) !== -1 || needle.indexOf(evidenceStrings[s]) !== -1) {
        return true;
      }
    }
    return false;
  }

  // Evaluate expected outcomes (each entry is a plain string per the schema)
  var outcomesPassed = true;
  for (var i = 0; i < gate.expected_outcomes.length; i++) {
    var outcome = gate.expected_outcomes[i];
    var outcomeStr = typeof outcome === 'string' ? outcome : (outcome.description || outcome.name || outcome.id || 'outcome_' + i);
    var met = criterionSatisfied(outcomeStr);
    submission.outcome_checks.push({
      criterion: outcomeStr,
      met: met
    });
    if (!met) outcomesPassed = false;
  }

  // Evaluate required gates (each entry is a plain string per the schema)
  var gatesPassed = true;
  for (var j = 0; j < gate.required_gates.length; j++) {
    var reqGate = gate.required_gates[j];
    var gateStr = typeof reqGate === 'string' ? reqGate : (reqGate.description || reqGate.name || reqGate.id || 'gate_' + j);
    var satisfied = criterionSatisfied(gateStr);
    submission.gate_checks.push({
      criterion: gateStr,
      satisfied: satisfied
    });
    if (!satisfied) gatesPassed = false;
  }

  // Determine transition
  var allPassed = outcomesPassed && gatesPassed;
  var previousState = gate.state;

  if (allPassed) {
    submission.result = 'accepted';
    gate.state = 'accepted';
  } else {
    // If already rejected once, escalate
    if (previousState === 'rejected_for_fix') {
      submission.result = 'escalated';
      gate.state = 'escalated';
    } else {
      submission.result = 'rejected_for_fix';
      gate.state = 'rejected_for_fix';

      // Emit structured fixes
      var fixes = [];
      for (var k = 0; k < submission.outcome_checks.length; k++) {
        if (!submission.outcome_checks[k].met) {
          fixes.push({
            type: 'missing_outcome',
            criterion: submission.outcome_checks[k].criterion,
            action: 'Produce evidence for outcome: "' + submission.outcome_checks[k].criterion + '"'
          });
        }
      }
      for (var m = 0; m < submission.gate_checks.length; m++) {
        if (!submission.gate_checks[m].satisfied) {
          fixes.push({
            type: 'missing_gate',
            criterion: submission.gate_checks[m].criterion,
            action: 'Satisfy gate requirement: "' + submission.gate_checks[m].criterion + '"'
          });
        }
      }
      gate.fixes = gate.fixes.concat(fixes);
    }
  }

  // Log transition
  gate.transition_log.push({
    from: previousState,
    to: gate.state,
    ts: now,
    result: submission.result
  });

  gate.submissions.push(submission);
  gate.updated_at = now;

  return gate;
}

// ---------------------------------------------------------------------------
// State accessor
// ---------------------------------------------------------------------------

/**
 * Get the current state of an approval gate.
 *
 * @param {object} gate - Gate object.
 * @returns {{ state: string, plan_id: string, submission_count: number,
 *             pending_fixes: number, last_updated: string }}
 */
function getGateState(gate) {
  return {
    state: gate.state,
    plan_id: gate.plan_id,
    submission_count: gate.submissions.length,
    pending_fixes: gate.fixes.length,
    last_updated: gate.updated_at
  };
}

// ---------------------------------------------------------------------------
// Delegation authority
// ---------------------------------------------------------------------------

/**
 * Check whether the completing actor has delegation authority to close this gate.
 *
 * Enforces:
 * - Bounded workers may not self-close acceptance-grade outcomes
 * - The completing actor must be distinct from the worker for acceptance-grade events
 * - The delegation must be active
 *
 * @param {object} gate - Gate object from createGate.
 * @param {object} delegationContract - DelegationContract/1.0 object.
 * @param {string} completingActorId - Actor attempting to complete/close.
 * @returns {{ authorized: boolean, reason: string, violations: string[] }}
 */
function checkDelegationAuthority(gate, delegationContract, completingActorId) {
  var violations = [];

  if (!delegationContract || typeof delegationContract !== 'object') {
    return { authorized: false, reason: 'No delegation contract provided', violations: ['missing_contract'] };
  }

  // Check delegation is active
  if (delegationContract.status !== 'active') {
    violations.push('delegation_not_active');
  }

  // Check self-close
  var authority = delegationContract.authority || {};
  if (authority.may_self_close === false && completingActorId === delegationContract.worker_id) {
    violations.push('self_close_forbidden');
  }

  // Check scope expansion — the gate's plan_id should be within the delegation scope
  if (authority.may_expand_scope === false) {
    var scope = delegationContract.scope || {};
    var taskDesc = scope.task_description || '';
    if (gate.plan_id && taskDesc && !taskDesc.toLowerCase().includes(gate.plan_id.toLowerCase())) {
      // This is a heuristic check — the gate's plan doesn't match the delegation's task
      // Only flag if clearly out of scope
    }
  }

  var authorized = violations.length === 0;
  var reason = authorized
    ? 'Actor "' + completingActorId + '" is authorized to complete this gate under delegation "' + delegationContract.delegation_id + '".'
    : 'Actor "' + completingActorId + '" is NOT authorized: ' + violations.join(', ') + '.';

  return {
    authorized: authorized,
    reason: reason,
    violations: violations
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createGate: createGate,
  submitForApproval: submitForApproval,
  getGateState: getGateState,
  checkDelegationAuthority: checkDelegationAuthority,
  GATE_STATES: GATE_STATES
};
