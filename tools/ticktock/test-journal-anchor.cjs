#!/usr/bin/env node
'use strict';

// tools/ticktock/test-journal-anchor.cjs -- acceptance tests for the journal
// head anchor (review finding F3).
//
// The defect these exist for: deleting the FINAL journal record left a file
// that passed verifyJournalIntegrity() and resumed, because a hash chain has
// nothing to check the tail against. Every test below is written to FAIL on the
// pre-anchor code, which is the only reason to trust that it passes on the new
// code for the right reason.
//
// Run: node tools/ticktock/test-journal-anchor.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');

const journal = require('./journal.cjs');

let passed = 0;
let failed = 0;
let inconclusive = 0;

// For a check whose OUTCOME depends on OS scheduling. It is reported, never
// counted as a pass or a failure: a control that did not happen to trigger this
// time has not disproved anything, and dressing that up as a pass would be the
// same overstatement the reviewed defects are about.
function control(name, triggered, detail) {
  if (triggered) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    inconclusive += 1;
    process.stdout.write(`  INCONCLUSIVE  ${name}\n        the control did not trigger on this run; it proves nothing either way\n        ${detail === undefined ? '' : JSON.stringify(detail)}\n`);
  }
}

function check(name, condition, detail) {
  if (condition) {
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

function freshJournal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-journal-anchor-'));
  return path.join(dir, 'journal.jsonl');
}

const CHARTER_HASH = 'a'.repeat(64);

// T2 (tt-charter-template-and-spend-ledger): completePhase() now refuses any
// record with completed !== null lacking a valid, boundary-bound spend
// receipt. This file's completions are exercising the anchor/truncation
// contract, not the receipt contract (test-resume-terminal-halts.cjs section
// 7 does that), so a stub receipt backed by a real on-disk ledger file is
// built per call.
let receiptSeq = 0;
function stubReceipt(charterHash, cycleIndex, phaseId, dir) {
  receiptSeq += 1;
  // Codex PR#20 (round 2): appendRecordLocked now requires the ledger's own
  // charter_hash/charter_id identity fields unconditionally, with charter_id
  // resolving to the ledger's canonical <charter_id>.json filename.
  const stubCharterId = `stub-ledger-${receiptSeq}`;
  const ledgerPath = path.join(dir, `${stubCharterId}.json`);
  fs.writeFileSync(ledgerPath, JSON.stringify({
    schema: 'TickTockSpendLedger/1.0',
    charter_hash: charterHash,
    charter_id: stubCharterId,
    lines_changed: 0,
    files: [],
    external_actions: 0
  }) + '\n');
  const ledger_sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');
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

// A small run: two completed PURE phases, each with a verified checkpoint over
// a real file on disk, so resolveResume() has something legitimate to resume
// from and a truncation has something real to destroy.
function buildRun(journalPath) {
  const dir = path.dirname(journalPath);
  const artifacts = [];
  for (const [i, phase] of ['tt.orient', 'tt.observe'].entries()) {
    const artifact = path.join(dir, `artifact-${i}.txt`);
    fs.writeFileSync(artifact, `phase ${phase} output\n`);
    artifacts.push(artifact);
    journal.completePhase(journalPath, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: phase, spend_receipt: stubReceipt(CHARTER_HASH, 0, phase, dir) }, [artifact]);
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
section('1. Normal operation: the anchor tracks the head and resume works');
// ---------------------------------------------------------------------------
{
  const j = freshJournal();
  buildRun(j);
  const records = journal.readJournal(j);
  const anchor = journal.verifyJournalAnchor(j, records);
  const integrity = journal.verifyJournalIntegrity(records, j);
  const resume = journal.resolveResume(j);

  check('anchor file exists beside the journal', fs.existsSync(journal.anchorPathFor(j)));
  check('anchor_state is OK', anchor.anchor_state === 'OK', anchor);
  check('anchor record_count equals the journal length', anchor.expected_record_count === 2, anchor);
  check('anchor head hash equals the last record_hash', anchor.expected_head_record_hash === records[1].record_hash);
  check('integrity valid with the anchor checked', integrity.valid === true && integrity.anchor_checked === true, integrity.errors);
  check('integrity claims tail truncation is detectable', integrity.tail_truncation_detectable === true);
  check('resume proceeds', resume.resumable === true, resume.reason);
}

// ---------------------------------------------------------------------------
section('2. THE F3 DEFECT: deleting the FINAL record must be detected');
// ---------------------------------------------------------------------------
{
  const j = freshJournal();
  buildRun(j);
  const before = journal.readJournal(j);

  // Truncate the tail: drop the last line, exactly as an interrupted write or a
  // hand edit would.
  const lines = fs.readFileSync(j, 'utf8').split('\n').filter((l) => l.trim() !== '');
  fs.writeFileSync(j, lines.slice(0, -1).join('\n') + '\n');
  const after = journal.readJournal(j);

  check('the tail really was removed', before.length === 2 && after.length === 1);

  // The old behavior, preserved and asserted so the test says WHY the anchor is
  // needed rather than merely that it works: the chain alone still passes.
  const chainOnly = journal.verifyJournalIntegrity(after);
  check('chain-only verification still passes on the truncated file (this is the defect)', chainOnly.valid === true, chainOnly.errors);
  check('chain-only verification admits it cannot detect truncation', chainOnly.tail_truncation_detectable === false);

  const anchor = journal.verifyJournalAnchor(j, after);
  check('anchor_state is ANCHOR_AHEAD', anchor.anchor_state === 'ANCHOR_AHEAD', anchor);
  check('anchor reports one missing record', anchor.missing_record_count === 1, anchor);

  const integrity = journal.verifyJournalIntegrity(after, j);
  check('anchored verification FAILS on the truncated file', integrity.valid === false);
  check('the failure names the HEAD_ANCHOR check', integrity.errors.some((e) => e.check === 'HEAD_ANCHOR'), integrity.errors);

  const resume = journal.resolveResume(j);
  check('resume is REFUSED', resume.resumable === false, resume);
  check('halt_state is JOURNAL-ANCHOR-MISMATCH', resume.halt_state === 'JOURNAL-ANCHOR-MISMATCH', resume.halt_state);
  check('no resume_point is offered', resume.resume_point === null);

  // Re-anchoring must not be the escape hatch: the records the anchor vouched
  // for are gone, and moving the anchor would erase the evidence.
  const recon = journal.reconcileAnchor(j, { reason: 'test', authorized_by: 'test' });
  check('reconcileAnchor REFUSES to re-anchor over a truncation', recon.reconciled === false, recon.reason);
}

// ---------------------------------------------------------------------------
section('3. The crash window: append succeeded, anchor write did not');
// ---------------------------------------------------------------------------
{
  const j = freshJournal();
  buildRun(j);

  // Simulate a crash between the append and the anchor write by rolling the
  // anchor back to the previous head. The journal is untouched and internally
  // perfect; only the anchor lags.
  const records = journal.readJournal(j);
  journal.writeAnchor(j, { record_count: 1, head_record_hash: records[0].record_hash });

  const chainOnly = journal.verifyJournalIntegrity(records);
  check('the journal chain itself is intact', chainOnly.valid === true, chainOnly.errors);

  const anchor = journal.verifyJournalAnchor(j, records);
  check('anchor_state is ANCHOR_BEHIND', anchor.anchor_state === 'ANCHOR_BEHIND', anchor);
  check('the crash state is DISTINGUISHABLE from truncation', anchor.anchor_state !== 'ANCHOR_AHEAD');
  check('anchor reports one unanchored record', anchor.unanchored_record_count === 1, anchor);

  const resume = journal.resolveResume(j);
  check('the crash window is a DETECTED HALT, not a silent accept', resume.resumable === false, resume);
  check('halt_state is JOURNAL-ANCHOR-MISMATCH', resume.halt_state === 'JOURNAL-ANCHOR-MISMATCH');
  check('the halt says reconciliation is required first', resume.reconciliation_required_before_resume === true);

  // And the deliberate, recorded way out.
  const recon = journal.reconcileAnchor(j, { reason: 'crash between append and anchor write', authorized_by: 'test-harness' });
  check('reconcileAnchor accepts the crash-window state', recon.reconciled === true, recon.reason);
  check('the reconciliation is recorded on the anchor', recon.anchor.reconciliations.length === 1, recon.anchor.reconciliations);
  check('the record names why and who', recon.anchor.reconciliations[0].reason === 'crash between append and anchor write'
    && recon.anchor.reconciliations[0].authorized_by === 'test-harness');

  const after = journal.resolveResume(j);
  check('resume proceeds only AFTER explicit reconciliation', after.resumable === true, after.reason);

  // The next append must not lose the reconciliation history.
  const artifact = path.join(path.dirname(j), 'artifact-2.txt');
  fs.writeFileSync(artifact, 'more\n');
  journal.completePhase(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.research', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.research', path.dirname(j)) }, [artifact]);
  const carried = journal.readAnchor(j);
  check('a later append carries the reconciliation history forward', carried.anchor.reconciliations.length === 1);
  check('a later append re-anchors to the new head', carried.anchor.record_count === 3);
}

// ---------------------------------------------------------------------------
section('4. The other ways the anchor can disagree');
// ---------------------------------------------------------------------------
{
  // 4a. Anchor deleted outright -- the obvious bypass, so it must not be one.
  const j = freshJournal();
  buildRun(j);
  fs.rmSync(journal.anchorPathFor(j));
  const missing = journal.verifyJournalAnchor(j, journal.readJournal(j));
  check('deleting the anchor is ANCHOR_MISSING, not a pass', missing.anchor_state === 'ANCHOR_MISSING' && missing.valid === false, missing);
  check('resume is refused with no anchor', journal.resolveResume(j).resumable === false);

  // 4b. Anchor edited by hand without recomputing its own hash.
  const k = freshJournal();
  buildRun(k);
  const ap = journal.anchorPathFor(k);
  const tampered = JSON.parse(fs.readFileSync(ap, 'utf8'));
  tampered.record_count = 1;
  fs.writeFileSync(ap, JSON.stringify(tampered, null, 2));
  const corrupt = journal.verifyJournalAnchor(k, journal.readJournal(k));
  check('a hand-edited anchor is ANCHOR_CORRUPT', corrupt.anchor_state === 'ANCHOR_CORRUPT' && corrupt.valid === false, corrupt);

  // 4c. Final record REPLACED rather than removed: same count, different head.
  const m = freshJournal();
  buildRun(m);
  const recs = journal.readJournal(m);
  const swapped = { ...recs[1], entered: '2000-01-01T00:00:00.000Z' };
  swapped.record_hash = journal.computeRecordHash(swapped);
  const lines = [JSON.stringify(recs[0]), JSON.stringify(swapped)];
  fs.writeFileSync(m, lines.join('\n') + '\n');
  const replaced = journal.verifyJournalAnchor(m, journal.readJournal(m));
  check('a replaced final record is HEAD_MISMATCH', replaced.anchor_state === 'HEAD_MISMATCH' && replaced.valid === false, replaced);
  check('the chain alone would have accepted the replacement', journal.verifyJournalIntegrity(journal.readJournal(m)).valid === true);

  // 4d. B2 (F4 repair): a NONEXISTENT journal path refuses (JOURNAL-ABSENT)
  // rather than inferring a fresh start -- a typo'd path and a genuine new run
  // are the same shape on disk (no file), and only an explicit allow_fresh may
  // resolve that ambiguity as "start fresh". This is the behavior CHANGE from
  // the pre-B2 code, which treated a missing path exactly like an existing
  // empty one.
  const n = freshJournal();
  check('a nonexistent journal path does NOT exist on disk (precondition)', !fs.existsSync(n));
  const missingJournal = journal.resolveResume(n);
  check('a nonexistent journal path refuses, not resumes', missingJournal.resumable === false, missingJournal);
  check('halt_state is JOURNAL-ABSENT', missingJournal.halt_state === journal.JOURNAL_ABSENT, missingJournal.halt_state);
  check('no resume_point is offered for a missing path', missingJournal.resume_point === null, missingJournal);
  const explicitFresh = journal.resolveResume(n, { allow_fresh: true });
  check('explicit allow_fresh on a missing path IS a fresh start', explicitFresh.resumable === true && explicitFresh.fresh_start === true, explicitFresh);

  // 4e. An EXISTING but EMPTY journal file is still a genuine fresh start
  // (OK_EMPTY semantics, unchanged): the file being present at all is the
  // caller having deliberately created it.
  const emptyPath = freshJournal();
  fs.mkdirSync(path.dirname(emptyPath), { recursive: true });
  fs.writeFileSync(emptyPath, '');
  const empty = journal.resolveResume(emptyPath);
  check('an existing empty journal with no anchor still resumes as a fresh start', empty.resumable === true && empty.fresh_start === true, empty);
}

// ---------------------------------------------------------------------------
section('5. DEFECT D1: a torn tail must HALT, not throw');
// ---------------------------------------------------------------------------
//
// The failure this replaces: readJournal() threw on the partial final line, so
// the exception escaped resolveResume() before it could return a refusal. A
// process killed mid-append is the most likely way a real journal breaks, and
// it was the one case that produced a stack trace instead of a halt_state.
{
  const j = freshJournal();
  buildRun(j);

  // Exactly what an interrupted appendFileSync leaves: a prefix of the record
  // and NO terminating newline.
  const whole = fs.readFileSync(j, 'utf8');
  fs.writeFileSync(j, `${whole}{"schema":"JournalRecord/1.0","record_index":2,"charter_ha`);

  let threw = null;
  let resume = null;
  try {
    resume = journal.resolveResume(j);
  } catch (e) {
    threw = e;
  }
  check('resolveResume does NOT throw on a torn tail (this is the defect)', threw === null, threw && threw.message);
  check('resume is refused', resume && resume.resumable === false, resume);
  check('halt_state is JOURNAL-TORN-TAIL', resume && resume.halt_state === 'JOURNAL-TORN-TAIL', resume && resume.halt_state);
  check('the halt names the parse state', resume && resume.parse_state === 'TORN_TAIL', resume && resume.parse_state);
  check('the halt reports the file does not end in a newline', resume && resume.ends_with_newline === false);
  check('the halt counts the complete records that survived', resume && resume.complete_record_count === 2, resume && resume.complete_record_count);
  check('the halt names the torn line index', resume && resume.malformed.length === 1 && resume.malformed[0].line_index === 2, resume && resume.malformed);
  check('no resume_point is offered', resume && resume.resume_point === null);
  check('reconciliation is required before resume', resume && resume.reconciliation_required_before_resume === true);
  check('JOURNAL-TORN-TAIL is a declared halt state', journal.HALT_STATES.includes('JOURNAL-TORN-TAIL'));

  // scanJournal is the discriminator, and it is directly inspectable.
  const scan = journal.scanJournal(j);
  check('scanJournal classifies it as TORN_TAIL', scan.parse_state === 'TORN_TAIL', scan.parse_state);
  check('scanJournal still returns the complete records for inspection', scan.records.length === 2);

  // The repair function must refuse structurally too, not throw.
  let reconThrew = null;
  let recon = null;
  try {
    recon = journal.reconcileAnchor(j, { reason: 'test', authorized_by: 'test' });
  } catch (e) {
    reconThrew = e;
  }
  check('reconcileAnchor does not throw on a torn tail', reconThrew === null, reconThrew && reconThrew.message);
  check('reconcileAnchor refuses to re-anchor an unparsable journal', recon && recon.reconciled === false, recon);
  check('reconcileAnchor names the same halt state', recon && recon.halt_state === 'JOURNAL-TORN-TAIL', recon && recon.halt_state);

  // readJournal still throws for its own callers, but now carries the finding.
  let readErr = null;
  try { journal.readJournal(j); } catch (e) { readErr = e; }
  check('readJournal still throws, but carries the halt state', readErr && readErr.halt_state === 'JOURNAL-TORN-TAIL', readErr && readErr.message);
}

// ---------------------------------------------------------------------------
section('6. DEFECT D1: a malformed MIDDLE line is a DIFFERENT finding');
// ---------------------------------------------------------------------------
//
// A truncated write can only remove a suffix. So a broken line with complete
// lines after it, or a broken line that is newline-terminated, cannot be the
// residue of an interrupted append -- something rewrote a line that had already
// landed. Same refusal, different halt state, because it sends a human to a
// different question.
{
  // 6a. Broken line in the middle, complete lines after it.
  const j = freshJournal();
  buildRun(j);
  const lines = fs.readFileSync(j, 'utf8').split('\n').filter((l) => l.trim() !== '');
  fs.writeFileSync(j, `${lines[0]}\n{"schema":"JournalRecord/1.0", TAMPERED\n${lines[1]}\n`);

  const resume = journal.resolveResume(j);
  check('a mid-file malformed line refuses without throwing', resume.resumable === false, resume);
  check('halt_state is JOURNAL-MALFORMED-RECORD, not TORN-TAIL', resume.halt_state === 'JOURNAL-MALFORMED-RECORD', resume.halt_state);
  check('the two unparsable-file halts are DISTINGUISHABLE', resume.halt_state !== 'JOURNAL-TORN-TAIL');
  check('the halt names the offending line', resume.malformed.length === 1 && resume.malformed[0].line_index === 1, resume.malformed);
  check('JOURNAL-MALFORMED-RECORD is a declared halt state', journal.HALT_STATES.includes('JOURNAL-MALFORMED-RECORD'));

  // 6b. A broken FINAL line that IS newline-terminated. Position alone would
  // call this torn; the newline proves the write completed, so it is tampering.
  const k = freshJournal();
  buildRun(k);
  fs.appendFileSync(k, '{"schema":"JournalRecord/1.0", NOT JSON}\n');
  const r2 = journal.resolveResume(k);
  check('a newline-terminated broken final line is NOT called torn', r2.halt_state === 'JOURNAL-MALFORMED-RECORD', r2.halt_state);
  check('the discriminator is the terminating newline, and it is reported', r2.ends_with_newline === true);

  // 6c. Two broken lines is never a single interrupted write.
  const m = freshJournal();
  buildRun(m);
  fs.writeFileSync(m, 'BROKEN ONE\nBROKEN TWO');
  const r3 = journal.resolveResume(m);
  check('two broken lines is MALFORMED, not torn, even with no trailing newline', r3.halt_state === 'JOURNAL-MALFORMED-RECORD', r3.halt_state);
  check('every malformed line is reported, not just the first', r3.malformed.length === 2, r3.malformed);
}

// ---------------------------------------------------------------------------
section('7. DEFECT D1: failures on the FIRST record');
// ---------------------------------------------------------------------------
//
// The empty-and-almost-empty edges, where an off-by-one in the anchor reporting
// would either crash or silently pass.
{
  // 7a. Crash during the very first append: a partial line and no anchor at all,
  // because the anchor is written after the append.
  const j = freshJournal();
  fs.mkdirSync(path.dirname(j), { recursive: true });
  fs.writeFileSync(j, '{"schema":"JournalRecord/1.0","record_ind');
  const resume = journal.resolveResume(j);
  check('a torn FIRST record halts rather than throwing', resume.resumable === false && resume.halt_state === 'JOURNAL-TORN-TAIL', resume);
  check('it is NOT mistaken for a fresh start', resume.fresh_start !== true && resume.resume_point === null, resume);
  check('it reports zero complete records', resume.complete_record_count === 0, resume.complete_record_count);

  // 7b. The single-record journal truncated to nothing, anchor still vouching
  // for one record. records.length is 0 here, which is the index edge.
  const k = freshJournal();
  const dir = path.dirname(k);
  const artifact = path.join(dir, 'only.txt');
  fs.writeFileSync(artifact, 'one\n');
  journal.completePhase(k, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient', spend_receipt: stubReceipt(CHARTER_HASH, 0, 'tt.orient', dir) }, [artifact]);
  fs.writeFileSync(k, '');

  const anchor = journal.verifyJournalAnchor(k, journal.readJournal(k));
  check('an emptied journal with a live anchor is ANCHOR_AHEAD', anchor.anchor_state === 'ANCHOR_AHEAD' && anchor.valid === false, anchor);
  check('it reports the one missing record', anchor.missing_record_count === 1, anchor);

  const integrity = journal.verifyJournalIntegrity([], k);
  check('anchored verification fails on the emptied journal', integrity.valid === false);
  check('the HEAD_ANCHOR error indexes at 0 rather than -1', integrity.errors.some((e) => e.check === 'HEAD_ANCHOR' && e.record_index === 0), integrity.errors);

  const r = journal.resolveResume(k);
  check('an emptied-but-anchored journal is NOT a fresh start', r.resumable === false && r.fresh_start !== true, r);
  check('halt_state is JOURNAL-ANCHOR-MISMATCH', r.halt_state === 'JOURNAL-ANCHOR-MISMATCH', r.halt_state);

  const recon = journal.reconcileAnchor(k, { reason: 'test', authorized_by: 'test' });
  check('reconcileAnchor refuses to re-anchor away the only record', recon.reconciled === false, recon.reason);
}

// ---------------------------------------------------------------------------
section('8. DEFECT D2: concurrent appenders are serialized');
// ---------------------------------------------------------------------------
//
// The defect: appendRecord() read the journal, derived record_index and
// prev_record_hash, and appended, with nothing preventing a second writer from
// deriving the same two values from the same read. The repair is an exclusive
// O_EXCL writer lock around the whole read-derive-append-anchor section.
//
// Two tests, because a race that does not happen to occur proves nothing:
// 8a shows real concurrent processes producing an intact chain, and 8b shows
// the exclusion MECHANICALLY -- a held lock refuses a second writer outright,
// which is a deterministic assertion rather than a hope about scheduling.
{
  const { spawn } = require('child_process');

  // 8a. Four real processes, three appends each.
  const j = freshJournal();
  const dir = path.dirname(j);
  const worker = path.join(dir, 'worker.cjs');
  fs.writeFileSync(worker, `'use strict';
const journal = require(${JSON.stringify(path.resolve(__dirname, 'journal.cjs'))});
const [, , journalPath, id, marker] = process.argv;
for (let i = 0; i < 3; i += 1) {
  journal.appendRecord(journalPath, {
    charter_hash: ${JSON.stringify(CHARTER_HASH)}, cycle_index: Number(id), phase_id: 'tt.orient'
  }, { lock: { timeoutMs: 30000 } });
}
require('fs').writeFileSync(marker, 'done\\n');
`);

  const WORKERS = 4;
  const APPENDS = 3;
  const markers = [];
  for (let i = 0; i < WORKERS; i += 1) {
    const marker = path.join(dir, `worker-${i}.done`);
    markers.push(marker);
    spawn(process.execPath, [worker, j, String(i), marker], { stdio: 'ignore' });
  }

  // Blocking this process does not block the children -- they are separate OS
  // processes -- so a synchronous poll is safe and keeps the suite serial.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !markers.every((m) => fs.existsSync(m))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  check('every concurrent writer finished', markers.every((m) => fs.existsSync(m)), markers.filter((m) => !fs.existsSync(m)));

  const records = journal.readJournal(j);
  check(`all ${WORKERS * APPENDS} appends landed, none lost`, records.length === WORKERS * APPENDS, records.length);
  const indexes = records.map((r) => r.record_index);
  const expected = Array.from({ length: WORKERS * APPENDS }, (_, i) => i);
  check('record_index is 0..N-1 with no duplicate and no gap', JSON.stringify(indexes) === JSON.stringify(expected), indexes);
  const hashes = new Set(records.map((r) => r.record_hash));
  check('every record_hash is distinct', hashes.size === records.length);

  const chain = journal.verifyJournalIntegrity(records);
  check('the hash chain verifies after concurrent appends', chain.valid === true, chain.errors);
  const anchor = journal.verifyJournalAnchor(j, records);
  check('the anchor agrees with the head after concurrent appends', anchor.anchor_state === 'OK', anchor);
  check('no lock file is left behind', !fs.existsSync(journal.lockPathFor(j)));
}

{
  // 8b. The exclusion itself, asserted deterministically.
  const j = freshJournal();
  buildRun(j);
  const lockPath = journal.lockPathFor(j);

  // A lock held by a pid that is definitely alive: this one.
  fs.writeFileSync(lockPath, JSON.stringify({
    schema: 'JournalWriterLock/1.0', pid: process.pid, host: require('os').hostname(), acquired_at: new Date().toISOString()
  }) + '\n');

  const state = journal.inspectLock(lockPath);
  check('a lock held by a live pid is NOT breakable', state.breakable === false, state.reason);

  let err = null;
  try {
    journal.appendRecord(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient' }, { lock: { timeoutMs: 150 } });
  } catch (e) {
    err = e;
  }
  check('a second writer is REFUSED while the lock is held', err !== null && err.code === 'JOURNAL_LOCK_TIMEOUT', err && err.message);
  check('the refusal names the holder', err && err.holder && err.holder.pid === process.pid, err && err.holder);
  check('the refused append wrote NOTHING', journal.readJournal(j).length === 2);

  // A lock whose owner is gone must be breakable, or one crash bricks the
  // journal forever.
  const { spawnSync } = require('child_process');
  const deadPidScript = path.join(path.dirname(j), 'exit.cjs');
  fs.writeFileSync(deadPidScript, 'process.exit(0);\n');
  const dead = spawnSync(process.execPath, [deadPidScript], { stdio: 'ignore' });
  const wellFormedLock = (over) => JSON.stringify(Object.assign({
    schema: 'JournalWriterLock/1.0',
    pid: dead.pid,
    host: require('os').hostname(),
    acquired_at: new Date().toISOString(),
    journal: path.resolve(j)
  }, over)) + '\n';

  fs.writeFileSync(lockPath, wellFormedLock({}));
  const staleState = journal.inspectLock(lockPath);
  check('a lock held by a dead pid on this host IS breakable', staleState.breakable === true, staleState.reason);
  const appended = journal.appendRecord(j, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.orient' }, { lock: { timeoutMs: 2000 } });
  check('the append proceeds after breaking a stale lock', appended.record_index === 2, appended.record_index);

  // A lock from another host cannot have its owner checked, so it is refused
  // rather than broken -- ambiguity fails toward not writing.
  fs.writeFileSync(lockPath, wellFormedLock({ pid: 999999, host: 'some-other-host' }));
  const foreign = journal.inspectLock(lockPath);
  check('a lock from another host is refused, never broken', foreign.breakable === false, foreign.reason);
  fs.rmSync(lockPath, { force: true });

  // An unreadable lock is likewise refused rather than assumed abandoned.
  fs.writeFileSync(lockPath, 'not json at all\n');
  const garbage = journal.inspectLock(lockPath);
  check('an unreadable lock is refused, never broken', garbage.breakable === false, garbage.reason);
  fs.rmSync(lockPath, { force: true });

  // DEFECT D4. Schema-valid and hostname-matching is not the same as
  // owner-identifying. Each shape below reached the stale-owner branch before
  // the repair, where a missing or null pid reads as "not alive" and the lock
  // was declared breakable -- letting a corrupt or half-written lock be stolen
  // from a live owner. Every one of them must now refuse.
  const malformed = [
    ['a pid that is missing entirely', (o) => { delete o.pid; }],
    ['a pid that is explicitly null', (o) => { o.pid = null; }],
    ['a pid that is a string rather than a number', (o) => { o.pid = String(dead.pid); }],
    ['a pid that is zero', (o) => { o.pid = 0; }],
    ['a pid that is negative', (o) => { o.pid = -1; }],
    ['a pid that is not an integer', (o) => { o.pid = 12.5; }],
    ['a host that is missing entirely', (o) => { delete o.host; }],
    ['a host that is null', (o) => { o.host = null; }],
    ['a host that is an empty string', (o) => { o.host = '   '; }],
    ['a journal identity that is missing', (o) => { delete o.journal; }],
    ['a journal identity naming a different journal', (o) => { o.journal = path.join(path.dirname(j), 'some-other.jsonl'); }]
  ];
  for (const [label, mutate] of malformed) {
    const payload = JSON.parse(wellFormedLock({}));
    mutate(payload);
    fs.writeFileSync(lockPath, JSON.stringify(payload) + '\n');
    const state = journal.inspectLock(lockPath);
    check(`a lock with ${label} is refused, never broken`, state.breakable === false, state.reason);
    fs.rmSync(lockPath, { force: true });
  }

  // The other half of the same claim: the validation must not have made stale
  // locks unbreakable in general, or one crash still bricks the journal.
  fs.writeFileSync(lockPath, wellFormedLock({}));
  check('a fully valid payload proving same-host-and-pid-absent is STILL breakable',
    journal.inspectLock(lockPath).breakable === true, journal.inspectLock(lockPath).reason);
  fs.rmSync(lockPath, { force: true });
}

// ---------------------------------------------------------------------------
section('9. DEFECT D2: the unserialized control, so 8a is not a coincidence');
// ---------------------------------------------------------------------------
//
// 8a passing only shows that a race did not occur. This runs the SAME workload
// through the pre-repair, unlocked append path -- the code as it was -- and
// expects it to corrupt. Without this arm, "no corruption observed" and "no
// corruption possible" are indistinguishable, which is the exact confusion the
// crash-window argument fell into.
{
  const { spawn } = require('child_process');
  const j = freshJournal();
  const dir = path.dirname(j);
  const worker = path.join(dir, 'unlocked-worker.cjs');
  // DEFECT D6: the unlocked path is no longer a callable export. The control
  // has to ask for it explicitly, through the gate, which is the point -- the
  // evidence this section produces is preserved, but nothing in the runtime can
  // reach the same code by mistake.
  fs.writeFileSync(worker, `'use strict';
const journal = require(${JSON.stringify(path.resolve(__dirname, 'journal.cjs'))});
const appendUnlocked = journal.unlockedAppendForDifferentialControl(journal.UNLOCKED_CONTROL_OPT_IN);
const [, , journalPath, id, marker] = process.argv;
for (let i = 0; i < 5; i += 1) {
  try {
    appendUnlocked(journalPath, {
      charter_hash: ${JSON.stringify(CHARTER_HASH)}, cycle_index: Number(id), phase_id: 'tt.orient'
    });
  } catch (e) { /* the unlocked path can also fail its own read; that is the defect too */ }
}
require('fs').writeFileSync(marker, 'done\\n');
`);

  const WORKERS = 6;
  const markers = [];
  const controlEnv = Object.assign({}, process.env, { TICKTOCK_ALLOW_UNLOCKED_CONTROL: '1' });
  for (let i = 0; i < WORKERS; i += 1) {
    const marker = path.join(dir, `unlocked-${i}.done`);
    markers.push(marker);
    spawn(process.execPath, [worker, j, String(i), marker], { stdio: 'ignore', env: controlEnv });
  }
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !markers.every((m) => fs.existsSync(m))) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }

  let verdict;
  try {
    const records = journal.readJournal(j);
    const chain = journal.verifyJournalIntegrity(records);
    const indexes = records.map((r) => r.record_index);
    const expected = Array.from({ length: WORKERS * 5 }, (_, i) => i);
    verdict = {
      corrupt: !(chain.valid && JSON.stringify(indexes) === JSON.stringify(expected)),
      chain_valid: chain.valid,
      chain_errors: chain.errors.length,
      duplicate_indexes: indexes.length - new Set(indexes).size
    };
  } catch (e) {
    verdict = { corrupt: true, unreadable: e.halt_state || e.message };
  }
  control('the UNLOCKED path corrupts the chain under the same workload', verdict.corrupt === true, verdict);
  // The INVARIANT is that corruption occurs -- an invalid chain, duplicate
  // indexes, or a journal that will not read at all. The exact counts are not.
  // A prior commit message cited "20 chain errors, 10 duplicate indexes" as
  // though contractual; the third-party review observed 10 and 5, and this
  // repair session observed 8 and 4. Corruption reproduces reliably; how much of
  // it lands depends on the workload and on how the OS happens to interleave the
  // six writers. Asserting a count here would be a latent flaky failure, so the
  // counts are REPORTED as observed evidence and never asserted.
  control('the corruption is visible as an invalid chain, duplicate indexes, or an unreadable journal',
    verdict.unreadable !== undefined || verdict.chain_valid === false || verdict.duplicate_indexes > 0, verdict);
  process.stdout.write(`        control detail (counts are observed, not expected): ${JSON.stringify(verdict)}\n`);
}

// ---------------------------------------------------------------------------
section('10. DEFECT D6: the unlocked append path is gated, not merely labelled');
// ---------------------------------------------------------------------------
//
// The unlocked append used to be exported as __appendRecordUnlocked: a callable
// function on the public surface with a comment asking callers not to use it.
// Section 9 shows what a caller who ignored the comment would get. These checks
// are the mechanism that replaced the comment.
{
  const savedEnv = process.env.TICKTOCK_ALLOW_UNLOCKED_CONTROL;
  delete process.env.TICKTOCK_ALLOW_UNLOCKED_CONTROL;

  check('the old callable export is gone from the module surface',
    journal.__appendRecordUnlocked === undefined, Object.keys(journal).filter((k) => k.startsWith('__')));

  const refuses = (fn) => { try { fn(); return null; } catch (e) { return e; } };

  let e = refuses(() => journal.unlockedAppendForDifferentialControl(journal.UNLOCKED_CONTROL_OPT_IN));
  check('a correct token WITHOUT the environment opt-in is refused loudly',
    e !== null && e.code === 'JOURNAL_UNLOCKED_APPEND_FORBIDDEN', e && e.message);

  process.env.TICKTOCK_ALLOW_UNLOCKED_CONTROL = '1';
  e = refuses(() => journal.unlockedAppendForDifferentialControl());
  check('the environment opt-in WITHOUT the token is refused loudly',
    e !== null && e.code === 'JOURNAL_UNLOCKED_APPEND_FORBIDDEN', e && e.message);
  e = refuses(() => journal.unlockedAppendForDifferentialControl('please'));
  check('a wrong token is refused loudly',
    e !== null && e.code === 'JOURNAL_UNLOCKED_APPEND_FORBIDDEN', e && e.message);

  check('both opt-ins together hand out the unlocked path',
    typeof journal.unlockedAppendForDifferentialControl(journal.UNLOCKED_CONTROL_OPT_IN) === 'function');

  if (savedEnv === undefined) delete process.env.TICKTOCK_ALLOW_UNLOCKED_CONTROL;
  else process.env.TICKTOCK_ALLOW_UNLOCKED_CONTROL = savedEnv;
}

// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed${inconclusive ? `, ${inconclusive} inconclusive` : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
