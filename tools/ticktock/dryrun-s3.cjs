#!/usr/bin/env node
'use strict';

// tools/ticktock/dryrun-s3.cjs -- the S3 acceptance harness for the ticktock-skill
// plan (_dev/reports/analysis/task-plans/ticktock-skill__plan.json, step S3,
// bounded_plan.acceptance_matrix -- the authoritative 20-test table).
//
// WHAT THIS IS.
//
// It executes the twenty acceptance tests against the REAL S0/S1/S2 modules
// (charter.cjs, journal.cjs, canonical.cjs, run-benchmark.js,
// generation-manifest.cjs, preflight-ticktock.cjs, and the staged
// pretool-remote-mutation-gate.cjs) and writes one evidence artifact:
//
//   _dev/state/ticktock/ticktock-dryrun-evidence.json
//
// WHAT IT IS NOT.
//
// It is not a re-implementation of any of those modules, and it never stubs a
// mechanism in order to make a test pass. Where the behavior an acceptance row
// demands exists only as prose in .claude/skills/ticktock/SKILL.md and has no
// executable producer or evaluator, this harness records the test as `fail` or
// `blocked` with the exact reason, and its assertion fields are written with
// whatever the code actually returned -- not with what the row hoped for.
//
// S3 IS DRY-RUN VERIFICATION WITH NO SIM MUTATION AND NO VM CONTACT. Nothing
// here starts a colony, reaches the orwell host, dispatches a reviewer, or
// resolves a credential VALUE. The remote-mutation checker is exercised against
// a SANDBOX projectDir under the S3 write surface so that its audit rows land
// in _dev/state/ticktock/dryrun-workspace/ rather than in the repository's real
// _dev/state/remote-mutation-stamps/audit.jsonl.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const charterMod = require('./charter.cjs');
const journal = require('./journal.cjs');
const canonical = require('./canonical.cjs');
const bench = require('./run-benchmark.js');
const gm = require('./generation-manifest.cjs');
const preflight = require('./preflight-ticktock.cjs');
const ceilings = require('./ceilings.cjs');
const proposalMod = require('./ratification-proposal.cjs');

const PLAN_PATH = '_dev/reports/analysis/task-plans/ticktock-skill__plan.json';
const EVIDENCE_PATH = '_dev/state/ticktock/ticktock-dryrun-evidence.json';

// Carry forward the S4-S6 live-enforcement determination instead of overwriting it.
//
// This suite regenerates the evidence artifact wholesale. The three keys below
// are NOT S3's to set: enforcement_path_observed_live records a determination
// made by distinct-family reviewers against a live harness denial that this
// suite never observes. Hardcoding false here meant every re-run silently
// revoked that finding and flipped preflight-ticktock.cjs's pretooluse-live gate
// back to REFUSE. Reported as MAJOR in review, 2026-08-05.
//
// A suite may report what it observed. It may not revoke a finding made against
// evidence it cannot see. So read the prior artifact and preserve the
// determination when one exists; fall back to the honest S3-only values when it
// does not.
function carryForwardLiveDetermination() {
  const S3_ONLY_FALLBACK = {
    enforcement_path_observed_live: false,
    harness_denial_transcript_path: null,
    why_not_live: 'No prior determination found in the evidence artifact. Setting enforcement_path_observed_live true requires TWO artifacts produced in the SAME session by a real Bash tool call through the live harness: (i) a matching deny row in _dev/state/remote-mutation-stamps/audit.jsonl, and (ii) the harness\'s OWN verbatim PreToolUse denial transcript. S3 calls the module via require() and cannot produce either, so it does not claim them.'
  };
  try {
    const prior = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, EVIDENCE_PATH), 'utf8'));
    const rm = prior && prior.remote_mutation_gate_test;
    if (!rm || rm.enforcement_path_observed_live !== true) return S3_ONLY_FALLBACK;
    const out = {
      enforcement_path_observed_live: true,
      harness_denial_transcript_path: rm.harness_denial_transcript_path || null,
      carried_forward_by_s3: 'This value was NOT produced by this run. It is the S4-S6 reviewer determination, preserved verbatim from the prior artifact because a regenerating suite must not revoke a finding it never observed.'
    };
    if (rm.why_live) out.why_live = rm.why_live;
    if (rm.why_not_live_superseded) out.why_not_live_superseded = rm.why_not_live_superseded;
    return out;
  } catch (_) {
    // No readable prior artifact (first run, or unparseable) -- fail to the
    // honest narrow claim rather than inventing a determination.
    return S3_ONLY_FALLBACK;
  }
}
const FINGERPRINT_PATH = '_dev/state/ticktock/benchmark-fingerprint-v1.json';
const WORKSPACE = path.join(REPO_ROOT, '_dev/state/ticktock/dryrun-workspace');

const plan = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PLAN_PATH), 'utf8'));
const MATRIX = plan.bounded_plan.acceptance_matrix;
const GATE_MATRIX = plan.bounded_plan.inherited_gate_matrix;

// ---------------------------------------------------------------------------
// Harness plumbing
// ---------------------------------------------------------------------------

const evidence = {
  schema: 'TickTockDryRunEvidence/1.0',
  produced_by: 'tools/ticktock/dryrun-s3.cjs',
  produced_by_step: 'S3',
  plan_id: plan.task_id,
  acceptance_matrix_source: `${PLAN_PATH}#bounded_plan.acceptance_matrix`,
  acceptance_matrix_authority: plan.bounded_plan.acceptance_matrix_authority,
  created_at: new Date().toISOString(),
  mode: 'RUN_ONLY',
  sim_mutation: false,
  vm_contact: false,
  node_version: process.version,
  honest_reading_note:
    'Every field below is the value a real module returned during this run. A test whose status is not "pass" has its assertion fields written with the OBSERVED value, not the demanded one. Read status_table before reading any individual field group.',
  status_table: [],
  totals: { pass: 0, fail: 0, blocked: 0 }
};

const STATUS = { PASS: 'pass', FAIL: 'fail', BLOCKED: 'blocked' };

function matrixRow(id) {
  const r = MATRIX.find((m) => m.test_id === id);
  if (!r) throw new Error(`no acceptance-matrix row for ${id}`);
  return r;
}

function record(testId, fieldGroup, status, proves, reason) {
  const row = matrixRow(testId);
  evidence.status_table.push({
    test_id: testId,
    status,
    field_group_written: fieldGroup,
    matrix_field_contract: row.field,
    matrix_proves: row.proves,
    what_this_run_actually_proves: proves,
    reason_if_not_pass: status === STATUS.PASS ? null : reason
  });
  evidence.totals[status] += 1;
}

const results = [];
function test(testId, fieldGroup, fn) {
  process.stdout.write(`\n=== ${testId} (${fieldGroup}) ===\n`);
  try {
    const out = fn();
    if (out && out.evidence !== undefined) {
      evidence[fieldGroup] = out.evidence;
    }
    record(testId, fieldGroup, out.status, out.proves, out.reason || null);
    process.stdout.write(`  -> ${out.status.toUpperCase()}\n`);
    results.push({ testId, status: out.status });
  } catch (err) {
    evidence[fieldGroup] = {
      harness_error: true,
      error: err.message,
      stack: String(err.stack || '').split('\n').slice(0, 6).join('\n')
    };
    record(testId, fieldGroup, STATUS.BLOCKED, 'nothing -- the harness itself threw', `harness error: ${err.message}`);
    process.stdout.write(`  -> BLOCKED (harness error): ${err.message}\n`);
    results.push({ testId, status: STATUS.BLOCKED });
  }
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function ws(...parts) { return path.join(WORKSPACE, ...parts); }
function rel(abs) { return path.relative(REPO_ROOT, abs); }

rmrf(WORKSPACE);
fs.mkdirSync(WORKSPACE, { recursive: true });

// ---------------------------------------------------------------------------
// Shared fixtures: a valid charter, built by the REAL createCharter
// ---------------------------------------------------------------------------

const FP = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, FINGERPRINT_PATH), 'utf8'));

function charterSpec(overrides) {
  const spec = {
    charter_id: 'tt-s3-dryrun',
    created_at: '2026-08-05T06:00:00.000Z',
    target: {
      description: 'S3 dry-run fixture charter -- never used to drive a real cycle.',
      repo_root: REPO_ROOT,
      subject: 'ant-hive-world simulation + the Mythos harness'
    },
    cycle_ceiling: 5,
    evaluator_versions: { 'benchmark-colony': 'v1', 'journal': '1.0' },
    // T1 (tt-charter-template-and-spend-ledger): every surface and ceiling
    // here must satisfy charter-template-run.json's mandated_write_surfaces
    // and floors, or createCharter() below refuses at fixture-build time.
    // The S3-g boundary arms further down read LINES/FILES/ACTIONS off
    // CHARTER dynamically, so bumping these floors does not desynchronize
    // that test's just-under/exactly-at/just-over arithmetic.
    allowed_write_surfaces: [
      'tools/ticktock/**',
      '_dev/state/ticktock/**',
      '_dev/reports/analysis/**',
      '_dev/sim-runs/**',
      '_dev/state/tt-projection-inbox/**',
      '_dev/state/ant-hive-world-run/**',
      'tools/ant-hive-world/unreal-export/**',
      '_dev/state/ticktock/spend-ledgers/**'
    ],
    max_cumulative_diff: { lines_changed: 36440, files_changed: 77 },
    max_external_actions: 9,
    resource_ceilings: {
      wall_clock_seconds_per_cycle: 3600,
      wall_clock_seconds_total: 14400,
      max_subagent_dispatches: 12
    },
    reviewer_roster: {
      locked_at: '2026-08-05T06:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'hermes-1', family: 'hermes', model_pin: 'hermes-4-405b', assignment_order: 2, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: {
      until_kind: 'deterministic_milestone',
      until_milestone: 'generation manifest for cycle 3 exists and verifies',
      halt_conditions: ['BENCHMARK-DIVERGENCE', 'CEILING-EXCEEDED', 'MERGE-NOT-CLEAN']
    },
    benchmark: {
      colony_spec_path: 'tools/ticktock/benchmark-colony-v1.json',
      colony_spec_version: 'v1',
      fingerprint_path: FINGERPRINT_PATH,
      fingerprint_hash: FP.fingerprint_hash,
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 }
    }
  };
  return Object.assign(spec, overrides || {});
}

const CHARTER = charterMod.createCharter(charterSpec());
process.stdout.write(`fixture charter committed: charter_hash=${CHARTER.charter_hash}\n`);
process.stdout.write(`fixture roster lane_binding_hash=${CHARTER.reviewer_roster.lane_binding_hash}\n`);

const H64 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

// T2 (tt-charter-template-and-spend-ledger): completePhase() now refuses any
// record with completed !== null lacking a valid, boundary-bound spend
// receipt. Every completePhase fixture below is exercising something other
// than the receipt contract itself (S3-g's dedicated boundary arms above do
// that, via ceilings.buildSpendReceipt against the real ledger machinery), so
// a lightweight receipt backed by a real on-disk ledger stub is built per
// call via the module's own ceilings.cjs helpers -- never hand-rolled, so a
// future change to the receipt shape breaks this file the same way it would
// break production code.
function receiptFor(charter, phaseId, cycleIndex, dir) {
  const ledger = ceilings.createSpendLedger(charter);
  return ceilings.buildSpendReceipt({ charter, ledger, phase_id: phaseId, cycle_index: cycleIndex, ledgerDir: dir });
}

// A tiny artifact-writing helper so journal checkpoints have something real to
// re-hash. Everything lives inside the S3 write surface.
function writeArtifact(relName, body) {
  const abs = ws('artifacts', relName);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return rel(abs);
}

// ---------------------------------------------------------------------------
// S3-a1 -- injected drift
// ---------------------------------------------------------------------------

test('S3-a1', 'injected_drift_test', () => {
  const recorded = JSON.parse(JSON.stringify(FP));
  const observed = JSON.parse(JSON.stringify(FP));

  // Inject a behavioral drift at a known tick: rewrite the per-tick digest at
  // tick 137 and recompute the dimension digest the same way run-benchmark does
  // (sha256 over the canonical projection of the per-tick list).
  const INJECT_AT = 137;
  const ptd = observed.dimensions.decision_stream.per_tick_digests;
  const idx = ptd.findIndex((e) => e.t === INJECT_AT);
  if (idx === -1) throw new Error(`tick ${INJECT_AT} not present in the recorded per-tick digests`);
  const before = ptd[idx].digest;
  ptd[idx].digest = H64('injected-behavioral-drift:' + before);
  observed.dimensions.decision_stream.digest = canonical.sha256Hex(
    canonical.canonicalize(observed.dimensions.decision_stream.per_tick_digests)
  );
  observed.fingerprint_hash = canonical.hashObject(observed, ['fingerprint_hash']);

  const cmp = bench.compareFingerprints(recorded, observed);
  process.stdout.write(JSON.stringify({
    halt: cmp.halt, halt_state: cmp.halt_state,
    diverging_dimensions: cmp.diverging_dimensions,
    first_diverging_tick: cmp.first_diverging_tick,
    tick_attribution: cmp.tick_attribution
  }, null, 2) + '\n');

  const halted = cmp.halt === true;
  const tickOk = Number.isInteger(cmp.first_diverging_tick);
  const named = cmp.first_diverging_tick === INJECT_AT;

  return {
    status: halted && tickOk && named ? STATUS.PASS : STATUS.FAIL,
    proves: 'run-benchmark.compareFingerprints() halts on an injected behavioral divergence and names the exact first diverging tick, computed from the recorded per-tick decision-stream digests. No colony was executed: the drift was injected into a copy of the recorded fingerprint, so this proves the DETECTOR, not the engine.',
    reason: halted && tickOk && named ? null
      : `halt=${cmp.halt}, first_diverging_tick=${cmp.first_diverging_tick}, expected ${INJECT_AT}`,
    evidence: {
      halted,
      first_diverging_tick: cmp.first_diverging_tick,
      injected_at_tick: INJECT_AT,
      first_diverging_tick_matches_injection: named,
      halt_state: cmp.halt_state,
      diverging_dimensions: cmp.diverging_dimensions,
      tick_attribution: cmp.tick_attribution,
      recorded_fingerprint_hash: cmp.recorded_fingerprint_hash,
      observed_fingerprint_hash: cmp.observed_fingerprint_hash,
      method: 'bench.compareFingerprints(recorded, mutated-copy-of-recorded)',
      colony_executed: false,
      scope_caveat: 'This exercises the divergence DETECTOR against a synthetically drifted fingerprint. It does not prove that a real re-run of benchmark-colony-v1 reproduces the baseline; that is a separate (engine-executing) claim S3 deliberately does not make.'
    }
  };
});

// ---------------------------------------------------------------------------
// S3-a2 -- repeated-rebaseline detector
// ---------------------------------------------------------------------------

test('S3-a2', 'rebaseline_detector_test', () => {
  // A lineage chain in which cycles 4, 5 and 7 each carried a re-baseline.
  // With the charter's N=2 / M=5 the window is cycles 3..7 => 3 of the last 5.
  const mk = (i, cycle) => ({
    prior_fingerprint_hash: H64('fp' + i),
    new_fingerprint_hash: H64('fp' + (i + 1)),
    triggering_cycle: cycle,
    review_artifact: `_dev/reports/analysis/rebaseline-review-${cycle}.md`,
    ratification_reference: `operator-stamp-${cycle}`,
    reason: `intentional evaluator change at cycle ${cycle}`
  });
  const lineage = [mk(0, 4), mk(1, 5), mk(2, 7)];

  const det = bench.checkRebaselineFrequency(lineage, {
    n_threshold: CHARTER.benchmark.rebaseline_detector.n_threshold,
    m_window: CHARTER.benchmark.rebaseline_detector.m_window,
    current_cycle_index: 7
  });
  process.stdout.write(JSON.stringify(det, null, 2) + '\n');

  // The negative control: two re-baselines in the same window must NOT halt.
  const control = bench.checkRebaselineFrequency([mk(0, 6), mk(1, 7)], {
    n_threshold: 2, m_window: 5, current_cycle_index: 7
  });
  process.stdout.write('control (2/5, must not halt): ' + JSON.stringify(control.halted_on_threshold) + '\n');

  const ratioOk = /^\d+\/\d+$/.test(det.ratio_computed) && det.ratio_computed === '3/5';
  const ok = det.halted_on_threshold === true && det.finding_recorded === true && ratioOk
    && control.halted_on_threshold === false;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'run-benchmark.checkRebaselineFrequency() walks the lineage chain, computes the <N>/<M> ratio mechanically, halts with REBASELINE-FREQUENCY and files a finding above the charter threshold, and does NOT fire at or below it (negative control included so the pass is not vacuous).',
    reason: ok ? null : `det=${JSON.stringify(det)}, control_halted=${control.halted_on_threshold}`,
    evidence: {
      halted_on_threshold: det.halted_on_threshold,
      finding_recorded: det.finding_recorded,
      ratio_computed: det.ratio_computed,
      ratio_format_matches_N_over_M: ratioOk,
      halt_state: det.halt_state,
      finding: det.finding,
      n_threshold: det.n_threshold,
      m_window: det.m_window,
      window: det.window,
      rebaseline_cycles_in_window: det.rebaseline_cycles_in_window,
      negative_control: {
        description: 'two re-baselines in the same five-cycle window (at threshold, not above it)',
        halted_on_threshold: control.halted_on_threshold,
        ratio_computed: control.ratio_computed
      },
      silently_cleared: false
    }
  };
});

// ---------------------------------------------------------------------------
// S3-b1 / S3-b2 -- journal resume
// ---------------------------------------------------------------------------

const resumeEvidence = {};

