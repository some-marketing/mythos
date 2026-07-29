#!/usr/bin/env node
'use strict';
// ISOLATION harness for the ARMED loop-protocol enforcement gate.
// Run: `node --test tools/kernel/loop-protocol/__tests__/`
//
// Unlike the sibling unit test (tools/kernel/hooks/__tests__/…), this suite
// invokes the gate as a REAL SUBPROCESS with simulated PreToolUse payloads on
// stdin and asserts on the process EXIT CODE — proving the wired behavior the
// main chain will get, without touching dispatch-pretool.cjs.
//
// Contract proven here:
//   * exit 0  — non-loop actor (no MYTHOS_LOOP_INSTANCE) writing ANYWHERE,
//               including protected paths. THE session-safety guarantee.
//   * exit 0  — resolved loop instance writing its L0-mapped path.
//   * exit 2  — resolved loop instance writing an L1/protected path.
//   * exit 0  — malformed payload / unknown instance (fail-open).
// A separate in-process check proves missing-manifest fail-open.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GATE = path.resolve(__dirname, '..', '..', 'hooks', 'pretool-loop-layer-gate.cjs');
const gate = require(GATE);

// Invoke the gate exactly as dispatch would: stdin = PreToolUse payload,
// MYTHOS_LOOP_INSTANCE env = the loop signal (or unset for a non-loop actor).
function runGate({ stdin, instance }) {
  const env = Object.assign({}, process.env);
  delete env.MYTHOS_LOOP_INSTANCE; // baseline: NOT a loop actor
  if (instance !== undefined) env.MYTHOS_LOOP_INSTANCE = instance;
  const res = spawnSync(process.execPath, [GATE], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env,
    encoding: 'utf8'
  });
  return { code: res.status, stderr: res.stderr || '', stdout: res.stdout || '' };
}

function payload(filePath, content) {
  return { tool_input: { file_path: filePath, content: content || '' } };
}

// ---------------------------------------------------------------------------
// 1. SESSION-SAFETY: a non-loop actor (no env signal) ALWAYS exits 0, even on
//    the most protected paths. This is how the main chain and this very
//    session run.
// ---------------------------------------------------------------------------
const PROTECTED_PATHS = [
  'instructions/canonical/dispatch-routing-rule.yaml',
  'tools/kernel/hooks/dispatch-pretool.cjs',
  'tools/kernel/loop-protocol/protected-path-manifest.json',
  'frameworks/paid-media/ad-creative/guardrails.md',
  '.claude/settings.json',
  'package.json',
  '.git/hooks/pre-commit',
  '_dev/reports/analysis/task-plans/x__plan.json'
];
const ORDINARY_PATHS = [
  'clients/{CLIENT_CODE}/notes.md',
  '_dev/scratch/whatever.txt',
  'README.md'
];

test('non-loop actor writing protected paths → exit 0 (session-safety)', () => {
  for (const p of PROTECTED_PATHS) {
    const r = runGate({ stdin: payload(p, 'verdict: pass\nreview_lane: none') });
    assert.strictEqual(r.code, 0, 'non-loop write to ' + p + ' must exit 0, got ' + r.code);
  }
});

test('non-loop actor writing ordinary paths → exit 0', () => {
  for (const p of ORDINARY_PATHS) {
    const r = runGate({ stdin: payload(p, 'anything') });
    assert.strictEqual(r.code, 0, 'non-loop write to ' + p + ' must exit 0, got ' + r.code);
  }
});

test('empty / whitespace-only env signal is treated as NOT a loop → exit 0', () => {
  const r1 = runGate({ stdin: payload('instructions/canonical/x.yaml', 'verdict: pass'), instance: '' });
  assert.strictEqual(r1.code, 0, 'empty env must exit 0, got ' + r1.code);
  const r2 = runGate({ stdin: payload('instructions/canonical/x.yaml', 'verdict: pass'), instance: '   ' });
  assert.strictEqual(r2.code, 0, 'whitespace env must exit 0, got ' + r2.code);
});

// ---------------------------------------------------------------------------
// 2. GOVERNED LOOP — allowed writes (L0 / L0.5 mapped) → exit 0.
// ---------------------------------------------------------------------------
test('loop instance writing its L0-mapped path → exit 0', () => {
  const r = runGate({ stdin: payload('_dev/loops/{CLIENT_CODE}/plan-notes.md', 'draft'), instance: '{CLIENT_CODE}-ads' });
  assert.strictEqual(r.code, 0, '{CLIENT_CODE}-ads L0 write must exit 0, got ' + r.code);

  const r2 = runGate({
    stdin: payload('_dev/loops/worldforge-sim/drafts/scene-1.md', 'draft'),
    instance: 'worldforge-sim'
  });
  assert.strictEqual(r2.code, 0, 'worldforge-sim L0 write must exit 0, got ' + r2.code);
});

