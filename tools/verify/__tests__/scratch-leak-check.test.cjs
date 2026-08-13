#!/usr/bin/env node
'use strict';

/**
 * scratch-leak-check.test.cjs — node --test suite for the L2 scratch-leak
 * checker.
 *
 * Run: node tools/verify/__tests__/scratch-leak-check.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const { runScratchLeakCheck } = require('../scratch-leak-check.cjs');

const MODULE_PATH = path.join(__dirname, '..', 'scratch-leak-check.cjs');
const MIXED_ROOT = path.join(__dirname, '__fixtures__', 'mixed-root');
const CLEAN_ROOT = path.join(__dirname, '__fixtures__', 'clean-root');

// --- AC2 (1): a leaky reviewer-lane path in a TaskPlan is caught -----------

test('catches a /private/tmp reviewer-lane path cited by a TaskPlan-schema artifact', () => {
  const result = runScratchLeakCheck({ root: MIXED_ROOT });
  assert.strictEqual(result.ok, false);

  const leak = result.leaks.find((l) => l.artifact === '_dev/state/task-plan-reviews/leaky-plan.json');
  assert.ok(leak, 'expected a leak entry for leaky-plan.json');
  assert.strictEqual(leak.field_or_line, 'artifact_path');
  assert.ok(
    leak.offending_path.startsWith('/private/tmp/claude-501/'),
    `expected offending_path to start with /private/tmp/claude-501/, got: ${leak.offending_path}`
  );
  assert.ok(leak.offending_path.includes('/scratchpad/'));
});

// --- AC2 (2): a control artifact citing only _dev/state paths passes -------

test('does not flag an artifact citing only durable _dev/state and _dev/reports paths', () => {
  const result = runScratchLeakCheck({ root: MIXED_ROOT });
  const controlLeak = result.leaks.find((l) => l.artifact === '_dev/state/task-plan-reviews/control-plan.json');
  assert.strictEqual(controlLeak, undefined, 'control-plan.json must not appear in leaks');
});

// --- AC2 (3): scratch_allowed: true is the over-block escape hatch ---------

test('does not flag an artifact with a top-level scratch_allowed:true annotation', () => {
  const result = runScratchLeakCheck({ root: MIXED_ROOT });
  const exemptLeak = result.leaks.find((l) => l.artifact === '_dev/state/task-plan-reviews/exempt-plan.json');
  assert.strictEqual(exemptLeak, undefined, 'exempt-plan.json must not appear in leaks despite citing /tmp');
});

// --- scanned/skipped are always reported, never silent ---------------------

test('result always reports scanned and skipped counts', () => {
  const result = runScratchLeakCheck({ root: MIXED_ROOT });
  assert.strictEqual(typeof result.scanned, 'number');
  assert.strictEqual(typeof result.skipped, 'number');
  assert.ok(result.scanned >= 3, 'expected at least the 3 selected TaskPlan fixtures to be scanned');
});

// --- clean root: fully passing tree ----------------------------------------

test('a fully clean fixture root returns ok:true with zero leaks', () => {
  const result = runScratchLeakCheck({ root: CLEAN_ROOT });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.leaks, []);
});

// --- AC5: write-ledger corroboration is informational, both ledger shapes --
//
// session-1 uses the REAL ledger shape written by
// tools/kernel/hooks/posttool-write-ledger.cjs — top-level {"paths": [...]},
// string entries. session-2 uses the legacy bare-array shape (object
// entries), kept as a compat-fallback arm.

test('ledger corroboration reads the real {"paths":[...]} shape and the legacy bare-array shape, and never changes ok/leaks', () => {
  const result = runScratchLeakCheck({ root: MIXED_ROOT });
  assert.ok(result.ledger_corroboration, 'expected a ledger_corroboration field');
  assert.strictEqual(typeof result.ledger_corroboration.entries_scanned, 'number');
  assert.ok(
    result.ledger_corroboration.entries_scanned >= 4,
    'expected entries from both session-1 (real {"paths":[...]} shape) and session-2 (legacy bare-array shape) to be scanned'
  );
  // The leaky path appears as a plain string entry inside session-1's
  // real-shape "paths" array — corroboration must be non-zero from that
  // arm alone.
  assert.ok(
    result.ledger_corroboration.corroborated_leaks >= 1,
    'expected the leaked path to be corroborated by the real-shape ledger entry'
  );
  // Corroboration is informational only: leaks/ok are unaffected by ledger content.
  assert.strictEqual(result.ok, false);
  assert.ok(result.leaks.length > 0);
});

// --- B3: ledger shape tolerance for the three new posttool-write-ledger.cjs
// entry shapes (Bash candidate, opaque sentinel, cap note) ------------------
//
// session-3 in MIXED_ROOT carries all three: a Bash-mechanism candidate
// entry {path,at,tool:'Bash',mechanism,confidence} whose path matches the
// same leaky scratchpad path as session-1's plain-string entry, an opaque
// sentinel {opaque:true,at,tool,reasons:[]}, and a cap note
// {truncated_entries:true,at,tool,dropped}. Corroboration must count the
// Bash candidate's path entry and silently ignore the sentinel/cap-note
// entries (no path field) without crashing or miscounting them as paths.

test('ledger corroboration tolerates Bash-candidate, opaque-sentinel, and cap-note entry shapes without crashing', () => {
  const result = runScratchLeakCheck({ root: MIXED_ROOT });
  assert.ok(result.ledger_corroboration, 'expected a ledger_corroboration field');
  // session-3 contributes exactly 3 raw entries to entries_scanned (all three
  // shapes are scanned regardless of whether they carry a path).
  assert.ok(
    result.ledger_corroboration.entries_scanned >= 7,
    `expected entries from session-1 (2) + session-2 (2) + session-3 (3) to be scanned, got ${result.ledger_corroboration.entries_scanned}`
  );
  // The Bash-candidate entry's path is the same leaky scratchpad path
  // session-1 already corroborates as a plain string — corroborated_leaks
  // is a leak count (not an entry count), so it must not double-count the
  // same offending_path across the two ledger entries that both name it.
  assert.strictEqual(
    result.ledger_corroboration.corroborated_leaks,
    1,
    'expected exactly one corroborated leak (the scratchpad path), regardless of how many ledger entries name it'
  );
  // Sentinel/cap-note shapes must never surface as corroborated paths or
  // throw — result.ok/leaks stay driven by the direct scan, unaffected.
  assert.strictEqual(result.ok, false);
  assert.ok(result.leaks.length > 0);
});

// --- CLI: non-zero exit on leak, zero on clean ------------------------------

test('CLI exits non-zero and reports the leak against a leaky fixture root', () => {
  let threw = false;
  let output = '';
  try {
    output = execFileSync('node', [MODULE_PATH, '--root', MIXED_ROOT, '--json'], { encoding: 'utf8' });
  } catch (err) {
    threw = true;
    output = err.stdout;
    assert.strictEqual(err.status, 1);
  }
  assert.strictEqual(threw, true, 'expected the CLI to exit non-zero against a leaky root');
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.ok, false);
  assert.ok(parsed.leaks.length > 0);
});

test('CLI exits zero against a clean fixture root', () => {
  const output = execFileSync('node', [MODULE_PATH, '--root', CLEAN_ROOT, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.leaks, []);
});
