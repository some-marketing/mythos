#!/usr/bin/env node
'use strict';

// tools/ticktock/test-rebaseline-frequency.cjs -- acceptance tests proving the
// TT-003 rebaseline-frequency guard is ALIVE (plan revive-rebaseline-frequency-
// guard, from run-001 SHIP correction C-F4b).
//
// THE DEFECT THIS REPAIRS. benchmark-fingerprint-v1.json stored `lineage` as a
// single OBJECT while cycle-driver.cjs coerced any non-array to [] -- so
// checkRebaselineFrequency always saw an empty window (ratio_computed "0/5"
// despite the real 2026-08-12T01:37Z rebaseline) and the REBASELINE-FREQUENCY
// halt was a declared safety state no input could fire. Worse, an object passed
// to verifyLineageChain returns chain_unbroken:true VACUOUSLY (its walk starts
// at i=1 and never runs). The repair: the writer records lineage as an
// append-only array of entries stamped with new_fingerprint_hash; the on-disk
// fingerprint is migrated to a one-entry array; the reader halts LOUDLY
// (LINEAGE-CHAIN-BROKEN) on any non-array lineage instead of silently counting
// zero or vacuously passing.
//
// Threshold semantics note (codewhale review 20260812T034951Z, finding 5):
// checkRebaselineFrequency halts on count > n_threshold. Under the run-001
// charter defaults (n=2, m=5) a SECOND in-window rebaseline counts but does
// not halt -- dryrun-s3.cjs's S3-a2 negative control pins that exact case. So
// C-F4b's "second in-window rebaseline halts" falsifier is discharged with an
// explicit n_threshold:1 arm (b), and the charter-default halt is proven with
// three distinct cycles in arm (c).
//
// Run: node tools/ticktock/test-rebaseline-frequency.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const bench = require('./run-benchmark.js');
const charterMod = require('./charter.cjs');