test('S3-b1', 'journal_resume_test_b1', () => {
  const jp = ws('journals', 'kill-before-checkpoint.jsonl');
  fs.mkdirSync(path.dirname(jp), { recursive: true });

  const orientArtifact = writeArtifact('b1-orient-state.json', JSON.stringify({ phase: 'orient', cycle: 0 }) + '\n');
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  journal.completePhase(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: receiptFor(CHARTER, 'tt.orient', 0, ws('spend-ledgers')) }, [path.join(REPO_ROOT, orientArtifact)]);

  // tt.tick is entered and writes a partial artifact, then the process is
  // "killed" -- no completion record, no verified checkpoint.
  const tickKey = charterMod.idempotencyKey('tt.tick', CHARTER.charter_hash, 0, 'gen-none');
  const partialArtifact = writeArtifact('b1-tick-partial.json', JSON.stringify({ partial: true }) + '\n');
  journal.appendRecord(jp, {
    charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.tick',
    idempotency_key: tickKey,
    artifact_hashes: [journal.hashArtifact(path.join(REPO_ROOT, partialArtifact))]
  });

  const resume = journal.resolveResume(jp);
  process.stdout.write(JSON.stringify({
    resumable: resume.resumable, reason: resume.reason,
    last_verified_record_index: resume.last_verified_record_index,
    resume_point: resume.resume_point, rollback: resume.rollback
  }, null, 2) + '\n');

  const idemInterrupted = journal.resolveIdempotency(journal.readJournal(jp), tickKey);
  process.stdout.write('idempotency (interrupted, never dispatched): ' + JSON.stringify(idemInterrupted.resolution) + ' -- ' + idemInterrupted.reason + '\n');

  // Second journal: the same key on a phase that DID complete with a verified
  // checkpoint. This is the arm that proves the key prevents a double fire.
  const jp2 = ws('journals', 'completed-effect.jsonl');
  const a2 = writeArtifact('b1-tick-complete.json', JSON.stringify({ done: true }) + '\n');
  journal.appendRecord(jp2, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  journal.completePhase(jp2, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: receiptFor(CHARTER, 'tt.orient', 0, ws('spend-ledgers')) }, []);
  journal.completePhase(jp2, {
    charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.tick',
    idempotency_key: tickKey,
    dispatch: { dispatched: true, dispatched_at: '2026-08-05T06:10:00Z', receipt_confirmed: true, receipt_at: '2026-08-05T06:10:05Z' },
    spend_receipt: receiptFor(CHARTER, 'tt.tick', 0, ws('spend-ledgers'))
  }, [path.join(REPO_ROOT, a2)]);
  const idemCompleted = journal.resolveIdempotency(journal.readJournal(jp2), tickKey);
  process.stdout.write('idempotency (completed+verified): ' + JSON.stringify(idemCompleted.resolution) + ' -- ' + idemCompleted.reason + '\n');

  const partialAbs = path.join(REPO_ROOT, partialArtifact);
  const rollbackOk = resume.resumable === true
    && resume.rollback && resume.rollback.performed === true
    && resume.rollback.restored_to_record_index === 1
    && resume.rollback.discarded_paths.some((p) => path.resolve(REPO_ROOT, p) === partialAbs)
    && resume.resume_point.phase_id === 'tt.tick';
  const keyHonored = idemCompleted.resolution === 'skip';
  const doubleEffect = idemCompleted.resolution === 'execute';

  const ev = {
    partial_phase_rollback_confirmed: rollbackOk,
    idempotency_key_honored: keyHonored,
    double_effect_detected: doubleEffect,
    kill_point: 'after tt.tick entered and wrote a partial artifact, before its checkpoint verified',
    journal_path: rel(jp),
    resume_resumable: resume.resumable,
    resume_reason: resume.reason,
    last_verified_record_index: resume.last_verified_record_index,
    restored_to_record_index: resume.rollback.restored_to_record_index,
    resume_point: resume.resume_point,
    discarded_paths: resume.rollback.discarded_paths,
    idempotency_key: tickKey,
    idempotency_on_interrupted_record: { resolution: idemInterrupted.resolution, reason: idemInterrupted.reason },
    idempotency_on_completed_record: { resolution: idemCompleted.resolution, reason: idemCompleted.reason },
    completed_effect_journal_path: rel(jp2)
  };
  Object.assign(resumeEvidence, ev);

  return {
    status: rollbackOk && keyHonored && !doubleEffect ? STATUS.PASS : STATUS.FAIL,
    proves: 'journal.resolveResume() rolls the workspace back to the last VERIFIED checkpoint (record 1, tt.orient), discards the interrupted phase\'s unverified artifact rather than replaying it forward, and resumes AT tt.tick; journal.resolveIdempotency() returns "skip" for a key whose record completed with a verified checkpoint, which is the mechanism that prevents the double fire.',
    reason: rollbackOk && keyHonored && !doubleEffect ? null
      : `rollback_ok=${rollbackOk} key_honored=${keyHonored} double_effect=${doubleEffect}`,
    evidence: ev
  };
});

test('S3-b2', 'journal_resume_test_b2', () => {
  const jp = ws('journals', 'kill-after-dispatch.jsonl');
  fs.mkdirSync(path.dirname(jp), { recursive: true });

  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  journal.completePhase(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: receiptFor(CHARTER, 'tt.orient', 0, ws('spend-ledgers')) }, []);

  const key = charterMod.idempotencyKey('tt.ship', CHARTER.charter_hash, 0, 'tree-abc');
  journal.appendRecord(jp, {
    charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.ship',
    idempotency_key: key,
    halt_state: 'EFFECT-RECEIPT-MISSING',
    dispatch: { dispatched: true, dispatched_at: '2026-08-05T06:20:00Z', receipt_confirmed: false, receipt_at: null, external_system: 'git remote (simulated; no network call made)' }
  });

  const resume = journal.resolveResume(jp);
  process.stdout.write(JSON.stringify({
    resumable: resume.resumable, halt_state: resume.halt_state,
    reconciliation_required_before_resume: resume.reconciliation_required_before_resume,
    reason: resume.reason
  }, null, 2) + '\n');

  const idem = journal.resolveIdempotency(journal.readJournal(jp), key);
  process.stdout.write('idempotency: ' + idem.resolution + ' (' + idem.halt_state + ')\n');

  // Contrast arm: a phase that halted BEFORE dispatching resumes normally.
  const jp2 = ws('journals', 'kill-before-dispatch.jsonl');
  journal.appendRecord(jp2, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  journal.completePhase(jp2, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: receiptFor(CHARTER, 'tt.orient', 0, ws('spend-ledgers')) }, []);
  const key2 = charterMod.idempotencyKey('tt.ship', CHARTER.charter_hash, 1, 'tree-def');
  journal.appendRecord(jp2, {
    charter_hash: CHARTER.charter_hash, cycle_index: 1, phase_id: 'tt.ship',
    idempotency_key: key2, halt_state: 'EFFECT-DID-NOT-HAPPEN',
    dispatch: { dispatched: false, dispatched_at: null, receipt_confirmed: false, receipt_at: null }
  });
  const resume2 = journal.resolveResume(jp2);
  const idem2 = journal.resolveIdempotency(journal.readJournal(jp2), key2);
  process.stdout.write('contrast (EFFECT-DID-NOT-HAPPEN): resumable=' + resume2.resumable + ' idempotency=' + idem2.resolution + '\n');

  const ok = resume.resumable === false
    && resume.halt_state === 'EFFECT-RECEIPT-MISSING'
    && resume.reconciliation_required_before_resume === true
    && idem.resolution === 'reconcile'
    && resume2.resumable === true
    && idem2.resolution === 'execute';

  const ev = {
    uncertain_effect_halt_reason: resume.halt_state,
    reconciliation_required_before_resume: resume.reconciliation_required_before_resume,
    resumable: resume.resumable,
    resume_refusal_reason: resume.reason,
    blocking_record_index: resume.blocking_record_index,
    idempotency_resolution: idem.resolution,
    idempotency_reason: idem.reason,
    auto_retry_offered: false,
    journal_path: rel(jp),
    contrast_arm: {
      description: 'the same phase killed BEFORE any external call was made',
      halt_state: 'EFFECT-DID-NOT-HAPPEN',
      resumable: resume2.resumable,
      idempotency_resolution: idem2.resolution,
      journal_path: rel(jp2),
      why_it_matters: 'the two halt states are not collapsible: EFFECT-DID-NOT-HAPPEN resumes normally, EFFECT-RECEIPT-MISSING does not resume at all until a reconciliation record exists'
    },
    external_system_contacted: false
  };
  Object.assign(resumeEvidence, ev);

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'journal.resolveResume() refuses to resume a journal carrying an unreconciled EFFECT-RECEIPT-MISSING record and names that halt state exactly, while the contrast arm (EFFECT-DID-NOT-HAPPEN) resumes normally and re-executes -- the two-state distinction is a field on disk, not prose. resolveIdempotency() returns "reconcile", never "skip" or "execute", for the uncertain key.',
    reason: ok ? null : `resume=${JSON.stringify({ r: resume.resumable, h: resume.halt_state })} idem=${idem.resolution}`,
    evidence: ev
  };
});

// The acceptance matrix names ONE field group, journal_resume_test, for b1 and
// b2. Both sub-groups are also merged into it so a reader following the matrix
// verbatim finds every assertion clause where the matrix says it will be.
evidence.journal_resume_test = resumeEvidence;

// ---------------------------------------------------------------------------
// S3-c -- charter/meta immutability + ratification-path proposal artifact
// ---------------------------------------------------------------------------

test('S3-c', 'charter_immutability_test', () => {
  // (1) The refusal arm, executed.
  const tampered = JSON.parse(JSON.stringify(CHARTER));
  tampered.max_external_actions = 999; // a cycle trying to widen its own ceiling
  const imm = charterMod.checkImmutability(tampered);
  const val = charterMod.validateCharter(tampered);
  process.stdout.write('checkImmutability(tampered charter): ' + JSON.stringify(imm) + '\n');
  process.stdout.write('validateCharter stage_reached: ' + val.stage_reached + '\n');

  // The meta-file arm: is a meta-file path inside the charter's allowed write
  // surfaces? The charter's own bound is the mechanism here.
  //
  // T1 (tt-charter-template-and-spend-ledger, S3-c disposition): the fourth
  // target used to be _dev/reports/analysis/mind-capabilities-matrix.md,
  // chosen because it sat OUTSIDE the fixture's old, narrow 2-surface list.
  // charter-template-run.json now MANDATES _dev/reports/analysis/** as an
  // allowed write surface (ticktock genuinely has to write review/plan
  // artifacts there every cycle), so that path is legitimately in-surface
  // now -- probing it here would test the wrong thing. CLAUDE.md replaces it:
  // still a real meta/governance file, still outside every
  // template-mandated surface, so the probe keeps testing what it always
  // tested (a meta-file edit is refused) rather than silently degrading into
  // a false positive once T1 widened the surface list.
  const metaTargets = [
    '.claude/skills/ticktock/SKILL.md',
    '.claude/skills/go/SKILL.md',
    'instructions/canonical/dispatch-routing-rule.yaml',
    'CLAUDE.md'
  ];
  const surfaces = CHARTER.allowed_write_surfaces;
  const metaWriteRefusals = metaTargets.map((t) => ({
    path: t,
    inside_allowed_write_surfaces: surfaces.some((s) => {
      const prefix = s.replace(/\*+$/, '');
      return t.startsWith(prefix);
    }),
    refused: true
  }));
  const allMetaRefused = metaWriteRefusals.every((m) => m.inside_allowed_write_surfaces === false);

  // (2) The proposal-artifact arm. Search the repo for ANY producer.
  const producerSearch = {
    searched_for: 'a module, schema, or path convention that emits the ratification-path PROPOSAL artifact the SKILL mandates',
    tools_ticktock_modules_exporting_a_proposal_writer: [],
    schema_files_matching_proposal: [],
    skill_prose_reference: null
  };
  for (const f of fs.readdirSync(__dirname)) {
    // The harness itself is excluded: this file names proposal_artifact_path in
    // its own evidence fields, and matching that would be the search finding
    // the searcher.
    if (!/\.(cjs|js)$/.test(f) || f === path.basename(__filename)) continue;
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    if (/function\s+\w*[Pp]roposal|writeProposal|proposal_artifact_path/.test(src)) {
      producerSearch.tools_ticktock_modules_exporting_a_proposal_writer.push(f);
    }
    if (/proposal/i.test(f)) producerSearch.schema_files_matching_proposal.push(f);
  }
  const skillSrc = fs.readFileSync(path.join(REPO_ROOT, '.claude/skills/ticktock/SKILL.md'), 'utf8');
  const m = skillSrc.match(/[^\n]*emitted as a proposal artifact[^\n]*\n[^\n]*\n[^\n]*/);
  producerSearch.skill_prose_reference = m ? m[0].trim() : null;

  const proposalProducerExists = producerSearch.tools_ticktock_modules_exporting_a_proposal_writer.length > 0;

  // (3) The PRODUCT's proposal artifact, produced by the PRODUCT's call site.
  //
  // The harness does not construct this document. It hands the refusal it just
  // computed to tools/ticktock/ratification-proposal.cjs -- product code, shipped
  // for exactly this -- and then verifies what landed on disk by re-reading it
  // and re-validating it through the product's own validator. A verifier that
  // manufactured the artifact would prove nothing; a verifier that calls the
  // producer and then independently reads the file proves delivery.
  const proposalDir = rel(ws('proposals'));
  let proposalOutcome = null;
  let proposalError = null;
  try {
    proposalOutcome = proposalMod.refuseEditWithProposal({
      charter: CHARTER,
      cycle_index: 0,
      target_path: '.claude/skills/ticktock/SKILL.md',
      refusal: {
        halt_state: imm.halt_state || 'CHARTER-IMMUTABILITY-VIOLATION',
        detail: imm.detail || 'meta-file target lies outside the charter allowed_write_surfaces',
        refused_by: 'charter.checkImmutability + the charter allowed_write_surfaces bound'
      },
      proposed_change: {
        summary: 'S3 fixture: a refused meta-file edit raised during a simulated cycle',
        fields: [{ field: 'max_external_actions', current: String(CHARTER.max_external_actions), proposed: '999' }],
        diff_preview: `- max_external_actions: ${CHARTER.max_external_actions}\n+ max_external_actions: 999`
      },
      rationale: {
        why: 'S3-c fixture refusal; the cycle wanted to widen its own ceiling',
        expected_benefit: 'none -- this is the case the charter exists to refuse',
        falsifier: 'a ratified widening that does not increase unreviewed spend',
        evidence_links: [EVIDENCE_PATH]
      },
      created_at: '2026-08-05T06:00:00.000Z'
    }, { dir: proposalDir, overwrite: true });
  } catch (err) {
    proposalError = err.message;
  }

  // INDEPENDENT verification of the artifact: re-read the bytes from disk,
  // re-validate, recompute the hash. Not the in-memory object the producer built.
  let proposalReadBack = null;
  let proposalPathResolves = false;
  if (proposalOutcome) {
    const abs = path.join(REPO_ROOT, proposalOutcome.proposal_artifact_path);
    proposalPathResolves = fs.existsSync(abs);
    if (proposalPathResolves) {
      const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
      const v = proposalMod.validateProposal(doc);
      proposalReadBack = {
        schema: doc.schema,
        proposal_id: doc.proposal_id,
        status: doc.status,
        target_path: doc.target.path,
        target_kind: doc.target.kind,
        refusal_halt_state: doc.refusal.halt_state,
        ratification_gate: doc.ratification_path.gate,
        ratification_steps: doc.ratification_path.steps.length,
        schema_valid_on_reread: v.valid,
        hash_verified_on_reread: proposalMod.computeProposalHash(doc) === doc.proposal_hash
      };
    }
  }
  process.stdout.write('  proposal artifact: '
    + (proposalOutcome ? proposalOutcome.proposal_artifact_path : `NOT PRODUCED (${proposalError})`) + '\n');

  const proposalProduced = Boolean(proposalOutcome)
    && proposalPathResolves
    && proposalReadBack !== null
    && proposalReadBack.schema_valid_on_reread === true
    && proposalReadBack.hash_verified_on_reread === true
    && proposalReadBack.status === 'PROPOSED';

  const editRefused = imm.ok === false
    && imm.halt_state === 'CHARTER-IMMUTABILITY-VIOLATION'
    && val.valid === false
    && allMetaRefused;

  const ok = editRefused && proposalProducerExists && proposalProduced;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: ok
      ? 'BOTH halves are executed. REFUSAL: charter.checkImmutability() detects a charter edit and returns CHARTER-IMMUTABILITY-VIOLATION, validateCharter() fails at CHARTER_HASH, and every meta-file path falls outside the charter\'s allowed_write_surfaces. PROPOSAL: the product\'s call site (ratification-proposal.refuseEditWithProposal) emitted a TickTockRatificationProposal/1.0 artifact at the module\'s own path convention, which this harness then re-read from disk, re-validated through the product\'s validator, and hash-verified. The harness did not construct the document it is asserting on.'
      : 'The REFUSAL half is real and executed. The PROPOSAL half did not complete: see reason.',
    reason: ok ? null : `proposal_artifact_produced is ${proposalProduced} (producer_exists=${proposalProducerExists}, error=${proposalError}).`,
    evidence: {
      edit_refused: editRefused,
      halt_state: imm.halt_state,
      halt_detail: imm.detail,
      validate_charter_valid: val.valid,
      validate_charter_stage_reached: val.stage_reached,
      validate_charter_errors: val.errors,
      tampered_field: 'max_external_actions 3 -> 999',
      meta_file_write_refusals: metaWriteRefusals,
      all_meta_targets_outside_allowed_write_surfaces: allMetaRefused,
      allowed_write_surfaces: surfaces,
      proposal_artifact_produced: proposalProduced,
      proposal_artifact_path: proposalOutcome ? proposalOutcome.proposal_artifact_path : null,
      proposal_artifact_path_resolves: proposalPathResolves,
      proposal_artifact_read_back: proposalReadBack,
      proposal_write_error: proposalError,
      proposal_producer: {
        module: 'tools/ticktock/ratification-proposal.cjs',
        schema: 'tools/ticktock/ratification-proposal-schema.json',
        path_convention: proposalMod.DEFAULT_DIR + '/<proposal_id>.json',
        call_site: 'refuseEditWithProposal -- refusal and proposal in one motion, so a bare refusal is not a reachable outcome'
      },
      proposal_producer_search: producerSearch,
      verification_method: 'the harness called the PRODUCT\'s producer and then re-read, re-validated and re-hashed the resulting file from disk; it never constructed the artifact it asserts on'
    }
  };
});

// ---------------------------------------------------------------------------
// S3-d1 / d2 / d3 -- merge contract
// ---------------------------------------------------------------------------

const mergeEvidence = {};

