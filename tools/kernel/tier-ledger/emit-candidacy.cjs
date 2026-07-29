#!/usr/bin/env node
'use strict';
// emit-candidacy.cjs — promotion/demotion candidacy emitter for the tier
// track-record ledger.
//
// ENFORCEMENT_FAMILY: quality-process
//   (graduation bookkeeping — never a safety gate; never reads session tier.)
//
// tier-enforcement-implementation slice 3, step
// tier-s3b-promotion-demotion-emitters (convene 20260611T130035Z conditions
// 7 + 10; concept section 5 "freedom is witnessed, never self-assessed").
//
// CONTRACT — PROPOSALS ONLY, NEVER AUTO-APPLIED:
//   * Reads per-model TierTrackRecord/1.0 ledgers under
//     _dev/reports/analysis/tier-track-record/ and evaluates the FROZEN
//     graduation procedure (tier-track-record.schema.json):
//       promotion — promotion_n CONSECUTIVE clean distinct-review outcomes
//                   within one model+scope_class;
//       demotion  — demotion_m FAILED outcomes within window_days inside one
//                   model+scope_class (classifier owned by the distinct
//                   reviewer: only reviewer-recorded verdicts grade entries).
//   * Threshold VALUES are provisional (operator-ratified after calibration);
//     every candidacy artifact carries thresholds.provisional verbatim.
//   * Emits Decision-shaped, operator-gated candidacy artifacts under
//     _dev/reports/analysis/tier-track-record/candidacies/ (inside the
//     mutation-plan-gate governed perimeter). This tool NEVER edits
//     process-tier-rule.yaml or any canonical surface — ratification is the
//     operator editing the rule with provenance (up-lineage witness).
//   * Deduped by evidence set: re-runs never duplicate a candidacy.
//   * Optional --dart flag additionally creates a Dart "Decision Needed"
//     task for the operator (bubble-up-questions convention); failures to
//     reach Dart are recorded in the artifact, never fatal.
//
// CLI:
//   node tools/kernel/tier-ledger/emit-candidacy.cjs [--root <repo-root>] [--dry-run] [--dart]

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  LEDGER_DIR_REL,
  ROOT,
  loadSchema,
  safeKey
} = require('./append-ledger-entry.cjs');

const CANDIDACY_DIR_REL = `${LEDGER_DIR_REL}/candidacies`;
const DAY_MS = 24 * 60 * 60 * 1000;

function entryTime(entry) {
  const at = (entry && entry.distinct_review && entry.distinct_review.at) ||
    (entry && entry.derived_at) || null;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function readLedgers(root = ROOT) {
  const dir = path.join(root, LEDGER_DIR_REL);
  const ledgers = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return ledgers;
  }
  for (const name of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (parsed && parsed.schema === 'TierTrackRecord/1.0' && Array.isArray(parsed.entries)) {
        ledgers.push(parsed);
      }
    } catch {
      // unreadable ledger — skipped, never fatal
    }
  }
  return ledgers;
}

function groupByScopeClass(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const scope = entry.scope_class || 'system-other';
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push(entry);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (entryTime(a) || 0) - (entryTime(b) || 0));
  }
  return groups;
}

// Evaluate one ledger against the frozen procedure. Returns candidacy
// descriptors (not yet written). opts.now / opts.thresholds are test seams;
// the CLI always uses the frozen schema thresholds.
function evaluateLedger(ledger, schema, opts = {}) {
  const thresholds = opts.thresholds || schema.graduation.thresholds;
  const now = opts.now || Date.now();
  const candidacies = [];
  for (const [scopeClass, entries] of groupByScopeClass(ledger.entries)) {
    const graded = entries.filter((e) => e.grade === 'clean' || e.grade === 'failed');

    // Promotion: trailing CONSECUTIVE clean run >= promotion_n.
    let trailingClean = 0;
    for (let i = graded.length - 1; i >= 0; i -= 1) {
      if (graded[i].grade !== 'clean') break;
      trailingClean += 1;
    }
    if (trailingClean >= thresholds.promotion_n) {
      const evidence = graded.slice(-trailingClean);
      candidacies.push({
        type: 'promotion',
        model_key: ledger.model_key,
        model_id: ledger.model_id,
        scope_class: scopeClass,
        evidence_entries: evidence,
        observed: `${trailingClean} consecutive clean distinct-review outcomes (threshold promotion_n=${thresholds.promotion_n}, provisional)`
      });
    }

    // Demotion: >= demotion_m failed within window_days.
    const windowStart = now - thresholds.window_days * DAY_MS;
    const failedInWindow = graded.filter((e) => {
      if (e.grade !== 'failed') return false;
      const t = entryTime(e);
      return t !== null && t >= windowStart;
    });
    if (failedInWindow.length >= thresholds.demotion_m) {
      candidacies.push({
        type: 'demotion',
        model_key: ledger.model_key,
        model_id: ledger.model_id,
        scope_class: scopeClass,
        evidence_entries: failedInWindow,
        observed: `${failedInWindow.length} failed distinct-review outcomes within ${thresholds.window_days} days (threshold demotion_m=${thresholds.demotion_m}, provisional)`
      });
    }
  }
  return candidacies;
}

