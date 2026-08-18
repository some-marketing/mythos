#!/usr/bin/env node
'use strict';

// tools/ticktock/cycle-driver.cjs -- the mechanical call-surface a /tt cycle needs.
//
// WHY THIS EXISTS. The /tt skill makes the agent the COORDINATOR: it resolves
// state from artifacts and calls charter.cjs / journal.cjs / run-benchmark.js /
// generation-manifest.cjs through their exported API. But the harness's
// pretool write-boundary gate blocks `node -e` and any inline program body,
// because no argument token proves where such a program writes. So there has to
// be a file with literal path arguments. This is that file.
//
// WHAT IT IS NOT. It reimplements nothing. Every subcommand is a thin argument
// adapter over an existing exported function; the verdicts, hashes, halts, and
// refusals all come from the modules, unchanged. If a module throws, that throw
// is the result -- this driver never converts a refusal into a warning.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const charterMod = require('./charter.cjs');
const journal = require('./journal.cjs');
const bench = require('./run-benchmark.js');
const gm = require('./generation-manifest.cjs');
const ceilings = require('./ceilings.cjs');

const PREFLIGHT_AND_JOURNAL = path.join(__dirname, 'preflight-and-journal.cjs');
const WRITE_REVIEW_DECISION = path.join(__dirname, 'write-review-decision.cjs');

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, p), 'utf8'));
}

