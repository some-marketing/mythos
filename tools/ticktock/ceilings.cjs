#!/usr/bin/env node
'use strict';

// tools/ticktock/ceilings.cjs -- the spend accumulator and the ceiling
// comparison-and-halt call site for /ticktock. Plan: ticktock-skill, repair of
// S3-g in _dev/state/ticktock/ticktock-dryrun-evidence.json.
//
// WHAT WAS MISSING, AND WHAT THIS IS.
//
// The charter already STORED both ceilings immutably (charter.max_cumulative_diff
// {lines_changed, files_changed} and charter.max_external_actions), and the journal
// already ACCEPTED a CEILING-EXCEEDED halt record. Neither of those is enforcement:
// nothing in the repo accumulated an observed spend or compared it against the
// stored ceiling, so the halt state was a word in a vocabulary with no code path
// that could ever fire it. S3-g's own note named the missing piece exactly: "a
// spend accumulator plus a comparison-and-halt call site, invoked at a phase
// boundary." This file is those two things.
//
// THREE DESIGN POINTS THAT MATTER:
//
//   1. CUMULATIVE, NOT PER-CYCLE. The charter schema says so in as many words:
//      "Cumulative across the whole run, not per cycle -- a per-cycle-only bound is
//      trivially defeated by running more cycles." A ledger therefore spans the run
//      and is never reset between generations.
//
//   2. files_changed IS A DISTINCT-PATH COUNT, not a sum of per-phase counts.
//      Touching the same file in six phases is one file changed, not six. The
//      ledger keeps the set of paths and reports its size.
//
//   3. EXCEEDED MEANS STRICTLY GREATER THAN. A run that lands exactly ON its
//      ceiling has spent what it was allowed to spend; it has not exceeded it. The
//      just-under / exactly-at / just-over boundary is covered by the tests in
//      test-ceilings.cjs, because an off-by-one in a stopping rule is the whole
//      difference between a bound and a suggestion.
//
// HONEST TIER. Like preflight-ticktock.cjs, this is ADVISORY at the harness level
// and fail-closed within itself: it is deterministic executable code that reads
// real numbers and refuses, but nothing in the Claude Code harness compels a phase
// to call it. A caller that never accumulates never halts. That is a property of
// where the enforcement can live from this write surface, and it is stated rather
// than implied.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const journal = require('./journal.cjs');

const HALT_STATE = 'CEILING-EXCEEDED';

// T2 (tt-charter-template-and-spend-ledger): the default surface a run's spend
// ledgers live under, per the charter template's mandated
// _dev/state/ticktock/spend-ledgers/** write surface.
const DEFAULT_LEDGER_DIR = path.join('_dev', 'state', 'ticktock', 'spend-ledgers');

// ---------------------------------------------------------------------------
// The accumulator
// ---------------------------------------------------------------------------

/**
 * Open a spend ledger for one RUN (not one cycle).
 *
 * @param {object} charter a RunCharter/1.0
 * @returns {object} ledger
 */
function createSpendLedger(charter) {
  if (!charter || typeof charter !== 'object') {
    throw new Error('CEILING-LEDGER-REFUSED: a spend ledger needs the charter whose ceilings it is measured against.');
  }
  const diff = charter.max_cumulative_diff || {};
  if (typeof diff.lines_changed !== 'number' || typeof diff.files_changed !== 'number'
    || typeof charter.max_external_actions !== 'number') {
    throw new Error(
      'CEILING-LEDGER-REFUSED: charter.max_cumulative_diff.{lines_changed,files_changed} and charter.max_external_actions must all be numbers. '
      + 'A ledger with no ceiling to measure against would accumulate forever and never halt -- fail closed rather than open an unbounded ledger.'
    );
  }
  return {
    schema: 'TickTockSpendLedger/1.0',
    charter_id: charter.charter_id,
    charter_hash: charter.charter_hash,
    ceilings: {
      lines_changed: diff.lines_changed,
      files_changed: diff.files_changed,
      external_actions: charter.max_external_actions
    },
    lines_changed: 0,
    files: new Set(),
    external_actions: 0,
    entries: []
  };
}

/**
 * Record one increment of spend against the ledger.
 *
 * @param {object} ledger    from createSpendLedger
 * @param {object} delta     {lines_changed?, files?: string[], external_actions?, phase_id?, cycle_index?}
 * @returns {object} the ledger (mutated in place, returned for chaining)
 */
