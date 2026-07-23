'use strict';

/**
 * signal-lifecycle.js — Reader-driven completion helpers for HandoffSignal/2.0
 * (multi-target acknowledgement-driven lifecycle).
 *
 * Cluster 3 of the multi-session-coordination plan. This module owns:
 *   - acknowledgement stamping (append-only, idempotent per session_id)
 *   - target addressee resolution (snapshot vs dynamic via active-session-registry)
 *   - threshold satisfaction evaluation (mode: all | at-least | named-list)
 *   - completion + on_complete callback execution (allowlisted only)
 *
 * Cluster 1 owns the registry (tools/sessions/lib/active-session-registry.js).
 * Cluster 2 owns the validator extension in tools/verify/lib/signal.cjs.
 * This file MUST NOT modify either of those — the registry is consumed via DI
 * (opts.registryListActive) so tests don't depend on file state, and the
 * validator surface is consumed only via require() of public exports.
 *
 * See: _dev/concepts/active-session-signal-awareness-and-work-claim-hook.md
 *      _dev/reports/analysis/codex-bridge-response__session-id-stamping-and-signal-lifecycle-redesign.md
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const VALID_ACTION_TAKEN = ['noted', 'responded', 'passing-through'];
// Ordering for advance-only idempotence. Higher index = "more advanced".
const ACTION_RANK = { 'noted': 1, 'passing-through': 1, 'responded': 2 };

const VALID_THRESHOLD_MODES = ['all', 'at-least', 'named-list', 'deadline-only'];
const VALID_TARGET_MODES = ['snapshot', 'dynamic', 'at-least', 'deadline-only'];

const DEFAULT_ALLOWLISTED_COMMANDS = Object.freeze([
  'archive_to_closed',
  'post_followup_signal',
  'trigger_normalize_signals'
]);

const DEFAULT_SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');
const DEFAULT_CLOSED_DIR = path.join(DEFAULT_SIGNALS_DIR, 'closed');

function nowIso(opts) {
  return (opts && opts.now) || new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * stampAcknowledgement — Append-only, idempotent ack stamp by session_id.
 *
 * If the same session stamps again:
 *   - update only when action_taken advances (rank-based, e.g. noted → responded)
 *   - never downgrade (responded → noted leaves the existing entry untouched)
 *
 * @param {object} signal - HandoffSignal/2.0 object (will not be mutated; clone returned)
 * @param {object} ack    - { session_id, actor_id?, ts?, action_taken }
 * @returns {object} updated signal (new object)
 */
function stampAcknowledgement(signal, ack) {
  if (!signal || typeof signal !== 'object') {
    throw new Error('stampAcknowledgement: signal must be an object');
  }
  if (!ack || typeof ack !== 'object') {
    throw new Error('stampAcknowledgement: ack must be an object');
  }
  if (!ack.session_id || typeof ack.session_id !== 'string') {
    throw new Error('stampAcknowledgement: ack.session_id is required');
  }
  if (!VALID_ACTION_TAKEN.includes(ack.action_taken)) {
    throw new Error(`stampAcknowledgement: invalid action_taken "${ack.action_taken}". Must be one of: ${VALID_ACTION_TAKEN.join(', ')}`);
  }

  const updated = deepClone(signal);
  if (!Array.isArray(updated.acknowledgements)) {
    updated.acknowledgements = [];
  }

  const ts = ack.ts || new Date().toISOString();
  const existingIdx = updated.acknowledgements.findIndex((entry) => entry.session_id === ack.session_id);

  if (existingIdx === -1) {
    updated.acknowledgements.push({
      actor_id: ack.actor_id || '',
      session_id: ack.session_id,
      ts,
      action_taken: ack.action_taken
    });
    return updated;
  }

  const existing = updated.acknowledgements[existingIdx];
  const existingRank = ACTION_RANK[existing.action_taken] || 0;
  const incomingRank = ACTION_RANK[ack.action_taken] || 0;

  if (incomingRank > existingRank) {
    updated.acknowledgements[existingIdx] = {
      ...existing,
      actor_id: ack.actor_id || existing.actor_id,
      ts,
      action_taken: ack.action_taken
    };
  }
  // else: same or lower rank → no-op (never downgrade)

  return updated;
}

/**
 * resolveTargetAddressees — Resolve the target list at the moment of evaluation.
 *
 * Modes:
 *   - 'snapshot'      → return the verbatim sessions list authored at signal creation
 *   - 'dynamic'       → call registryListActive() and return the live list + resolved_at
 *   - 'at-least'      → returns null (caller falls back to threshold count or deadline)
 *   - 'deadline-only' → returns null (caller waits for deadline)
 *
 * @param {object} signal
 * @param {object} [opts]
 * @param {string} [opts.now]                  - ISO timestamp for resolved_at
 * @param {Function} [opts.registryListActive] - DI: defaults to require()'d registry.listActive
 * @returns {{mode:string, sessions:string[], resolved_at?:string}|null}
 */