test('loop instance writing its L0.5-granted (non-gate-shaped) path → exit 0', () => {
  const r = runGate({
    stdin: payload('frameworks/paid-media/ad-creative/manifest.json', '{}'),
    instance: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(r.code, 0, '{CLIENT_CODE}-ads L0.5 grant write must exit 0, got ' + r.code);
});

// ---------------------------------------------------------------------------
// 3. GOVERNED LOOP — blocked writes (L1/protected) → exit 2. The ONE deny case.
// ---------------------------------------------------------------------------
test('loop instance writing instructions/canonical/** → BLOCKED (exit 2)', () => {
  const r = runGate({
    stdin: payload('instructions/canonical/dispatch-routing-rule.yaml', 'x'),
    instance: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(r.code, 2, 'must block, got ' + r.code);
});

test('loop instance writing tools/kernel/hooks/** → BLOCKED (exit 2)', () => {
  const r = runGate({
    stdin: payload('tools/kernel/hooks/dispatch-pretool.cjs', 'x'),
    instance: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(r.code, 2, 'must block, got ' + r.code);
});

test('loop instance writing a guardrails file inside its grant → BLOCKED (exit 2)', () => {
  const r = runGate({
    stdin: payload('frameworks/paid-media/ad-creative/guardrails.md', 'never do X'),
    instance: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(r.code, 2, 'guardrails is physics-L1 even inside a grant, got ' + r.code);
});

test('loop instance writing a novel/unmapped path → BLOCKED (exit 2, default-deny)', () => {
  const r = runGate({
    stdin: payload('some/brand/new/gate-tool.cjs', 'authorizes output'),
    instance: 'worldforge-sim'
  });
  assert.strictEqual(r.code, 2, 'unmapped path default-denies for a loop, got ' + r.code);
});

test('loop instance flipping a task-plan governed field → BLOCKED (exit 2)', () => {
  const r = runGate({
    stdin: payload('_dev/reports/analysis/task-plans/x__plan.json', '{ "review_lane": "none" }'),
    instance: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(r.code, 2, 'governed-field write must block, got ' + r.code);
});

// ---------------------------------------------------------------------------
// 4. FAIL-OPEN — malformed payload / unknown instance → exit 0.
// ---------------------------------------------------------------------------
test('malformed (non-JSON) payload → exit 0 (fail-open)', () => {
  const r = runGate({ stdin: 'this is not json {{{', instance: '{CLIENT_CODE}-ads' });
  assert.strictEqual(r.code, 0, 'unparseable stdin must fail-open, got ' + r.code);
});

test('empty stdin → exit 0 (fail-open)', () => {
  const r = runGate({ stdin: '', instance: '{CLIENT_CODE}-ads' });
  assert.strictEqual(r.code, 0, 'empty stdin must exit 0, got ' + r.code);
});

test('unknown instance writing a protected path → exit 0 (fail-open)', () => {
  const r = runGate({
    stdin: payload('instructions/canonical/x.yaml', 'verdict: pass'),
    instance: 'no-such-instance'
  });
  assert.strictEqual(r.code, 0, 'unknown instance must never block, got ' + r.code);
});

test('missing/unreadable manifest → exit 0 (fail-open, in-process)', () => {
  // Exercised in-process because the CLI resolves the manifest by fixed path;
  // main() honors an explicit manifestPath so we can point it at nothing.
  const result = gate.main({
    payload: payload('instructions/canonical/x.yaml', 'verdict: pass'),
    instanceId: '{CLIENT_CODE}-ads',
    manifestPath: '/nonexistent/no-manifest-here.json'
  });
  assert.strictEqual(result.status, 0, 'missing manifest must fail-open');
  assert.strictEqual(result.manifest_error, true);
});

// ---------------------------------------------------------------------------
// 5. The block path still emits a telemetry NOTICE on stderr.
// ---------------------------------------------------------------------------
test('blocked write emits a NOTICE on stderr', () => {
  const r = runGate({
    stdin: payload('instructions/canonical/x.yaml', 'x'),
    instance: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /WOULD BLOCK|BLOCK/i);
});
