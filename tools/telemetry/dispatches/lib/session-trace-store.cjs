'use strict';

/**
 * session-trace-store.cjs — Per-session cascade-trace root store (C1).
 *
 * The in-session Claude Agent/Task path emits its span from the SubagentStop
 * hook, which runs in a FRESH node process whose env never adopted the
 * SessionStart-seeded trace context — so it would emit `unknown`-trace rows.
 * The global `_dev/state/cascade-trace/root-env.sh` cannot fix this: it is a
 * single file, last-writer-wins across concurrent sessions (the live file
 * routinely carries a different session's id).
 *
 * This store keys the cascade root by the harness `session_id` (which BOTH the
 * SessionStart payload and the SubagentStop payload carry), so the SubagentStop
 * writer can re-read the exact root its own session seeded and attribute its
 * worker span to it — producing a correct flat 2-level tree (session root → N
 * worker spans). Deeper nesting is intentionally NOT reconstructed: the harness
 * exposes no Task↔SubagentStop correlation token, so it would be fabricated
 * structure (convene 20260616T130036Z, both lobes).
 *
 * Constitutional invariant: every function here is FAIL-SILENT/FAIL-OPEN — a
 * read/write failure returns null/false and never throws into a hook.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const STORE_DIR_REL = '_dev/state/cascade-trace';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — lazy passive cleanup

// session_id is normally a UUID; defend the filename against anything that
// could escape the store directory or break the path.
function sanitizeSessionId(sessionId) {
  return String(sessionId || 'unknown-session').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

function storeDir(root) {
  return path.join(root, STORE_DIR_REL);
}

function sessionTracePath(root, sessionId) {
  return path.join(storeDir(root), `session-${sanitizeSessionId(sessionId)}.json`);
}

/**
 * writeSessionTraceRoot — persist the per-session cascade root (atomic).
 * Returns true on success, false on any failure (fail-silent). Skips when
 * traceId/rootSpanId/sessionId are missing or traceId is the sentinel.
 */
function writeSessionTraceRoot(root, fields = {}) {
  try {
    const sessionId = fields.sessionId;
    const traceId = fields.traceId;
    const rootSpanId = fields.rootSpanId;
    if (!sessionId || !traceId || traceId === 'unknown' || !rootSpanId) return false;
    const dir = storeDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      schema: 'SessionTraceRoot/1.0',
      session_id: String(sessionId),
      trace_id: String(traceId),
      root_span_id: String(rootSpanId),
      host: fields.host || os.hostname() || null,
      scope: fields.scope || null,
      stamped_at: fields.stampedAt || new Date().toISOString()
    };
    const finalPath = sessionTracePath(root, sessionId);
    const tmpPath = `${finalPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(record) + '\n');
    fs.renameSync(tmpPath, finalPath); // atomic on same filesystem
    return true;
  } catch {
    return false; // fail-silent
  }
}

/**
 * readSessionTraceRoot — load the per-session cascade root for sessionId.
 * Returns the parsed record, or null when absent/corrupt/unreadable.
 */
function readSessionTraceRoot(root, sessionId) {
  try {
    if (!sessionId) return null;
    const raw = fs.readFileSync(sessionTracePath(root, sessionId), 'utf8');
    const rec = JSON.parse(raw);
    if (!rec || typeof rec !== 'object' || !rec.trace_id || rec.trace_id === 'unknown' || !rec.root_span_id) {
      return null;
    }
    // Defend against a stale/corrupt record attributing a worker under the WRONG
    // root (codex MAJOR): require the locked schema AND an exact session match.
    // A mismatch fails open to ambient/unknown rather than mis-nesting.
    if (rec.schema !== 'SessionTraceRoot/1.0') return null;
    if (String(rec.session_id) !== String(sessionId)) return null;
    return rec;
  } catch {
    return null; // absent/corrupt → caller falls back to ambient/unknown
  }
}

/**
 * cleanupOldSessionTraces — lazy passive sweep (no daemon/TTL thread).
 * Deletes session-*.json older than maxAgeMs. Called from SessionStart.
 * Fail-silent; returns the count removed.
 */
function cleanupOldSessionTraces(root, maxAgeMs = DEFAULT_MAX_AGE_MS, nowMs = Date.now()) {
  let removed = 0;
  try {
    const dir = storeDir(root);
    for (const name of fs.readdirSync(dir)) {
      if (!/^session-.*\.json$/.test(name)) continue;
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (nowMs - st.mtimeMs) > maxAgeMs) {
          fs.unlinkSync(p);
          removed += 1;
        }
      } catch {
        // skip unreadable entry
      }
    }
  } catch {
    // missing dir / unreadable — nothing to clean
  }
  return removed;
}

module.exports = {
  STORE_DIR_REL,
  DEFAULT_MAX_AGE_MS,
  sanitizeSessionId,
  sessionTracePath,
  writeSessionTraceRoot,
  readSessionTraceRoot,
  cleanupOldSessionTraces
};