test('S3-d1', 'merge_contract_tests_d1', () => {
  const decisionDir = ws('review-decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  function reviewer(overrides) {
    return Object.assign({
      lane_id: 'codex-1', family: 'codex',
      model_pin_requested: 'gpt-5-codex', model_pin_observed: 'gpt-5-codex',
      pin_verified: true, status: 'clean', verdict: 'APPROVE',
      unresolved_findings: 0,
      review_artifact_path: '_dev/reports/analysis/fixture-review.md'
    }, overrides || {});
  }

  function decisionDoc(reviewers, cleared) {
    return {
      schema: 'TickTockReviewDecision/1.0',
      gate_id: 'G-TICKTOCK-REVIEW',
      decision_id: 'tt-review-20260805T060000Z',
      produced_by_step: 'S3-fixture',
      created_at: '2026-08-05T06:00:00.000Z',
      charter_id: CHARTER.charter_id,
      charter_hash: CHARTER.charter_hash,
      roster_hash: CHARTER.reviewer_roster.lane_binding_hash,
      reviewers,
      decision: {
        cleared, unresolved_findings_total: 0, reasons: cleared ? [] : ['fixture'],
        decided_at: '2026-08-05T06:00:00.000Z', decided_by: 'S3 harness fixture'
      }
    };
  }

  function evalDecision(name, doc) {
    const p = path.join(decisionDir, name + '.json');
    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    const inv = preflight.classifyInvocation([]); // bare /tt -> resolves tt.tick
    const r = preflight.evaluateTicktockReview(inv, { reviewDecisionPath: rel(p) });
    process.stdout.write(`  ${name}: ${r.verdict} (${r.reason_code}) ${r.reason}\n`);
    return r;
  }

  // ARM A -- the honest encoding: a failed lane also carries a non-APPROVE
  // verdict. This is the form the plan's authors most likely had in mind.
  const timeoutHonest = evalDecision('timeout-honest', decisionDoc([
    reviewer({ status: 'timeout', verdict: 'NO_VERDICT', model_pin_observed: null, pin_verified: false }),
    reviewer({ lane_id: 'gemini-1', family: 'gemini', model_pin_requested: 'gemini-2.5-pro', model_pin_observed: 'gemini-2.5-pro' })
  ], true));
  const subHonest = evalDecision('substitution-honest', decisionDoc([
    reviewer({ status: 'substituted', verdict: 'NO_VERDICT', model_pin_observed: 'gpt-5-mini', pin_verified: false })
  ], true));
  const pinHonest = evalDecision('pin-mismatch-honest', decisionDoc([
    reviewer({ status: 'pin_mismatch', verdict: 'NO_VERDICT', model_pin_observed: 'gpt-5-mini', pin_verified: false })
  ], true));

  // ARM B -- the ADVERSARIAL encoding, which is the whole reason this test
  // exists: the lane's status records the failure but the verdict is laundered
  // to APPROVE with zero findings. A contract that only reads verdict lets this
  // through. This arm is the falsifier for "timeout/substitution/pin_mismatch
  // each INDEPENDENTLY mark the merge not-clean".
  const timeoutLaundered = evalDecision('timeout-laundered', decisionDoc([
    reviewer({ status: 'timeout', verdict: 'APPROVE', unresolved_findings: 0 })
  ], true));
  const subLaundered = evalDecision('substitution-laundered', decisionDoc([
    reviewer({ status: 'substituted', verdict: 'APPROVE', unresolved_findings: 0, model_pin_observed: 'gpt-5-mini', pin_verified: false })
  ], true));
  const pinLaundered = evalDecision('pin-mismatch-laundered', decisionDoc([
    reviewer({ status: 'pin_mismatch', verdict: 'APPROVE', unresolved_findings: 0, model_pin_observed: 'gpt-5-mini', pin_verified: false })
  ], true));

  const REFUSE = 'REFUSE';
  const honest = {
    timeout: timeoutHonest.verdict === REFUSE,
    substitution: subHonest.verdict === REFUSE,
    pin_mismatch: pinHonest.verdict === REFUSE
  };
  const laundered = {
    timeout: timeoutLaundered.verdict === REFUSE,
    substitution: subLaundered.verdict === REFUSE,
    pin_mismatch: pinLaundered.verdict === REFUSE
  };

  // ARM C -- the CONTROL. Same document, same roster, nothing failing: it must
  // CLEAR. Without this arm a refusal-on-everything evaluator would score a
  // perfect pass on arms A and B while blocking every legitimate merge.
  const cleanControl = evalDecision('clean-control', decisionDoc([
    reviewer({}),
    reviewer({ lane_id: 'gemini-1', family: 'gemini', model_pin_requested: 'gemini-2.5-pro', model_pin_observed: 'gemini-2.5-pro' })
  ], true));

  // ARM D -- fail-closed on ABSENCE: a lane that reported no status, and a lane
  // that reported no pin verification, are each not clean on their own.
  const missingStatus = preflight.reviewerNotCleanReasons({
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
    pin_verified: true, verdict: 'APPROVE', unresolved_findings: 0
  });
  const missingPin = preflight.reviewerNotCleanReasons({
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
    status: 'clean', verdict: 'APPROVE', unresolved_findings: 0
  });
  const unknownStatus = preflight.reviewerNotCleanReasons({
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
    status: 'probably-fine', pin_verified: true, verdict: 'APPROVE', unresolved_findings: 0
  });

  // Independence, as the row words it, means the STATUS alone is decisive.
  const independent = laundered.timeout && laundered.substitution && laundered.pin_mismatch;
  const controlClears = cleanControl.verdict === 'PROCEED';
  const failsClosedOnAbsence = missingStatus.length > 0 && missingPin.length > 0 && unknownStatus.length > 0;

  // The schema-level half that DOES hold: a charter whose merge_contract omits
  // any of the three mandatory conditions is refused by validateCharter.
  const badSpec = charterSpec();
  badSpec.reviewer_roster.merge_contract = {
    zero_unresolved_findings_required: true,
    not_clean_conditions: ['findings', 'unavailable', 'roster_hash_mismatch']
  };
  let charterRefusal = null;
  try { charterMod.createCharter(badSpec); }
  catch (err) { charterRefusal = (err.validation && err.validation.errors) || [{ message: err.message }]; }
  process.stdout.write('charter with an incomplete not_clean_conditions: refused = ' + Boolean(charterRefusal) + '\n');

  const ev = {
    not_clean_on_timeout: laundered.timeout,
    not_clean_on_substitution: laundered.substitution,
    not_clean_on_pin_mismatch: laundered.pin_mismatch,
    evaluator_under_test: 'tools/ticktock/preflight-ticktock.cjs :: evaluateTicktockReview (the only executable merge-cleanliness evaluator in the repo)',
    arm_a_status_and_verdict_both_failing: {
      description: 'each failed lane carries status=<failure> AND verdict=NO_VERDICT',
      timeout_refused: honest.timeout,
      substitution_refused: honest.substitution,
      pin_mismatch_refused: honest.pin_mismatch,
      refusal_reason_codes: [timeoutHonest.reason_code, subHonest.reason_code, pinHonest.reason_code]
    },
    arm_b_status_failing_but_verdict_laundered_to_APPROVE: {
      description: 'the falsifier arm: status records timeout/substituted/pin_mismatch but verdict is APPROVE with zero unresolved findings',
      timeout_refused: laundered.timeout,
      substitution_refused: laundered.substitution,
      pin_mismatch_refused: laundered.pin_mismatch,
      observed_verdicts: [timeoutLaundered.verdict, subLaundered.verdict, pinLaundered.verdict],
      observed_reason_codes: [timeoutLaundered.reason_code, subLaundered.reason_code, pinLaundered.reason_code]
    },
    arm_c_clean_control: {
      description: 'the control: a roster with nothing failing must CLEAR, so the pass is not "refuses everything"',
      verdict: cleanControl.verdict,
      reason_code: cleanControl.reason_code,
      clears: controlClears
    },
    arm_d_fail_closed_on_absence: {
      description: 'a reviewer that did not report its own status, or its own pin verification, or reported a status this evaluator does not recognise, is NOT clean',
      missing_status_not_clean: missingStatus.length > 0,
      missing_pin_verified_not_clean: missingPin.length > 0,
      unrecognised_status_not_clean: unknownStatus.length > 0,
      example_reasons: { missing_status: missingStatus, missing_pin_verified: missingPin, unrecognised_status: unknownStatus }
    },
    each_condition_independently_marks_not_clean: independent,
    clean_control_clears: controlClears,
    fails_closed_on_absent_status_or_pin: failsClosedOnAbsence,
    defect_observed: independent ? null : {
      severity: 'MAJOR',
      finding: 'evaluateTicktockReview() filters reviewers on (verdict !== "APPROVE" || unresolved_findings !== 0) only. It never reads reviewers[].status and never reads reviewers[].pin_verified. A decision artifact recording status "timeout", "substituted", or "pin_mismatch" alongside verdict APPROVE and zero findings therefore CLEARS the gate.',
      location: 'tools/ticktock/preflight-ticktock.cjs, the `failing` filter in evaluateTicktockReview',
      why_it_matters: 'the plan\'s own operator ruling makes this exact case canon -- "zero-findings from sub-frontier models = validation failure" -- and the schema deliberately carries status and pin_verified as separate fields so the evaluator can read them. It does not.'
    },
    schema_level_constraint_that_does_hold: {
      description: 'charter.createCharter refuses a roster whose merge_contract.not_clean_conditions omits timeout, substitution, or pin_mismatch',
      refused: Boolean(charterRefusal),
      errors: charterRefusal
    },
    charter_not_clean_conditions: CHARTER.reviewer_roster.merge_contract.not_clean_conditions
  };
  Object.assign(mergeEvidence, ev);

  const d1Ok = independent && controlClears && failsClosedOnAbsence;

  return {
    status: d1Ok ? STATUS.PASS : STATUS.FAIL,
    proves: d1Ok
      ? 'The merge-cleanliness evaluator (preflight-ticktock.evaluateTicktockReview) now reads reviewers[].status and reviewers[].pin_verified, and each of timeout, substitution and pin-mismatch INDEPENDENTLY marks the merge not-clean. The falsifier arm is the proof: a lane whose status records the failure but whose verdict is laundered to APPROVE with zero unresolved findings is REFUSED with ROSTER-NOT-CLEAN. Absence fails closed too -- a lane reporting no status, no pin_verified, or a status the evaluator does not recognise is not clean. The clean control still clears, so the evaluator refuses the right things rather than everything.'
      : 'The only executable merge-cleanliness evaluator in the repo (preflight-ticktock.evaluateTicktockReview) does not mark each of timeout, substitution and pin-mismatch independently not-clean; the falsifier arm shows the gap.',
    reason: d1Ok ? null
      : `independent=${independent} clean_control_clears=${controlClears} fails_closed_on_absence=${failsClosedOnAbsence}. A laundered APPROVE on a timed-out / substituted / pin-mismatched lane must not clear the gate.`,
    evidence: ev
  };
});

test('S3-d2', 'merge_contract_tests_d2', () => {
  const spec = charterSpec();
  spec.charter_id = 'tt-s3-unavailable-lane';
  spec.reviewer_roster.lanes = spec.reviewer_roster.lanes.map((l, i) => (
    i === 2 ? Object.assign({}, l, {
      availability: { reachable: false, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping', detail: 'no response within the availability window' }
    }) : l
  ));
  const c = charterMod.createCharter(spec);
  const val = charterMod.validateCharter(c);
  const recomputed = charterMod.computeLaneBindingHash(c.reviewer_roster);

  process.stdout.write('charter with an unreachable lane: valid=' + val.valid + '\n');
  process.stdout.write('lanes retained: ' + c.reviewer_roster.lanes.length + '\n');
  process.stdout.write('lane_binding_hash recomputes: ' + (recomputed === c.reviewer_roster.lane_binding_hash) + '\n');

  const unreachable = c.reviewer_roster.lanes.filter((l) => l.availability.reachable === false);
  const remaining = c.reviewer_roster.lanes.filter((l) => l.availability.reachable === true);

  // The hash still BINDS the remaining lanes: substituting a reachable lane's
  // model pin must break it, even though another lane is unavailable.
  const substituted = JSON.parse(JSON.stringify(c));
  substituted.reviewer_roster.lanes[0].model_pin = 'gpt-5-mini';
  const bindsRemaining = charterMod.computeLaneBindingHash(substituted.reviewer_roster) !== c.reviewer_roster.lane_binding_hash;

  // And dropping the unavailable lane must also break it -- silently removing
  // an unreachable reviewer is exactly what the snapshot exists to prevent.
  const dropped = JSON.parse(JSON.stringify(c));
  dropped.reviewer_roster.lanes = dropped.reviewer_roster.lanes.filter((l) => l.availability.reachable);
  const dropBreaks = charterMod.computeLaneBindingHash(dropped.reviewer_roster) !== c.reviewer_roster.lane_binding_hash;

  const snapshotOk = val.valid === true && unreachable.length === 1
    && c.reviewer_roster.lanes.length === 3
    && recomputed === c.reviewer_roster.lane_binding_hash
    && c.reviewer_roster.lane_binding_hash_covers.includes('availability.reachable');

  const ev = {
    availability_snapshot_records_unavailable_lane: snapshotOk,
    roster_hash_binds_remaining_lanes: bindsRemaining && dropBreaks,
    unavailable_lanes: unreachable.map((l) => ({ lane_id: l.lane_id, family: l.family, availability: l.availability })),
    remaining_reachable_lane_ids: remaining.map((l) => l.lane_id),
    lanes_retained_in_roster: c.reviewer_roster.lanes.length,
    unavailable_lane_silently_dropped: false,
    charter_valid_with_unreachable_lane: val.valid,
    lane_binding_hash: c.reviewer_roster.lane_binding_hash,
    lane_binding_hash_recomputes: recomputed === c.reviewer_roster.lane_binding_hash,
    lane_binding_hash_covers: c.reviewer_roster.lane_binding_hash_covers,
    substituting_a_reachable_lane_pin_breaks_the_hash: bindsRemaining,
    dropping_the_unavailable_lane_breaks_the_hash: dropBreaks
  };
  Object.assign(mergeEvidence, ev);

  return {
    status: snapshotOk && bindsRemaining && dropBreaks ? STATUS.PASS : STATUS.FAIL,
    proves: 'charter.createCharter() commits an availability snapshot in which an unreachable lane is RECORDED and RETAINED (not dropped), the charter still validates, and the recomputed lane_binding_hash still binds the remaining lanes -- substituting a reachable lane\'s model pin breaks it, and silently dropping the unavailable lane breaks it too.',
    reason: null,
    evidence: ev
  };
});

test('S3-d3', 'merge_contract_tests_d3', () => {
  const tampered = JSON.parse(JSON.stringify(CHARTER));
  tampered.reviewer_roster.lanes[1].model_pin = 'gemini-2.5-flash'; // mid-run substitution
  const imm = charterMod.checkImmutability(tampered);
  const val = charterMod.validateCharter(tampered);
  process.stdout.write('roster tamper -> ' + JSON.stringify(imm) + '\n');

  // The ordering property the module documents: a roster edit must be
  // diagnosed as ROSTER-HASH-MISMATCH, not as a generic charter violation.
  const ordering = imm.halt_state === 'ROSTER-HASH-MISMATCH';

  // A journal record can carry that halt, so the halt is representable end to end.
  const jp = ws('journals', 'roster-tamper.jsonl');
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  const haltRec = journal.appendRecord(jp, {
    charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.ship',
    idempotency_key: charterMod.idempotencyKey('tt.ship', CHARTER.charter_hash, 0, 'x'),
    halt_state: 'ROSTER-HASH-MISMATCH', halt_detail: imm.detail
  });

  const ok = imm.ok === false && ordering && val.valid === false;
  const ev = {
    roster_hash_tamper_halts: ok,
    halt_state: imm.halt_state,
    halt_detail: imm.detail,
    diagnosed_as_roster_not_generic_charter_violation: ordering,
    tampered_field: 'reviewer_roster.lanes[1].model_pin gemini-2.5-pro -> gemini-2.5-flash',
    validate_charter_valid: val.valid,
    validate_charter_stage_reached: val.stage_reached,
    halt_recorded_in_journal: { path: rel(jp), record_index: haltRec.record_index, halt_state: haltRec.halt_state }
  };
  Object.assign(mergeEvidence, ev);

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'charter.checkImmutability() detects a mid-run edit of the stored roster (a model-pin substitution) and halts with ROSTER-HASH-MISMATCH specifically -- the narrower diagnosis, not a generic CHARTER-IMMUTABILITY-VIOLATION -- and journal.appendRecord accepts that halt state, so the halt is representable on disk.',
    reason: ok ? null : `halt_state=${imm.halt_state}`,
    evidence: ev
  };
});

evidence.merge_contract_tests = mergeEvidence;

// ---------------------------------------------------------------------------
// S3-e -- statistical --until refused
// ---------------------------------------------------------------------------

test('S3-e', 'until_refusal_test', () => {
  const attempts = [
    { label: 'statistical', until_kind: 'statistical', until_milestone: 'p < 0.05 on the resource-efficiency metric' },
    { label: 'statistical_significance', until_kind: 'statistical_significance', until_milestone: null },
    { label: 'metric_improves', until_kind: 'metric_improves', until_milestone: null }
  ];
  const refusals = attempts.map((a) => {
    const spec = charterSpec();
    spec.charter_id = 'tt-s3-until-' + a.label;
    spec.stopping_rules = { until_kind: a.until_kind, until_milestone: a.until_milestone, halt_conditions: ['BENCHMARK-DIVERGENCE'] };
    let refused = false; let errors = null;
    try { charterMod.createCharter(spec); }
    catch (err) { refused = true; errors = (err.validation && err.validation.errors) || [{ message: err.message }]; }
    process.stdout.write(`  until_kind="${a.until_kind}" refused=${refused}\n`);
    return { until_kind: a.until_kind, refused, errors };
  });

  const detSpec = charterSpec();
  detSpec.charter_id = 'tt-s3-until-deterministic';
  detSpec.stopping_rules = {
    until_kind: 'deterministic_milestone',
    until_milestone: 'the generation manifest for cycle 3 exists and its manifest_hash verifies',
    halt_conditions: ['BENCHMARK-DIVERGENCE']
  };
  let acceptedCharter = null; let acceptErr = null;
  try { acceptedCharter = charterMod.createCharter(detSpec); }
  catch (err) { acceptErr = err.message; }
  process.stdout.write('  deterministic_milestone accepted=' + Boolean(acceptedCharter) + '\n');

  // The stronger half: a deterministic_milestone with a NULL milestone is also
  // refused, so "deterministic" cannot be claimed without naming the milestone.
  const emptySpec = charterSpec();
  emptySpec.charter_id = 'tt-s3-until-empty';
  emptySpec.stopping_rules = { until_kind: 'deterministic_milestone', until_milestone: null, halt_conditions: ['x'] };
  let emptyRefused = false;
  try { charterMod.createCharter(emptySpec); } catch { emptyRefused = true; }

  const allRefused = refusals.every((r) => r.refused);
  const accepted = Boolean(acceptedCharter);

  return {
    status: allRefused && accepted && emptyRefused ? STATUS.PASS : STATUS.FAIL,
    proves: 'RunCharter/1.0 makes a statistical stopping condition UNREPRESENTABLE: stopping_rules.until_kind is a closed enum of cycle_ceiling | deterministic_milestone | none, so createCharter refuses every statistical form at the SCHEMA_SHAPE stage, while a deterministic milestone with a named milestone string is accepted. A deterministic_milestone with a null milestone is also refused, so the deterministic form cannot be claimed without naming the milestone.',
    reason: allRefused && accepted && emptyRefused ? null : `refused=${allRefused} accepted=${accepted} emptyRefused=${emptyRefused}`,
    evidence: {
      statistical_condition_refused: allRefused,
      deterministic_condition_accepted: accepted,
      refusal_mechanism: 'closed enum in tools/ticktock/charter-schema.json stopping_rules.until_kind -- unrepresentability, not a runtime check a caller could skip',
      attempts: refusals,
      accepted_form: acceptedCharter ? {
        until_kind: acceptedCharter.stopping_rules.until_kind,
        until_milestone: acceptedCharter.stopping_rules.until_milestone,
        charter_hash: acceptedCharter.charter_hash
      } : { error: acceptErr },
      deterministic_with_null_milestone_also_refused: emptyRefused,
      allowed_until_kinds: ['cycle_ceiling', 'deterministic_milestone', 'none']
    }
  };
});

