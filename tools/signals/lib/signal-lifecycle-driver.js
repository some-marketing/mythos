'use strict';

/**
 * signal-lifecycle-driver.js — Orchestrates per-signal lifecycle evaluation
 * + persistence + on_complete firing for the Layer 3 self-driving protocol.
 *
 * Cluster B owns this module. Cluster A's hook dispatcher will call into:
 *   - processSignalsForWrittenPath({ writtenPath, completedBySessionId })
 *     after every PostToolUse:Write to fire targeted completion checks.
 *   - scanInboundForSession({ sessionId, actorId, ... })
 *     to render system-reminder text for unacknowledged inbound signals.
 *
 * KEY BUG FIX: completeIfSatisfied returns an updated signal object with
 * lifecycle_state='complete', but the prior wiring archived BEFORE persisting
 * the new state to disk, so the archived file still showed lifecycle_state='live'.
 * processSignal here writes the updated payload (atomic temp+rename) BEFORE
 * invoking runOnComplete (which archives), so the archived file carries the
 * correct lifecycle_state.
 *
 * See: _dev/reports/analysis/codex-bridge-response__layer-3-wiring-self-driving-protocol.md
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const lifecycle = require('./signal-lifecycle');
const scanner = require('./live-signal-scanner');

const PROJECT_ROOT = scanner.PROJECT_ROOT;
const DEFAULT_SIGNALS_DIR = scanner.DEFAULT_SIGNALS_DIR;
const DEFAULT_CLOSED_DIR = path.join(DEFAULT_SIGNALS_DIR, 'closed');

function nowIso(opts) {
  return (opts && opts.now) || new Date().toISOString();
}

function lazyRegistryListActive() {
  return function listActiveFromRegistry(options) {
    // eslint-disable-next-line global-require
    const registry = require('../../sessions/lib/active-session-registry');
    return registry.listActive(options);
  };
}

function sessionIdFromRegistryEntry(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.session_id === 'string') {
    return entry.session_id;
  }
  return null;
}

/**
 * resolveAllActiveTargets — Resolve target_addressees.mode="all-active"
 * against active-session-registry at completion-check time.
 *
 * The asker's own produced_by_session_id is excluded because the asker does
 * not acknowledge their own broadcast signal.
 *
 * @param {object} signal
 * @param {object} [opts]
 * @param {string} [opts.now]
 * @param {Function} [opts.registryListActive]
 * @returns {{mode:string, source:string, resolved_at:string, sessions:string[], diagnostic?:string}}
 */
function resolveAllActiveTargets(signal, opts = {}) {
  const resolvedAt = nowIso(opts);
  const listActive = opts.registryListActive || lazyRegistryListActive();
  const askerSessionId = signal && typeof signal.produced_by_session_id === 'string'
    ? signal.produced_by_session_id
    : null;

  try {
    const live = listActive({ now: resolvedAt }) || [];
    if (!Array.isArray(live)) {
      return Object.freeze({
        mode: 'all-active',
        source: 'active-session-registry',
        resolved_at: resolvedAt,
        sessions: Object.freeze([]),
        diagnostic: 'registry-listActive-malformed'
      });
    }

    const seen = new Set();
    const sessions = [];
    for (const entry of live) {
      const sessionId = sessionIdFromRegistryEntry(entry);
      if (!sessionId || sessionId === askerSessionId || seen.has(sessionId)) {
        continue;
      }
      seen.add(sessionId);
      sessions.push(sessionId);
    }

    return Object.freeze({
      mode: 'all-active',
      source: 'active-session-registry',
      resolved_at: resolvedAt,
      sessions: Object.freeze(sessions)
    });
  } catch (err) {
    return Object.freeze({
      mode: 'all-active',
      source: 'active-session-registry',
      resolved_at: resolvedAt,
      sessions: Object.freeze([]),
      diagnostic: `registry-listActive-threw: ${err.message}`
    });
  }
}

/**
 * resolveTargetAddressees — Driver-level target resolver. This preserves the
 * existing lifecycle helper modes and adds all-active registry wiring.
 *
 * @param {object} signal
 * @param {object} [opts]
 * @returns {{mode:string, sessions:string[], resolved_at?:string, source?:string, diagnostic?:string}|null}
 */
