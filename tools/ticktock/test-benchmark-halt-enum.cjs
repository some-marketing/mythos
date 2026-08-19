#!/usr/bin/env node
'use strict';

// tools/ticktock/test-benchmark-halt-enum.cjs -- T2 regression test (plan
// sim-foundation-repairs, S2) + T4 assertion home (plan S4).
//
// THE DEFECT (T2): cycle-driver.cjs's `benchmark` subcommand can legitimately
// emit halt_state LINEAGE-CHAIN-BROKEN (lineage safety record unreadable or
// chain broken) and BENCHMARK-ERROR (bench.check threw), but neither was in
// the journal schema's closed halt_state enum nor in journal.cjs's HALT_STATES,
// so the moment the coordinator tried to JOURNAL the halt -- the whole point
// of a halt -- appendRecord threw "unknown halt_state" and the halt could not
// be recorded. A halt that cannot be journaled is not a halt a run can
// recover from or be audited on; it is a crash.
//
// Every assertion below drives the halt through the REAL emitter (the
// cycle-driver `benchmark` subcommand, spawned as a child process like
// test-cycle-driver-halts.cjs does) and then journals the emitted halt_state
// through the real appendRecord, so it fails on HEAD for the exact reason the
// defect exists: appendRecord refuses the unknown halt_state.
//
// Run: node tools/ticktock/test-benchmark-halt-enum.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const charterMod = require('./charter.cjs');
const journal = require('./journal.cjs');

const DRIVER = path.join(__dirname, 'cycle-driver.cjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MINIMAL_TEMPLATE = path.join(__dirname, '__fixtures__', 'charter-template-test-minimal.json');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${detail === undefined ? '' : JSON.stringify(detail)}\n`);
  }
}
function section(title) { process.stdout.write(`\n${title}\n`); }

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return p;
}