const DRIVER = path.join(__dirname, 'cycle-driver.cjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_FINGERPRINT = path.join(REPO_ROOT, '_dev/state/ticktock/benchmark-fingerprint-v1.json');

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

function runNode(script, args, opts) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
      ...opts
    });
    return { status: 0, stdout: out };
  } catch (err) {
    return { status: err.status === undefined ? null : err.status, stdout: err.stdout || '', stderr: err.stderr || '', error: err };
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-rebaseline-freq-'));

function mkEntry(cycle, opts = {}) {
  return {
    prior_fingerprint_hash: opts.prior || 'a'.repeat(64),
    triggering_cycle: cycle,
    review_artifact: `_dev/reports/analysis/rebaseline-review-${cycle}.md`,
    ratification_reference: `operator-stamp-${cycle}`,
    reason: `fixture rebaseline at cycle ${cycle}`,
    new_fingerprint_hash: opts.next || 'b'.repeat(64)
  };
}

// T1 (tt-charter-template-and-spend-ledger, round-2 coordinator design
// decision): fixtureCharter() now binds against the permissive
// __fixtures__/charter-template-test-minimal.json via charter.cjs's opt-in
// { templatePath } override (see its "Template override" comment), rather
// than the canonical charter-template-run.json -- so this file's original
// small fixture ceilings can be restored exactly, even though this file
// never exercises ceiling-boundary arithmetic itself. Production is
// unaffected: cycle-driver.cjs's create-charter command never passes opts.
const MINIMAL_TEMPLATE = path.join(__dirname, '__fixtures__', 'charter-template-test-minimal.json');

function fixtureCharter(id, fingerprintPath) {
  return charterMod.createCharter({
    charter_id: id,
    created_at: '2026-08-12T13:00:00.000Z',
    target: { description: 'rebaseline-frequency guard fixture', repo_root: REPO_ROOT, subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
    allowed_write_surfaces: ['tools/ticktock/**'],
    max_cumulative_diff: { lines_changed: 5, files_changed: 2 },
    max_external_actions: 1,
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-12T13:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-12T13:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-12T13:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: { until_kind: 'cycle_ceiling', halt_conditions: ['REBASELINE-FREQUENCY', 'LINEAGE-CHAIN-BROKEN'] },
    benchmark: {
      // Deliberately nonexistent spec: the lineage checks run BEFORE the colony
      // comparison, and the halt precedence puts LINEAGE-CHAIN-BROKEN ahead of
      // BENCHMARK-ERROR -- so the guard is proven through the real command
      // without paying for a colony run.
      colony_spec_path: path.join(tmpRoot, 'no-such-spec.json'),
      colony_spec_version: 'v1',
      fingerprint_path: fingerprintPath,
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 }
    }
  }, { templatePath: MINIMAL_TEMPLATE });
}

// ---------------------------------------------------------------------------
section('(a) the REAL migrated fingerprint counts 1/5 at charter defaults -- the dead guard counted 0');
// ---------------------------------------------------------------------------
{
  const recorded = JSON.parse(fs.readFileSync(REAL_FINGERPRINT, 'utf8'));
  check('the real fingerprint lineage is an ARRAY post-migration', Array.isArray(recorded.lineage), typeof recorded.lineage);
  check('it carries exactly the one real (01:37Z) rebaseline entry', Array.isArray(recorded.lineage) && recorded.lineage.length === 1, recorded.lineage);
  check('the migrated entry is stamped with new_fingerprint_hash == the file\'s own fingerprint_hash',
    Array.isArray(recorded.lineage) && recorded.lineage[0].new_fingerprint_hash === recorded.fingerprint_hash,
    recorded.lineage && recorded.lineage[0] && recorded.lineage[0].new_fingerprint_hash);

  const det = bench.checkRebaselineFrequency(recorded.lineage, { n_threshold: 2, m_window: 5, current_cycle_index: 0 });
  check('ratio_computed is 1/5 -- no longer 0/5', det.ratio_computed === '1/5', det);
  check('one rebaseline at charter defaults does NOT halt', det.halted_on_threshold === false && det.halt_state === null, det);
}

// ---------------------------------------------------------------------------
section('(b) C-F4b falsifier: a second in-window rebaseline halts REBASELINE-FREQUENCY (explicit n_threshold:1)');
// ---------------------------------------------------------------------------
{
  // Distinct triggering_cycle values are REQUIRED (codewhale finding 5): the
  // count is the Set of cycles in window -- two entries at one cycle count
  // once and would not halt even at n=1.
  const lineage = [mkEntry(0), mkEntry(3, { prior: 'b'.repeat(64), next: 'c'.repeat(64) })];
  const det = bench.checkRebaselineFrequency(lineage, { n_threshold: 1, m_window: 5, current_cycle_index: 3 });
  check('two distinct-cycle rebaselines in window exceed n=1', det.ratio_computed === '2/5', det);
  check('the halt fires: halted_on_threshold true', det.halted_on_threshold === true, det);
  check('the halt state is REBASELINE-FREQUENCY', det.halt_state === 'REBASELINE-FREQUENCY', det);
  check('a finding is recorded, not just a halt', det.finding_recorded === true && typeof det.finding === 'string' && det.finding.length > 0, det);

  // Negative control at charter defaults (mirrors dryrun-s3 S3-a2): the same
  // two entries must NOT halt at n=2 -- count > n is the encoded semantics.
  const atDefaults = bench.checkRebaselineFrequency(lineage, { n_threshold: 2, m_window: 5, current_cycle_index: 3 });
  check('negative control: 2-in-window does NOT halt at charter default n=2', atDefaults.halted_on_threshold === false, atDefaults);
}

// ---------------------------------------------------------------------------
section('(c) three in-window rebaselines (distinct cycles) halt at charter defaults n=2');
// ---------------------------------------------------------------------------
{
  const lineage = [mkEntry(0), mkEntry(2, { prior: 'b'.repeat(64), next: 'c'.repeat(64) }), mkEntry(4, { prior: 'c'.repeat(64), next: 'd'.repeat(64) })];
  const det = bench.checkRebaselineFrequency(lineage, { n_threshold: 2, m_window: 5, current_cycle_index: 4 });
  check('three distinct-cycle rebaselines compute 3/5', det.ratio_computed === '3/5', det);
  check('the charter-default halt fires: REBASELINE-FREQUENCY', det.halt_state === 'REBASELINE-FREQUENCY', det);
}

// ---------------------------------------------------------------------------
section('(d) object-form lineage halts LOUDLY through the real cycle-driver commands -- never a silent 0/5, never a vacuous pass');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'object-form-'));
  // The pre-migration on-disk shape, verbatim: a single object.
  const objectFingerprint = writeJson(path.join(dir, 'fingerprint-object.json'), {
    schema: 'BenchmarkFingerprint/1.0',
    lineage: {
      prior_fingerprint_hash: 'a'.repeat(64),
      triggering_cycle: 0,
      review_artifact: 'fixture',
      ratification_reference: 'fixture',
      reason: 'object-form fixture (the pre-migration shape)'
    },
    fingerprint_hash: 'a'.repeat(64)
  });
  const charterPath = writeJson(path.join(dir, 'charter.json'), fixtureCharter('rebaseline-freq-object-form', objectFingerprint));

  const benchOut = path.join(dir, 'benchmark-check.json');
  const result = runNode(DRIVER, ['benchmark', charterPath, benchOut, '0']);
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(benchOut, 'utf8')); } catch { /* handled below */ }

  check('the benchmark command halts (nonzero exit)', result.status !== 0, result.stdout + result.stderr);
  check('the halt state is LINEAGE-CHAIN-BROKEN', Boolean(payload) && payload.halt_state === 'LINEAGE-CHAIN-BROKEN', payload && payload.halt_state);
  check('chain_unbroken is FALSE -- the vacuous-true path is closed', Boolean(payload) && payload.lineage_chain.chain_unbroken === false, payload && payload.lineage_chain);
  check('the error names the unreadable record', Boolean(payload) && /not an array/.test(JSON.stringify(payload.lineage_chain.errors)), payload && payload.lineage_chain);

  const lc = runNode(DRIVER, ['lineage-check', charterPath]);
  let lcOut = null;
  try { lcOut = JSON.parse(lc.stdout); } catch { /* handled below */ }
  check('lineage-check also refuses object-form (nonzero exit)', lc.status !== 0, lc.stdout + lc.stderr);
  check('lineage-check reports chain_unbroken false, not a vacuous pass', Boolean(lcOut) && lcOut.chain.chain_unbroken === false, lcOut);

  // Differential control: undefined lineage (a genuinely fresh baseline) is
  // NOT the unreadable case -- it stays [], counts 0, and must not halt on
  // the lineage checks.
  const freshFingerprint = writeJson(path.join(dir, 'fingerprint-fresh.json'), {
    schema: 'BenchmarkFingerprint/1.0',
    fingerprint_hash: 'a'.repeat(64)
  });
  const freshCharter = writeJson(path.join(dir, 'charter-fresh.json'), fixtureCharter('rebaseline-freq-fresh', freshFingerprint));
  const fresh = runNode(DRIVER, ['lineage-check', freshCharter]);
  let freshOut = null;
  try { freshOut = JSON.parse(fresh.stdout); } catch { /* handled below */ }
  check('fresh-baseline (no lineage field) passes lineage-check with 0 entries', fresh.status === 0 && Boolean(freshOut) && freshOut.lineage_entries === 0 && freshOut.chain.chain_unbroken === true, fresh.stdout + fresh.stderr);
}

