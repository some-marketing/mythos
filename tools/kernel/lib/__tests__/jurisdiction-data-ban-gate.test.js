'use strict';

/**
 * Tests for the S3 jurisdiction data-ban gate.
 * Repo convention: node --test (NOT jest).
 *
 * The classifier is INJECTED (`classify`) and mocked so these tests exercise the
 * gate logic in isolation: jurisdiction determination, the BLOCK truth table,
 * fail-closed behavior (garbled target, classifier throws / garbled output), and
 * operator-exception validation. One smoke test uses the REAL S2 classifier to
 * prove the default wiring is sound.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const G = require('../jurisdiction-data-ban-gate.js');
const { checkJurisdictionDataBan, REASONS, PRC_LABEL } = G;

// --- Mock classifiers (S2 shape: { sensitive, unknown, tripped }). ----------
const SENSITIVE = () => ({
  sensitive: true,
  unknown: false,
  tripped: [{ predicate: 'pii', evidence: 'email-address' }],
});
const SENSITIVE_UNKNOWN = () => ({
  sensitive: true,
  unknown: true,
  tripped: [{ predicate: 'classifier_cannot_classify', evidence: 'garbled' }],
});
const NOT_SENSITIVE = () => ({ sensitive: false, unknown: false, tripped: [] });
const THROWS = () => {
  throw new Error('boom');
};
const GARBLED_OUTPUT = () => ({ notTheRightShape: true });

// --- Target descriptors. ----------------------------------------------------
const PRC_TARGET = {
  id: 'glm-5.2-hosted',
  labels: ['hosted-open-weight', 'not-local', 'text-only', PRC_LABEL, 'anthropic-compatible'],
};
const NON_PRC_TARGET = {
  id: 'some-local-mind',
  labels: ['local', 'text-only'],
};

// ---------------------------------------------------------------------------
// Core truth table.
// ---------------------------------------------------------------------------
describe('checkJurisdictionDataBan — truth table', () => {
  it('PRC target + sensitive payload => BLOCKED', () => {
    const r = checkJurisdictionDataBan({ target: PRC_TARGET, payload: 'x', classify: SENSITIVE });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_SENSITIVE);
    assert.equal(r.prcJurisdiction, true);
  });

  it('PRC target + unknown(fail-closed-sensitive) payload => BLOCKED', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: {},
      classify: SENSITIVE_UNKNOWN,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_UNKNOWN_SENSITIVE);
    assert.equal(r.sensitivity.unknown, true);
  });

  it('PRC target + non-sensitive payload => allowed', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'hello world',
      classify: NOT_SENSITIVE,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, REASONS.NOT_SENSITIVE);
    assert.equal(r.prcJurisdiction, true);
  });

  it('non-PRC target + sensitive payload => allowed (gate only governs PRC egress)', () => {
    const r = checkJurisdictionDataBan({
      target: NON_PRC_TARGET,
      payload: 'secret',
      classify: SENSITIVE,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, REASONS.NON_PRC);
    assert.equal(r.prcJurisdiction, false);
    // The gate must NOT have evaluated/leaked a sensitivity verdict for non-PRC.
    assert.equal(r.sensitivity, null);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed proofs.
// ---------------------------------------------------------------------------
describe('checkJurisdictionDataBan — fail-closed', () => {
  // NOTE: every garbled/missing-target test below feeds a genuinely NON-sensitive
  // payload (classify => {sensitive:false}). This is the path that the original
  // ordering bug ALLOWED through (codex S3 review): target-validity must block
  // UNCONDITIONALLY, before the non-sensitive allow branch is ever reached. If
  // these tests used a sensitive payload they would pass even with the bug, which
  // is exactly how the masking happened.

  it('missing target descriptor + NON-sensitive payload => BLOCKED (fail-closed; bug-repro path)', () => {
    const r = checkJurisdictionDataBan({
      target: undefined,
      payload: 'x',
      classify: NOT_SENSITIVE,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_GARBLED_TARGET);
    assert.equal(r.prcJurisdiction, true);
    // Sensitivity must NOT have been consulted to reach the block.
    assert.equal(r.sensitivity, null);
  });

  it('garbled target (no labels array) + NON-sensitive payload => BLOCKED (bug-repro path)', () => {
    const r = checkJurisdictionDataBan({
      target: { id: 'weird', labels: 'not-an-array' },
      payload: 'x',
      classify: NOT_SENSITIVE,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_GARBLED_TARGET);
    assert.equal(r.prcJurisdiction, true);
    assert.equal(r.sensitivity, null);
  });

  it('garbled target (non-string label entry) + NON-sensitive payload => BLOCKED', () => {
    const r = checkJurisdictionDataBan({
      target: { id: 'weird', labels: ['ok', { evil: true }] },
      payload: 'x',
      classify: NOT_SENSITIVE,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_GARBLED_TARGET);
  });

  it('non-object target (string) + NON-sensitive payload => BLOCKED (treated PRC)', () => {
    const r = checkJurisdictionDataBan({ target: 'glm', payload: 'x', classify: NOT_SENSITIVE });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_GARBLED_TARGET);
    assert.equal(r.prcJurisdiction, true);
  });

  it('garbled target + NON-sensitive payload + valid-looking exception => STILL BLOCKED (exception cannot rescue untrustworthy descriptor)', () => {
    const r = checkJurisdictionDataBan({
      target: { id: 'weird', labels: 'not-an-array' },
      payload: 'x',
      classify: NOT_SENSITIVE,
      exception: {
        approval_source: 'operator:{OPERATOR_NAME}',
        reason: 'r',
        timestamp: '2026-06-29T12:00:00Z',
        target: 'weird',
        payload_classes: ['*'],
      },
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_GARBLED_TARGET);
  });

  it('classifier throws => BLOCKED (fail-closed)', () => {
    const r = checkJurisdictionDataBan({ target: PRC_TARGET, payload: 'x', classify: THROWS });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_CLASSIFIER_THREW);
    assert.equal(r.sensitivity.unknown, true);
  });

  it('classifier returns garbled output => BLOCKED (fail-closed)', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: GARBLED_OUTPUT,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.sensitivity.sensitive, true);
  });

  it('no args at all => BLOCKED (treated PRC + sensitive)', () => {
    const r = checkJurisdictionDataBan();
    assert.equal(r.allowed, false);
    assert.equal(r.prcJurisdiction, true);
  });
});

// ---------------------------------------------------------------------------
// Operator exception.
// ---------------------------------------------------------------------------
describe('checkJurisdictionDataBan — operator exception', () => {
  const validException = {
    approval_source: 'operator:{OPERATOR_NAME}',
    reason: 'one-off translation of public marketing copy',
    timestamp: '2026-06-29T12:00:00Z',
    target: 'glm-5.2-hosted',
    payload_classes: ['pii'],
  };

  it('valid exception (covers tripped class) => overrides block (allowed)', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: SENSITIVE, // trips 'pii'
      exception: validException,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, REASONS.EXCEPTION_APPLIED);
    assert.ok(r.exceptionReceipt);
    assert.equal(r.exceptionReceipt.approval_source, 'operator:{OPERATOR_NAME}');
    assert.equal(r.exceptionReceipt.overrides, REASONS.BLOCKED_SENSITIVE);
  });

  it('wildcard exception (*) => overrides block', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: SENSITIVE_UNKNOWN,
      exception: { ...validException, payload_classes: ['*'] },
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, REASONS.EXCEPTION_APPLIED);
  });

  it('exception missing approval_source => does NOT override (still BLOCKED)', () => {
    const { approval_source, ...partial } = validException;
    void approval_source;
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: SENSITIVE,
      exception: partial,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_SENSITIVE);
    assert.equal(r.exceptionRejected, 'exception-missing-approval_source');
  });

  it('exception naming a DIFFERENT target => does NOT override', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: SENSITIVE,
      exception: { ...validException, target: 'some-other-target' },
    });
    assert.equal(r.allowed, false);
    assert.equal(r.exceptionRejected, 'exception-target-mismatch');
  });

  it('exception not covering a tripped class => does NOT override', () => {
    // Payload trips both pii and credentials; exception only grants pii.
    const multi = () => ({
      sensitive: true,
      unknown: false,
      tripped: [
        { predicate: 'pii', evidence: 'e' },
        { predicate: 'credentials', evidence: 'c' },
      ],
    });
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: multi,
      exception: { ...validException, payload_classes: ['pii'] },
    });
    assert.equal(r.allowed, false);
    assert.equal(r.exceptionRejected, 'exception-does-not-cover-class:credentials');
  });

  it('malformed exception (not an object) => does NOT override', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'x',
      classify: SENSITIVE,
      exception: 'yes please',
    });
    assert.equal(r.allowed, false);
    assert.equal(r.exceptionRejected, 'exception-not-an-object');
  });

  it('exception cannot rescue a non-PRC path (already allowed, no receipt)', () => {
    const r = checkJurisdictionDataBan({
      target: NON_PRC_TARGET,
      payload: 'x',
      classify: SENSITIVE,
      exception: validException,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, REASONS.NON_PRC);
    assert.equal(r.exceptionReceipt, undefined);
  });
});

// ---------------------------------------------------------------------------
// Default wiring smoke — REAL S2 classifier (no injected mock).
// ---------------------------------------------------------------------------
describe('checkJurisdictionDataBan — default (real S2) wiring', () => {
  it('PRC target + obviously sensitive payload (email) => BLOCKED via real S2', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'please contact jane.doe@example.com about this',
    });
    assert.equal(r.allowed, false);
    assert.equal(r.prcJurisdiction, true);
    assert.equal(r.sensitivity.sensitive, true);
  });

  it('PRC target + null payload => BLOCKED via real S2 fail-closed (unknown)', () => {
    const r = checkJurisdictionDataBan({ target: PRC_TARGET, payload: null });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, REASONS.BLOCKED_UNKNOWN_SENSITIVE);
  });

  it('PRC target + plainly public payload => allowed via real S2', () => {
    const r = checkJurisdictionDataBan({
      target: PRC_TARGET,
      payload: 'write a haiku about the ocean',
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, REASONS.NOT_SENSITIVE);
  });
});
