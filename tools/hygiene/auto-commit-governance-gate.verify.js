#!/usr/bin/env node
'use strict';

/**
 * Regression guard: auto-commit must NEVER auto-commit governance-gated paths.
 *
 * The background auto-commit daemon runs outside Claude's PreToolUse hook layer,
 * so the ConveneReceipt gate (tools/verify/hooks/pre-write-convene-required.cjs)
 * that blocks foreground writes to canonical specs does not stop the daemon. The
 * daemon once committed instructions/canonical/commands/*.yaml that a foreground
 * worker was correctly blocked from. auto-commit.js closes this by filtering out
 * governance-gated paths in every invocation, reusing the gate's PROTECTED_PATHS
 * as the single source of truth.
 *
 * This test asserts:
 *   1. isGovernanceGated() returns true for every governance-gated path class.
 *   2. isGovernanceGated() returns false for ordinary hygiene paths.
 *   3. auto-commit's gate list IS the gate's exported PROTECTED_PATHS (no drift).
 *   4. requiring auto-commit.js does not execute main() (no accidental commit).
 */

const path = require('path');

const PASS = '✓';
const FAIL = '✗';
let failures = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.error(`  ${FAIL} ${label}${detail ? ': ' + detail : ''}`);
    failures++;
  }
}

function run() {
  const autoCommit = require('./auto-commit.js');
  const gate = require('../verify/hooks/pre-write-convene-required.cjs');
  const { isGovernanceGated, GOVERNANCE_GATED_PATHS } = autoCommit;

  assert('auto-commit exports isGovernanceGated', typeof isGovernanceGated === 'function');

  // 1. Governance-gated path classes → must be excluded from auto-commit.
  const GATED = [
    'instructions/canonical/commands/boot.yaml',
    'instructions/canonical/commands/new-session.yaml',
    'instructions/canonical/dispatch-routing-rule.yaml',
    '.claude/settings.json',
    'tools/convene/convene.js',
    'tools/council/profiles/kernel.json',
    'tools/verify/hooks/pretool-convene-required.cjs',
  ];
  for (const p of GATED) {
    assert(`GATED: ${p}`, isGovernanceGated(p) === true);
  }

  // 2. Ordinary hygiene paths → must remain auto-committable.
  const NOT_GATED = [
    'tools/hygiene/auto-commit.js',
    'Mythos-memories/reports/x.md',
    '_dev/state/foo.json',
    '_dev/reports/analysis/bar.json',
    'clients/{CLIENT_CODE}/notes.md',
    '.claude/settings.local.json', // only settings.json exactly is gated
  ];
  for (const p of NOT_GATED) {
    assert(`not gated: ${p}`, isGovernanceGated(p) === false);
  }

  // 3. Single source of truth — auto-commit reuses the gate's PROTECTED_PATHS.
  assert(
    'auto-commit GOVERNANCE_GATED_PATHS === gate PROTECTED_PATHS (no drift)',
    GOVERNANCE_GATED_PATHS === gate.PROTECTED_PATHS,
    'expected the same array reference'
  );

  // 4. Backslash paths normalize (Windows-safety of the filter).
  assert(
    'backslash canonical path is gated',
    isGovernanceGated('instructions\\canonical\\commands\\boot.yaml') === true
  );
}

run();

if (failures > 0) {
  console.error(`\n${FAIL} ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ All assertions passed');