// ---------------------------------------------------------------------------
section('(e) writer round-trip: a real --record with lineage flags APPENDS to the chain');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'writer-'));
  const fpPath = path.join(dir, 'fingerprint.json');

  // Start from the REAL migrated file (1 entry) copied to a temp path, so the
  // round-trip proves carry-forward against the true on-disk shape.
  fs.copyFileSync(REAL_FINGERPRINT, fpPath);
  const before = JSON.parse(fs.readFileSync(fpPath, 'utf8'));

  const rec = runNode(path.join(__dirname, 'run-benchmark.js'), [
    '--record', '--fingerprint', fpPath,
    '--prior-fingerprint', before.fingerprint_hash,
    '--triggering-cycle', '1',
    '--review-artifact', 'fixture-review.md',
    '--ratification', 'fixture-ratification',
    '--reason', 'writer round-trip fixture rebaseline'
  ]);
  check('--record with lineage flags completes', rec.status === 0, rec.stdout + rec.stderr);

  const after = JSON.parse(fs.readFileSync(fpPath, 'utf8'));
  check('lineage grew from 1 entry to 2', Array.isArray(after.lineage) && after.lineage.length === 2, after.lineage && after.lineage.length);
  check('the appended entry links to the prior fingerprint (prior_fingerprint_hash == old new_fingerprint_hash)',
    after.lineage && after.lineage[1].prior_fingerprint_hash === before.lineage[0].new_fingerprint_hash, after.lineage);
  check('the appended entry is stamped with the NEW fingerprint_hash',
    after.lineage && after.lineage[1].new_fingerprint_hash === after.fingerprint_hash, after.lineage);
  check('verifyLineageChain walks the 2-entry chain unbroken', bench.verifyLineageChain(after.lineage).chain_unbroken === true, bench.verifyLineageChain(after.lineage));
  check('the carried-forward first entry is byte-identical', JSON.stringify(after.lineage[0]) === JSON.stringify(before.lineage[0]));
}