function runDriver(args) {
  try {
    const out = execFileSync('node', [DRIVER, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT });
    return { status: 0, stdout: out };
  } catch (err) {
    return { status: err.status === undefined ? null : err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-bench-halt-enum-'));

// The minimal-charter fixture (same shape as test-cycle-driver-halts.cjs):
// small enough for the benchmark subcommand to run without tripping T1
// template floors, bound against the module-level-only minimal template.
function fixtureCharter(id, benchmarkOverrides) {
  return charterMod.createCharter({
    charter_id: id,
    created_at: '2026-08-11T06:00:00.000Z',
    target: { description: 'benchmark-halt-enum fixture', repo_root: REPO_ROOT, subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
    allowed_write_surfaces: ['tools/ticktock/**'],
    max_cumulative_diff: { lines_changed: 5, files_changed: 2 },
    max_external_actions: 1,
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-11T06:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-11T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-11T06:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: { until_kind: 'cycle_ceiling', halt_conditions: ['LINEAGE-CHAIN-BROKEN', 'BENCHMARK-ERROR'] },
    benchmark: {
      colony_spec_path: 'tools/ticktock/benchmark-colony-v1.json',
      colony_spec_version: 'v1',
      fingerprint_path: '_dev/state/ticktock/benchmark-fingerprint-v1.json',
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 },
      ...benchmarkOverrides
    }
  }, { templatePath: MINIMAL_TEMPLATE });
}

// The journaling call the coordinator makes after the benchmark subcommand
// reports a halt: a bare appendRecord (completed stays null -- a structurally
// incomplete halt needs no spend receipt) carrying the emitted halt_state.
function journalHalt(journalPath, charter, cycleIndex, haltState) {
  return journal.appendRecord(journalPath, {
    charter_hash: charter.charter_hash,
    cycle_index: cycleIndex,
    phase_id: 'tt.tock',
    halt_state: haltState
  });
}

// ---------------------------------------------------------------------------
section('1. LINEAGE-CHAIN-BROKEN: the real emitter halts, and the halt is journalable + TERMINAL');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'lineage-'));
  const fingerprintPath = path.join(dir, 'fingerprint.json');
  // A lineage that is NOT an array is the unreadable-safety-record shape the
  // subcommand's explicit type guard exists for (C-F4b, S2): verifyLineageChain
  // would vacuously pass on an object, so the guard halts loudly instead.
  writeJson(fingerprintPath, {
    schema: 'BenchmarkFingerprint/1.0',
    lineage: { not: 'an array' }
  });

  const charter = fixtureCharter('bench-halt-lineage', {
    fingerprint_path: fingerprintPath
  });
  const charterPath = writeJson(path.join(dir, 'charter.json'), charter);
  const outPath = path.join(dir, 'benchmark-out.json');
  const journalPath = path.join(dir, 'journal.jsonl');

  const res = runDriver(['benchmark', charterPath, outPath, '0']);
  check('the benchmark subcommand exits non-zero on LINEAGE-CHAIN-BROKEN', res.status !== 0, res.status);
  const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  check('the emitted halt_state is LINEAGE-CHAIN-BROKEN', payload.halt_state === 'LINEAGE-CHAIN-BROKEN', payload.halt_state);
  check('the emitter names the broken lineage reason', payload.lineage_chain && payload.lineage_chain.chain_unbroken === false, payload.lineage_chain);

  // Journal the emitted halt through the real appendRecord -- the pre-fix code
  // throws "unknown halt_state" here (the defect), the fixed code accepts it.
  let record;
  let threw = null;
  try {
    record = journalHalt(journalPath, charter, 0, payload.halt_state);
  } catch (err) {
    threw = err;
  }
  check('appendRecord journals LINEAGE-CHAIN-BROKEN (does not throw unknown halt_state)', threw === null && Boolean(record), threw && { code: threw.code, message: threw.message });

  if (record) {
    // The record validates against the schema (the schema enum now contains it).
    const validate = (() => {
      const Ajv = require('ajv');
      const schema = require('./journal-schema.json');
      return new Ajv({ allErrors: true, strict: true }).compile(schema)(record);
    })();
    check('the journaled record validates against journal-schema.json', validate === true);

    check('classifyHaltState(LINEAGE-CHAIN-BROKEN) is TERMINAL', journal.classifyHaltState('LINEAGE-CHAIN-BROKEN') === journal.TERMINAL, journal.classifyHaltState('LINEAGE-CHAIN-BROKEN'));
    check('it is in the TERMINAL_HALTS set', journal.TERMINAL_HALTS.includes('LINEAGE-CHAIN-BROKEN'));
    check('it is NOT in RECONCILIATION_REQUIRED_HALTS (no reconciliation)', !journal.RECONCILIATION_REQUIRED_HALTS.includes('LINEAGE-CHAIN-BROKEN'));
    check('the journaled record carries no reconciliation block', record.reconciliation === undefined || record.reconciliation === null);
    const readBack = journal.readJournal(journalPath);
    check('the record is read back from disk with halt_state intact', readBack.length === 1 && readBack[0].halt_state === 'LINEAGE-CHAIN-BROKEN', readBack);
  }
}

// ---------------------------------------------------------------------------
section('2. BENCHMARK-ERROR: the real emitter halts, and the halt is journalable + TERMINAL');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'bench-err-'));
  const fingerprintPath = path.join(dir, 'fingerprint.json');
  writeJson(fingerprintPath, { schema: 'BenchmarkFingerprint/1.0', lineage: [] });

  const charter = fixtureCharter('bench-halt-error', {
    fingerprint_path: fingerprintPath,
    // A spec path that does not exist makes bench.check() throw -> BENCHMARK-ERROR.
    colony_spec_path: path.join(dir, 'no-such-spec.json')
  });
  const charterPath = writeJson(path.join(dir, 'charter.json'), charter);
  const outPath = path.join(dir, 'benchmark-out.json');
  const journalPath = path.join(dir, 'journal.jsonl');

  const res = runDriver(['benchmark', charterPath, outPath, '0']);
  check('the benchmark subcommand exits non-zero on BENCHMARK-ERROR', res.status !== 0, res.status);
  const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  check('the emitted halt_state is BENCHMARK-ERROR', payload.halt_state === 'BENCHMARK-ERROR', payload.halt_state);
  check('the emitter names the thrown benchmark error', payload.benchmark_error && typeof payload.benchmark_error.message === 'string' && payload.benchmark_error.message.length > 0, payload.benchmark_error);

  let record;
  let threw = null;
  try {
    record = journalHalt(journalPath, charter, 0, payload.halt_state);
  } catch (err) {
    threw = err;
  }
  check('appendRecord journals BENCHMARK-ERROR (does not throw unknown halt_state)', threw === null && Boolean(record), threw && { code: threw.code, message: threw.message });

  if (record) {
    const Ajv = require('ajv');
    const schema = require('./journal-schema.json');
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema)(record);
    check('the journaled record validates against journal-schema.json', validate === true);
    check('classifyHaltState(BENCHMARK-ERROR) is TERMINAL', journal.classifyHaltState('BENCHMARK-ERROR') === journal.TERMINAL, journal.classifyHaltState('BENCHMARK-ERROR'));
    check('it is in the TERMINAL_HALTS set', journal.TERMINAL_HALTS.includes('BENCHMARK-ERROR'));
    check('it is NOT in RECONCILIATION_REQUIRED_HALTS (no reconciliation)', !journal.RECONCILIATION_REQUIRED_HALTS.includes('BENCHMARK-ERROR'));
    check('the journaled record carries no reconciliation block', record.reconciliation === undefined || record.reconciliation === null);
  }
}