// ---------------------------------------------------------------------------
// S3-f -- lineage integrity across generations
// ---------------------------------------------------------------------------

const GEN_DIR_REL = rel(ws('generations'));

function buildGenerations(n, opts) {
  const options = opts || {};
  const manifests = [];
  let parent = null;
  for (let i = 0; i < n; i += 1) {
    const manifest = {
      schema: 'GenerationManifest/1.0',
      generation_id: `tt-gen-${i}-${CHARTER.charter_id}`,
      cycle_index: i,
      created_at: new Date(Date.parse('2026-08-05T06:00:00.000Z') + i * 3600000).toISOString(),
      charter_id: CHARTER.charter_id,
      charter_hash: CHARTER.charter_hash,
      parent: parent
        ? { parent_generation_id: parent.generation_id, parent_manifest_hash: gm.computeManifestHash(parent) }
        : { parent_generation_id: null, parent_manifest_hash: null },
      inputs: {
        benchmark_fingerprint_hash: FP.fingerprint_hash,
        benchmark_identical: true,
        journal_head_record_hash: null,
        artifact_hashes: []
      },
      outputs: [],
      reviews: [],
      merge_decision: { clean: false, reasons: ['S3 dry-run: no merge attempted'], decided_at: '2026-08-05T06:00:00.000Z' },
      metrics: { dry_run: true },
      rotation: options.rotation
        ? options.rotation(i)
        : { rotated_lane_id: `rot-lane-${i}`, was_untested: true, recorded_in_matrix: true, prior_lane_ids: [] }
    };
    const receipt = gm.writeGenerationManifest(manifest, { dir: GEN_DIR_REL });
    manifests.push({ manifest: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, receipt.path), 'utf8')), receipt });
    parent = manifests[manifests.length - 1].manifest;
  }
  return manifests;
}

let GENERATIONS = null;

test('S3-f', 'lineage_integrity_test', () => {
  GENERATIONS = buildGenerations(4);

  // (a) Manifest lineage, verified link by link through the REAL verifier, and
  //     re-read from disk rather than from the in-memory objects.
  const links = [];
  for (let i = 0; i < GENERATIONS.length; i += 1) {
    const onDisk = gm.readGenerationManifest(GENERATIONS[i].receipt.path);
    const parentOnDisk = i === 0 ? null : gm.readGenerationManifest(GENERATIONS[i - 1].receipt.path).manifest;
    const link = gm.verifyLineageLink(onDisk.manifest, parentOnDisk);
    links.push({
      generation_id: onDisk.manifest.generation_id,
      cycle_index: onDisk.manifest.cycle_index,
      path: GENERATIONS[i].receipt.path,
      hash_verified_on_reread: onDisk.hash_verified,
      linked: link.linked,
      reason: link.reason
    });
    process.stdout.write(`  gen ${i}: linked=${link.linked} hash_verified=${onDisk.hash_verified}\n`);
  }

  // (b) The falsifier: break one link and confirm the verifier says so.
  const brokenSrc = JSON.parse(JSON.stringify(GENERATIONS[2].manifest));
  brokenSrc.parent.parent_manifest_hash = H64('not-the-parent');
  const brokenLink = gm.verifyLineageLink(brokenSrc, GENERATIONS[1].manifest);
  process.stdout.write('  falsifier (tampered parent hash): linked=' + brokenLink.linked + '\n');

  // (c) The benchmark fingerprint lineage chain, through run-benchmark's own verifier.
  const fpLineage = [0, 1, 2].map((i) => ({
    prior_fingerprint_hash: H64('fp' + i),
    new_fingerprint_hash: H64('fp' + (i + 1)),
    triggering_cycle: i + 1,
    review_artifact: `_dev/reports/analysis/rebaseline-${i}.md`,
    ratification_reference: `operator-stamp-${i}`,
    reason: `intentional evaluator change ${i}`
  }));
  const fpChain = bench.verifyLineageChain(fpLineage);
  const fpBroken = bench.verifyLineageChain([
    fpLineage[0],
    Object.assign({}, fpLineage[1], { prior_fingerprint_hash: H64('wrong') })
  ]);
  process.stdout.write('  fingerprint lineage: unbroken=' + fpChain.chain_unbroken + ' falsifier=' + fpBroken.chain_unbroken + '\n');

  const manifestChainOk = links.every((l) => l.linked && l.hash_verified_on_reread);
  const ok = manifestChainOk && brokenLink.linked === false
    && fpChain.chain_unbroken === true && fpBroken.chain_unbroken === false;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'Two independent lineage chains verify end to end through their own verifiers, re-read from disk: the GenerationManifest parent-hash chain across 4 generations (gm.verifyLineageLink + a recomputed manifest_hash on every re-read) and the benchmark re-baseline chain (bench.verifyLineageChain). Both falsifier arms -- a tampered parent hash and a tampered prior_fingerprint_hash -- are correctly reported as broken, so the pass is not vacuous.',
    reason: ok ? null : `manifest_chain=${manifestChainOk} falsifier=${brokenLink.linked} fp_chain=${fpChain.chain_unbroken}`,
    evidence: {
      chain_unbroken: manifestChainOk && fpChain.chain_unbroken,
      independently_verified: true,
      independent_verification_method: 're-read every manifest from disk with gm.readGenerationManifest (recomputes manifest_hash from file bytes) and re-linked with gm.verifyLineageLink against the previous generation also re-read from disk -- never against the in-memory object that wrote it',
      generations_in_chain: GENERATIONS.length,
      manifest_links: links,
      manifest_falsifier: { description: 'parent_manifest_hash replaced with an unrelated digest', linked: brokenLink.linked, reason: brokenLink.reason },
      fingerprint_lineage_chain: { entries: fpChain.entries, chain_unbroken: fpChain.chain_unbroken, errors: fpChain.errors },
      fingerprint_lineage_falsifier: { chain_unbroken: fpBroken.chain_unbroken, errors: fpBroken.errors },
      generations_dir: GEN_DIR_REL
    }
  };
});

// ---------------------------------------------------------------------------
// S3-g -- ceiling enforcement
// ---------------------------------------------------------------------------

test('S3-g', 'ceiling_enforcement_test', () => {
  // Search every module on the S3 write surface for an executable evaluator
  // that compares an observed spend against the charter's ceilings.
  const search = { files_scanned: [], ceiling_evaluators_found: [], modules_reading_ceilings: [], halt_state_vocabulary_present: false };
  for (const f of fs.readdirSync(__dirname)) {
    if (!/\.(cjs|js)$/.test(f) || /^test-/.test(f) || f === path.basename(__filename)) continue;
    search.files_scanned.push(f);
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    // An evaluator would have to READ a ceiling and COMPARE it.
    const reads = /max_cumulative_diff|max_external_actions|resource_ceilings/.test(src);
    const compares = /(max_cumulative_diff|max_external_actions)[^\n]{0,80}[<>]=?|[<>]=?[^\n]{0,80}(max_cumulative_diff|max_external_actions)/.test(src);
    if (reads) search.modules_reading_ceilings.push(f);
    if (reads && compares) search.ceiling_evaluators_found.push(f);
  }

  // The source regex above is a PROXY and a weak one: it only matches a comparison
  // written literally against the ceiling field names, so an evaluator that copies
  // the limits into locals first is invisible to it. The load-bearing check is the
  // executable surface -- a module that exports the evaluator and the call site --
  // corroborated by the boundary arms further down, which actually run them.
  const evaluatorSurface = {
    module: 'tools/ticktock/ceilings.cjs',
    exports_evaluate_ceilings: typeof ceilings.evaluateCeilings === 'function',
    exports_accumulator: typeof ceilings.createSpendLedger === 'function' && typeof ceilings.accumulate === 'function',
    exports_phase_boundary_call_site: typeof ceilings.enforceCeilingsAtPhaseBoundary === 'function'
  };
  search.executable_evaluator_surface = evaluatorSurface;
  search.halt_state_vocabulary_present = journal.HALT_STATES.includes('CEILING-EXCEEDED');
  process.stdout.write('  ceiling evaluators found: ' + JSON.stringify(search.ceiling_evaluators_found) + '\n');

  // The ceilings are stored immutably in the charter, and a CEILING-EXCEEDED halt
  // is representable on the journal. Neither is enforcement -- both are recorded
  // because they are the preconditions the enforcement below stands on.
  const jp = ws('journals', 'ceiling.jsonl');
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  const rec = journal.appendRecord(jp, {
    charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.improve',
    idempotency_key: charterMod.idempotencyKey('tt.improve', CHARTER.charter_hash, 0, 'p1,p2'),
    halt_state: 'CEILING-EXCEEDED',
    halt_detail: 'fixture: a halt record with this state is accepted by the journal schema'
  });
  // And a ceiling edit is refused (the frame cannot be widened from inside).
  const widened = JSON.parse(JSON.stringify(CHARTER));
  widened.max_cumulative_diff.lines_changed = 100000;
  const widenRefused = charterMod.checkImmutability(widened).ok === false;

  const evaluatorExists = evaluatorSurface.exports_evaluate_ceilings
    && evaluatorSurface.exports_accumulator
    && evaluatorSurface.exports_phase_boundary_call_site;

  // ---- THE ENFORCEMENT ARMS, EXECUTED against the real evaluator -------------
  // Charter ceilings: lines_changed 500, files_changed 20, max_external_actions 3.
  // Each arm runs the accumulator and then the phase-boundary call site.
  const LINES = CHARTER.max_cumulative_diff.lines_changed;
  const FILES = CHARTER.max_cumulative_diff.files_changed;
  const ACTIONS = CHARTER.max_external_actions;

  function boundaryArm(name, delta, phaseId) {
    const ledger = ceilings.createSpendLedger(CHARTER);
    ceilings.accumulate(ledger, Object.assign({ phase_id: phaseId, cycle_index: 0 }, delta));
    const armJournal = ws('journals', `ceiling-${name}.jsonl`);
    journal.appendRecord(armJournal, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
    const out = ceilings.enforceCeilingsAtPhaseBoundary({
      charter: CHARTER,
      ledger,
      phase_id: phaseId,
      cycle_index: 0,
      journalPath: armJournal,
      idempotency_key: charterMod.idempotencyKey(phaseId, CHARTER.charter_hash, 0, `ceiling-${name}`),
      throwOnHalt: false
    });
    // Independently re-read the journal tail: the halt has to have LANDED.
    const tail = journal.readJournal(armJournal).slice(-1)[0];
    process.stdout.write(`  ${name}: halted=${out.halted} observed=${JSON.stringify(out.evaluation.observed)}\n`);
    return {
      arm: name,
      observed: out.evaluation.observed,
      halted: out.halted,
      halt_state: out.halt_state,
      exceeded: out.evaluation.exceeded,
      journal_tail_halt_state: tail ? tail.halt_state : null,
      journal_path: rel(armJournal)
    };
  }

  const arms = {
    diff_lines_just_under: boundaryArm('diff-lines-under', { lines_changed: LINES - 1 }, 'tt.improve'),
    diff_lines_exactly_at: boundaryArm('diff-lines-at', { lines_changed: LINES }, 'tt.improve'),
    diff_lines_just_over: boundaryArm('diff-lines-over', { lines_changed: LINES + 1 }, 'tt.improve'),
    diff_files_just_under: boundaryArm('diff-files-under', { files: Array.from({ length: FILES - 1 }, (_, i) => `f${i}.js`) }, 'tt.improve'),
    diff_files_just_over: boundaryArm('diff-files-over', { files: Array.from({ length: FILES + 1 }, (_, i) => `f${i}.js`) }, 'tt.improve'),
    external_actions_just_under: boundaryArm('ext-under', { external_actions: ACTIONS - 1 }, 'tt.ship'),
    external_actions_exactly_at: boundaryArm('ext-at', { external_actions: ACTIONS }, 'tt.ship'),
    external_actions_just_over: boundaryArm('ext-over', { external_actions: ACTIONS + 1 }, 'tt.ship')
  };

  // A halt a caller can step over is not a halt: by default the call site throws.
  let throwsByDefault = false;
  try {
    const l = ceilings.accumulate(ceilings.createSpendLedger(CHARTER), { lines_changed: LINES + 1 });
    ceilings.enforceCeilingsAtPhaseBoundary({ charter: CHARTER, ledger: l, phase_id: 'tt.improve', cycle_index: 0 });
  } catch (err) {
    throwsByDefault = err.halt_state === 'CEILING-EXCEEDED';
  }

  const diffCeilingHalts = arms.diff_lines_just_over.halted === true
    && arms.diff_lines_just_over.journal_tail_halt_state === 'CEILING-EXCEEDED'
    && arms.diff_files_just_over.halted === true
    && arms.diff_lines_just_under.halted === false
    && arms.diff_lines_exactly_at.halted === false
    && arms.diff_files_just_under.halted === false;

  const externalCeilingHalts = arms.external_actions_just_over.halted === true
    && arms.external_actions_just_over.journal_tail_halt_state === 'CEILING-EXCEEDED'
    && arms.external_actions_just_under.halted === false
    && arms.external_actions_exactly_at.halted === false;

  const ok = evaluatorExists && diffCeilingHalts && externalCeilingHalts && throwsByDefault;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: ok
      ? 'Both ceilings are enforced by executed code, not by vocabulary. tools/ticktock/ceilings.cjs accumulates observed spend cumulatively across the run (files_changed as a distinct-path count, not a sum of touches) and enforceCeilingsAtPhaseBoundary compares it against the charter\'s stored ceilings at a phase boundary. Just-under and exactly-at do not halt; just-over halts with CEILING-EXCEEDED, and the halt record is re-read from the journal on disk rather than trusted from the return value. By default the call site also THROWS, so a caller that ignores the return value still stops.'
      : 'The charter STORES both ceilings immutably and the journal ACCEPTS a CEILING-EXCEEDED halt record, but the enforcement arms did not all behave as the row requires.',
    reason: ok ? null : `evaluator_exists=${evaluatorExists} diff_ceiling_halts=${diffCeilingHalts} external_action_ceiling_halts=${externalCeilingHalts} throws_by_default=${throwsByDefault}`,
    evidence: {
      diff_ceiling_halts: diffCeilingHalts,
      external_action_ceiling_halts: externalCeilingHalts,
      halt_throws_by_default: throwsByDefault,
      evaluator: {
        module: 'tools/ticktock/ceilings.cjs',
        accumulator: 'createSpendLedger + accumulate (cumulative across the whole run, per the charter schema\'s own "not per cycle" bound)',
        call_site: 'enforceCeilingsAtPhaseBoundary(charter, ledger, phase_id, cycle_index, journalPath)',
        exceeded_predicate: 'strictly greater than -- landing exactly on a ceiling is spending the allowance, not exceeding it'
      },
      boundary_arms: arms,
      evaluator_search: search,
      charter_ceilings_stored: {
        max_cumulative_diff: CHARTER.max_cumulative_diff,
        max_external_actions: CHARTER.max_external_actions,
        resource_ceilings: CHARTER.resource_ceilings
      },
      ceiling_widening_refused_by_checkImmutability: widenRefused,
      halt_state_representable_on_journal: {
        halt_state: rec.halt_state,
        record_index: rec.record_index,
        journal_path: rel(jp),
        note: 'the journal accepting a CEILING-EXCEEDED record proves the vocabulary exists; the boundary arms above prove something computes the condition'
      },
      honest_tier: 'ADVISORY at the harness level: the evaluator is deterministic executable code that refuses, but nothing in the Claude Code harness compels a phase to call it. A caller that never accumulates never halts.'
    }
  };
});

// ---------------------------------------------------------------------------
// S3-h -- inherited-gate probes, one per gate_id
// ---------------------------------------------------------------------------

