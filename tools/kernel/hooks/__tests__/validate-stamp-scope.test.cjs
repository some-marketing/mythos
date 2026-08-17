#!/usr/bin/env node
'use strict';

/**
 * validate-stamp-scope.test.cjs — node --test suite for the remote-mutation
 * stamp scope-broadness guard.
 *
 * Plan: ticktock-remote-mutation-canary-stamp-collision (S1/S2, AC1).
 * Run: node tools/kernel/hooks/__tests__/validate-stamp-scope.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const path = require('path');
const { scopeEntryTooBroad, stampScopeTooBroad } = require('../validate-stamp-scope.cjs');
const gate = require('../pretool-remote-mutation-gate.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STAMPS_DIR = path.join(REPO_ROOT, '_dev', 'state', 'remote-mutation-stamps');

// --- scopeEntryTooBroad -------------------------------------------------

test('bare generic shell verbs are rejected', () => {
  for (const verb of ['ssh', 'scp', 'cat', 'ls', 'mkdir', 'SSH', 'Scp']) {
    assert.ok(scopeEntryTooBroad(verb), `expected '${verb}' to be flagged`);
  }
});

test('unanchored wildcard regexes are rejected', () => {
  assert.ok(scopeEntryTooBroad('re:.*orwell.*'));
  assert.ok(scopeEntryTooBroad('re:.*192\\.168\\.2\\..*'));
});

test('named scripts pass unchanged', () => {
  for (const name of ['load-courier.ps1', 'first-boot.ps1', 'inbound-push.sh', 'run-job.ps1']) {
    assert.strictEqual(scopeEntryTooBroad(name), null, `expected '${name}' to pass`);
  }
});

test('anchored re: patterns pass unchanged', () => {
  const anchored = 're:^\\s*node\\s+tools/ticktock/dryrun-s3\\.cjs(\\s|$)';
  assert.strictEqual(scopeEntryTooBroad(anchored), null);
});

test('a narrow unanchored literal-path regex passes (the antsimv2-projection-lane near-miss)', () => {
  // Two prior drafts of this guard's anchoring rule both broke this REAL
  // production stamp before landing (S2 landing notes, see guard-spec.md).
  // This entry has no leading '^' but is not the incident shape -- it
  // matches one specific, unique path fragment, not an arbitrary substring.
  const nearMiss = 're:AntSimV2[\\\\/]+Tools[\\\\/]+BuildLevel\\.ps1';
  assert.strictEqual(scopeEntryTooBroad(nearMiss), null);
});

// --- stampScopeTooBroad against real shapes -----------------------------

test('the orwell-flag-capture collision shape is rejected', () => {
  const collisionShape = {
    scope: [
      'arp', 'dns-sd', 'ping', 'nmap', 'smb', 'smbclient', 'mount_smbfs', 'scp', 'ssh',
      'cat', 'find', 'ls', 'read', 'open', 'mount', 'umount', 'mkdir',
      're:.*orwell.*', 're:.*taylor.*', 're:.*flag.*', 're:.*192\\.168\\.2\\..*'
    ]
  };
  assert.ok(stampScopeTooBroad(collisionShape));
});

test('every currently-valid narrowly-scoped stamp shape passes', () => {
  const validShapes = [
    { scope: ['inbound-push.sh', 'load-courier.ps1', 'refresh-seed.ps1', 'first-boot.ps1'] },
    { scope: ['build-export.sh', 'inbound-push.sh', 'load-courier.ps1', 'refresh-seed.ps1', 'first-boot.ps1', 'run-job.ps1'] },
    { scope: ['re:^\\s*node\\s+tools/kernel/hooks/__tests__/[A-Za-z0-9._-]+\\.test\\.cjs(\\s|$)'] },
    { scope: ['re:^\\s*node\\s+commands/smos-command-runner\\.cjs\\s+shutdown(\\s|$)'] }
  ];
  for (const s of validShapes) {
    assert.strictEqual(stampScopeTooBroad(s), null, `expected ${JSON.stringify(s.scope)} to pass`);
  }
});

test('regression: every currently-live stamp keeps its prior validity verdict', () => {
  // This is the actual guard against the class of near-miss that happened
  // twice while landing this guard: a rule that "looks right" against
  // curated fixtures but silently invalidates a real, currently-relied-on
  // stamp when run against the real directory. Any stamp whose
  // scope-broadness-independent reasons (schema/voided/expired/etc.) would
  // already mark it invalid is exempt -- this test only asserts the NEW
  // guard doesn't newly invalidate something that was previously fine on
  // every OTHER dimension.
  let names;
  try {
    names = fs.readdirSync(STAMPS_DIR).filter((n) => n.endsWith('.json'));
  } catch (_) {
    return; // no stamps directory in this checkout -- nothing to regress against
  }
  for (const name of names) {
    const stamp = JSON.parse(fs.readFileSync(path.join(STAMPS_DIR, name), 'utf8'));
    const broadnessReason = stampScopeTooBroad(stamp);
    if (!broadnessReason) continue; // guard didn't flag it -- nothing to check here
    // Re-run the gate's validity check with only the newly guarded entries
    // removed. If that baseline is valid, the landed rule has newly invalidated
    // a real stamp and this regression must fail. Existing invalidity (voided,
    // expired, malformed, or missing source evidence) is intentionally exempt.
    const baseline = {
      ...stamp,
      scope: stamp.scope.filter((entry) => !scopeEntryTooBroad(entry))
    };
    const baselineReason = gate.stampInvalidReason(baseline, {
      projectDir: REPO_ROOT,
      fs,
      nowMs: Date.parse('2026-08-16T23:00:00Z')
    });
    assert.notStrictEqual(
      baselineReason,
      null,
      `${name}: the broadness rule newly invalidates a previously-valid real stamp`
    );
    // The guard flagged it. Confirm the reason is one of the two deliberately
    // landed shapes, rather than an accidental false positive.
    assert.match(
      broadnessReason,
      /bare generic shell verb|leading \.\* matches an arbitrary substring/,
      `${name}: flagged for an unexpected reason: ${broadnessReason}`
    );
  }
});

// --- integration: stampInvalidReason() rejects the broad shape ----------

test('stampInvalidReason() rejects a stamp with the collision shape', () => {
  const stamp = {
    schema: gate.STAMP_SCHEMA,
    stamp_id: 'test-broad-shape',
    granted_at: '2026-08-16T20:05:41Z',
    operator_authorization: 'test fixture',
    scope: ['ssh', 'scp', 're:.*orwell.*'],
    conditions: ['test only'],
    expires_at: null,
    voided: false,
    superseded_by: null,
    source_doc: '_dev/reports/analysis/g-remote-mutation-prestamp__nonexistent-fixture__20260101T000000Z.md'
  };
  const reason = gate.stampInvalidReason(stamp, { projectDir: process.cwd(), fs: require('fs'), nowMs: Date.parse('2026-08-16T21:00:00Z') });
  assert.ok(reason, 'expected a rejection reason');
  assert.match(reason, /scope too broad/);
});

test('stampInvalidReason() does not reject on scope-broadness for a narrowly-scoped stamp (may still reject on other fields)', () => {
  const stamp = {
    schema: gate.STAMP_SCHEMA,
    stamp_id: 'test-narrow-shape',
    granted_at: '2026-08-16T20:05:41Z',
    operator_authorization: 'test fixture',
    scope: ['load-courier.ps1'],
    conditions: ['test only'],
    expires_at: null,
    voided: false,
    superseded_by: null,
    source_doc: '_dev/reports/analysis/g-remote-mutation-prestamp__nonexistent-fixture__20260101T000000Z.md'
  };
  const reason = gate.stampInvalidReason(stamp, { projectDir: process.cwd(), fs: require('fs'), nowMs: Date.parse('2026-08-16T21:00:00Z') });
  // This fixture's source_doc deliberately doesn't exist on disk, so a
  // rejection is still expected -- but it must NOT be the scope-broadness
  // reason, proving the guard itself did not fire on a narrow scope.
  if (reason) assert.doesNotMatch(reason, /scope too broad/);
});
