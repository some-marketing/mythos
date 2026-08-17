#!/usr/bin/env node
'use strict';

// tools/ticktock/test-append-after-truncation.cjs -- T1 regression test
// (plan sim-foundation-repairs, S1).
//
// The defect: appendRecordLocked() read the journal, derived record_index and
// prev_record_hash from whatever records remained, appended, and then wrote a
// FRESH anchor over the new head -- silently healing a truncated or tampered
// journal. Deleting the final record left a shorter chain that verified
// internally, and the next append re-stamped the anchor to agree with it,
// erasing the only evidence the tail existed. The anchor exists precisely to
// make a truncated tail DETECTABLE; the append path was laundering it.
//
// Every test below is written to FAIL on the pre-fix code (the append
// succeeds and re-anchors) and PASS on the fixed code (the append refuses and
// the anchor is left untouched), which is the only reason to trust that the
// fix is doing the thing it claims.
//
// Run: node tools/ticktock/test-append-after-truncation.cjs

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const journal = require('./journal.cjs');

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

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

function freshJournal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-append-trunc-'));
  return path.join(dir, 'journal.jsonl');
}

const CHARTER_HASH = 'a'.repeat(64);

// T2 spend-receipt stub: a real on-disk ledger file whose content hash the
// receipt names, so appendRecord's receipt gate is satisfiable (the receipt
// contract itself is tested in test-resume-terminal-halts.cjs section 7; this
// file is exercising the anchor/truncation contract).
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

// Two completed PURE phases with real verified artifacts, so the journal is
// anchored at 2 records with a real head before any tampering.
function buildRun(journalPath) {
  const dir = path.dirname(journalPath);
  for (const [i, phase] of ['tt.orient', 'tt.observe'].entries()) {
    const artifact = path.join(dir, `artifact-${i}.txt`);
    fs.writeFileSync(artifact, `phase ${phase} output\n`);
    journal.completePhase(journalPath, { charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: phase, spend_receipt: stubReceipt(CHARTER_HASH, 0, phase, dir) }, [artifact]);
  }
}

function readLines(journalPath) {
  return fs.readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
}

function appendAttempt(journalPath) {
  try {
    journal.appendRecord(journalPath, {
      charter_hash: CHARTER_HASH, cycle_index: 0, phase_id: 'tt.research'
    });
    return { refused: false, error: null };
  } catch (err) {
    return { refused: true, error: err };
  }
}

// ---------------------------------------------------------------------------
section('1. THE T1 DEFECT: appending over a truncated tail must be REFUSED');
// ---------------------------------------------------------------------------
{
  const j = freshJournal();
  buildRun(j);
  const linesBefore = readLines(j);
  const anchorBefore = journal.readAnchor(j);

  // Truncate: delete the final record, exactly as an interrupted write or a
  // hand edit would.
  fs.writeFileSync(j, linesBefore.slice(0, -1).join('\n') + '\n');

  const anchorState = journal.verifyJournalAnchor(j, journal.readJournal(j));
  check('the truncation is a detectable ANCHOR_AHEAD state', anchorState.anchor_state === 'ANCHOR_AHEAD', anchorState);

  const attempt = appendAttempt(j);
  check('appendRecord REFUSES to append over the truncated tail', attempt.refused === true, attempt.error && { code: attempt.error.code, message: attempt.error.message });

  const after = journal.readJournal(j);
  const anchorAfter = journal.readAnchor(j);
  check('the journal was NOT extended by the refused append', after.length === linesBefore.length - 1, { before: linesBefore.length, after: after.length });
  check('the anchor was NOT re-stamped by the refused append',
    anchorAfter.anchor !== null
    && anchorAfter.anchor.record_count === anchorBefore.anchor.record_count
    && anchorAfter.anchor.head_record_hash === anchorBefore.anchor.head_record_hash,
    { before: anchorBefore.anchor && { record_count: anchorBefore.anchor.record_count, head_record_hash: anchorBefore.anchor.head_record_hash },
      after: anchorAfter.anchor && { record_count: anchorAfter.anchor.record_count, head_record_hash: anchorAfter.anchor.head_record_hash } });
}

// ---------------------------------------------------------------------------
section('2. HEAD_MISMATCH: a replaced final record must be REFUSED');
// ---------------------------------------------------------------------------
{
  const j = freshJournal();
  buildRun(j);
  const lines = readLines(j);

  // Replace the final record in place (a tamper that keeps the count the
  // same but changes the head bytes). Deliberately NOT a halt_state edit:
  // a TERMINAL halt_state would trip appendRecordLocked's pre-existing
  // terminal-halt guard, refusing the append for the wrong reason. This is a
  // head-substitution -- different entered timestamp AND a different
  // record_hash field -- so the ONLY thing that can refuse it is the anchor.
  const last = JSON.parse(lines[lines.length - 1]);
  last.entered = '2026-08-15T00:00:00.000Z';
  last.record_hash = 'f'.repeat(64);
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(j, lines.join('\n') + '\n');

  const anchorState = journal.verifyJournalAnchor(j, journal.readJournal(j));
  check('the tamper is a detectable HEAD_MISMATCH state', anchorState.anchor_state === 'HEAD_MISMATCH', anchorState);

  const attempt = appendAttempt(j);
  check('appendRecord REFUSES to append over a replaced head', attempt.refused === true, attempt.error && { code: attempt.error.code, message: attempt.error.message });
}

