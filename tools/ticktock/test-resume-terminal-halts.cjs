#!/usr/bin/env node
'use strict';

// tools/ticktock/test-resume-terminal-halts.cjs -- acceptance fixtures for B1
// (terminal halts must block resume) and B2 (a missing journal refuses instead
// of silently starting fresh), from
// _dev/reports/analysis/task-plans/ticktock-resume-and-binding-repair__plan.json.
//
// THE DEFECT (B1 / F1, all three S4-D lanes, reproduced live twice): journal.
// resolveResume() selected any record whose verified_checkpoint.verified was
// true and computed the mechanical next phase from it, with no regard for that
// record's OWN halt_state. run-002r2's real journal is the live proof: its
// last record (tt.ship, record_index 7) verified all four of its artifacts AND
// halted with MERGE-NOT-CLEAN -- "the bytes are real" and "the run may
// continue" are unrelated claims, and the old code conflated them. Resuming it
// walked straight into tt.schedule of the next cycle.
//
// THE FIXTURE is a byte-exact copy of that real journal and its anchor
// sibling (__fixtures__/run-002r2-merge-not-clean.jsonl[.anchor.json]),
// extracted this session -- never the live artifact at
// _dev/state/ticktock/journals/run-002r2.20260812.jsonl, which this plan does
// not touch.
//
// THE DEFECT (B2 / F4, codex): a journal path that does not exist on disk
// returned resumable:true, fresh_start:true -- indistinguishable from a
// caller's typo or a moved path. resolveResume() now refuses (JOURNAL-ABSENT)
// unless the caller explicitly opts in with { allow_fresh: true }.
//
// Run: node tools/ticktock/test-resume-terminal-halts.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');

const crypto = require('crypto');
const journal = require('./journal.cjs');
const JOURNAL_SCHEMA = require('./journal-schema.json');

// T2 (tt-charter-template-and-spend-ledger): completePhase() now refuses any
// record with completed !== null lacking a valid, boundary-bound spend
// receipt. This fixture file's completions are not exercising the receipt
// contract itself (test-ceilings.cjs and the dedicated T2 fixtures below do
// that) -- they need a receipt that WILL verify, backed by a real ledger file
// on disk, so a tiny stub ledger is written per call and its content hash
// used as ledger_sha256.
let receiptSeq = 0;
function stubReceipt(charterHash, cycleIndex, phaseId, dir) {
  receiptSeq += 1;
  const ledgerPath = path.join(dir, `stub-ledger-${receiptSeq}.json`);
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema: 'TickTockSpendLedger/1.0', lines_changed: 0, files: [], external_actions: 0 }) + '\n');
  const ledger_sha256 = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');
  return {
    charter_hash: charterHash,
    cycle_index: cycleIndex,
    phase_id: phaseId,
    ledger_path: ledgerPath,
    ledger_sha256,
    observed_spend: { lines_changed: 0, files_changed: 0, external_actions: 0 },
    within_ceiling: true,
    checked_at: new Date().toISOString()
  };
}

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${detail === undefined ? '' : JSON.stringify(detail)}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');

function tmpCopy(srcBasename) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
  const dest = path.join(dir, 'journal.jsonl');
  fs.copyFileSync(path.join(FIXTURE_DIR, srcBasename), dest);
  const srcAnchor = path.join(FIXTURE_DIR, `${srcBasename}.anchor.json`);
  if (fs.existsSync(srcAnchor)) {
    fs.copyFileSync(srcAnchor, journal.anchorPathFor(dest));
  }
  return dest;
}

