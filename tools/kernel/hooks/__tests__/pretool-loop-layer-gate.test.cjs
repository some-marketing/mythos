#!/usr/bin/env node
'use strict';
// Unit tests for pretool-loop-layer-gate.cjs — the Self-Improving Loop Protocol
// classification hook. Run: `node tools/kernel/hooks/__tests__/pretool-loop-layer-gate.test.cjs`
//
// Proves: L0 content classification, guardrails→L1 (physics carve-out inside a
// grant), task-plan governed-field→L1, novel/unmapped→L1 default-deny,
// fail→pass ratchet flagged, expired grace_deadline blocks L0.5, and the ARMED
// invariants (resolved-loop L1 write → status 2; non-loop / unknown-instance /
// missing-manifest → status 0 fail-open).

const assert = require('assert');
const path = require('path');
const gate = require('../pretool-loop-layer-gate.cjs');

const MANIFEST = gate.loadManifest();

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ok - ' + name);
}

console.log('pretool-loop-layer-gate.test.cjs');

// --- classification --------------------------------------------------------

test('content path classifies L0', () => {
  const c = gate.classifyPath(MANIFEST, {
    file_path: '_dev/loops/worldforge-sim/drafts/scene-42.md',
    content: 'draft scene text',
    instanceId: 'worldforge-sim'
  });
  assert.strictEqual(c.layer, 'L0', 'expected L0, got ' + JSON.stringify(c));
});

