#!/usr/bin/env node
'use strict';

/**
 * convergence.js — W3 — the mechanical DRY predicate for the Loop Convergence
 * Bounding Law v3 (invariant 9 forbids a PROSE predicate).
 *
 * Spec: _dev/concepts/self-improving-loop-protocol/staging/canonical/
 *       loop-convergence-bounding-law-v3.md
 *
 * A loop CONVERGES only after M consecutive cycles where ALL of:
 *   (1) open-objection ledger EMPTY (objection-ledger.js; UNRESOLVED never clears)
 *   (2) 0 new material objections + 0 new disconfirming evidence + position_delta <= threshold
 *   (3) roster distinct-family AND non-complicit
 *   (4) apex passed a seeded-flaw calibration probe (full non-defendant custody)
 *   (5) non-LLM anchor PASSED and falsifiability-coupled (else pure-judgment => prohibited)
 *   (6) content-bearing pre-freeze countersign present
 *
 * Signals (2)-(6) are read from the per-cycle grade-record fields validated by
 * tools/planning/lib/loop-grade-record.js#assessCycleConvergenceReadiness. Where
 * a signal is not present it is FAIL-SAFE: absence => NOT dry, NEVER dry.
 *
 * This module is pure logic + a thin loader + a CLI. It does NOT arm anything and
 * has NO dispatch coupling.
 *
 * CLI:  node convergence.js --instance <id> [--M <n>] [--operator-downgrade] [--json]
 *   exit 0 = DRY (converged);  exit 3 = NOT dry;  exit 2 = usage/error.
 */

const fs = require('fs');
const path = require('path');