// ---------------------------------------------------------------------------
section('(f) codex PR#20: the FIRST rebaseline entry is validated too, not silently skipped');
// ---------------------------------------------------------------------------
{
  // A single-entry lineage missing a required field. Before the fix,
  // verifyLineageChain's adjacent-pair loop starts at i=1 and never runs for
  // a 1-entry array, so this was reported chain_unbroken:true.
  const incompleteFirstEntry = [{
    prior_fingerprint_hash: 'a'.repeat(64),
    triggering_cycle: 0,
    // review_artifact deliberately omitted
    ratification_reference: 'operator-stamp-0',
    reason: 'fixture missing a required field on entry 0',
    new_fingerprint_hash: 'b'.repeat(64)
  }];
  const chain = bench.verifyLineageChain(incompleteFirstEntry);
  check('a 1-entry lineage missing a required field is now reported chain_unbroken:false', chain.chain_unbroken === false, chain);
  check('the error names index 0, not skipped as having no predecessor to check', chain.errors.some((e) => e.index === 0 && /review_artifact/.test(e.message)), chain.errors);

  // Differential control: a complete single entry still passes -- the fix
  // must not reject legitimate first rebaselines.
  const completeFirstEntry = [mkEntry(0)];
  const cleanChain = bench.verifyLineageChain(completeFirstEntry);
  check('a complete 1-entry lineage still passes (no false-positive from the fix)', cleanChain.chain_unbroken === true, cleanChain);
}