function accumulate(ledger, delta) {
  if (!ledger || ledger.schema !== 'TickTockSpendLedger/1.0') {
    throw new Error('CEILING-LEDGER-REFUSED: accumulate() needs a ledger from createSpendLedger.');
  }
  const d = delta || {};
  const lines = d.lines_changed === undefined ? 0 : d.lines_changed;
  const actions = d.external_actions === undefined ? 0 : d.external_actions;
  if (typeof lines !== 'number' || lines < 0 || !Number.isFinite(lines)) {
    throw new Error(`CEILING-LEDGER-REFUSED: lines_changed must be a non-negative finite number, got ${JSON.stringify(d.lines_changed)}.`);
  }
  if (typeof actions !== 'number' || actions < 0 || !Number.isFinite(actions)) {
    throw new Error(`CEILING-LEDGER-REFUSED: external_actions must be a non-negative finite number, got ${JSON.stringify(d.external_actions)}.`);
  }
  const files = Array.isArray(d.files) ? d.files : [];

  ledger.lines_changed += lines;
  ledger.external_actions += actions;
  for (const f of files) ledger.files.add(String(f));
  ledger.entries.push({
    at: new Date().toISOString(),
    phase_id: d.phase_id || null,
    cycle_index: d.cycle_index === undefined ? null : d.cycle_index,
    lines_changed: lines,
    files: files.slice(),
    external_actions: actions
  });
  return ledger;
}

