/**
 * Delegation Controller — P3-fractal-delegation-bounds
 *
 * Core delegation lifecycle module that enforces bounded delegation contracts
 * in the system control plane.
 *
 * Governance invariants:
 *   1. Workers may never expand their own scope.
 *   2. Workers may never self-close their own delegation.
 *   3. Delegation depth is bounded by MAX_DELEGATION_DEPTH.
 *   4. Scope paths are enforced via allowed_paths / denied_paths.
 */

'use strict';

const crypto = require('crypto');

// ─── Constants ─────────────────────────────────────────────────────────────

/** Valid delegation status strings. */
const DELEGATION_STATUSES = Object.freeze([
  'active',
  'completed',
  'revoked',
  'expired'
]);

/** Valid worker type strings. */
const WORKER_TYPES = Object.freeze([
  'subagent',
  'external_actor',
  'bounded_task'
]);

/** Maximum allowed delegation depth. */
const MAX_DELEGATION_DEPTH = 3;

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a new DelegationContract/1.0.
 *
 * Required params: parent_actor_id, worker_id, scope.
 * Scope must include allowed_paths (array).
 *
 * Governance enforcement:
 *   - may_expand_scope is always forced to false.
 *   - may_self_close is always forced to false.
 *   - may_spawn_workers is forced to false when current_depth === max_depth.
 *
 * @param {object} params
 * @returns {object} DelegationContract/1.0
 */
