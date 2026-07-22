'use strict';
//
// clean-room.test.cjs — unit + lifecycle tests for the Clean-Room Re-Expression gate.
//
// Run: node --test tools/clean-room/__tests__/clean-room.test.cjs
//
// State is redirected to a per-test temp dir via CLEAN_ROOM_REPO_ROOT so tests
// never touch the real reports/clean-room/ tree. The module reads that env
// var at require-time, so each CLI invocation runs in a fresh sandbox and the
// in-process API is exercised against a sandbox set up before require.
//
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.resolve(__dirname, '..', 'clean-room.cjs');

// Raw external source: a license-unclear design heuristic snippet.
const RAW_SOURCE = [
  'Progressive disclosure means showing only the controls a user needs right now,',
  'deferring advanced options behind a secondary surface so the primary interface',
  'stays calm. Reveal complexity on demand rather than dumping every option onto',
  'the first screen, which overwhelms newcomers and slows expert recognition.'
].join(' ');

// A near-verbatim copy (only trivial edits) — must FAIL.
const NEAR_VERBATIM = [
  'Progressive disclosure means showing only the controls a user needs right now,',
  'deferring advanced options behind a secondary surface so the primary interface',
  'stays calm. Reveal complexity on demand rather than dumping every option onto',
  'the first screen, which overwhelms newcomers.'
].join(' ');

// A genuine re-expression in Mythos's own words, same concept — must PASS.
const REEXPRESSED = [
  'Mythos surfaces just the inputs a step requires, parking deeper settings one',
  'layer down. The default view stays quiet; operators pull more capability into',
  'view only when a task calls for it, which keeps onboarding gentle without',
  'capping what an experienced actor can reach.'
].join(' ');

// Make a sandbox repo root and require a FRESH copy of the module bound to it.
function freshModule() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-room-'));
  process.env.CLEAN_ROOM_REPO_ROOT = repoRoot;
  delete require.cache[require.resolve('../clean-room.cjs')];
  const mod = require('../clean-room.cjs');
  return { repoRoot, mod };
}

function tmpFile(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function runCli(repoRoot, args) {
  return spawnSync('node', [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLEAN_ROOM_REPO_ROOT: repoRoot }
  });
}

test('overlap metric: near-verbatim scores high, re-expression scores low', () => {
  const { mod } = freshModule();
  const verbatim = mod.overlapScore(RAW_SOURCE, NEAR_VERBATIM);
  const reexpressed = mod.overlapScore(RAW_SOURCE, REEXPRESSED);
  assert.ok(verbatim > mod.DEFAULT_THRESHOLD, `near-verbatim overlap ${verbatim} must exceed threshold ${mod.DEFAULT_THRESHOLD}`);
  assert.ok(reexpressed <= mod.DEFAULT_THRESHOLD, `re-expression overlap ${reexpressed} must be within threshold ${mod.DEFAULT_THRESHOLD}`);
  assert.equal(mod.overlapScore('abc def', 'abc def'), 1, 'identical short text => 1');
  assert.equal(mod.overlapScore('', ''), 0, 'empty/empty => 0');
});

test('quarantine creates the dir + manifest with sha256 of raw text', async () => {
  const { repoRoot, mod } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-src-'));
  const src = tmpFile(srcDir, 'source.md', RAW_SOURCE);
  const { slug, dir, manifest } = await mod.quarantine(src, 'UI-UX Heuristics!');
  assert.equal(slug, 'ui-ux-heuristics', 'slug is sanitized');
  assert.ok(fs.existsSync(dir), 'quarantine dir exists');
  assert.ok(fs.existsSync(path.join(dir, 'raw.txt')), 'raw text quarantined');
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), 'manifest written');
  assert.equal(manifest.source, src);
  assert.equal(manifest.source_type, 'path');
  assert.equal(manifest.sha256, mod.sha256(RAW_SOURCE), 'sha256 matches raw text');
  assert.ok(manifest.retrieved_at, 'retrieved_at present');
  // raw text lives ONLY in the quarantine dir
  assert.ok(dir.includes(repoRoot), 'quarantine is under sandbox repo root');
});

test('verify FAILS on a near-verbatim copy', async () => {
  const { mod } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-src-'));
  await mod.quarantine(tmpFile(srcDir, 's.md', RAW_SOURCE), 'fail-case');
  const out = tmpFile(srcDir, 'copy.md', NEAR_VERBATIM);
  const result = mod.verify('fail-case', out);
  assert.equal(result.pass, false, 'near-verbatim must not pass');
  assert.ok(result.overlap_score > result.threshold);
});

test('verify PASSES on a genuinely re-expressed text', async () => {
  const { mod } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-src-'));
  await mod.quarantine(tmpFile(srcDir, 's.md', RAW_SOURCE), 'pass-case');
  const out = tmpFile(srcDir, 'distilled.md', REEXPRESSED);
  const result = mod.verify('pass-case', out);
  assert.equal(result.pass, true, 're-expression must pass');
  assert.ok(result.overlap_score <= result.threshold);
});

