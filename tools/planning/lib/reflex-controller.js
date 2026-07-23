'use strict';

const fs = require('fs');
const path = require('path');

const { classifyPlanState } = require('./completion-classifier');

// Lazy-loaded to avoid circular dependency
let _bridgeFns = null;
function getBridgeFns() {
  if (!_bridgeFns) {
    _bridgeFns = require('../../signals/lib/codex-bridge');
  }
  return _bridgeFns;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Relative path from project root to the task-outcomes directory.
 * @type {string}
 */
const OUTCOME_DIR = path.join('_dev', 'reports', 'analysis', 'task-outcomes');

/**
 * Relative path from project root to the signals directory.
 * @type {string}
 */
const SIGNAL_DIR = path.join('_dev', 'reports', 'signals');

/**
 * Relative path from project root to the analysis directory.
 * @type {string}
 */
const ANALYSIS_DIR = path.join('_dev', 'reports', 'analysis');

/**
 * Valid callers that can invoke the reflex controller.
 * @type {string[]}
 */
const VALID_CALLERS = ['run-plan', 'execute-plan', 'follow-signal', 'run-framework'];

/**
 * Valid actor-bridge states.
 * @type {string[]}
 */
const BRIDGE_STATES = [
  'handoff_prepared',
  'bridge_active',
  'feedback_received',
  'blocked_on_actor_bridge'
];

/**
 * Signal lifecycle states that indicate feedback has been received.
 * @type {string[]}
 */
const FEEDBACK_TERMINAL_STATES = ['consumed', 'feedback_received'];

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
 * Build a single check result object.
 * @param {string} name
 * @param {'pass'|'fail'|'skip'} status
 * @param {string} detail
 * @returns {{ name: string, status: string, detail: string }}
 */
function check(name, status, detail) {
  return { name: name, status: status, detail: detail };
}

/**
 * Determine whether a value looks like a file path (contains slashes or
 * common file extensions).
 * @param {string} val
 * @returns {boolean}
 */
function looksLikePath(val) {
  if (typeof val !== 'string') return false;
  return (
    val.includes('/') ||
    val.includes(path.sep) ||
    val.endsWith('.json') ||
    val.endsWith('.md') ||
    val.endsWith('.js') ||
    val.endsWith('.yaml') ||
    val.endsWith('.yml') ||
    val.endsWith('.html') ||
    val.endsWith('.css') ||
    val.endsWith('.ts')
  );
}

/**
 * Extract the task-id from a plan JSON, with fallback.
 * @param {object} planJson
 * @returns {string|null}
 */
function extractTaskId(planJson) {
  return planJson.task_id || null;
}

/**
 * Derive the codex-bridge scope identifier from a plan.
 * Looks for an explicit scope in routing_expectations, falls back to task-id.
 * @param {object} planJson
 * @returns {string}
 */
function deriveCodexBridgeScope(planJson) {
  var routing = planJson.routing_expectations;
  if (routing && routing.codex_bridge_scope) {
    return routing.codex_bridge_scope;
  }
  return planJson.task_id;
}

// ---------------------------------------------------------------------------
// Check implementations
// ---------------------------------------------------------------------------

/**
 * Check 1: Verification — execution produced expected outputs.
 * Inspects bounded_plan.steps and checks that any outputs that look like
 * file paths actually exist on disk.
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ check: object, missingArtifacts: string[] }}
 */
function checkVerification(projectRoot, planJson) {
  var bp = planJson.bounded_plan;
  if (!bp || !bp.steps || !Array.isArray(bp.steps) || bp.steps.length === 0) {
    return {
      check: check('verification', 'skip', 'No bounded_plan.steps to verify'),
      missingArtifacts: []
    };
  }

  // Collect expected outcomes from the plan
  var expectedOutputs = [];

  // Check expected_outcomes at the plan level
  if (bp.expected_outcomes && Array.isArray(bp.expected_outcomes)) {
    for (var i = 0; i < bp.expected_outcomes.length; i++) {
      var outcome = bp.expected_outcomes[i];
      if (looksLikePath(outcome)) {
        expectedOutputs.push(outcome);
      }
    }
  }

  // Check each step for output-like fields
  for (var s = 0; s < bp.steps.length; s++) {
    var step = bp.steps[s];
    // Check common output fields
    var outputFields = ['output', 'outputs', 'artifact', 'artifacts', 'expected_output'];
    for (var f = 0; f < outputFields.length; f++) {
      var fieldVal = step[outputFields[f]];
      if (typeof fieldVal === 'string' && looksLikePath(fieldVal)) {
        expectedOutputs.push(fieldVal);
      } else if (Array.isArray(fieldVal)) {
        for (var a = 0; a < fieldVal.length; a++) {
          if (typeof fieldVal[a] === 'string' && looksLikePath(fieldVal[a])) {
            expectedOutputs.push(fieldVal[a]);
          }
        }
      }
    }
  }

  if (expectedOutputs.length === 0) {
    return {
      check: check(
        'verification',
        'pass',
        'No file-path outputs declared in bounded_plan; verification not applicable'
      ),
      missingArtifacts: []
    };
  }

  // Check existence of each expected output
  var missing = [];
  var found = 0;

  for (var p = 0; p < expectedOutputs.length; p++) {
    var outputPath = expectedOutputs[p];
    var absPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.resolve(projectRoot, outputPath);

    if (fs.existsSync(absPath)) {
      found++;
    } else {
      missing.push(outputPath);
    }
  }

  if (missing.length === 0) {
    return {
      check: check(
        'verification',
        'pass',
        'All ' + expectedOutputs.length + ' expected output(s) exist'
      ),
      missingArtifacts: []
    };
  }

  return {
    check: check(
      'verification',
      'fail',
      found + '/' + expectedOutputs.length + ' outputs found; ' +
        missing.length + ' missing'
    ),
    missingArtifacts: missing
  };
}

/**
 * Check 2: Outcome capture — outcome_delta written AND canonical outcome
 * artifact exists.
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ check: object, missingArtifacts: string[] }}
 */
function checkOutcomeCapture(projectRoot, planJson) {
  var taskId = extractTaskId(planJson);
  if (!taskId) {
    return {
      check: check('outcome_capture', 'skip', 'No task_id in plan'),
      missingArtifacts: []
    };
  }

  var missing = [];
  var details = [];

  // Check outcome_delta in plan JSON
  var hasOutcomeDelta = planJson.outcome_delta !== null &&
    planJson.outcome_delta !== undefined;

  if (!hasOutcomeDelta) {
    details.push('outcome_delta is missing from plan JSON');
  }

  // Check canonical outcome artifact
  var outcomePath = path.join(projectRoot, OUTCOME_DIR, taskId + '.json');
  var outcomeExists = fs.existsSync(outcomePath);

  if (!outcomeExists) {
    missing.push(path.join(OUTCOME_DIR, taskId + '.json'));
    details.push('canonical outcome artifact missing');
  }

  if (hasOutcomeDelta && outcomeExists) {
    return {
      check: check(
        'outcome_capture',
        'pass',
        'outcome_delta present and canonical artifact exists at ' +
          path.join(OUTCOME_DIR, taskId + '.json')
      ),
      missingArtifacts: []
    };
  }

  return {
    check: check(
      'outcome_capture',
      'fail',
      details.join('; ')
    ),
    missingArtifacts: missing
  };
}

/**
 * Check 3: Review-lane artifacts — the artifacts required by the plan's
 * routing_expectations.review_lane exist.
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ check: object, missingArtifacts: string[], lane: string|null }}
 */
function checkReviewLaneArtifacts(projectRoot, planJson) {
  var routing = planJson.routing_expectations;
  if (!routing || !routing.review_lane) {
    return {
      check: check(
        'review_lane_artifacts',
        'skip',
        'No review_lane declared in routing_expectations'
      ),
      missingArtifacts: [],
      lane: null
    };
  }

  var lane = routing.review_lane;
  var taskId = extractTaskId(planJson);
  var found = [];
  var missing = [];

  if (lane === 'verify-local') {
    var scope = taskId;
    var verifyPath = path.join(
      projectRoot, ANALYSIS_DIR, 'verify-local__' + scope + '.json'
    );
    if (fs.existsSync(verifyPath)) {
      found.push(path.join(ANALYSIS_DIR, 'verify-local__' + scope + '.json'));
    } else {
      missing.push(path.join(ANALYSIS_DIR, 'verify-local__' + scope + '.json'));
    }
  } else if (lane === 'codex-bridge') {
    var cbScope = deriveCodexBridgeScope(planJson);

    var signalRelPath = path.join(
      SIGNAL_DIR, 'codex-bridge__' + cbScope + '.signal.json'
    );
    var promptRelPath = path.join(
      ANALYSIS_DIR, 'codex-bridge-prompt__' + cbScope + '.md'
    );

    var signalAbsPath = path.join(projectRoot, signalRelPath);
    var promptAbsPath = path.join(projectRoot, promptRelPath);

    if (fs.existsSync(signalAbsPath)) {
      found.push(signalRelPath);
    } else {
      missing.push(signalRelPath);
    }

    if (fs.existsSync(promptAbsPath)) {
      found.push(promptRelPath);
    } else {
      missing.push(promptRelPath);
    }
  } else if (lane === 'operator-gate') {
    var approval = planJson.approval || planJson.approved;
    if (approval && (approval.status === 'approved' || approval.by === 'operator')) {
      found.push('plan.approval (operator)');
    } else {
      missing.push('plan.approval (operator required)');
    }
  } else {
    return {
      check: check(
        'review_lane_artifacts',
        'skip',
        'Unknown review_lane "' + lane + '"; cannot verify artifacts'
      ),
      missingArtifacts: [],
      lane: lane
    };
  }

  if (missing.length === 0) {
    return {
      check: check(
        'review_lane_artifacts',
        'pass',
        'All review-lane artifacts present for lane "' + lane + '": ' +
          found.join(', ')
      ),
      missingArtifacts: [],
      lane: lane
    };
  }

  return {
    check: check(
      'review_lane_artifacts',
      'fail',
      'Missing review-lane artifacts for lane "' + lane + '": ' +
        missing.join(', ')
    ),
    missingArtifacts: missing,
    lane: lane
  };
}

/**
 * Check 4: Actor-bridge state — if review lane is cross-actor, determine
 * bridge state and enforce that complete is illegal before feedback_received.
 *
 * Uses the durable bridge state store from codex-bridge.js rather than
 * inferring from signal lifecycle text. Falls back to signal file inspection
 * when no bridge state entry exists.
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ check: object, bridgeState: string|null }}
 */
function checkActorBridgeState(projectRoot, planJson) {
  var routing = planJson.routing_expectations;
  if (!routing || routing.review_lane !== 'codex-bridge') {
    return {
      check: check(
        'actor_bridge_state',
        'skip',
        'Review lane is not cross-actor; bridge state not applicable'
      ),
      bridgeState: null
    };
  }

  var scope = deriveCodexBridgeScope(planJson);

  // Primary path: use the durable bridge state store
  var bridge = getBridgeFns();
  if (bridge.isBridgeComplete(projectRoot, scope)) {
    return {
      check: check(
        'actor_bridge_state',
        'pass',
        'Bridge feedback received (from bridge state store, scope: "' + scope + '")'
      ),
      bridgeState: 'feedback_received'
    };
  }

  var bridgeEntry = bridge.getBridgeState(projectRoot, scope);
  if (bridgeEntry) {
    return {
      check: check(
        'actor_bridge_state',
        'fail',
        'Bridge state is "' + bridgeEntry.state +
          '" (scope: "' + scope +
          '"); completion blocked until feedback_received'
      ),
      bridgeState: bridgeEntry.state
    };
  }

  // Fallback: check signal file when no bridge state entry exists
  var signalPath = path.join(
    projectRoot, SIGNAL_DIR, 'codex-bridge__' + scope + '.signal.json'
  );

  var signal = readJsonSafe(signalPath);
  if (!signal) {
    return {
      check: check(
        'actor_bridge_state',
        'fail',
        'No codex-bridge signal exists for scope "' + scope +
          '"; bridge not yet prepared'
      ),
      bridgeState: null
    };
  }

  // Signal exists — determine bridge state from lifecycle_state as fallback
  var lifecycleState = signal.lifecycle_state;
  var bridgeState;

  if (FEEDBACK_TERMINAL_STATES.indexOf(lifecycleState) !== -1) {
    bridgeState = 'feedback_received';
  } else if (lifecycleState === 'live') {
    if (signal.recommended_next_actor) {
      bridgeState = 'bridge_active';
    } else {
      bridgeState = 'handoff_prepared';
    }
  } else if (lifecycleState === 'stale' || lifecycleState === 'blocked') {
    bridgeState = 'blocked_on_actor_bridge';
  } else {
    bridgeState = 'handoff_prepared';
  }

  if (bridgeState === 'feedback_received') {
    return {
      check: check(
        'actor_bridge_state',
        'pass',
        'Bridge feedback received (lifecycle_state: "' + lifecycleState + '")'
      ),
      bridgeState: bridgeState
    };
  }

  return {
    check: check(
      'actor_bridge_state',
      'fail',
      'Bridge state is "' + bridgeState +
        '" (lifecycle_state: "' + lifecycleState +
        '"); completion blocked until feedback_received'
    ),
    bridgeState: bridgeState
  };
}

/**
 * Check 5: Lessons/debrief cadence — check if a debrief artifact exists
 * for this task when required.
 *
 * For meaningful framework runs, debrief is always mandatory.
 * Otherwise, debrief is advisory only (check reports but does not block).
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @param {boolean} isMeaningfulFrameworkRun
 * @returns {{ check: object, missingArtifacts: string[] }}
 */
function checkDebriefCadence(projectRoot, planJson, isMeaningfulFrameworkRun) {
  var taskId = extractTaskId(planJson);
  if (!taskId) {
    return {
      check: check('debrief_cadence', 'skip', 'No task_id in plan'),
      missingArtifacts: []
    };
  }

  // Look for debrief artifacts matching this task-id
  // Pattern: run-debrief__{task-id}*.json (improve-plan and replicate-plan)
  var analysisDir = path.join(projectRoot, ANALYSIS_DIR);
  var hasDebrief = false;

  if (fs.existsSync(analysisDir) && fs.statSync(analysisDir).isDirectory()) {
    var files = fs.readdirSync(analysisDir);
    var debriefPrefix = 'run-debrief__' + taskId;

    for (var i = 0; i < files.length; i++) {
      if (files[i].indexOf(debriefPrefix) === 0 && files[i].endsWith('.json')) {
        hasDebrief = true;
        break;
      }
    }

    // Also check date-prefixed patterns: run-debrief__{date}__{task-id}
    if (!hasDebrief) {
      var debriefInfix = '__' + taskId;
      for (var j = 0; j < files.length; j++) {
        if (
          files[j].indexOf('run-debrief__') === 0 &&
          files[j].indexOf(debriefInfix) !== -1 &&
          files[j].endsWith('.json')
        ) {
          hasDebrief = true;
          break;
        }
      }
    }
  }

  if (hasDebrief) {
    return {
      check: check(
        'debrief_cadence',
        'pass',
        'Debrief artifact(s) found for task "' + taskId + '"'
      ),
      missingArtifacts: []
    };
  }

  // No debrief found
  if (isMeaningfulFrameworkRun) {
    return {
      check: check(
        'debrief_cadence',
        'fail',
        'Meaningful framework run requires debrief; no debrief artifact found for "' +
          taskId + '"'
      ),
      missingArtifacts: [
        path.join(ANALYSIS_DIR, 'run-debrief__' + taskId + '.improve-plan.json'),
        path.join(ANALYSIS_DIR, 'run-debrief__' + taskId + '.replicate-plan.json')
      ]
    };
  }

  // Not a mandatory debrief — advisory only
  return {
    check: check(
      'debrief_cadence',
      'pass',
      'No debrief artifact found for "' + taskId +
        '"; not required for this run type (advisory: consider debriefing)'
    ),
    missingArtifacts: []
  };
}

/**
 * Check 6: Queue refresh — classify the plan's current state using the
 * shared completion classifier.
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ check: object, classifiedState: object }}
 */
function checkQueueRefresh(projectRoot, planJson) {
  var classification = classifyPlanState(projectRoot, planJson);

  return {
    check: check(
      'queue_refresh',
      'pass',
      'Plan classified as "' + classification.state + '": ' + classification.reason
    ),
    classifiedState: classification
  };
}

// ---------------------------------------------------------------------------
// Exported: main reflex check
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ReflexResult
 * @property {boolean} canComplete - Whether all requirements are met for completion
 * @property {string} state - 'pass' | 'blocked' | 'missing_artifacts' | 'missing_debrief' | 'bridge_pending'
 * @property {object[]} checks - Array of { name, status: 'pass'|'fail'|'skip', detail }
 * @property {string[]} missingArtifacts - Paths to artifacts that should exist but don't
 * @property {string|null} bridgeState - Current actor-bridge state if applicable
 * @property {object|null} nextAction - { command, reason } for what must happen next if not complete
 */

/**
 * Run the post-execution reflex check for a completed slice.
 * Returns a structured result indicating what passed, what's missing, and
 * whether the slice can be classified complete.
 *
 * This controller NEVER writes files — it only checks and reports.
 * The caller is responsible for acting on the result.
 *
 * @param {string} projectRoot - Absolute path to Mythos repo root.
 * @param {object} planJson - The plan JSON artifact.
 * @param {object} options
 * @param {string} options.caller - Which command invoked the controller
 *   ('run-plan', 'execute-plan', 'follow-signal', 'run-framework').
 * @param {boolean} [options.isMeaningfulFrameworkRun=false] - Whether this is
 *   a meaningful framework execution.
 * @param {string} [options.runId] - Optional run identifier for cost tracking.
 * @returns {ReflexResult}
 */
function runReflexCheck(projectRoot, planJson, options) {
  var opts = options || {};
  var caller = opts.caller || '';
  var isMeaningfulFrameworkRun = opts.isMeaningfulFrameworkRun === true;

  // Validate caller
  if (VALID_CALLERS.indexOf(caller) === -1) {
    return {
      canComplete: false,
      state: 'blocked',
      checks: [
        check(
          'caller_validation',
          'fail',
          'Invalid caller "' + caller + '"; must be one of: ' +
            VALID_CALLERS.join(', ')
        )
      ],
      missingArtifacts: [],
      bridgeState: null,
      nextAction: {
        command: null,
        reason: 'Reflex controller invoked with invalid caller "' + caller + '"'
      }
    };
  }

  // Validate planJson has minimum required fields
  if (!planJson || typeof planJson !== 'object') {
    return {
      canComplete: false,
      state: 'blocked',
      checks: [
        check('plan_validation', 'fail', 'planJson is null or not an object')
      ],
      missingArtifacts: [],
      bridgeState: null,
      nextAction: {
        command: null,
        reason: 'No valid plan JSON provided'
      }
    };
  }

  var taskId = extractTaskId(planJson);
  if (!taskId) {
    return {
      canComplete: false,
      state: 'blocked',
      checks: [
        check('plan_validation', 'fail', 'planJson has no task_id')
      ],
      missingArtifacts: [],
      bridgeState: null,
      nextAction: {
        command: null,
        reason: 'Plan has no task_id; cannot run reflex checks'
      }
    };
  }

  // Run all checks in order
  var checks = [];
  var allMissing = [];
  var bridgeState = null;
  var hasFailure = false;
  var failureState = null;

  // 1. Verification
  var verificationResult = checkVerification(projectRoot, planJson);
  checks.push(verificationResult.check);
  if (verificationResult.missingArtifacts.length > 0) {
    allMissing = allMissing.concat(verificationResult.missingArtifacts);
  }
  if (verificationResult.check.status === 'fail') {
    hasFailure = true;
    if (!failureState) failureState = 'missing_artifacts';
  }

  // 2. Outcome capture
  var outcomeResult = checkOutcomeCapture(projectRoot, planJson);
  checks.push(outcomeResult.check);
  if (outcomeResult.missingArtifacts.length > 0) {
    allMissing = allMissing.concat(outcomeResult.missingArtifacts);
  }
  if (outcomeResult.check.status === 'fail') {
    hasFailure = true;
    if (!failureState) failureState = 'missing_artifacts';
  }

  // 3. Review-lane artifacts
  var reviewResult = checkReviewLaneArtifacts(projectRoot, planJson);
  checks.push(reviewResult.check);
  if (reviewResult.missingArtifacts.length > 0) {
    allMissing = allMissing.concat(reviewResult.missingArtifacts);
  }
  if (reviewResult.check.status === 'fail') {
    hasFailure = true;
    if (!failureState) failureState = 'missing_artifacts';
  }

  // 4. Actor-bridge state
  var bridgeResult = checkActorBridgeState(projectRoot, planJson);
  checks.push(bridgeResult.check);
  bridgeState = bridgeResult.bridgeState;
  if (bridgeResult.check.status === 'fail') {
    hasFailure = true;
    // Bridge pending takes priority over missing_artifacts for state
    if (!failureState || failureState === 'missing_artifacts') {
      failureState = 'bridge_pending';
    }
  }

  // 5. Debrief cadence
  var debriefResult = checkDebriefCadence(
    projectRoot, planJson, isMeaningfulFrameworkRun
  );
  checks.push(debriefResult.check);
  if (debriefResult.missingArtifacts.length > 0) {
    allMissing = allMissing.concat(debriefResult.missingArtifacts);
  }
  if (debriefResult.check.status === 'fail') {
    hasFailure = true;
    if (!failureState) failureState = 'missing_debrief';
  }

  // 6. Queue refresh
  var queueResult = checkQueueRefresh(projectRoot, planJson);
  checks.push(queueResult.check);

  // Determine overall state
  if (!hasFailure) {
    return {
      canComplete: true,
      state: 'pass',
      checks: checks,
      missingArtifacts: allMissing,
      bridgeState: bridgeState,
      nextAction: null
    };
  }

  // Determine next action based on failure state
  var nextAction = determineNextAction(
    failureState, planJson, reviewResult, bridgeState, debriefResult,
    allMissing, caller
  );

  return {
    canComplete: false,
    state: failureState,
    checks: checks,
    missingArtifacts: allMissing,
    bridgeState: bridgeState,
    nextAction: nextAction
  };
}

/**
 * Determine the recommended next action based on the failure state.
 *
 * @param {string} failureState
 * @param {object} planJson
 * @param {object} reviewResult
 * @param {string|null} bridgeState
 * @param {object} debriefResult
 * @param {string[]} missingArtifacts
 * @param {string} caller
 * @returns {{ command: string|null, reason: string }}
 */
function determineNextAction(
  failureState, planJson, reviewResult, bridgeState, debriefResult,
  missingArtifacts, caller
) {
  var taskId = extractTaskId(planJson);

  if (failureState === 'bridge_pending') {
    if (!bridgeState || bridgeState === 'handoff_prepared' || bridgeState === 'bridge_active') {
      return {
        command: '/follow-signal codex-bridge__' + deriveCodexBridgeScope(planJson),
        reason: 'Actor bridge is in state "' + (bridgeState || 'unknown') +
          '"; waiting for external review feedback'
      };
    }
    if (bridgeState === 'blocked_on_actor_bridge') {
      return {
        command: '/follow-signal codex-bridge__' + deriveCodexBridgeScope(planJson),
        reason: 'Actor bridge is blocked; investigate signal state and resolve'
      };
    }
  }

  if (failureState === 'missing_debrief') {
    return {
      command: '/debrief-run ' + taskId,
      reason: 'Debrief is required but no debrief artifact exists for "' + taskId + '"'
    };
  }

  if (failureState === 'missing_artifacts') {
    // Determine which type of artifact is missing
    var lane = reviewResult && reviewResult.lane;

    if (lane === 'codex-bridge' && reviewResult.missingArtifacts.length > 0) {
      return {
        command: '/follow-signal --prepare-bridge ' + taskId,
        reason: 'Review-lane artifacts missing for codex-bridge: ' +
          reviewResult.missingArtifacts.join(', ')
      };
    }

    if (lane === 'verify-local' && reviewResult.missingArtifacts.length > 0) {
      return {
        command: '/run-framework verify-local --scope ' + taskId,
        reason: 'verify-local artifact missing; run local verification'
      };
    }

    if (lane === 'operator-gate' && reviewResult.missingArtifacts.length > 0) {
      return {
        command: null,
        reason: 'Operator approval required; present findings and request explicit approval'
      };
    }

    // Generic missing artifacts
    return {
      command: '/' + caller + ' ' + taskId,
      reason: 'Missing artifacts: ' + missingArtifacts.join(', ')
    };
  }

  // Fallback
  return {
    command: null,
    reason: 'Reflex check failed in state "' + failureState + '"; manual review required'
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runReflexCheck,
  // Expose constants for testing and caller reference
  VALID_CALLERS,
  BRIDGE_STATES
};
