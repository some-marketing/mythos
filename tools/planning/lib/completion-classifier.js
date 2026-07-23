'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths, listAllTaskPlans } = require('./resolve-task-plan');
const { normalizeProvenance, isDistinctIntelligence } = require('./provenance-utils');
const { validateVerdictEnvelope } = require('../../verify/lib/verdict-envelope.cjs');
const { assertRelativePath, resolveContainedFile } = require('../../verify/lib/run-evidence-index.cjs');

// Lazy-loaded to avoid circular dependency (codex-bridge imports from completion-classifier)
let _bridgeFns = null;
function getBridgeFns() {
  if (!_bridgeFns) {
    _bridgeFns = require('../../signals/lib/codex-bridge');
  }
  return _bridgeFns;
}

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
 * Check whether a durable outcome artifact exists for a task-id.
 * @param {string} projectRoot
 * @param {string} taskId
 * @returns {{ exists: boolean, path: string }}
 */
function checkOutcomeArtifact(projectRoot, taskId) {
  const outcomePath = path.join(projectRoot, OUTCOME_DIR, taskId + '.json');
  const exists = fs.existsSync(outcomePath);
  let parsed = null;
  if (exists) {
    parsed = readJsonSafe(outcomePath);
  }
  return { exists, valid: !exists || parsed !== null, path: outcomePath, parsed };
}

function checkCompletionReviewReceipt(projectRoot, taskId, outcomeParsed) {
  const completionEvidence = outcomeParsed && (
    outcomeParsed.completion_evidence ||
    (outcomeParsed.outcome_delta && outcomeParsed.outcome_delta.completion_evidence)
  );
  if (!completionEvidence || completionEvidence.distinct_completion_review_received !== true) {
    return { declared: false, accepted: false, path: null, reason: 'not_declared' };
  }

  const statePath = path.join(projectRoot, '_dev', 'state', 'plan-task-review-state', taskId + '.json');
  if (fs.existsSync(statePath)) {
    const state = readJsonSafe(statePath);
    if (!state || state.schema !== 'PlanTaskReviewState/1.0' || state.task_id !== taskId) {
      return { declared: true, accepted: false, path: null, reason: 'review_state_invalid_or_mismatched' };
    }
    const completionReview = state.completion_review;
    const acceptedDecisions = ['approved', 'approved_after_repair', 'approved_portfolio_closeout'];
    if (!completionReview || !acceptedDecisions.includes(completionReview.decision) ||
        completionReview.blocking_findings !== 0) {
      return { declared: true, accepted: false, path: completionReview && completionReview.artifact, reason: 'review_state_not_acceptance_grade' };
    }
    const producer = normalizeProvenance(outcomeParsed, 'produced_by');
    const reviewerId = completionReview.decided_by_actor_id;
    if (!producer || !reviewerId || reviewerId === producer.actor_id) {
      return { declared: true, accepted: false, path: completionReview.artifact || null, reason: 'reviewer_missing_or_not_distinct' };
    }
    let safeStateArtifact;
    let resolvedStateArtifact;
    try {
      safeStateArtifact = assertRelativePath(completionReview.artifact, 'completion_review.artifact');
      if (!safeStateArtifact.startsWith('_dev/reports/analysis/')) throw new Error('invalid review directory');
      resolvedStateArtifact = resolveContainedFile(projectRoot, safeStateArtifact);
    } catch (_error) {
      return { declared: true, accepted: false, path: completionReview.artifact || null, reason: 'review_path_boundary_violation' };
    }
    if (!resolvedStateArtifact.exists) {
      return { declared: true, accepted: false, path: safeStateArtifact, reason: 'review_missing_or_invalid' };
    }
    const distinctReview = Array.isArray(state.distinct_reviews)
      ? state.distinct_reviews.find(function (entry) {
          return entry && entry.artifact === safeStateArtifact;
        })
      : null;
    if (distinctReview && (distinctReview.actor !== reviewerId ||
        !['approve', 'approved', 'approved_after_repair', 'approved_portfolio_closeout'].includes(distinctReview.verdict))) {
      return { declared: true, accepted: false, path: safeStateArtifact, reason: 'distinct_review_binding_conflict' };
    }
    if (distinctReview && distinctReview.artifact_sha256) {
      const actualHash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(resolvedStateArtifact.real)).digest('hex');
      if (actualHash !== distinctReview.artifact_sha256) {
        return { declared: true, accepted: false, path: safeStateArtifact, reason: 'review_artifact_hash_mismatch' };
      }
    }
    return { declared: true, accepted: true, path: safeStateArtifact, reason: 'approved_completion_review_state' };
  }

  const declared = completionEvidence.distinct_review_artifact;
  let safe;
  try {
    safe = assertRelativePath(declared, 'distinct_review_artifact');
  } catch (_error) {
    return { declared: true, accepted: false, path: declared || null, reason: 'invalid_review_path' };
  }
  if (!safe.startsWith('_dev/reports/analysis/')) {
    return { declared: true, accepted: false, path: safe, reason: 'invalid_review_directory' };
  }

  let resolved;
  try {
    resolved = resolveContainedFile(projectRoot, safe);
  } catch (_error) {
    return { declared: true, accepted: false, path: safe, reason: 'review_path_boundary_violation' };
  }
  const review = resolved.exists ? readJsonSafe(resolved.real) : null;
  if (!review) return { declared: true, accepted: false, path: safe, reason: 'review_missing_or_invalid' };

  const blockers = Array.isArray(review.blocking_findings) ? review.blocking_findings : null;
  const provenance = checkProvenanceValidation(outcomeParsed);
  const acceptedDecisions = ['approved', 'approved_after_repair'];
  const accepted = review.schema === 'ImplementationReview/1.0' &&
    review.task_id === taskId &&
    acceptedDecisions.includes(review.decision) &&
    blockers !== null && blockers.length === 0 &&
    review.acceptance && review.acceptance.completion_authorized === true &&
    provenance.required && provenance.satisfied;
  return {
    declared: true,
    accepted: Boolean(accepted),
    path: safe,
    reason: accepted ? 'approved_completion_review' : 'review_not_acceptance_grade'
  };
}

