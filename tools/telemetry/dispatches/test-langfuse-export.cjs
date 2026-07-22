#!/usr/bin/env node
'use strict';

/**
 * test-langfuse-export.cjs — unit tests for the P3a Langfuse exporter (pure core).
 * No network: exercises buildIngestionEvents + resolveGenerationReparents against
 * an in-memory assembled tree. Run:
 *   node tools/telemetry/dispatches/test-langfuse-export.cjs
 */

const assert = require('assert');
const { assembleTrace } = require('./lib/assemble-tree.cjs');
const {
  buildIngestionEvents, resolveGenerationReparents, generationSpanId, flattenNodes, obsId, eventId,
  computePassPlan
} = require('./lib/langfuse-export.cjs');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; process.stdout.write(`ok   ${name}\n`); }
  catch (e) { process.stdout.write(`FAIL ${name}: ${e.message}\n`); process.exitCode = 1; }
}

const span = (o) => ({
  timestamp: o.ts, trace_id: o.trace, correlation_id: o.trace,
  span_id: o.id, parent_span_id: o.parent || null, layer_depth: o.depth || 0,
  actor_role: o.role || null, subagent_type: o.sub || 'unknown',
  routing_decision: o.rd || null, model: o.model || null,
  total_tokens: o.tok != null ? o.tok : null, tool_uses: o.tools != null ? o.tools : null,
  duration_ms: o.dur != null ? o.dur : null,
  work_class_inferred: o.tok > 0 ? 'inference' : (o.tools > 0 ? 'mechanical' : null),
  host: o.host || 'h1', session_id: 's1', scope_identity: o.scope || 'demo', status: o.status || 'ok'
});

// coordinator(root) -> worker(A) -> reviewer/codex(B)
const rows = [
  span({ ts: '2026-06-15T10:00:00Z', trace: 'T1', id: 'root', depth: 0, role: 'coordinator', model: 'claude-opus-4-8', rd: 'do-self', dur: 600000 }),
  span({ ts: '2026-06-15T10:01:00Z', trace: 'T1', id: 'A', parent: 'root', depth: 1, role: 'worker', sub: 'framework-executor', model: 'gemini-2.5-flash', rd: 'delegate-down', tok: 800, dur: 120000 }),
  span({ ts: '2026-06-15T10:03:00Z', trace: 'T1', id: 'B', parent: 'A', depth: 2, role: 'reviewer', sub: 'codex', model: 'codex', rd: 'delegate-down', tok: 1500, dur: 90000 })
];
const tree = assembleTrace(rows, 'T1');

t('builds 1 trace-create + N span-create events', () => {
  const { events, nodeCount } = buildIngestionEvents(tree, 'T1', { economics: { model_calls: 2, tokens: 2300, cost: 0.01 } });
  assert.strictEqual(nodeCount, 3);
  assert.strictEqual(events[0].type, 'trace-create');
  assert.strictEqual(events[0].body.id, 'T1');
  const spanEvents = events.filter((e) => e.type === 'span-create');
  assert.strictEqual(spanEvents.length, 3);
});

t('trace-create upserts the SAME id LiteLLM used (join key)', () => {
  const { events } = buildIngestionEvents(tree, 'T1', {});
  const trace = events.find((e) => e.type === 'trace-create');
  assert.strictEqual(trace.body.id, 'T1'); // === correlation_id === Langfuse trace id
  assert.ok(trace.body.tags.includes('mythos_orchestrator'));
});

t('span observation ids are deterministic + nest by parent', () => {
  const { events } = buildIngestionEvents(tree, 'T1', {});
  const byName = {};
  for (const e of events.filter((x) => x.type === 'span-create')) byName[e.body.name] = e.body;
  assert.strictEqual(byName['coordinator'].id, obsId({ span: { span_id: 'root' } }, 'T1'));
  // worker(A) parented under coordinator(root); reviewer(B) under worker(A)
  assert.strictEqual(byName['worker:framework-executor'].parentObservationId, obsId({ span: { span_id: 'root' } }, 'T1'));
  assert.strictEqual(byName['reviewer:codex'].parentObservationId, obsId({ span: { span_id: 'A' } }, 'T1'));
  // root has no parent
  assert.strictEqual(byName['coordinator'].parentObservationId, undefined);
});

t('idempotent: same tree -> identical event ids', () => {
  const a = buildIngestionEvents(tree, 'T1', {});
  const b = buildIngestionEvents(tree, 'T1', {});
  assert.deepStrictEqual(a.events.map((e) => e.id), b.events.map((e) => e.id));
});

t('re-parent via per-generation metadata.mythos_span_id', () => {
  const { obsIndex } = buildIngestionEvents(tree, 'T1', {});
  const nodes = flattenNodes(tree);
  const gens = [
    { id: 'gen1', traceId: 'T1', model: 'gemini-2.5-flash', startTime: '2026-06-15T10:01:30Z', parentObservationId: null, metadata: { mythos_span_id: 'A' } }
  ];
  const { updates, report } = resolveGenerationReparents(obsIndex, gens, nodes);
  assert.strictEqual(report.updated, 1);
  assert.strictEqual(updates[0].body.parentObservationId, obsId({ span: { span_id: 'A' } }, 'T1'));
  assert.strictEqual(report.byMechanism['metadata-span-id'], 1);
});

