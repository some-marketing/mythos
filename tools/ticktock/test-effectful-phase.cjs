#!/usr/bin/env node
'use strict';

// tools/ticktock/test-effectful-phase.cjs -- acceptance tests for the
// dispatch-then-confirm wrapper (codex PR#20 review finding on
// effectful-phase.cjs: a dispatch() throw was unconditionally treated as
// EFFECT-DID-NOT-HAPPEN even when the external call may have already been
// sent -- e.g. the response was lost, truncated, or unparsable, or the
// process was killed mid-flight). No test file existed for this module
// before this one.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runEffectfulPhase } = require('./effectful-phase.cjs');
const journal = require('./journal.cjs');
const charterMod = require('./charter.cjs');
const ceilings = require('./ceilings.cjs');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  PASS  ${name}\n`); }
  catch (err) { failed += 1; process.stdout.write(`  FAIL  ${name}\n    ${err.stack || err.message}\n`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MINIMAL_TEMPLATE = path.join(__dirname, '__fixtures__', 'charter-template-test-minimal.json');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-effectful-phase-'));

function fixtureCharter(id) {
  return charterMod.createCharter({
    charter_id: id,
    created_at: '2026-08-17T00:00:00.000Z',
    target: { description: 'effectful-phase guard fixture', repo_root: REPO_ROOT, subject: 'unit test' },
    cycle_ceiling: 5,
    evaluator_versions: { journal: '1.0' },
    allowed_write_surfaces: ['tools/ticktock/**'],
    max_cumulative_diff: { lines_changed: 5, files_changed: 2 },
    max_external_actions: 1,
    resource_ceilings: { wall_clock_seconds_per_cycle: 60, wall_clock_seconds_total: 600, max_subagent_dispatches: 1 },
    reviewer_roster: {
      locked_at: '2026-08-17T00:00:00.000Z',
      lanes: [
        { lane_id: 'codex-1', family: 'codex', model_pin: 'gpt-5-codex', assignment_order: 0, role: 'adversarial', availability: { reachable: true, checked_at: '2026-08-17T00:00:00.000Z', check_method: 'bridge-ping' } },
        { lane_id: 'gemini-1', family: 'gemini', model_pin: 'gemini-2.5-pro', assignment_order: 1, role: 'context', availability: { reachable: true, checked_at: '2026-08-17T00:00:00.000Z', check_method: 'bridge-ping' } }
      ]
    },
    stopping_rules: { until_kind: 'cycle_ceiling', halt_conditions: ['EFFECT-RECEIPT-MISSING'] },
    benchmark: {
      colony_spec_path: path.join(tmpRoot, 'no-such-spec.json'),
      colony_spec_version: 'v1',
      fingerprint_path: path.join(tmpRoot, 'no-such-fingerprint.json'),
      fingerprint_hash: 'a'.repeat(64),
      rebaseline_detector: { enabled: true, n_threshold: 2, m_window: 5 }
    }
  }, { templatePath: MINIMAL_TEMPLATE });
}

let seq = 0;
function scratchJournal() {
  seq += 1;
  return path.join(tmpRoot, `journal-${seq}.jsonl`);
}

const CHARTER = fixtureCharter('effectful-phase-fixture');

async function main() {
  await (async () => {
    const journalPath = scratchJournal();
    let preDispatchRecordSeen = false;
    const err = new Error('response lost after send');
    await check2('dispatch() throws WITHOUT proof of neverAttempted -> outcome is receipt-missing, NOT not-happened', async () => {
      const result = await runEffectfulPhase({
        journalPath, charter: CHARTER, cycleIndex: 0, phaseId: 'tt.tick', discriminator: 'a',
        dispatch: async () => {
          // The pre-dispatch crash-safe marker must already be on disk by
          // the time dispatch() runs -- verify this INSIDE dispatch, not
          // after, so a kill-mid-flight scenario is genuinely represented.
          const records = journal.readJournal(journalPath);
          preDispatchRecordSeen = records.some((r) => r.halt_state === 'EFFECT-RECEIPT-MISSING');
          throw err;
        },
        confirmReceipt: async () => true
      });
      assert.strictEqual(result.outcome, 'receipt-missing', JSON.stringify(result));
      assert.strictEqual(result.record.halt_state, 'EFFECT-RECEIPT-MISSING');
    });
    assert.ok(preDispatchRecordSeen, 'the crash-safe marker must be written BEFORE dispatch() is called, not after it throws');
    console.log('  PASS  crash-safety: the in-flight marker exists on disk while dispatch() is still running');
    passed += 1;

    const records = journal.readJournal(journalPath);
    check('resolveIdempotency on the receipt-missing key returns reconcile, never auto-retries', () => {
      const key = charterMod.idempotencyKey('tt.tick', CHARTER.charter_hash, 0, 'a');
      const resolution = journal.resolveIdempotency(records, key);
      assert.strictEqual(resolution.resolution, 'reconcile', JSON.stringify(resolution));
    });
  })();

  await (async () => {
    // Codex re-review (2026-08-17): the neverAttempted escape hatch was
    // REMOVED because a caller-supplied boolean on a thrown error is not
    // independent proof -- a dispatcher that performed the effect and then
    // (correctly or incorrectly) believed it hadn't could self-certify a
    // downgrade with no verification, unlike confirmReceipt(). This test now
    // proves the removal is real: even a throw explicitly CLAIMING
    // neverAttempted must NOT be trusted and must still stay uncertain.
    const journalPath = scratchJournal();
    const claimedErr = new Error('validation failed before any network call (claimed, not proven)');
    claimedErr.neverAttempted = true;
    let result;
    try {
      result = await runEffectfulPhase({
        journalPath, charter: CHARTER, cycleIndex: 0, phaseId: 'tt.tick', discriminator: 'b',
        dispatch: async () => { throw claimedErr; },
        confirmReceipt: async () => true
      });
    } catch (e) { result = { threw: e }; }
    check('dispatch() throws claiming neverAttempted=true -> the claim is NOT trusted, outcome stays receipt-missing', () => {
      assert.strictEqual(result.outcome, 'receipt-missing', JSON.stringify(result));
      assert.strictEqual(result.record.halt_state, 'EFFECT-RECEIPT-MISSING');
    });
    check('resolveIdempotency on that key returns reconcile, never auto-executes on an unproven claim', () => {
      const records = journal.readJournal(journalPath);
      const key = charterMod.idempotencyKey('tt.tick', CHARTER.charter_hash, 0, 'b');
      const resolution = journal.resolveIdempotency(records, key);
      assert.strictEqual(resolution.resolution, 'reconcile', JSON.stringify(resolution));
    });
  })();

  await (async () => {
    const journalPath = scratchJournal();
    const artifactPath = path.join(tmpRoot, 'effect-output.json');
    fs.writeFileSync(artifactPath, JSON.stringify({ ok: true }));
    const ledger = ceilings.createSpendLedger(CHARTER);
    const spendReceipt = ceilings.buildSpendReceipt({
      charter: CHARTER, ledger, phase_id: 'tt.tick', cycle_index: 0, ledgerDir: tmpRoot
    });
    let result;
    try {
      result = await runEffectfulPhase({
        journalPath, charter: CHARTER, cycleIndex: 0, phaseId: 'tt.tick', discriminator: 'c',
        dispatch: async () => ({ receiptId: 'r-1' }),
        confirmReceipt: async (r) => r.receiptId === 'r-1',
        artifacts: [artifactPath],
        spendReceipt
      });
    } catch (e) { result = { threw: e }; }
    check('dispatch() succeeds and confirmReceipt confirms -> outcome is completed', () => {
      assert.strictEqual(result.outcome, 'completed', JSON.stringify(result));
      assert.strictEqual(result.record.halt_state, null);
      assert.strictEqual(result.record.verified_checkpoint.verified, true);
    });
    check('resolveIdempotency on the completed key returns skip', () => {
      const records = journal.readJournal(journalPath);
      const key = charterMod.idempotencyKey('tt.tick', CHARTER.charter_hash, 0, 'c');
      const resolution = journal.resolveIdempotency(records, key);
      assert.strictEqual(resolution.resolution, 'skip', JSON.stringify(resolution));
    });
  })();

  await (async () => {
    const journalPath = scratchJournal();
    let result;
    try {
      result = await runEffectfulPhase({
        journalPath, charter: CHARTER, cycleIndex: 0, phaseId: 'tt.tick', discriminator: 'd',
        dispatch: async () => ({ receiptId: 'unconfirmable' }),
        confirmReceipt: async () => false
      });
    } catch (e) { result = { threw: e }; }
    check('dispatch() succeeds but confirmReceipt returns false -> outcome is receipt-missing', () => {
      assert.strictEqual(result.outcome, 'receipt-missing', JSON.stringify(result));
      assert.strictEqual(result.record.halt_state, 'EFFECT-RECEIPT-MISSING');
      assert.strictEqual(result.record.dispatch.dispatched, true);
    });
  })();

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

function check2(name, fn) {
  return fn().then(() => { passed += 1; process.stdout.write(`  PASS  ${name}\n`); })
    .catch((err) => { failed += 1; process.stdout.write(`  FAIL  ${name}\n    ${err.stack || err.message}\n`); });
}

main();