/**
 * Check review-lane-specific closeout artifacts.
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ satisfied: boolean, lane: string|null, found: string[], missing: string[] }}
 */
function checkReviewLaneArtifacts(projectRoot, planJson) {
  const routing = planJson.routing_expectations;
  if (!routing || !routing.review_lane) {
    return { satisfied: true, lane: null, found: [], missing: [] };
  }

  const lane = routing.review_lane;
  const taskId = planJson.task_id;
  const found = [];
  const missing = [];

  if (lane === 'verify-local') {
    const verifyPath = path.join(
      projectRoot, ANALYSIS_DIR, 'verify-local__' + taskId + '.json'
    );
    if (fs.existsSync(verifyPath)) {
      found.push(verifyPath);
    } else {
      missing.push(verifyPath);
    }
  } else if (lane === 'codex-bridge') {
    const outcome = checkOutcomeArtifact(projectRoot, taskId).parsed;
    const completionReview = checkCompletionReviewReceipt(projectRoot, taskId, outcome);
    if (completionReview.accepted) {
      found.push(path.join(projectRoot, completionReview.path));
      return { satisfied: true, lane: lane, found: found, missing: missing };
    }
    if (completionReview.declared) {
      missing.push('completion review receipt: ' + completionReview.reason);
      return { satisfied: false, lane: lane, found: found, missing: missing };
    }

    // Derive the scope from the signal_scope or fall back to task-id
    const scope = deriveCodexBridgeScope(planJson);

    const signalPath = path.join(
      projectRoot, SIGNAL_DIR, 'codex-bridge__' + scope + '.signal.json'
    );
    const closedSignalPath = path.join(
      projectRoot, SIGNAL_DIR, 'closed', 'codex-bridge__' + scope + '.signal.json'
    );
    const promptPath = path.join(
      projectRoot, ANALYSIS_DIR, 'codex-bridge-prompt__' + scope + '.md'
    );

    if (fs.existsSync(signalPath)) {
      found.push(signalPath);
    } else if (fs.existsSync(closedSignalPath)) {
      found.push(closedSignalPath);
    } else {
      missing.push(signalPath);
    }

    if (fs.existsSync(promptPath)) {
      found.push(promptPath);
    } else {
      missing.push(promptPath);
    }

    const feedback = findBridgeFeedbackArtifacts(projectRoot, scope);
    found.push(...feedback.found);
    missing.push(...feedback.missing);
  } else if (lane === 'operator-gate') {
    // Operator-gate lane: check for operator approval in plan metadata
    const approval = planJson.approval || planJson.approved;
    if (approval && (approval.status === 'approved' || approval.by === 'operator')) {
      found.push('plan.approval (operator)');
    } else {
      missing.push('plan.approval (operator required)');
    }
  }

  return {
    satisfied: missing.length === 0,
    lane: lane,
    found: found,
    missing: missing
  };
}