function candidacyDedupeKey(candidacy) {
  const ids = candidacy.evidence_entries.map((e) => e.entry_id).join('|');
  return crypto
    .createHash('sha1')
    .update([candidacy.type, candidacy.model_key, candidacy.scope_class, ids].join('::'))
    .digest('hex')
    .slice(0, 12);
}

function buildArtifact(candidacy, schema, dedupeKey) {
  const thresholds = schema.graduation.thresholds;
  const direction = candidacy.type === 'promotion'
    ? `relax specific adds for ${candidacy.model_id} on ${candidacy.scope_class} work`
    : `tighten adds / lower tier for ${candidacy.model_id} on ${candidacy.scope_class} work`;
  return {
    schema: 'TierGraduationCandidacy/1.0',
    type: candidacy.type,
    dedupe_key: dedupeKey,
    model_key: candidacy.model_key,
    model_id: candidacy.model_id,
    scope_class: candidacy.scope_class,
    observed: candidacy.observed,
    thresholds: { ...thresholds },
    evidence_entries: candidacy.evidence_entries.map((e) => ({
      entry_id: e.entry_id,
      task_id: e.task_id,
      plan_artifact: e.plan_artifact,
      grade: e.grade,
      graded_by: e.graded_by,
      review_artifact: e.distinct_review && e.distinct_review.artifact,
      reviewed_at: e.distinct_review && e.distinct_review.at
    })),
    proposal: `OPERATOR DECISION REQUIRED — ${candidacy.type} candidacy: ${direction}. This is a PROPOSAL derived from the witnessed track record; it changes nothing by itself.`,
    decision_required_by: 'operator',
    ratification_path: 'Operator edits instructions/canonical/process-tier-rule.yaml with provenance (operator_ratified + convene receipt). The up-lineage witness (tier above + operator) ratifies; the ledger machinery never mutates the rule.',
    auto_apply: false,
    emitted_at: new Date().toISOString(),
    emitted_by: 'tools/kernel/tier-ledger/emit-candidacy.cjs',
    dart_task: null
  };
}

// Optional Dart "Decision Needed" task (bubble-up-questions convention).
// Best-effort: any failure is recorded on the artifact, never thrown.
async function createDartDecisionTask(artifact) {
  try {
    // eslint-disable-next-line global-require
    const dart = require('../../dart-integration/lib/dart-api.js');
    const created = await dart.createTask({
      title: `Decision Needed: tier ${artifact.type} candidacy — ${artifact.model_id} / ${artifact.scope_class}`,
      description: [
        artifact.proposal,
        '',
        `Evidence: ${artifact.evidence_entries.length} graded entries (${artifact.observed}).`,
        `Candidacy artifact: ${artifact.artifact_path || 'see tier-track-record/candidacies/'}`,
        `Ratification: ${artifact.ratification_path}`,
        `Thresholds are PROVISIONAL (calibration pending): N=${artifact.thresholds.promotion_n}, M=${artifact.thresholds.demotion_m}, window=${artifact.thresholds.window_days}d.`
      ].join('\n'),
      assignee: '{OPERATOR_NAME}',
      tags: ['decision-needed', 'tier-graduation']
    });
    const task = created && (created.item || created);
    return { ok: true, id: (task && task.id) || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function run(opts = {}) {
  const root = opts.root || ROOT;
  const schema = opts.schema || loadSchema();
  if (opts.thresholds) {
    // Test seam only: candidacy artifacts must still carry provisional truthfully.
    schema.graduation.thresholds = { ...schema.graduation.thresholds, ...opts.thresholds };
  }
  const outDir = path.join(root, CANDIDACY_DIR_REL);
  const results = { emitted: [], skipped: [], evaluated: 0 };

  for (const ledger of readLedgers(root)) {
    results.evaluated += 1;
    for (const candidacy of evaluateLedger(ledger, schema, { now: opts.now, thresholds: schema.graduation.thresholds })) {
      const dedupeKey = candidacyDedupeKey(candidacy);
      const fileName = `${candidacy.type}__${safeKey(candidacy.model_key)}__${safeKey(candidacy.scope_class)}__${dedupeKey}.json`;
      const outRel = `${CANDIDACY_DIR_REL}/${fileName}`;
      const outAbs = path.join(outDir, fileName);
      if (fs.existsSync(outAbs)) {
        results.skipped.push({ artifact: outRel, reason: 'duplicate-candidacy' });
        continue;
      }
      const artifact = buildArtifact(candidacy, schema, dedupeKey);
      artifact.artifact_path = outRel;
      if (opts.dart) {
        artifact.dart_task = await createDartDecisionTask(artifact);
      }
      if (!opts.dryRun) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outAbs, JSON.stringify(artifact, null, 2) + '\n');
      }
      results.emitted.push({ artifact: outRel, type: candidacy.type, model_key: candidacy.model_key, scope_class: candidacy.scope_class, dry_run: !!opts.dryRun });
    }
  }
  return results;
}

module.exports = {
  CANDIDACY_DIR_REL,
  buildArtifact,
  candidacyDedupeKey,
  entryTime,
  evaluateLedger,
  groupByScopeClass,
  readLedgers,
  run
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  run({
    root: flag('--root') || ROOT,
    dryRun: args.includes('--dry-run'),
    dart: args.includes('--dart')
  })
    .then((results) => {
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(`emit-candidacy: ${err.message}`);
      process.exit(1);
    });
}
