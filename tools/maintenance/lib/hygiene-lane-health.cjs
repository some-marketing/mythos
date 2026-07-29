'use strict';

/**
 * hygiene-lane-health.cjs — shared lane-health receipt writer for the
 * hygiene/self-healing apply lanes (grounding adjustment A2).
 *
 * Every apply-mode decision made by a self-healing tool (homeostasis --apply,
 * reconcile-task-outcomes pre-acceptance marking, repair-ladder sandbox verify)
 * appends ONE durable receipt here: what tool decided what, on what evidence,
 * with what outcome. Modeled on _dev/logs/local-first-routing.jsonl. This is an
 * acceptance criterion, not just a kill-switch — it makes a slow-drifting
 * false-pass pattern visible to a later distinct-intelligence pass.
 *
 * Append-only JSONL. The Python side (tools/fleet/homeostasis.py) writes the
 * same schema/shape to the same file.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const LANE_HEALTH_REL = path.join('_dev', 'reports', 'lifecycle', 'hygiene-lane-health.jsonl');
const SCHEMA = 'HygieneLaneHealth/1.0';

/**
 * @param {string} [base] - Optional root override (tests). Defaults to repo root.
 * @returns {string} Absolute path to the lane-health JSONL.
 */
function laneHealthPath(base) {
  return path.join(base || REPO_ROOT, LANE_HEALTH_REL);
}

/**
 * Append a single receipt. Never throws (fail-soft) — a receipt-write failure
 * must not turn a safe decision into an error.
 *
 * @param {object} rec - { tool, decision, target, verification, outcome, ... }
 * @param {object} [opts] - { base } root override for tests.
 * @returns {string|null} The path written, or null on failure.
 */
function appendReceipt(rec, opts = {}) {
  try {
    const p = laneHealthPath(opts.base);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const line = JSON.stringify({
      schema: SCHEMA,
      timestamp: new Date().toISOString(),
      ...rec,
    }) + '\n';
    fs.appendFileSync(p, line);
    return p;
  } catch (_) {
    return null;
  }
}

module.exports = { appendReceipt, laneHealthPath, SCHEMA };