function createDelegation(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('createDelegation requires a params object');
  }

  var missing = [];
  if (!params.parent_actor_id) missing.push('parent_actor_id');
  if (!params.worker_id) missing.push('worker_id');
  if (!params.scope) missing.push('scope');
  if (missing.length > 0) {
    throw new Error('Missing required fields: ' + missing.join(', '));
  }

  var depth = params.depth || {};
  var currentDepth = typeof depth.current_depth === 'number' ? depth.current_depth : 0;
  var maxDepth = typeof depth.max_depth === 'number' ? depth.max_depth : MAX_DELEGATION_DEPTH;

  // Governance: enforce hard ceilings
  var maySpawnWorkers = currentDepth < maxDepth;
  if (params.authority && params.authority.may_spawn_workers === false) {
    maySpawnWorkers = false;
  }

  var id = 'del-' + crypto.randomBytes(8).toString('hex');

  return {
    schema: 'DelegationContract/1.0',
    delegation_id: id,
    parent_actor_id: params.parent_actor_id,
    parent_harness_id: params.parent_harness_id || null,
    worker_id: params.worker_id,
    worker_type: params.worker_type || 'subagent',
    scope: {
      allowed_paths: Array.isArray(params.scope.allowed_paths) ? params.scope.allowed_paths : [],
      denied_paths: Array.isArray(params.scope.denied_paths) ? params.scope.denied_paths : [],
      workflow_type: params.scope.workflow_type || null,
      task_description: params.scope.task_description || null
    },
    depth: {
      current_depth: currentDepth,
      max_depth: maxDepth
    },
    authority: {
      may_expand_scope: false,       // ALWAYS false — governance invariant
      may_self_close: false,         // ALWAYS false — governance invariant
      may_spawn_workers: maySpawnWorkers,
      acceptance_grade_events: (params.authority && Array.isArray(params.authority.acceptance_grade_events))
        ? params.authority.acceptance_grade_events
        : []
    },
    status: 'active',
    created_at: new Date().toISOString(),
    completed_at: null,
    revoked_at: null,
    revocation_reason: null
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Validate a DelegationContract/1.0 object.
 *
 * @param {object} contract
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateDelegation(contract) {
  var errors = [];

  if (!contract || typeof contract !== 'object') {
    return { valid: false, errors: ['Contract is null or not an object'] };
  }

  // Required fields
  if (!contract.delegation_id) errors.push('Missing delegation_id');
  if (!contract.parent_actor_id) errors.push('Missing parent_actor_id');
  if (!contract.worker_id) errors.push('Missing worker_id');
  if (!contract.scope) errors.push('Missing scope');
  if (!contract.status) errors.push('Missing status');

  // Status must be valid
  if (contract.status && DELEGATION_STATUSES.indexOf(contract.status) === -1) {
    errors.push('Invalid status: ' + contract.status);
  }

  // Governance invariant: may_expand_scope must be false
  if (contract.authority && contract.authority.may_expand_scope === true) {
    errors.push('may_expand_scope must be false — governance invariant');
  }

  // Governance invariant: may_self_close must be false
  if (contract.authority && contract.authority.may_self_close === true) {
    errors.push('may_self_close must be false — governance invariant');
  }

  // Depth check
  var depth = contract.depth || {};
  if (typeof depth.current_depth === 'number' && typeof depth.max_depth === 'number') {
    if (depth.current_depth > depth.max_depth) {
      errors.push('current_depth (' + depth.current_depth + ') exceeds max_depth (' + depth.max_depth + ')');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// ─── Scope checks ──────────────────────────────────────────────────────────

/**
 * Check whether requested paths are within the delegation's allowed scope.
 *
 * @param {object} contract - DelegationContract/1.0.
 * @param {string[]} requestedPaths - Paths the worker wants to access.
 * @returns {{ allowed: boolean, violations: string[] }}
 */
function checkScopeExpansion(contract, requestedPaths) {
  if (!Array.isArray(requestedPaths) || requestedPaths.length === 0) {
    return { allowed: true, violations: [] };
  }

  var scope = (contract && contract.scope) || {};
  var allowedPaths = Array.isArray(scope.allowed_paths) ? scope.allowed_paths : [];
  var deniedPaths = Array.isArray(scope.denied_paths) ? scope.denied_paths : [];
  var violations = [];

  for (var i = 0; i < requestedPaths.length; i++) {
    var reqPath = requestedPaths[i];

    // Check denied first — denied_paths override allowed_paths
    var inDenied = false;
    for (var k = 0; k < deniedPaths.length; k++) {
      if (reqPath === deniedPaths[k] || reqPath.startsWith(deniedPaths[k])) {
        inDenied = true;
        break;
      }
    }
    if (inDenied) {
      violations.push(reqPath);
      continue;
    }

    // Check allowed
    var inAllowed = false;
    for (var j = 0; j < allowedPaths.length; j++) {
      if (reqPath === allowedPaths[j] || reqPath.startsWith(allowedPaths[j])) {
        inAllowed = true;
        break;
      }
    }
    if (!inAllowed) {
      violations.push(reqPath);
    }
  }

  return {
    allowed: violations.length === 0,
    violations: violations
  };
}

// ─── Self-close check ──────────────────────────────────────────────────────

/**
 * Check whether an actor may close a delegation contract.
 *
 * Workers may never close their own delegation (may_self_close is always false).
 *
 * @param {object} contract - DelegationContract/1.0.
 * @param {string} closingActorId - Actor attempting to close.
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkSelfClose(contract, closingActorId) {
  if (!closingActorId) {
    return { allowed: false, reason: 'No closing actor specified' };
  }

  if (!contract || !contract.worker_id) {
    return { allowed: false, reason: 'Invalid contract' };
  }

  if (closingActorId === contract.worker_id) {
    return {
      allowed: false,
      reason: 'Worker "' + closingActorId + '" may not self-close its own delegation'
    };
  }

  return {
    allowed: true,
    reason: 'Actor "' + closingActorId + '" is distinct from worker "' + contract.worker_id + '"'
  };
}

// ─── Depth check ───────────────────────────────────────────────────────────

/**
 * Check whether a delegation contract allows further sub-delegation.
 *
 * @param {object} contract - DelegationContract/1.0.
 * @returns {{ can_delegate: boolean, current_depth: number, max_depth: number, reason: string }}
 */
function checkDepthLimit(contract) {
  var depth = (contract && contract.depth) || {};
  var currentDepth = typeof depth.current_depth === 'number' ? depth.current_depth : 0;
  var maxDepth = typeof depth.max_depth === 'number' ? depth.max_depth : MAX_DELEGATION_DEPTH;

  if (currentDepth >= maxDepth) {
    return {
      can_delegate: false,
      current_depth: currentDepth,
      max_depth: maxDepth,
      reason: 'Depth limit reached: current_depth=' + currentDepth + ', max_depth=' + maxDepth
    };
  }

  return {
    can_delegate: true,
    current_depth: currentDepth,
    max_depth: maxDepth,
    reason: 'Delegation allowed: current_depth=' + currentDepth + ', max_depth=' + maxDepth
  };
}

// ─── Lifecycle transitions ─────────────────────────────────────────────────

/**
 * Complete a delegation contract.
 *
 * Enforces that the completing actor is distinct from the worker (no self-close).
 *
 * @param {object} contract - DelegationContract/1.0.
 * @param {string} completedByActorId - Actor completing the delegation.
 * @returns {object} Updated contract with status=completed.
 */
function completeDelegation(contract, completedByActorId) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Invalid contract');
  }

  if (contract.status !== 'active') {
    throw new Error('Cannot complete delegation: status is "' + contract.status + '", expected "active"');
  }

  var selfCloseCheck = checkSelfClose(contract, completedByActorId);
  if (!selfCloseCheck.allowed) {
    throw new Error('Self-close violation: ' + selfCloseCheck.reason);
  }

  var result = Object.assign({}, contract);
  result.status = 'completed';
  result.completed_at = new Date().toISOString();
  return result;
}

/**
 * Revoke a delegation contract.
 *
 * @param {object} contract - DelegationContract/1.0.
 * @param {string} reason - Reason for revocation.
 * @returns {object} Updated contract with status=revoked.
 */
function revokeDelegation(contract, reason) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Invalid contract');
  }

  var result = Object.assign({}, contract);
  result.status = 'revoked';
  result.revoked_at = new Date().toISOString();
  result.revocation_reason = reason || 'No reason provided';
  return result;
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  DELEGATION_STATUSES: DELEGATION_STATUSES,
  WORKER_TYPES: WORKER_TYPES,
  MAX_DELEGATION_DEPTH: MAX_DELEGATION_DEPTH,
  createDelegation: createDelegation,
  validateDelegation: validateDelegation,
  checkScopeExpansion: checkScopeExpansion,
  checkSelfClose: checkSelfClose,
  checkDepthLimit: checkDepthLimit,
  completeDelegation: completeDelegation,
  revokeDelegation: revokeDelegation
};