test('**/*guardrails* edit classifies L1 even inside an L0.5 grant', () => {
  // frameworks/** is {CLIENT_CODE}-ads L0.5 grant, but a guardrails file is physics-L1.
  const c = gate.classifyPath(MANIFEST, {
    file_path: 'frameworks/paid-media/ad-creative/guardrails.md',
    content: 'never do X',
    instanceId: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(c.layer, 'L1', 'expected L1, got ' + JSON.stringify(c));
  assert.strictEqual(c.reason, 'auto_L1_glob');
});

test('non-guardrails framework path IS the L0.5 grant', () => {
  const c = gate.classifyPath(MANIFEST, {
    file_path: 'frameworks/paid-media/ad-creative/manifest.json',
    content: '{}',
    instanceId: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(c.layer, 'L0.5', 'expected L0.5, got ' + JSON.stringify(c));
});

test('task-plan review_lane edit classifies L1', () => {
  const c = gate.classifyPath(MANIFEST, {
    file_path: '_dev/reports/analysis/task-plans/some-task__plan.json',
    content: '{ "review_lane": "codex-only", "scope_type": "system" }',
    instanceId: '{CLIENT_CODE}-ads'
  });
  assert.strictEqual(c.layer, 'L1', 'expected L1, got ' + JSON.stringify(c));
  assert.strictEqual(c.reason, 'task_plan_governed_field');
  assert.strictEqual(c.field, 'review_lane');
});

test('novel unmapped path defaults L1 (default-deny)', () => {
  const c = gate.classifyPath(MANIFEST, {
    file_path: 'some/brand/new/gate-tool.cjs',
    content: 'authorizes output',
    instanceId: 'worldforge-sim'
  });
  assert.strictEqual(c.layer, 'L1', 'expected L1, got ' + JSON.stringify(c));
  assert.strictEqual(c.reason, 'default_deny_unmapped');
});

test('worldforge-sim has NO L0.5 grant (frameworks path is not L0.5 for it)', () => {
  const c = gate.classifyPath(MANIFEST, {
    file_path: 'frameworks/paid-media/ad-creative/manifest.json',
    content: '{}',
    instanceId: 'worldforge-sim'
  });
  assert.notStrictEqual(c.layer, 'L0.5', 'sim must not get an L0.5 smuggling path');
  assert.strictEqual(c.layer, 'L1');
});

// --- fail→pass ratchet ------------------------------------------------------

test('fail->pass diff is flagged', () => {
  const r = gate.detectFailToPass(
    '{ "verdict": "fail", "note": "x" }',
    '{ "verdict": "pass", "note": "x" }'
  );
  assert.ok(r, 'expected a ratchet event');
  assert.strictEqual(r.from, 'fail');
  assert.strictEqual(r.to, 'pass');
});

test('unknown->pass diff is flagged', () => {
  const r = gate.detectFailToPass('status: unknown', 'status: pass');
  assert.ok(r, 'expected a ratchet event');
});

test('pass->pass (no down-ratchet) is NOT flagged', () => {
  const r = gate.detectFailToPass('{ "verdict": "pass" }', '{ "verdict": "pass" }');
  assert.strictEqual(r, null);
});

test('pass->fail (tightening) is NOT flagged', () => {
  const r = gate.detectFailToPass('{ "verdict": "pass" }', '{ "verdict": "fail" }');
  assert.strictEqual(r, null);
});

// --- grace deadline ---------------------------------------------------------

test('expired grace_deadline blocks L0.5 auto-apply', () => {
  const inst = MANIFEST.instances['{CLIENT_CODE}-ads'];
  assert.ok(inst.grace_deadline_iso, '{CLIENT_CODE}-ads must declare a grace deadline');
  const afterDeadline = new Date(Date.parse(inst.grace_deadline_iso) + 86400000);
  const decision = gate.evaluate({
    manifest: MANIFEST,
    instanceId: '{CLIENT_CODE}-ads',
    file_path: 'frameworks/paid-media/ad-creative/manifest.json',
    content: '{}',
    oldContent: '{}',
    now: afterDeadline
  });
  assert.strictEqual(decision.layer, 'L0.5');
  assert.strictEqual(decision.graceExpired, true);
  assert.strictEqual(decision.wouldBlock, true);
  assert.strictEqual(decision.blockReason, 'L0.5-grace-deadline-exceeded');
});

test('L0.5 within grace window does NOT block', () => {
  const inst = MANIFEST.instances['{CLIENT_CODE}-ads'];
  const beforeDeadline = new Date(Date.parse(inst.grace_deadline_iso) - 86400000);
  const decision = gate.evaluate({
    manifest: MANIFEST,
    instanceId: '{CLIENT_CODE}-ads',
    file_path: 'frameworks/paid-media/ad-creative/manifest.json',
    content: '{}',
    oldContent: '{}',
    now: beforeDeadline
  });
  assert.strictEqual(decision.layer, 'L0.5');
  assert.strictEqual(decision.wouldBlock, false);
});

// --- evaluate() gate wiring -------------------------------------------------

test('evaluate flags L1 as would-block', () => {
  const decision = gate.evaluate({
    manifest: MANIFEST,
    instanceId: '{CLIENT_CODE}-ads',
    file_path: 'frameworks/x/guardrails.md',
    content: 'rules',
    oldContent: ''
  });
  assert.strictEqual(decision.wouldBlock, true);
  assert.ok(String(decision.notice).indexOf('WOULD BLOCK') !== -1);
});

test('non-loop actor is a pure no-op (no instanceId)', () => {
  const decision = gate.evaluate({
    manifest: MANIFEST,
    instanceId: null,
    file_path: 'instructions/canonical/x.yaml',
    content: 'anything'
  });
  assert.strictEqual(decision.isLoop, false);
  assert.strictEqual(decision.wouldBlock, false);
});

// --- ARMED invariant --------------------------------------------------------

test('ARMED flag is ON', () => {
  assert.strictEqual(gate.ARMED, true);
});

test('main() BLOCKS (status 2) when a resolved loop instance writes an L1 path', () => {
  const result = gate.main({
    payload: { tool_input: { file_path: 'instructions/canonical/x.yaml', content: 'verdict: pass' } },
    instanceId: '{CLIENT_CODE}-ads',
    manifest: MANIFEST
  });
  assert.strictEqual(result.status, 2, 'armed hook must deny a definitive L1 loop write');
  assert.ok(result.decision.wouldBlock, 'classification computed as would-block');
  assert.ok(result.message, 'block message present');
});

test('main() no-op (status 0) when actor is not a loop-instance', () => {
  const result = gate.main({
    payload: { tool_input: { file_path: 'instructions/canonical/x.yaml', content: 'x' } },
    instanceId: null,
    manifest: MANIFEST
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.isLoop, false);
});

test('main() fail-open (status 0) when the loop instance is UNKNOWN', () => {
  const result = gate.main({
    payload: { tool_input: { file_path: 'instructions/canonical/x.yaml', content: 'verdict: pass' } },
    instanceId: 'no-such-instance',
    manifest: MANIFEST
  });
  assert.strictEqual(result.status, 0, 'unknown instance must never block');
  assert.strictEqual(result.decision.wouldBlock, false);
  assert.strictEqual(result.decision.unknownInstance, true);
});

test('main() fail-open (status 0) when the manifest is missing/unreadable', () => {
  const result = gate.main({
    payload: { tool_input: { file_path: 'instructions/canonical/x.yaml', content: 'verdict: pass' } },
    instanceId: '{CLIENT_CODE}-ads',
    manifestPath: '/nonexistent/does-not-exist-manifest.json'
  });
  assert.strictEqual(result.status, 0, 'missing manifest must fail-open');
  assert.strictEqual(result.manifest_error, true);
});

// --- glob engine spot-check -------------------------------------------------

test('glob engine: ** and **/ and * behave', () => {
  assert.ok(gate.matchGlob('frameworks/**', 'frameworks/a/b.json'));
  assert.ok(gate.matchGlob('**/*guardrails*', 'frameworks/a/guardrails.md'));
  assert.ok(gate.matchGlob('**/*guardrails*', 'guardrails.md'));
  assert.ok(!gate.matchGlob('*.json', 'a/b.json'));
  assert.ok(gate.matchGlob('**/*.frozen.json', 'x/y/z.frozen.json'));
});

console.log('\nAll ' + passed + ' tests passed.');