function findBridgeFeedbackArtifacts(projectRoot, scope) {
  const analysisDir = path.join(projectRoot, ANALYSIS_DIR);
  const signalDir = path.join(projectRoot, SIGNAL_DIR);
  const safeScope = String(scope || '');
  const found = [];
  const missing = [];

  let resultFound = false;
  if (fs.existsSync(analysisDir)) {
    const resultPattern = new RegExp('^(codex|claude)-cli-run__.+__' + escapeRegExp(safeScope) + '\\.result\\.json$');
    for (const name of fs.readdirSync(analysisDir)) {
      if (!resultPattern.test(name)) continue;
      const resultPath = path.join(analysisDir, name);
      const parsed = readJsonSafe(resultPath);
      if (parsed && parsed.outcome === 'success' && parsed.closeout_coherent === true) {
        found.push(resultPath);
        resultFound = true;
        break;
      }
    }
  }
  if (!resultFound) {
    missing.push(path.join(analysisDir, '*-cli-run__*__' + safeScope + '.result.json (success + closeout_coherent)'));
  }

  let feedbackSignalFound = false;
  for (const dir of [signalDir, path.join(signalDir, 'closed')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('ready-for-review__') || !name.endsWith('__' + safeScope + '.json')) continue;
      const signalPath = path.join(dir, name);
      const parsed = readJsonSafe(signalPath);
      if (parsed && parsed.run_outcome && parsed.run_outcome.success === true) {
        found.push(signalPath);
        feedbackSignalFound = true;
        break;
      }
    }
    if (feedbackSignalFound) break;
  }
  if (!feedbackSignalFound) {
    missing.push(path.join(signalDir, 'ready-for-review__*__' + safeScope + '.json (run_outcome.success=true)'));
  }

  return { found, missing };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive the codex-bridge scope identifier from a plan.
 * Looks for an explicit scope in routing_expectations, falls back to task-id.
 * @param {object} planJson
 * @returns {string}
 */
function deriveCodexBridgeScope(planJson) {
  const routing = planJson.routing_expectations;
  if (routing && routing.codex_bridge_scope) {
    return routing.codex_bridge_scope;
  }
  return planJson.task_id;
}

/**
 * Determine whether a plan has any execution evidence.
 * Execution evidence is any of:
 * - outcome_delta exists (even if not completed)
 * - bounded_plan.steps with evidence of execution (approval, step completion markers)
 * - approval/approved fields present
 * @param {object} planJson
 * @returns {boolean}
 */
function hasExecutionEvidence(planJson) {
  if (planJson.outcome_delta) return true;
  if (planJson.approval && planJson.approval.status) return true;
  if (planJson.approved && planJson.approved.by) return true;
  return false;
}

/**
 * Determine whether a plan's codex-bridge is in a blocked state.
 * Uses the durable bridge state store from codex-bridge.js rather than
 * inferring from signal lifecycle text.
 *
 * Blocked when the review lane requires codex-bridge AND the bridge is
 * not complete (feedback_received) per the state store. Falls back to
 * signal file inspection when no bridge state entry exists.
 *
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {{ blocked: boolean, reason: string|null }}
 */