function resolveTargetAddressees(signal, opts = {}) {
  const target = signal && signal.target_addressees;
  if (!target || typeof target !== 'object') {
    return null;
  }

  const mode = String(target.mode || '');
  if (!VALID_TARGET_MODES.includes(mode)) {
    return null;
  }

  if (mode === 'snapshot') {
    const sessions = Array.isArray(target.sessions) ? target.sessions.slice() : [];
    return Object.freeze({ mode, sessions: Object.freeze(sessions) });
  }

  if (mode === 'dynamic') {
    const listActive = opts.registryListActive || lazyRegistryListActive();
    let sessions = [];
    try {
      const live = listActive() || [];
      if (!Array.isArray(live)) {
        sessions = [];
      } else {
        sessions = live
          .map((s) => (s && typeof s === 'object' && typeof s.session_id === 'string') ? s.session_id : null)
          .filter(Boolean);
      }
    } catch (err) {
      // Malformed registry — fail closed to empty list with diagnostic.
      return Object.freeze({
        mode,
        sessions: Object.freeze([]),
        resolved_at: nowIso(opts),
        diagnostic: `registry-listActive-threw: ${err.message}`
      });
    }
    return Object.freeze({
      mode,
      sessions: Object.freeze(sessions),
      resolved_at: nowIso(opts)
    });
  }

  // at-least / deadline-only — caller checks threshold or deadline directly.
  return null;
}

function lazyRegistryListActive() {
  // Lazy require so the helper can run in environments where the registry
  // module hasn't been initialized yet (e.g. tests with DI).
  return function () {
    // eslint-disable-next-line global-require
    const reg = require('../../sessions/lib/active-session-registry');
    return reg.listActive();
  };
}

/**
 * isThresholdSatisfied — Returns true if the threshold is met OR (deadline reached
 * AND on_timeout.mode permits completion). Never auto-shrinks 'all'-mode
 * thresholds when a target is unreachable unless the signal explicitly opts
 * in via target_addressees.allow_unreachable_shrink: true. Default fail-closed.
 *
 * Side-effect-free: returns a structured result. The signal is NOT mutated.
 *
 * @param {object} signal
 * @param {object} [opts]
 * @param {string} [opts.now]
 * @param {Function} [opts.registryListActive]
 * @returns {{satisfied:boolean, reason:string, unreachable_sessions:string[], resolved_targets:string[]}}
 */