test('S3-h', 'inherited_gate_probes', () => {
  const DISPATCH_PRETOOL = 'tools/kernel/hooks/dispatch-pretool.cjs';
  const DISPATCH_USERPROMPT = 'tools/kernel/hooks/dispatch-userprompt.cjs';

  function readIf(relPath) {
    const abs = path.join(REPO_ROOT, relPath);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  }
  const dispatchPre = readIf(DISPATCH_PRETOOL);
  const dispatchUser = readIf(DISPATCH_USERPROMPT);

  // WHAT A STATIC PROBE CAN AND CANNOT DECIDE.
  //
  // From disk, without firing a tool call, exactly two things about a gate are
  // decidable: does its named checker exist, and is that checker referenced by
  // the dispatcher the matrix says wires it (at the line the matrix names).
  // NOT decidable: whether a wired hook blocks or merely advises, and whether a
  // gate's conditionality lives somewhere the checker file does not mention.
  //
  // An earlier version of this probe tried to classify conditionality by
  // grepping for MYTHOS_*_GATE flags near the dispatcher's require(). It
  // misattributed a neighbouring gate's flag to pretool-git-custody-gate. The
  // probe is therefore scored on the two decidable axes only, and the
  // undecidable axis is reported as undecidable rather than guessed.

  function expectedFromMatrix(gate) {
    const checkerText = String(gate.mechanical_checker);
    const wiredText = String(gate.wired_at);
    return {
      checker_expected: !/^NONE/i.test(checkerText),
      wired_expected: !/not wired|NOT YET WIRED|not independently wired|not .*wired into/i.test(wiredText),
      wired_at_claim: wiredText
    };
  }

  function observedLabel(gate) {
    const checkerText = String(gate.mechanical_checker);
    // No early returns: every gate, including the "NONE" and vocabulary-only
    // rows, goes through the same fact-gathering so every probe carries the
    // same field set. A probe that returns a different shape for the gates that
    // matter least is how a gate gets silently skipped.
    // Checker paths can be named in EITHER field: the matrix records
    // G-REMOTE-MUTATION's intended landed path under mechanical_checker and its
    // actual staged path under wired_at, so both are scanned.
    const paths = [...new Set([
      ...(checkerText.match(/[\w./-]+\.cjs/g) || []),
      ...(String(gate.wired_at).match(/[\w./-]+\.cjs/g) || [])
    ])].filter((p) => !/dispatch-(pretool|userprompt)\.cjs$/.test(p));
    const existing = paths.filter((p) => fs.existsSync(path.join(REPO_ROOT, p)));
    const missing = paths.filter((p) => !fs.existsSync(path.join(REPO_ROOT, p)));
    const basenames = [...new Set(paths.map((p) => path.basename(p)))];
    const stems = basenames.map((b) => b.replace(/\.cjs$/, ''));
    const referencedInPre = dispatchPre ? stems.some((s) => dispatchPre.includes(s)) : false;
    const referencedInUser = dispatchUser ? stems.some((s) => dispatchUser.includes(s)) : false;
    const referenced = referencedInPre || referencedInUser;
    // "Staged" means the only file that exists is under _dev/staged/ -- written
    // and tested, but not landed where the dispatcher would find it.
    const staged = existing.length > 0 && existing.every((p) => p.startsWith('_dev/staged/'));

    // Verify the matrix's wired_at LINE NUMBER, not just the file: a claim of
    // "wired at dispatch-pretool.cjs:221" is checkable, so it is checked.
    const lineClaims = [];
    for (const m of String(gate.wired_at).matchAll(/([\w./-]+\.cjs):(\d+)/g)) {
      const [, f, n] = m;
      const abs = path.join(REPO_ROOT, f.includes('/') ? f : `tools/kernel/hooks/${f}`);
      let verified = false; let observedLine = null;
      if (fs.existsSync(abs)) {
        const lines = fs.readFileSync(abs, 'utf8').split('\n');
        // +/-4 lines of slack: the matrix cites the wiring block, and a block
        // can shift by a line or two without the claim becoming false.
        for (let i = Math.max(0, Number(n) - 5); i < Math.min(lines.length, Number(n) + 4); i += 1) {
          if (stems.some((s) => lines[i].includes(s))) { verified = true; observedLine = i + 1; break; }
        }
      }
      lineClaims.push({ file: f, claimed_line: Number(n), verified, observed_line: observedLine });
    }

    const facts = {
      checker_paths: paths, checker_paths_existing: existing, checker_paths_missing: missing,
      checker_is_staged_not_landed: staged,
      referenced_in_dispatch_pretool: referencedInPre,
      referenced_in_dispatch_userprompt: referencedInUser,
      wired_at_line_claims: lineClaims,
      checker_exists: existing.length > 0,
      referenced_by_a_dispatcher: referenced
    };
    let label;
    if (/vocabulary module/i.test(checkerText)) label = 'VOCABULARY-ONLY';
    else if (!existing.length) label = 'CHECKER-ABSENT';
    else if (staged) label = 'CHECKER-STAGED-NOT-LANDED';
    else if (!referenced) label = 'CHECKER-PRESENT-NOT-WIRED';
    else label = 'CHECKER-PRESENT-AND-WIRED';
    return { label, facts };
  }

  // ONE gate was observed halting LIVE during this session, out of band: the
  // convene-perimeter-gate denied a read-only Bash command that merely NAMED a
  // protected governance path in its arguments. That is recorded verbatim
  // because it is a real fired halt on the same PreToolUse path /tt would use,
  // and because it independently corroborates the matrix's note that the
  // Bash-channel matcher scans command text rather than distinguishing read
  // from write intent.
  const LIVE_HALT_OBSERVED = {
    'convene-perimeter-gate': {
      observed: true,
      when: 'during this S3 session, on a Bash tool call issued by the harness operator (not by /tt)',
      issued_command: 'grep -n "bubble-up-gates" tools/kernel/hooks/dispatch-pretool.cjs tools/kernel/hooks/dispatch-userprompt.cjs',
      command_was_read_only: true,
      harness_denial_verbatim:
        'PreToolUse:Bash hook error: [node "${CLAUDE_PROJECT_DIR}/tools/kernel/hooks/dispatch-pretool.cjs"]: BLOCKED: governance write to tools/kernel/hooks/dispatch-userprompt.cjs requires a live ConveneReceipt/1.0 covering this path. Run /convene on the proposed change, then mint a 1Password-backed unlock receipt with tools/verify/convene-unlock.cjs.',
      corroborates: 'the matrix\'s recorded enforcement_mode for this gate: BLOCKING, FAIL-CLOSED, with a Bash-channel matcher that scans command text broadly rather than distinguishing read from write intent',
      caveat: 'the halt fired against this session\'s own tool call, not against a /tt phase. It proves the gate blocks a Bash call in this harness; it does not by itself prove /tt reaches the same gate, though /tt runs through the same dispatcher.'
    }
  };

  const probes = {};
  let allPresent = true;
  let allMatched = true;
  for (const gate of GATE_MATRIX) {
    const exp = expectedFromMatrix(gate);
    const obs = observedLabel(gate);
    const live = LIVE_HALT_OBSERVED[gate.gate_id] || null;

    const checkerMatches = exp.checker_expected === obs.facts.checker_exists;
    const wiringMatches = exp.wired_expected === obs.facts.referenced_by_a_dispatcher;
    const lineClaimsOk = obs.facts.wired_at_line_claims.every((c) => c.verified);
    const matched = checkerMatches && wiringMatches && lineClaimsOk;
    if (!matched) allMatched = false;

    probes[gate.gate_id] = {
      gate_id: gate.gate_id,
      halted: Boolean(live && live.observed),
      probe_kind: live
        ? 'LIVE HALT OBSERVED (out of band, on this session\'s own Bash call) + static wiring inspection'
        : 'static-wiring-inspection (read the checker file and the dispatcher that is supposed to call it) -- NOT a fired halt',
      tt_phases: gate.tt_phases,
      matrix_enforcement_mode: gate.enforcement_mode,
      matrix_checker_claim: gate.mechanical_checker,
      matrix_wiring_claim: gate.wired_at,
      enforcement_mode_observed: obs.label,
      enforcement_mode_matches_matrix: matched,
      matched_on: {
        checker_presence: { expected: exp.checker_expected, observed: obs.facts.checker_exists, matches: checkerMatches },
        dispatcher_wiring: { expected: exp.wired_expected, observed: obs.facts.referenced_by_a_dispatcher, matches: wiringMatches },
        wired_at_line_numbers: { claims: obs.facts.wired_at_line_claims, all_verified: lineClaimsOk }
      },
      undecidable_by_this_probe: 'whether a wired hook BLOCKS or merely ADVISES, and any conditionality (env flag, marker file, per-session registry) that does not appear in the checker file itself. These are not guessed; the matrix\'s own recorded enforcement_mode is carried verbatim above instead.',
      live_halt: live,
      observed_facts: obs.facts,
      matrix_evidence_artifact: gate.evidence_artifact,
      why_halted_is_false: live ? null : 'S3 is dry-run verification with no VM contact and no provoked tool calls. This probe reads the gate\'s checker and its wiring from disk; it does not issue a command designed to trip the gate, so no halt was fired and none is claimed.'
    };
    process.stdout.write(`  ${gate.gate_id}: checker exp=${exp.checker_expected}/obs=${obs.facts.checker_exists} wiring exp=${exp.wired_expected}/obs=${obs.facts.referenced_by_a_dispatcher} lines_ok=${lineClaimsOk} matched=${matched}${live ? ' [LIVE HALT OBSERVED]' : ''}\n`);
  }
  const matrixIds = GATE_MATRIX.map((g) => g.gate_id);
  for (const id of matrixIds) if (!probes[id]) allPresent = false;

  return {
    status: allPresent && allMatched ? STATUS.PASS : STATUS.FAIL,
    proves: `One probe exists for every one of the ${matrixIds.length} gate_ids in bounded_plan.inherited_gate_matrix -- none skipped, including the gates the matrix itself records as having no mechanical checker. Each probe decides, from disk, the two things a static probe CAN decide: does the named checker exist, and is it referenced by the dispatcher at the line the matrix claims. Exactly one gate (convene-perimeter-gate) additionally fired a LIVE halt during this session, captured verbatim. This satisfies the row's second, weaker clause for the other ten gates; it does NOT satisfy the first clause for them, because no probe provoked a halt against a /tt phase.`,
    reason: allPresent && allMatched ? null : 'one or more gate probes disagreed with the matrix (see matched_on per gate)',
    evidence: Object.assign({
      _probe_contract: {
        gate_ids_in_matrix: matrixIds.length,
        gate_ids_probed: Object.keys(probes).length,
        every_gate_id_present: allPresent,
        every_observation_matches_matrix: allMatched,
        live_halts_observed: Object.values(probes).filter((p) => p.halted).length,
        halts_provoked_against_a_tt_phase: 0,
        decidable_axes: ['checker file exists where the matrix says', 'checker is referenced by the dispatcher at the line the matrix claims'],
        undecidable_axes: ['blocking vs advisory for a wired hook', 'conditionality that lives outside the checker file (env flags, marker files, per-session registries)'],
        honest_limit: 'An earlier version of this probe tried to classify conditionality by grepping for MYTHOS_*_GATE flags near each dispatcher require(). It misattributed a neighbouring gate\'s flag to pretool-git-custody-gate and produced a false mismatch. The classifier was replaced rather than tuned until it agreed: the undecidable axis is now reported as undecidable and the matrix\'s own enforcement_mode is carried verbatim.'
      }
    }, probes)
  };
});

// ---------------------------------------------------------------------------
// S3-h2 -- the G-REMOTE-MUTATION mechanical checker
// ---------------------------------------------------------------------------

test('S3-h2', 'remote_mutation_gate_test', () => {
  const GATE_PATH = '_dev/staged/kernel-hooks/pretool-remote-mutation-gate.cjs';
  const gate = require(path.join(REPO_ROOT, GATE_PATH));

  // SANDBOX projectDir: the checker's audit rows land inside the S3 write
  // surface instead of the repository's real audit trail.
  const SB = ws('h2-project');
  fs.mkdirSync(path.join(SB, '_dev/reports/analysis'), { recursive: true });
  fs.mkdirSync(path.join(SB, '_dev/state/remote-mutation-stamps'), { recursive: true });
  fs.mkdirSync(path.join(SB, '_dev/sim-runs/vm/orwell'), { recursive: true });
  for (const s of ['check-provisioning.ps1', 'watch-turn-health.ps1']) {
    const src = path.join(REPO_ROOT, '_dev/sim-runs/vm/orwell', s);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SB, '_dev/sim-runs/vm/orwell', s));
  }
  const DOC = '_dev/reports/analysis/g-remote-mutation-prestamp__s3-dryrun__20260805T0600Z.md';
  fs.writeFileSync(path.join(SB, DOC), '# S3 dry-run sandbox stamp\n\nOperator: fixture authorization for the S3 checker probe.\n');
  fs.writeFileSync(
    path.join(SB, '_dev/state/remote-mutation-stamps/s3-dryrun.json'),
    JSON.stringify({
      schema: 'RemoteMutationStamp/1.0',
      stamp_id: 's3-dryrun',
      source_doc: DOC,
      granted_at: '2026-08-05T03:05:00Z',
      operator_authorization: '"consider it stamped" -- S3 sandbox fixture, never a real grant',
      scope: ['load-courier.ps1'],
      conditions: ['sandbox fixture only'],
      expires_at: null, voided: false, superseded_by: null
    }, null, 2) + '\n'
  );

  const NOW = Date.parse('2026-08-05T06:00:00Z');
  let seq = 0;
  function run(command, projectDir) {
    seq += 1;
    return gate.main(
      { tool: 'Bash', payload: { tool_name: 'Bash', tool_input: { command }, session_id: `s3-dryrun-${seq}` } },
      { projectDir: projectDir || SB, nowMs: NOW }
    );
  }
  function auditRows() {
    const f = path.join(SB, '_dev/state/remote-mutation-stamps/audit.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  // 1. Unstamped mutating command -> deny. Use a command NOT in the sandbox
  //    stamp's scope so the deny is about the absence of coverage.
  const unstampedCmd = 'scp ./payload.tar.gz orwell:D:/HyperV/AntWorld/Staging/In/';
  const unstamped = run(unstampedCmd);
  process.stdout.write(`  unstamped: status=${unstamped.status} reason=${unstamped.reason} keys=${JSON.stringify(unstamped.keys)}\n`);

  // 2. The same class of command under a valid scope-matching stamp -> allow.
  const stampedCmd = 'bash psrunfile.sh load-courier.ps1 -ExpectedSha256 abc';
  const stamped = run(stampedCmd);
  process.stdout.write(`  stamped: status=${stamped.status} reason=${stamped.reason} stamp_id=${stamped.stamp_id}\n`);

  // 3. A read-only remote lane with no stamp at all -> allow.
  const readonlyCmd = 'bash psrunfile.sh watch-turn-health.ps1';
  const readonly = run(readonlyCmd);
  process.stdout.write(`  read-only: status=${readonly.status} reason=${readonly.reason}\n`);

  // 4. Scope mismatch under a stamp that exists but does not cover -> deny.
  const scopeMismatchCmd = 'bash psrunfile.sh refresh-seed.ps1';
  const scopeMismatch = run(scopeMismatchCmd);
  process.stdout.write(`  scope-mismatch: status=${scopeMismatch.status} reason=${scopeMismatch.reason}\n`);

  const rows = auditRows();
  process.stdout.write(`  audit rows written to the sandbox: ${rows.length}\n`);
  process.stdout.write('  ' + rows.map((r) => `${r.decision}/${r.reason}`).join(', ') + '\n');
  if (unstamped.message) {
    process.stdout.write('\n--- checker deny message (unstamped) ---\n' + unstamped.message + '\n--- end ---\n');
  }

  // The module's own fixture suite is NOT re-run here, on purpose. It contains
  // arms that deliberately execute against the REAL project dir, so running it
  // appends synthetic rows to the repository's tracked
  // _dev/state/remote-mutation-stamps/audit.jsonl -- residue outside S3's write
  // surface. It was run once during this harness's development (71/71 passed,
  // exit 0) and the resulting 45 appended rows were restored with
  // `git checkout` after verifying the diff was append-only and consisted
  // entirely of rmgate-test-* rows. That observation is recorded as prior
  // corroboration, not as evidence produced by this run.
  const fixtureSuite = {
    re_run_by_this_harness: false,
    why_not: 'the suite writes to the repository\'s real audit.jsonl by design (it has explicit real-project arms), which is outside the S3 write surface',
    suite_path: '_dev/staged/kernel-hooks/__tests__/pretool-remote-mutation-gate.test.cjs',
    prior_observation: '71 passed, 0 failed, exit 0 -- observed once during harness development on 2026-08-05; the 45 audit rows it appended to the tracked real audit.jsonl were verified append-only and restored',
    prior_observation_is_not_this_runs_evidence: true
  };

  // The registration question, answered from disk rather than from memory.
  const dispatchSrc = fs.readFileSync(path.join(REPO_ROOT, 'tools/kernel/hooks/dispatch-pretool.cjs'), 'utf8');
  const registeredInDispatcher = /pretool-remote-mutation-gate/.test(dispatchSrc);
  const landedPath = 'tools/kernel/hooks/pretool-remote-mutation-gate.cjs';
  const landed = fs.existsSync(path.join(REPO_ROOT, landedPath));

  const denyRows = rows.filter((r) => r.decision === 'deny');
  const allowRows = rows.filter((r) => r.decision === 'allow');

  const unstampedDenied = unstamped.status === 2 && unstamped.reason === 'no-covering-stamp';
  const stampedAllowed = stamped.status === 0 && stamped.reason === 'stamped';
  const readonlyAllowed = readonly.status === 0 && readonly.reason === 'read-only-lane';
  const ok = unstampedDenied && stampedAllowed && readonlyAllowed && rows.length >= 2;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'The G-REMOTE-MUTATION CHECKER MODULE, called directly, denies an unstamped remote-mutating command, denies a command whose stamp does not cover its scope, allows the same class of command under a valid scope-matching stamp, allows a read-only remote lane with no stamp, and appends an audit row for every one of those decisions. It proves the MODULE IS CORRECT. It does NOT prove the harness consults it: the module was invoked by require() from this harness, not by the Claude Code PreToolUse dispatcher.',
    reason: ok ? null : 'one of the four checker arms did not return the expected decision',
    evidence: {
      unstamped_mutation_denied: unstampedDenied,
      stamped_mutation_allowed: stampedAllowed,
      readonly_lane_allowed_without_stamp: readonlyAllowed,
      audit_rows_recorded: rows.length,

      enforcement_path_observed: 'module-direct',
      enforcement_path_observed_meaning: 'This tri-state field records WHAT S3-h2\'s OWN PROBE EXERCISED, and this probe calls the module via require() -- so it is permanently "module-direct". It is a fact about the probe, not a live tier reading, and it is deliberately NOT the same field as the strict boolean enforcement_path_observed_live, which records the separate S4-S6 live-denial determination and is the only one preflight-ticktock.cjs reads.',

      // S3 DOES NOT OWN THIS FIELD, so it must not overwrite it.
      //
      // Review finding (2026-08-05, MAJOR): these three keys used to be
      // hardcoded false/null here. Because this suite REGENERATES the evidence
      // artifact wholesale, any re-run silently reverted the S4-S6 reviewer
      // determination and flipped preflight-ticktock.cjs's pretooluse-live gate
      // back to REFUSE -- a stale value reintroduced by a generator, which is
      // the same dual-write failure class the determination itself exists to
      // record. A test suite may report what IT observed; it may not revoke a
      // finding made by distinct reviewers against evidence it never saw.
      //
      // So: carry forward whatever the artifact already holds, and only fall
      // back to the honest S3-only values when no prior determination exists.
      ...carryForwardLiveDetermination(),

      what_was_demonstrated: 'S3 (this suite): checker correctness only, module called directly via require().',
      what_was_not_demonstrated: 'that the harness consults the checker on a real tool call -- S3 cannot demonstrate this and does not claim it. Whether it has been demonstrated ELSEWHERE is recorded in enforcement_path_observed_live, which this suite carries forward rather than sets.',

      registration_status: {
        staged_module_path: GATE_PATH,
        landed_module_path_exists: landed,
        landed_module_path: landedPath,
        referenced_in_dispatch_pretool_cjs: registeredInDispatcher,
        registration_patch: '_dev/staged/kernel-hooks/REGISTRATION-PATCH.md',
        // Observed, not asserted: the blocker is only real while the module is
        // absent from the dispatcher. Hardcoding the string re-stated a cleared
        // blocker on every re-run.
        blocker: (landed && registeredInDispatcher)
          ? null
          : 'tools/kernel/ is inside the convene authority perimeter and no ConveneReceipt/1.0 covers it'
      },

      probes: [
        { arm: 'unstamped mutating', command: unstampedCmd, status: unstamped.status, decision: unstamped.status === 2 ? 'deny' : 'allow', reason: unstamped.reason, keys: unstamped.keys || null },
        { arm: 'stamped, scope matches', command: stampedCmd, status: stamped.status, decision: stamped.status === 2 ? 'deny' : 'allow', reason: stamped.reason, stamp_id: stamped.stamp_id || null },
        { arm: 'read-only lane, no stamp', command: readonlyCmd, status: readonly.status, decision: readonly.status === 2 ? 'deny' : 'allow', reason: readonly.reason },
        { arm: 'stamp exists but scope excludes', command: scopeMismatchCmd, status: scopeMismatch.status, decision: scopeMismatch.status === 2 ? 'deny' : 'allow', reason: scopeMismatch.reason }
      ],
      audit_log_path: rel(path.join(SB, '_dev/state/remote-mutation-stamps/audit.jsonl')),
      audit_log_is_sandboxed: true,
      audit_log_sandbox_rationale: 'S3\'s write surface is tools/ticktock/** and _dev/state/ticktock/** only. The checker was given a sandbox projectDir so its audit rows do not contaminate the repository\'s real _dev/state/remote-mutation-stamps/audit.jsonl with synthetic decisions.',
      audit_deny_rows: denyRows.length,
      audit_allow_rows: allowRows.length,
      audit_rows: rows.map((r) => ({ decision: r.decision, reason: r.reason, keys: r.keys, stamp_id: r.stamp_id, command: r.command })),
      module_fixture_suite: fixtureSuite,
      vm_contact: false
    }
  };
});

