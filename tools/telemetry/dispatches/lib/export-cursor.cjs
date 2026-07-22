'use strict';
/**
 * export-cursor.cjs — Persistent cursor state for the always-on Langfuse
 * export daemon.
 *
 * Tracks which correlation_ids have been successfully exported so each poll
 * interval only exports NEW spans and never re-scans the whole dispatches.jsonl.
 * This is a RE-SCAN-STORM PREVENTER, not a duplication guard — Langfuse's
 * content-stable span IDs make the exporter idempotent. The cursor adds
 * efficiency and failure-tolerance.
 *
 * Failure semantics:
 *   - advance() is called only AFTER a successful export. A failed export
 *     leaves the cursor at its previous position so the next tick retries.
 *   - consecutive_failures is incremented per failed tick and reset to 0 on
 *     any success. Callers use this for sustained-failure alerting (N=3 gate).
 *
 * State schema (cursor.json):
 * {
 *   "schema": "ExportCursor/1.0",
 *   "exported_ids": ["<correlation_id>", ...],   // set of confirmed exports
 *   "last_export_ts": "<ISO8601>|null",           // when last success ran
 *   "consecutive_failures": 0,                   // reset on any success
 *   "last_failure_ts": "<ISO8601>|null",
 *   "last_failure_reason": "<string>|null",
 *   "signal_emitted_at": "<ISO8601>|null"        // last sustained-failure signal
 * }
 */

const fs = require('fs');
const path = require('path');

const SCHEMA = 'ExportCursor/1.0';

/**
 * Load or initialise the cursor file.
 * @param {string} cursorPath  Absolute path to cursor.json
 * @returns {object}           Live cursor state (mutated in-place by advance/fail)
 */
function loadCursor(cursorPath) {
  if (fs.existsSync(cursorPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
      // Migrate: ensure all fields present.
      return {
        schema: SCHEMA,
        exported_ids: Array.isArray(raw.exported_ids) ? raw.exported_ids : [],
        last_export_ts: raw.last_export_ts || null,
        consecutive_failures: typeof raw.consecutive_failures === 'number' ? raw.consecutive_failures : 0,
        first_failure_ts: raw.first_failure_ts || null,
        last_failure_ts: raw.last_failure_ts || null,
        last_failure_reason: raw.last_failure_reason || null,
        signal_emitted_at: raw.signal_emitted_at || null
      };
    } catch {
      // Corrupt file: start fresh; don't abort the daemon.
    }
  }
  return initCursor();
}

/**
 * Return a fresh zero-state cursor object (does NOT write to disk).
 * @returns {object}
 */
function initCursor() {
  return {
    schema: SCHEMA,
    exported_ids: [],
    last_export_ts: null,
    consecutive_failures: 0,
    first_failure_ts: null,
    last_failure_ts: null,
    last_failure_reason: null,
    signal_emitted_at: null
  };
}

/**
 * Persist the cursor to disk atomically (write tmp + rename).
 * @param {string} cursorPath
 * @param {object} cursor
 */
function saveCursor(cursorPath, cursor) {
  fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
  const tmp = cursorPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cursor, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, cursorPath);
}

/**
 * Return the set of correlation_ids that are NOT yet in the cursor (pending export).
 * @param {object} cursor
 * @param {string[]} allIds  All correlation_ids seen in dispatches.jsonl
 * @returns {string[]}       IDs pending export (order preserved)
 */
function pendingIds(cursor, allIds) {
  const done = new Set(cursor.exported_ids);
  return allIds.filter((id) => !done.has(id));
}

/**
 * Advance the cursor after a successful export of the given ids.
 * Resets consecutive_failures to 0. Mutates cursor in-place + saves.
 *
 * @param {string}   cursorPath
 * @param {object}   cursor
 * @param {string[]} exportedIdList  The ids that were just successfully exported
 */
function advance(cursorPath, cursor, exportedIdList) {
  const added = new Set(exportedIdList);
  // Merge (union) — never shrink the set.
  const merged = new Set([...cursor.exported_ids, ...added]);
  cursor.exported_ids = [...merged];
  cursor.last_export_ts = new Date().toISOString();
  // Recovery: a success ends the current failure run. Clear the run-scoped
  // failure markers so the NEXT failure run starts fresh and can re-signal.
  cursor.consecutive_failures = 0;
  cursor.first_failure_ts = null;
  cursor.signal_emitted_at = null;
  saveCursor(cursorPath, cursor);
}

/**
 * Record a failed tick. Increments consecutive_failures. Mutates + saves.
 *
 * @param {string} cursorPath
 * @param {object} cursor
 * @param {string} reason  Short human-readable reason for the failure
 */
function recordFailure(cursorPath, cursor, reason) {
  const nowTs = new Date().toISOString();
  cursor.consecutive_failures = (cursor.consecutive_failures || 0) + 1;
  // first_failure_ts marks the START of the current failure run (set once, on
  // the first failure after the last success). Recovery (advance) clears it.
  if (!cursor.first_failure_ts) cursor.first_failure_ts = nowTs;
  cursor.last_failure_ts = nowTs;
  cursor.last_failure_reason = String(reason).slice(0, 500);
  saveCursor(cursorPath, cursor);
}

/**
 * Mark that a sustained-failure TelemetryFailureSignal has been emitted.
 * Prevents re-emitting a signal on every subsequent failed tick.
 * Mutates + saves.
 *
 * @param {string} cursorPath
 * @param {object} cursor
 */
function markSignalEmitted(cursorPath, cursor) {
  cursor.signal_emitted_at = new Date().toISOString();
  saveCursor(cursorPath, cursor);
}

/**
 * Return true when a sustained-failure signal should be emitted.
 * Fires only on exactly N consecutive failures (not every tick after N) to
 * avoid signal storms — the signal is a one-shot per failure run.
 *
 * @param {object} cursor
 * @param {number} threshold  Default 3
 * @returns {boolean}
 */
function shouldEmitFailureSignal(cursor, threshold = 3) {
  if (cursor.consecutive_failures < threshold) return false;
  // If we already emitted a signal for this failure run, don't repeat.
  // A "failure run" ends when consecutive_failures resets to 0 (on success).
  // We detect "already signalled this run" by checking signal_emitted_at is
  // more recent than last_failure_ts would be if we'd reset. Simple heuristic:
  // re-emit only if consecutive_failures is exactly the threshold (first crossing).
  return cursor.consecutive_failures === threshold;
}

module.exports = {
  loadCursor,
  initCursor,
  saveCursor,
  pendingIds,
  advance,
  recordFailure,
  markSignalEmitted,
  shouldEmitFailureSignal
};
