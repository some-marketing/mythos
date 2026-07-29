'use strict';

/**
 * matrix.cjs — S2 of adaptive-mind-router: the minds × task-types learning
 * matrix. READ-ONLY aggregation over the tier-track-record ledger
 * (append-ledger-entry.cjs remains the sole write path) plus benchmark
 * priors (_dev/state/mind-matrix/benchmark-priors.json, S0).
 *
 * Bindings:
 * - R1 shadow mode: this surface recommends; it never decides.
 * - R2 cells: lived + prior evidence with sample_origin ALWAYS split; prior
 *   weight capped (25% after 10 lived, 10% after 30) with half-life decay.
 * - R3/G3: eligible_for_routing requires >=5 lived samples AND >=1
 *   distinct-intelligence verdict (different-substrate reviewer in
 *   distinct_review). Telemetry/same-substrate samples alone never promote.
 * - G4: blended score never rendered without the lived/prior split.
 * - G5: below-threshold cells return explicit abstention.
 * - G6: regression/failure events are preserved in cell history; scores are
 *   recomputed, observations never erased.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const LEDGER_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis', 'tier-track-record');
const PRIORS_PATH = path.join(PROJECT_ROOT, '_dev', 'state', 'mind-matrix', 'benchmark-priors.json');

const { classifyWork } = require('../../signals/lib/tier-routing.cjs');

const HALF_LIFE_DAYS = 45; // lived evidence half-life per task type (R2)
const MIN_LIVED_FOR_SHIFT = 5; // R3
const PRIOR_CAP_AT_10 = 0.25;
const PRIOR_CAP_AT_30 = 0.10;

function safeJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function decayWeight(isoDate, nowMs) {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (nowMs - t) / 86400000);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function distinctVerdict(entry, mindId) {
  const dr = entry.distinct_review;
  if (!dr || !dr.reviewer_actor) return false;
  // Different substrate, not just a different session (memory rule:
  // parallel same-substrate actors do not satisfy cross-verification).
  const producerFamily = String(mindId).split(/[-:/\s]/)[0].toLowerCase();
  const reviewerFamily = String(dr.reviewer_actor).split(/[-:/\s]/)[0].toLowerCase();
  return reviewerFamily !== producerFamily;
}

/** cell key: mind::altitude::shape */
function buildMatrix(opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  const cells = new Map();

  const touch = (key) => {
    if (!cells.has(key)) {
      cells.set(key, {
        lived: { samples: 0, weighted: 0, weighted_clean: 0, distinct_verdicts: 0 },
        history: [], // G6: observations preserved, incl. failures/regressions
        prior: null
      });
    }
    return cells.get(key);
  };

  // Lived evidence from the ledger.
  let files = [];
  try { files = fs.readdirSync(LEDGER_DIR).filter((f) => f.endsWith('.json')); } catch { /* no ledger yet */ }
  for (const f of files) {
    const doc = safeJson(path.join(LEDGER_DIR, f));
    if (!doc || !Array.isArray(doc.entries)) continue;
    const mind = doc.model_key || doc.model_id || f.replace(/\.json$/, '');
    for (const e of doc.entries) {
      if (!e || e.grade === 'ungraded') continue; // only verdict-bearing entries count (R7)
      const cls = classifyWork({
        task: `${e.task_id || ''} ${e.note || ''}`,
        paths: Array.isArray(e.changed_files) ? e.changed_files : []
      });
      // G5: unknown classes are exploration — excluded from cell statistics.
      if (cls.altitude === 'unknown') continue;
      const key = `${mind}::${cls.altitude}::${cls.verification_shape}`;
      const cell = touch(key);
      const w = decayWeight(e.review_at || e.derived_at, nowMs);
      cell.lived.samples += 1;
      cell.lived.weighted += w;
      if (e.grade === 'clean') cell.lived.weighted_clean += w;
      if (distinctVerdict(e, mind)) cell.lived.distinct_verdicts += 1;
      cell.history.push({
        entry_id: e.entry_id, grade: e.grade, at: e.review_at || e.derived_at,
        scope_class: e.scope_class, binding_basis: e.binding_basis
      });
    }
  }

  // Benchmark priors (S0) — origin-labelled, capped.
  const priors = safeJson(PRIORS_PATH);
  if (priors && priors.priors) {
    for (const [key, p] of Object.entries(priors.priors)) {
      const cell = touch(key);
      cell.prior = {
        equivalent_sample_weight: p.equivalent_sample_weight,
        prior_mean_success: p.prior_mean_success,
        band: p.band,
        transfer_strength: p.transfer_strength,
        sample_origin: 'benchmark-prior',
        as_of: priors.as_of
      };
    }
  }

  return { cells, built_at: new Date(nowMs).toISOString() };
}

