#!/usr/bin/env node
'use strict';

// Write a TickTockReviewDecision/1.0 — the artifact G-TICKTOCK-REVIEW reads.
//
// WHY THIS IS A TOOL AND NOT A HAND-WRITTEN JSON. The clearing field
// (decision.cleared) may be true ONLY when every locked lane reports status
// "clean" with verdict APPROVE and zero unresolved findings, and the roster hash
// still matches the charter. Hand-authoring that document puts the burden of
// that conjunction on whoever is typing, at exactly the moment they most want it
// to be true. Here it is computed from the lane records and cannot be asserted:
// pass --cleared and the tool will still refuse if the roster does not support
// it. A cleared flag its own roster contradicts is a validation failure, not a
// pass.
//
// Discipline mirrors generation-manifest.cjs: construct -> validate before disk
// -> atomic write -> independent read-back from the filesystem.
//
// Usage:
//   node tools/ticktock/write-review-decision.cjs \
//     --charter <path> --lanes <lanes.json> --decided-by <who> \
//     --at <iso> [--operator-stamp <verbatim>] [--debrief <path>] [--out <path>] [--journal <path>] [--cycle <n>] [--dry-run]
//
// --operator-stamp carries the operator's verbatim authorization line into the
// decision.operator_stamp FIELD (the one TT-007 SCHEDULE activation reads).
// Prose in decided_by is provenance, not authorization: the gate reads the
// field. Omitted => null, which clears cycles but never activation.
//
// lanes.json: array of reviewer records. One entry per LOCKED lane in the
// charter roster, including lanes that were unavailable — a missing lane is a
// defect, never an implicit pass, and this tool refuses a roster/lane mismatch.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(__dirname, 'ticktock-review-decision-schema.json');
const DEFAULT_OUT = '_dev/state/ticktock/g-ticktock-review-decision.json';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function loadAjv() {
  // ajv is already a project dependency (the manifest writer uses it).
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')));
}

// The conjunction, in one place. A lane is clean only when ALL FOUR hold —
// status exactly "clean", pin_verified strictly true, verdict APPROVE, and zero
// unresolved findings. Timeout, substitution, pin mismatch, unavailability and
// error are each independently not-clean regardless of the verdict field: a
// zero-findings verdict from a lane that never properly ran is a validation
// failure, not a pass.
function laneIsClean(l) {
  return l.status === 'clean'
    && l.pin_verified === true
    && l.verdict === 'APPROVE'
    && l.unresolved_findings === 0;
}

function laneNotCleanReason(l) {
  const why = [];
  if (l.status !== 'clean') why.push(`status "${l.status}"`);
  if (l.pin_verified !== true) why.push(`pin_verified ${JSON.stringify(l.pin_verified)} (never inferred from the absence of an error)`);
  if (l.verdict !== 'APPROVE') why.push(`verdict ${l.verdict}`);
  if (l.unresolved_findings !== 0) why.push(`${l.unresolved_findings} unresolved finding(s)`);
  return `lane ${l.lane_id} (${l.family}) is NOT clean: ${why.join('; ')}`;
}

