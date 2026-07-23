#!/usr/bin/env node
'use strict';

/**
 * objection-ledger.test.cjs — node:test suite for the v3 open-objection ledger
 * and the iteration-cap re-init token hardening.
 *   node --test tools/kernel/loop-protocol/__tests__/objection-ledger.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const ledger = require('../objection-ledger.js');
const itercap = require('../iteration-cap.js');

function freshInstance(tag) {
  return `__test-obj-${tag}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
function wipe(inst) {
  for (const f of [ledger.ledgerPath(inst), itercap.capPath(inst), itercap.auditPath(inst)]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
}

const ADV = { actor: 'fable', harness: 'claude-code', family: 'anthropic-apex' };
const COORD = { actor: 'claude-coordinator', harness: 'claude-code', family: 'claude' };
const OPERATOR = { actor: 'sam', harness: 'human', family: 'operator', role: 'operator' };

test('raise -> ledger not clear; only the objecting family can close', () => {
  const inst = freshInstance('close');
  wipe(inst);
  try {
    assert.strictEqual(ledger.isLedgerClearForDry(inst), true, 'empty ledger is clear');

    ledger.raiseObjection(inst, { id: 'C1', raised_by: ADV, summary: 'deep objection' });
    assert.strictEqual(ledger.isLedgerClearForDry(inst), false, 'open objection blocks dry');

    // Coordinator (defending family) may NOT close — this is the custody gate.
    assert.throws(
      () => ledger.closeObjection(inst, 'C1', { closed_by: COORD, close_signature: 'sig' }),
      /closure of "C1" refused/,
      'coordinator cannot close an objection it did not raise'
    );
    assert.strictEqual(ledger.isLedgerClearForDry(inst), false, 'still blocked after refused close');

    // The objecting family CAN close.
    ledger.closeObjection(inst, 'C1', { closed_by: ADV, close_signature: 'adv-resolved' });
    assert.strictEqual(ledger.isLedgerClearForDry(inst), true, 'objecting-family close clears it');
  } finally {
    wipe(inst);
  }
});

test('operator can close any objection', () => {
  const inst = freshInstance('op-close');
  wipe(inst);
  try {
    ledger.raiseObjection(inst, { id: 'C2', raised_by: ADV });
    ledger.closeObjection(inst, 'C2', { closed_by: OPERATOR, close_signature: 'op-ok' });
    assert.strictEqual(ledger.isLedgerClearForDry(inst), true);
  } finally {
    wipe(inst);
  }
});

test('expiry -> UNRESOLVED_OPERATOR_DECISION never clears the ledger', () => {
  const inst = freshInstance('expire');
  wipe(inst);
  try {
    ledger.raiseObjection(inst, { id: 'C3', raised_by: ADV });
    ledger.expireObjection(inst, 'C3', { reason: 'cap exhausted' });
    const objs = ledger.read(inst);
    assert.strictEqual(objs[0].status, ledger.STATUS_UNRESOLVED);
    // Still blocks DRY — expiry is loop-terminal, never ledger-clearing.
    assert.strictEqual(ledger.isLedgerClearForDry(inst), false, 'UNRESOLVED still blocks dry');

    // A family cannot close an UNRESOLVED objection — only the operator.
    assert.throws(
      () => ledger.closeObjection(inst, 'C3', { closed_by: ADV, close_signature: 'x' }),
      /loop-terminal.*only the operator/,
      'family cannot close an UNRESOLVED objection'
    );
    ledger.closeObjection(inst, 'C3', { closed_by: OPERATOR, close_signature: 'op-decides' });
    assert.strictEqual(ledger.isLedgerClearForDry(inst), true, 'operator can resolve UNRESOLVED');
  } finally {
    wipe(inst);
  }
});

test('duplicate objection id is rejected; missing id throws', () => {
  const inst = freshInstance('dup');
  wipe(inst);
  try {
    ledger.raiseObjection(inst, { id: 'D1', raised_by: ADV });
    assert.throws(() => ledger.raiseObjection(inst, { id: 'D1', raised_by: ADV }), /already exists/);
    assert.throws(() => ledger.closeObjection(inst, 'NOPE', { closed_by: ADV, close_signature: 's' }), /no objection with id/);
  } finally {
    wipe(inst);
  }
});

// ---------------------------------------------------------------- iteration-cap
test('iteration-cap: first-time init allowed; re-init requires operator token + audit', () => {
  const inst = freshInstance('itercap');
  wipe(inst);
  try {
    // First-time init: no token needed.
    itercap.init(inst, 3);
    assert.strictEqual(itercap.remaining(inst), 3);

    // Re-init WITHOUT token is refused (even to the same value).
    assert.throws(() => itercap.init(inst, 5), /requires an operator-signed token/);
    assert.strictEqual(itercap.remaining(inst), 3, 'refused re-init did not mutate state');

    // Exhaust it, then prove you STILL cannot silently reset without a token.
    itercap.decrement(inst); itercap.decrement(inst); itercap.decrement(inst);
    assert.strictEqual(itercap.isExhausted(inst), true);
    assert.throws(() => itercap.init(inst, 10), /requires an operator-signed token/,
      'exhausted cap cannot be reset without a token (resettable counter is theater)');

    // Re-init WITH a token succeeds and writes an append-only audit entry.
    assert.strictEqual(fs.existsSync(itercap.auditPath(inst)), false, 'no audit before a token re-init');
    itercap.init(inst, 10, { operatorToken: 'op-signed-abc', reason: 'operator extended budget' });
    assert.strictEqual(itercap.remaining(inst), 10);
    const auditLines = fs.readFileSync(itercap.auditPath(inst), 'utf8').trim().split('\n');
    assert.strictEqual(auditLines.length, 1, 'exactly one audit entry');
    const entry = JSON.parse(auditLines[0]);
    assert.strictEqual(entry.event, 'reinit');
    assert.strictEqual(entry.operator_token_present, true);
    assert.strictEqual(entry.n, 10);

    // Hard-stop-at-zero semantics preserved.
    for (let i = 0; i < 12; i++) itercap.decrement(inst);
    assert.strictEqual(itercap.remaining(inst), 0, 'never negative');
    assert.strictEqual(itercap.isExhausted(inst), true);

    // n validated before the re-init token check.
    assert.throws(() => itercap.init(inst, -1), /non-negative integer/);
  } finally {
    wipe(inst);
  }
});