test('release deletes quarantine + writes a CleanRoom/1.0 receipt on PASS', async () => {
  const { mod } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-src-'));
  await mod.quarantine(tmpFile(srcDir, 's.md', RAW_SOURCE), 'release-ok');
  const out = tmpFile(srcDir, 'distilled.md', REEXPRESSED);
  const result = mod.release('release-ok', out);
  assert.equal(result.released, true);
  assert.equal(fs.existsSync(mod.quarantineDir('release-ok')), false, 'quarantine dir deleted (raw text gone)');
  const receipt = JSON.parse(fs.readFileSync(mod.receiptPath('release-ok'), 'utf8'));
  assert.equal(receipt.schema, 'CleanRoom/1.0');
  assert.equal(receipt.id, 'release-ok');
  assert.equal(receipt.source_sha256, mod.sha256(RAW_SOURCE));
  assert.ok(typeof receipt.overlap_score === 'number');
  assert.ok(receipt.verified_at, 'verified_at present');
  assert.ok(receipt.output_path, 'output_path recorded');
});

test('release is WITHHELD (no delete, no receipt) on FAIL', async () => {
  const { mod } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-src-'));
  await mod.quarantine(tmpFile(srcDir, 's.md', RAW_SOURCE), 'release-fail');
  const out = tmpFile(srcDir, 'copy.md', NEAR_VERBATIM);
  const result = mod.release('release-fail', out);
  assert.equal(result.released, false);
  assert.ok(fs.existsSync(mod.quarantineDir('release-fail')), 'quarantine retained on fail');
  assert.equal(fs.existsSync(mod.receiptPath('release-fail')), false, 'no receipt on fail');
});

// ── CLI surface ────────────────────────────────────────────────────────────

test('CLI: quarantine -> verify (exit 0) -> release writes receipt', () => {
  const { repoRoot } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-cli-'));
  const src = tmpFile(srcDir, 'source.md', RAW_SOURCE);
  const out = tmpFile(srcDir, 'distilled.md', REEXPRESSED);

  const q = runCli(repoRoot, ['quarantine', src, '--id', 'cli-case', '--json']);
  assert.equal(q.status, 0, 'quarantine exits 0');
  assert.equal(JSON.parse(q.stdout).slug, 'cli-case');

  const v = runCli(repoRoot, ['verify', 'cli-case', out, '--json']);
  assert.equal(v.status, 0, 're-expressed verify exits 0');
  assert.equal(JSON.parse(v.stdout).pass, true);

  const r = runCli(repoRoot, ['release', 'cli-case', out, '--json']);
  assert.equal(r.status, 0, 'release exits 0');
  const rel = JSON.parse(r.stdout);
  assert.equal(rel.released, true);
  assert.equal(rel.receipt.schema, 'CleanRoom/1.0');
});

test('CLI: verify exits 1 on near-verbatim copy', () => {
  const { repoRoot } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-cli-'));
  const src = tmpFile(srcDir, 'source.md', RAW_SOURCE);
  const out = tmpFile(srcDir, 'copy.md', NEAR_VERBATIM);
  runCli(repoRoot, ['quarantine', src, '--id', 'cli-fail']);
  const v = runCli(repoRoot, ['verify', 'cli-fail', out]);
  assert.equal(v.status, 1, 'near-verbatim verify exits 1');
});

test('CLI: --threshold override changes the verdict', () => {
  const { repoRoot } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-cli-'));
  const src = tmpFile(srcDir, 'source.md', RAW_SOURCE);
  const out = tmpFile(srcDir, 'copy.md', NEAR_VERBATIM);
  runCli(repoRoot, ['quarantine', src, '--id', 'cli-thr']);
  // A permissive threshold of 1.0 lets even a verbatim copy pass.
  const v = runCli(repoRoot, ['verify', 'cli-thr', out, '--threshold', '1']);
  assert.equal(v.status, 0, 'threshold 1.0 => everything passes');
});

test('CLI: --signal emits a VerificationSignal reflecting the verdict', () => {
  const { repoRoot } = freshModule();
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-cli-'));
  const src = tmpFile(srcDir, 'source.md', RAW_SOURCE);
  const out = tmpFile(srcDir, 'distilled.md', REEXPRESSED);
  const sigPath = path.join(srcDir, 'sig.json');
  runCli(repoRoot, ['quarantine', src, '--id', 'cli-sig']);
  const v = runCli(repoRoot, ['verify', 'cli-sig', out, '--signal', sigPath]);
  assert.equal(v.status, 0);
  const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  assert.equal(sig.verdict, 'PASS');
  assert.equal(sig.gate_decision.proceed, true);
});
