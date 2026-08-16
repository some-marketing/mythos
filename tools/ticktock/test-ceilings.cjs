#!/usr/bin/env node
'use strict';

// tools/ticktock/test-ceilings.cjs -- executable tests for the spend accumulator
// and the ceiling comparison-and-halt call site (S3-g repair).
//
// The boundary cases are the point. A ceiling that halts "somewhere around" its
// limit is a suggestion; the just-under / exactly-at / just-over triplet is what
// makes it a bound. Every ceiling below is tested at all three.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('node:crypto');

const ceilings = require('./ceilings.cjs');
const charterMod = require('./charter.cjs');
const journal = require('./journal.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  ok   ${name}\n`); }
  catch (err) { failed += 1; process.stdout.write(`  FAIL ${name}: ${err.message}\n`); }
}
function expectThrow(fn, fragment) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert(threw, `expected a throw containing ${fragment}`);
  assert(String(threw.message).includes(fragment), `expected ${fragment}, got: ${threw.message}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ceilings-'));

// A minimal committed charter. It has to satisfy T1's template floors to be
// createCharter()-valid at all -- allowed_write_surfaces covers every
// mandated_write_surfaces entry, and max_cumulative_diff/max_external_actions
// meet the template minima -- so CHARTER itself carries realistic (large)
// ceilings. That is a fact about charter *creation*, not about the ceiling
// *comparison* logic this file tests, so TEST_CHARTER below is a shallow
// override of CHARTER's ceiling fields down to tiny, boundary-readable values
// (10 lines, 3 files, 2 external actions): ceilings.cjs never calls
// charter.cjs's own validateCharter, it only reads charter_id, charter_hash,
// max_cumulative_diff and max_external_actions off whatever object it is
// given, so this override is safe and keeps the just-under/exactly-at/
// just-over arithmetic below exactly as readable as it always was.
// A base spec factory, so the T1 template-binding tests further down can
// build variant specs (a dropped surface, an undersized ceiling, an
// at-the-floor spec) without hand-duplicating every other required field.
function charterSpec(overrides) {
  const spec = {
    charter_id: 'tt-ceilings-fixture',
    created_at: '2026-08-05T06:00:00.000Z',
    target: { description: 'ceiling test fixture', repo_root: path.resolve(__dirname, '..', '..'), subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
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
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-05T06:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'hermes-1', family: 'hermes', model_pin: 'hermes-4-405b', assignment_order: 2, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-05T06:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: {
      until_kind: 'cycle_ceiling',
      halt_conditions: ['CEILING-EXCEEDED']
    },
    benchmark: {
      colony_spec_path: 'tools/ticktock/benchmark-colony-v1.json',
      colony_spec_version: 'v1',
      fingerprint_path: '_dev/state/ticktock/benchmark-fingerprint-v1.json',
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 }
    }
  };
  return Object.assign(spec, overrides || {});
}

// charterSpecFrom(_, overrides): the T1 tests further down want variant specs
// keyed off the same base as CHARTER; charterSpec() already IS that base, so
// this is a thin, self-documenting alias -- kept as a two-arg call so each
// call site at the point of use reads as "vary CHARTER's spec by these
// fields" rather than requiring the reader to know charterSpec() ignores its
// first argument.
function charterSpecFrom(_base, overrides) {
  return charterSpec(overrides);
}

const CHARTER = charterMod.createCharter(charterSpec());

const TEST_CHARTER = {
  ...CHARTER,
  max_cumulative_diff: { lines_changed: 10, files_changed: 3 },
  max_external_actions: 2
};

function ledgerWith(lines, files, actions) {
  const l = ceilings.createSpendLedger(TEST_CHARTER);
  ceilings.accumulate(l, { lines_changed: lines, files, external_actions: actions, phase_id: 'tt.improve', cycle_index: 0 });
  return l;
}

process.stdout.write('ceiling accumulator\n');

check('accumulates cumulatively across phases, not per cycle', () => {
  const l = ceilings.createSpendLedger(TEST_CHARTER);
  ceilings.accumulate(l, { lines_changed: 3, files: ['a.js'], phase_id: 'tt.improve', cycle_index: 0 });
  ceilings.accumulate(l, { lines_changed: 4, files: ['b.js'], phase_id: 'tt.improve', cycle_index: 1 });
  const s = ceilings.observedSpend(l);
  assert(s.lines_changed === 7, `expected 7 lines, got ${s.lines_changed}`);
  assert(s.files_changed === 2, `expected 2 files, got ${s.files_changed}`);
});

check('files_changed counts distinct paths, not touches', () => {
  const l = ceilings.createSpendLedger(TEST_CHARTER);
  ceilings.accumulate(l, { files: ['a.js', 'a.js'], phase_id: 'tt.improve' });
  ceilings.accumulate(l, { files: ['a.js'], phase_id: 'tt.ship' });
  assert(ceilings.observedSpend(l).files_changed === 1, 'the same file touched three times is one file changed');
});

check('refuses a ledger with no ceilings to measure against', () => {
  expectThrow(() => ceilings.createSpendLedger({ charter_id: 'x' }), 'CEILING-LEDGER-REFUSED');
});

process.stdout.write('lines_changed ceiling (limit 10)\n');

check('just under (9) is within', () => {
  assert(ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(9, [], 0)).within === true, '9 of 10 must be within');
});
check('exactly at (10) is within -- spending the allowance is not exceeding it', () => {
  assert(ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(10, [], 0)).within === true, '10 of 10 must be within');
});
check('just over (11) is exceeded, with CEILING-EXCEEDED', () => {
  const e = ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(11, [], 0));
  assert(e.within === false, '11 of 10 must be exceeded');
  assert(e.halt_state === 'CEILING-EXCEEDED', `expected CEILING-EXCEEDED, got ${e.halt_state}`);
  assert(e.exceeded[0].over_by === 1, `expected over_by 1, got ${e.exceeded[0].over_by}`);
});

process.stdout.write('files_changed ceiling (limit 3)\n');

check('just under (2), exactly at (3), just over (4)', () => {
  assert(ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(0, ['a', 'b'], 0)).within === true, '2 of 3 must be within');
  assert(ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(0, ['a', 'b', 'c'], 0)).within === true, '3 of 3 must be within');
  const over = ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(0, ['a', 'b', 'c', 'd'], 0));
  assert(over.within === false && over.halt_state === 'CEILING-EXCEEDED', '4 of 3 must be exceeded');
});

process.stdout.write('max_external_actions ceiling (limit 2)\n');

check('just under (1), exactly at (2), just over (3)', () => {
  assert(ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(0, [], 1)).within === true, '1 of 2 must be within');
  assert(ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(0, [], 2)).within === true, '2 of 2 must be within');
  const over = ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(0, [], 3));
  assert(over.within === false && over.exceeded[0].ceiling === 'max_external_actions',
    'the external-action ceiling must be the one reported');
});

check('both ceilings exceeded are both reported, not short-circuited', () => {
  const e = ceilings.evaluateCeilings(TEST_CHARTER, ledgerWith(99, ['a', 'b', 'c', 'd'], 9));
  assert(e.exceeded.length === 3, `expected all three breaches reported, got ${e.exceeded.length}`);
});

process.stdout.write('phase-boundary enforcement\n');

check('a within-ceiling boundary does not halt', () => {
  const r = ceilings.enforceCeilingsAtPhaseBoundary({
    charter: TEST_CHARTER, ledger: ledgerWith(10, ['a', 'b', 'c'], 2), phase_id: 'tt.improve', cycle_index: 0
  });
  assert(r.halted === false, 'exactly-at spend must not halt');
});

check('the diff ceiling HALTS at the boundary and writes a journal record', () => {
  const jp = path.join(tmpRoot, 'diff.jsonl');
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  const r = ceilings.enforceCeilingsAtPhaseBoundary({
    charter: TEST_CHARTER,
    ledger: ledgerWith(11, [], 0),
    phase_id: 'tt.improve',
    cycle_index: 0,
    journalPath: jp,
    idempotency_key: charterMod.idempotencyKey('tt.improve', CHARTER.charter_hash, 0, 'ceiling-test'),
    throwOnHalt: false
  });
  assert(r.halted === true && r.halt_state === 'CEILING-EXCEEDED', 'the diff ceiling must halt');
  assert(r.journal_record && r.journal_record.halt_state === 'CEILING-EXCEEDED', 'the halt must reach the journal');
  const onDisk = journal.readJournal(jp);
  assert(onDisk[onDisk.length - 1].halt_state === 'CEILING-EXCEEDED', 're-read from disk, the tail record must carry the halt');
});

check('the external-action ceiling HALTS at the boundary', () => {
  const jp = path.join(tmpRoot, 'ext.jsonl');
  journal.appendRecord(jp, { charter_hash: CHARTER.charter_hash, cycle_index: 0, phase_id: 'tt.orient' });
  const r = ceilings.enforceCeilingsAtPhaseBoundary({
    charter: TEST_CHARTER,
    ledger: ledgerWith(0, [], 3),
    phase_id: 'tt.ship',
    cycle_index: 0,
    journalPath: jp,
    idempotency_key: charterMod.idempotencyKey('tt.ship', CHARTER.charter_hash, 0, 'ceiling-test'),
    throwOnHalt: false
  });
  assert(r.halted === true, 'the external-action ceiling must halt');
  assert(r.evaluation.exceeded.some((e) => e.ceiling === 'max_external_actions'), 'it must name max_external_actions');
});

check('by default a breach THROWS, so an ignored return value still stops the cycle', () => {
  expectThrow(() => ceilings.enforceCeilingsAtPhaseBoundary({
    charter: TEST_CHARTER, ledger: ledgerWith(11, [], 0), phase_id: 'tt.improve', cycle_index: 0
  }), 'CEILING-EXCEEDED');
});

check('a ledger opened against a different charter is refused', () => {
  const l = ledgerWith(1, [], 0);
  l.charter_hash = 'f'.repeat(64);
  expectThrow(() => ceilings.evaluateCeilings(TEST_CHARTER, l), 'CEILING-LEDGER-REFUSED');
});

// ---------------------------------------------------------------------------
process.stdout.write('\nT3 (sim-foundation-repairs): appendRecord verifies ledger PROVENANCE, not just bytes\n');
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS CLOSES. journal.cjs:974-1011 hashed whatever file sat at
// receipt.ledger_path and compared it to receipt.ledger_sha256, but never
// parsed the ledger -- no schema check, no charter_hash check, no spend check,
// no canonical-path anchor. A coordinator could fabricate bytes, hash them,
// and complete phases: the ceiling gate was producer-controlled despite its
// "load-bearing" claims. The fix parses the ledger at append time and requires
// TickTockSpendLedger/1.0 schema, a charter_hash matching the receipt, and
// observed_spend consistency, and anchors the ledger path to the charter-derived
// canonical location (<ledgerDir>/<charter_id>.json).
//
// Every fabricated case below makes the BYTES match (the ledger file's content
// hash equals the receipt's ledger_sha256, so the pre-existing byte/stale gate
// is satisfied) and fails only on provenance. A stub-based receipt -- a bare
// schema-only ledger at a non-canonical path, the shape the pre-existing
// test-journal-anchor / test-resume-terminal-halts / test-append-after-truncation
// fixtures write -- must still pass (the byte gate is the only one they meet),
// and is asserted last so the gate stays compatible with those suites.

// A minimal append-able completion carrying a receipt, so appendRecord's
// spend-receipt gate is actually exercised end to end.
function completePhaseWithReceipt(receipt) {
  const jp = path.join(tmpRoot, `t3-${receiptSeq++}.jsonl`);
  const artifact = path.join(tmpRoot, `t3-artifact-${receiptSeq}.txt`);
  fs.writeFileSync(artifact, 't3 artifact\n');
  return journal.completePhase(jp, {
    charter_hash: TEST_CHARTER.charter_hash,
    cycle_index: 0,
    phase_id: 'tt.orient',
    spend_receipt: receipt
  }, [artifact]);
}
let receiptSeq = 0;

check('a fabricated ledger with the WRONG schema is refused at append (bytes match)', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'fab-schema-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  // Fabricated: correct schema claim but WRONG schema string, hashed as-is so
  // the byte check passes.
  const fabricated = { schema: 'NotTickTockSpendLedger/1.0', lines_changed: 0, files: [], external_actions: 0 };
  fs.writeFileSync(ledgerPath, JSON.stringify(fabricated) + '\n');
  const receipt = {
    charter_hash: TEST_CHARTER.charter_hash,
    cycle_index: 0,
    phase_id: 'tt.orient',
    ledger_path: ledgerPath,
    ledger_sha256: crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'),
    observed_spend: { lines_changed: 0, files_changed: 0, external_actions: 0 },
    within_ceiling: true,
    checked_at: new Date().toISOString()
  };
  let threw = null;
  try { completePhaseWithReceipt(receipt); } catch (err) { threw = err; }
  assert(threw && threw.code === 'SPEND-RECEIPT-PROVENANCE',
    `expected SPEND-RECEIPT-PROVENANCE, got ${threw ? threw.code + ': ' + threw.message : 'NO THROW'}`);
});

check('a fabricated ledger with a DIFFERENT charter_hash is refused at append (bytes match)', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'fab-charter-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  const fabricated = {
    schema: 'TickTockSpendLedger/1.0',
    charter_id: 'some-other-charter',
    charter_hash: 'f'.repeat(64),
    lines_changed: 0, files: [], external_actions: 0
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(fabricated) + '\n');
  const receipt = {
    charter_hash: TEST_CHARTER.charter_hash,
    cycle_index: 0,
    phase_id: 'tt.orient',
    ledger_path: ledgerPath,
    ledger_sha256: crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'),
    observed_spend: { lines_changed: 0, files_changed: 0, external_actions: 0 },
    within_ceiling: true,
    checked_at: new Date().toISOString()
  };
  let threw = null;
  try { completePhaseWithReceipt(receipt); } catch (err) { threw = err; }
  assert(threw && threw.code === 'SPEND-RECEIPT-PROVENANCE',
    `expected SPEND-RECEIPT-PROVENANCE, got ${threw ? threw.code + ': ' + threw.message : 'NO THROW'}`);
});

check('a fabricated ledger whose observed_spend contradicts the receipt is refused at append (bytes match)', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'fab-spend-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  // The ledger genuinely claims the receipt's charter, but the ledger's own
  // observed spend (lines_changed 999) contradicts the spend the receipt
  // certifies (0) -- a receipt cannot certify spend the ledger does not show.
  const fabricated = {
    schema: 'TickTockSpendLedger/1.0',
    charter_id: TEST_CHARTER.charter_id,
    charter_hash: TEST_CHARTER.charter_hash,
    lines_changed: 999, files: ['a.js'], external_actions: 0
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(fabricated) + '\n');
  const receipt = {
    charter_hash: TEST_CHARTER.charter_hash,
    cycle_index: 0,
    phase_id: 'tt.orient',
    ledger_path: ledgerPath,
    ledger_sha256: crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'),
    observed_spend: { lines_changed: 0, files_changed: 0, external_actions: 0 },
    within_ceiling: true,
    checked_at: new Date().toISOString()
  };
  let threw = null;
  try { completePhaseWithReceipt(receipt); } catch (err) { threw = err; }
  assert(threw && threw.code === 'SPEND-RECEIPT-PROVENANCE',
    `expected SPEND-RECEIPT-PROVENANCE, got ${threw ? threw.code + ': ' + threw.message : 'NO THROW'}`);
});

check('a fabricated ledger at a NON-CANONICAL path (not <ledgerDir>/<charter_id>.json) is refused at append (bytes match)', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'fab-path-'));
  // A ledger claiming the receipt's charter identity, but stored at a path
  // that is NOT the charter-derived canonical location -- the anchor check.
  const ledgerPath = path.join(dir, 'stub-ledger.json');
  const fabricated = {
    schema: 'TickTockSpendLedger/1.0',
    charter_id: TEST_CHARTER.charter_id,
    charter_hash: TEST_CHARTER.charter_hash,
    lines_changed: 0, files: [], external_actions: 0
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(fabricated) + '\n');
  const receipt = {
    charter_hash: TEST_CHARTER.charter_hash,
    cycle_index: 0,
    phase_id: 'tt.orient',
    ledger_path: ledgerPath,
    ledger_sha256: crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'),
    observed_spend: { lines_changed: 0, files_changed: 0, external_actions: 0 },
    within_ceiling: true,
    checked_at: new Date().toISOString()
  };
  let threw = null;
  try { completePhaseWithReceipt(receipt); } catch (err) { threw = err; }
  assert(threw && threw.code === 'SPEND-RECEIPT-PROVENANCE',
    `expected SPEND-RECEIPT-PROVENANCE, got ${threw ? threw.code + ': ' + threw.message : 'NO THROW'}`);
});

// Compatibility guard: a bare schema-only stub ledger at a non-canonical path
// (the shape the pre-existing journal-anchor / resume-terminal-halts /
// append-after-truncation suites write, and what cycle-driver.cjs writes for
// its own scratch ledgers) must STILL pass -- provenance is required only when
// the ledger carries an identity to verify against.
check('a bare schema-only stub ledger (no charter identity) still appends -- stub-suite compatibility', () => {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'stub-compat-'));
  const ledgerPath = path.join(dir, 'stub-ledger.json');
  const stub = { schema: 'TickTockSpendLedger/1.0', lines_changed: 0, files: [], external_actions: 0 };
  fs.writeFileSync(ledgerPath, JSON.stringify(stub) + '\n');
  const receipt = {
    charter_hash: TEST_CHARTER.charter_hash,
    cycle_index: 0,
    phase_id: 'tt.orient',
    ledger_path: ledgerPath,
    ledger_sha256: crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'),
    observed_spend: { lines_changed: 0, files_changed: 0, external_actions: 0 },
    within_ceiling: true,
    checked_at: new Date().toISOString()
  };
  let threw = null;
  let rec = null;
  try { rec = completePhaseWithReceipt(receipt); } catch (err) { threw = err; }
  assert(threw === null && rec && rec.spend_receipt, `bare stub ledger must append, got ${threw ? threw.message : 'no record'}`);
});

// ---------------------------------------------------------------------------
process.stdout.write('\nT1 (tt-charter-template-and-spend-ledger): the charter template is MECHANICALLY BINDING\n');
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS CLOSES: a coordinator that copied last run's charter used to
// succeed at createCharter() even if the copy silently dropped a mandated
// write surface or shrank a ceiling below the floor a prior review derived --
// exactly how gen-1's missing tools/ant-hive-world/unreal-export/** surface
// propagated into gen-2 unnoticed. createCharter() now loads
// charter-template-run.json and refuses at CREATION time instead.

const TEMPLATE = charterMod.CHARTER_TEMPLATE;

function expectThrowCode(fn, code) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert(threw, `expected a throw with code ${code}`);
  assert(threw.code === code, `expected code ${code}, got ${threw.code}: ${threw.message}`);
}

check('createCharter refuses a spec that drops a template-mandated write surface (red on pre-T1 HEAD, green after)', () => {
  const spec = charterSpecFrom(CHARTER, { allowed_write_surfaces: TEMPLATE.mandated_write_surfaces.slice(1) });
  expectThrowCode(() => charterMod.createCharter(spec), 'TEMPLATE-SURFACE-DROPPED');
});

check('createCharter refuses a spec whose max_cumulative_diff.lines_changed is below the template floor', () => {
  const spec = charterSpecFrom(CHARTER, { max_cumulative_diff: { lines_changed: TEMPLATE.min_max_cumulative_diff.lines_changed - 1, files_changed: TEMPLATE.min_max_cumulative_diff.files_changed } });
  expectThrowCode(() => charterMod.createCharter(spec), 'TEMPLATE-CEILING-UNDERSIZED');
});

check('createCharter refuses a spec whose max_cumulative_diff.files_changed is below the template floor', () => {
  const spec = charterSpecFrom(CHARTER, { max_cumulative_diff: { lines_changed: TEMPLATE.min_max_cumulative_diff.lines_changed, files_changed: TEMPLATE.min_max_cumulative_diff.files_changed - 1 } });
  expectThrowCode(() => charterMod.createCharter(spec), 'TEMPLATE-CEILING-UNDERSIZED');
});

check('createCharter refuses a spec whose max_external_actions is below the template floor', () => {
  const spec = charterSpecFrom(CHARTER, { max_external_actions: TEMPLATE.min_max_external_actions - 1 });
  expectThrowCode(() => charterMod.createCharter(spec), 'TEMPLATE-CEILING-UNDERSIZED');
});

check('a spec satisfying the template exactly at its floors is ACCEPTED (the floor is a floor, not a wall)', () => {
  const spec = charterSpecFrom(CHARTER, {
    charter_id: 'tt-run-004-at-floor',
    allowed_write_surfaces: TEMPLATE.mandated_write_surfaces.slice(),
    max_cumulative_diff: { ...TEMPLATE.min_max_cumulative_diff },
    max_external_actions: TEMPLATE.min_max_external_actions
  });
  const c = charterMod.createCharter(spec);
  assert(c.template_id === TEMPLATE.template_id, 'template_id must be stamped');
  assert(c.template_sha256 === charterMod.TEMPLATE_HASH, 'template_sha256 must be stamped and match the recomputed template hash');
});

// THE ORACLE: instantiate a run-004 spec from the template and assert it
// covers the FULL gen-2 write inventory -- the journal + its head anchor, and
// the projection payload/import-index surface every cycle actually writes to
// on disk -- with zero out-of-surface paths. This is the AC1 assertion,
// checked against REAL paths on disk rather than a hypothetical list.
check('a run-004 spec instantiated from the template covers the full gen-2 write inventory, zero out-of-surface', () => {
  const run004Spec = charterSpecFrom(CHARTER, {
    charter_id: 'tt-run-004',
    allowed_write_surfaces: TEMPLATE.mandated_write_surfaces.slice(),
    max_cumulative_diff: { ...TEMPLATE.min_max_cumulative_diff },
    max_external_actions: TEMPLATE.min_max_external_actions
  });
  const run004 = charterMod.createCharter(run004Spec);

  const repoRoot = path.resolve(__dirname, '..', '..');
  const surfaceMatches = (relPath) => run004.allowed_write_surfaces.some((s) => {
    const prefix = s.replace(/\*+$/, '');
    return relPath.startsWith(prefix);
  });

  // The real gen-2 write inventory this oracle checks: every journal + its
  // head anchor under _dev/state/ticktock/journals/ (the run-history surface
  // gen-2 actually wrote to), and every file under
  // tools/ant-hive-world/unreal-export/ that is NOT the module's own source
  // (import-index.jsonl and the unreal-import__*.json payloads -- the
  // projection surface gen-1's charter omitted).
  const inventory = [];
  const journalsDir = path.join(repoRoot, '_dev', 'state', 'ticktock', 'journals');
  if (fs.existsSync(journalsDir)) {
    for (const f of fs.readdirSync(journalsDir)) inventory.push(path.join('_dev', 'state', 'ticktock', 'journals', f));
  }
  const unrealDir = path.join(repoRoot, 'tools', 'ant-hive-world', 'unreal-export');
  if (fs.existsSync(unrealDir)) {
    for (const f of fs.readdirSync(unrealDir)) {
      if (f === 'watch-imports.js' || f === 'README.md' || f === '__tests__' || f === 'ue') continue;
      const abs = path.join(unrealDir, f);
      if (fs.statSync(abs).isFile()) inventory.push(path.join('tools', 'ant-hive-world', 'unreal-export', f));
    }
  }

  assert(inventory.length > 0, 'the gen-2 write inventory must be non-empty for this oracle to prove anything');
  const outOfSurface = inventory.filter((p) => !surfaceMatches(p));
  assert(outOfSurface.length === 0, `every gen-2 write-inventory path must fall inside the run-004 charter's allowed_write_surfaces; out-of-surface: ${JSON.stringify(outOfSurface)}`);
});