function checkBridgeBlocked(projectRoot, planJson) {
  const routing = planJson.routing_expectations;
  if (!routing || routing.review_lane !== 'codex-bridge') {
    return { blocked: false, reason: null };
  }

  const scope = deriveCodexBridgeScope(planJson);
  const outcome = checkOutcomeArtifact(projectRoot, planJson.task_id).parsed;
  const completionReview = checkCompletionReviewReceipt(projectRoot, planJson.task_id, outcome);
  if (completionReview.accepted) return { blocked: false, reason: null };
  if (completionReview.declared) {
    return {
      blocked: true,
      reason: 'declared completion review receipt is not acceptance-grade: ' + completionReview.reason
    };
  }

  // Primary path: use the durable bridge state store
  const bridge = getBridgeFns();
  if (bridge.isBridgeComplete(projectRoot, scope)) {
    return { blocked: false, reason: null };
  }

  const bridgeEntry = bridge.getBridgeState(projectRoot, scope);
  if (bridgeEntry) {
    return {
      blocked: true,
      reason: 'codex-bridge state is "' + bridgeEntry.state +
        '" for scope "' + scope + '" (expected "feedback_received")'
    };
  }

  const feedback = findBridgeFeedbackArtifacts(projectRoot, scope);
  if (feedback.missing.length === 0) {
    return { blocked: false, reason: null };
  }

  // Fallback: check signal file when no bridge state entry exists
  const signalPath = path.join(
    projectRoot, SIGNAL_DIR, 'codex-bridge__' + scope + '.signal.json'
  );

  const signal = readJsonSafe(signalPath);
  if (!signal) {
    return {
      blocked: true,
      reason: 'codex-bridge signal does not exist for scope "' + scope + '"'
    };
  }

  // Signal exists — check lifecycle_state
  const state = signal.lifecycle_state;
  if (state === 'feedback_received' || state === 'consumed') {
    return { blocked: false, reason: null };
  }

  return {
    blocked: true,
    reason: 'codex-bridge signal lifecycle_state is "' + state +
      '" (expected "feedback_received" or "consumed")'
  };
}

// ---------------------------------------------------------------------------
// Distinct-intelligence validation (imported from provenance-utils.js)
// ---------------------------------------------------------------------------

/**
 * Check whether a plan has acceptance-grade provenance validation.
 *
 * When the plan's produced_by actor_type is "intelligence", the validated_by
 * fields must specify a distinct actor_id AND harness_id. If produced_by is
 * absent or actor_type is not "intelligence", provenance is not required.
 *
 * @param {object} planJson
 * @returns {{ required: boolean, satisfied: boolean, reason: string }}
 */
function checkProvenanceValidation(planJson) {
  // Accept both flat fields (produced_by_actor_id) and nested objects (produced_by: {})
  const producedBy = normalizeProvenance(planJson, 'produced_by');
  if (!producedBy || producedBy.actor_type !== 'intelligence') {
    return { required: false, satisfied: true, reason: 'provenance validation not required (no intelligence producer)' };
  }
  const validatedBy = normalizeProvenance(planJson, 'validated_by');
  if (!validatedBy) {
    return { required: true, satisfied: false, reason: 'produced_by is intelligence but validated_by is missing' };
  }
  if (isDistinctIntelligence(producedBy, validatedBy)) {
    return { required: true, satisfied: true, reason: 'distinct intelligence validation satisfied' };
  }
  return {
    required: true,
    satisfied: false,
    reason: 'validated_by is not distinct from produced_by (requires different actor_id AND harness_id, validator must be intelligence)'
  };
}

// ---------------------------------------------------------------------------
// 4-criteria completion helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether all bounded_plan steps are marked done.
 * Per operator decision: missing data = incomplete. If bounded_plan or
 * steps array is absent/empty, the plan is NOT considered all-steps-done.
 * @param {object} planJson
 * @returns {boolean}
 */
function checkAllStepsDone(planJson) {
  const steps = planJson.bounded_plan && planJson.bounded_plan.steps;
  if (!Array.isArray(steps) || steps.length === 0) return false; // missing data = incomplete
  return steps.every(function (s) { return s.status === 'done' || s.status === 'complete'; });
}

/**
 * Determine whether verification has passed.
 * Looks for outcome_delta.verification_passed or a verification field.
 * @param {object} planJson
 * @returns {boolean}
 */
function checkVerificationPassed(planJson) {
  const od = planJson.outcome_delta;
  if (od && od.verification_passed === true) return true;
  if (planJson.verification && planJson.verification.passed === true) return true;
  return false;
}

/**
 * Determine whether there are no open blockers.
 * @param {object} planJson
 * @returns {boolean}
 */
function checkNoOpenBlockers(planJson) {
  const blockers = planJson.blockers || (planJson.outcome_delta && planJson.outcome_delta.blockers);
  if (!Array.isArray(blockers) || blockers.length === 0) return true;
  return blockers.every(function (b) {
    var status = typeof b === 'string' ? '' : (b.status || '');
    return status === 'resolved' || status === 'closed';
  });
}

