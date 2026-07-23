'use strict';

/**
 * decision-tree.js — Deterministic pipeline decision predicates.
 *
 * Consolidates the "what should happen next?" logic that was previously
 * spread across command handoff_guidance prose into code predicates.
 * Each predicate reads repo state and returns a structured decision.
 *
 * The LLM no longer needs to reason about routing — it calls
 * `resolveNextStep(projectRoot)` and gets back a command + reason.
 *
 * Decision priority (highest to lowest):
 *   1. Blocked signal → surface blocker
 *   2. Live signal needing independent review → /review-progress
 *   3. Review requests planning refresh → /plan-pipeline
 *   4. Master pipeline complete, active workstreams exist → workstream command
 *   5. Master pipeline complete, no active work → /mythos-status or clear
 *   6. Planning artifact has next command → that command
 *   7. Fallback → no recommendation
 */

const fs = require('fs');
const path = require('path');

const {
  buildLoopState,
  deriveLoopRecommendation,
  masterPipelineIsComplete,
  scanLiveHandoffSignals
} = require('./pipeline-loop');
const { auditCodexBridge } = require('./codex-bridge-hygiene');
const { listAllTaskPlans } = require('../../planning/lib/resolve-task-plan');
const { classifyPlanState } = require('../../planning/lib/completion-classifier');

// workstream-loop exports available if predicates expand to per-scope decisions
// const { buildWorkstreamState, deriveWorkstreamRecommendation } = require('./workstream-loop');

// ---------------------------------------------------------------------------
// State predicates — each answers one question about repo state
// ---------------------------------------------------------------------------

/**
 * Is there a live blocked signal (main or scoped)?
 */
function hasBlockedSignal(projectRoot) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signals = scanLiveHandoffSignals(signalDir);
  return signals.some(s => s.signal.signal_type === 'blocked');
}

/**
 * Is there a live ready-for-clear signal?
 */
function hasReadyForClearSignal(projectRoot) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signals = scanLiveHandoffSignals(signalDir);
  return signals.some(s => s.signal.signal_type === 'ready-for-clear');
}

/**
 * Are there any live coordination signals at all?
 */
function hasLiveSignals(projectRoot) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  return scanLiveHandoffSignals(signalDir).length > 0;
}

/**
 * Is the master pipeline complete?
 */
function isPipelineComplete(projectRoot) {
  const planPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-pipeline.next-step.json');
  const plan = safeReadJson(planPath);
  return masterPipelineIsComplete(plan);
}

/**
 * Are there active (non-complete) workstream queues?
 */
function hasActiveWorkstreams(projectRoot) {
  const awPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'plan-active-workstreams.next-step.json');
  const aw = safeReadJson(awPath);
  if (!aw) return false;
  return Array.isArray(aw.active_queues) && aw.active_queues.length > 0;
}

/**
 * Does the latest review artifact recommend a planning refresh?
 */
function reviewRequestsPlanning(projectRoot) {
  const reviewPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'review-progress__advance-pipeline.expectation-failures.json');
  const review = safeReadJson(reviewPath);
  if (!review || !Array.isArray(review.failures)) return false;
  return review.failures.some(f => {
    const action = String(f.recommended_next_action || '');
    return action.includes('/plan-pipeline');
  });
}

/**
 * Is the verification system passing?
 */
function isSystemVerified(projectRoot) {
  const signalPath = path.join(projectRoot, '_dev', 'reports', 'signals', 'verify-system.signal.json');
  const signal = safeReadJson(signalPath);
  return !!(signal && signal.verdict === 'PASS');
}

/**
 * Get all distinct live signal scopes (for scoped workstreams).
 */
function getLiveSignalScopes(projectRoot) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const signals = scanLiveHandoffSignals(signalDir);
  const scopes = new Set();
  for (const s of signals) {
    if (s.signal.signal_scope) {
      scopes.add(s.signal.signal_scope);
    }
  }
  return [...scopes];
}

// ---------------------------------------------------------------------------
// Completion awareness — delegates to shared completion-classifier
// ---------------------------------------------------------------------------