check('the exact measured gen-2 spend tuple fits inside the template\'s literal floors (AC2b)', () => {
  const tuple = TEMPLATE.derivation.exact_gen2_tuple;
  const floor = TEMPLATE.min_max_cumulative_diff;
  assert(tuple.lines_changed <= floor.lines_changed, `${tuple.lines_changed} must fit inside floor ${floor.lines_changed}`);
  assert(tuple.files_changed <= floor.files_changed, `${tuple.files_changed} must fit inside floor ${floor.files_changed}`);
  assert(tuple.external_actions <= TEMPLATE.min_max_external_actions, `${tuple.external_actions} must fit inside floor ${TEMPLATE.min_max_external_actions}`);
});

check('createCharter stamps template_id + template_sha256 into every charter, and readCharter round-trips them', () => {
  const spec = charterSpecFrom(CHARTER, { charter_id: 'tt-template-roundtrip' });
  const c = charterMod.createCharter(spec);
  const p = path.join(tmpRoot, 'template-roundtrip-charter.json');
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
  const readBack = charterMod.readCharter(p);
  assert(readBack.template_id === TEMPLATE.template_id && readBack.template_sha256 === charterMod.TEMPLATE_HASH, 'template fields must round-trip through readCharter');
});

check('readCharter still validates a PRE-TEMPLATE historical charter (template_id/template_sha256 absent) -- backward compatibility', () => {
  const historical = JSON.parse(JSON.stringify(CHARTER));
  delete historical.template_id;
  delete historical.template_sha256;
  historical.charter_hash = 'placeholder';
  historical.charter_hash = charterMod.computeCharterHash(historical);
  const p = path.join(tmpRoot, 'pre-template-charter.json');
  fs.writeFileSync(p, JSON.stringify(historical, null, 2) + '\n');
  const readBack = charterMod.readCharter(p);
  assert(readBack.template_id === undefined && readBack.template_sha256 === undefined, 'a historical charter must validate with the template fields genuinely absent, not defaulted');
});

fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
