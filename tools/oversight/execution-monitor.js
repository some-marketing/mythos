'use strict';

const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths } = require('../planning/lib/resolve-task-plan');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum reassessments before a warning fires. */
const DEFAULT_MAX_REASSESS = 3;

/** Pacing threshold in milliseconds (5 minutes). */
const PACING_THRESHOLD_MS = 5 * 60 * 1000;

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
 * Extract step IDs from a plan's bounded_plan.steps array.
 * @param {object} planJson
 * @returns {string[]}
 */
function extractStepIds(planJson) {
  var steps = planJson && planJson.bounded_plan && planJson.bounded_plan.steps;
  if (!Array.isArray(steps)) return [];
  return steps.map(function (s) { return s.id || s.step_id || String(s.order); });
}

// ---------------------------------------------------------------------------
// Monitor factory
// ---------------------------------------------------------------------------

/**
 * Create a new execution monitor for a plan.
 *
 * @param {string} planId - Task-plan identifier.
 * @param {object} [opts] - Optional overrides.
 * @param {string} [opts.projectRoot] - Absolute path to Mythos repo root.
 * @param {string} [opts.workerId] - Worker identifier.
 * @param {number} [opts.maxReassess] - Maximum reassessments before warning.
 * @returns {{ plan_id: string, worker_id: string|null, current_step: string|null,
 *             last_updated: string, reassess_count: number, max_reassess: number,
 *             blocked_state: boolean, step_history: Array, warnings: Array,
 *             plan_steps: string[] }}
 */
function createMonitor(planId, opts) {
  var options = opts || {};
  var projectRoot = options.projectRoot || process.cwd();
  var planJson = loadPlanJson(projectRoot, planId);
  var stepIds = planJson ? extractStepIds(planJson) : [];

  return {
    plan_id: planId,
    worker_id: options.workerId || null,
    current_step: null,
    last_updated: new Date().toISOString(),
    reassess_count: 0,
    max_reassess: options.maxReassess || DEFAULT_MAX_REASSESS,
    blocked_state: false,
    step_history: [],
    warnings: [],
    plan_steps: stepIds
  };
}

// ---------------------------------------------------------------------------
// Step progression
// ---------------------------------------------------------------------------

/**
 * Update the current step on a monitor. Logs the transition and flags
 * backward movement or unknown steps.
 *
 * @param {object} monitor - Monitor object from createMonitor.
 * @param {string} stepId  - The step being entered.
 * @returns {object} The mutated monitor.
 */
function updateStep(monitor, stepId) {
  var now = new Date().toISOString();
  var previous = monitor.current_step;

  // Log transition
  monitor.step_history.push({
    from: previous,
    to: stepId,
    ts: now
  });

  // Warn on unknown step
  if (monitor.plan_steps.length > 0 && monitor.plan_steps.indexOf(stepId) === -1) {
    monitor.warnings.push({
      type: 'unknown_step',
      step: stepId,
      ts: now,
      message: 'Step "' + stepId + '" is not in the canonical plan steps'
    });
  }

  // Detect backward movement
  if (previous && monitor.plan_steps.length > 0) {
    var prevIdx = monitor.plan_steps.indexOf(previous);
    var nextIdx = monitor.plan_steps.indexOf(stepId);
    if (prevIdx !== -1 && nextIdx !== -1 && nextIdx < prevIdx) {
      monitor.reassess_count += 1;
      monitor.warnings.push({
        type: 'backward_movement',
        from: previous,
        to: stepId,
        reassess_count: monitor.reassess_count,
        ts: now,
        message: 'Step moved backward from "' + previous + '" to "' + stepId + '"'
      });
    }
  }

  // Detect repeated reassessments exceeding threshold
  if (monitor.reassess_count >= monitor.max_reassess) {
    monitor.blocked_state = true;
    monitor.warnings.push({
      type: 'max_reassess_exceeded',
      reassess_count: monitor.reassess_count,
      max_reassess: monitor.max_reassess,
      ts: now,
      message: 'Reassessment count (' + monitor.reassess_count +
        ') meets or exceeds max (' + monitor.max_reassess + '). Monitor blocked.'
    });
  }

  monitor.current_step = stepId;
  monitor.last_updated = now;

  return monitor;
}

// ---------------------------------------------------------------------------
// Pacing check
// ---------------------------------------------------------------------------

/**
 * Check whether the monitor's pacing is healthy. Flags when too much time
 * has elapsed since the last update without step progression.
 *
 * @param {object} monitor - Monitor object from createMonitor.
 * @param {object} [opts] - Optional overrides.
 * @param {number} [opts.thresholdMs] - Custom pacing threshold in milliseconds.
 * @returns {{ healthy: boolean, elapsed_ms: number, warnings: Array }}
 */
function checkPacing(monitor, opts) {
  var options = opts || {};
  var threshold = options.thresholdMs || PACING_THRESHOLD_MS;
  var now = Date.now();
  var lastMs = new Date(monitor.last_updated).getTime();
  var elapsed = now - lastMs;
  var warnings = [];

  if (elapsed > threshold) {
    warnings.push({
      type: 'pacing_stall',
      elapsed_ms: elapsed,
      threshold_ms: threshold,
      current_step: monitor.current_step,
      ts: new Date().toISOString(),
      message: 'No step update for ' + Math.round(elapsed / 1000) +
        's (threshold: ' + Math.round(threshold / 1000) + 's)'
    });
  }

  if (monitor.blocked_state) {
    warnings.push({
      type: 'monitor_blocked',
      reassess_count: monitor.reassess_count,
      ts: new Date().toISOString(),
      message: 'Monitor is in blocked state due to repeated reassessments'
    });
  }

  return {
    healthy: warnings.length === 0,
    elapsed_ms: elapsed,
    warnings: warnings
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createMonitor: createMonitor,
  updateStep: updateStep,
  checkPacing: checkPacing,
  DEFAULT_MAX_REASSESS: DEFAULT_MAX_REASSESS,
  PACING_THRESHOLD_MS: PACING_THRESHOLD_MS
};
