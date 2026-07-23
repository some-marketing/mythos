#!/usr/bin/env node
'use strict';

/**
 * Tests for repair-ladder.cjs sandbox verification (grounding A3).
 *
 * Falsifiable contract:
 *   - A tier-1-local proposal whose verify passes in a sandbox -> disposition
 *     upgraded to 'verified-sandbox'; the record is marked, NOT applied.
 *   - A protected-path proposal is refused BEFORE any sandbox run (injected
 *     runner is never called).
 *   - A failing sandbox verify does not upgrade the disposition.
 *   - Every apply-mode decision writes a lane-health receipt.
 *
 * Stdlib only (assert). Run:
 *   node tools/maintenance/__tests__/repair-ladder.sandbox-verify.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RL = require('../repair-ladder.cjs');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; }
  catch (err) { fail++; console.error(`FAIL  ${name}`); console.error(err.stack || err.message); }
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rl-sbx-')); }

function writeProposal(dir, name, record) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(record, null, 2) + '\n');
  return p;
}

function receipts(base) {
  const rp = path.join(base, '_dev/reports/lifecycle/hygiene-lane-health.jsonl');
  if (!fs.existsSync(rp)) return [];
  return fs.readFileSync(rp, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const proposedRecord = (over = {}) => ({
  schema: 'RepairContract/1.0',
  lane: 'demo',
  tier: 'tier-1-local',
  implicated_files: ['tools/launchd/run-demo.cjs'],
  verification_command: 'node tools/launchd/run-demo.cjs',
  status: 'proposed',
  proposal: '--- a/x\n+++ b/x\n@@\n-old\n+new\n',
  disposition: 'pending',
  ...over,
});

// ── verifyProposalRecord: pure decision ──────────────────────────────────────

check('passing sandbox upgrades to verified-sandbox (mark, not apply)', () => {
  const res = RL.verifyProposalRecord(proposedRecord(), { runSandbox: () => ({ passed: true, evidence: { exit_code: 0 } }) });
  assert.equal(res.disposition, 'verified-sandbox');
  assert.equal(res.upgraded, true);
  assert.equal(res.ran, true);
});

check('failing sandbox does NOT upgrade', () => {
  const res = RL.verifyProposalRecord(proposedRecord(), { runSandbox: () => ({ passed: false, evidence: { exit_code: 1 } }) });
  assert.equal(res.upgraded, false);
  assert.equal(res.disposition, 'pending');
  assert.equal(res.ran, true);
});

check('protected path refused BEFORE any sandbox run', () => {
  let called = false;
  const record = proposedRecord({ implicated_files: ['tools/signals/close-signal.js'] });
  const res = RL.verifyProposalRecord(record, { runSandbox: () => { called = true; return { passed: true }; } });
  assert.equal(called, false, 'sandbox runner must not be invoked for protected paths');
  assert.equal(res.upgraded, false);
  assert.equal(res.ran, false);
});

check('frontier-tier refused before sandbox run', () => {
  let called = false;
  const res = RL.verifyProposalRecord(proposedRecord({ tier: 'frontier' }), { runSandbox: () => { called = true; return { passed: true }; } });
  assert.equal(called, false);
  assert.equal(res.ran, false);
});

check('record with no proposal is skipped', () => {
  const res = RL.verifyProposalRecord(proposedRecord({ proposal: null, status: 'contract-only' }), { runSandbox: () => ({ passed: true }) });
  assert.equal(res.ran, false);
  assert.equal(res.upgraded, false);
});

// ── FIX 3: patch-header write-bounds (record cannot spoof past protection) ────
check('patchHeaderPaths extracts target paths from unified diff headers', () => {
  const patch = [
    'diff --git a/tools/signals/close-signal.js b/tools/signals/close-signal.js',
    '--- a/tools/signals/close-signal.js',
    '+++ b/tools/signals/close-signal.js',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const paths = RL.patchHeaderPaths(patch);
  assert.ok(paths.includes('tools/signals/close-signal.js'), 'header path extracted');
  // A bare removed/added content line must NOT be treated as a file path.
  assert.ok(!paths.includes('old') && !paths.includes('new'), 'content lines are not paths');
});

check('protected path present ONLY in the patch (record omits it) is refused before sandbox', () => {
  let called = false;
  // Record claims a benign file; the actual patch writes a protected path.
  const record = proposedRecord({
    implicated_files: ['tools/launchd/run-demo.cjs'],
    proposal: [
      'diff --git a/tools/signals/close-signal.js b/tools/signals/close-signal.js',
      '--- a/tools/signals/close-signal.js',
      '+++ b/tools/signals/close-signal.js',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n'),
  });
  const res = RL.verifyProposalRecord(record, { runSandbox: () => { called = true; return { passed: true }; } });
  assert.equal(called, false, 'sandbox must not run for a patch touching a protected path');
  assert.equal(res.ran, false);
  assert.equal(res.upgraded, false);
  assert.match(res.reason, /write-bounds/);
});

check('/dev/null header (file creation) does not falsely count as a path', () => {
  const patch = [
    '--- /dev/null',
    '+++ b/tools/launchd/run-demo.cjs',
    '@@ -0,0 +1 @@',
    '+content',
  ].join('\n');
  const paths = RL.patchHeaderPaths(patch);
  assert.ok(!paths.includes('/dev/null'), '/dev/null is not a target path');
  assert.ok(paths.includes('tools/launchd/run-demo.cjs'));
});

// ── runVerifySandbox: file mutation + receipts ───────────────────────────────

check('runVerifySandbox marks record file and writes a receipt', () => {
  const base = tmpDir();
  const dir = path.join(base, 'proposals');
  const p = writeProposal(dir, '20260101T000000Z__demo.json', proposedRecord());
  const results = RL.runVerifySandbox({ proposalsDir: dir, base, runSandbox: () => ({ passed: true, evidence: { exit_code: 0 } }) });
  assert.equal(results.length, 1);
  assert.equal(results[0].upgraded, true);
  const updated = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(updated.disposition, 'verified-sandbox');
  assert.ok(updated.sandbox_verification, 'sandbox_verification block written');
  const rec = receipts(base);
  assert.ok(rec.some((r) => r.tool === 'repair-ladder' && r.decision === 'upgraded-verified-sandbox'));
});

check('runVerifySandbox never applies patch to the tree (no proposal file content leaks)', () => {
  const base = tmpDir();
  const dir = path.join(base, 'proposals');
  writeProposal(dir, '20260101T000000Z__demo.json', proposedRecord());
  RL.runVerifySandbox({ proposalsDir: dir, base, runSandbox: () => ({ passed: true }) });
  // The only thing written under base is the proposal + receipt; assert no
  // stray patched target file appeared at base root.
  assert.ok(!fs.existsSync(path.join(base, 'x')), 'no patched target written to tree');
});

check('idempotent: re-running verified record does not double-mark or error', () => {
  const base = tmpDir();
  const dir = path.join(base, 'proposals');
  const p = writeProposal(dir, '20260101T000000Z__demo.json', proposedRecord());
  RL.runVerifySandbox({ proposalsDir: dir, base, runSandbox: () => ({ passed: true }) });
  const first = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Second pass: disposition already verified-sandbox, status still 'proposed'
  // so it re-verifies; must not throw and must remain verified-sandbox.
  const results = RL.runVerifySandbox({ proposalsDir: dir, base, runSandbox: () => ({ passed: true }) });
  assert.equal(results[0].upgraded, true);
  const second = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(second.disposition, 'verified-sandbox');
  assert.equal(first.disposition, second.disposition);
});

console.log(`\nrepair-ladder.sandbox-verify: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
