'use strict';

/**
 * signal-lane.cjs
 *
 * Minimal reference implementation of the HandoffSignal live/closed lifecycle
 * documented in tools/signals/README.md and _dev/policies/data-handling.md
 * ("Handoff Signal Lifecycle" section).
 *
 * This is a STUB, not the full production signals pipeline: no bridge
 * dispatch, no watchers, no authority-decision engine. It only implements
 * the file-based mechanics of emitting, listing, and closing a signal. Node
 * builtins only (fs, path) — no dependencies, so it is easy to lift into a
 * different project and extend.
 *
 * Lifecycle contract (mirrors _dev/policies/data-handling.md exactly):
 *   - Live signals live in `_dev/reports/signals/`.
 *   - Closing a signal moves its file to `_dev/reports/signals/closed/` and
 *     adds `lifecycle_state: "closed"` and `closed_at` (ISO-8601) fields to
 *     the JSON, without otherwise touching the original content.
 *
 * Extend this by adding: schema validation against the JSON Schemas in
 * schemas/, an archive step for closed signals past a retention window, and
 * an authority-decision check before a signal is allowed to drive action.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const LIVE_DIR_REL = path.join('_dev', 'reports', 'signals');
const CLOSED_DIR_REL = path.join('_dev', 'reports', 'signals', 'closed');

function liveDir(root) {
  return path.join(root || DEFAULT_ROOT, LIVE_DIR_REL);
}

function closedDir(root) {
  return path.join(root || DEFAULT_ROOT, CLOSED_DIR_REL);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'signal';
}

/**
 * emitSignal(signal, options)
 *
 * Minimally validates the signal (must be a plain object, must carry a
 * `schema` field, and — if requiredFields is passed in options — must carry
 * every field named there), then writes it as a JSON file into the live
 * surface (`_dev/reports/signals/`).
 *
 * Filename convention: `<ISO-timestamp>-<topic-or-id-slug>.json`, where the
 * topic/id is taken from `signal.dispatch_id`, `signal.decision_id`,
 * `signal.proposal_id`, or `signal.schema` (in that preference order) if the
 * caller doesn't pass an explicit `options.topic`.
 *
 * Returns the absolute path of the written file.
 */
function emitSignal(signal, options = {}) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
    throw new TypeError('emitSignal: signal must be a plain object');
  }
  if (typeof signal.schema !== 'string' || signal.schema.length === 0) {
    throw new TypeError('emitSignal: signal.schema is required (e.g. "ActorWorkOrder/1.0")');
  }

  const requiredFields = Array.isArray(options.requiredFields) ? options.requiredFields : [];
  const missing = requiredFields.filter((field) => !(field in signal));
  if (missing.length > 0) {
    throw new Error(`emitSignal: signal is missing required fields: ${missing.join(', ')}`);
  }

  const root = options.root || DEFAULT_ROOT;
  const dir = liveDir(root);
  ensureDir(dir);

  const topicSource = options.topic || signal.dispatch_id || signal.decision_id || signal.proposal_id || signal.schema;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${slugify(topicSource)}.json`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, `${JSON.stringify(signal, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * listSignals(options)
 *
 * Reads every `.json` file currently in the live surface
 * (`_dev/reports/signals/`, not `closed/`) and returns an array of
 * { filename, path, signal } entries. Files that fail to parse as JSON are
 * skipped (not thrown) so one malformed file can't block the whole listing.
 */
function listSignals(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const dir = liveDir(root);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((filename) => {
      const filePath = path.join(dir, filename);
      try {
        const signal = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { filename, path: filePath, signal };
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * closeSignal(signalIdOrFilename, options)
 *
 * Locates a live signal by exact filename, or by matching `dispatch_id` /
 * `decision_id` / `proposal_id` / `schema` inside the file, then moves it
 * from `_dev/reports/signals/` to `_dev/reports/signals/closed/`, adding
 * `lifecycle_state: "closed"` and `closed_at` (ISO-8601, now) to the JSON
 * before writing it to its new location. The original file is removed from
 * the live surface once the closed copy is written.
 *
 * Returns the absolute path of the closed file, or null if no match found.
 */
function closeSignal(signalIdOrFilename, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const entries = listSignals({ root });

  const match = entries.find((entry) => {
    if (entry.filename === signalIdOrFilename) return true;
    const s = entry.signal || {};
    return (
      s.dispatch_id === signalIdOrFilename ||
      s.decision_id === signalIdOrFilename ||
      s.proposal_id === signalIdOrFilename
    );
  });

  if (!match) {
    return null;
  }

  const closed = {
    ...match.signal,
    lifecycle_state: 'closed',
    closed_at: new Date().toISOString()
  };

  const destDir = closedDir(root);
  ensureDir(destDir);
  const destPath = path.join(destDir, match.filename);

  fs.writeFileSync(destPath, `${JSON.stringify(closed, null, 2)}\n`, 'utf8');
  fs.rmSync(match.path);

  return destPath;
}

module.exports = {
  emitSignal,
  listSignals,
  closeSignal,
  liveDir,
  closedDir
};