/**
 * Check whether a task plan is completed using the shared completion-classifier.
 * Replaces the prior direct outcome_delta.completed check to enforce all 4
 * completion criteria (all_steps_done, verification_passed, no_open_blockers,
 * operator_acceptance_received) plus provenance validation.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @returns {boolean}
 */
function isTaskPlanCompleted(projectRoot, taskId) {
  const planPath = path.join(
    projectRoot, '_dev', 'reports', 'analysis', 'task-plans', taskId + '__plan.json'
  );
  const planJson = safeReadJson(planPath);
  if (!planJson) {
    // Fall back to outcome artifact check for plans without a plan file
    const outcomePath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'task-outcomes', taskId + '.json');
    const outcome = safeReadJson(outcomePath);
    if (!outcome) return false;
    // Delegate to classifier with the outcome as plan shape
    const result = classifyPlanState(projectRoot, { task_id: taskId, ...outcome });
    return result.state === 'complete';
  }
  const result = classifyPlanState(projectRoot, planJson);
  return result.state === 'complete';
}

/**
 * List all task plans that are NOT completed (i.e., still actionable).
 * Delegates to the shared completion-classifier — never checks
 * outcome_delta.completed directly.
 *
 * @param {string} projectRoot
 * @returns {Array<{ taskId: string, jsonPath: string, scopeType: string, clientCode: string|null }>}
 */
function listActiveTaskPlans(projectRoot) {
  try {
    const allPlans = listAllTaskPlans(projectRoot);
    return allPlans.filter(plan => !isTaskPlanCompleted(projectRoot, plan.taskId));
  } catch {
    return [];
  }
}

/**
 * List all completed task plans.
 * Delegates to the shared completion-classifier.
 *
 * @param {string} projectRoot
 * @returns {Array<{ taskId: string, jsonPath: string, scopeType: string, clientCode: string|null }>}
 */