// ---------------------------------------------------------------------------
section('(g) codex PR#20: an array-form lineage with a genuinely BROKEN adjacent-hash link now fails cycle-driver\'s lineage-check exit code too, not just the object-form (unreadable) case');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'broken-chain-'));
  const brokenFingerprint = writeJson(path.join(dir, 'fingerprint-broken.json'), {
    schema: 'BenchmarkFingerprint/1.0',
    lineage: [
      mkEntry(0, { prior: 'a'.repeat(64), next: 'b'.repeat(64) }),
      // Deliberately does not link: prior_fingerprint_hash should be 'b'.repeat(64) to match entry 0's new_fingerprint_hash.
      mkEntry(2, { prior: 'WRONG-LINK'.padEnd(64, '0'), next: 'c'.repeat(64) })
    ],
    fingerprint_hash: 'c'.repeat(64)
  });
  const charterPath = writeJson(path.join(dir, 'charter.json'), fixtureCharter('rebaseline-freq-broken-link', brokenFingerprint));

  const lc = runNode(DRIVER, ['lineage-check', charterPath]);
  let lcOut = null;
  try { lcOut = JSON.parse(lc.stdout); } catch { /* handled below */ }
  check('lineage-check reports chain_unbroken:false for a genuinely broken adjacent-hash link', Boolean(lcOut) && lcOut.chain.chain_unbroken === false, lcOut);
  check(
    'codex PR#20 fix: lineage-check now exits NONZERO for this case too -- before the fix, only the non-array (unreadable) branch controlled the exit code, so this printed the failure and still exited 0',
    lc.status !== 0,
    lc.stdout + lc.stderr
  );
}

// ---------------------------------------------------------------------------
section('(g2) codex PR#20 round 3: both fingerprint hash fields are required and hash-shaped on EVERY entry');
// ---------------------------------------------------------------------------
{
  // A single entry with all four metadata fields but no hashes at all. Before
  // the fix, the adjacent-pair loop never runs for a 1-entry array and the
  // required-field list did not cover the hash fields, so this was reported
  // chain_unbroken:true despite having no fingerprint hashes whatsoever.
  const noHashesEntry = [{
    triggering_cycle: 0,
    review_artifact: '_dev/reports/analysis/rebaseline-review-0.md',
    ratification_reference: 'operator-stamp-0',
    reason: 'fixture with all metadata but no hashes'
  }];
  const chain1 = bench.verifyLineageChain(noHashesEntry);
  check('a 1-entry lineage with no fingerprint hashes at all is reported chain_unbroken:false', chain1.chain_unbroken === false, chain1);
  check('the error names both missing hash fields on index 0',
    chain1.errors.some((e) => e.index === 0 && /prior_fingerprint_hash/.test(e.message))
    && chain1.errors.some((e) => e.index === 0 && /new_fingerprint_hash/.test(e.message)),
    chain1.errors);

  // Two adjacent entries BOTH missing new_fingerprint_hash / prior_fingerprint_hash
  // respectively would previously compare `undefined === undefined` in the
  // adjacent-link check and pass it -- required-field/hash-shape validation
  // must catch this before the link comparison ever gets a chance to.
  const bothMissingAdjacent = [
    { triggering_cycle: 0, review_artifact: 'r0.md', ratification_reference: 'op-0', reason: 'r0', prior_fingerprint_hash: 'a'.repeat(64) /* new_fingerprint_hash omitted */ },
    { triggering_cycle: 1, review_artifact: 'r1.md', ratification_reference: 'op-1', reason: 'r1', new_fingerprint_hash: 'c'.repeat(64) /* prior_fingerprint_hash omitted */ }
  ];
  const chain2 = bench.verifyLineageChain(bothMissingAdjacent);
  check('adjacent entries with complementary missing hashes do not compare undefined===undefined into a pass', chain2.chain_unbroken === false, chain2);
  check('missing new_fingerprint_hash on entry 0 is reported', chain2.errors.some((e) => e.index === 0 && /new_fingerprint_hash/.test(e.message)), chain2.errors);
  check('missing prior_fingerprint_hash on entry 1 is reported', chain2.errors.some((e) => e.index === 1 && /prior_fingerprint_hash/.test(e.message)), chain2.errors);

  // A malformed (non-64-hex) hash value is refused too, not just an absent one.
  const malformedHash = [mkEntry(0, { prior: 'not-a-real-hash', next: 'b'.repeat(64) })];
  const chain3 = bench.verifyLineageChain(malformedHash);
  check('a non-64-hex prior_fingerprint_hash is reported chain_unbroken:false', chain3.chain_unbroken === false, chain3);

  // Differential control: a genuinely complete, correctly-linked 2-entry
  // chain with real 64-hex hashes still passes.
  const cleanTwo = [mkEntry(0, { prior: 'a'.repeat(64), next: 'b'.repeat(64) }), mkEntry(1, { prior: 'b'.repeat(64), next: 'c'.repeat(64) })];
  const cleanChain = bench.verifyLineageChain(cleanTwo);
  check('a complete, correctly-hashed 2-entry chain still passes (no false-positive from the fix)', cleanChain.chain_unbroken === true, cleanChain);
}