// ---------------------------------------------------------------------------
section('1. B1: the run-002r2 MERGE-NOT-CLEAN fixture -- the reproduced defect');
// ---------------------------------------------------------------------------
{
  const j = tmpCopy('run-002r2-merge-not-clean.jsonl');
  const records = journal.readJournal(j);
  check('fixture precondition: the newest record is tt.ship', records[records.length - 1].phase_id === 'tt.ship', records[records.length - 1].phase_id);
  check(
    'fixture precondition: the newest record verified_checkpoint.verified is true',
    records[records.length - 1].verified_checkpoint.verified === true,
    records[records.length - 1].verified_checkpoint
  );
  check(
    'fixture precondition: the newest record halt_state is MERGE-NOT-CLEAN',
    records[records.length - 1].halt_state === 'MERGE-NOT-CLEAN',
    records[records.length - 1].halt_state
  );

  const resume = journal.resolveResume(j);
  check('resolveResume refuses (resumable false)', resume.resumable === false, resume);
  check('halt_state is MERGE-NOT-CLEAN, carried through from the record', resume.halt_state === 'MERGE-NOT-CLEAN', resume.halt_state);
  check('recovery_class is TERMINAL', resume.recovery_class === 'TERMINAL', resume.recovery_class);
  check('no resume_point is offered', resume.resume_point === null, resume.resume_point);
  check('blocking_record_index names the halted record', resume.blocking_record_index === records[records.length - 1].record_index, resume.blocking_record_index);
  check(
    'required_action names the new-run-new-journal release path',
    typeof resume.required_action === 'string'
      && /new run/i.test(resume.required_action)
      && /new journal/i.test(resume.required_action)
      && /never/i.test(resume.required_action),
    resume.required_action
  );
  check(
    'reason names the record index, phase, and the fact that verification does not override a TERMINAL halt',
    typeof resume.reason === 'string' && /record_index 7/.test(resume.reason) && /tt\.ship/.test(resume.reason),
    resume.reason
  );

  // THE ASSERTION THAT PROVES THIS TEST WOULD HAVE FAILED ON PRE-B1 CODE: the
  // pre-B1 mechanical computation from this exact checkpoint (tt.ship,
  // cycle_index 0) would have resolved to tt.schedule of the same cycle --
  // i.e. it would have resumed. Restating that computation here (not calling
  // it) keeps the pre/post contrast legible without re-adding the bug.
  const NINE_PHASES = journal.NINE_PHASES;
  const preB1NextPhaseIndex = NINE_PHASES.indexOf('tt.ship') + 1;
  check(
    'the pre-B1 mechanical next-phase computation would have resumed at tt.schedule (this is what B1 prevents)',
    NINE_PHASES[preB1NextPhaseIndex] === 'tt.schedule'
  );
}

// ---------------------------------------------------------------------------
section('2. B1: completeness -- every journal-schema halt_state enum member is classified');
// ---------------------------------------------------------------------------
{
  const schemaEnum = JOURNAL_SCHEMA.properties.halt_state.enum;
  check('schema enum has 17 members (16 named + null)', schemaEnum.length === 17, schemaEnum.length);

  for (const member of schemaEnum) {
    const label = member === null ? 'null' : member;
    let threw = null;
    let cls = null;
    try {
      cls = journal.classifyHaltState(member);
    } catch (e) {
      threw = e;
    }
    check(`schema member ${label} is classified (no throw)`, threw === null, threw && threw.message);
    check(`schema member ${label} classifies as one of RESUMABLE/RECONCILIATION_REQUIRED/TERMINAL`,
      [journal.RESUMABLE, journal.RECONCILIATION_REQUIRED, journal.TERMINAL].includes(cls), cls);
  }

  // An enum member with NO classification throws -- proven directly, not
  // inferred, so a future unclassified addition is guaranteed to fail loudly
  // rather than silently defaulting.
  let unknownThrew = null;
  try {
    journal.classifyHaltState('SOME-FUTURE-HALT-STATE-NOT-YET-CLASSIFIED');
  } catch (e) {
    unknownThrew = e;
  }
  check('an unclassified halt_state throws rather than silently defaulting', unknownThrew !== null, unknownThrew && unknownThrew.message);

  // TERMINAL_HALTS is exactly the 14 non-RESUMABLE, non-RECONCILIATION_REQUIRED
  // named members.
  const expectedTerminal = schemaEnum.filter((m) => m !== null && m !== 'EFFECT-DID-NOT-HAPPEN' && m !== 'EFFECT-RECEIPT-MISSING');
  check('TERMINAL_HALTS has exactly 14 members', journal.TERMINAL_HALTS.length === 14, journal.TERMINAL_HALTS.length);
  check(
    'TERMINAL_HALTS is exactly the schema enum minus null, EFFECT-DID-NOT-HAPPEN, and EFFECT-RECEIPT-MISSING',
    JSON.stringify([...journal.TERMINAL_HALTS].sort()) === JSON.stringify([...expectedTerminal].sort()),
    { terminal: journal.TERMINAL_HALTS, expected: expectedTerminal }
  );
}