const objectionLedger = require('./objection-ledger.js');
const grade = require('../../planning/lib/loop-grade-record.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const STATE_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'loop-classification-ledger');

/**
 * Path to the per-instance cycles file (the ordered grade records, oldest -> newest).
 * File shape: { instance, cycles: [ <grade record>, ... ] }
 * @param {string} instance
 * @returns {string}
 */
function cyclesPath(instance) {
  if (!instance || typeof instance !== 'string') {
    throw new Error('convergence: instance id (non-empty string) is required');
  }
  if (/[\\/]/.test(instance)) {
    throw new Error(`convergence: instance id must not contain path separators: ${instance}`);
  }
  return path.join(STATE_DIR, `${instance}.cycles.json`);
}

/**
 * Load the ordered cycle grade records for an instance. Absent => [].
 * @param {string} instance
 * @returns {Array<object>}
 */
function loadCycles(instance) {
  const p = cyclesPath(instance);
  if (!fs.existsSync(p)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`convergence: corrupt cycles file ${p}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.cycles)) {
    throw new Error(`convergence: malformed cycles file ${p} (missing cycles[])`);
  }
  return parsed.cycles;
}

/**
 * Derive M for a cycle roster: consequence-tier (consequence/acceptance/kernel)
 * => 2; base-tier => 1. Ambiguity/absence => 2 (higher requirement, per law).
 * @param {Array<object>} cycles
 * @returns {number}
 */
function deriveM(cycles) {
  if (!Array.isArray(cycles) || cycles.length === 0) return 1;
  const last = cycles[cycles.length - 1];
  const gc = last && last.grade_class;
  if (grade.BASE_GRADE_CLASSES.has(gc)) return 1;
  return 2; // consequence tier AND anything unrecognized -> M=2.
}

/**
 * THE DRY PREDICATE. Pure; never throws on data content; FAIL-SAFE (absence of
 * any required signal yields dry:false, never dry:true).
 *
 * @param {string} instance
 * @param {{ M?: number, cycles?: Array<object>, operatorDowngrade?: boolean }} [opts]
 * @returns {{ dry: boolean, reasons: Array<string>, M: number, cyclesEvaluated: number, pureJudgment: boolean }}
 */
function isDry(instance, opts) {
  opts = opts || {};
  const reasons = [];
  let pureJudgment = false;

  // (1) Open-objection ledger EMPTY (all CLOSED). UNRESOLVED never clears.
  let ledgerClear = false;
  try {
    ledgerClear = objectionLedger.isLedgerClearForDry(instance);
  } catch (err) {
    reasons.push('ledger: unreadable objection ledger — fail-safe NOT dry (' + err.message + ')');
  }
  if (!ledgerClear && reasons.length === 0) {
    let blocking = [];
    try {
      blocking = objectionLedger.blockingObjections(instance).map((o) => o.id + ':' + o.status);
    } catch (_) { /* already reported */ }
    reasons.push('ledger: open-objection ledger NOT empty — blocking: [' + blocking.join(', ') + ']');
  } else if (!ledgerClear) {
    // ledger unreadable already recorded above.
  }

  // Cycles source: caller-provided or loaded from the cycles file.
  let cycles = opts.cycles;
  if (!Array.isArray(cycles)) {
    try {
      cycles = loadCycles(instance);
    } catch (err) {
      reasons.push('cycles: ' + err.message);
      cycles = [];
    }
  }

  const M = Number.isInteger(opts.M) && opts.M > 0 ? opts.M : deriveM(cycles);

  if (cycles.length < M) {
    reasons.push('cycles: fewer than M=' + M + ' cycles available (have ' + cycles.length + ') — NOT dry');
    return { dry: false, reasons, M, cyclesEvaluated: cycles.length, pureJudgment };
  }

  // (2)-(6): the last M consecutive cycles must EACH be convergence-ready.
  const window = cycles.slice(cycles.length - M);
  window.forEach((record, i) => {
    const cycleNo = cycles.length - M + i;
    const readiness = grade.assessCycleConvergenceReadiness(record, {
      operatorDowngrade: opts.operatorDowngrade === true,
    });
    if (readiness.pureJudgment) pureJudgment = true;
    if (!readiness.ready) {
      readiness.reasons.forEach((r) => reasons.push('cycle[' + cycleNo + ']: ' + r));
    }
  });

  return {
    dry: reasons.length === 0,
    reasons,
    M,
    cyclesEvaluated: M,
    pureJudgment,
  };
}

/**
 * CONVERGENCE CLOSURE GATE. Throws unless isDry passes; returns the assessment on
 * success. This is the sanctioned way to certify a loop CONVERGED — a grade
 * record cannot be treated as converged unless this passes.
 *
 * @param {string} instance
 * @param {object} [opts] see isDry
 * @returns {object} the isDry assessment (dry:true)
 * @throws {Error} code CONVERGENCE_NOT_DRY on any failing condition.
 */
function assertConverged(instance, opts) {
  const assessment = isDry(instance, opts);
  if (!assessment.dry) {
    const err = new Error(
      'loop is NOT dry — cannot certify CONVERGED: ' + assessment.reasons.join('; ')
    );
    err.code = 'CONVERGENCE_NOT_DRY';
    err.reasons = assessment.reasons;
    err.pureJudgment = assessment.pureJudgment;
    throw err;
  }
  return assessment;
}

// --------------------------------------------------------------------------- CLI
function _cli(argv) {
  const args = argv.slice(2);
  let instance = null;
  let M = null;
  let operatorDowngrade = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--instance') { instance = args[++i]; }
    else if (a === '--M') { M = parseInt(args[++i], 10); }
    else if (a === '--operator-downgrade') { operatorDowngrade = true; }
    else if (a === '--json') { /* default output is JSON */ }
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: node convergence.js --instance <id> [--M <n>] [--operator-downgrade]\n' +
          '  exit 0 = DRY (converged); exit 3 = NOT dry; exit 2 = usage error.\n'
      );
      return 0;
    }
  }
  if (!instance) {
    process.stderr.write('convergence: --instance <id> is required\n');
    return 2;
  }
  let assessment;
  try {
    assessment = isDry(instance, { M: M || undefined, operatorDowngrade });
  } catch (err) {
    process.stderr.write('convergence: ' + err.message + '\n');
    return 2;
  }
  process.stdout.write(JSON.stringify({ instance, ...assessment }, null, 2) + '\n');
  return assessment.dry ? 0 : 3;
}

if (require.main === module) {
  process.exit(_cli(process.argv));
}

module.exports = {
  isDry,
  assertConverged,
  loadCycles,
  cyclesPath,
  deriveM,
  STATE_DIR,
};
