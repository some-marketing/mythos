'use strict';

/**
 * cascade-span.test.cjs — convergence proof for the canonical CascadeSpan/1.0.
 *
 * Proves the enforcement homes converge on ONE span shape (acceptance a + the
 * schema-bifurcation tripwire). Run: node --test tools/kernel/cascade-span/
 *
 * T1  a Claude-hook-origin event produces a span that VALIDATES.
 * T2  a Tool-Broker-origin action produces a span that VALIDATES.
 * T3  the two spans share ONE structural shape (identical key tree, ignoring
 *     the enforcement_home value) — the homes converge on one contract.
 * T4  lineage fields are compatible: both carry span_id/parent/trace and a
 *     populated node{actor,harness,model_family} + scope lineage.
 * T5  (negative) a malformed span FAILS validation.
 * T6  the tombstone path (crashed brokered sub-mind) still validates and
 *     carries lineage — the concept's "lineage-carrying tombstone" rule.
 * T7  a session-close-origin record validates and lands on the same shape.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  makeSpan,
  validateSpan,
  fromHookEvent,
  fromSessionClose,
  fromBrokerAction
} = require('../cascade-span.js');

// Sorted structural key-tree (keys only, values ignored). Two spans with the
// same key-tree have the same SHAPE — the convergence property under test.
function shapeOf(obj) {
  if (Array.isArray(obj)) return 'array';
  if (obj && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .map((k) => `${k}:${shapeOf(obj[k])}`)
      .join('|');
  }
  return 'scalar';
}

const hookEvent = {
  span_id: 'hook-span-0001',
  parent_span_id: 'root-span-abcd',
  session_id: 'sess-claude-777',
  actor_role: 'worker',
  model_family: 'claude',
  scope_identity: '{CLIENT_CODE}-crm-lead-recon',
  step_id: 'plan-step-3',
  matcher: 'Write',
  tool_name: 'Write',
  event: 'boundary-check',
  permissionDecision: 'allow',
  timestamp: '2026-07-07T10:00:00.000Z',
  ended_at: '2026-07-07T10:00:00.250Z',
  artifacts: ['_dev/reports/lifecycle/claude-hook-events.jsonl']
};

const brokerAction = {
  span_id: 'broker-span-0001',
  parent_span_id: 'root-span-abcd',
  correlation_id: 'trace-shared-42',
  adapter_role: 'broker-adapter',
  model_family: 'gemini',
  scope_identity: '{CLIENT_CODE}-crm-lead-recon',
  work_unit: 'plan-step-3',
  lineage_root: 'sess-claude-777',
  tool: 'apply_patch',
  summary: 'scoped write to crm-recon.js',
  proposed_action: 'apply_patch: scoped write to crm-recon.js',
  permission_phase: 3,
  decision: 'allow',
  started_at: '2026-07-07T10:05:00.000Z',
  ended_at: '2026-07-07T10:05:01.900Z',
  artifacts: ['_dev/reports/telemetry/dispatches.jsonl']
};

const hookSpan = fromHookEvent(hookEvent);
const brokerSpan = fromBrokerAction(brokerAction);

test('T1 hook-origin span validates against schema', () => {
  const r = validateSpan(hookSpan);
  assert.ok(r.ok, `hook span invalid: ${r.errors.join('; ')}`);
});

test('T2 broker-origin span validates against schema', () => {
  const r = validateSpan(brokerSpan);
  assert.ok(r.ok, `broker span invalid: ${r.errors.join('; ')}`);
});

test('T3 both homes converge on ONE structural shape', () => {
  assert.strictEqual(shapeOf(hookSpan), shapeOf(brokerSpan));
});

test('T4 lineage fields are populated and compatible across homes', () => {
  for (const [label, span] of [['hook', hookSpan], ['broker', brokerSpan]]) {
    assert.ok(span.span_id, `${label}: span_id missing`);
    assert.ok('parent_span_id' in span, `${label}: parent_span_id missing`);
    assert.ok('trace_id' in span, `${label}: trace_id missing`);
    assert.ok(span.node.actor && span.node.harness, `${label}: node identity incomplete`);
    assert.ok('model_family' in span.node, `${label}: node.model_family missing`);
    assert.ok('scope_identity' in span.scope, `${label}: scope lineage missing`);
  }
  assert.strictEqual(hookSpan.parent_span_id, brokerSpan.parent_span_id, 'parents differ');
  assert.strictEqual(hookSpan.scope.scope_identity, brokerSpan.scope.scope_identity, 'scope differs');
  assert.strictEqual(hookSpan.scope.work_unit, brokerSpan.scope.work_unit, 'work_unit differs');
  assert.strictEqual(hookSpan.enforcement_home, 'claude-hook');
  assert.strictEqual(brokerSpan.enforcement_home, 'tool-broker');
  assert.notStrictEqual(hookSpan.enforcement_home, brokerSpan.enforcement_home);
});

test('T5 (negative) a malformed span fails validation', () => {
  const bad = makeSpan({
    span_id: 'bad-1',
    node: { actor: 'worker', harness: 'claude-code-cli', model_family: 'claude' },
    scope: { scope_identity: 's', work_unit: 'w' },
    action: { proposed: 'x', classified_layer: 'NOT-A-LAYER', verdict: 'maybe' },
    enforcement_home: 'somewhere-else',
    timestamps: { started_at: '2026-07-07T10:00:00.000Z' },
    status: 'fine?'
  });
  const r = validateSpan(bad);
  assert.ok(!r.ok, 'malformed span unexpectedly passed validation');
  assert.ok(r.errors.length > 0, 'no errors reported for malformed span');
});

test('T6 crashed brokered sub-mind emits a valid lineage-carrying tombstone', () => {
  const tomb = fromBrokerAction({ ...brokerAction, decision: 'allow', crashed: true });
  const r = validateSpan(tomb);
  assert.ok(r.ok, `tombstone invalid: ${r.errors.join('; ')}`);
  assert.strictEqual(tomb.status, 'tombstone', 'status not tombstone');
  assert.ok(tomb.span_id && tomb.parent_span_id, 'tombstone lost lineage');
  assert.strictEqual(tomb.scope.lineage_root, 'sess-claude-777', 'tombstone lost lineage_root');
});

test('T7 session-close-origin record validates and lands on the same shape', () => {
  const closeSpan = fromSessionClose({
    span_id: 'close-span-0001',
    parent_span_id: 'root-span-abcd',
    trace_id: 'sess-claude-777',
    scope_identity: '{CLIENT_CODE}-crm-lead-recon',
    work_unit: 'plan-step-3',
    lineage_root: 'sess-claude-777',
    actor: 'coordinator',
    model_family: 'claude',
    session_id: 'sess-claude-777',
    reason: 'closed',
    crashed: false,
    started_at: '2026-07-07T09:00:00.000Z',
    ended_at: '2026-07-07T10:00:00.000Z'
  });
  const r = validateSpan(closeSpan);
  assert.ok(r.ok, `close span invalid: ${r.errors.join('; ')}`);
  assert.strictEqual(shapeOf(closeSpan), shapeOf(brokerSpan), 'close span shape diverges');
  assert.strictEqual(closeSpan.enforcement_home, 'claude-hook');
  assert.strictEqual(closeSpan.action.classified_layer, 'read-only');
});
