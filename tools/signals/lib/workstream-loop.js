'use strict';

/**
 * workstream-loop.js — Scoped loop-listener for bounded side workstreams.
 *
 * Extends the pipeline-loop pattern to filter coordination signals by
 * `signal_scope`, enabling bounded workstreams (like track-f-simpleminions-routing)
 * to use the same review -> plan -> advance loop without interfering with the
 * main pipeline.
 *
 * Handoff contract for workstream signals:
 *   Every coordination signal published by a workstream pass MUST include:
 *   - signal_scope: the workstream's stable scope identifier
 *   - artifacts: array of changed file paths
 *   - validation: { ran: boolean, summary: string }
 *   - recommended_next_actor: who should act next ("claude", "codex", "operator")
 *   - recommended_next_command: the exact next command to run
 *   - blocked_by: array of blocker descriptions (empty if unblocked)
 *
 *   The watcher uses these fields to derive the next loop recommendation
 *   without inventing a separate orchestration system.
 */

const fs = require('fs');
const path = require('path');

const { COORDINATION_SCHEMA_VERSION } = require('../../verify/lib/signal.cjs');

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

function getFileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Signal scanning — scoped to a specific signal_scope
// ---------------------------------------------------------------------------

/**
 * Scan for live coordination signals that match a given signal_scope.
 *
 * @param {string} signalDir - Path to _dev/reports/signals/
 * @param {string} signalScope - The signal_scope value to filter on
 * @returns {Array} Matching live signals, sorted newest-first
 */
function scanScopedSignals(signalDir, signalScope) {
  if (!fs.existsSync(signalDir)) return [];

  const entries = fs.readdirSync(signalDir, { withFileTypes: true });
  const matched = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;

    const filePath = path.join(signalDir, entry.name);
    const signal = safeReadJson(filePath);
    if (!signal) continue;
    if (signal.schema !== COORDINATION_SCHEMA_VERSION) continue;
    if (signal.lifecycle_state !== 'live') continue;
    if (signal.signal_scope !== signalScope) continue;

    matched.push({
      name: entry.name,
      filePath,
      signal,
      mtimeMs: getFileMtimeMs(filePath)
    });
  }

  // Sort newest-first by timestamp, then mtime as tiebreaker
  matched.sort((a, b) => {
    const aTs = Date.parse(a.signal.timestamp || '') || a.mtimeMs || 0;
    const bTs = Date.parse(b.signal.timestamp || '') || b.mtimeMs || 0;
    return bTs - aTs;
  });

  return matched;
}

// ---------------------------------------------------------------------------
// Recommendation derivation
// ---------------------------------------------------------------------------

function normalizeCommand(command) {
  return typeof command === 'string' ? command.trim() : '';
}

/**
 * Derive the next loop recommendation for a scoped workstream.
 *
 * Priority order:
 *   1. Blocked signal -> surface the blocker and recommended command
 *   2. Signal from Claude that hasn't been independently reviewed yet
 *   3. Signal with an explicit recommended_next_command
 *   4. Fallback: no actionable signal
 *
 * @param {object} state - { scopedSignals, signalScope }
 * @returns {object} recommendation
 */
function deriveWorkstreamRecommendation(state) {
  const latest = state.scopedSignals[0] || null;

  if (!latest) {
    return {
      source: 'fallback',
      command: '',
      reason: `No live coordination signals found for scope "${state.signalScope}".`,
      blocked_by: [],
      latest_signal: null
    };
  }

  // Blocked signals surface immediately
  if (latest.signal.signal_type === 'blocked') {
    const command = normalizeCommand(latest.signal.recommended_next_command);
    const blockers = Array.isArray(latest.signal.blocked_by) ? latest.signal.blocked_by : [];
    return {
      source: 'live-signal',
      command: command || '',
      reason: `Workstream "${state.signalScope}" is blocked: ${blockers.join('; ') || 'no details'}.`,
      blocked_by: blockers,
      latest_signal: latest
    };
  }

  // Claude-sourced signals should be reviewed before advancing
  const source = String(latest.signal.source || '').toLowerCase();
  if (source.includes('claude') && latest.signal.signal_type === 'cycle-complete') {
    // Prefer the signal's exact recommended_next_command; fall back to scoped /review-progress
    const signalCommand = normalizeCommand(latest.signal.recommended_next_command);
    const reviewCommand = signalCommand || `/review-progress ${state.signalScope}`;
    return {
      source: 'live-signal',
      command: reviewCommand,
      reason: `New cycle-complete signal from ${latest.signal.source} on workstream "${state.signalScope}" — independent review recommended before advancing.`,
      blocked_by: [],
      latest_signal: latest
    };
  }

  // Explicit next command
  const command = normalizeCommand(latest.signal.recommended_next_command);
  if (command) {
    return {
      source: 'live-signal',
      command,
      reason: `Latest signal from ${latest.signal.source || 'unknown'} on workstream "${state.signalScope}" recommends: ${command}.`,
      blocked_by: [],
      latest_signal: latest
    };
  }

  // Fallback: signal exists but no clear next step
  return {
    source: 'live-signal',
    command: '',
    reason: `Live signal found for "${state.signalScope}" but no explicit next command. Inspect the signal and decide manually.`,
    blocked_by: [],
    latest_signal: latest
  };
}

