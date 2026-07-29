'use strict';

/**
 * span-parity.test.cjs — acceptance (b) for sovereign-core-harness P0.
 *
 * Proves ONE Claude-hook close-path span and ONE broker-path span have their
 * lineage shape and join anchors match. Both are REAL emissions from the
 * real call-sites (the active-session-registry close path and the broker-probe),
 * driven under one shared cascade trace context and persisted to one durable
 * sink; the test reads the persisted rows back and diffs them.
 *
 * Run: node --test tools/kernel/cascade-span/__tests__/span-parity.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('../../../sessions/lib/active-session-registry');
const { runProbe } = require('../broker-probe.cjs');

// The lineage fields the parity contract binds across homes: span-tree identity
// (span_id/parent/trace) + scope lineage. enforcement_home is intentionally NOT
// here — it is the one field allowed to differ.
function lineageFields(span) {
  return {
    span_id: span.span_id,
    parent_span_id: span.parent_span_id,
    trace_id: span.trace_id,
    'scope.scope_identity': span.scope.scope_identity,
    'scope.work_unit': span.scope.work_unit,
    'scope.lineage_root': span.scope.lineage_root
  };
}

// A value's parity "type": its JS typeof, with null called out distinctly so a
// string vs null mismatch is caught (both are valid per-field, but the two homes
// must agree field-by-field on which they emitted).
function valueType(v) {
  return v === null ? 'null' : typeof v;
}

function typeShape(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = valueType(fields[k]);
  return out;
}

function readSpans(logPath) {
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('close-path span and broker-path span lineage shape and join anchors match', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'span-parity-'));
  const sink = path.join(dataDir, 'cascade-spans.jsonl');

  // One shared cascade: both homes read this trace context and must converge on
  // identical trace_id / parent_span_id / scope lineage.
  const savedEnv = { ...process.env };
  process.env.MYTHOS_TRACE_ID = 'trace-parity-0001';
  process.env.MYTHOS_SPAN_ID = 'parent-span-parity-0001';
  process.env.MYTHOS_WORKSTREAM_SCOPE = 'sovereign-core-harness';
  process.env.MYTHOS_STEP_ID = 'P0-step-b';
  process.env.MYTHOS_LINEAGE_ROOT_SESSION_ID = 'lineage-root-parity-0001';
  process.env.MYTHOS_CASCADE_SPAN_LOG = sink;

  registry.setDataDir(dataDir);

  t.after(() => {
    registry.resetDataDir();
    process.env = savedEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // Home A — the REAL Claude-hook close path.
  registry.registerSession({ sessionId: 'sess-parity', now: '2026-07-09T12:00:00.000Z' });
  registry.closeSession('sess-parity', { now: '2026-07-09T12:05:00.000Z' });

  // Home B — the REAL broker-shaped read-only probe (persists to the same sink).
  runProbe({ now: '2026-07-09T12:06:00.000Z', projectRoot: dataDir });

  const spans = readSpans(sink);
  const closeSpan = spans.find((s) => s.enforcement_home === 'claude-hook');
  const brokerSpan = spans.find((s) => s.enforcement_home === 'tool-broker');

  assert.ok(closeSpan, 'no claude-hook close span was persisted');
  assert.ok(brokerSpan, 'no tool-broker span was persisted');

  const closeLineage = lineageFields(closeSpan);
  const brokerLineage = lineageFields(brokerSpan);

  // Same KEY SET across homes.
  assert.deepEqual(
    Object.keys(closeLineage).sort(),
    Object.keys(brokerLineage).sort(),
    'lineage key sets diverge across homes'
  );

  // Same VALUE TYPES field-by-field.
  assert.deepEqual(
    typeShape(closeLineage),
    typeShape(brokerLineage),
    'lineage value types diverge across homes'
  );

  // Shared-cascade SEMANTICS: the joinable lineage anchors are equal (only
  // span_id is expected to differ — two distinct spans in one cascade).
  assert.strictEqual(closeLineage.parent_span_id, brokerLineage.parent_span_id, 'parent_span_id differs');
  assert.strictEqual(closeLineage.trace_id, brokerLineage.trace_id, 'trace_id differs');
  assert.strictEqual(closeLineage['scope.scope_identity'], brokerLineage['scope.scope_identity'], 'scope_identity differs');
  assert.strictEqual(closeLineage['scope.work_unit'], brokerLineage['scope.work_unit'], 'work_unit differs');
  assert.strictEqual(closeLineage['scope.lineage_root'], brokerLineage['scope.lineage_root'], 'lineage_root differs');
  assert.strictEqual(closeLineage.trace_id, 'trace-parity-0001');
  assert.notStrictEqual(closeSpan.span_id, brokerSpan.span_id, 'the two spans must have distinct span_ids');

  // The ONLY intended structural difference is the enforcement_home value.
  assert.strictEqual(closeSpan.enforcement_home, 'claude-hook');
  assert.strictEqual(brokerSpan.enforcement_home, 'tool-broker');
});
