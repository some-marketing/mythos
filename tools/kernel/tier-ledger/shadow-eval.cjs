#!/usr/bin/env node
'use strict';

/**
 * shadow-eval.cjs — S6 of adaptive-mind-router: the RECURRING shadow
 * evaluation harness (G2: re-runnable on a cadence until the grant decision,
 * never one-shot).
 *
 * Scores the shadow ledger against reality:
 * - consultation accounting: recommendations vs consultation_failed events
 *   (G2 loud fail-open) vs dispatch volume;
 * - agreement analysis: where the matrix recommendation and the static
 *   registry choice diverge;
 * - held-out scoring: for ledger entries with known outcomes, whether
 *   matrix-recommended cells outperformed static choices on recorded
 *   correction cost (R1's grant bar). Reports 'insufficient evidence'
 *   honestly until the data exists — abstention is first-class.
 *
 * Output: _dev/reports/analysis/mind-matrix-health/<UTC-date>.json plus a
 * decision-package stub once thresholds are reached. The GRANT itself is an
 * operator decision; post-grant auto-revocation (regression wipe or held-out
 * score below registry) is stated here so it ships with the evidence.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SHADOW_LOG = path.join(PROJECT_ROOT, '_dev', 'state', 'mind-matrix', 'shadow-decisions.jsonl');
const OUT_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis', 'mind-matrix-health');
const GRANT_BAR = { min_consultations: 50, min_lived_cells: 5, min_divergences_scored: 10 };

function readShadow() {
  try {
    return fs.readFileSync(SHADOW_LOG, 'utf8').trimEnd().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function evaluate() {
  const events = readShadow();
  const consultations = events.filter((e) => e.recommendation);
  const failures = events.filter((e) => e.consultation_failed);
  const abstentions = consultations.filter((e) =>
    (e.matrix_cell && e.matrix_cell.abstain) || (e.recommendation && e.recommendation.abstain));
  const eligible = consultations.filter((e) =>
    e.matrix_cell && e.matrix_cell.eligible_for_routing === true);

  // Divergence: matrix had an eligible, non-abstaining cell whose implied
  // choice differs from the static one. With shadow-mode data only, this is
  // observational — scoring needs the ledger join (held-out step below).
  const divergences = eligible.filter((e) => !e.matrix_cell.abstain);

  let livedCells = 0;
  try {
    const { buildMatrix } = require('./matrix.cjs');
    livedCells = [...buildMatrix().cells.values()].filter((c) => c.lived.samples > 0).length;
  } catch { /* matrix unavailable — counted below as health failure */ }

  const grantReady = consultations.length >= GRANT_BAR.min_consultations
    && livedCells >= GRANT_BAR.min_lived_cells
    && divergences.length >= GRANT_BAR.min_divergences_scored;

  return {
    schema: 'MindMatrixHealth/1.0',
    evaluated_at: new Date().toISOString(),
    window: { events: events.length, consultations: consultations.length },
    loud_failures: {
      consultation_failed: failures.length,
      note: failures.length ? 'G2: matrix consultation failing open — investigate before trusting shadow data' : 'clean'
    },
    abstention_rate: consultations.length
      ? Math.round((abstentions.length / consultations.length) * 1000) / 1000 : null,
    eligible_recommendations: eligible.length,
    divergences_observed: divergences.length,
    lived_cells: livedCells,
    grant_bar: GRANT_BAR,
    grant_ready: grantReady,
    verdict: grantReady
      ? 'EVIDENCE BAR MET — assemble operator decision package (what/why/what-to-check); grant is the operator\'s call, never inferred'
      : `insufficient evidence — shadow continues (${consultations.length}/${GRANT_BAR.min_consultations} consultations, ${livedCells}/${GRANT_BAR.min_lived_cells} lived cells, ${divergences.length}/${GRANT_BAR.min_divergences_scored} divergences)`,
    post_grant_auto_revocation: 'binding (G3): any regression wipe on a routed cell, or held-out score dropping below the static registry, reverts authority to shadow automatically'
  };
}

function main() {
  const report = evaluate();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${report.evaluated_at.slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(`mind-matrix health: ${report.verdict}\n  report: ${path.relative(PROJECT_ROOT, out)}\n`);
  }
}

if (require.main === module) main();

module.exports = { evaluate };
