#!/usr/bin/env node
'use strict';

// tools/kernel/hooks/__tests__/verify-stamp-independently.test.cjs -- node
// --test suite for the second, independently-authored verifier (plan
// pretooluse-live-second-verifier, S2). Covers AC1 (independence), AC2
// (conjunctive gating + disagreement halt), AC3 (this session's actual
// incident shape), and the adversarial-history/race classes named in the
// guard-spec's redesigned approach.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = require('../verify-stamp-independently.cjs');

function scratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vsi-test-'));
  const stampsDir = path.join(root, '_dev', 'state', 'remote-mutation-stamps');
  fs.mkdirSync(stampsDir, { recursive: true });
  return { root, stampsDir };
}

function writeStamp(stampsDir, name, overrides) {
  const base = {
    schema: 'RemoteMutationStamp/1.0',
    stamp_id: name.replace(/\.json$/, ''),
    granted_at: '2026-08-17T00:00:00.000Z',
    operator_authorization: 'operator said go',
    scope: ['ssh:mutate'],
    conditions: ['test condition'],
    voided: false,
    superseded_by: null,
    expires_at: null,
    source_doc: null
  };
  const stamp = { ...base, ...overrides };
  fs.writeFileSync(path.join(stampsDir, name), JSON.stringify(stamp));
  return stamp;
}

const CANARY = 'ssh orwell powershell -Command "Set-Content -Path C:\\canary\\synthetic.txt -Value canary"';

test('AC1: independence -- module never require()s pretool-remote-mutation-gate.cjs, and never calls its stampInvalidReason()/scopeCovers() as bare function calls', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'verify-stamp-independently.cjs'), 'utf8');
  // Check the actual require() call shape, not prose mentions of the
  // primary module's filename (the file's own doc comments legitimately
  // name it while explaining that it is NOT required).
  assert.ok(!/require\([^)]*pretool-remote-mutation-gate[^)]*\)/.test(src), 'module must not require() the primary gate module');
  // Bare, unqualified calls to the primary's exact function names (as
  // opposed to this module's own independently-prefixed
  // independentStampInvalidReason()/independentScopeCovers() definitions
  // and their internal calls) would only be possible if the primary module
  // were required and destructured under those exact names -- already ruled
  // out by the require() check above, but assert directly on call-shape too:
  // no `stampInvalidReason(` or `scopeCovers(` call site outside of this
  // module's own `independent`-prefixed function definitions.
  // Every real call site in this module is spelled `independentStampInvalidReason(`
  // / `independentScopeCovers(` -- a negative lookbehind for the "ndependent"
  // suffix of that prefix catches any bare `stampInvalidReason(`/`scopeCovers(`
  // call that is NOT part of those independently-named identifiers.
  assert.ok(!/(?<!ndependent)StampInvalidReason\s*\(/.test(src), 'must not call the primary stampInvalidReason() under any alias outside independentStampInvalidReason()');
  assert.ok(!/(?<!ndependent)ScopeCovers\s*\(/.test(src), 'must not call the primary scopeCovers() under any alias outside independentScopeCovers()');
});

test('AC1 (fixture form): a primary-path failure (unreadable stamps dir simulated by a broken source_doc) does not prevent the independent module from producing its own verdict', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    // A stamp the primary gate's OWN loadStamps() would fail to validate for
    // a reason unrelated to scope (missing source_doc file) -- this module
    // reaches its own independent verdict regardless, because it never asks
    // the primary path anything.
    writeStamp(stampsDir, 'a.json', { source_doc: 'does/not/exist.md' });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.ok, true);
    assert.equal(verdict.covered, false, 'the malformed stamp (missing source_doc) must be independently rejected as invalid, so it cannot cover the canary');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validity predicate: a well-formed, unexpired, unvoided stamp with a real source_doc is independently valid', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'authorization doc');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, scope: ['ssh:mutate'] });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.covered, true, 'a valid stamp with a matching exact-key scope entry must independently cover the canary');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validity predicate: voided stamp is independently invalid regardless of scope', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'x');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, voided: true });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.covered, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validity predicate: expired stamp (expires_at <= nowMs) is independently invalid', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'x');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, expires_at: '2026-08-01T00:00:00.000Z' });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.parse('2026-08-17T00:00:00.000Z'));
    assert.equal(verdict.covered, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope predicate: exact-key match grants coverage (kernel-triad review round 2, codex -- CANARY_MUTATING_KEY constant must be independently declared, not derived from raw-text regex alone)', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'x');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, scope: [mod.CANARY_MUTATING_KEY] });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.covered, true, 'an exact-key scope entry (no re: prefix) must grant coverage independently, matching the primary gate\'s own exact-key grant shape');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope predicate: re:-prefixed regex scope entry grants coverage when it matches raw command text', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'x');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, scope: ['re:orwell.*canary'] });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.covered, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope predicate: an unrelated scope entry does not grant coverage', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'x');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, scope: ['load-courier.ps1'] });
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.covered, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// AC2 + AC3: conjunctive comparison against a supplied primary verdict.
// --------------------------------------------------------------------------

