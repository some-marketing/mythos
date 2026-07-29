'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  classifyAmendmentDivergences,
  DIVERGENCE_TYPE_AUTHORITY_MAP,
} = require('../repair-vs-amend-classifier');

const guardHook = require('../../hooks/post-write-amend-authority-guard.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ---- classifyAmendmentDivergences: divergence-type -> authority mapping ----

test('gate_changed routes to repair (touches required_gates)', () => {
  const r = classifyAmendmentDivergences([{ id: 'D1', type: 'gate_changed' }]);
  assert.strictEqual(r.route_recommendation, 'repair');
  assert.strictEqual(r.authority_touching.length, 1);
  assert.strictEqual(r.authority_touching[0].field, 'bounded_plan.required_gates');
});

test('risk_changed, step_split, step_reordered, output_changed all route to repair', () => {
  for (const type of ['risk_changed', 'step_split', 'step_reordered', 'output_changed']) {
    const r = classifyAmendmentDivergences([{ id: 't', type }]);
    assert.strictEqual(r.route_recommendation, 'repair', `${type} should route to repair`);
  }
});

test('scope_exceeded routes to plan-task', () => {
  const r = classifyAmendmentDivergences([{ id: 'D9', type: 'scope_exceeded' }]);
  assert.strictEqual(r.route_recommendation, 'plan-task');
  assert.strictEqual(r.authority_touching[0].route, 'plan-task');
});

test('step_blocked and assumption_changed are overlay-only (amend)', () => {
  const r = classifyAmendmentDivergences([
    { id: 'a', type: 'step_blocked' },
    { id: 'b', type: 'assumption_changed' },
  ]);
  assert.strictEqual(r.route_recommendation, 'amend');
  assert.strictEqual(r.authority_touching.length, 0);
  assert.strictEqual(r.overlay_only.length, 2);
});

test('mixed set with one authority divergence routes to repair', () => {
  const r = classifyAmendmentDivergences([
    { id: 'a', type: 'step_blocked' },
    { id: 'b', type: 'gate_changed' },
  ]);
  assert.strictEqual(r.route_recommendation, 'repair');
  assert.strictEqual(r.authority_touching.length, 1);
  assert.strictEqual(r.overlay_only.length, 1);
});

test('scope_exceeded dominates a mixed authority set (plan-task wins)', () => {
  const r = classifyAmendmentDivergences([
    { id: 'b', type: 'gate_changed' },
    { id: 'c', type: 'scope_exceeded' },
  ]);
  assert.strictEqual(r.route_recommendation, 'plan-task');
});

test('empty / non-array divergences route to amend (no over-firing)', () => {
  assert.strictEqual(classifyAmendmentDivergences([]).route_recommendation, 'amend');
  assert.strictEqual(classifyAmendmentDivergences(null).route_recommendation, 'amend');
  assert.strictEqual(classifyAmendmentDivergences(undefined).route_recommendation, 'amend');
});

test('unknown divergence types are treated as overlay-only (advisory-silent)', () => {
  const r = classifyAmendmentDivergences([{ id: 'x', type: 'totally_made_up' }]);
  assert.strictEqual(r.route_recommendation, 'amend');
  assert.strictEqual(r.overlay_only.length, 1);
});

test('every documented PlanAmendment divergence type is mapped', () => {
  const documented = [
    'assumption_changed', 'step_blocked', 'step_split', 'step_reordered',
    'output_changed', 'gate_changed', 'risk_changed', 'scope_exceeded',
  ];
  for (const t of documented) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(DIVERGENCE_TYPE_AUTHORITY_MAP, t),
      `divergence type ${t} must be in DIVERGENCE_TYPE_AUTHORITY_MAP`
    );
  }
});

// ---- post-write hook: fires on authority amendment, silent on overlay ----

const FIXTURE_DIR = path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis', 'task-plans');

function writeFixture(name, obj) {
  const p = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  return p;
}
function cleanup(p) {
  for (const f of [p, p + '.advisory.json']) {
    try { fs.unlinkSync(f); } catch (_) { /* ignore */ }
  }
}

test('hook writes an advisory sidecar for an authority-touching amendment', () => {
  const name = '__amend-guard-test-authority__amendment__TESTZ.json';
  const p = writeFixture(name, { plan_id: 'amend-guard-test', divergences: [{ id: 'D1', type: 'gate_changed' }] });
  try {
    const res = guardHook.main({ tool_name: 'Write', tool_input: { file_path: p } });
    assert.strictEqual(res.route, 'repair');
    assert.ok(fs.existsSync(p + '.advisory.json'), 'advisory sidecar should exist');
    const sidecar = JSON.parse(fs.readFileSync(p + '.advisory.json', 'utf8'));
    assert.strictEqual(sidecar.exact_next_command, '/repair-plan amend-guard-test');
  } finally {
    cleanup(p);
  }
});

test('hook stays silent for an overlay-only amendment', () => {
  const name = '__amend-guard-test-overlay__amendment__TESTZ.json';
  const p = writeFixture(name, { plan_id: 'amend-guard-test', divergences: [{ id: 'a', type: 'step_blocked' }] });
  try {
    const res = guardHook.main({ tool_name: 'Write', tool_input: { file_path: p } });
    assert.strictEqual(res.route, 'amend');
    assert.ok(!fs.existsSync(p + '.advisory.json'), 'no advisory sidecar for overlay-only');
  } finally {
    cleanup(p);
  }
});

test('hook skips non-amendment paths', () => {
  const res = guardHook.main({ tool_name: 'Write', tool_input: { file_path: '_dev/reports/analysis/task-plans/foo__plan.json' } });
  assert.strictEqual(res.skipped, true);
});