/**
 * Determine whether operator acceptance has been received.
 * @param {object} planJson
 * @returns {boolean}
 */
function checkOperatorAcceptance(planJson) {
  if (planJson.approval && planJson.approval.status === 'approved') return true;
  if (planJson.approved && planJson.approved.by) return true;
  var od = planJson.outcome_delta;
  if (od && od.operator_accepted === true) return true;
  return false;
}

function hasOwnBoolean(source, field) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, field) && typeof source[field] === 'boolean');
}

function selectCompletionBoolean(field, outcomeParsed, planJson, fallback, aliases) {
  const outcomeTop = outcomeParsed && outcomeParsed.completion_evidence;
  const outcomeNested = outcomeParsed && outcomeParsed.outcome_delta && outcomeParsed.outcome_delta.completion_evidence;
  const planNested = planJson.outcome_delta && planJson.outcome_delta.completion_evidence;
  for (const candidate of [
    { value: outcomeTop, source: 'task_outcome.completion_evidence' },
    { value: outcomeNested, source: 'task_outcome.outcome_delta.completion_evidence' },
    { value: planNested, source: 'plan.outcome_delta.completion_evidence' }
  ]) {
    if (hasOwnBoolean(candidate.value, field)) {
      return { value: candidate.value[field], source: candidate.source + '.' + field };
    }
    for (const alias of aliases || []) {
      if (hasOwnBoolean(candidate.value, alias)) {
        return { value: candidate.value[alias], source: candidate.source + '.' + alias };
      }
    }
  }
  return { value: Boolean(fallback()), source: 'legacy_plan_fallback' };
}