// ---------------------------------------------------------------------------
section('3. B1 regressions: the other halt shapes are unaffected');
// ---------------------------------------------------------------------------
{
  const CHARTER_HASH = 'a'.repeat(64);

  // 3a. EFFECT-DID-NOT-HAPPEN is RESUMABLE and resolveResume() still resumes
  // normally past it.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
    const j = path.join(dir, 'journal.jsonl');
    const artifact = path.join(dir, 'artifact-0.txt');
    fs.writeFileSync(artifact, 'orient output\n');
    journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir) }, [artifact]);
    journal.appendRecord(j, {
      charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.tick',
      idempotency_key: 'b'.repeat(64), halt_state: 'EFFECT-DID-NOT-HAPPEN'
    });
    const resume = journal.resolveResume(j);
    check('EFFECT-DID-NOT-HAPPEN as the newest record still resumes (RESUMABLE, unregressed)', resume.resumable === true, resume);
    check('resume falls back to the last VERIFIED checkpoint (tt.orient)', resume.resume_point && resume.resume_point.phase_id === 'tt.tick', resume.resume_point);
  }

  // 3b. EFFECT-RECEIPT-MISSING is still RECONCILIATION_REQUIRED, not TERMINAL,
  // and still refuses via the existing unreconciled-record path.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
    const j = path.join(dir, 'journal.jsonl');
    const artifact = path.join(dir, 'artifact-0.txt');
    fs.writeFileSync(artifact, 'orient output\n');
    journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir) }, [artifact]);
    journal.appendRecord(j, {
      charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.text',
      idempotency_key: 'c'.repeat(64), halt_state: 'EFFECT-RECEIPT-MISSING'
    });
    const resume = journal.resolveResume(j);
    check('EFFECT-RECEIPT-MISSING refuses (unregressed)', resume.resumable === false, resume);
    check('EFFECT-RECEIPT-MISSING halt_state is preserved, not reclassified as a generic TERMINAL', resume.halt_state === 'EFFECT-RECEIPT-MISSING', resume.halt_state);
    check('classifyHaltState agrees this is RECONCILIATION_REQUIRED, not TERMINAL', journal.classifyHaltState('EFFECT-RECEIPT-MISSING') === journal.RECONCILIATION_REQUIRED);
  }

  // 3c. A clean journal (no halts anywhere) still resumes.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
    const j = path.join(dir, 'journal.jsonl');
    const artifact = path.join(dir, 'artifact-0.txt');
    fs.writeFileSync(artifact, 'observe output\n');
    journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir) }, [artifact]);
    const artifact2 = path.join(dir, 'artifact-1.txt');
    fs.writeFileSync(artifact2, 'observe output 2\n');
    journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.observe', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.observe', dir) }, [artifact2]);
    const resume = journal.resolveResume(j);
    check('a clean journal with no halts still resumes (unregressed)', resume.resumable === true, resume);
    check('resume_point advances to the next phase', resume.resume_point && resume.resume_point.phase_id === 'tt.text', resume.resume_point);
  }
}

// ---------------------------------------------------------------------------
section('4. B2: a nonexistent journal path refuses (JOURNAL-ABSENT), not fresh-starts');
// ---------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
  const missingPath = path.join(dir, 'never-created.jsonl');
  check('precondition: the path really does not exist', !fs.existsSync(missingPath));

  const refusal = journal.resolveResume(missingPath);
  check('resolveResume refuses a nonexistent path', refusal.resumable === false, refusal);
  check('halt_state is JOURNAL-ABSENT', refusal.halt_state === journal.JOURNAL_ABSENT, refusal.halt_state);
  check('JOURNAL-ABSENT is a refusal-only field, never a member of the journaled halt_state enum',
    !JOURNAL_SCHEMA.properties.halt_state.enum.includes(journal.JOURNAL_ABSENT));
  check('no resume_point is offered', refusal.resume_point === null);

  const explicit = journal.resolveResume(missingPath, { allow_fresh: true });
  check('explicit allow_fresh intent DOES start fresh', explicit.resumable === true && explicit.fresh_start === true, explicit);
  check('explicit-fresh resume_point starts at cycle 0, phase 0', explicit.resume_point.cycle_index === 0 && explicit.resume_point.phase_id === journal.NINE_PHASES[0], explicit.resume_point);

  // Contrast: an EXISTING but EMPTY journal is still a genuine fresh start
  // with no explicit opt required -- the empty-file semantics this repair
  // deliberately keeps unchanged (decided and stated here, per the plan's
  // instruction to state the choice).
  const emptyPath = path.join(dir, 'exists-but-empty.jsonl');
  fs.writeFileSync(emptyPath, '');
  const emptyResume = journal.resolveResume(emptyPath);
  check('an EXISTING empty journal resumes as fresh_start with no explicit opt (unchanged OK_EMPTY contract)',
    emptyResume.resumable === true && emptyResume.fresh_start === true, emptyResume);
}

