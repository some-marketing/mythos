'use strict';

/**
 * mind-router-shadow.cjs — S3 of adaptive-mind-router.
 *
 * SHADOW MODE (R1): records what the learning router WOULD recommend next to
 * what the static registry actually chose. Never influences the decision.
 * Never throws into the dispatch hot path — but failures are LOUD (G2):
 * a consultation_failed event is appended and counted in S6 reports, so a
 * broken matrix cannot rot silently while appearing to observe.
 *
 * Ledger: _dev/state/mind-matrix/shadow-decisions.jsonl (append-only).
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SHADOW_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'mind-matrix');
const SHADOW_LOG = path.join(SHADOW_DIR, 'shadow-decisions.jsonl');

function append(record) {
  try {
    fs.mkdirSync(SHADOW_DIR, { recursive: true });
    fs.appendFileSync(SHADOW_LOG, JSON.stringify(record) + '\n');
    capLog();
  } catch {
    // The shadow ledger itself failing must not break dispatch; the S6
    // harness detects gaps by comparing dispatch telemetry volume to shadow
    // volume — absence is the loud signal of last resort.
  }
}

function capLog() {
  try {
    if (fs.existsSync(SHADOW_LOG) && fs.statSync(SHADOW_LOG).size > 1024 * 1024) {
      const lines = fs.readFileSync(SHADOW_LOG, 'utf8').trimEnd().split('\n');
      fs.writeFileSync(SHADOW_LOG, lines.slice(-2000).join('\n') + '\n');
    }
  } catch { /* capping never fails the run */ }
}

/**
 * Record a shadow consultation at dispatch time. opts:
 *   { stage, task, target, paths, workload, static_choice }
 * Fail-open LOUDLY: on any internal error a consultation_failed event is
 * written instead of the recommendation.
 */
function recordShadowDecision(opts = {}) {
  const base = {
    schema: 'ShadowDecision/1.0',
    at: new Date().toISOString(),
    stage: opts.stage || 'dispatch',
    target: opts.target || '',
    workload: opts.workload || '',
    static_choice: opts.static_choice || ''
  };
  try {
    const { routeTier } = require('./tier-routing.cjs');
    const route = routeTier({
      task: opts.task || '',
      paths: opts.paths || [],
      transfer_distance: opts.transfer_distance
    });
    let cell = null;
    try {
      const { buildMatrix, lookup } = require('../../kernel/tier-ledger/matrix.cjs');
      const mindId = opts.static_choice
        ? `${opts.target}:${opts.static_choice}`
        : `${opts.target}:default`;
      cell = lookup(buildMatrix(), mindId, route.altitude, route.verification_shape);
    } catch (err) {
      cell = { consultation_failed: true, error: String(err && err.message).slice(0, 200) };
    }
    append({ ...base, recommendation: route, matrix_cell: cell });
    return { recorded: true };
  } catch (err) {
    append({
      ...base,
      consultation_failed: true,
      error: String(err && err.message).slice(0, 200)
    });
    return { recorded: false, failed: true };
  }
}

module.exports = { recordShadowDecision, SHADOW_LOG };