function checkVerdictEnvelope(projectRoot, taskId, outcomeParsed) {
  const declared = outcomeParsed && (outcomeParsed.verdict_envelope_path ||
    (outcomeParsed.outcome_delta && outcomeParsed.outcome_delta.verdict_envelope_path));
  const conventional = path.join('_dev', 'reports', 'analysis', 'verdict-envelopes', taskId + '.json');
  const conventionalAbs = path.join(projectRoot, conventional);
  if (!declared && !fs.existsSync(conventionalAbs)) return { present: false, valid: true, accepted: false, reason: 'not_present', path: null };
  const relative = declared || conventional;
  let safe;
  try { safe = assertRelativePath(relative, 'verdict_envelope_path'); }
  catch (_) { return { present: true, valid: false, accepted: false, reason: 'invalid_envelope_path', path: relative }; }
  if (!safe.startsWith('_dev/reports/analysis/verdict-envelopes/')) return { present: true, valid: false, accepted: false, reason: 'invalid_envelope_directory', path: safe };
  if (declared && fs.existsSync(conventionalAbs) && path.normalize(declared) !== path.normalize(conventional)) {
    return { present: true, valid: false, accepted: false, reason: 'conflicting_envelope_paths', path: relative };
  }
  let resolved;
  try { resolved = resolveContainedFile(projectRoot, safe); }
  catch (_) { return { present: true, valid: false, accepted: false, reason: 'envelope_path_boundary_violation', path: safe }; }
  const envelope = resolved.exists ? readJsonSafe(resolved.real) : null;
  if (!envelope) return { present: true, valid: false, accepted: false, reason: 'declared_envelope_missing_or_invalid', path: relative };
  const keyring = readJsonSafe(path.join(projectRoot, 'tools', 'verify', 'keys', 'operator-public-keyring.json'));
  const result = validateVerdictEnvelope(envelope, keyring);
  if (envelope.task_id !== taskId) return { present: true, valid: false, accepted: false, reason: 'envelope_task_mismatch', path: relative };
  return { present: true, valid: result.ok, accepted: result.ok && result.accepted, reason: result.reason, path: safe };
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Classify a plan's lifecycle state from its durable artifacts.
 *
 * States:
 * - `planned`     — plan exists, no outcome_delta, no execution evidence
 * - `in_progress` — plan exists, some execution evidence but not all 4 completion criteria met
 * - `blocked`     — plan requires actor-bridge and bridge state is not terminal
 * - `complete`    — all 4 completion criteria met:
 *                   1. all_steps_done
 *                   2. verification_passed
 *                   3. no_open_blockers
 *                   4. operator_acceptance_received
 *                   Plus: outcome_delta.completed, durable outcome artifact, review-lane satisfied
 *                   Plus: distinct-intelligence provenance (when produced_by is intelligence)
 *
 * @param {string} projectRoot - Absolute path to Mythos repo root.
 * @param {object} planJson    - Parsed plan JSON.
 * @param {object} [options]   - Optional overrides.
 * @param {boolean} [options.skipOutcomeCheck] - Skip the durable outcome artifact check.
 * @returns {{ state: 'planned'|'in_progress'|'blocked'|'complete', reason: string, evidence: object }}
 */
function classifyPlanState(projectRoot, planJson, options) {
  const opts = options || {};
  const taskId = planJson.task_id;

  if (!taskId) {
    return {
      state: 'planned',
      reason: 'Plan has no task_id — treated as planned',
      evidence: { taskId: null }
    };
  }

  // Gather evidence
  const outcomeArtifact = checkOutcomeArtifact(projectRoot, taskId);
  const outcomeParsed = outcomeArtifact.parsed;
  
  // Prefer object-shaped outcome_delta. Ignore legacy strings in plan JSON.
  const planOutcomeDelta = (planJson.outcome_delta && typeof planJson.outcome_delta === 'object') ? planJson.outcome_delta : null;
  const outcomeDelta = (outcomeParsed && outcomeParsed.outcome_delta) || planOutcomeDelta || null;
  let outcomeDeltaCompleted = false;
  let outcomeDeltaSource = 'missing';
  if (outcomeArtifact.exists && !outcomeArtifact.valid) {
    outcomeDeltaSource = 'task_outcome_invalid';
  } else if (outcomeParsed && hasOwnBoolean(outcomeParsed.outcome_delta, 'completed')) {
    outcomeDeltaCompleted = outcomeParsed.outcome_delta.completed;
    outcomeDeltaSource = 'task_outcome.outcome_delta.completed';
  } else if (hasOwnBoolean(planOutcomeDelta, 'completed')) {
    outcomeDeltaCompleted = planOutcomeDelta.completed;
    outcomeDeltaSource = 'plan.outcome_delta.completed';
  }
  const reviewLane = checkReviewLaneArtifacts(projectRoot, planJson);
  const bridgeCheck = checkBridgeBlocked(projectRoot, planJson);
  const executionEvidence = hasExecutionEvidence(planJson) || (outcomeParsed !== null);

  // Read completion_evidence from task-outcome artifact (canonical location)
  // Falls back to plan-local outcome_delta.completion_evidence
  // Task-outcome fields take precedence one field at a time. Explicit false is authoritative.
  const allStepsSelection = selectCompletionBoolean('all_steps_done', outcomeParsed, planJson, function () { return checkAllStepsDone(planJson); });
  const verificationSelection = selectCompletionBoolean(
    'verification_passed',
    outcomeParsed,
    planJson,
    function () { return checkVerificationPassed(planJson); }
  );
  const blockersSelection = selectCompletionBoolean('no_open_blockers', outcomeParsed, planJson, function () { return checkNoOpenBlockers(planJson); });
  const allStepsDone = allStepsSelection.value;
  const verificationPassed = verificationSelection.value;
  const noOpenBlockers = blockersSelection.value;
  const verdictEnvelope = checkVerdictEnvelope(projectRoot, taskId, outcomeParsed);
  const acceptanceSelection = selectCompletionBoolean('operator_acceptance_received', outcomeParsed, planJson, function () { return checkOperatorAcceptance(planJson); });
  const operatorAcceptanceReceived = verdictEnvelope.present ? verdictEnvelope.accepted : acceptanceSelection.value;

  // Provenance: merge plan and task-outcome artifact provenance
  // If EITHER source shows an intelligence producer, require distinct validation
  const planProv = checkProvenanceValidation(planJson);
  const outcomeProv = outcomeParsed ? checkProvenanceValidation(outcomeParsed) : { required: false, satisfied: true, reason: 'no outcome artifact' };
  let provenance;
  if (planProv.required && planProv.satisfied) {
    provenance = planProv;
  } else if (outcomeProv.required && outcomeProv.satisfied) {
    provenance = outcomeProv;
  } else if (planProv.required || outcomeProv.required) {
    // At least one source requires validation but neither is satisfied
    provenance = planProv.required ? planProv : outcomeProv;
  } else {
    provenance = planProv;
  }

  const evidence = {
    taskId: taskId,
    outcomeDelta: {
      exists: outcomeDelta !== null,
      completed: outcomeDeltaCompleted,
      source: outcomeDeltaSource
    },
    outcomeArtifact: outcomeArtifact,
    reviewLane: reviewLane,
    bridgeBlocked: bridgeCheck,
    hasExecutionEvidence: executionEvidence,
    all_steps_done: allStepsDone,
    verification_passed: verificationPassed,
    no_open_blockers: noOpenBlockers,
    operator_acceptance_received: operatorAcceptanceReceived,
    verdict_envelope: verdictEnvelope,
    provenance: provenance,
    source_selection: {
      all_steps_done: allStepsSelection.source,
      verification_passed: verificationSelection.source,
      no_open_blockers: blockersSelection.source,
      operator_acceptance_received: verdictEnvelope.present ? 'verdict_envelope' : acceptanceSelection.source
    }
  };

  // ---- Complete: ALL criteria must be met ----
  const fourCriteriaMet = allStepsDone && verificationPassed && noOpenBlockers && operatorAcceptanceReceived;
  
  // Recovery bypass: plans marked as recovery-archive or manual-verification by 
  // the operator or recovery scripts bypass review-lane and provenance 
  // requirements to allow clearing legacy debt and finishing recovery tasks.
  const bypassMethods = ['recovery-archive', 'manual-verification'];
  const isBypassed = (outcomeParsed && bypassMethods.includes(outcomeParsed.validation_method)) ||
                    (outcomeDelta && bypassMethods.includes(outcomeDelta.validation_method));

  const artifactsMet = outcomeDeltaCompleted &&
    (opts.skipOutcomeCheck || outcomeArtifact.exists) &&
    (reviewLane.satisfied || isBypassed);
  const provenanceMet = provenance.satisfied || isBypassed;

  if (fourCriteriaMet && artifactsMet && provenanceMet) {
    return {
      state: 'complete',
      reason: 'All completion criteria met: ' +
        'all_steps_done, verification_passed, no_open_blockers, operator_acceptance_received, ' +
        'outcome_delta.completed=true, ' +
        (outcomeArtifact.exists ? 'durable outcome artifact exists' : 'outcome check skipped') +
        ', review-lane artifacts satisfied' +
        (reviewLane.lane ? ' (' + reviewLane.lane + ')' : '') +
        (provenance.required ? ', distinct-intelligence provenance validated' : ''),
      evidence: evidence
    };
  }

  // ---- Blocked: requires actor-bridge and bridge is not terminal ----
  if (bridgeCheck.blocked && executionEvidence) {
    return {
      state: 'blocked',
      reason: bridgeCheck.reason,
      evidence: evidence
    };
  }

  // ---- In-progress: some execution evidence, not complete ----
  if (executionEvidence) {
    const missingParts = [];
    if (!allStepsDone) {
      missingParts.push('not all steps done');
    }
    if (!verificationPassed) {
      missingParts.push('verification not passed');
    }
    if (!noOpenBlockers) {
      missingParts.push('open blockers remain');
    }
    if (!operatorAcceptanceReceived) {
      missingParts.push(verdictEnvelope.present ? `verdict envelope not accepted: ${verdictEnvelope.reason}` : 'operator acceptance not received');
    }
    if (!outcomeDeltaCompleted) {
      missingParts.push('outcome_delta.completed !== true');
    }
    if (!opts.skipOutcomeCheck && !outcomeArtifact.exists) {
      missingParts.push('no durable outcome artifact');
    }
    if (!reviewLane.satisfied) {
      missingParts.push('review-lane artifacts missing: ' + reviewLane.missing.join(', '));
    }
    if (!provenanceMet) {
      missingParts.push(provenance.reason);
    }

    return {
      state: 'in_progress',
      reason: 'Execution evidence found but completion not met: ' + missingParts.join('; '),
      evidence: evidence
    };
  }

  // ---- Planned: no execution evidence ----
  return {
    state: 'planned',
    reason: 'No execution evidence found — plan is in planned state',
    evidence: evidence
  };
}

/**
 * Check whether a plan is eligible for execution routing.
 * Only `planned` and `in_progress` states are executable.
 * Returns false for complete, blocked, or archived plans.
 *
 * @param {string} projectRoot - Absolute path to Mythos repo root.
 * @param {object} planJson    - Parsed plan JSON.
 * @returns {boolean}
 */
function isExecutable(projectRoot, planJson) {
  // Archived plans are never executable
  if (planJson.archived === true) return false;

  const classification = classifyPlanState(projectRoot, planJson);
  // Only planned and in_progress are executable — blocked is NOT executable
  return classification.state === 'planned' || classification.state === 'in_progress';
}

/**
 * List plans that qualify as READY TO EXECUTE.
 * Uses listAllTaskPlans() from the resolver and filters by completion state.
 * Excludes completed, archived, and blocked plans.
 *
 * @param {string} projectRoot - Absolute path to Mythos repo root.
 * @returns {Array<{taskId: string, path: string, state: string, reason: string}>}
 */
function listExecutablePlans(projectRoot) {
  const allPlans = listAllTaskPlans(projectRoot);
  const results = [];

  for (const entry of allPlans) {
    const planJson = readJsonSafe(entry.jsonPath);
    if (!planJson) continue;

    // Skip archived
    if (planJson.archived === true) continue;

    const classification = classifyPlanState(projectRoot, planJson);

    // READY TO EXECUTE = planned or in_progress (not complete, not blocked)
    if (classification.state === 'planned' || classification.state === 'in_progress') {
      results.push({
        taskId: entry.taskId,
        path: entry.jsonPath,
        state: classification.state,
        reason: classification.reason
      });
    }
  }

  return results;
}

/**
 * List plans completed since a given timestamp.
 *
 * Completion time is derived from (in order of preference):
 * 1. outcome_delta.completed_at in the plan JSON
 * 2. The mtime of the durable outcome artifact
 * 3. The plan's timestamp field
 *
 * @param {string} projectRoot - Absolute path to Mythos repo root.
 * @param {string} sinceISO    - ISO timestamp threshold.
 * @returns {Array<{taskId: string, path: string, completedAt: string}>}
 */
function listRecentlyCompleted(projectRoot, sinceISO) {
  const sinceMs = new Date(sinceISO).getTime();
  if (isNaN(sinceMs)) return [];

  const allPlans = listAllTaskPlans(projectRoot);
  const results = [];

  for (const entry of allPlans) {
    const planJson = readJsonSafe(entry.jsonPath);
    if (!planJson) continue;

    const classification = classifyPlanState(projectRoot, planJson);
    if (classification.state !== 'complete') continue;

    // Derive completion timestamp
    const completedAt = resolveCompletedAt(projectRoot, planJson);
    if (!completedAt) continue;

    const completedMs = new Date(completedAt).getTime();
    if (isNaN(completedMs)) continue;

    if (completedMs >= sinceMs) {
      results.push({
        taskId: entry.taskId,
        path: entry.jsonPath,
        completedAt: completedAt
      });
    }
  }

  // Sort by completedAt descending (most recent first)
  results.sort(function (a, b) {
    return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
  });

  return results;
}

/**
 * Resolve the best-available completion timestamp for a plan.
 * @param {string} projectRoot
 * @param {object} planJson
 * @returns {string|null} ISO timestamp or null
 */
function resolveCompletedAt(projectRoot, planJson) {
  // 1. Explicit completed_at in outcome_delta
  if (planJson.outcome_delta && planJson.outcome_delta.completed_at) {
    return planJson.outcome_delta.completed_at;
  }

  // 2. Mtime of durable outcome artifact
  const taskId = planJson.task_id;
  if (taskId) {
    const outcomePath = path.join(projectRoot, OUTCOME_DIR, taskId + '.json');
    try {
      if (fs.existsSync(outcomePath)) {
        const stat = fs.statSync(outcomePath);
        return stat.mtime.toISOString();
      }
    } catch (_err) {
      // Fall through
    }
  }

  // 3. Plan timestamp as last resort
  if (planJson.timestamp) {
    return planJson.timestamp;
  }

  return null;
}

module.exports = {
  classifyPlanState,
  isExecutable,
  isDistinctIntelligence,
  normalizeProvenance,
  listExecutablePlans,
  listRecentlyCompleted
};