// ---------------------------------------------------------------------------
section('(h) codex PR#20: charter fingerprint-binding mismatch is now a distinct halt, not silently absorbed into a benchmark-identical pass');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'binding-mismatch-'));
  // The charter is bound (via fixtureCharter's benchmark.fingerprint_hash)
  // to 'a'.repeat(64). Record a fingerprint file whose OWN fingerprint_hash
  // is a DIFFERENT value -- simulating the baseline having been edited or
  // re-recorded after charter creation.
  const reboundFingerprint = writeJson(path.join(dir, 'fingerprint-rebound.json'), {
    schema: 'BenchmarkFingerprint/1.0',
    fingerprint_hash: 'z'.repeat(64) // charter is bound to 'a'.repeat(64) -- mismatch
  });
  const charterPath = writeJson(path.join(dir, 'charter.json'), fixtureCharter('rebaseline-freq-binding-mismatch', reboundFingerprint));
  const benchOut = path.join(dir, 'benchmark-check.json');
  const result = runNode(DRIVER, ['benchmark', charterPath, benchOut, '0']);
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(benchOut, 'utf8')); } catch { /* handled below */ }

  check('the benchmark command halts on a fingerprint-binding mismatch (nonzero exit)', result.status !== 0, result.stdout + result.stderr);
  check('the halt state is FINGERPRINT-BINDING-MISMATCH', Boolean(payload) && payload.halt_state === 'FINGERPRINT-BINDING-MISMATCH', payload && payload.halt_state);
  check('the payload names both the declared and recorded hashes for operator diagnosis',
    Boolean(payload) && payload.fingerprint_hash_declared === 'a'.repeat(64) && payload.fingerprint_hash_recorded === 'z'.repeat(64),
    payload && { declared: payload.fingerprint_hash_declared, recorded: payload.fingerprint_hash_recorded });

  // Differential control: a matching fingerprint_hash must NOT halt on this
  // check (the fix must not false-positive on the normal, bound case).
  const dir2 = fs.mkdtempSync(path.join(tmpRoot, 'binding-match-'));
  const matchingFingerprint = writeJson(path.join(dir2, 'fingerprint-matching.json'), {
    schema: 'BenchmarkFingerprint/1.0',
    fingerprint_hash: 'a'.repeat(64) // matches fixtureCharter's declared hash
  });
  const charterPath2 = writeJson(path.join(dir2, 'charter.json'), fixtureCharter('rebaseline-freq-binding-match', matchingFingerprint));
  const benchOut2 = path.join(dir2, 'benchmark-check.json');
  const result2 = runNode(DRIVER, ['benchmark', charterPath2, benchOut2, '0']);
  let payload2 = null;
  try { payload2 = JSON.parse(fs.readFileSync(benchOut2, 'utf8')); } catch { /* handled below */ }
  check('a matching fingerprint_hash does not trigger FINGERPRINT-BINDING-MISMATCH',
    Boolean(payload2) && payload2.halt_state !== 'FINGERPRINT-BINDING-MISMATCH', payload2 && payload2.halt_state);
}

// ---------------------------------------------------------------------------
fs.rmSync(tmpRoot, { recursive: true, force: true });
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