function isThresholdSatisfied(signal, opts = {}) {
  const result = {
    satisfied: false,
    reason: '',
    unreachable_sessions: [],
    resolved_targets: []
  };

  if (!signal || typeof signal !== 'object') {
    result.reason = 'signal-not-object';
    return result;
  }

  const threshold = signal.acknowledgement_threshold || {};
  const mode = String(threshold.mode || '');
  if (!VALID_THRESHOLD_MODES.includes(mode)) {
    result.reason = `invalid-threshold-mode:${mode}`;
    return result;
  }

  const acks = Array.isArray(signal.acknowledgements) ? signal.acknowledgements : [];
  const ackedSessionIds = new Set(acks.map((a) => a && a.session_id).filter(Boolean));

  // Resolve targets where applicable.
  const target = signal.target_addressees || {};
  const allowShrink = Boolean(target.allow_unreachable_shrink);

  let resolvedTargets = [];
  let liveSessionIds = null;

  if (target.mode === 'snapshot' && Array.isArray(target.sessions)) {
    resolvedTargets = target.sessions.slice();
  } else if (target.mode === 'dynamic') {
    const listActive = opts.registryListActive || lazyRegistryListActive();
    try {
      const live = listActive() || [];
      if (!Array.isArray(live)) {
        result.reason = 'registry-malformed';
        return result; // fail-closed
      }
      liveSessionIds = new Set(
        live
          .map((s) => (s && typeof s === 'object' && typeof s.session_id === 'string') ? s.session_id : null)
          .filter(Boolean)
      );
      resolvedTargets = Array.from(liveSessionIds);
    } catch (err) {
      result.reason = `registry-threw:${err.message}`;
      return result; // fail-closed
    }
  }

  result.resolved_targets = resolvedTargets;

  // Compute unreachable sessions: declared targets that are not currently in registry.
  // Only meaningful when we have a snapshot AND a registry to compare against.
  if (target.mode === 'snapshot' && Array.isArray(target.sessions)) {
    const listActive = opts.registryListActive;
    if (typeof listActive === 'function') {
      try {
        const live = listActive() || [];
        if (Array.isArray(live)) {
          const liveIds = new Set(
            live
              .map((s) => (s && typeof s === 'object' && typeof s.session_id === 'string') ? s.session_id : null)
              .filter(Boolean)
          );
          result.unreachable_sessions = target.sessions.filter((id) => !liveIds.has(id));
        }
      } catch (err) {
        // Ignore unreachable-detection failure; fall through.
      }
    }
  }

  // Deadline check (universal).
  const nowMs = Date.parse(nowIso(opts));
  const deadlineMs = signal.deadline ? Date.parse(signal.deadline) : NaN;
  const deadlineReached = Number.isFinite(deadlineMs) && Number.isFinite(nowMs) && nowMs >= deadlineMs;

  // Mode-specific evaluation.
  if (mode === 'deadline-only') {
    if (deadlineReached) {
      result.satisfied = true;
      result.reason = 'deadline-reached';
    } else {
      result.reason = 'deadline-not-reached';
    }
    return result;
  }

  if (mode === 'all') {
    if (resolvedTargets.length === 0) {
      result.reason = 'no-targets-resolved';
      // fail-closed unless deadline policy fires
    } else {
      let effectiveTargets = resolvedTargets;
      if (allowShrink && result.unreachable_sessions.length > 0) {
        effectiveTargets = effectiveTargets.filter((id) => !result.unreachable_sessions.includes(id));
      }
      const allAcked = effectiveTargets.length > 0
        && effectiveTargets.every((id) => ackedSessionIds.has(id));
      if (allAcked) {
        result.satisfied = true;
        result.reason = 'all-targets-acknowledged';
        return result;
      }
      if (result.unreachable_sessions.length > 0 && !allowShrink) {
        result.reason = 'unreachable-sessions-block-all-mode';
      } else {
        result.reason = 'awaiting-acknowledgements';
      }
    }
  } else if (mode === 'at-least') {
    const count = Number(threshold.count) || 0;
    if (acks.length >= count && count > 0) {
      result.satisfied = true;
      result.reason = `at-least-${count}-met`;
      return result;
    }
    result.reason = 'at-least-not-met';
  } else if (mode === 'named-list') {
    const required = Array.isArray(threshold.sessions) ? threshold.sessions : [];
    if (required.length > 0 && required.every((id) => ackedSessionIds.has(id))) {
      result.satisfied = true;
      result.reason = 'named-list-met';
      return result;
    }
    result.reason = 'named-list-not-met';
  }

  // Fall-through: deadline policy can override. Field name aligned with
  // HandoffSignal/2.0 validator (cluster 2): `on_timeout.mode` ∈
  // {'operator-review', 'auto-close', 'fallback-signal'}. Only 'auto-close'
  // grants automatic completion on deadline; the other two require explicit
  // operator/follow-up handling and stay non-satisfied here.
  if (deadlineReached) {
    const onTimeout = (signal.on_timeout && signal.on_timeout.mode) || '';
    if (onTimeout === 'auto-close') {
      result.satisfied = true;
      result.reason = `deadline-reached-with-mode:${onTimeout}`;
    } else {
      // Default fail-closed: do not auto-complete just because deadline hit.
      result.reason = `${result.reason}|deadline-reached-no-mode`;
    }
  }

  return result;
}

/**
 * runOnComplete — Execute the on_complete callback IF it exists.
 *
 * Allowlisted commands only:
 *   - archive_to_closed       → move signal file from signals/ to signals/closed/
 *   - post_followup_signal    → write a new signal at each path in emit_followup_signals[]
 *   - trigger_normalize_signals → stub; returns { pending: true }
 *
 * Anything else throws an allowlist-violation error.
 *
 * @param {object} signal
 * @param {object} [opts]
 * @param {string[]} [opts.allowlistedCommands]
 * @param {string} [opts.signalFilePath]   - absolute path to the on-disk signal (required for archive_to_closed)
 * @param {string} [opts.closedDir]        - override closed directory
 * @param {string} [opts.signalsDir]       - override signals directory
 * @returns {{ executed:string[], skipped:string[], results:object[] }}
 */