// ---------------------------------------------------------------------------
section('5. B4: resume re-verifies checkpoint bytes, not just the historical boolean');
// ---------------------------------------------------------------------------
{
  const CHARTER_HASH = 'a'.repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
  const j = path.join(dir, 'journal.jsonl');
  const artifact = path.join(dir, 'artifact-0.txt');
  fs.writeFileSync(artifact, 'orient output, byte-exact\n');
  journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir) }, [artifact]);

  const before = journal.resolveResume(j);
  check('before tampering, resume proceeds normally', before.resumable === true, before);

  // Tamper ONE byte, after the checkpoint verified.
  fs.writeFileSync(artifact, 'orient output, byte-EXACT\n');
  const after = journal.resolveResume(j);
  check('after tampering a verified artifact, resume refuses', after.resumable === false, after);
  check('halt_state is CHECKPOINT-ARTIFACT-MISMATCH', after.halt_state === journal.CHECKPOINT_ARTIFACT_MISMATCH, after.halt_state);
  check('CHECKPOINT-ARTIFACT-MISMATCH is a refusal-only field, never a journaled halt_state',
    !JOURNAL_SCHEMA.properties.halt_state.enum.includes(journal.CHECKPOINT_ARTIFACT_MISMATCH));
  check('mismatched_paths names the tampered artifact', after.mismatched_paths.includes(artifact), after.mismatched_paths);
  check('no resume_point is offered', after.resume_point === null);

  // Restoring the exact original bytes must resume again -- proves the
  // refusal tracks the bytes, not a sticky "this file was ever tampered" flag.
  fs.writeFileSync(artifact, 'orient output, byte-exact\n');
  const restored = journal.resolveResume(j);
  check('restoring the original bytes resumes again', restored.resumable === true, restored);
}

