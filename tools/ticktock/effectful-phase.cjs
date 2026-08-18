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
 *   'receipt-missing' — dispatch threw, OR dispatched but the receipt is unconfirmed;
 *                       EFFECT-RECEIPT-MISSING journalled either way
 *
 * There is deliberately no 'not-happened'/EFFECT-DID-NOT-HAPPEN outcome from
 * a dispatch() throw (codex re-review, 2026-08-17): an earlier revision let a
 * caller-supplied `err.neverAttempted === true` flag downgrade straight to
 * "definitely didn't happen", but that flag is unverified self-reported
 * metadata on an object the SAME dispatch() call constructed -- exactly the
 * "tool-reported success is not verification" shape this module refuses
 * everywhere else. Removed rather than left exploitable; every throw stays
 * EFFECT-RECEIPT-MISSING. (EFFECT-DID-NOT-HAPPEN can still exist as a
 * halt_state on other records -- e.g. journal.cjs's own producers -- this
 * module just no longer writes one itself.)
 */
async function runEffectfulPhase(opts) {
  const {
    journalPath, charter, cycleIndex, phaseId, discriminator,
    dispatch, confirmReceipt, artifacts = [], spendReceipt = null
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

  // 2. CRASH-SAFE MARKER, written BEFORE dispatch is even called.
  //
  // Codex PR#20 review: the previous design called dispatch() first and only
  // wrote a journal record in the catch block or after a successful return.
  // If the process was KILLED while `await dispatch()` was pending -- or if
  // dispatch() performed the external action and then threw because its
  // response was lost, truncated, or unparsable -- neither path ever ran:
  // a kill leaves nothing on disk at all, and the old catch block wrongly
  // recorded EFFECT-DID-NOT-HAPPEN for a throw that could equally mean the
  // call landed and only the confirmation step failed. Either way, resume
  // could re-execute an effect that may have already happened.
  //
  // Recording uncertainty FIRST closes both holes: a kill mid-dispatch
  // leaves this record as the last one for the key (resolveIdempotency
  // returns 'reconcile'), and ANY throw from dispatch() stays uncertain --
  // there is no downgrade path to "definitely didn't happen" (see the
  // module-level doc comment above for why that escape hatch was removed).
  const dispatchedAt = new Date().toISOString();
  journal.appendRecord(journalPath, {
    charter_hash: charter.charter_hash,
    cycle_index: cycleIndex,
    phase_id: phaseId,
    idempotency_key: key,
    halt_state: 'EFFECT-RECEIPT-MISSING',
    halt_detail: 'IN FLIGHT: about to dispatch, receipt not yet confirmed. If this is the '
      + 'last record for this key, the process died during or immediately after dispatch — '
      + 'the effect MAY have occurred and must be reconciled against the external system '
      + 'before any resume. A later completed or EFFECT-DID-NOT-HAPPEN record for the same key supersedes this one.',
    dispatch: { dispatched: false, dispatched_at: dispatchedAt, receipt_confirmed: false, receipt_at: null }
  });

  // 3. Dispatch.
  //
  // Codex re-review (2026-08-17): an earlier revision let a thrown error's
  // own `neverAttempted === true` flag downgrade this straight to
  // EFFECT-DID-NOT-HAPPEN, permitting immediate auto-resume. That flag is
  // caller-supplied metadata on an object the SAME dispatch() call
  // constructed -- exactly the "tool-reported success is not verification"
  // shape this module's own module-level comment says the checkpoint
  // contract exists to refuse everywhere else. A dispatcher that performs
  // the external action and then throws (a lost/truncated/unparsable
  // response) because it BELIEVES the call never landed -- or is simply
  // wrong -- would self-certify a downgrade with no independent check,
  // unlike confirmReceipt() (a SEPARATE, independently-called function by
  // design, precisely because a dispatch return value alone isn't proof).
  // There is currently no trusted-wrapper mechanism that could verify a
  // neverAttempted claim independently, so removed rather than left
  // exploitable: EVERY throw from dispatch() now stays EFFECT-RECEIPT-MISSING,
  // matching the file's own stated philosophy ("neither auto-retry nor
  // auto-skip... record the uncertainty instead"). The in-flight marker
  // written above already covers this program state.
  let dispatchResult;
  try {
    dispatchResult = await dispatch();
  } catch (err) {
    const rec = journal.appendRecord(journalPath, {
      charter_hash: charter.charter_hash,
      cycle_index: cycleIndex,
      phase_id: phaseId,
      idempotency_key: key,
      halt_state: 'EFFECT-RECEIPT-MISSING',
      halt_detail: `Dispatch threw: ${err.message}. The effect MAY have occurred (e.g. the request `
        + 'was sent but the response was lost, truncated, or unparsable) -- a thrown error alone '
        + 'is never proof the external call was never attempted. Do NOT resume this phase without '
        + 'reconciling against the external system. Auto-retry would risk a double effect; auto-skip '
        + 'would risk a silent no-op. Recorded by effectful-phase.cjs.',
      dispatch: { dispatched: true, dispatched_at: dispatchedAt, receipt_confirmed: false, receipt_at: null }
    });
    return { outcome: 'receipt-missing', error: err, record: rec };
  }

  // 3b. CRASH-SAFE MARKER, written after a successful dispatch return but
  // before the answer about confirmation is known -- same rationale as
  // above, now for the window between dispatch returning and confirmReceipt
  // resolving.
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

  // 4. Confirmed. Complete the phase with a verified checkpoint over its
  // artifacts. T2 (tt-charter-template-and-spend-ledger) requires every
  // completed record to carry a boundary-bound spend_receipt regardless of
  // halt_state -- discovered while writing this module's first test suite:
  // this call site never passed one, so appendRecord's SPEND-RECEIPT-MISSING
  // check would refuse every real completion. spend_receipt is opt-in here
  // (opts.spendReceipt) because building one requires the caller's own
  // spend-ledger bookkeeping (ceilings.buildSpendReceipt), which this module
  // has no access to -- the coordinator driving the cycle is the one that
  // knows what was spent.
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
    },
    ...(spendReceipt ? { spend_receipt: spendReceipt } : {})
  }, artifacts);

  return { outcome: 'completed', record: rec, dispatchResult };
}

module.exports = { runEffectfulPhase };
