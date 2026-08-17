#!/usr/bin/env node
'use strict';

// THE DISPATCH-THEN-CONFIRM WRAPPER — the missing producer for
// EFFECT-RECEIPT-MISSING and EFFECT-DID-NOT-HAPPEN.
//
// THE DEFECT THIS CLOSES (S4-B finding G1, gemini MAJOR; independently found by
// this session's halt-state audit first). journal.cjs has a FULLY BUILT CONSUMER
// side for these states:
//   - RECONCILIATION_REQUIRED_HALTS includes EFFECT-RECEIPT-MISSING
//   - appendRecord auto-attaches a reconciliation block for it
//   - resolveIdempotency returns 'reconcile' when it is present, and refuses to
//     collapse that uncertainty into either skip or execute
// ...and NO PRODUCER. Nothing in tools/ticktock/ ever writes either state. So the
// guarantee that a resumed cycle will not double-fire an external effect was
// reachable only if a human driver hand-constructed the record.
//
// That is the shape the standing lesson warns about: a declared failure mode no
// code path can fire is a false safety claim. The consumer being immaculate makes
// it worse, not better — it reads as a working guarantee.
//
// THE DISTINCTION THAT MATTERS, and the whole reason two states exist:
//   EFFECT-DID-NOT-HAPPEN  — we halted BEFORE the external call was made. The
//                            effect definitely did not occur. Safe to resume.
//   EFFECT-RECEIPT-MISSING — we halted AFTER dispatching and BEFORE confirming a
//                            receipt. The effect MAY have occurred. NOT safe to
//                            resume; requires reconciliation against the external
//                            system (did the commit land, did the message send).
// Collapsing these two is the bug. "Probably didn't happen" risks a double
// effect; "probably did" risks a silent no-op. Neither is a claim this code is
// entitled to make, so it records the uncertainty instead.
//
// Usage as a library:
//   const { runEffectfulPhase } = require('./effectful-phase.cjs');
//   await runEffectfulPhase({
//     journalPath, charter, cycleIndex, phaseId, discriminator,
//     dispatch: async () => {...},          // performs the external effect
//     confirmReceipt: async (r) => bool,    // independently confirms it landed
//     artifacts: ['path/written/by/the/effect.json']
//   });

const journal = require('./journal.cjs');
const charterMod = require('./charter.cjs');

/**
 * Run one EFFECTFUL phase under the exactly-once contract.
 *
 * Returns {outcome, record}. Outcome is one of:
 *   'skipped'      — idempotency says it already completed with a verified checkpoint
 *   'reconcile'    — idempotency says a prior attempt is UNCERTAIN; halts, does not run
 *   'completed'    — dispatched and receipt confirmed
 *   'not-happened' — failed before dispatch; EFFECT-DID-NOT-HAPPEN journalled
 *   'receipt-missing' — dispatched, receipt unconfirmed; EFFECT-RECEIPT-MISSING journalled
 */