// ---------------------------------------------------------------------------
section('3. Schema completeness: the enum and the classification map agree');
// ---------------------------------------------------------------------------
{
  const schema = require('./journal-schema.json');
  const enumMembers = schema.properties.halt_state.enum.filter((m) => m !== null);
  for (const member of enumMembers) {
    check(`every schema enum member ${member} classifies (no classifyHaltState throw)`, (() => {
      try { journal.classifyHaltState(member); return true; } catch (e) { return false; }
    })());
  }
  check('both new members are present in the schema enum', enumMembers.includes('LINEAGE-CHAIN-BROKEN') && enumMembers.includes('BENCHMARK-ERROR'), enumMembers);
  check('both new members are present in journal HALT_STATES', journal.HALT_STATES.includes('LINEAGE-CHAIN-BROKEN') && journal.HALT_STATES.includes('BENCHMARK-ERROR'));
}

// ---------------------------------------------------------------------------
section('4. T4: a tripped REBASELINE-FREQUENCY files a REAL TickTockRebaselineFinding/1.0 artifact');
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS CLOSES. checkRebaselineFrequency (run-benchmark.js:854-883)
// returned finding_recorded: exceeded but wrote NOTHING to any findings or
// signals surface -- a false-safety self-attestation, while SKILL.md claimed
// the halt "files a finding". The fix writes a real artifact to
// _dev/reports/signals/ticktock-rebaseline-frequency__<charter_id>__<cycle>.json
// (schema TickTockRebaselineFinding/1.0), idempotent on charter_hash+cycle_index.
// This section drives the REAL cycle-driver benchmark subcommand with a
// lineage that trips the detector, and asserts the artifact exists, is
// schema-valid, and is NOT duplicated by a second detection.
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'rebaseline-finding-'));
  const signalsDir = path.join(dir, 'signals');

  // A lineage that trips the charter-default detector: 3 distinct in-window
  // cycles (0, 2, 4) at current cycle 4 with n_threshold=2, m_window=5.
  const mk = (cycle, prior, next) => ({
    prior_fingerprint_hash: prior,
    triggering_cycle: cycle,
    review_artifact: `_dev/reports/analysis/rebaseline-review-${cycle}.md`,
    ratification_reference: `operator-stamp-${cycle}`,
    reason: `fixture rebaseline at cycle ${cycle}`,
    new_fingerprint_hash: next
  });
  const lineage = [
    mk(0, 'a'.repeat(64), 'b'.repeat(64)),
    mk(2, 'b'.repeat(64), 'c'.repeat(64)),
    mk(4, 'c'.repeat(64), 'd'.repeat(64))
  ];
  const fingerprintPath = path.join(dir, 'fingerprint.json');
  writeJson(fingerprintPath, {
    schema: 'BenchmarkFingerprint/1.0',
    fingerprint_hash: 'd'.repeat(64),
    lineage
  });

  const charter = fixtureCharter('bench-halt-rebaseline-finding', {
    fingerprint_path: fingerprintPath
  });
  const charterPath = writeJson(path.join(dir, 'charter.json'), charter);
  const outPath = path.join(dir, 'benchmark-out.json');
  const CYCLE = 4;

  // First detection: the detector trips, halts, and files the finding.
  const first = runDriver(['benchmark', charterPath, outPath, String(CYCLE), signalsDir]);
  const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  check('the benchmark subcommand halts REBASELINE-FREQUENCY (nonzero exit)', first.status !== 0, first.status);
  check('the emitted halt_state is REBASELINE-FREQUENCY', payload.halt_state === 'REBASELINE-FREQUENCY', payload.halt_state);
  check('the detector reports the finding as recorded', payload.rebaseline_frequency && payload.rebaseline_frequency.finding_recorded === true, payload.rebaseline_frequency);

  // The artifact must exist at the charter-derived, cycle-bound path.
  const artifactPath = path.join(signalsDir, `ticktock-rebaseline-frequency__${charter.charter_id}__${CYCLE}.json`);
  check('the finding artifact EXISTS on the signals surface', fs.existsSync(artifactPath), artifactPath);
  check('the emitter names the artifact path', payload.rebaseline_frequency && payload.rebaseline_frequency.finding_artifact === artifactPath, payload.rebaseline_frequency && payload.rebaseline_frequency.finding_artifact);

  // Schema-valid against TickTockRebaselineFinding/1.0 (guarded: the earlier
  // existence check already FAILED on the pre-fix code, and the parse must not
  // crash the suite -- the FAILs above are the red evidence).
  const benchMod = require('./run-benchmark.js');
  let artifact = null;
  try { artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')); } catch (e) { artifact = null; }
  check('the artifact carries schema TickTockRebaselineFinding/1.0', Boolean(artifact) && artifact.schema === benchMod.REBASELINE_FINDING_SCHEMA, artifact && artifact.schema);
  check('the artifact binds the charter_hash', Boolean(artifact) && artifact.charter_hash === charter.charter_hash, artifact && artifact.charter_hash);
  check('the artifact binds the cycle_index', Boolean(artifact) && artifact.cycle_index === CYCLE, artifact && artifact.cycle_index);
  check('the artifact carries threshold_n and window_m', Boolean(artifact) && artifact.threshold_n === 2 && artifact.window_m === 5, artifact && { threshold_n: artifact.threshold_n, window_m: artifact.window_m });
  check('the artifact carries the ratio and finding text', Boolean(artifact) && artifact.ratio === '3/5' && typeof artifact.finding === 'string' && artifact.finding.length > 0, artifact && artifact.ratio);
  check('the artifact is stamped recorded_at', Boolean(artifact) && typeof artifact.recorded_at === 'string' && !Number.isNaN(Date.parse(artifact.recorded_at)), artifact && artifact.recorded_at);
  check('the default signals surface is _dev/reports/signals (SKILL.md names this path)', benchMod.DEFAULT_SIGNALS_DIR.endsWith(path.join('_dev', 'reports', 'signals')), benchMod.DEFAULT_SIGNALS_DIR);

  // The dedup block below needs the artifact to exist; on the pre-fix code the
  // existence check has already FAILED, so the dedup assertions are skipped
  // cleanly (counted as failures, not crashes) by guarding on existence.
  if (artifact) {
    const firstArtifactBytes = fs.readFileSync(artifactPath, 'utf8');
    const second = runDriver(['benchmark', charterPath, outPath, String(CYCLE), signalsDir]);
    const afterSecond = fs.readFileSync(artifactPath, 'utf8');
    check('a second detection still halts (the finding is real, not cleared)', second.status !== 0, second.status);
    check('a second detection does NOT duplicate the artifact (bytes unchanged from the first write)', afterSecond === firstArtifactBytes && JSON.parse(afterSecond).recorded_at === artifact.recorded_at);
    const matches = fs.readdirSync(signalsDir).filter((f) => f.startsWith('ticktock-rebaseline-frequency__'));
    check('exactly one finding artifact exists for the pair', matches.length === 1, matches);
  } else {
    check('dedup: a second detection does NOT duplicate the artifact (skipped -- artifact missing)', false, 'artifact did not exist; red run');
  }
}
// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