function main() {
  const charterPath = arg('--charter');
  const lanesPath = arg('--lanes');
  const decidedBy = arg('--decided-by');
  const decidedAt = arg('--at');
  if (!charterPath || !lanesPath || !decidedBy || !decidedAt) {
    console.error('usage: --charter <path> --lanes <lanes.json> --decided-by <who> --at <iso> [--operator-stamp <verbatim>] [--debrief <path>] [--out <path>] [--journal <path>] [--cycle <n>] [--dry-run]');
    return 2;
  }

  const charter = JSON.parse(fs.readFileSync(path.resolve(charterPath), 'utf8'));
  const lanes = JSON.parse(fs.readFileSync(path.resolve(lanesPath), 'utf8'));
  if (!Array.isArray(lanes) || !lanes.length) {
    console.error('REFUSED: lanes must be a non-empty array');
    return 1;
  }

  // Roster coverage: every locked lane must appear. Refusing here is the whole
  // point — an omitted lane is how a partial trial passes for a full one.
  const locked = charter.reviewer_roster.lanes.map((l) => l.lane_id).sort();
  const reported = lanes.map((l) => l.lane_id).sort();
  // Duplicate lanes (2026-08-12, S4 re-run codex finding 5): includes() is
  // set-like, so two entries for one locked lane passed both the missing and
  // extra checks — a second, cleaner-looking copy of a lane could ride along.
  // One locked lane, exactly one reported entry.
  const dupes = [...new Set(reported.filter((id, i) => reported.indexOf(id) !== i))];
  if (dupes.length) {
    console.error(`REFUSED: duplicate lane entrie(s) for: ${dupes.join(', ')}. Each locked lane must appear exactly once; a duplicate is how a substituted result shadows a real one.`);
    return 1;
  }
  const missing = locked.filter((id) => !reported.includes(id));
  const extra = reported.filter((id) => !locked.includes(id));
  if (missing.length || extra.length) {
    console.error(`REFUSED: roster/lane mismatch. Missing: ${missing.join(', ') || 'none'}. Not in roster: ${extra.join(', ') || 'none'}. A missing lane is a defect, never an implicit pass.`);
    return 1;
  }

  const notClean = lanes.filter((l) => !laneIsClean(l));
  const unresolvedTotal = lanes.reduce((n, l) => n + (l.unresolved_findings || 0), 0);
  const cleared = notClean.length === 0 && unresolvedTotal === 0;

  const reasons = notClean.map(laneNotCleanReason);
  if (unresolvedTotal > 0 && !reasons.some((r) => r.includes('unresolved'))) {
    reasons.push(`${unresolvedTotal} unresolved finding(s) across the roster`);
  }

  // An operator asking for cleared:true does not make it true.
  if (process.argv.includes('--cleared') && !cleared) {
    console.error('REFUSED: --cleared was passed but the roster does not support it:');
    for (const r of reasons) console.error(`  - ${r}`);
    console.error('A cleared flag its own roster contradicts is a validation failure, not a pass.');
    return 1;
  }

  const stamp = new Date(decidedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const decision = {
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: `tt-review-${stamp}`,
    produced_by_step: arg('--step', 'S4'),
    created_at: decidedAt,
    charter_id: charter.charter_id,
    charter_hash: charter.charter_hash,
    roster_hash: charter.reviewer_roster.lane_binding_hash,
    reviewers: lanes,
    decision: {
      cleared,
      unresolved_findings_total: unresolvedTotal,
      reasons,
      decided_at: decidedAt,
      decided_by: decidedBy,
      // Verbatim, or null. Never defaulted, never synthesized: an absent stamp
      // is a true statement ("the operator did not stamp this run"), and the
      // activation gate treats it as exactly that.
      operator_stamp: arg('--operator-stamp', null)
    }
  };
  const debrief = arg('--debrief');
  if (debrief) decision.debrief_artifact_path = debrief;

  const validate = loadAjv();
  if (!validate(decision)) {
    console.error('REFUSED: schema-invalid before write:', JSON.stringify(validate.errors, null, 2));
    return 1;
  }

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ cleared, unresolved_findings_total: unresolvedTotal, reasons, dry_run: true }, null, 2));
    return 0;
  }

  const outRel = arg('--out', DEFAULT_OUT);
  const outAbs = path.isAbsolute(outRel) ? outRel : path.join(REPO_ROOT, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const body = JSON.stringify(decision, null, 2) + '\n';
  fs.writeFileSync(outAbs + '.tmp', body);
  fs.renameSync(outAbs + '.tmp', outAbs);

  // Independent read-back THROUGH the filesystem. Verifying the in-memory object
  // would prove self-consistency, not delivery.
  const reread = JSON.parse(fs.readFileSync(outAbs, 'utf8'));
  if (!validate(reread)) {
    console.error('REFUSED (post-write): re-read document is schema-invalid');
    return 1;
  }
  if (reread.decision.cleared !== cleared) {
    console.error('REFUSED (post-write): re-read cleared does not match intended value');
    return 1;
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(outAbs)).digest('hex');

  // MERGE-NOT-CLEAN EMITTER. S4-B finding G2 (gemini, MAJOR): MERGE-NOT-CLEAN is
  // a declared halt state that no production code ever wrote. The verdict was
  // computed correctly right here and simply never reached the journal, so a
  // not-clean merge left no durable halt record — the same false-safety-claim
  // shape as GATE-BLOCKED and the two effect states.
  //
  // Journalling is OPTIONAL (only when --journal is passed) because this tool is
  // also run before any journal exists, and a decision writer that required one
  // could not be used to record the very first trial. When it IS passed, a
  // not-clean decision leaves a halt record.
  let journalled = null;
  const journalPath = arg('--journal');
  if (journalPath && !cleared) {
    try {
      const journal = require('./journal.cjs');
      const charterMod = require('./charter.cjs');
      const cycleIndex = Number(arg('--cycle', '0'));
      // tt.ship is EFFECTFUL, so the journal REQUIRES an idempotency key — its
      // own invariant, and it refused a first attempt that omitted one: "an
      // effect recorded without one cannot be checked for a double-fire on
      // resume." Correct refusal. A merge refusal is genuinely tied to the ship
      // phase, so it is keyed on the ship key with the decision id as the
      // discriminator: re-deciding the SAME decision does not create a second
      // distinct halt, while a new decision does.
      const key = charterMod.idempotencyKey('tt.ship', charter.charter_hash, cycleIndex, `merge-not-clean:${decision.decision_id}`);
      const rec = journal.appendRecord(path.isAbsolute(journalPath) ? journalPath : path.join(REPO_ROOT, journalPath), {
        charter_hash: charter.charter_hash,
        cycle_index: cycleIndex,
        phase_id: 'tt.ship',
        idempotency_key: key,
        halt_state: 'MERGE-NOT-CLEAN',
        halt_detail: [
          `Merge refused for decision ${decision.decision_id}: ${unresolvedTotal} unresolved finding(s) across ${locked.length} locked lane(s), ${lanes.filter(laneIsClean).length} clean.`,
          ...reasons
        ].join('\n\n')
      });
      journalled = { record_index: rec.record_index, halt_state: rec.halt_state };
    } catch (err) {
      // Failing to RECORD a refusal must never look like a pass.
      console.error(`JOURNALLING FAILED (${err.message}). The decision STANDS as cleared=${cleared}; only the halt record is missing.`);
      journalled = { error: err.message };
    }
  }

  console.log(JSON.stringify({
    schema: 'TickTockReviewDecisionWriteReceipt/1.0',
    path: outRel,
    decision_id: decision.decision_id,
    cleared,
    unresolved_findings_total: unresolvedTotal,
    reasons,
    lanes_locked: locked.length,
    lanes_clean: lanes.filter(laneIsClean).length,
    validated_pre_write: true,
    written_atomically: true,
    read_back_verified: true,
    file_sha256: sha,
    merge_not_clean_journalled: journalled
  }, null, 2));
  return 0;
}

process.exit(main());