// ---------------------------------------------------------------------------
section('3. ANCHOR_MISSING / ANCHOR_CORRUPT: an unverifiable anchor must be REFUSED');
// ---------------------------------------------------------------------------
{
  // 3a. Records exist but the anchor file is gone.
  const j = freshJournal();
  buildRun(j);
  fs.rmSync(journal.anchorPathFor(j));

  const anchorState = journal.verifyJournalAnchor(j, journal.readJournal(j));
  check('a journal with records and no anchor is ANCHOR_MISSING', anchorState.anchor_state === 'ANCHOR_MISSING', anchorState);

  const attempt = appendAttempt(j);
  check('appendRecord REFUSES when the anchor is missing', attempt.refused === true, attempt.error && { code: attempt.error.code, message: attempt.error.message });

  // 3b. Anchor file exists but is corrupt.
  const j2 = freshJournal();
  buildRun(j2);
  fs.writeFileSync(journal.anchorPathFor(j2), '{ this is not json\n');

  const anchorState2 = journal.verifyJournalAnchor(j2, journal.readJournal(j2));
  check('a corrupt anchor is ANCHOR_CORRUPT', anchorState2.anchor_state === 'ANCHOR_CORRUPT', anchorState2);

  const attempt2 = appendAttempt(j2);
  check('appendRecord REFUSES when the anchor is corrupt', attempt2.refused === true, attempt2.error && { code: attempt2.error.code, message: attempt2.error.message });
}

// ---------------------------------------------------------------------------
section('4. ANCHOR_BEHIND (crash window): allowed ONLY when trailing records chain-verify');
// ---------------------------------------------------------------------------
{
  // 4a. The designed crash-window recovery: the journal is internally perfect
  // and only the anchor lags. Appending must proceed (this is the crash-window
  // recovery the anchor section documents -- append then anchor, opposite
  // direction from truncation).
  const j = freshJournal();
  buildRun(j);
  const records = journal.readJournal(j);
  journal.writeAnchor(j, { record_count: 1, head_record_hash: records[0].record_hash });

  const anchorState = journal.verifyJournalAnchor(j, journal.readJournal(j));
  check('the rolled-back anchor is ANCHOR_BEHIND', anchorState.anchor_state === 'ANCHOR_BEHIND', anchorState);
  const chain = journal.verifyJournalIntegrity(journal.readJournal(j));
  check('the unvouched trailing record chain-verifies', chain.valid === true, chain.errors);

  const attempt = appendAttempt(j);
  check('appendRecord PROCEEDS over a chain-verifying ANCHOR_BEHIND (crash-window recovery)', attempt.refused === false, attempt.error && attempt.error.message);

  // 4b. ANCHOR_BEHIND with a BROKEN trailing chain must be refused: the
  // trailing record does not chain-verify, so "the anchor lags" is not the
  // explanation -- something was also tampered, and appending would launder it.
  const j2 = freshJournal();
  buildRun(j2);
  const recs = journal.readJournal(j2);
  journal.writeAnchor(j2, { record_count: 1, head_record_hash: recs[0].record_hash });

  // Break the trailing record's chain link in place (rewrite the last record's
  // prev_record_hash) while keeping the anchor BEHIND.
  const lines = readLines(j2);
  const last = JSON.parse(lines[lines.length - 1]);
  last.prev_record_hash = 'f'.repeat(64);
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(j2, lines.join('\n') + '\n');

  const brokenChain = journal.verifyJournalIntegrity(journal.readJournal(j2));
  check('the tampered trailing chain does NOT verify', brokenChain.valid === false, brokenChain.errors);

  const attempt2 = appendAttempt(j2);
  check('appendRecord REFUSES an ANCHOR_BEHIND whose trailing records do not chain-verify', attempt2.refused === true, attempt2.error && { code: attempt2.error.code, message: attempt2.error.message });
}

// ---------------------------------------------------------------------------
section('5. Fresh journal: a genuine new start still appends normally');
// ---------------------------------------------------------------------------
{
  const j = freshJournal();
  const attempt = appendAttempt(j);
  check('appendRecord still works on a fresh journal', attempt.refused === false, attempt.error && attempt.error.message);
  const records = journal.readJournal(j);
  const anchor = journal.verifyJournalAnchor(j, records);
  check('the fresh append anchors normally (OK)', anchor.anchor_state === 'OK', anchor);
}

// ---------------------------------------------------------------------------
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