/** The ledger's current observed spend, as plain numbers. */
function observedSpend(ledger) {
  return {
    lines_changed: ledger.lines_changed,
    files_changed: ledger.files.size,
    external_actions: ledger.external_actions
  };
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/**
 * Compare observed spend against the charter's ceilings.
 *
 * BOTH ceilings are evaluated independently and BOTH are reported: a run that blew
 * through the diff ceiling and the external-action ceiling names both, rather than
 * short-circuiting on the first.
 *
 * @returns {object} {within, exceeded: [{ceiling, observed, limit, over_by}], halt_state, detail}
 */
function evaluateCeilings(charter, ledger) {
  const observed = observedSpend(ledger);
  const limits = ledger.ceilings;

  // A ledger opened against a different charter is not evidence about this one.
  if (charter && charter.charter_hash && ledger.charter_hash && charter.charter_hash !== ledger.charter_hash) {
    throw new Error(
      `CEILING-LEDGER-REFUSED: ledger was opened against charter ${ledger.charter_hash} but is being evaluated against ${charter.charter_hash}. `
      + 'Spend measured under one charter is not spend under another.'
    );
  }

  const exceeded = [];
  const checks = [
    { ceiling: 'max_cumulative_diff.lines_changed', observed: observed.lines_changed, limit: limits.lines_changed },
    { ceiling: 'max_cumulative_diff.files_changed', observed: observed.files_changed, limit: limits.files_changed },
    { ceiling: 'max_external_actions', observed: observed.external_actions, limit: limits.external_actions }
  ];
  for (const c of checks) {
    // Strictly greater than: landing exactly on the ceiling is spending what was
    // allowed, not exceeding it.
    if (c.observed > c.limit) exceeded.push(Object.assign({ over_by: c.observed - c.limit }, c));
  }

  return {
    schema: 'TickTockCeilingEvaluation/1.0',
    within: exceeded.length === 0,
    observed,
    ceilings: limits,
    exceeded,
    halt_state: exceeded.length === 0 ? null : HALT_STATE,
    detail: exceeded.length === 0
      ? null
      : exceeded.map((e) => `${e.ceiling}: observed ${e.observed} exceeds ceiling ${e.limit} by ${e.over_by}`).join('; ')
  };
}

// ---------------------------------------------------------------------------
// The call site: a phase boundary
// ---------------------------------------------------------------------------

/**
 * THE ENFORCEMENT CALL SITE. Invoke at every phase boundary, after that phase's
 * spend has been accumulated and before the next phase is entered.
 *
 * When the spend is within both ceilings this returns {halted:false} and the cycle
 * continues. When either ceiling is exceeded it writes a CEILING-EXCEEDED halt
 * record to the journal (when a journalPath is supplied) and returns {halted:true}
 * -- and, unless `throwOnHalt` is explicitly false, throws, so that a caller which
 * ignores the return value still stops. A halt a caller can accidentally step over
 * is not a halt.
 *
 * @param {object} args {charter, ledger, phase_id, cycle_index, journalPath?, idempotency_key?, throwOnHalt?}
 */
function enforceCeilingsAtPhaseBoundary(args) {
  const { charter, ledger, phase_id: phaseId, cycle_index: cycleIndex } = args || {};
  if (!phaseId) {
    throw new Error('CEILING-CHECK-REFUSED: enforceCeilingsAtPhaseBoundary needs the phase_id of the boundary it is guarding.');
  }
  const evaluation = evaluateCeilings(charter, ledger);

  if (evaluation.within) {
    return { halted: false, halt_state: null, evaluation, journal_record: null };
  }

  let record = null;
  if (args.journalPath) {
    const partial = {
      charter_hash: charter.charter_hash,
      cycle_index: cycleIndex === undefined ? 0 : cycleIndex,
      phase_id: phaseId,
      halt_state: HALT_STATE,
      halt_detail: evaluation.detail
    };
    if (args.idempotency_key) partial.idempotency_key = args.idempotency_key;
    record = journal.appendRecord(args.journalPath, partial);
  }

  const result = { halted: true, halt_state: HALT_STATE, evaluation, journal_record: record };
  if (args.throwOnHalt === false) return result;

  const err = new Error(`${HALT_STATE}: at phase boundary ${phaseId} (cycle ${cycleIndex}) -- ${evaluation.detail}`);
  err.halt_state = HALT_STATE;
  err.evaluation = evaluation;
  err.journal_record = record;
  throw err;
}

// ---------------------------------------------------------------------------
// Spend receipts (T2, tt-charter-template-and-spend-ledger)
// ---------------------------------------------------------------------------
//
// A receipt is journal.cjs's appendRecord() enforcement gate made satisfiable:
// a boundary-bound {charter_hash, cycle_index, phase_id, ledger_path,
// ledger_sha256, observed_spend, within_ceiling, checked_at} proving a
// completion's spend was checked against the charter's ceilings, backed by an
// actual ledger file on disk whose content hash the receipt names. This is
// the "emits receipts from its accumulator" half of T2; appendRecord's own
// verification (recomputing ledger_sha256 from the file at append time) is
// what makes the receipt load-bearing rather than advisory.

/**
 * Persist a ledger's current state to disk (JSON, Set serialized as a sorted
 * array so persisted files diff cleanly) and return its path and content hash.
 *
 * @param {object} ledger  from createSpendLedger (mutated by accumulate())
 * @param {string} [ledgerDir]  defaults to DEFAULT_LEDGER_DIR
 * @returns {{ledger_path: string, ledger_sha256: string}}
 */
// T3 (sim-foundation-repairs): the ledger's on-disk form is SINGLE-SOURCED
// here. cycle-driver.cjs used to carry its own (de)serialization (a second
// producer of the same shape); both paths now go through serializeLedger /
// persistSpendLedger / loadSpendLedger so there is exactly one producer of the
// persisted form, and journal.cjs's append-time provenance gate parses the
// SAME shape it validates against.
function serializeLedger(ledger) {
  return {
    schema: ledger.schema,
    charter_id: ledger.charter_id,
    charter_hash: ledger.charter_hash,
    ceilings: ledger.ceilings,
    lines_changed: ledger.lines_changed,
    files: Array.from(ledger.files).sort(),
    external_actions: ledger.external_actions,
    entries: ledger.entries
  };
}

/**
 * Persist a ledger to an explicit absolute path (single serializer).
 *
 * @param {object} ledger  from createSpendLedger (mutated by accumulate())
 * @param {string} ledgerAbsPath  absolute path to write
 * @returns {{ledger_path: string, ledger_sha256: string}}
 */
function persistSpendLedger(ledger, ledgerAbsPath) {
  if (!ledger || ledger.schema !== 'TickTockSpendLedger/1.0') {
    throw new Error('CEILING-LEDGER-REFUSED: persistSpendLedger() needs a ledger from createSpendLedger.');
  }
  fs.mkdirSync(path.dirname(ledgerAbsPath), { recursive: true });
  fs.writeFileSync(ledgerAbsPath, JSON.stringify(serializeLedger(ledger), null, 2) + '\n');
  const ledger_sha256 = crypto.createHash('sha256').update(fs.readFileSync(ledgerAbsPath)).digest('hex');
  return { ledger_path: ledgerAbsPath, ledger_sha256 };
}

/**
 * Load a persisted ledger from an explicit absolute path, fail-closed on
 * identity: a ledger persisted against a DIFFERENT charter (or a malformed
 * file) is never silently re-stamped with the current charter's identity and
 * trusted -- that would let stale or cross-charter spend either vanish or
 * masquerade as this run's, and defeats this module's own charter_hash
 * mismatch check in evaluateCeilings (it never gets to run, because the
 * ledger it receives would have already been rewritten to agree with the
 * charter it is compared against).
 *
 * @param {string} ledgerAbsPath  absolute path to read
 * @param {object} charter  the RunCharter/1.0 this ledger must be bound to
 * @returns {object} a live ledger (files restored as a Set)
 */
function loadSpendLedger(ledgerAbsPath, charter) {
  if (fs.existsSync(ledgerAbsPath)) {
    const raw = JSON.parse(fs.readFileSync(ledgerAbsPath, 'utf8'));
    if (raw.schema !== 'TickTockSpendLedger/1.0') {
      throw new Error(`CEILING-LEDGER-REFUSED: ${ledgerAbsPath} is not a TickTockSpendLedger/1.0 (schema: ${JSON.stringify(raw.schema)}).`);
    }
    if (raw.charter_hash !== charter.charter_hash) {
      throw new Error(
        `CEILING-LEDGER-REFUSED: ${ledgerAbsPath} was opened against charter ${raw.charter_hash} but is being loaded for ${charter.charter_hash}. `
        + 'Spend measured under one charter is not spend under another -- use a fresh ledger path for a different charter.'
      );
    }
    const ledger = createSpendLedger(charter);
    ledger.lines_changed = raw.lines_changed;
    ledger.external_actions = raw.external_actions;
    ledger.files = new Set(raw.files || []);
    ledger.entries = raw.entries || [];
    return ledger;
  }
  return createSpendLedger(charter);
}

function writeSpendLedger(ledger, ledgerDir) {
  if (!ledger || ledger.schema !== 'TickTockSpendLedger/1.0') {
    throw new Error('CEILING-LEDGER-REFUSED: writeSpendLedger() needs a ledger from createSpendLedger.');
  }
  const dir = ledgerDir || DEFAULT_LEDGER_DIR;
  const ledgerPath = path.join(dir, `${ledger.charter_id}.json`);
  return persistSpendLedger(ledger, ledgerPath);
}

/**
 * Build a boundary-bound spend receipt for a completion at {phase_id,
 * cycle_index}, writing the ledger to disk first so the receipt's
 * ledger_sha256 names real, re-hashable bytes.
 *
 * @param {object} args {charter, ledger, phase_id, cycle_index, ledgerDir?}
 * @returns {object} a JournalRecord/1.0 spend_receipt
 */
function buildSpendReceipt(args) {
  const { charter, ledger, phase_id: phaseId, cycle_index: cycleIndex, ledgerDir } = args || {};
  if (!phaseId) {
    throw new Error('CEILING-RECEIPT-REFUSED: buildSpendReceipt needs the phase_id of the boundary the receipt certifies.');
  }
  if (cycleIndex === undefined || cycleIndex === null) {
    throw new Error('CEILING-RECEIPT-REFUSED: buildSpendReceipt needs the cycle_index of the boundary the receipt certifies.');
  }
  const evaluation = evaluateCeilings(charter, ledger);
  const { ledger_path, ledger_sha256 } = writeSpendLedger(ledger, ledgerDir);
  return {
    charter_hash: charter.charter_hash,
    cycle_index: cycleIndex,
    phase_id: phaseId,
    ledger_path,
    ledger_sha256,
    observed_spend: evaluation.observed,
    within_ceiling: evaluation.within,
    checked_at: new Date().toISOString()
  };
}

module.exports = {
  HALT_STATE,
  DEFAULT_LEDGER_DIR,
  createSpendLedger,
  accumulate,
  observedSpend,
  evaluateCeilings,
  enforceCeilingsAtPhaseBoundary,
  serializeLedger,
  persistSpendLedger,
  loadSpendLedger,
  writeSpendLedger,
  buildSpendReceipt
};