// ---------------------------------------------------------------------------
// State builder
// ---------------------------------------------------------------------------

/**
 * Build the loop state for a scoped workstream.
 *
 * @param {string} projectRoot - Repo root path
 * @param {string} signalScope - The signal_scope to filter on
 * @param {object} [opts] - Optional overrides
 * @returns {object} state
 */
function buildWorkstreamState(projectRoot, signalScope, opts = {}) {
  const signalDir = opts.signalDir || path.join(projectRoot, '_dev', 'reports', 'signals');

  return {
    projectRoot,
    signalScope,
    signalDir,
    scopedSignals: scanScopedSignals(signalDir, signalScope)
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function describeSignal(liveSignal) {
  if (!liveSignal) return 'none';
  const s = liveSignal.signal;
  return `${s.signal_type} from ${s.source || 'unknown'} (scope: ${s.scope || 'none'}, signal_scope: ${s.signal_scope || 'none'})`;
}

function buildWorkstreamFollowOn(recommendation) {
  const command = recommendation.command;
  if (!command) {
    return [
      'Inspect the latest workstream signal or ask the operator for the next step',
      'Publish a blocked coordination signal if input is needed',
      'Resume the review -> plan -> advance loop once a next command is clear'
    ];
  }

  return [
    command,
    'Follow the command output truthfully',
    'Publish a new coordination signal with signal_scope, artifacts, validations, and the exact next step',
    'Return to the review -> plan -> advance loop'
  ];
}

function buildWorkstreamDirective(recommendation, signalScope) {
  const lines = [];
  lines.push(`Workstream loop contract (signal_scope: ${signalScope}):`);
  lines.push(`- Poll _dev/reports/signals/ for live HandoffSignal/1.0 files where signal_scope = "${signalScope}".`);

  if (recommendation.command) {
    lines.push(`- If you are the next actor, execute \`${recommendation.command}\`.`);
  } else {
    lines.push('- If no command is listed, inspect the latest signal and current artifacts before acting.');
  }

  lines.push('- After your pass, publish a new live coordination signal with:');
  lines.push(`  - signal_scope: "${signalScope}"`);
  lines.push('  - artifacts: array of changed file paths');
  lines.push('  - validation: { ran: boolean, summary: string }');
  lines.push('  - recommended_next_actor and recommended_next_command');
  lines.push('  - blocked_by: array of blockers (empty if unblocked)');
  lines.push('- This workstream uses the same review -> plan -> advance loop as the main pipeline.');
  lines.push('- Do NOT alter the master run order for this bounded side workstream.');

  return lines;
}

function formatWorkstreamStatus(state, recommendation) {
  const lines = [];
  lines.push(`[${new Date().toISOString()}] Workstream Loop Watch — signal_scope: ${state.signalScope}`);
  lines.push(`Scoped live signals: ${state.scopedSignals.length}`);
  lines.push(`Latest scoped signal: ${describeSignal(recommendation.latest_signal)}`);
  lines.push(`Recommended next command: ${recommendation.command || '(none)'}`);
  lines.push(`Why: ${recommendation.reason}`);

  if (recommendation.blocked_by && recommendation.blocked_by.length > 0) {
    lines.push('Blocked by:');
    for (const item of recommendation.blocked_by) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('Suggested loop:');
  for (const step of buildWorkstreamFollowOn(recommendation)) {
    lines.push(`- ${step}`);
  }

  for (const step of buildWorkstreamDirective(recommendation, state.signalScope)) {
    lines.push(step);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildWorkstreamDirective,
  buildWorkstreamFollowOn,
  buildWorkstreamState,
  deriveWorkstreamRecommendation,
  formatWorkstreamStatus,
  scanScopedSignals
};
