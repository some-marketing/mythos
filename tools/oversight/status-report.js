'use strict';

const fs = require('fs');
const path = require('path');

const { resolveTaskPlanPaths } = require('../planning/lib/resolve-task-plan');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum summary lines in a single status report. */
const MAX_SUMMARY_LINES = 20;

/** Maximum approximate token count for a status report. */
const MAX_TOKEN_COUNT = 500;

/** Characters-per-token estimate for bounding. */
const CHARS_PER_TOKEN = 4;

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
 * Estimate token count from text length.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate an array of lines to the maximum allowed.
 * @param {string[]} lines
 * @param {number} max
 * @returns {string[]}
 */
function truncateLines(lines, max) {
  if (lines.length <= max) return lines;
  var truncated = lines.slice(0, max);
  truncated.push('[... ' + (lines.length - max) + ' additional lines truncated]');
  return truncated;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Generate a bounded status report for a plan.
 *
 * Report schema:
 *   report_ts     {string}   - ISO timestamp of report generation.
 *   plan_id       {string}   - Plan identifier.
 *   summary_lines {string[]} - Concise summary lines (bounded by MAX_SUMMARY_LINES).
 *   token_count   {number}   - Estimated token count of the full report.
 *   log_filter    {string}   - Filter used when pulling log lines.
 *   bounded       {boolean}  - Whether the report was truncated to fit limits.
 *   escalation    {object|null} - Non-null when bounds were exceeded.
 *
 * @param {string} planId - Task-plan identifier.
 * @param {object} [opts] - Options.
 * @param {string} [opts.projectRoot] - Absolute path to Mythos repo root.
 * @param {string} [opts.logFilter] - Filter expression for log lines.
 * @param {number} [opts.maxLines] - Override for maximum summary lines.
 * @param {number} [opts.maxTokens] - Override for maximum token count.
 * @returns {object} Status report object.
 */
function generateStatusReport(planId, opts) {
  var options = opts || {};
  var projectRoot = options.projectRoot || process.cwd();
  var maxLines = options.maxLines || MAX_SUMMARY_LINES;
  var maxTokens = options.maxTokens || MAX_TOKEN_COUNT;
  var logFilter = options.logFilter || 'all';

  // Resolve plan
  var resolved = resolveTaskPlanPaths(projectRoot, planId);
  var planJson = resolved ? readJsonSafe(resolved.jsonPath) : null;

  var lines = [];

  if (!planJson) {
    lines.push('Plan "' + planId + '" not found or unreadable.');
  } else {
    lines.push('Plan: ' + (planJson.task_id || planId));
    lines.push('Title: ' + (planJson.title || 'untitled'));

    // Steps summary
    var steps = planJson.bounded_plan && planJson.bounded_plan.steps;
    if (Array.isArray(steps)) {
      var done = steps.filter(function (s) { return s.status === 'done' || s.status === 'complete'; }).length;
      lines.push('Steps: ' + done + '/' + steps.length + ' complete');
    }

    // Blockers
    var blockers = planJson.blockers;
    if (Array.isArray(blockers) && blockers.length > 0) {
      var open = blockers.filter(function (b) {
        return typeof b === 'string' || (b.status !== 'resolved' && b.status !== 'closed');
      });
      if (open.length > 0) {
        lines.push('Blockers: ' + open.length + ' open');
      }
    }

    // Outcome delta
    var od = planJson.outcome_delta;
    if (od) {
      lines.push('Outcome: completed=' + String(!!od.completed));
    }
  }

  // Apply bounds
  var bounded = false;
  var originalLength = lines.length;
  lines = truncateLines(lines, maxLines);
  if (lines.length !== originalLength) {
    bounded = true;
  }

  var fullText = lines.join('\n');
  var tokenCount = estimateTokens(fullText);

  // Check token bounds
  var escalation = null;
  if (tokenCount > maxTokens) {
    bounded = true;
    escalation = {
      reason: 'token_count_exceeded',
      token_count: tokenCount,
      max_tokens: maxTokens,
      ts: new Date().toISOString()
    };
  }

  return {
    report_ts: new Date().toISOString(),
    plan_id: planId,
    summary_lines: lines,
    token_count: tokenCount,
    log_filter: logFilter,
    bounded: bounded,
    escalation: escalation
  };
}

// ---------------------------------------------------------------------------
// Bounds checker
// ---------------------------------------------------------------------------

/**
 * Check whether a report exceeds its declared bounds.
 *
 * @param {object} report - Status report object.
 * @param {object} [opts] - Optional overrides.
 * @param {number} [opts.maxLines] - Override for max lines.
 * @param {number} [opts.maxTokens] - Override for max tokens.
 * @returns {{ within_bounds: boolean, violations: string[] }}
 */
function checkBounds(report, opts) {
  var options = opts || {};
  var maxLines = options.maxLines || MAX_SUMMARY_LINES;
  var maxTokens = options.maxTokens || MAX_TOKEN_COUNT;
  var violations = [];

  if (report.summary_lines && report.summary_lines.length > maxLines) {
    violations.push('summary_lines (' + report.summary_lines.length +
      ') exceeds max (' + maxLines + ')');
  }

  if (report.token_count > maxTokens) {
    violations.push('token_count (' + report.token_count +
      ') exceeds max (' + maxTokens + ')');
  }

  // Wildcard dump detection: flag if any single line is excessively long
  if (Array.isArray(report.summary_lines)) {
    for (var i = 0; i < report.summary_lines.length; i++) {
      if (report.summary_lines[i].length > 500) {
        violations.push('Line ' + i + ' appears to be a wildcard dump (' +
          report.summary_lines[i].length + ' chars)');
        break;
      }
    }
  }

  return {
    within_bounds: violations.length === 0,
    violations: violations
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateStatusReport: generateStatusReport,
  checkBounds: checkBounds,
  MAX_SUMMARY_LINES: MAX_SUMMARY_LINES,
  MAX_TOKEN_COUNT: MAX_TOKEN_COUNT
};