async function runEffectfulPhase(opts) {
  const {
    journalPath, charter, cycleIndex, phaseId, discriminator,
    dispatch, confirmReceipt, artifacts = []
  } = opts;

  const key = charterMod.idempotencyKey(phaseId, charter.charter_hash, cycleIndex, discriminator);

  // 1. Resolve idempotency BEFORE any effect. This is the point of the key.
  const records = journal.readJournal(journalPath);
  const resolution = journal.resolveIdempotency(records, key);
  if (resolution.resolution === 'skip') {
    return { outcome: 'skipped', reason: resolution.reason, record: resolution.record };
  }
  if (resolution.resolution === 'reconcile') {
    // Never auto-retry an uncertain effect. This is the state the consumer side
    // was built for and nothing could produce.
    return { outcome: 'reconcile', reason: resolution.reason, record: resolution.record };
  }

  // 2. Dispatch. A throw HERE means the external call never went out.
  let dispatchResult;
  try {
    dispatchResult = await dispatch();
  } catch (err) {
    const rec = journal.appendRecord(journalPath, {
      charter_hash: charter.charter_hash,
      cycle_index: cycleIndex,
      phase_id: phaseId,
      idempotency_key: key,
      halt_state: 'EFFECT-DID-NOT-HAPPEN',
      halt_detail: `Dispatch threw before the external call completed: ${err.message}. `
        + 'The effect definitely did not occur, so a resume may re-execute this phase normally. '
        + 'Recorded by effectful-phase.cjs.',
      dispatch: { dispatched: false, dispatched_at: null, receipt_confirmed: false, receipt_at: null }
    });
    return { outcome: 'not-happened', error: err, record: rec };
  }

  // 2b. CRASH-SAFE MARKER, written BEFORE the answer is known.
  //
  // The journal schema states the reason itself: the (dispatched,
  // receipt_confirmed) pair "is recorded at dispatch time, before the answer is
  // known, precisely so that a process killed mid-flight leaves the distinction
  // on disk rather than in a dead process's memory."
  //
  // An earlier draft of this file wrote the dispatch block only AFTER
  // confirmation resolved — which would have left a mid-flight kill with NOTHING
  // on disk, exactly the hole this wrapper exists to close. Writing it here means
  // a process that dies between dispatch and confirmation still leaves an
  // uncertain record, and resolveIdempotency will return 'reconcile' on resume.
  const dispatchedAt = new Date().toISOString();
  journal.appendRecord(journalPath, {
    charter_hash: charter.charter_hash,
    cycle_index: cycleIndex,
    phase_id: phaseId,
    idempotency_key: key,
    halt_state: 'EFFECT-RECEIPT-MISSING',
    halt_detail: 'IN FLIGHT: dispatched, receipt not yet confirmed. If this is the '
      + 'last record for this key, the process died between dispatch and confirmation — '
      + 'the effect MAY have occurred and must be reconciled against the external system '
      + 'before any resume. A later completed record for the same key supersedes this one.',
    dispatch: { dispatched: true, dispatched_at: dispatchedAt, receipt_confirmed: false, receipt_at: null }
  });

  // 3. Confirm the receipt INDEPENDENTLY. A dispatch that returned is not proof
  //    the effect landed — the same "tool-reported success is not verification"
  //    rule the checkpoint contract applies everywhere else.
  let confirmed = false;
  let confirmError = null;
  try {
    confirmed = Boolean(await confirmReceipt(dispatchResult));
  } catch (err) {
    confirmError = err;
    confirmed = false;
  }

  if (!confirmed) {
    const rec = journal.appendRecord(journalPath, {
      charter_hash: charter.charter_hash,
      cycle_index: cycleIndex,
      phase_id: phaseId,
      idempotency_key: key,
      halt_state: 'EFFECT-RECEIPT-MISSING',
      halt_detail: 'Dispatch COMPLETED but the receipt could not be confirmed'
        + (confirmError ? ` (confirmation threw: ${confirmError.message})` : '')
        + '. The effect MAY have occurred. Do NOT resume this phase without reconciling '
        + 'against the external system — query whether the effect actually landed. '
        + 'Auto-retry would risk a double effect; auto-skip would risk a silent no-op. '
        + 'Recorded by effectful-phase.cjs.',
      dispatch: { dispatched: true, dispatched_at: dispatchedAt, receipt_confirmed: false, receipt_at: null }
    });
    return { outcome: 'receipt-missing', record: rec, dispatchResult };
  }

  // 4. Confirmed. Complete the phase with a verified checkpoint over its artifacts.
  const rec = journal.completePhase(journalPath, {
    charter_hash: charter.charter_hash,
    cycle_index: cycleIndex,
    phase_id: phaseId,
    idempotency_key: key,
    dispatch: {
      dispatched: true,
      dispatched_at: dispatchedAt,
      receipt_confirmed: true,
      receipt_at: new Date().toISOString()
    }
  }, artifacts);

  return { outcome: 'completed', record: rec, dispatchResult };
}

module.exports = { runEffectfulPhase };