function writeJson(p, obj) {
  const abs = path.resolve(REPO_ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n');
  return abs;
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// The spend ledger ceilings.cjs hands back holds `files` as a Set, which does
// not survive JSON round-tripping. cycle-driver is invoked once per phase
// boundary (a fresh process each time), so the ledger has to be persisted to
// disk between calls. T3 (sim-foundation-repairs): the (de)serialization is
// SINGLE-SOURCED in ceilings.cjs (serializeLedger / persistSpendLedger /
// loadSpendLedger) -- this driver is a thin adapter over that producer and
// carries no ledger serialization of its own, so the persisted form journal.cjs
// validates provenance against is the same form every writer produces.
// loadSpendLedger fails closed on identity (schema + charter_hash), so a
// ledger persisted against a DIFFERENT charter is never silently re-stamped
// with the current charter's identity and trusted.

// Run a sibling CLI tool as a child process rather than require()-ing it: both
// preflight-and-journal.cjs and write-review-decision.cjs call process.exit()
// unconditionally at module scope (they were built as standalone tools, not
// libraries), so require()-ing them here would exit THIS process instead of
// returning a result. Spawning them is a zero-risk adapter -- neither file is
// touched, and cycle-driver's own contract ("every subcommand is a thin
// argument adapter... never reimplements") holds for a CLI tool exactly the
// way it holds for an exported function.
function runNodeTool(scriptPath, args) {
  try {
    const stdout = execFileSync('node', [scriptPath, ...args], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || String(err.message || err)
    };
  }
}

const commands = {
  // create-charter <specPath> <outPath>
  'create-charter': (specPath, outPath) => {
    const charter = charterMod.createCharter(readJson(specPath));
    const abs = writeJson(outPath, charter);
    // Independent read-back: re-read from disk and revalidate, so the receipt
    // proves delivery rather than self-consistency of an in-memory object.
    const readBack = charterMod.readCharter(abs);
    const immut = charterMod.checkImmutability(readBack);
    out({
      wrote: path.relative(REPO_ROOT, abs),
      charter_id: readBack.charter_id,
      charter_hash: readBack.charter_hash,
      lane_binding_hash: readBack.reviewer_roster.lane_binding_hash,
      readback_immutability: immut
    });
    return immut.ok ? 0 : 1;
  },

  // benchmark <charterPath> <outPath> [cycleIndex] [signalsDir]
  benchmark: (charterPath, outPath, cycleIndexArg, signalsDirArg) => {
    const charter = charterMod.readCharter(charterPath);
    const cycleIndex = Number(cycleIndexArg || 0);
    const fingerprintPath = path.resolve(REPO_ROOT, charter.benchmark.fingerprint_path);
    const recorded = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
    // EXPLICIT type guard (C-F4b, S2): a non-array lineage is an unreadable
    // safety record and must halt LOUDLY. Passing it through would be worse
    // than coercing to []: verifyLineageChain on an object returns
    // chain_unbroken:true VACUOUSLY (its walk starts at i=1 and never runs),
    // and coercing to [] is exactly how TT-003 counted 0/5 past a real
    // re-baseline. undefined stays the honest fresh-baseline [] state.
    const lineageUnreadable = recorded.lineage !== undefined && !Array.isArray(recorded.lineage);
    const lineage = Array.isArray(recorded.lineage) ? recorded.lineage : [];

    // Codex PR#20 review: the charter's own benchmark.fingerprint_hash is the
    // baseline it was created bound to (checkImmutability enforces the
    // charter itself never changes, but nothing previously compared that
    // immutable binding against the RECORDED fingerprint file's own hash).
    // If the baseline file is edited or re-recorded after charter creation,
    // and the new content happens to match the current colony run, bench
    // .check() reports identical:true and the cycle proceeds even though the
    // charter is bound to a fingerprint that no longer exists on disk.
    const fingerprintBindingMismatch =
      typeof recorded.fingerprint_hash === 'string'
      && typeof charter.benchmark.fingerprint_hash === 'string'
      && recorded.fingerprint_hash !== charter.benchmark.fingerprint_hash;

    // Re-baseline checks run BEFORE the comparison, per the every-cycle invariant.
    const rebaseline = bench.checkRebaselineFrequency(lineage, {
      n_threshold: charter.benchmark.rebaseline_detector.n_threshold,
      m_window: charter.benchmark.rebaseline_detector.m_window,
      current_cycle_index: cycleIndex,
      // T4: the benchmark subcommand binds the charter identity and signals
      // surface so a tripped detector can FILE its finding at the canonical
      // path _dev/reports/signals/ticktock-rebaseline-frequency__<id>__<cycle>.json
      charter_id: charter.charter_id,
      charter_hash: charter.charter_hash,
      signals_dir: signalsDirArg || undefined
    });
    const lineageChain = lineageUnreadable
      ? { chain_unbroken: false, independently_verified: true, errors: [{ message: 'lineage is not an array — unreadable safety record' }], entries: 0 }
      : bench.verifyLineageChain(lineage);

    let result = null;
    let error = null;
    try {
      result = bench.check({
        specPath: path.resolve(REPO_ROOT, charter.benchmark.colony_spec_path),
        fingerprintPath
      });
    } catch (e) {
      error = { message: String(e && e.message), stack_first_line: String(e && e.stack || '').split('\n')[1] || null };
    }

    const halt = rebaseline.halt_state
      || (fingerprintBindingMismatch ? 'FINGERPRINT-BINDING-MISMATCH' : null)
      || (!lineageChain.chain_unbroken ? 'LINEAGE-CHAIN-BROKEN' : null)
      || (error ? 'BENCHMARK-ERROR' : null)
      // Codex PR#20 (round 2): bench.check() returns { result, observed, recorded }
      // -- the comparison verdict is nested at result.result.identical, not
      // result.identical (which is always undefined on the wrapper object).
      // The bare `result.identical` check above silently never fired.
      || (result && result.result && result.result.identical === false ? 'BENCHMARK-DIVERGENCE' : null);

    const payload = {
      schema: 'TickTockBenchmarkCheck/1.0',
      checked_at: new Date().toISOString(),
      charter_hash: charter.charter_hash,
      cycle_index: cycleIndex,
      fingerprint_path: charter.benchmark.fingerprint_path,
      fingerprint_hash_declared: charter.benchmark.fingerprint_hash,
      fingerprint_hash_recorded: typeof recorded.fingerprint_hash === 'string' ? recorded.fingerprint_hash : null,
      rebaseline_frequency: rebaseline,
      lineage_chain: lineageChain,
      benchmark_error: error,
      result,
      halt_state: halt
    };
    writeJson(outPath, payload);
    out(payload);
    return halt ? 1 : 0;
  },

  // idem <charterPath> <phaseId> <cycleIndex> <discriminator>
  idem: (charterPath, phaseId, cycleIndex, discriminator) => {
    const charter = charterMod.readCharter(charterPath);
    const key = charterMod.idempotencyKey(phaseId, charter.charter_hash, Number(cycleIndex), discriminator);
    out({ phase_id: phaseId, cycle_index: Number(cycleIndex), discriminator, idempotency_key: key });
    return 0;
  },

  // idem-resolve <journalPath> <key>
  'idem-resolve': (journalPath, key) => {
    out(journal.resolveIdempotency(journal.readJournal(path.resolve(REPO_ROOT, journalPath)), key));
    return 0;
  },

  // phase <journalPath> <partialJsonPath>
  //   partial JSON: {charter_hash, cycle_index, phase_id, idempotency_key?,
  //                  halt_state?, halt_detail?, inherited_gate_checks?,
  //                  dispatch?, artifact_paths: []}
  phase: (journalPath, partialPath) => {
    const partial = readJson(partialPath);
    const artifactPaths = (partial.artifact_paths || []).map((p) => path.resolve(REPO_ROOT, p));
    delete partial.artifact_paths;
    const abs = path.resolve(REPO_ROOT, journalPath);
    const record = artifactPaths.length
      ? journal.completePhase(abs, partial, artifactPaths)
      : journal.appendRecord(abs, partial);
    out({
      record_index: record.record_index,
      phase_id: record.phase_id,
      effect_class: record.effect_class,
      cycle_index: record.cycle_index,
      halt_state: record.halt_state,
      verified_checkpoint: record.verified_checkpoint,
      idempotency_key: record.idempotency_key,
      record_hash: record.record_hash
    });
    return 0;
  },

  // manifest <manifestJsonPath> <dir>
  manifest: (manifestPath, dir) => {
    const manifest = readJson(manifestPath);
    const receipt = gm.writeGenerationManifest(manifest, { dir: path.resolve(REPO_ROOT, dir) });
    out(receipt);
    return 0;
  },

  // lineage-check <charterPath>  -- read-only, no colony run
  'lineage-check': (charterPath) => {
    const charter = charterMod.readCharter(charterPath);
    const recorded = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, charter.benchmark.fingerprint_path), 'utf8'));
    // Same explicit type guard as the benchmark command: a non-array lineage
    // reports a broken chain, never a vacuous clean one (C-F4b, S2).
    const unreadable = recorded.lineage !== undefined && !Array.isArray(recorded.lineage);
    const chain = unreadable
      ? { chain_unbroken: false, independently_verified: true, errors: [{ message: 'lineage is not an array — unreadable safety record' }], entries: 0 }
      : bench.verifyLineageChain(Array.isArray(recorded.lineage) ? recorded.lineage : []);
    out({
      fingerprint_schema: recorded.schema,
      lineage_entries: Array.isArray(recorded.lineage) ? recorded.lineage.length : 0,
      chain
    });
    // Codex PR#20 review: this used to return nonzero ONLY for the
    // non-array case. When lineage IS an array but verifyLineageChain()
    // itself reports chain_unbroken:false (a missing field or a broken
    // adjacent-hash link), the command printed the failure and still exited
    // 0 -- any shell coordinator checking exit status alone would treat a
    // broken lineage as a passing check.
    return (unreadable || chain.chain_unbroken === false) ? 1 : 0;
  },

  // THE CEILING-EXCEEDED CALL SITE. ceilings.cjs's spend accumulator and
  // comparison-and-halt were correct and independently tested but had no
  // caller with literal path arguments -- this is that caller.
  //
  // ceiling-check <charterPath> <ledgerPath> <deltaJsonPath> <journalPath> [receiptOutPath]
  //   deltaJsonPath: {lines_changed?, files?: string[], external_actions?,
  //                   phase_id, cycle_index}
  //   ledgerPath: persisted TickTockSpendLedger/1.0, created on first call and
  //     accumulated across every subsequent boundary in the run.
  //   receiptOutPath: when given, a T2 boundary-bound spend receipt for this
  //     exact {phase_id, cycle_index} is written here (only when the check is
  //     within ceiling -- an over-ceiling boundary halts instead of
  //     certifying a completion). A coordinator reads this file and includes
  //     its contents as `spend_receipt` in the completion partial it hands to
  //     the `phase` command; that is the mechanical link between "the ceiling
  //     was checked" and "the completion carries proof of it."
  //
  // Exit 0 when within ceiling, 1 when CEILING-EXCEEDED (the module's own
  // enforceCeilingsAtPhaseBoundary throws on halt; that throw is the result,
  // per this file's own contract -- caught here only to report structured
  // output and a matching exit code, never converted into a warning).
  'ceiling-check': (charterPath, ledgerPath, deltaPath, journalPath, receiptOutPath) => {
    const charter = charterMod.readCharter(charterPath);
    const delta = readJson(deltaPath);
    const ledgerAbs = path.resolve(REPO_ROOT, ledgerPath);
    const ledger = ceilings.loadSpendLedger(ledgerAbs, charter);
    ceilings.accumulate(ledger, delta);

    let result;
    let receipt = null;
    try {
      result = ceilings.enforceCeilingsAtPhaseBoundary({
        charter,
        ledger,
        phase_id: delta.phase_id,
        cycle_index: delta.cycle_index,
        journalPath: path.resolve(REPO_ROOT, journalPath),
        throwOnHalt: false
      });
      if (!result.halted && receiptOutPath) {
        receipt = ceilings.buildSpendReceipt({
          charter,
          ledger,
          phase_id: delta.phase_id,
          cycle_index: delta.cycle_index,
          ledgerDir: path.dirname(ledgerAbs)
        });
        writeJson(receiptOutPath, receipt);
      }
    } finally {
      // Persist the accumulated spend regardless of outcome -- a halted
      // boundary still spent what it spent, and a resumed run must see it.
      ceilings.persistSpendLedger(ledger, ledgerAbs);
    }

    out({ ...result, spend_receipt: receipt });
    return result.halted ? 1 : 0;
  },

  // THE pretooluse-live / G-TICKTOCK-REVIEW CALL SITE, journalling
  // GATE-BLOCKED on refusal. preflight-and-journal.cjs already IS this
  // emitter (S4-B finding G3's repair); it simply had no caller with literal
  // path arguments either. Delegates to it as a child process (see
  // runNodeTool's comment for why require() is unsafe here) rather than
  // reimplementing its verdict-then-record logic.
  //
  // preflight <charterPath> <journalPath> <cycleIndex> [-- <invocation tokens...>]
  preflight: (charterPath, journalPath, cycleIndex, ...rest) => {
    const sep = rest.indexOf('--');
    const tokens = sep !== -1 ? rest.slice(sep + 1) : [];
    const args = ['--charter', charterPath, '--journal', journalPath, '--cycle', String(cycleIndex)];
    if (tokens.length) args.push('--', ...tokens);
    const result = runNodeTool(PREFLIGHT_AND_JOURNAL, args);
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.status;
  },

  // THE MERGE-NOT-CLEAN CALL SITE. write-review-decision.cjs already IS this
  // emitter (S4-B finding G2's repair, inline in its main()); it had no
  // caller with literal path arguments from a live-cycle driver either --
  // only dryrun-s3.cjs's acceptance-test harness invoked it. Delegates to it
  // as a child process for the same require()-is-unsafe reason as `preflight`
  // above, so this file never re-derives the roster/lane conjunction
  // write-review-decision.cjs already computes and validates.
  //
  // review-decision <charterPath> <lanesJsonPath> <decidedBy> <atIso>
  //   [--out <path>] [--journal <path>] [--cycle <n>] [--debrief <path>]
  //   [--cleared] [--dry-run] [--step <id>]
  'review-decision': (charterPath, lanesPath, decidedBy, at, ...rest) => {
    const dryRun = rest.includes('--dry-run');
    // THE call site for MERGE-NOT-CLEAN reaching the journal in a live cycle.
    // write-review-decision.cjs treats --journal as optional (it is also run
    // before any journal exists), but a caller of THIS command that omits it
    // gets a written-but-unjournalled halt -- the exact false-safety shape
    // this wiring exists to close. Refuse rather than silently proceed
    // journal-less, except in --dry-run, which writes nothing durable at all.
    const journalFlagIndex = rest.indexOf('--journal');
    // A bare `--journal` with no operand (or one immediately followed by
    // another flag) is not a journal path -- write-review-decision.cjs would
    // read it as absent and this guard must not treat the flag's mere
    // PRESENCE as satisfying the requirement.
    const journalPathGiven = journalFlagIndex !== -1
      && journalFlagIndex + 1 < rest.length
      && !String(rest[journalFlagIndex + 1]).startsWith('--');
    if (!dryRun && !journalPathGiven) {
      const msg = 'REFUSED: cycle-driver review-decision requires --journal <path> (or --dry-run). '
        + 'A merge decision written without a journal path can be not-clean with no durable MERGE-NOT-CLEAN record -- the false-safety shape this command exists to close.';
      process.stderr.write(msg + '\n');
      return 1;
    }

    const args = ['--charter', charterPath, '--lanes', lanesPath, '--decided-by', decidedBy, '--at', at, ...rest];
    const result = runNodeTool(WRITE_REVIEW_DECISION, args);
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0 || dryRun) return result.status;

    // write-review-decision.cjs itself returns 0 whenever the decision
    // artifact was written and validated -- true regardless of whether the
    // ship-halt for a not-clean decision actually reached the journal (a
    // journalling exception there is caught, logged, and the exit code left
    // at 0: "the decision STANDS ... only the halt record is missing"). A
    // caller of this driver that only checks the exit code would proceed
    // past a lost halt. Re-derive from the receipt and refuse here instead.
    let receipt = null;
    try { receipt = JSON.parse(result.stdout); } catch { /* non-JSON stdout is its own problem, handled below */ }
    if (!receipt || typeof receipt.cleared !== 'boolean') {
      process.stderr.write(`REFUSED: review-decision produced no parseable receipt with a boolean "cleared" field; cannot confirm the halt reached the journal. Got: ${result.stdout.slice(0, 500)}\n`);
      return 1;
    }
    if (receipt.cleared === false) {
      const journalled = receipt.merge_not_clean_journalled;
      const recordIndexValid = journalled && Number.isInteger(journalled.record_index) && journalled.record_index >= 0;
      if (!journalled || journalled.error || !recordIndexValid || journalled.halt_state !== 'MERGE-NOT-CLEAN') {
        process.stderr.write(
          `REFUSED: decision ${receipt.decision_id} is not cleared but MERGE-NOT-CLEAN was NOT confirmed in the journal (merge_not_clean_journalled: ${JSON.stringify(journalled)}). `
          + 'The decision artifact stands; the halt record does not. Fix the journal path/permissions and re-run before treating this cycle as halted correctly.\n'
        );
        return 1;
      }
    }
    return 0;
  }
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) {
    process.stderr.write(`usage: cycle-driver.cjs <${Object.keys(commands).join('|')}> ...\n`);
    return 2;
  }
  return fn(...rest);
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    // A module refusal is the result. Print it as structured output and exit
    // non-zero -- never swallow it into a warning.
    process.stdout.write(JSON.stringify({
      refused: true,
      error: String(e && e.message),
      halt_state: e && e.halt_state ? e.halt_state : null,
      validation: e && e.validation ? e.validation : null,
      code: e && e.code ? e.code : null
    }, null, 2) + '\n');
    process.exit(1);
  }
}

module.exports = { commands };