function runOnComplete(signal, opts = {}) {
  const out = { executed: [], skipped: [], results: [] };
  const onComplete = signal && signal.on_complete;
  if (!onComplete || typeof onComplete !== 'object') {
    return out;
  }

  const allowlist = Array.isArray(opts.allowlistedCommands) && opts.allowlistedCommands.length > 0
    ? opts.allowlistedCommands
    : DEFAULT_ALLOWLISTED_COMMANDS;

  const cmd = onComplete.trigger_command;
  if (typeof cmd === 'string' && cmd) {
    if (!allowlist.includes(cmd)) {
      throw new Error(`runOnComplete: trigger_command "${cmd}" not in allowlist [${allowlist.join(', ')}] — allowlist-violation`);
    }
    if (cmd === 'archive_to_closed') {
      const result = doArchiveToClosed(signal, opts);
      out.executed.push(cmd);
      out.results.push({ command: cmd, ...result });
    } else if (cmd === 'post_followup_signal') {
      const result = doPostFollowupSignal(signal, opts);
      out.executed.push(cmd);
      out.results.push({ command: cmd, ...result });
    } else if (cmd === 'trigger_normalize_signals') {
      out.executed.push(cmd);
      out.results.push({ command: cmd, pending: true });
    }
  }

  // Convenience: if archive_to is set without trigger_command, treat as archive_to_closed.
  if (!cmd && onComplete.archive_to) {
    if (!allowlist.includes('archive_to_closed')) {
      throw new Error('runOnComplete: archive_to specified but archive_to_closed not in allowlist');
    }
    const result = doArchiveToClosed(signal, opts);
    out.executed.push('archive_to_closed');
    out.results.push({ command: 'archive_to_closed', ...result });
  }

  return out;
}

function doArchiveToClosed(signal, opts) {
  const filePath = opts.signalFilePath;
  if (!filePath) {
    return { skipped: 'no-signalFilePath' };
  }
  if (!fs.existsSync(filePath)) {
    return { skipped: 'signal-file-not-found', filePath };
  }
  const closedDir = opts.closedDir
    || (signal.on_complete && signal.on_complete.archive_to)
    || DEFAULT_CLOSED_DIR;
  const resolvedClosedDir = path.isAbsolute(closedDir) ? closedDir : path.resolve(PROJECT_ROOT, closedDir);
  fs.mkdirSync(resolvedClosedDir, { recursive: true });
  const target = path.join(resolvedClosedDir, path.basename(filePath));
  fs.renameSync(filePath, target);
  return { from: filePath, to: target };
}

function doPostFollowupSignal(signal, opts) {
  const followups = Array.isArray(signal.on_complete && signal.on_complete.emit_followup_signals)
    ? signal.on_complete.emit_followup_signals
    : [];
  const written = [];
  for (const entry of followups) {
    if (!entry || typeof entry !== 'object') continue;
    const targetPath = entry.path;
    if (!targetPath || typeof targetPath !== 'string') continue;
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const body = entry.signal || entry.payload || entry;
    fs.writeFileSync(resolved, `${JSON.stringify(body, null, 2)}\n`);
    written.push(resolved);
  }
  return { written };
}

/**
 * completeIfSatisfied — If isThresholdSatisfied → flip lifecycle_state to 'complete',
 * stamp completed_at + completed_by_session_id, and call runOnComplete.
 *
 * @param {object} signal
 * @param {object} [opts]
 * @param {string} [opts.completed_by_session_id]
 * @param {string} [opts.now]
 * @param {Function} [opts.registryListActive]
 * @param {string[]} [opts.allowlistedCommands]
 * @param {string} [opts.signalFilePath]
 * @returns {{completed:boolean, signal:object, fired:boolean, reason:string, on_complete_result?:object}}
 */
function completeIfSatisfied(signal, opts = {}) {
  const evaluation = isThresholdSatisfied(signal, opts);
  if (!evaluation.satisfied) {
    return {
      completed: false,
      signal,
      fired: false,
      reason: evaluation.reason || 'threshold-not-satisfied'
    };
  }

  if (signal.lifecycle_state === 'complete') {
    return {
      completed: false,
      signal,
      fired: false,
      reason: 'already-complete'
    };
  }

  const updated = deepClone(signal);
  updated.lifecycle_state = 'complete';
  updated.completed_at = nowIso(opts);
  if (opts.completed_by_session_id) {
    updated.completed_by_session_id = opts.completed_by_session_id;
  }
  if (Array.isArray(evaluation.unreachable_sessions) && evaluation.unreachable_sessions.length > 0) {
    updated.unreachable_sessions = evaluation.unreachable_sessions;
  }

  let onCompleteResult = null;
  let fired = false;
  if (updated.on_complete) {
    onCompleteResult = runOnComplete(updated, opts);
    fired = Array.isArray(onCompleteResult.executed) && onCompleteResult.executed.length > 0;
  }

  return {
    completed: true,
    signal: updated,
    fired,
    reason: evaluation.reason,
    on_complete_result: onCompleteResult
  };
}

module.exports = {
  // primary
  stampAcknowledgement,
  resolveTargetAddressees,
  isThresholdSatisfied,
  completeIfSatisfied,
  runOnComplete,
  // constants
  VALID_ACTION_TAKEN,
  VALID_THRESHOLD_MODES,
  VALID_TARGET_MODES,
  DEFAULT_ALLOWLISTED_COMMANDS,
  DEFAULT_SIGNALS_DIR,
  DEFAULT_CLOSED_DIR,
  planSignalNormalization: require('./signal-normalization-proposal').planSignalNormalization
};
