#!/usr/bin/env node
'use strict';
/**
 * reattack.test.cjs — re-attack proof for the loop-protocol enforcement
 * rethink. Runnable via plain node (no framework):
 *   node tools/kernel/loop-protocol/__tests__/reattack.test.cjs
 *
 * Proves the fixed SHARED classifier (tools/kernel/loop-protocol/policy) kills
 * the verified exploits from gate-bootstrap-arming-verdict.md and that the
 * promotion merge-gate blocks/passes correctly.
 *
 * KILLS:
 *   C1 path-traversal — frameworks/../instructions/canonical/x.yaml was L0.5,
 *                       must now be L1.
 *   M5 casefold gap   — frameworks/foo/GUARDRAILS.md was L0.5, must now be L1.
 *   Fable Residual 1  — exec-trust surface (.git/hooks, package.json, plists,
 *                       Makefiles) must be auto_L1.
 * CONFIRMS legit paths still classify correctly (no over-blocking):
 *   frameworks/paid-media/ad.json -> L0.5   _dev/loops/{CLIENT_CODE}/draft.md -> L0
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const policy = require('../policy');

const MERGE_GATE = path.join(__dirname, '..', 'merge-gate.cjs');
const GEN = path.join(__dirname, '..', 'gen-protected-set.cjs');
const manifest = policy.loadManifest();

const INSTANCE = '{CLIENT_CODE}-ads'; // holds the frameworks/** L0.5 grant + {CLIENT_CODE} L0 draft surface

let passed = 0;
function ok(label) { passed++; process.stdout.write(`  ok - ${label}\n`); }

function layerOf(fp) {
  return policy.classifyPath(manifest, { file_path: fp, instanceId: INSTANCE }).layer;
}

process.stdout.write('# reattack.test.cjs\n\n## classifier — exploits must classify L1\n');

// --- C1 path-traversal: the headline exploit (was L0.5, writes into canonical) ---
assert.strictEqual(layerOf('frameworks/../instructions/canonical/x.yaml'), 'L1',
  'C1: frameworks/../instructions/canonical/x.yaml must be L1');
ok('C1 killed: frameworks/../instructions/canonical/x.yaml -> L1 (was L0.5)');

// --- C1 variant: traverse into a gate-tool dir ---
assert.strictEqual(layerOf('frameworks/../tools/convene/x.js'), 'L1',
  'frameworks/../tools/convene/x.js must be L1');
ok('C1 killed: frameworks/../tools/convene/x.js -> L1');

// --- M5 casefold: GUARDRAILS uppercase inside a granted substrate ---
assert.strictEqual(layerOf('frameworks/foo/GUARDRAILS.md'), 'L1',
  'M5: frameworks/foo/GUARDRAILS.md must be L1 via casefold');
ok('M5 killed: frameworks/foo/GUARDRAILS.md -> L1 (casefold)');

// --- Fable Residual 1: exec-trust surface ---
assert.strictEqual(layerOf('.git/hooks/pre-commit'), 'L1', '.git/hooks/pre-commit must be L1');
ok('exec-trust: .git/hooks/pre-commit -> L1');
assert.strictEqual(layerOf('package.json'), 'L1', 'package.json must be L1');
ok('exec-trust: package.json -> L1');
assert.strictEqual(layerOf('sub/dir/package.json'), 'L1', 'nested package.json must be L1');
ok('exec-trust: sub/dir/package.json -> L1');
assert.strictEqual(layerOf('Library/LaunchAgents/com.foo.plist'), 'L1', 'plist must be L1');
ok('exec-trust: **/*.plist -> L1');
assert.strictEqual(layerOf('tools/Makefile'), 'L1', 'Makefile must be L1');
ok('exec-trust: **/Makefile -> L1');

// --- absolute-path escape / traversal out of repo ---
assert.strictEqual(layerOf('frameworks/../../../etc/passwd'), 'L1', 'root escape must be L1');
ok('confinement: frameworks/../../../etc/passwd -> L1 (path-escapes-root)');

process.stdout.write('\n## classifier — legit paths must classify correctly (no over-block)\n');

// --- legit L0.5 grant (granted framework, non-gate-shaped) ---
assert.strictEqual(layerOf('frameworks/paid-media/ad.json'), 'L0.5',
  'legit granted framework path must be L0.5');
ok('legit: frameworks/paid-media/ad.json -> L0.5');

// --- legit L0 draft ---
assert.strictEqual(layerOf('_dev/loops/{CLIENT_CODE}/draft.md'), 'L0',
  'legit draft must be L0');
ok('legit: _dev/loops/{CLIENT_CODE}/draft.md -> L0');

process.stdout.write('\n## merge-gate — blocks protected diffs, passes L0-only diffs\n');

function runMergeGate(gateArgs) {
  try {
    const stdout = execFileSync('node', [MERGE_GATE, ...gateArgs], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString() };
  }
}

// --- blocks a diff touching an L1 (exec-trust) path ---
let r = runMergeGate(['--instance', INSTANCE, '--paths', '_dev/loops/{CLIENT_CODE}/draft.md,package.json']);
assert.strictEqual(r.code, 1, 'merge-gate must EXIT 1 on a diff touching package.json');
assert.ok(/MERGE BLOCKED/.test(r.stdout), 'merge-gate must report BLOCK');
ok('merge-gate BLOCKS diff [draft.md, package.json] -> exit 1');

// --- blocks the C1 traversal path too ---
r = runMergeGate(['--instance', INSTANCE, '--paths', 'frameworks/../instructions/canonical/x.yaml']);
assert.strictEqual(r.code, 1, 'merge-gate must EXIT 1 on the C1 traversal path');
ok('merge-gate BLOCKS diff [frameworks/../instructions/canonical/x.yaml] -> exit 1');

// --- passes an L0-only diff ---
r = runMergeGate(['--instance', INSTANCE, '--paths', '_dev/loops/{CLIENT_CODE}/draft.md,frameworks/paid-media/ad.json']);
assert.strictEqual(r.code, 0, 'merge-gate must EXIT 0 on an L0/L0.5-only diff');
assert.ok(/MERGE ALLOWED/.test(r.stdout), 'merge-gate must report ALLOWED');
ok('merge-gate PASSES diff [draft.md, ad.json] -> exit 0');

// --- operator override promotes a protected diff ---
r = runMergeGate(['--instance', INSTANCE, '--operator-confirm', '--paths', 'package.json']);
assert.strictEqual(r.code, 0, 'operator override must allow a protected diff to merge');
assert.ok(/OPERATOR-OVERRIDE/.test(r.stdout), 'merge-gate must report operator override');
ok('merge-gate operator-override PASSES protected diff -> exit 0');

process.stdout.write('\n## gen-protected-set — prints exec-trust-extended set\n');

const genOut = execFileSync('node', [GEN], { encoding: 'utf8' });
for (const needle of ['.git/hooks/**', '**/*.plist', '**/Makefile', '**/package.json', '.claude/settings.json']) {
  assert.ok(genOut.includes(needle), 'gen-protected-set must include ' + needle);
}
ok('gen-protected-set includes exec-trust surface (.git/hooks, plist, Makefile, package.json, settings.json)');

process.stdout.write(`\n# reattack.test.cjs: ${passed} assertions PASSED\n`);