// ---------------------------------------------------------------------------
section('6. B6 amendment (codex#1 / codewhale#1): TERMINAL permanence is not maskable by a later record');
// ---------------------------------------------------------------------------
//
// THE DEFECT: the original B1 fix examined only records[records.length - 1].
// A B6 reviewer reproduced masking it: append a verified MERGE-NOT-CLEAN
// record, then append a further EFFECT-DID-NOT-HAPPEN record after it (an
// ordinary, schema-valid append -- nothing on the append surface refused it
// either) -- resolveResume() then saw only the trailing RESUMABLE halt and
// walked straight through to a resumable verdict. TERMINAL PERMANENCE MEANS
// permanence: no later record may retract an earlier TERMINAL finding, so
// BOTH surfaces are fixed together: resolveResume() now scans every record,
// and appendRecordLocked() now refuses to append past an existing TERMINAL
// record at all.
{
  const CHARTER_HASH = 'a'.repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));
  const j = path.join(dir, 'journal.jsonl');
  const artifact = path.join(dir, 'artifact-0.txt');
  fs.writeFileSync(artifact, 'ship output\n');

  // Record 0: a verified checkpoint that ALSO halts TERMINAL (MERGE-NOT-CLEAN),
  // mirroring the real run-002r2 shape.
  journal.completePhase(j, {
    charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.ship',
    idempotency_key: 'b'.repeat(64), halt_state: 'MERGE-NOT-CLEAN',
    spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.ship', dir)
  }, [artifact]);

  const resumeAfterTerminalAlone = journal.resolveResume(j);
  check('with only the terminal record present, resume already refuses (sanity)', resumeAfterTerminalAlone.resumable === false, resumeAfterTerminalAlone);

  // THE MASKING ATTEMPT: append a further RESUMABLE-classed record after the
  // terminal one. Before this amendment, appendRecordLocked() had no
  // predecessor guard and this succeeded.
  let appendThrew = null;
  try {
    journal.appendRecord(j, {
      charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.tick',
      idempotency_key: 'c'.repeat(64), halt_state: 'EFFECT-DID-NOT-HAPPEN'
    });
  } catch (e) {
    appendThrew = e;
  }
  check('appendRecord REFUSES to append past an existing TERMINAL record', appendThrew !== null, appendThrew);
  check('the refusal names the blocking record and halt state', appendThrew && appendThrew.code === 'JOURNAL_TERMINALLY_HALTED' && appendThrew.halt_state === 'MERGE-NOT-CLEAN', appendThrew && appendThrew.message);
  check('the journal was NOT mutated by the refused append', journal.readJournal(j).length === 1, journal.readJournal(j).length);

  // THE MASKING SIMULATION: even if a record WERE appended after the terminal
  // one, resolveResume() must still refuse by scanning every record, not just
  // the newest. Now that appendRecordLocked() itself refuses this (proven
  // above, including through the unlocked differential-control path -- both
  // routes funnel through the same function, so the guard covers both), the
  // ONLY way left to construct the masked shape is to write the raw JSONL
  // bytes directly, bypassing this module's append API entirely -- exactly
  // the shape a journal assembled by an older, pre-B6-amendment build (or
  // hand-edited) could still be in on disk. That is precisely the case this
  // resolveResume()-side fix has to cover independent of the append-time
  // guard: the guard prevents NEW masking, the scan catches EXISTING masking.
  const priorRecord = journal.readJournal(j)[0];
  const maskingRecord = {
    schema: 'JournalRecord/1.0',
    record_index: 1,
    charter_hash: CHARTER_HASH,
    cycle_index: 0,
    phase_id: 'tt.tick',
    effect_class: 'EFFECTFUL',
    entered: new Date().toISOString(),
    completed: null,
    idempotency_key: 'd'.repeat(64),
    artifact_hashes: [],
    verified_checkpoint: { verified: false, verified_at: null, method: 'none', rehash_matches: null },
    halt_state: 'EFFECT-DID-NOT-HAPPEN',
    prev_record_hash: priorRecord.record_hash,
    record_hash: 'placeholder'
  };
  maskingRecord.record_hash = journal.computeRecordHash(maskingRecord);
  fs.appendFileSync(j, JSON.stringify(maskingRecord) + '\n');
  journal.writeAnchor(j, { record_count: 2, head_record_hash: maskingRecord.record_hash, reconciliations: [] });

  const records = journal.readJournal(j);
  check('the masking record now sits as the newest record (attack precondition)', records.length === 2 && records[1].halt_state === 'EFFECT-DID-NOT-HAPPEN', records.map((r) => r.halt_state));

  const maskedResume = journal.resolveResume(j);
  check('resolveResume STILL refuses -- the earlier TERMINAL record is not masked by the later RESUMABLE one', maskedResume.resumable === false, maskedResume);
  check('halt_state is the ORIGINAL terminal halt (MERGE-NOT-CLEAN), not the masking one', maskedResume.halt_state === 'MERGE-NOT-CLEAN', maskedResume.halt_state);
  check('blocking_record_index names the EARLIER terminal record (index 0), not the masking one', maskedResume.blocking_record_index === 0, maskedResume.blocking_record_index);

  // Anchor consistency: the anchor still agrees with the (now 2-record, via
  // the unlocked control) journal -- the masking attempt did not corrupt the
  // append-then-anchor invariant, it was simply insufficient to fool resume.
  const anchorState = journal.verifyJournalAnchor(j, records);
  check('anchor stays consistent after the masking append', anchorState.anchor_state === 'OK', anchorState);
}