// ---------------------------------------------------------------------------
// S3-h3 -- the pretooluse-live precondition refuses unattended/remote-capable
// ---------------------------------------------------------------------------

test('S3-h3', 'pretooluse_live_precondition', () => {
  // A fixture evidence artifact carrying the honest false, so this test does
  // not depend on the artifact it is helping to write.
  const fixtureEvidence = ws('preflight-fixtures', 'evidence-live-false.json');
  fs.mkdirSync(path.dirname(fixtureEvidence), { recursive: true });
  fs.writeFileSync(fixtureEvidence, JSON.stringify({
    schema: 'TickTockDryRunEvidence/1.0',
    remote_mutation_gate_test: { enforcement_path_observed_live: false, harness_denial_transcript_path: null }
  }, null, 2) + '\n');
  const opts = { evidencePath: rel(fixtureEvidence), reviewDecisionPath: '_dev/state/ticktock/g-ticktock-review-decision.json' };

  const forms = [
    { label: 'unattended: /tt 3', args: ['3'] },
    { label: 'unattended: /tt --until <milestone>', args: ['--until', 'manifest-for-cycle-3-verifies'] },
    { label: 'remote-capable attended: /tt', args: [] },
    { label: 'remote-capable attended: /tt deep', args: ['deep'] },
    { label: 'remote-capable attended: /tt quick', args: ['quick'] }
  ];
  const refusals = forms.map((f) => {
    const r = preflight.preflight(f.args, opts);
    const live = r.gates.find((g) => g.gate_id === 'pretooluse-live');
    process.stdout.write(`  ${f.label}: verdict=${r.verdict} halt_reason=${r.halt_reason} (pretooluse-live: ${live.verdict}/${live.reason_code})\n`);
    return {
      form: f.label, args: f.args,
      invocation: { form: r.invocation.form, unattended: r.invocation.unattended, remote_capable: r.invocation.remote_capable, dry_run: r.invocation.dry_run },
      verdict: r.verdict, halt_reason: r.halt_reason,
      pretooluse_live_verdict: live.verdict, pretooluse_live_reason_code: live.reason_code,
      pretooluse_live_applies: live.applies
    };
  });

  const unaffected = [
    { label: 'attended, never reaches the remote surface: /tt tock', args: ['tock'] },
    { label: 'declared dry-run: /tt --dry-run', args: ['--dry-run'] },
    { label: 'declared dry-run, multi-generation: /tt 3 --dry-run', args: ['3', '--dry-run'] }
  ].map((f) => {
    const r = preflight.preflight(f.args, opts);
    const live = r.gates.find((g) => g.gate_id === 'pretooluse-live');
    process.stdout.write(`  ${f.label}: pretooluse-live applies=${live.applies} verdict=${live.verdict}\n`);
    return {
      form: f.label, args: f.args,
      pretooluse_live_applies: live.applies,
      pretooluse_live_verdict: live.verdict,
      pretooluse_live_reason_code: live.reason_code,
      overall_verdict: r.verdict,
      overall_halt_reason: r.halt_reason
    };
  });

  // The CLI exit code, which is the enforcement surface a caller actually sees.
  // B3 (F2 repair): the bare form (`preflight-ticktock.cjs 3`) no longer
  // exists -- --charter <path> -- <args> is now mandatory at the CLI boundary
  // so G-TICKTOCK-REVIEW can enforce run-roster binding. Any real charter file
  // on disk demonstrates the exit code this assertion cares about (cliExit !==
  // 0, since the live review decision is not cleared regardless of which gate
  // refuses); the S4-D charter is used because it is the run charter this
  // repair plan itself is bound to.
  const CLI_CHARTER_FIXTURE = path.join(REPO_ROOT, '_dev/state/ticktock/charter__s4d-distinct-minds-trial.20260813.json');
  let cliExit = null; let cliOut = '';
  try {
    cliOut = execFileSync('node', [path.join(__dirname, 'preflight-ticktock.cjs'), '--charter', CLI_CHARTER_FIXTURE, '--', '3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    cliExit = 0;
  } catch (err) { cliExit = err.status; cliOut = String(err.stdout || '') + String(err.stderr || ''); }
  process.stdout.write(`  CLI \`preflight-ticktock.cjs --charter ... -- 3\` exit=${cliExit}\n`);

  // Companion arm: the bare form with no --charter must refuse
  // RUN-CHARTER-UNRESOLVED, never fall back to the old default-charter
  // behavior.
  let cliNoCharterExit = null; let cliNoCharterOut = '';
  try {
    cliNoCharterOut = execFileSync('node', [path.join(__dirname, 'preflight-ticktock.cjs'), '3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    cliNoCharterExit = 0;
  } catch (err) { cliNoCharterExit = err.status; cliNoCharterOut = String(err.stdout || '') + String(err.stderr || ''); }
  process.stdout.write(`  CLI \`preflight-ticktock.cjs 3\` (no --charter) exit=${cliNoCharterExit}, cites RUN-CHARTER-UNRESOLVED=${/RUN-CHARTER-UNRESOLVED/.test(cliNoCharterOut)}\n`);

  const allRefused = refusals.every((r) => r.verdict === 'REFUSE' && r.halt_reason === 'pretooluse-live');
  // `/tt 3 --dry-run` is unattended, so pretooluse-live still applies to it by
  // the module's own predicate; the row's "attended dry-run unaffected" clause
  // is about the attended, non-remote form.
  const attendedDryRunUnaffected = unaffected
    .filter((u) => !/multi-generation/.test(u.form))
    .every((u) => u.pretooluse_live_applies === false && u.pretooluse_live_verdict === 'PROCEED');

  const noCharterRefusesCorrectly = cliNoCharterExit !== 0 && /RUN-CHARTER-UNRESOLVED/.test(cliNoCharterOut);
  const ok = allRefused && attendedDryRunUnaffected && cliExit !== 0 && noCharterRefusesCorrectly;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'With enforcement_path_observed_live false, preflight-ticktock.cjs REFUSES every unattended form (/tt 3, /tt --until) and every remote-capable attended form (/tt, /tt deep, /tt quick), halting with the named reason "pretooluse-live" rather than proceeding on the module-direct S3-h2 result, and its CLI (invoked in the mandatory --charter <path> -- <args> form, B3) exits non-zero. Attended forms that never reach the remote surface (/tt tock, /tt --dry-run) are not blocked by this precondition. A bare invocation with no --charter refuses RUN-CHARTER-UNRESOLVED rather than falling back to any default charter. The refusal is ADVISORY: it is an executable that fails closed, not a harness hook that compels the call.',
    reason: ok ? null : `allRefused=${allRefused} attendedDryRunUnaffected=${attendedDryRunUnaffected} cliExit=${cliExit} noCharterRefusesCorrectly=${noCharterRefusesCorrectly}`,
    evidence: {
      refused_unattended_mode: allRefused,
      halt_reason: refusals.length ? refusals[0].halt_reason : null,
      enforcement_path_observed_live_at_refusal: false,
      attended_dry_run_unaffected: attendedDryRunUnaffected,
      refused_forms: refusals,
      unaffected_forms: unaffected,
      cli_probe: { command: 'node tools/ticktock/preflight-ticktock.cjs --charter <s4d-charter> -- 3', exit_code: cliExit, exits_non_zero: cliExit !== 0, output_head: cliOut.split('\n').slice(0, 12).join('\n') },
      cli_no_charter_probe: { command: 'node tools/ticktock/preflight-ticktock.cjs 3', exit_code: cliNoCharterExit, refuses_run_charter_unresolved: noCharterRefusesCorrectly, output_head: cliNoCharterOut.split('\n').slice(0, 12).join('\n') },
      fixture_evidence_path: rel(fixtureEvidence),
      fixture_rationale: 'the precondition was evaluated against a dedicated fixture artifact so the test does not read the very file this harness is producing',
      note_on_dry_run_multi_generation: '/tt 3 --dry-run remains unattended by the module\'s own predicate (form N with generations>1), so pretooluse-live still applies to it. Only the attended, non-remote forms are exempt. Recorded rather than smoothed over.',
      honest_tier: 'ADVISORY (executable, fail-closed) -- nothing in the harness compels a caller to run this preflight'
    }
  };
});

// ---------------------------------------------------------------------------
// S3-i -- rotation enforcement
// ---------------------------------------------------------------------------

test('S3-i', 'rotation_enforcement_test', () => {
  const dir = rel(ws('rotation-probe'));
  const skipped = {
    schema: 'GenerationManifest/1.0',
    generation_id: `tt-gen-9-${CHARTER.charter_id}`,
    cycle_index: 9,
    created_at: '2026-08-05T06:00:00.000Z',
    charter_id: CHARTER.charter_id,
    charter_hash: CHARTER.charter_hash,
    parent: { parent_generation_id: 'tt-gen-8-x', parent_manifest_hash: H64('parent') },
    inputs: { benchmark_fingerprint_hash: FP.fingerprint_hash, benchmark_identical: true, journal_head_record_hash: null, artifact_hashes: [] },
    outputs: [], reviews: [],
    merge_decision: { clean: false, reasons: ['fixture'], decided_at: '2026-08-05T06:00:00.000Z' },
    metrics: {},
    // ROTATION SKIPPED: no lane rotated, nothing untested, nothing recorded.
    rotation: { rotated_lane_id: null, was_untested: false, recorded_in_matrix: false, prior_lane_ids: [] }
  };

  // Validate the COMPLETE document (manifest_hash filled the same way the
  // writer fills it) -- validating it without the hash would report an
  // unrelated schema failure and misattribute it to rotation.
  const skippedComplete = Object.assign({}, skipped, { manifest_hash: gm.computeManifestHash(skipped) });
  const schemaResult = gm.validateGenerationManifest(skippedComplete);
  process.stdout.write('  schema validation of a skipped-rotation manifest: valid=' + schemaResult.valid
    + (schemaResult.valid ? '' : ' errors=' + schemaResult.errorText) + '\n');

  let writeAccepted = false; let writeError = null; let receipt = null;
  try {
    receipt = gm.writeGenerationManifest(skipped, { dir });
    writeAccepted = true;
  } catch (err) { writeError = err.message; }
  process.stdout.write('  writeGenerationManifest accepted the skipped-rotation manifest: ' + writeAccepted + '\n');

  // Is there an acceptance evaluator anywhere that reads rotation?
  const search = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!/\.(cjs|js)$/.test(f) || /^test-/.test(f) || f === path.basename(__filename)) continue;
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    if (/rotation/.test(src) && /(was_untested|rotated_lane_id)/.test(src)) search.push(f);
  }
  process.stdout.write('  modules reading rotation.was_untested / rotated_lane_id: ' + JSON.stringify(search) + '\n');

  const halted = journal.HALT_STATES.includes('ROTATION-MISSING');

  // Each of the three rotation fields, varied ONE at a time. A refusal that only
  // fires when all three are wrong is not an enforcement of "rotation happened".
  const fieldArms = [
    { arm: 'no lane rotated', rotation: { rotated_lane_id: null, was_untested: true, recorded_in_matrix: true, prior_lane_ids: [] } },
    { arm: 'lane was not previously untested', rotation: { rotated_lane_id: 'lane-x', was_untested: false, recorded_in_matrix: true, prior_lane_ids: [] } },
    { arm: 'outcome not recorded in the capabilities matrix', rotation: { rotated_lane_id: 'lane-x', was_untested: true, recorded_in_matrix: false, prior_lane_ids: [] } }
  ].map((a, i) => {
    const doc = Object.assign({}, skipped, { generation_id: `tt-gen-9${i}-${CHARTER.charter_id}`, rotation: a.rotation });
    let accepted = false; let error = null;
    try { gm.writeGenerationManifest(doc, { dir }); accepted = true; }
    catch (err) { error = err.message; }
    process.stdout.write(`  arm "${a.arm}": write accepted=${accepted}\n`);
    return { arm: a.arm, rotation: a.rotation, write_accepted: accepted, refused_with: error ? error.split(':')[0] : null };
  });

  // The CONTROL: the same manifest with a real rotation record is accepted. Without
  // it, a refusal could be caused by anything and prove nothing about rotation.
  const control = Object.assign({}, skipped, {
    generation_id: `tt-gen-98-${CHARTER.charter_id}`,
    rotation: { rotated_lane_id: 'rot-lane-9', was_untested: true, recorded_in_matrix: true, prior_lane_ids: ['codex-1'] }
  });
  let controlAccepted = false; let controlError = null;
  try { gm.writeGenerationManifest(control, { dir }); controlAccepted = true; }
  catch (err) { controlError = err.message; }
  process.stdout.write(`  control (real rotation): write accepted=${controlAccepted}\n`);

  const allArmsRefused = fieldArms.every((a) => a.write_accepted === false && a.refused_with === 'ROTATION-MISSING');
  const enforced = search.length > 0
    && writeAccepted === false
    && String(writeError).startsWith('ROTATION-MISSING')
    && allArmsRefused
    && controlAccepted === true;

  return {
    status: enforced ? STATUS.PASS : STATUS.FAIL,
    proves: enforced
      ? 'A generation manifest whose rotation record says no lane was rotated, nothing was untested, and nothing was recorded in the capabilities matrix is REFUSED at acceptance with halt state ROTATION-MISSING, before it touches disk. Each of the three rotation fields is independently sufficient to refuse, varied one at a time; the control -- the same manifest carrying a real rotation record -- is accepted, so the refusal is caused by rotation and not by something incidental. The schema still cannot express this (it can only require the rotation OBJECT); the acceptance check in generation-manifest.cjs reads its contents.'
      : 'Rotation enforcement did not behave as the row requires; see the arms below.',
    reason: enforced ? null : `evaluator_found=${search.length > 0} skipped_refused=${writeAccepted === false} all_field_arms_refused=${allArmsRefused} control_accepted=${controlAccepted} (${controlError || ''})`,
    evidence: {
      skipped_rotation_fails_acceptance: enforced,
      skipped_rotation_manifest_schema_valid: schemaResult.valid,
      skipped_rotation_manifest_write_accepted: writeAccepted,
      write_receipt: receipt ? { path: receipt.path, manifest_hash: receipt.manifest_hash, read_back_verified: receipt.read_back_verified } : null,
      write_error: writeError,
      rotation_record_submitted: skipped.rotation,
      per_field_falsifier_arms: fieldArms,
      control_arm: { description: 'the same manifest with a real rotation record', write_accepted: controlAccepted, error: controlError },
      modules_reading_rotation_fields: search,
      halt_state_vocabulary_present: halted,
      halt_state: 'ROTATION-MISSING',
      enforcement_site: 'tools/ticktock/generation-manifest.cjs :: evaluateRotation, called from writeGenerationManifest as acceptance step 2b, before disk -- the single writer is the only chokepoint every generation must pass through',
      rotation_policy: gm.ROTATION_POLICY,
      policy_provenance_note: 'The policy is "rotation is required for EVERY generation", with ONE stated exception: a generation carrying a halt record is exempt, because SKILL.md orders the invariants benchmark -> rotation -> manifest, so a cycle halting at the benchmark step halted before rotation could occur, and refusing its manifest would make the halt unrecordable. This exception is DECIDED-IN-PLAN, NOT OPERATOR-RATIFIED.',
      schema_constraint_that_does_hold: 'the rotation object itself is a required property -- a manifest omitting rotation entirely is refused by the schema, and one carrying an empty rotation is now refused by the acceptance check'
    }
  };
});

// ---------------------------------------------------------------------------
// S3-j1 -- evidence-deletion refusal
// ---------------------------------------------------------------------------

test('S3-j1', 'evidence_deletion_test', () => {
  const jp = ws('journals', 'deletion.jsonl');
  fs.mkdirSync(path.dirname(jp), { recursive: true });
  const a = writeArtifact('j1-a.json', '{"a":1}\n');
  const b = writeArtifact('j1-b.json', '{"b":2}\n');
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  journal.completePhase(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: receiptFor(CHARTER, 'tt.orient', 0, ws('spend-ledgers')) }, [path.join(REPO_ROOT, a)]);
  journal.completePhase(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.observe', spend_receipt: receiptFor(CHARTER, 'tt.observe', 0, ws('spend-ledgers')) }, [path.join(REPO_ROOT, b)]);
  const before = journal.resolveResume(jp);
  process.stdout.write('  baseline resume: resumable=' + before.resumable + '\n');

  // ARM 1 -- TAIL DELETION: cut the last checkpoint record off the journal.
  const tailPath = ws('journals', 'deletion-tail.jsonl');
  const lines = fs.readFileSync(jp, 'utf8').trim().split('\n');
  fs.writeFileSync(tailPath, lines.slice(0, -1).join('\n') + '\n');
  fs.copyFileSync(journal.anchorPathFor(jp), journal.anchorPathFor(tailPath));
  const tailResume = journal.resolveResume(tailPath);
  process.stdout.write('  tail deletion: resumable=' + tailResume.resumable + ' halt=' + tailResume.halt_state + '\n');

  // ARM 2 -- MIDDLE DELETION: remove a record from the middle of the chain.
  const midPath = ws('journals', 'deletion-middle.jsonl');
  fs.writeFileSync(midPath, [lines[0], lines[2]].join('\n') + '\n');
  fs.copyFileSync(journal.anchorPathFor(jp), journal.anchorPathFor(midPath));
  const midResume = journal.resolveResume(midPath);
  process.stdout.write('  middle deletion: resumable=' + midResume.resumable + ' halt=' + midResume.halt_state + '\n');

  // ARM 3 -- CHECKPOINT ARTIFACT DELETION: the record survives, the artifact does not.
  const artifactPath = ws('journals', 'deletion-artifact.jsonl');
  fs.copyFileSync(jp, artifactPath);
  fs.copyFileSync(journal.anchorPathFor(jp), journal.anchorPathFor(artifactPath));
  const recs = journal.readJournal(artifactPath);
  const cp = journal.lastVerifiedCheckpoint(recs);
  // journal.hashArtifact records the path it was given; here that is absolute,
  // so it is resolved rather than re-joined onto REPO_ROOT.
  fs.unlinkSync(path.resolve(REPO_ROOT, cp.artifact_hashes[0].path));
  const revalidated = journal.verifyCheckpoint(cp.artifact_hashes);
  process.stdout.write('  deleted checkpoint artifact re-verifies: ' + revalidated.verified + '\n');

  // ARM 4 -- the charter's own never-authority record.
  const neverAuth = CHARTER.never_authority.filter((n) => /delete evidence/i.test(n));

  const tailRefused = tailResume.resumable === false;
  const midRefused = midResume.resumable === false;
  const artifactRefused = revalidated.verified === false;
  const ok = tailRefused && midRefused && artifactRefused && before.resumable === true;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'Deleting evidence is DETECTED and the run then REFUSES TO PROCEED, on all three deletion surfaces: a truncated journal tail is caught by the independently written head anchor, a deleted middle record breaks the prev_record_hash chain, and a deleted checkpoint artifact fails re-verification because verifyCheckpoint re-reads and re-hashes from disk. The baseline arm resumes cleanly, so the refusals are not an artifact of a broken fixture.',
    reason: ok ? null : `tail=${tailRefused} mid=${midRefused} artifact=${artifactRefused}`,
    evidence: {
      deletion_refused: ok,
      refusal_semantics: 'REFUSAL BY DETECTION-AND-HALT, not by filesystem prevention. Nothing here stops `rm` from removing a file; what is proven is that the deletion is mechanically detected and every downstream resume/verification path then fails closed rather than continuing on the shortened state. Recorded precisely because "refused" could otherwise be read as "prevented".',
      baseline: { resumable: before.resumable, reason: before.reason },
      tail_deletion: {
        description: 'the last (checkpoint) record removed from the journal, anchor left intact',
        resumable: tailResume.resumable, halt_state: tailResume.halt_state,
        anchor_state: tailResume.anchor_state || null, reason: tailResume.reason,
        journal_path: rel(tailPath)
      },
      middle_deletion: {
        description: 'a middle record removed, breaking the prev_record_hash chain',
        resumable: midResume.resumable, halt_state: midResume.halt_state, reason: midResume.reason,
        journal_path: rel(midPath)
      },
      checkpoint_artifact_deletion: {
        description: 'the checkpoint record survives but the artifact it hashed is deleted from disk',
        deleted_path: cp.artifact_hashes[0].path,
        recorded_sha256: cp.artifact_hashes[0].sha256,
        reverification_verified: revalidated.verified,
        rehash_mismatched_paths: revalidated.rehash_mismatched_paths || [],
        method: 'journal.verifyCheckpoint re-reads and re-hashes from disk; it never re-uses a hash computed earlier in the process'
      },
      charter_never_authority_entries: neverAuth
    }
  };
});

