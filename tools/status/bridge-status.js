'use strict';

/**
 * bridge-status.js — Bridge lifecycle observability module.
 *
 * Reads bridge state from `_dev/state/bridge-state.json` and produces
 * canonical BridgeStatus/1.0 snapshots to `_dev/reports/signals/`.
 * Provides query helpers for the latest snapshot and human-readable
 * summaries.
 */

const fs = require('fs');
const path = require('path');

// ── Constants ──

const BRIDGE_STATUS_DIR = '_dev/reports/signals';
const BRIDGE_STATUS_PREFIX = 'bridge-status__';

// ── Helpers ──

/**
 * Safe JSON reader — returns null on missing file or parse error.
 * @param {string} filePath
 * @returns {object|null}
 */
function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Generate a filename-safe timestamp string.
 * e.g. "20260409T031500Z"
 * @returns {string}
 */
function fileTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// ── Core functions ──

/**
 * Create a BridgeStatus/1.0 snapshot from the current bridge state on disk.
 *
 * Reads `_dev/state/bridge-state.json`, builds scope entries with
 * transition counts, and computes summary counts.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {object} BridgeStatus/1.0 artifact (not written to disk).
 */
function createStatusSnapshot(projectRoot) {
  const bridgeStatePath = path.join(projectRoot, '_dev', 'state', 'bridge-state.json');
  const raw = safeReadJson(bridgeStatePath) || {};

  const scopes = {};
  let active = 0;
  let completed = 0;
  let blocked = 0;

  for (const [scope, entry] of Object.entries(raw)) {
    const state = entry.state || 'handoff_prepared';
    const transitionCount = Array.isArray(entry.history) ? entry.history.length : 0;

    const scopeEntry = {
      state,
      updated_at: entry.updated_at || new Date().toISOString(),
      transition_count: transitionCount
    };

    if (entry.produced_by_actor_id) {
      scopeEntry.produced_by_actor_id = entry.produced_by_actor_id;
    }
    if (entry.produced_by_harness_id) {
      scopeEntry.produced_by_harness_id = entry.produced_by_harness_id;
    }
    if (entry.validated_by_actor_id) {
      scopeEntry.validated_by_actor_id = entry.validated_by_actor_id;
    }
    if (entry.validated_by_harness_id) {
      scopeEntry.validated_by_harness_id = entry.validated_by_harness_id;
    }

    scopes[scope] = scopeEntry;

    // Summary counts
    if (state === 'handoff_prepared' || state === 'bridge_active') {
      active++;
    } else if (state === 'feedback_received') {
      completed++;
    } else if (state === 'blocked_on_actor_bridge') {
      blocked++;
    }
  }

  const totalScopes = Object.keys(scopes).length;

  return {
    schema: 'BridgeStatus/1.0',
    timestamp: new Date().toISOString(),
    scopes,
    summary: {
      total_scopes: totalScopes,
      active,
      completed,
      blocked
    }
  };
}

/**
 * Create and write a BridgeStatus/1.0 snapshot to disk.
 *
 * Writes to `_dev/reports/signals/bridge-status__<timestamp>.json`.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {{ path: string, snapshot: object }}
 */
function writeStatusSnapshot(projectRoot) {
  const snapshot = createStatusSnapshot(projectRoot);
  const dir = path.join(projectRoot, BRIDGE_STATUS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${BRIDGE_STATUS_PREFIX}${fileTimestamp()}.json`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  return { path: filePath, snapshot };
}

/**
 * Find and read the latest bridge-status snapshot file.
 *
 * Scans `_dev/reports/signals/` for files matching the bridge-status
 * prefix, sorts by timestamp in filename descending, and returns the
 * parsed content of the most recent one.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {object|null} Parsed snapshot, or null if none exist.
 */
function readLatestSnapshot(projectRoot) {
  const snapshots = listSnapshots(projectRoot);
  if (snapshots.length === 0) return null;

  const latestPath = snapshots[0];
  return safeReadJson(latestPath);
}

/**
 * Produce a human-readable summary string from a BridgeStatus/1.0 snapshot.
 *
 * @param {object} snapshot - A BridgeStatus/1.0 artifact.
 * @returns {string} Multi-line summary.
 */
function summarizeBridgeState(snapshot) {
  if (!snapshot || snapshot.schema !== 'BridgeStatus/1.0') {
    return 'No valid BridgeStatus/1.0 snapshot provided.';
  }

  const lines = [];
  const summary = snapshot.summary || {};
  lines.push('Bridge Status Summary');
  lines.push('=====================');
  lines.push(`Snapshot: ${snapshot.timestamp}`);
  lines.push(`Total scopes: ${summary.total_scopes || 0}`);
  lines.push(`  Active:    ${summary.active || 0}`);
  lines.push(`  Completed: ${summary.completed || 0}`);
  lines.push(`  Blocked:   ${summary.blocked || 0}`);

  const scopes = snapshot.scopes || {};
  const scopeKeys = Object.keys(scopes);
  if (scopeKeys.length > 0) {
    lines.push('');
    lines.push('Scopes:');
    for (const scope of scopeKeys) {
      const entry = scopes[scope];
      const transitions = entry.transition_count != null ? entry.transition_count : '?';
      lines.push(`  [${entry.state}] ${scope} (${transitions} transitions, updated ${entry.updated_at})`);
    }
  }

  return lines.join('\n');
}

/**
 * List all bridge-status snapshot file paths, sorted by timestamp descending.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {string[]} Array of absolute file paths.
 */
function listSnapshots(projectRoot) {
  const dir = path.join(projectRoot, BRIDGE_STATUS_DIR);

  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return files
    .filter(f => f.startsWith(BRIDGE_STATUS_PREFIX) && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => path.join(dir, f));
}

// ── Exports ──

module.exports = {
  BRIDGE_STATUS_DIR,
  BRIDGE_STATUS_PREFIX,
  createStatusSnapshot,
  writeStatusSnapshot,
  readLatestSnapshot,
  summarizeBridgeState,
  listSnapshots
};