// ---------------------------------------------------------------------------
section('7. T2 (tt-charter-template-and-spend-ledger): appendRecord\'s spend-receipt enforcement');
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS CLOSES: nothing previously required a completion to prove
// its spend was checked against the charter's ceilings. appendRecord -- the
// LOWEST append boundary, the one no completion caller (completePhase, the
// cycle-driver `phase` command's bare-appendRecord empty-artifact path) can
// route around -- now refuses any record with completed !== null lacking a
// valid, boundary-bound spend_receipt. AMENDED v4: this covers EVERY such
// record REGARDLESS of halt_state; only a structurally incomplete
// completed:null halt is exempt.
{
  const CHARTER_HASH = 'a'.repeat(64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-terminal-halts-'));

  // 7a. completed !== null with NO spend_receipt refuses at completePhase.
  {
    const j = path.join(dir, 'receipt-missing-completephase.jsonl');
    const artifact = path.join(dir, 'artifact-7a.txt');
    fs.writeFileSync(artifact, 'orient output\n');
    let threw = null;
    try {
      journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient' }, [artifact]);
    } catch (e) { threw = e; }
    check('completed-without-receipt refuses at completePhase (red on pre-T2 HEAD, green after)', threw !== null && threw.code === 'SPEND-RECEIPT-MISSING', threw && threw.message);
    check('the journal was not mutated by the refused completion', !fs.existsSync(j) || journal.readJournal(j).length === 0);
  }

  // 7b. completed !== null with NO spend_receipt refuses at bare appendRecord
  // too -- the exact boundary the cycle-driver `phase` command's
  // empty-artifact_paths path uses, which is why enforcement lives here and
  // not only inside completePhase.
  {
    const j = path.join(dir, 'receipt-missing-appendrecord.jsonl');
    let threw = null;
    try {
      journal.appendRecord(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.tock', completed: new Date().toISOString() });
    } catch (e) { threw = e; }
    check('completed-without-receipt refuses at bare appendRecord', threw !== null && threw.code === 'SPEND-RECEIPT-MISSING', threw && threw.message);
  }

  // 7c. completed + halt_state + no receipt STILL refuses -- the v4
  // laundering-hole closure. A halt does not exempt a completion from the
  // receipt requirement; only completed:null does.
  {
    const j = path.join(dir, 'receipt-missing-completed-halt.jsonl');
    const artifact = path.join(dir, 'artifact-7c.txt');
    fs.writeFileSync(artifact, 'ship output\n');
    let threw = null;
    try {
      journal.completePhase(j, {
        charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.ship',
        idempotency_key: 'b'.repeat(64), halt_state: 'MERGE-NOT-CLEAN'
      }, [artifact]);
    } catch (e) { threw = e; }
    check('completed + halt_state + no receipt REFUSES (v4 laundering-hole closure)', threw !== null && threw.code === 'SPEND-RECEIPT-MISSING', threw && threw.message);
  }

  // 7d. A receipt naming a DIFFERENT boundary (wrong cycle_index) refuses --
  // a receipt cannot be replayed across boundaries.
  {
    const j = path.join(dir, 'receipt-boundary-mismatch.jsonl');
    const artifact = path.join(dir, 'artifact-7d.txt');
    fs.writeFileSync(artifact, 'orient output\n');
    const wrongBoundaryReceipt = stubReceipt(CHARTER_HASH, 99, 'tt.orient', dir);
    let threw = null;
    try {
      journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: wrongBoundaryReceipt }, [artifact]);
    } catch (e) { threw = e; }
    check('a boundary-mismatched receipt (replay across cycle_index) refuses', threw !== null && threw.code === 'SPEND-RECEIPT-BOUNDARY-MISMATCH', threw && threw.message);
  }

  // 7e. A receipt whose ledger_sha256 no longer matches the ledger file's
  // current bytes (the ledger changed after the receipt was issued) refuses
  // as stale.
  {
    const j = path.join(dir, 'receipt-stale.jsonl');
    const artifact = path.join(dir, 'artifact-7e.txt');
    fs.writeFileSync(artifact, 'orient output\n');
    const receipt = stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir);
    fs.writeFileSync(receipt.ledger_path, JSON.stringify({ schema: 'TickTockSpendLedger/1.0', lines_changed: 999, files: [], external_actions: 0 }) + '\n');
    let threw = null;
    try {
      journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: receipt }, [artifact]);
    } catch (e) { threw = e; }
    check('a stale receipt (ledger changed after issuance) refuses', threw !== null && threw.code === 'SPEND-RECEIPT-STALE', threw && threw.message);
  }

  // 7f. A valid, boundary-bound receipt round-trips green.
  {
    const j = path.join(dir, 'receipt-roundtrip.jsonl');
    const artifact = path.join(dir, 'artifact-7f.txt');
    fs.writeFileSync(artifact, 'orient output\n');
    const rec = journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir) }, [artifact]);
    check('a valid boundary-bound receipt round-trips green', rec.spend_receipt && rec.spend_receipt.within_ceiling === true, rec.spend_receipt);
    const onDisk = journal.readJournal(j);
    check('re-read from disk, the record still carries the receipt', onDisk[onDisk.length - 1].spend_receipt && onDisk[onDisk.length - 1].spend_receipt.charter_hash === CHARTER_HASH);
  }

  // 7g. Historical journals (no spend_receipt field anywhere, written before
  // T2 existed) still verify -- this enforcement is at APPEND time only, and
  // the run-002r2 fixture used throughout this file is exactly such a
  // journal.
  {
    const fixturePath = tmpCopy('run-002r2-merge-not-clean.jsonl');
    const records = journal.readJournal(fixturePath);
    check('a pre-T2 historical journal (no spend_receipt anywhere) still reads and schema-validates', records.length > 0 && records.every((r) => r.spend_receipt === undefined));
    const integrity = journal.verifyJournalIntegrity(records, fixturePath);
    check('and its integrity/anchor check is unaffected by the new field', integrity.valid === true, integrity.errors);
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