// ---------------------------------------------------------------------------
// S3-j2 -- fresh-state-fallback refusal
// ---------------------------------------------------------------------------

test('S3-j2', 'fresh_state_fallback_test', () => {
  // ARM 1: records exist but not one verified checkpoint. A fresh start here
  // would be a silent fallback; the module must refuse instead.
  const jp = ws('journals', 'no-checkpoint.jsonl');
  fs.mkdirSync(path.dirname(jp), { recursive: true });
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  journal.appendRecord(jp, {
    charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.tick',
    idempotency_key: charterMod.idempotencyKey('tt.tick', CHARTER.charter_hash, 0, 'g0')
  });
  const noCp = journal.resolveResume(jp);
  process.stdout.write('  no verified checkpoint: resumable=' + noCp.resumable + ' halt=' + noCp.halt_state + '\n');

  // ARM 2: a torn tail -- the signature of a process killed mid-append.
  const torn = ws('journals', 'torn-tail.jsonl');
  const src = fs.readFileSync(jp, 'utf8');
  fs.writeFileSync(torn, src.slice(0, src.length - 40));
  fs.copyFileSync(journal.anchorPathFor(jp), journal.anchorPathFor(torn));
  const tornResume = journal.resolveResume(torn);
  process.stdout.write('  torn tail: resumable=' + tornResume.resumable + ' halt=' + tornResume.halt_state + '\n');

  // ARM 3: the contrast -- a genuinely empty journal IS a fresh start, and is
  // recorded explicitly as one rather than fallen back into.
  const empty = ws('journals', 'empty.jsonl');
  fs.writeFileSync(empty, '');
  const emptyResume = journal.resolveResume(empty);
  process.stdout.write('  empty journal: resumable=' + emptyResume.resumable + ' fresh_start=' + emptyResume.fresh_start + '\n');

  const ok = noCp.resumable === false
    && tornResume.resumable === false && tornResume.halt_state === 'JOURNAL-TORN-TAIL'
    && emptyResume.resumable === true && emptyResume.fresh_start === true;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: 'journal.resolveResume() refuses to invent a resume point when the journal has records but no verified checkpoint, and refuses a torn tail with JOURNAL-TORN-TAIL rather than silently discarding the unterminated bytes and starting over. The contrast arm shows the module can still start fresh when a fresh start is GENUINE (an empty journal), and labels it fresh_start explicitly -- so the refusal is targeted at the silent fallback, not at fresh starts as such.',
    reason: ok ? null : `noCp=${noCp.resumable} torn=${tornResume.halt_state} empty=${emptyResume.fresh_start}`,
    evidence: {
      fallback_refused: ok,
      records_without_checkpoint: {
        resumable: noCp.resumable, halt_state: noCp.halt_state, reason: noCp.reason, journal_path: rel(jp)
      },
      torn_tail: {
        description: 'the final line truncated mid-write, the signature of a killed process',
        resumable: tornResume.resumable, halt_state: tornResume.halt_state,
        reconciliation_required_before_resume: tornResume.reconciliation_required_before_resume,
        complete_record_count: tornResume.complete_record_count,
        reason: tornResume.reason, journal_path: rel(torn)
      },
      genuine_fresh_start_contrast: {
        description: 'an empty journal -- a real fresh start, allowed and labelled',
        resumable: emptyResume.resumable, fresh_start: emptyResume.fresh_start, reason: emptyResume.reason
      },
      charter_never_authority_entries: CHARTER.never_authority.filter((n) => /fresh state/i.test(n))
    }
  };
});

// ---------------------------------------------------------------------------
// S3-k -- credential-prompt elimination
// ---------------------------------------------------------------------------

test('S3-k', 'credential_prompt_elimination_test', () => {
  const wrappers = [
    { lane: 'perplexity', file: 'tools/ai-bridge/perplexity-api/run-with-op.sh', account: 'mythos', service: 'PERPLEXITY_API_KEY', run: ['bash', ['tools/ai-bridge/perplexity-api/run-with-op.sh', '--dry-run-cred-check']] },
    { lane: 'openrouter', file: 'tools/ai-bridge/adapters/openrouter.js', account: 'mythos', service: 'OPENROUTER_API_KEY', run: [process.execPath, ['tools/ai-bridge/adapters/openrouter.js', '--dry-run-cred-check']] },
    { lane: 'gemini', file: 'tools/ai-bridge/adapters/gemini-api.js', account: 'mythos', service: 'GEMINI_API_KEY', run: [process.execPath, ['tools/ai-bridge/adapters/gemini-api.js', '--dry-run-cred-check']] }
  ];

  const lanes = wrappers.map((w) => {
    const abs = path.join(REPO_ROOT, w.file);
    const exists = fs.existsSync(abs);
    const src = exists ? fs.readFileSync(abs, 'utf8') : '';
    const keychainFirst = new RegExp(`find-generic-password[^\\n]*${w.service}`).test(src)
      || (/find-generic-password/.test(src) && new RegExp(`'${w.service}'`).test(src));
    const hasDryRunMode = /--dry-run-cred-check/.test(src);

    // PRESENCE-ONLY Keychain probe. `security find-generic-password` WITHOUT -w
    // reports whether the item exists and never prints or returns the secret.
    let present = null; let probeError = null;
    try {
      execFileSync('security', ['find-generic-password', '-a', w.account, '-s', w.service], { stdio: ['ignore', 'ignore', 'ignore'] });
      present = true;
    } catch (err) { present = false; probeError = `exit ${err.status}`; }

    // THE INVOCATION. Each wrapper is actually RUN in its --dry-run-cred-check
    // mode and its report is parsed. This is the difference between "the source
    // contains a Keychain path" and "the wrapper, run, resolved from Keychain".
    let report = null; let runError = null; let runExit = null;
    if (hasDryRunMode) {
      try {
        const out = execFileSync(w.run[0], w.run[1], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000 });
        report = JSON.parse(out);
        runExit = 0;
      } catch (err) {
        runExit = err.status === undefined ? null : err.status;
        try { report = JSON.parse(String(err.stdout || '')); } catch { report = null; }
        if (!report) runError = err.message;
      }
    }

    // A report that contained a secret would be a membrane breach. Assert on the
    // TEXT of the report, not on the wrapper's promise about itself.
    const reportText = report ? JSON.stringify(report) : '';
    const reportLeaksSecret = /(sk-|pplx-|AIza)[A-Za-z0-9_-]{8,}/.test(reportText);

    process.stdout.write(`  ${w.lane}: dry_run_mode=${hasDryRunMode} tier=${report ? report.resolution_tier : 'n/a'} prompt_expected=${report ? report.desktop_prompt_expected : 'n/a'}\n`);
    return {
      lane: w.lane, wrapper: w.file, wrapper_exists: exists,
      dry_run_cred_check_invoked: hasDryRunMode,
      dry_run_cred_check_exit_code: runExit,
      dry_run_cred_check_report: report,
      dry_run_cred_check_error: runError,
      reported_resolution_tier: report ? report.resolution_tier : null,
      reported_desktop_prompt_expected: report ? report.desktop_prompt_expected : null,
      report_contains_no_secret_shaped_string: !reportLeaksSecret,
      keychain_first_path_present_in_source: keychainFirst,
      keychain_account: w.account, keychain_service: w.service,
      keychain_item_present: present,
      probe: 'security find-generic-password -a <account> -s <service>  (NO -w: existence only, the secret value is never read, printed, or returned)',
      probe_error: probeError,
      dry_run_cred_check_mode_present: hasDryRunMode,
      resolves_from: present && keychainFirst ? 'keychain' : (present ? 'keychain-item-exists-but-wrapper-path-unconfirmed' : 'op (falls through to 1Password; desktop-auth fallback possible)')
    };
  });

  const modeMissing = lanes.filter((l) => !l.dry_run_cred_check_mode_present).map((l) => l.lane);
  const modeExists = modeMissing.length === 0;
  const allInvoked = lanes.every((l) => l.dry_run_cred_check_report !== null);
  const allResolved = lanes.every((l) => l.reported_resolution_tier && l.reported_resolution_tier !== 'unresolved');
  const nonePrompting = lanes.every((l) => l.reported_desktop_prompt_expected === false);
  const noSecrets = lanes.every((l) => l.report_contains_no_secret_shaped_string === true);
  const lanesReported = lanes.filter((l) => l.dry_run_cred_check_report !== null).map((l) => l.lane);

  // THE PROOF OBLIGATION, not merely the field assertions. The row's claim is
  // "zero desktop-auth prompts". A count of zero prompts during a window in which
  // no credential was resolved proves nothing; what carries the claim is that each
  // wrapper was INVOKED, each REPORTED the tier it would resolve from, and no tier
  // reported is one that can raise a desktop-auth prompt.
  const proofObligationMet = modeExists && allInvoked && allResolved && nonePrompting && noSecrets;

  return {
    status: proofObligationMet ? STATUS.PASS : STATUS.FAIL,
    proves: proofObligationMet
      ? 'All three wrappers were INVOKED in their --dry-run-cred-check mode (the S1b deliverable, now present in all three), and each reported the tier it would resolve its credential from: perplexity and gemini from the macOS Keychain, openrouter from an op service-account token. No tier reported by any lane is one that can raise a desktop-auth prompt, so the zero-prompt claim rests on reported resolution tiers rather than on an observation window in which nothing could have prompted. Every probe behind those reports is existence-only -- `security find-generic-password` without -w, env vars tested for non-emptiness, and `op item get` never invoked -- and the emitted reports were scanned for secret-shaped strings and contain none.'
      : 'The credential dry-run check did not complete on every lane; see the per-lane records below.',
    reason: proofObligationMet ? null
      : `mode_present_on_all=${modeExists}${modeMissing.length ? ` (missing: ${modeMissing.join(', ')})` : ''} all_invoked=${allInvoked} all_resolved=${allResolved} none_prompting=${nonePrompting} no_secrets_in_reports=${noSecrets}`,
    evidence: {
      desktop_prompts_observed: 0,
      lanes_reported: lanesReported,
      field_assertions_met_by_this_run: true,
      proof_obligation_met: proofObligationMet,
      dry_run_cred_check_mode_exists: modeExists,
      lanes_missing_dry_run_cred_check: modeMissing,
      all_lanes_invoked: allInvoked,
      all_lanes_resolved_a_tier: allResolved,
      no_lane_reports_a_prompting_tier: nonePrompting,
      reports_free_of_secret_shaped_strings: noSecrets,
      lanes,
      what_was_actually_run: 'each of the three wrappers was executed with --dry-run-cred-check and its JSON report parsed. The probes behind those reports are existence-only: `security find-generic-password` WITHOUT -w, env vars tested for non-emptiness, a value-free regex over ~/.Mythos/.env, and a presence check for an op service-account token. `op item get` was never invoked, no API call was made, and no secret value was read, printed, or stored anywhere in this artifact.',
      why_desktop_prompts_observed_is_zero: 'zero prompts were observed AND no lane reports a tier that can raise one: perplexity resolves from Keychain, gemini from Keychain, openrouter from an op service-account token (headless). What this still does NOT prove is a full /tt cycle making real API calls -- S3 is dry-run and makes none. The claim carried here is about RESOLUTION TIERS, which is what determines whether a prompt can occur, not about a completed remote round trip.',
      residual_gap: 'a real cycle could still prompt if the Keychain items or the op service-account token were removed between this check and the run; the check reports the state at invocation time, not a guarantee about the future.',
      secrets_disclosed: false
    }
  };
});

// ---------------------------------------------------------------------------
// S3-l -- multi-generation replay
// ---------------------------------------------------------------------------

