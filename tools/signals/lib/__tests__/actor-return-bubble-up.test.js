'use strict';

// S2 tests: the worker-return contract now mechanically requires parent_impact
// + a taxonomy bubble_up_gate, and validateActorReturn enforces it.

const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../recursive-actor-work-order.js');

const ok = {
  status: 'done',
  evidence_locations: ['_dev/reports/analysis/x.md'],
  next_command: '/debrief-run x',
  parent_impact: 'Parent can close the slice; no residual blocker.',
  bubble_up_gate: 'none',
};

test('contract requires parent_impact + bubble_up_gate', () => {
  assert.ok(m.DEFAULT_RETURN_CONTRACT.required_fields.includes('parent_impact'));
  assert.ok(m.DEFAULT_RETURN_CONTRACT.required_fields.includes('bubble_up_gate'));
});

test('valid local-resolve return passes and does not bubble', () => {
  const r = m.validateActorReturn(ok);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.bubbles_up, false);
});

test('valid bubble-up return passes and bubbles', () => {
  const r = m.validateActorReturn({ ...ok, bubble_up_gate: 'credential_access' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.bubbles_up, true);
});

test('missing parent_impact fails', () => {
  const { parent_impact, ...rest } = ok;
  assert.strictEqual(m.validateActorReturn(rest).valid, false);
});

test('missing bubble_up_gate fails', () => {
  const { bubble_up_gate, ...rest } = ok;
  assert.strictEqual(m.validateActorReturn(rest).valid, false);
});

test('non-taxonomy gate fails (cannot invent a gate to bubble up)', () => {
  assert.strictEqual(m.validateActorReturn({ ...ok, bubble_up_gate: 'made_up_gate' }).valid, false);
});

test('non-object return fails closed', () => {
  assert.strictEqual(m.validateActorReturn(null).valid, false);
  assert.strictEqual(m.validateActorReturn([]).valid, false);
});