function listCompletedTaskPlans(projectRoot) {
  try {
    const allPlans = listAllTaskPlans(projectRoot);
    return allPlans.filter(plan => isTaskPlanCompleted(projectRoot, plan.taskId));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main decision function
// ---------------------------------------------------------------------------

/**
 * resolveNextStep — Deterministic "what should happen next?" for the whole system.
 *
 * Reads repo state and returns a structured decision. The LLM calls this
 * instead of reasoning through handoff_guidance prose.
 *
 * @param {string} projectRoot - Repo root path
 * @returns {{ command: string, reason: string, source: string, blocked_by: string[], context: object }}
 */
function resolveNextStep(projectRoot) {
  const state = buildLoopState(projectRoot);
  const codexBridge = auditCodexBridge(projectRoot);
  const activePlans = listActiveTaskPlans(projectRoot);
  const completedPlans = listCompletedTaskPlans(projectRoot);

  // Build shared context enriched with plan completion data
  function buildContext(overrides = {}) {
    return {
      pipeline_complete: masterPipelineIsComplete(state.planArtifact),
      live_signal_count: state.liveSignals.length,
      has_active_workstreams: hasActiveWorkstreams(projectRoot),
      system_verified: isSystemVerified(projectRoot),
      active_plan_count: activePlans.length,
      completed_plan_count: completedPlans.length,
      ...overrides
    };
  }

  // Priority 0: Ready-for-clear signals are handled before the main loop
  // (the main loop would treat them as needing independent review, which is wrong)
  // But blocked signals always take priority over clear-readiness.
  if (masterPipelineIsComplete(state.planArtifact) && hasReadyForClearSignal(projectRoot) && !hasActiveWorkstreams(projectRoot) && !hasBlockedSignal(projectRoot)) {
    return {
      command: 'clear',
      reason: 'Pipeline complete, all workstreams complete, ready-for-clear signal active. Session can be cleared.',
      source: 'clear-readiness',
      blocked_by: [],
      context: buildContext({ pipeline_complete: true, has_active_workstreams: false })
    };
  }

  const mainRecommendation = deriveLoopRecommendation(state);

  // Priority 0.5: System verification failure blocks execution progression
  if (!isSystemVerified(projectRoot)) {
    const executionCommands = ['/execute-plan', '/advance-pipeline', '/run-framework', '/follow-signal', '/run-plan'];
    const wouldRecommendExecution = mainRecommendation.command && executionCommands.some(cmd => mainRecommendation.command.startsWith(cmd));

    if (wouldRecommendExecution) {
      return {
        command: '/mythos-status',
        reason: 'System verification failed. Run `npm run verify` to diagnose. Execution commands are blocked until system integrity is restored.',
        source: 'system-verification-gate',
        blocked_by: ['verify-system.signal.json verdict != PASS'],
        context: buildContext({ system_verified: false, blocked_command: mainRecommendation.command })
      };
    }
  }

  // Priority 1: Main pipeline loop already found a blocked or actionable signal
  if (mainRecommendation.source === 'live-signal' && mainRecommendation.command) {
    return {
      command: mainRecommendation.command,
      reason: mainRecommendation.reason,
      source: mainRecommendation.source,
      blocked_by: mainRecommendation.blocked_by || [],
      context: buildContext()
    };
  }

  // Priority 2: Review requests planning refresh
  if (mainRecommendation.source === 'review-artifact' && mainRecommendation.command) {
    return {
      command: mainRecommendation.command,
      reason: mainRecommendation.reason,
      source: 'review-artifact',
      blocked_by: [],
      context: buildContext()
    };
  }

  // Priority 2.5: active-workstreams planning must not outrun dirty Codex bridge authority
  if (codexBridge.surface.status === 'blocked' && codexBridge.surface.next_command.startsWith('/normalize-signals')) {
    return {
      command: codexBridge.surface.next_command,
      reason: codexBridge.surface.reason,
      source: 'codex-bridge-hygiene',
      blocked_by: codexBridge.surface.blocked_by,
      context: buildContext()
    };
  }

  // Priority 3: Pipeline complete — check workstreams and clear-readiness
  if (masterPipelineIsComplete(state.planArtifact)) {
    // Check for active workstream commands
    if (mainRecommendation.source === 'active-workstreams-artifact' && mainRecommendation.command) {
      return {
        command: mainRecommendation.command,
        reason: mainRecommendation.reason,
        source: 'active-workstreams',
        blocked_by: [],
        context: buildContext({ pipeline_complete: true })
      };
    }

    // Pipeline complete but no active workstreams and no clear signal — check status
    return {
      command: '/mythos-status',
      reason: 'Pipeline complete, no active workstreams, no clear-readiness signal. Run status check to assess.',
      source: 'pipeline-complete-idle',
      blocked_by: [],
      context: buildContext({ pipeline_complete: true, has_active_workstreams: false })
    };
  }

  // Priority 4: Planning artifact has a recommendation
  if (mainRecommendation.source === 'plan-artifact' && mainRecommendation.command) {
    return {
      command: mainRecommendation.command,
      reason: mainRecommendation.reason,
      source: 'plan-artifact',
      blocked_by: [],
      context: buildContext({ pipeline_complete: false })
    };
  }

  // Priority 5: Fallback — nothing to do
  return {
    command: '',
    reason: mainRecommendation.reason || 'No live signal, planning artifact, or workstream queue recommends a next command.',
    source: 'fallback',
    blocked_by: [],
    context: buildContext()
  };
}

/**
 * resolveNextStepJson — Same as resolveNextStep but returns JSON string.
 * Convenient for CLI scripts and --json output.
 */
function resolveNextStepJson(projectRoot) {
  return JSON.stringify(resolveNextStep(projectRoot), null, 2);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Main entry point
  resolveNextStep,
  resolveNextStepJson,

  // Individual predicates (for targeted checks)
  hasBlockedSignal,
  hasReadyForClearSignal,
  hasLiveSignals,
  isPipelineComplete,
  hasActiveWorkstreams,
  reviewRequestsPlanning,
  isSystemVerified,
  getLiveSignalScopes,

  // Completion-aware plan classifiers
  isTaskPlanCompleted,
  listActiveTaskPlans,
  listCompletedTaskPlans
};