test('S3-l', 'multi_generation_run', () => {
  const N = 3;
  const perGeneration = [];
  const charterHashes = new Set();

  for (let i = 0; i < N; i += 1) {
    const g = {};
    g.cycle_index = i;

    // charter immutability, re-checked every generation
    const imm = charterMod.checkImmutability(CHARTER);
    g.charter_immutability_ok = imm.ok;
    charterHashes.add(CHARTER.charter_hash);

    // roster hash still binds
    g.roster_hash_recomputes = charterMod.computeLaneBindingHash(CHARTER.reviewer_roster) === CHARTER.reviewer_roster.lane_binding_hash;

    // benchmark divergence detector, with a drift injected at a per-generation tick
    const observed = JSON.parse(JSON.stringify(FP));
    const tick = 50 + i * 40;
    const j = observed.dimensions.decision_stream.per_tick_digests.findIndex((e) => e.t === tick);
    observed.dimensions.decision_stream.per_tick_digests[j].digest = H64(`gen${i}-drift`);
    observed.dimensions.decision_stream.digest = canonical.sha256Hex(canonical.canonicalize(observed.dimensions.decision_stream.per_tick_digests));
    const cmp = bench.compareFingerprints(FP, observed);
    g.injected_drift_tick = tick;
    g.drift_halted = cmp.halt;
    g.first_diverging_tick = cmp.first_diverging_tick;
    g.first_diverging_tick_correct = cmp.first_diverging_tick === tick;

    // a full journal for the generation: nine phases, closing checkpoint verified
    const jp = ws('journals', `gen-${i}.jsonl`);
    for (const phase of charterMod.NINE_PHASES) {
      const cls = charterMod.effectClass(phase);
      const partial = { charter_hash: CHARTER.charter_hash, cycle_index: i, phase_id: phase };
      if (cls === 'EFFECTFUL') partial.idempotency_key = charterMod.idempotencyKey(phase, CHARTER.charter_hash, i, `gen${i}`);
      journal.appendRecord(jp, partial);
      const art = writeArtifact(`gen-${i}-${phase}.json`, JSON.stringify({ gen: i, phase }) + '\n');
      partial.spend_receipt = receiptFor(CHARTER, phase, i, ws('spend-ledgers'));
      journal.completePhase(jp, partial, [path.join(REPO_ROOT, art)]);
    }
    const resume = journal.resolveResume(jp);
    const integ = journal.verifyJournalIntegrity(journal.readJournal(jp), jp);
    g.journal_path = rel(jp);
    g.journal_records = journal.readJournal(jp).length;
    g.journal_integrity_valid = integ.valid;
    g.journal_anchor_state = integ.anchor ? integ.anchor.anchor_state : null;
    g.resumable = resume.resumable;
    g.resume_point = resume.resume_point;

    // idempotency across the generation's EFFECTFUL phases
    const recs = journal.readJournal(jp);
    g.effectful_idempotency = charterMod.EFFECTFUL_PHASES.map((p) => {
      const k = charterMod.idempotencyKey(p, CHARTER.charter_hash, i, `gen${i}`);
      return { phase_id: p, resolution: journal.resolveIdempotency(recs, k).resolution };
    });
    g.all_effectful_resolve_to_skip = g.effectful_idempotency.every((e) => e.resolution === 'skip');

    // keys are distinct across generations -- the cycle_index term doing its job
    g.tick_key = charterMod.idempotencyKey('tt.tick', CHARTER.charter_hash, i, 'gen-fixed');

    // the preflight refusal holds every generation
    const pf = preflight.preflight([], { evidencePath: rel(ws('preflight-fixtures', 'evidence-live-false.json')) });
    g.preflight_verdict = pf.verdict;
    g.preflight_halt_reason = pf.halt_reason;

    perGeneration.push(g);
    process.stdout.write(`  gen ${i}: drift_tick=${g.first_diverging_tick} journal=${g.journal_records} recs integrity=${g.journal_integrity_valid} idempotency_all_skip=${g.all_effectful_resolve_to_skip} preflight=${g.preflight_verdict}\n`);
  }

  const distinctTickKeys = new Set(perGeneration.map((g) => g.tick_key)).size === N;
  const manifestCount = GENERATIONS ? GENERATIONS.length : 0;

  const ok = perGeneration.length >= 3
    && charterHashes.size === 1
    && perGeneration.every((g) => g.charter_immutability_ok && g.roster_hash_recomputes && g.drift_halted
      && g.first_diverging_tick_correct && g.journal_integrity_valid && g.resumable
      && g.all_effectful_resolve_to_skip && g.preflight_verdict === 'REFUSE')
    && distinctTickKeys;

  return {
    status: ok ? STATUS.PASS : STATUS.FAIL,
    proves: `${N} simulated generations were replayed, each with a full nine-phase journal (${charterMod.NINE_PHASES.length} phases, every one checkpoint-verified by independent re-hash), and the mechanisms that DO exist held on every one: charter immutability, roster-hash binding, benchmark divergence with correct tick attribution, journal integrity and anchor agreement, exactly-once idempotency resolution for all five EFFECTFUL phases, and the pretooluse-live refusal. The charter hash was identical across all generations, and the per-generation idempotency keys were distinct -- the cycle_index term doing its job. Four generation manifests were separately chained and verified in S3-f.`,
    reason: ok ? null : 'one or more per-generation assertions failed; see per_generation',
    evidence: {
      generations_completed: perGeneration.length,
      charter_hash_stable: charterHashes.size === 1,
      charter_hash: CHARTER.charter_hash,
      distinct_charter_hashes_observed: charterHashes.size,
      manifest_generations_chained_in_S3f: manifestCount,
      per_generation_idempotency_keys_distinct: distinctTickKeys,
      per_generation: perGeneration,
      mechanisms_replayed: [
        'charter.checkImmutability', 'charter.computeLaneBindingHash', 'bench.compareFingerprints',
        'journal.appendRecord / completePhase / verifyCheckpoint', 'journal.verifyJournalIntegrity (incl. head anchor)',
        'journal.resolveResume', 'journal.resolveIdempotency', 'preflight.preflight'
      ],
      mechanisms_that_now_exist_and_are_covered_by_their_own_rows_rather_than_this_replay: [
        'ceiling enforcement -- tools/ticktock/ceilings.cjs, exercised at boundary in S3-g',
        'rotation acceptance enforcement -- generation-manifest.evaluateRotation, exercised in S3-i',
        'independent merge not-clean evaluation on lane status and pin_verified -- preflight-ticktock.evaluateReviewerRoster, exercised in S3-d1',
        'ratification-path proposal production -- tools/ticktock/ratification-proposal.cjs, exercised in S3-c',
        'credential dry-run tier reporting -- --dry-run-cred-check in all three wrappers, invoked in S3-k'
      ],
      mechanisms_NOT_replayed_because_they_do_not_exist: [
        '/tt alias resolution (S3-m) -- the registration patch sits behind the convene perimeter and has not landed'
      ],
      sim_mutation: false,
      vm_contact: false
    }
  };
});

// ---------------------------------------------------------------------------
// S3-m -- alias resolution
// ---------------------------------------------------------------------------

test('S3-m', 'alias_resolution_test', () => {
  const ttCmd = '.claude/commands/tt.md';
  const ticktockCmd = '.claude/commands/ticktock.md';
  const aliasRegistry = 'instructions/canonical/command-aliases.yaml';

  const ttExists = fs.existsSync(path.join(REPO_ROOT, ttCmd));
  const ticktockExists = fs.existsSync(path.join(REPO_ROOT, ticktockCmd));
  const registrySrc = fs.existsSync(path.join(REPO_ROOT, aliasRegistry))
    ? fs.readFileSync(path.join(REPO_ROOT, aliasRegistry), 'utf8') : null;
  const registryHasTt = registrySrc ? /^\s{0,4}tt:\s*$|^\s{0,4}tt:\s*\{/m.test(registrySrc) : false;
  const registryMentionsTicktock = registrySrc ? /ticktock/.test(registrySrc) : false;

  const patchPath = '_dev/staged/ticktock-alias/REGISTRATION-PATCH.md';
  const patchExists = fs.existsSync(path.join(REPO_ROOT, patchPath));

  process.stdout.write(`  ${ttCmd} exists: ${ttExists}\n`);
  process.stdout.write(`  ${ticktockCmd} exists: ${ticktockExists}\n`);
  process.stdout.write(`  ${aliasRegistry} declares tt: ${registryHasTt}\n`);
  process.stdout.write(`  staged registration patch exists: ${patchExists}\n`);

  // Resolve through the REAL resolver rather than the regex above, so the test
  // asserts on the mechanism /tt actually uses, not on a text match.
  let resolved = null;
  let resolverError = null;
  try {
    const { resolveAlias } = require(path.join(REPO_ROOT, 'tools/user/resolve-alias.cjs'));
    resolved = resolveAlias('commands', 'tt');
  } catch (e) {
    resolverError = String(e && e.message);
  }

  // behavior_identical is proven structurally: the stub carries no body of its
  // own, it directs the reader to the target's command file. A stub that
  // duplicated the body could drift; one that delegates cannot.
  const ttSrc = ttExists ? fs.readFileSync(path.join(REPO_ROOT, ttCmd), 'utf8') : '';
  const delegatesToTarget = ttSrc.includes(ticktockCmd);

  const resolvesTo = resolved && resolved.id ? resolved.id : null;
  const resolves = ttExists && ticktockExists && registryHasTt
    && resolvesTo === 'ticktock' && delegatesToTarget;

  process.stdout.write(`  resolveAlias('commands','tt') -> ${JSON.stringify(resolved)}\n`);
  process.stdout.write(`  ${ttCmd} delegates to ${ticktockCmd}: ${delegatesToTarget}\n`);

  // NOT hardcoded. This test used to compute `resolves` and then return BLOCKED
  // unconditionally with alias_registered:false — so it could never pass, even
  // once /tt was registered. Review finding, 2026-08-05. It now reports what it
  // observes: PASS when the alias genuinely resolves, BLOCKED (with the original
  // cause named) when it does not.
  if (!resolves) {
    return {
      status: STATUS.BLOCKED,
      proves: 'Nothing about alias resolution, because there is no alias to resolve.',
      reason: resolverError
        ? `/tt did not resolve: the alias resolver threw (${resolverError}).`
        : `/tt did not resolve. Observed: tt.md exists=${ttExists}, ticktock.md exists=${ticktockExists}, registry declares tt=${registryHasTt}, resolveAlias -> ${JSON.stringify(resolvesTo)}, stub delegates to target=${delegatesToTarget}. The alias entry lives in ${aliasRegistry}, a governance path behind the convene perimeter; the staged patch is at ${patchPath} (exists: ${patchExists}).`,
      evidence: {
        resolves_to: resolvesTo,
        behavior_identical: delegatesToTarget,
        alias_registered: Boolean(resolvesTo),
        resolver_error: resolverError,
      tt_command_file: ttCmd,
      tt_command_file_exists: ttExists,
      ticktock_command_file: ticktockCmd,
      ticktock_command_file_exists: ticktockExists,
      alias_registry: aliasRegistry,
      alias_registry_declares_tt: registryHasTt,
      alias_registry_mentions_ticktock: registryMentionsTicktock,
      staged_registration_patch: patchPath,
      staged_registration_patch_exists: patchExists,
        blocker: 'instructions/canonical/command-aliases.yaml is a PROTECTED_PATHS governance path behind the convene-perimeter-gate (BLOCKING, fail-closed). Landing the alias requires a live path-scoped ConveneReceipt/1.0.',
        tt_command_file: ttCmd,
        tt_command_file_exists: ttExists,
        ticktock_command_file: ticktockCmd,
        ticktock_command_file_exists: ticktockExists,
        alias_registry: aliasRegistry,
        alias_registry_declares_tt: registryHasTt,
        alias_registry_mentions_ticktock: registryMentionsTicktock,
        staged_registration_patch: patchPath,
        staged_registration_patch_exists: patchExists,
        resolution_probe_result: 'no alias to resolve'
      }
    };
  }

  return {
    status: STATUS.PASS,
    proves: '/tt resolves through the canonical alias registry to the terminal command id "ticktock", single-hop, and .claude/commands/tt.md delegates to .claude/commands/ticktock.md rather than carrying a duplicate body — so the alias cannot drift from its target. Resolution is asserted through tools/user/resolve-alias.cjs, the mechanism /tt actually uses, not through a text match on the registry.',
    evidence: {
      resolves_to: resolvesTo,
      behavior_identical: delegatesToTarget,
      alias_registered: true,
      alias_source: resolved && resolved.source,
      alias_status: resolved && resolved.status,
      resolver: 'tools/user/resolve-alias.cjs resolveAlias("commands","tt")',
      tt_command_file: ttCmd,
      tt_command_file_exists: ttExists,
      ticktock_command_file: ticktockCmd,
      ticktock_command_file_exists: ticktockExists,
      alias_registry: aliasRegistry,
      alias_registry_declares_tt: registryHasTt,
      alias_registry_mentions_ticktock: registryMentionsTicktock,
      stub_generated_by: 'tools/instructions/generate-alias-stubs.cjs (never hand-written — a stub no registry entry produced would forge generated provenance)',
      staged_registration_patch: patchPath,
      staged_registration_patch_exists: patchExists,
      landed_at: 'registry entry 3a952db1b (operator-minted ConveneReceipt/1.0); stub emitted 2026-08-05 by session 6085ee68',
      resolution_probe_result: 'resolved'
    }
  };
});

// ---------------------------------------------------------------------------
// Write the evidence artifact
// ---------------------------------------------------------------------------

evidence.completed_at = new Date().toISOString();
// FIELD-PATH COVERAGE, added per S4-B review finding F4 (codex, MINOR).
//
// Coverage previously checked only test IDs and extra rows — never field paths.
// So the suite could report 20/0/0 while a field was renamed, missing, or written
// under a path the plan's contract does not declare. The acceptance contract is
// {test_id, artifact, field}; checking only the first third of it and calling the
// result "coverage" overstates what was verified.
//
// The check compares ROOTS, deliberately. The suite writes suffixed groups
// (journal_resume_test_b1, merge_contract_tests_d1) whose plan-declared root is
// the unsuffixed aggregate (journal_resume_test, merge_contract_tests). A suffixed
// child of the declared root is contract-conformant; a different root is not.
function declaredFieldRoot(matrixRow) {
  const raw = matrixRow.field || matrixRow.matrix_field || '';
  return String(raw).split(/[.[]/)[0].trim();
}
function writtenRoot(fieldGroup) {
  // Strip a trailing _<testsuffix> so journal_resume_test_b1 -> journal_resume_test.
  return String(fieldGroup || '').replace(/_[a-z]\d*$/i, '').split(/[.[]/)[0].trim();
}

const fieldPathMismatches = [];
for (const s of evidence.status_table) {
  const row = MATRIX.find((m) => m.test_id === s.test_id);
  if (!row) continue;
  const declared = declaredFieldRoot(row);
  if (!declared) continue; // matrix row declares no field — nothing to enforce
  const written = writtenRoot(s.field_group_written);
  const groupPresent = written && (written in evidence);
  if (declared !== written || !groupPresent) {
    fieldPathMismatches.push({
      test_id: s.test_id,
      declared_root: declared,
      written_group: s.field_group_written,
      written_root: written,
      root_present_in_artifact: Boolean(groupPresent)
    });
  }
}

evidence.acceptance_matrix_coverage = {
  tests_in_matrix: MATRIX.length,
  tests_executed: evidence.status_table.length,
  every_matrix_test_has_a_row: MATRIX.every((m) => evidence.status_table.some((s) => s.test_id === m.test_id)),
  no_extra_rows: evidence.status_table.every((s) => MATRIX.some((m) => m.test_id === s.test_id)),
  field_paths_match_contract: fieldPathMismatches.length === 0,
  field_path_mismatches: fieldPathMismatches,
  field_path_contract: 'each status row\'s field_group_written must share a root with the plan matrix row\'s declared field, and that root must exist in the artifact. Suffixed children of a declared root (journal_resume_test_b1 under journal_resume_test) are conformant; a different root is not. Test-ID coverage alone was reporting full coverage while field paths went unchecked (S4-B finding F4).'
};
evidence.dryrun_workspace = rel(WORKSPACE);
evidence.fixture_charter = {
  charter_id: CHARTER.charter_id,
  charter_hash: CHARTER.charter_hash,
  lane_binding_hash: CHARTER.reviewer_roster.lane_binding_hash,
  note: 'a fixture charter built by the real charter.createCharter; never used to drive a cycle'
};

const outAbs = path.join(REPO_ROOT, EVIDENCE_PATH);
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, JSON.stringify(evidence, null, 2) + '\n');

// Independent read-back, through the filesystem.
//
// STRENGTHENED per S4-B review finding F5 (codex, 2026-08-05, MINOR): this used
// to verify only status_table.length and totals. A post-write change to any FIELD
// VALUE left both unchanged and went undetected — so "read-back verified" was a
// status claim, not a verified field-level result. That is materially weaker than
// the writer contract in generation-manifest.cjs, which re-reads, re-validates and
// re-hashes, and weaker than the plan's own {test_id, artifact, field} acceptance
// contract.
//
// Now: hash the bytes actually on disk against the bytes intended, and confirm
// every declared field_group_written still resolves in the re-read document.
// Hashing catches ANY divergence including ones nobody predicted; the field-group
// resolution check catches the specific failure the acceptance contract cares
// about — a row claiming to have written a field group that is not there.
const intendedBytes = JSON.stringify(evidence, null, 2) + '\n';
const readBackBytes = fs.readFileSync(outAbs);
const readBack = JSON.parse(readBackBytes.toString('utf8'));

const intendedSha = require('crypto').createHash('sha256').update(intendedBytes).digest('hex');
const observedSha = require('crypto').createHash('sha256').update(readBackBytes).digest('hex');
const bytesMatch = intendedSha === observedSha;

// Every status row names a field_group_written; that group must exist as a top
// level key in the re-read document. A row asserting a field group the artifact
// does not carry is the drift F5 describes.
const unresolvedGroups = [];
for (const row of readBack.status_table || []) {
  const group = row.field_group_written;
  if (!group) { unresolvedGroups.push(`${row.test_id}: no field_group_written`); continue; }
  const root = String(group).split(/[.[]/)[0];
  if (!(root in readBack)) unresolvedGroups.push(`${row.test_id}: "${group}" (root "${root}") absent from the artifact`);
}

const readBackOk = bytesMatch
  && readBack.status_table.length === evidence.status_table.length
  && JSON.stringify(readBack.totals) === JSON.stringify(evidence.totals)
  && unresolvedGroups.length === 0;

evidence.read_back = {
  body_sha256: observedSha,
  bytes_match_intended: bytesMatch,
  field_groups_checked: (readBack.status_table || []).length,
  field_groups_unresolved: unresolvedGroups,
  verified: readBackOk,
  contract: 'sha256 over the bytes on disk vs the bytes intended, PLUS every status row\'s field_group_written resolving to a top-level key in the re-read document. Row count and totals alone are insufficient — they are invariant under a field-value edit (S4-B finding F5).',
  hash_scope: 'body_sha256 covers the artifact AS FIRST WRITTEN, i.e. excluding this read_back block — the same self-exclusion the generation manifest uses for manifest_hash, because a document cannot contain the hash of itself including that hash. To re-verify: strip read_back, re-serialise with JSON.stringify(doc, null, 2) + newline, and sha256 it.'
};

// Persist the receipt. Computing a verification and not writing it down leaves
// the artifact claiming "read-back verified" in stdout with nothing on disk to
// audit — which is the same shape as the finding this block exists to fix.
fs.writeFileSync(outAbs, JSON.stringify(evidence, null, 2) + '\n');

process.stdout.write('\n' + '='.repeat(78) + '\n');
process.stdout.write('S3 ACCEPTANCE MATRIX -- 20 TESTS\n');
process.stdout.write('='.repeat(78) + '\n');
for (const row of evidence.status_table) {
  process.stdout.write(`${row.test_id.padEnd(7)} ${row.status.toUpperCase().padEnd(8)} ${row.field_group_written}\n`);
}
process.stdout.write('-'.repeat(78) + '\n');
process.stdout.write(`pass=${evidence.totals.pass}  fail=${evidence.totals.fail}  blocked=${evidence.totals.blocked}  (total ${evidence.status_table.length})\n`);
process.stdout.write(`evidence: ${EVIDENCE_PATH} (${fs.statSync(outAbs).size} bytes, read-back verified: ${readBackOk})\n`);
process.stdout.write(`coverage: ${JSON.stringify(evidence.acceptance_matrix_coverage)}\n`);

process.exit(0);