test('AC2: CONSISTENT when primary and independent agree (both say not covered)', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    writeStamp(stampsDir, 'a.json', { scope: ['load-courier.ps1'] }); // does not cover the canary
    const result = mod.verifyStampIndependently(root, CANARY, { covered: false }, {});
    assert.equal(result.ok, true);
    assert.equal(result.reason_code, 'CONSISTENT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC3 (this session\'s actual incident shape): primary claims coverage, independent finds none -- DISAGREEMENT, naming both verdicts', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    // No stamp actually covers the canary independently.
    writeStamp(stampsDir, 'a.json', { scope: ['load-courier.ps1'] });
    const result = mod.verifyStampIndependently(root, CANARY, { covered: true }, {});
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, 'DISAGREEMENT');
    assert.equal(result.primary_covered, true);
    assert.equal(result.independent_covered, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC2 reverse direction: primary says not covered, independent finds a covering stamp -- also DISAGREEMENT, not silently resolved by preferring primary', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    const docPath = path.join(root, 'doc.md');
    fs.writeFileSync(docPath, 'x');
    writeStamp(stampsDir, 'a.json', { source_doc: docPath, scope: [mod.CANARY_MUTATING_KEY] });
    const result = mod.verifyStampIndependently(root, CANARY, { covered: false }, {});
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, 'DISAGREEMENT');
    assert.equal(result.primary_covered, false);
    assert.equal(result.independent_covered, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no primary verdict available -- diagnostic-only, not scored as agreement or disagreement (kernel-triad review round 2: preserve evidence even when direct leg never reached a verdict)', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    writeStamp(stampsDir, 'a.json', { scope: ['load-courier.ps1'] });
    const result = mod.verifyStampIndependently(root, CANARY, null, {});
    assert.equal(result.ok, true);
    assert.equal(result.reason_code, 'INDEPENDENT-ONLY-NO-PRIMARY-COMPARISON');
    assert.equal(result.primary_covered, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Race / fingerprint handling.
// --------------------------------------------------------------------------

test('race: a stamps-directory change between the before-fingerprint and this module\'s read is reported as STAMP-STATE-CHANGED-DURING-PROBE, never as a silent disagreement', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    writeStamp(stampsDir, 'a.json', { scope: ['load-courier.ps1'] });
    // A fingerprint that does not match current disk state, simulating a
    // stamp change between the primary's read and this call.
    const staleFingerprint = { 'a.json': 1, 'ghost.json': 2 };
    const result = mod.verifyStampIndependently(root, CANARY, { covered: false }, { beforeFingerprint: staleFingerprint });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, 'STAMP-STATE-CHANGED-DURING-PROBE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fingerprintStampsDir + fingerprintsEqual: identical snapshots compare equal, missing-dir snapshots (null) compare equal to each other', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    writeStamp(stampsDir, 'a.json', {});
    const fp1 = mod.fingerprintStampsDir(root);
    const fp2 = mod.fingerprintStampsDir(root);
    assert.equal(mod.fingerprintsEqual(fp1, fp2), true);

    const missingRoot = path.join(root, 'does-not-exist');
    assert.equal(mod.fingerprintsEqual(mod.fingerprintStampsDir(missingRoot), mod.fingerprintStampsDir(missingRoot)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Malformed input -- fail-closed.
// --------------------------------------------------------------------------

test('malformed stamp JSON -> STAMP-UNPARSEABLE, fail-closed (not treated as no-coverage)', () => {
  const { root, stampsDir } = scratchRepo();
  try {
    fs.writeFileSync(path.join(stampsDir, 'broken.json'), '{ not valid json');
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason_code, 'STAMP-UNPARSEABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing stamps directory -> STAMPS-DIR-UNREADABLE, fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vsi-test-nodir-'));
  try {
    const verdict = mod.independentCoverageVerdict(root, CANARY, Date.now());
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason_code, 'STAMPS-DIR-UNREADABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
