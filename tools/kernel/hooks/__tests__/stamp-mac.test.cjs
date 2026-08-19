#!/usr/bin/env node
'use strict';

// tools/kernel/hooks/__tests__/stamp-mac.test.cjs -- unit tests for the
// RemoteMutationStamp/1.0 HMAC signing primitives (codex PR#20 finding F1,
// kernel-triad convene 20260817T184138Z).

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STAMP_MAC_DOMAIN,
  STAMP_MAC_MECHANISM,
  canonicalStampMessage,
  computeStampMac,
  signStamp,
  verifyStampMac
} = require('../lib/stamp-mac.cjs');

const SECRET = 'test-only-secret-never-a-real-keychain-value';
const OTHER_SECRET = 'a-different-secret-simulating-a-forged-signature';

function baseStamp(overrides) {
  return Object.assign({
    schema: 'RemoteMutationStamp/1.0',
    stamp_id: 'example-lane__20260817T000000Z',
    source_doc: '_dev/reports/analysis/g-remote-mutation-prestamp__example__20260817T000000Z.md',
    granted_at: '2026-08-17T00:00:00.000Z',
    operator_authorization: '"go ahead" — operator, test fixture',
    scope: ['load-courier.ps1'],
    conditions: ['test condition'],
    expires_at: null,
    voided: false,
    superseded_by: null
  }, overrides || {});
}

test('signStamp attaches a mac with the expected shape', () => {
  const stamp = signStamp(SECRET, baseStamp());
  assert.equal(typeof stamp.mac, 'object');
  assert.equal(stamp.mac.mechanism, STAMP_MAC_MECHANISM);
  assert.equal(stamp.mac.domain, STAMP_MAC_DOMAIN);
  assert.equal(typeof stamp.mac.value, 'string');
  assert.ok(stamp.mac.value.length > 0);
});

test('AC1: an unsigned stamp (no mac field) is invalid', () => {
  const stamp = baseStamp();
  const verdict = verifyStampMac(SECRET, stamp);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /mac is missing/);
});

test('a correctly-signed stamp verifies against the same secret', () => {
  const stamp = signStamp(SECRET, baseStamp());
  const verdict = verifyStampMac(SECRET, stamp);
  assert.equal(verdict.ok, true);
});

test('AC2: editing ANY field after signing invalidates the mac -- scope', () => {
  const stamp = signStamp(SECRET, baseStamp());
  stamp.scope = ['a-much-broader-scope.ps1'];
  const verdict = verifyStampMac(SECRET, stamp);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /mismatch/);
});

test('AC2: editing ANY field after signing invalidates the mac -- voided (un-voiding cannot resurrect a valid mac)', () => {
  const stamp = signStamp(SECRET, baseStamp({ voided: true }));
  assert.equal(verifyStampMac(SECRET, stamp).ok, true, 'signed as-voided must still verify');
  stamp.voided = false; // an agent trying to "un-void" the stamp
  const verdict = verifyStampMac(SECRET, stamp);
  assert.equal(verdict.ok, false, 'flipping voided back to false must break the mac, not resurrect a valid stamp');
});

test('AC2: editing ANY field after signing invalidates the mac -- expires_at', () => {
  const stamp = signStamp(SECRET, baseStamp({ expires_at: '2026-08-18T00:00:00.000Z' }));
  stamp.expires_at = null; // an agent trying to strip the expiry
  const verdict = verifyStampMac(SECRET, stamp);
  assert.equal(verdict.ok, false);
});

test('AC2: editing ANY field after signing invalidates the mac -- conditions', () => {
  const stamp = signStamp(SECRET, baseStamp());
  stamp.conditions = ['a completely different condition'];
  assert.equal(verifyStampMac(SECRET, stamp).ok, false);
});

test('AC2: editing ANY field after signing invalidates the mac -- source_doc', () => {
  const stamp = signStamp(SECRET, baseStamp());
  stamp.source_doc = '_dev/reports/analysis/g-remote-mutation-prestamp__different__20260817T000000Z.md';
  assert.equal(verifyStampMac(SECRET, stamp).ok, false);
});

test('AC3: a stamp signed with a DIFFERENT secret is invalid (forged-signature simulation)', () => {
  const stamp = signStamp(SECRET, baseStamp());
  const verdict = verifyStampMac(OTHER_SECRET, stamp);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /mismatch/);
});

test('no secret resolvable fails closed', () => {
  const stamp = signStamp(SECRET, baseStamp());
  const verdict = verifyStampMac(null, stamp);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no operator secret/);
});

test('a mac with the wrong mechanism is rejected', () => {
  const stamp = signStamp(SECRET, baseStamp());
  stamp.mac.mechanism = 'md5';
  assert.equal(verifyStampMac(SECRET, stamp).ok, false);
});

test('a mac with the wrong domain is rejected (domain separation from ConveneReceipt/1.0)', () => {
  const stamp = signStamp(SECRET, baseStamp());
  stamp.mac.domain = 'ConveneReceipt/1.0';
  assert.equal(verifyStampMac(SECRET, stamp).ok, false);
});

test('domain separation: a ConveneReceipt-shaped MAC value cannot be replayed as a stamp MAC', () => {
  // Simulate a receipt MAC computed under the SAME secret but a different
  // domain/message shape -- must not accidentally verify as a stamp MAC.
  const crypto = require('crypto');
  const stamp = baseStamp();
  const foreignMac = crypto.createHmac('sha256', SECRET).update('ConveneReceipt/1.0\nsome-other-message', 'utf8').digest('hex');
  stamp.mac = { mechanism: STAMP_MAC_MECHANISM, domain: STAMP_MAC_DOMAIN, value: foreignMac };
  const verdict = verifyStampMac(SECRET, stamp);
  assert.equal(verdict.ok, false);
});

test('canonicalStampMessage excludes only the mac field, includes everything else', () => {
  const stamp = baseStamp();
  const message = canonicalStampMessage(stamp);
  assert.ok(message.startsWith(STAMP_MAC_DOMAIN + '\n'));
  assert.ok(message.includes(stamp.stamp_id));
  assert.ok(message.includes('load-courier.ps1'));
  assert.ok(!message.includes('"mac"'));
});

test('computeStampMac requires a non-empty secret', () => {
  assert.throws(() => computeStampMac('', baseStamp()), /non-empty operator secret/);
  assert.throws(() => computeStampMac(null, baseStamp()), /non-empty operator secret/);
});

test('two stamps differing only in field order produce the same mac (canonicalization is order-independent)', () => {
  const a = signStamp(SECRET, baseStamp());
  const reordered = {};
  for (const k of Object.keys(a).reverse()) reordered[k] = a[k];
  const verdictReordered = verifyStampMac(SECRET, reordered);
  assert.equal(verdictReordered.ok, true, 'key order must not affect MAC verification');
});