function resolveTargetAddressees(signal, opts = {}) {
  const target = signal && signal.target_addressees;
  if (!target || typeof target !== 'object') {
    return null;
  }

  if (target.mode === 'all-active') {
    return resolveAllActiveTargets(signal, opts);
  }

  return lifecycle.resolveTargetAddressees(signal, opts);
}

function signalForLifecycleEvaluation(signal, opts = {}) {
  const target = signal && signal.target_addressees;
  if (!target || target.mode !== 'all-active') {
    return signal;
  }

  const resolved = resolveAllActiveTargets(signal, opts);
  return {
    ...signal,
    target_addressees: {
      ...target,
      mode: 'snapshot',
      source: resolved.source,
      resolved_at: resolved.resolved_at,
      sessions: Array.from(resolved.sessions)
    }
  };
}

function atomicWriteJson(filePath, data) {
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
  const tempPath = path.join(
    dirPath,
    `${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );
  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'w');
    fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    try { fs.fsyncSync(fd); } catch (_) { /* best-effort */ }
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* best-effort */ }
    }
    try { fs.unlinkSync(tempPath); } catch (_) { /* best-effort */ }
    throw err;
  }
}

function readSignalFile(signalPath) {
  const raw = fs.readFileSync(signalPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * processSignal — Load signal at signalPath, evaluate threshold, and if
 * satisfied:
 *   1. mutate the on-disk file FIRST so lifecycle_state='complete' is durable
 *      regardless of what runOnComplete does next (fixes archive-before-persist
 *      regression),
 *   2. then call runOnComplete which may archive the (now-correct) file.
 *
 * @param {string} signalPath - absolute path to the live signal file
 * @param {object} [opts]
 * @param {string} [opts.completedBySessionId]
 * @param {string} [opts.now]
 * @param {Function} [opts.registryListActive]
 * @param {string[]} [opts.allowlistedCommands]
 * @param {string} [opts.signalsDir]
 * @param {string} [opts.closedDir]
 * @returns {{path:string, completed:boolean, archived:boolean, reason:string, errors:string[]}}
 */
function processSignal(signalPath, opts = {}) {
  const result = {
    path: signalPath,
    completed: false,
    archived: false,
    reason: '',
    errors: []
  };

  let signal;
  try {
    signal = readSignalFile(signalPath);
  } catch (err) {
    result.errors.push(`read-failed:${err.message}`);
    result.reason = 'read-failed';
    return result;
  }

  if (!signal || signal.lifecycle_state !== 'live') {
    result.reason = `not-live:${signal && signal.lifecycle_state}`;
    return result;
  }

  let evaluation;
  try {
    evaluation = lifecycle.completeIfSatisfied(signalForLifecycleEvaluation(signal, opts), {
      completed_by_session_id: opts.completedBySessionId,
      now: opts.now,
      registryListActive: opts.registryListActive,
      allowlistedCommands: opts.allowlistedCommands,
      signalFilePath: signalPath,
      signalsDir: opts.signalsDir || DEFAULT_SIGNALS_DIR,
      closedDir: opts.closedDir || DEFAULT_CLOSED_DIR
    });
  } catch (err) {
    result.errors.push(`evaluate-threw:${err.message}`);
    result.reason = 'evaluate-threw';
    return result;
  }

  if (!evaluation.completed) {
    result.reason = evaluation.reason || 'not-satisfied';
    return result;
  }

  // PERSIST FIRST. completeIfSatisfied returned the UPDATED signal but did NOT
  // write it to disk; runOnComplete (called inside completeIfSatisfied) may
  // already have archived the file. To handle that correctly we (a) detect
  // whether the original path still exists, and (b) write the updated payload
  // to wherever the file lives now.
  const updated = evaluation.signal;
  let onCompleteResult = evaluation.on_complete_result || null;

  // Determine where the file is now. completeIfSatisfied calls runOnComplete
  // which, for archive_to_closed, RENAMES the file. We need to identify the
  // post-archive location and rewrite it with the updated lifecycle_state.
  let livePath = signalPath;
  let archivedPath = null;
  if (onCompleteResult && Array.isArray(onCompleteResult.results)) {
    for (const r of onCompleteResult.results) {
      if (r && r.command === 'archive_to_closed' && r.to) {
        archivedPath = r.to;
      }
    }
  }

  try {
    if (archivedPath && fs.existsSync(archivedPath)) {
      atomicWriteJson(archivedPath, updated);
      result.archived = true;
    } else if (fs.existsSync(livePath)) {
      atomicWriteJson(livePath, updated);
    } else {
      // Neither location exists — degenerate case.
      result.errors.push('post-complete-file-missing');
    }
  } catch (err) {
    result.errors.push(`persist-failed:${err.message}`);
  }

  result.completed = true;
  result.reason = evaluation.reason || 'completed';
  return result;
}

/**
 * processAllLiveSignals — Iterate every live signal in signalsDir and call
 * processSignal on each. Returns a per-signal result array.
 *
 * @param {object} [opts]
 * @returns {Array<object>}
 */
function processAllLiveSignals(opts = {}) {
  const live = scanner.listLiveSignals({ signalsDir: opts.signalsDir });
  const results = [];
  for (const entry of live) {
    results.push(processSignal(entry.path, opts));
  }
  return results;
}

/**
 * processSignalsForWrittenPath — Targeted scan: only signals whose artifacts
 * include writtenPath OR whose own file path === writtenPath. This is the
 * cheap path the dispatcher calls after every PostToolUse:Write.
 *
 * @param {object} opts
 * @param {string} opts.writtenPath
 * @returns {Array<object>}
 */
function processSignalsForWrittenPath(opts = {}) {
  const writtenPath = opts.writtenPath;
  if (!writtenPath || typeof writtenPath !== 'string') return [];

  const live = scanner.listLiveSignals({ signalsDir: opts.signalsDir });
  const results = [];
  for (const entry of live) {
    const artifacts = Array.isArray(entry.signal.artifacts) ? entry.signal.artifacts : [];
    const matchesArtifact = artifacts.some((a) => {
      if (typeof a !== 'string') return false;
      if (a === writtenPath) return true;
      const wpRel = writtenPath.startsWith('/') ? path.relative(PROJECT_ROOT, writtenPath) : writtenPath;
      const aRel = a.startsWith('/') ? path.relative(PROJECT_ROOT, a) : a;
      return wpRel === aRel;
    });
    const matchesSelf = entry.path === writtenPath;
    if (!matchesArtifact && !matchesSelf) continue;
    results.push(processSignal(entry.path, opts));
  }
  return results;
}

function formatInboundLine(matchEntry) {
  const sig = matchEntry.signal;
  const reasons = matchEntry.match_reasons.join(',');
  const scope = sig.scope || sig.signal_scope || '(no-scope)';
  const request = sig.request || sig.recommended_next_command || '(no-request)';
  return `- ${path.basename(matchEntry.path)} :: scope=${scope} :: ${request} :: match=${reasons}`;
}

/**
 * scanInboundForSession — Convenience wrapper around matchSignalsForSession
 * that returns formatted text suitable for system-reminder injection.
 *
 * @param {object} query - same shape as matchSignalsForSession
 * @returns {{count:number, text:string, matches:Array<object>}}
 */
function scanInboundForSession(query = {}) {
  const matches = scanner.matchSignalsForSession(query);
  if (matches.length === 0) {
    return { count: 0, text: '', matches: [] };
  }
  const header = `[live-signal-scanner] ${matches.length} live coordination signal(s) addressing this session:`;
  const lines = matches.map(formatInboundLine);
  return {
    count: matches.length,
    text: [header, ...lines].join('\n'),
    matches
  };
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_SIGNALS_DIR,
  DEFAULT_CLOSED_DIR,
  resolveAllActiveTargets,
  resolveTargetAddressees,
  processSignal,
  processAllLiveSignals,
  processSignalsForWrittenPath,
  scanInboundForSession,
  // exported for testability
  _atomicWriteJson: atomicWriteJson
};
