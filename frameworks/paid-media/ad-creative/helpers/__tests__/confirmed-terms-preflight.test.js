#!/usr/bin/env node
'use strict';
//
// Fixture tests for confirmed-terms-preflight.js (guardrails.md → Amendment B).
// No test-runner dependency — plain Node + assert. Run with:
//   node helpers/__tests__/confirmed-terms-preflight.test.js
// Exit 0 = all pass, exit 1 = one or more failures.
//
// Covers the convene-graded must-fix cases:
//   (a) a dropped confirmed must-appear term is caught (omission diff)
//   (b) a confirmed row without provenance is caught (confirmed-label integrity)
//   (c) a pending fact in load-bearing copy is caught
//   (d) the substring-collision bug does NOT pass ("free" not satisfied by
//       "freelance"; "$500" not satisfied by "$5000") + symbol anchors work
//   (e) malformed and empty ledgers hard-fail (no silent pass)
//   (f) clean copy passes
//   (g) confirmed must-appear with NO anchors hard-fails (unverifiable term)
//
const assert = require('assert');
const path = require('path');
const {
  preflight,
  anchorsPresent,
  anchorRegex,
} = require(path.join(__dirname, '..', 'confirmed-terms-preflight.js'));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
  }
}

const rules = (res) => res.hardFails.map((h) => h.rule);
const hasRule = (res, rule) => rules(res).includes(rule);

// ---------------------------------------------------------------------------
// (a) dropped confirmed must-appear term is caught
// ---------------------------------------------------------------------------
test('(a) dropped confirmed must-appear term -> confirmed-term-omitted, fails', () => {
  const ledger = [{
    id: 'free-test-mechanic',
    status: 'confirmed',
    provenance: 'Client email 2026-07-01 — include the free mechanic check',
    disposition: 'must-appear',
    anchors: ['free', 'mechanic'],
  }];
  const copy = 'Book your test drive today at Acme Auto Sales.'; // no free/mechanic
  const res = preflight(ledger, copy, '');
  assert.strictEqual(res.pass, false, 'expected pass=false');
  assert.ok(hasRule(res, 'confirmed-term-omitted'), `expected confirmed-term-omitted, got ${rules(res)}`);
});

// ---------------------------------------------------------------------------
// (b) confirmed-without-provenance is caught
// ---------------------------------------------------------------------------
test('(b) confirmed row with empty provenance -> confirmed-without-provenance, fails', () => {
  const ledger = [{
    id: 'promo-SAVE500',
    status: 'confirmed',
    provenance: '',
    disposition: 'must-appear',
    anchors: ['SAVE500'],
  }];
  const copy = 'Use code SAVE500 at checkout.';
  const res = preflight(ledger, copy, '');
  assert.strictEqual(res.pass, false, 'expected pass=false');
  assert.ok(hasRule(res, 'confirmed-without-provenance'), `expected confirmed-without-provenance, got ${rules(res)}`);
});

// ---------------------------------------------------------------------------
// (c) pending fact load-bearing is caught
// ---------------------------------------------------------------------------
test('(c) pending fact in load-bearing copy -> pending-fact-load-bearing, fails', () => {
  const ledger = [{
    id: 'promo-SAVE500',
    status: 'pending',
    provenance: '',
    disposition: 'optional',
    anchors: ['SAVE500'],
  }];
  const copy = 'Save big — use code SAVE500 now!'; // load-bearing body
  const res = preflight(ledger, copy, '');
  assert.strictEqual(res.pass, false, 'expected pass=false');
  assert.ok(hasRule(res, 'pending-fact-load-bearing'), `expected pending-fact-load-bearing, got ${rules(res)}`);
});

test('(c2) pending fact only in footnote zone -> passes, recorded as note', () => {
  const ledger = [{
    id: 'promo-SAVE500',
    status: 'pending',
    provenance: '',
    disposition: 'optional',
    anchors: ['SAVE500'],
  }];
  const res = preflight(ledger, 'Book your test drive today.', 'Optional: code SAVE500 pending confirmation.');
  assert.strictEqual(res.pass, true, `expected pass=true, got hardFails ${rules(res)}`);
  assert.ok(res.notes.some((n) => n.rule === 'pending-fact-footnoted'), 'expected pending-fact-footnoted note');
});

// ---------------------------------------------------------------------------
// (d) substring-collision bug does NOT pass
// ---------------------------------------------------------------------------
test('(d1) "free" is NOT satisfied by "freelance" (was the false-negative bug)', () => {
  // word-boundary matcher: "free" must be treated as absent here.
  assert.strictEqual(anchorRegex('free').test('freelance writers wanted'), false);
  assert.strictEqual(anchorsPresent(['free'], 'freelance writers wanted').present, false);

  const ledger = [{
    id: 'free-test-mechanic',
    status: 'confirmed',
    provenance: 'Client call 2026-07-01',
    disposition: 'must-appear',
    anchors: ['free', 'mechanic'],
  }];
  // Copy drops the offer but happens to contain "freelance"/"mechanical".
  const copy = 'Our freelance detailers give every car a mechanical once-over.';
  const res = preflight(ledger, copy, '');
  assert.strictEqual(res.pass, false, 'dropped term must NOT pass via substring collision');
  assert.ok(hasRule(res, 'confirmed-term-omitted'), `expected confirmed-term-omitted, got ${rules(res)}`);
});