function priorWeightCap(livedSamples) {
  if (livedSamples >= 30) return PRIOR_CAP_AT_30;
  if (livedSamples >= 10) return PRIOR_CAP_AT_10;
  return 1.0; // pre-evidence, priors may dominate (they are tiny by construction)
}

/**
 * lookup(matrix, mindId, altitude, shape) → cell view or explicit abstention.
 * G4: lived and prior components ALWAYS rendered separately alongside any blend.
 */
function lookup(matrix, mindId, altitude, shape) {
  const key = `${mindId}::${altitude}::${shape}`;
  const cell = matrix.cells.get(key);
  if (!cell || (cell.lived.samples === 0 && !cell.prior)) {
    return { key, abstain: 'no recommendation — exploring (no evidence, no defensible prior)' };
  }

  const lived = cell.lived;
  const livedRate = lived.weighted > 0 ? lived.weighted_clean / lived.weighted : null;
  const cap = priorWeightCap(lived.samples);
  const priorWeight = cell.prior
    ? Math.min(cell.prior.equivalent_sample_weight, cap * Math.max(1, lived.weighted + cell.prior.equivalent_sample_weight))
    : 0;
  const blendDen = lived.weighted + priorWeight;
  const blended = blendDen > 0
    ? ((livedRate || 0) * lived.weighted + (cell.prior ? cell.prior.prior_mean_success : 0) * priorWeight) / blendDen
    : null;

  const eligible = lived.samples >= MIN_LIVED_FOR_SHIFT && lived.distinct_verdicts >= 1; // R3 + G3
  const view = {
    key,
    lived: {
      samples: lived.samples,
      decayed_weight: Math.round(lived.weighted * 1000) / 1000,
      success_rate: livedRate === null ? null : Math.round(livedRate * 1000) / 1000,
      distinct_verdicts: lived.distinct_verdicts
    },
    prior: cell.prior, // G4: split always visible
    blended_success: blended === null ? null : Math.round(blended * 1000) / 1000,
    eligible_for_routing: eligible,
    history_length: cell.history.length
  };
  if (lived.samples < MIN_LIVED_FOR_SHIFT) {
    // G5: abstention is first-class — the numbers are shown as observations,
    // the recommendation field says exploring.
    view.abstain = `no recommendation — exploring (${lived.samples}/${MIN_LIVED_FOR_SHIFT} lived samples)`;
  } else if (!eligible) {
    view.abstain = 'no recommendation — needs >=1 distinct-intelligence verdict (G3)';
  }
  return view;
}

function main() {
  const args = process.argv.slice(2);
  const matrix = buildMatrix();
  const li = args.indexOf('--lookup');
  if (li !== -1 && args[li + 1]) {
    const [mind, alt, shape] = args[li + 1].split('::');
    process.stdout.write(JSON.stringify(lookup(matrix, mind, alt, shape), null, 2) + '\n');
    return;
  }
  const summary = {
    schema: 'MindMatrix/1.0',
    built_at: matrix.built_at,
    cell_count: matrix.cells.size,
    lived_cells: [...matrix.cells.values()].filter((c) => c.lived.samples > 0).length,
    prior_only_cells: [...matrix.cells.values()].filter((c) => c.lived.samples === 0 && c.prior).length
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { buildMatrix, lookup, distinctVerdict };
