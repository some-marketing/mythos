'use strict';

/**
 * live-signal-scanner.js — Read-only enumeration + matching of live coordination
 * signals for the Layer 3 self-driving protocol.
 *
 * Cluster B (this cluster) owns this surface. The hook dispatcher (cluster A)
 * and the codex managed-runtime register/heartbeat wiring (cluster C) both
 * consume the public exports here without modifying them.
 *
 * Scope:
 *   - listLiveSignals(opts)              → all `coordination-request__*.json`
 *                                          in signalsDir whose
 *                                          lifecycle_state === 'live'.
 *                                          Does NOT recurse into closed/.
 *   - matchSignalsForSession(query)      → filter live signals to those
 *                                          addressing the current session by
 *                                          session_id, actor_id (compound key
 *                                          with substring), branch overlap,
 *                                          working-surface overlap, or by a
 *                                          writtenPath appearing in
 *                                          signal.artifacts.
 *
 * See: _dev/reports/analysis/codex-bridge-response__layer-3-wiring-self-driving-protocol.md
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'signals');

const LIVE_SIGNAL_BASENAME_RE = /^coordination-request__.+\.json$/i;

function resolveSignalsDir(opts) {
  const dir = (opts && opts.signalsDir) || DEFAULT_SIGNALS_DIR;
  return path.isAbsolute(dir) ? dir : path.resolve(PROJECT_ROOT, dir);
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * listLiveSignals — Enumerate `_dev/reports/signals/coordination-request__*.json`
 * (top-level only; closed/ subdir is skipped) and return the subset whose
 * `lifecycle_state === 'live'`.
 *
 * @param {object} [opts]
 * @param {string} [opts.signalsDir]
 * @returns {Array<{path:string, signal:object}>}
 */
function listLiveSignals(opts = {}) {
  const signalsDir = resolveSignalsDir(opts);
  if (!fs.existsSync(signalsDir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(signalsDir, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const live = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!LIVE_SIGNAL_BASENAME_RE.test(entry.name)) continue;
    const filePath = path.join(signalsDir, entry.name);
    const signal = safeReadJson(filePath);
    if (!signal || typeof signal !== 'object') continue;
    if (signal.lifecycle_state !== 'live') continue;
    live.push({ path: filePath, signal });
  }
  return live;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function actorIdMatches(targetActors, actorId) {
  if (!actorId) return false;
  for (const t of targetActors) {
    if (typeof t !== 'string' || !t) continue;
    if (t === actorId) return true;
    // compound key tolerance: target may name `claude-opus-4-7` and the live
    // session is `claude-opus-4-7:kerneling-rupert`, or vice versa.
    if (actorId.includes(t)) return true;
    if (t.includes(actorId)) return true;
  }
  return false;
}

function branchOverlaps(signal, currentBranch) {
  if (!currentBranch) return false;
  const candidates = [
    signal.source_branch,
    signal.scope,
    signal.signal_scope
  ].filter((v) => typeof v === 'string' && v);
  return candidates.some((c) => c.includes(currentBranch) || currentBranch.includes(c));
}

function surfaceOverlaps(signal, workingSurface) {
  const surfaces = asArray(workingSurface).filter((s) => typeof s === 'string' && s);
  if (surfaces.length === 0) return false;
  const artifacts = asArray(signal.artifacts).filter((a) => typeof a === 'string' && a);
  return surfaces.some((surf) => artifacts.some((art) => art.includes(surf) || surf.includes(art)));
}

function pathMatchesArtifact(writtenPath, artifact) {
  if (typeof writtenPath !== 'string' || !writtenPath) return false;
  if (typeof artifact !== 'string' || !artifact) return false;
  if (writtenPath === artifact) return true;
  // Tolerate absolute vs project-relative.
  const wpRel = writtenPath.startsWith('/') ? path.relative(PROJECT_ROOT, writtenPath) : writtenPath;
  const artRel = artifact.startsWith('/') ? path.relative(PROJECT_ROOT, artifact) : artifact;
  return wpRel === artRel;
}

/**
 * matchSignalsForSession — Filter listLiveSignals() to those addressing the
 * given session by any of:
 *   - sessionId in target_addressees.sessions
 *   - actorId substring-match against target_addressees.actors
 *   - currentBranch overlap with signal.source_branch / scope / signal_scope
 *   - workingSurface overlap with signal.artifacts
 *   - writtenPath appears in signal.artifacts (load-bearing for per-write scan)
 *
 * @param {object} query
 * @param {string} [query.sessionId]
 * @param {string} [query.actorId]
 * @param {string} [query.currentBranch]
 * @param {string|string[]} [query.workingSurface]
 * @param {string} [query.writtenPath]
 * @param {string} [query.signalsDir]
 * @returns {Array<{path:string, signal:object, match_reasons:string[]}>}
 */
function matchSignalsForSession(query = {}) {
  const live = listLiveSignals({ signalsDir: query.signalsDir });
  const out = [];

  for (const entry of live) {
    const reasons = [];
    const target = entry.signal.target_addressees || {};
    const targetSessions = asArray(target.sessions);
    const targetActors = asArray(target.actors).concat(asArray(target.actor_ids));

    if (query.sessionId && targetSessions.includes(query.sessionId)) {
      reasons.push('session_id-in-target');
    }
    if (query.actorId && actorIdMatches(targetActors, query.actorId)) {
      reasons.push('actor_id-match');
    }
    if (query.currentBranch && branchOverlaps(entry.signal, query.currentBranch)) {
      reasons.push('branch-overlap');
    }
    if (query.workingSurface && surfaceOverlaps(entry.signal, query.workingSurface)) {
      reasons.push('working-surface-overlap');
    }
    if (query.writtenPath) {
      const arts = asArray(entry.signal.artifacts);
      if (arts.some((a) => pathMatchesArtifact(query.writtenPath, a))) {
        reasons.push('written-path-in-artifacts');
      }
      // Also: the signal file itself was written.
      if (pathMatchesArtifact(query.writtenPath, entry.path)) {
        reasons.push('signal-file-written');
      }
    }

    if (reasons.length > 0) {
      out.push({ path: entry.path, signal: entry.signal, match_reasons: reasons });
    }
  }

  return out;
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_SIGNALS_DIR,
  listLiveSignals,
  matchSignalsForSession
};