test('(d2) "free" IS satisfied by the standalone word "free"', () => {
  assert.strictEqual(anchorRegex('free').test('a free mechanic inspection'), true);
  assert.strictEqual(anchorsPresent(['free', 'mechanic'], 'a free mechanic inspection').present, true);
});

test('(d3) symbol anchors: "$500" matches "$500" but not "$5000"; "20%" matches', () => {
  assert.strictEqual(anchorRegex('$500').test('get $500 cash back'), true, '$500 should match "$500"');
  assert.strictEqual(anchorRegex('$500').test('worth $5000 in value'), false, '$500 must NOT match "$5000"');
  assert.strictEqual(anchorRegex('20%').test('save 20% today'), true, '20% should match');
  assert.strictEqual(anchorRegex('20%').test('save 120% guaranteed'), false, '20% must NOT match inside 120%');
  assert.strictEqual(anchorRegex('$5,000').test('up to $5,000 off'), true, '$5,000 should match');

  const ledger = [{
    id: 'cashback-500',
    status: 'confirmed',
    provenance: 'Client email 2026-07-02',
    disposition: 'must-appear',
    anchors: ['$500'],
  }];
  assert.strictEqual(preflight(ledger, 'Get $500 cash back now.', '').pass, true, '$500 present -> pass');
  assert.strictEqual(preflight(ledger, 'Get $5000 in value.', '').pass, false, 'only $5000 present -> $500 omitted');
});

// ---------------------------------------------------------------------------
// (e) malformed / empty ledger hard-fails
// ---------------------------------------------------------------------------
test('(e1) non-array / no-terms ledger -> malformed-ledger, fails', () => {
  const res = preflight({ foo: 'bar' }, 'any copy', '');
  assert.strictEqual(res.pass, false, 'malformed ledger must not silently pass');
  assert.ok(hasRule(res, 'malformed-ledger'), `expected malformed-ledger, got ${rules(res)}`);
});

test('(e2) empty array ledger -> empty-ledger, fails', () => {
  const res = preflight([], 'any copy', '');
  assert.strictEqual(res.pass, false, 'empty ledger must not silently pass');
  assert.ok(hasRule(res, 'empty-ledger'), `expected empty-ledger, got ${rules(res)}`);
});

test('(e3) empty ledger with --allow-empty-ledger waive -> passes', () => {
  const res = preflight([], 'any copy', '', { allowEmptyLedger: true });
  assert.strictEqual(res.pass, true, 'explicit waive should allow an empty ledger');
});

// ---------------------------------------------------------------------------
// (f) clean copy passes
// ---------------------------------------------------------------------------
test('(f) clean copy with all confirmed terms present -> passes', () => {
  const ledger = [
    {
      id: 'free-test-mechanic',
      status: 'confirmed',
      provenance: 'Client email 2026-07-01',
      disposition: 'must-appear',
      anchors: ['free', 'mechanic'],
    },
    {
      id: 'promo-SAVE500',
      status: 'confirmed',
      provenance: 'Client call 2026-07-02',
      disposition: 'must-appear',
      anchors: ['SAVE500'],
    },
  ];
  const copy = 'Book a test drive: a free mechanic inspection is included. Use code SAVE500.';
  const res = preflight(ledger, copy, '');
  assert.strictEqual(res.pass, true, `expected pass=true, got hardFails ${JSON.stringify(res.hardFails)}`);
  assert.strictEqual(res.hardFails.length, 0);
});

// ---------------------------------------------------------------------------
// (g) confirmed must-appear with NO anchors hard-fails
// ---------------------------------------------------------------------------
test('(g) confirmed must-appear with no anchors -> confirmed-term-unanchored, fails', () => {
  const ledger = [{
    id: 'free-test-mechanic',
    status: 'confirmed',
    provenance: 'Client email 2026-07-01',
    disposition: 'must-appear',
    anchors: [],
  }];
  const res = preflight(ledger, 'some unrelated copy', '');
  assert.strictEqual(res.pass, false, 'unverifiable must-appear term must not pass');
  assert.ok(hasRule(res, 'confirmed-term-unanchored'), `expected confirmed-term-unanchored, got ${rules(res)}`);
});

// ---------------------------------------------------------------------------
console.log('');
console.log(`confirmed-terms-preflight tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