t('re-parent reads LiteLLM nested metadata (requester_metadata.trace_metadata)', () => {
  // The exact live shape: span id is buried, not top-level.
  assert.strictEqual(generationSpanId({ requester_metadata: { trace_metadata: { mythos_span_id: 'A' } } }), 'A');
  assert.strictEqual(generationSpanId({ trace_metadata: { mythos_span_id: 'B' } }), 'B');
  assert.strictEqual(generationSpanId({ mythos_span_id: 'C' }), 'C');
  assert.strictEqual(generationSpanId({ nothing: 1 }), null);

  const { obsIndex } = buildIngestionEvents(tree, 'T1', {});
  const nodes = flattenNodes(tree);
  const gens = [
    { id: 'genLive', traceId: 'T1', model: 'openrouter/google/gemini-2.5-flash', startTime: '2026-06-15T10:01:30Z', parentObservationId: null,
      metadata: { requester_metadata: { trace_metadata: { mythos_span_id: 'A' } } } }
  ];
  const { updates, report } = resolveGenerationReparents(obsIndex, gens, nodes);
  assert.strictEqual(report.updated, 1);
  assert.strictEqual(updates[0].body.parentObservationId, obsId({ span: { span_id: 'A' } }, 'T1'));
  assert.strictEqual(report.byMechanism['metadata-span-id'], 1);
});

t('re-parent via temporal+model containment (deepest match)', () => {
  const { obsIndex } = buildIngestionEvents(tree, 'T1', {});
  const nodes = flattenNodes(tree);
  // codex generation at 10:03:30 falls inside reviewer/codex window [10:03, +90s]
  const gens = [
    { id: 'genC', traceId: 'T1', model: 'codex', startTime: '2026-06-15T10:03:30Z', parentObservationId: null, metadata: {} }
  ];
  const { updates, report } = resolveGenerationReparents(obsIndex, gens, nodes);
  assert.strictEqual(report.updated, 1);
  assert.strictEqual(updates[0].body.parentObservationId, obsId({ span: { span_id: 'B' } }, 'T1'));
  assert.strictEqual(report.byMechanism['temporal-model'], 1);
});

t('unresolved generation is left at root, never force-nested', () => {
  // tree with multiple plausible callers + a generation that matches no window/meta
  const { obsIndex } = buildIngestionEvents(tree, 'T1', {});
  const nodes = flattenNodes(tree);
  const gens = [
    { id: 'genX', traceId: 'T1', model: 'mystery-model', startTime: '2026-06-15T23:59:00Z', parentObservationId: null, metadata: {} }
  ];
  const { updates, report } = resolveGenerationReparents(obsIndex, gens, nodes);
  // 2 leaf/inference callers (A inference, B inference+leaf) -> soleCaller is null -> unresolved
  assert.strictEqual(updates.length, 0);
  assert.strictEqual(report.unresolved, 1);
});

t('no-op when generation already correctly parented', () => {
  const { obsIndex } = buildIngestionEvents(tree, 'T1', {});
  const nodes = flattenNodes(tree);
  const already = obsId({ span: { span_id: 'A' } }, 'T1');
  const gens = [
    { id: 'gen1', traceId: 'T1', model: 'gemini-2.5-flash', startTime: '2026-06-15T10:01:30Z', parentObservationId: already, metadata: { mythos_span_id: 'A' } }
  ];
  const { updates, report } = resolveGenerationReparents(obsIndex, gens, nodes);
  assert.strictEqual(updates.length, 0);     // no churn
  assert.strictEqual(report.byMechanism['metadata-span-id'], 1); // still counted as resolved
});

t('eventId stable + content-sensitive', () => {
  const a = eventId('span-create', { id: 'x', name: 'n' });
  const b = eventId('span-create', { id: 'x', name: 'n' });
  const c = eventId('span-create', { id: 'x', name: 'CHANGED' });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

// ── C3: delayed idempotent later-pass planner ────────────────────────────────
t('computePassPlan: dry-run is always one no-sleep pass', () => {
  assert.deepStrictEqual(computePassPlan({ enable: false }), { passes: 1, settleMs: 0 });
  assert.deepStrictEqual(computePassPlan({ enable: false, passes: 5, settleMs: 30000 }), { passes: 1, settleMs: 0 });
});

t('computePassPlan: live defaults to 2 passes with a 20s settle (auto later-pass)', () => {
  assert.deepStrictEqual(computePassPlan({ enable: true }), { passes: 2, settleMs: 20000 });
});

t('computePassPlan: --single-pass forces one pass even when enabled', () => {
  assert.deepStrictEqual(computePassPlan({ enable: true, singlePass: true }), { passes: 1, settleMs: 0 });
});

t('computePassPlan: multi-pass with zero settle collapses to one pass (no point)', () => {
  assert.deepStrictEqual(computePassPlan({ enable: true, passes: 3, settleMs: 0 }), { passes: 1, settleMs: 0 });
});

t('computePassPlan: explicit passes + settle are honored; negative settle clamps to 0', () => {
  assert.deepStrictEqual(computePassPlan({ enable: true, passes: 3, settleMs: 5000 }), { passes: 3, settleMs: 5000 });
  assert.deepStrictEqual(computePassPlan({ enable: true, passes: 1, settleMs: -10 }), { passes: 1, settleMs: 0 });
});

process.stdout.write(`\n${pass} passed\n`);
