#!/usr/bin/env node
'use strict';

/**
 * adapter-contract.test.js — shared receipt-bound memory-adapter acceptance tests.
 *
 * These are OPERATIONAL FALSIFIERS (grounding gate G4): each test states its
 * frozen fixture and its denominator, and runs hermetically against a temp
 * canonical store via CAT_MEMORY_ROOT — never the real one.
 *
 * AUTHORITATIVE REVIEW: per producer-cannot-self-validate, these tests are NOT
 * self-blessing. They must be reviewed by a DISTINCT intelligence (Codex bridge)
 * before they gate anything (G4). Claude authored them; Codex reviews.
 *
 * Run: node tools/memory/test/adapter-contract.test.js
 * Exit 0 = all runnable falsifiers pass; nonzero = a falsifier failed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const WRITER = path.resolve(__dirname, '..', 'write-canonical-entry.js');
let pass = 0, fail = 0, pending = 0;

function freshRoot({ withEntriesDir }) {
  // Frozen fixture: an empty temp MEMORY_ROOT. withEntriesDir controls whether
  // the canonical entries dir exists (present = reachable; absent = unreachable).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-mem-test-'));
  fs.mkdirSync(path.join(root, '_dev/state'), { recursive: true });
  if (withEntriesDir) fs.mkdirSync(path.join(root, '_dev/state/kernel-memory/entries'), { recursive: true });
  return root;
}
function runWriter(root, args) {
  return spawnSync(process.execPath, [WRITER, ...args], {
    encoding: 'utf8', env: { ...process.env, CAT_MEMORY_ROOT: root }
  });
}
function ledgerLines(root) {
  const p = path.join(root, '_dev/state/memory-ledger.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function skip(name, why) { pending++; console.log(`SKIP  ${name} — ${why}`); }

// ── Falsifier 1: receipt-bound write ────────────────────────────────────────
// Fixture: reachable canonical (entries dir present). Denominator: per write-attempt.
// Falsifies: a write that "succeeds" without producing a canonical receipt.
test('receipt-bound write produces a canonical receipt (exit 0, ledger_event_id, 1 ledger row)', () => {
  const root = freshRoot({ withEntriesDir: true });
  const r = runWriter(root, ['--type', 'reference', '--title', 'T', '--anchor-ref', 'concept:test',
    '--source-artifact', 'test:contract', '--body', 'hello']);
  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status} (${r.stderr})`);
  const receipt = JSON.parse(r.stdout);
  assert.ok(receipt.ok && receipt.ledger_event_id, 'receipt must carry a ledger_event_id');
  const rows = ledgerLines(root);
  assert.strictEqual(rows.length, 1, `expected exactly 1 ledger row, got ${rows.length}`);
  assert.strictEqual(rows[0].event, 'create', 'ledger row must be a create event');
  assert.ok(fs.existsSync(path.join(root, '_dev/state/kernel-memory/entries', `${receipt.id}.json`)), 'entry file must exist');
});

// ── Falsifier 2: CANONICAL_UNREACHABLE → observable refusal, no write ────────
// Fixture: MEMORY_ROOT with NO entries dir (canonical unreachable). Denominator: per write-attempt.
// Falsifies: a silent degradation (writing to cache anyway, or failing without an observable signal).
test('CANONICAL_UNREACHABLE refuses, writes nothing, and emits an OBSERVABLE signal', () => {
  const root = freshRoot({ withEntriesDir: false });
  const r = runWriter(root, ['--type', 'reference', '--title', 'T', '--anchor-ref', 'concept:test',
    '--source-artifact', 'test:contract', '--body', 'hello']);
  assert.strictEqual(r.status, 3, `expected exit 3 (CANONICAL_UNREACHABLE), got ${r.status}`);
  assert.ok(/CANONICAL_UNREACHABLE/.test(r.stderr), 'stderr must carry the observable CANONICAL_UNREACHABLE signal');
  assert.strictEqual(ledgerLines(root).length, 0, 'no ledger row may be written when canonical is unreachable');
});

// ── Falsifier 3: supersede is one create+supersedes, not a duplicate event (S1/D1) ──
// Fixture: reachable canonical; write A, then write B superseding A. Denominator: per supersession.
// Falsifies: the old bug where the duplicate --event flag turned create into a bare supersede.
test('supersession = ONE create event carrying supersedes (not a duplicate --event)', () => {
  const root = freshRoot({ withEntriesDir: true });
  const a = JSON.parse(runWriter(root, ['--type', 'reference', '--title', 'A', '--anchor-ref', 'concept:test',
    '--source-artifact', 'test:contract', '--body', 'first']).stdout);
  const before = ledgerLines(root).length;
  runWriter(root, ['--type', 'reference', '--title', 'B', '--anchor-ref', 'concept:test',
    '--source-artifact', 'test:contract', '--body', 'second', '--supersedes', a.id]);
  const rows = ledgerLines(root);
  assert.strictEqual(rows.length - before, 1, `supersession must add exactly 1 ledger row, added ${rows.length - before}`);
  const last = rows[rows.length - 1];
  assert.strictEqual(last.event, 'create', `superseding entry must be a create event, got '${last.event}'`);
  assert.strictEqual(last.supersedes, a.id, 'create event must carry the supersedes ref');
});

// ── Pending falsifiers (components not built — defined now, runnable when they exist) ──
skip('trial-balance drift detection', 'trial_balance() not built (later slice). Fixture: cache with 1 entry canonical lacks + 1 hash-mismatch; denominator: per cache entry; expect drift count = 2.');
skip('migration-inventory shape', 'migration is a later slice (deferred). Fixture: a frozen pocket of N memories; denominator: per pocket file; expect inventory enumerates N with {id, hash, has_canonical} each.');

console.log(`\n${pass} pass, ${fail} fail, ${pending} pending (need later-slice components).`);
process.exit(fail > 0 ? 1 : 0);
