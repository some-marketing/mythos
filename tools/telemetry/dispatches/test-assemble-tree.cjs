#!/usr/bin/env node
'use strict';

/**
 * test-assemble-tree.cjs — unit tests for the P2 store/query layer.
 * Pure in-memory + tmp-file fixtures; no dependency on the live store.
 * Run: node tools/telemetry/dispatches/test-assemble-tree.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const {
  loadAllSpans, listTraces, latestTraceId, assembleTrace, sumTree, queryTrace
} = require('./lib/assemble-tree.cjs');
const { appendLineLocked } = require('./lib/append-lock.cjs');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; process.stdout.write(`ok   ${name}\n`); }
  catch (e) { process.stdout.write(`FAIL ${name}: ${e.message}\n`); process.exitCode = 1; }
}

// ---- fixtures: a 3-node cascade spanning a rotation boundary ----------------
const span = (o) => ({
  timestamp: o.ts, trace_id: o.trace, correlation_id: o.trace,
  span_id: o.id, parent_span_id: o.parent || null, layer_depth: o.depth || 0,
  actor_role: o.role || null, subagent_type: o.sub || 'unknown',
  routing_decision: o.rd || null, model: o.model || null,
  total_tokens: o.tok != null ? o.tok : null, tool_uses: o.tools != null ? o.tools : null,
  work_class_inferred: o.tok > 0 ? 'inference' : (o.tools > 0 ? 'mechanical' : null),
  host: o.host || 'h1', session_id: o.session || 's1', status: o.status || 'ok'
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-test-'));
const telDir = path.join(tmp, '_dev/reports/telemetry');
fs.mkdirSync(telDir, { recursive: true });

// Root + child A in a ROTATED file; child B (of A) in the LIVE file.
const rotated = [
  span({ ts: '2026-06-15T10:00:00Z', trace: 'T1', id: 'root', depth: 0, role: 'coordinator', model: 'claude-opus-4-8', rd: 'do-self' }),
  span({ ts: '2026-06-15T10:01:00Z', trace: 'T1', id: 'A', parent: 'root', depth: 1, role: 'reviewer', sub: 'codex', model: 'codex', rd: 'delegate-down', tok: 1200 })
];
const live = [
  span({ ts: '2026-06-15T10:02:00Z', trace: 'T1', id: 'B', parent: 'A', depth: 2, role: 'worker', sub: 'haiku', model: 'claude-haiku-4-5', rd: 'do-self', tools: 3, tok: 0 }),
  // a second, newer trace (single root) to test latest-resolution
  span({ ts: '2026-06-15T11:00:00Z', trace: 'T2', id: 'r2', depth: 0, role: 'coordinator', model: 'fable' }),
  // a coverage-gap row that must be excluded from trace listing
  { timestamp: '2026-06-15T09:00:00Z', trace_id: 'unknown', span_id: null, parent_span_id: null, layer_depth: 0 }
];
fs.writeFileSync(path.join(telDir, 'dispatches.2026-06-15.jsonl'), rotated.map((s) => JSON.stringify(s)).join('\n') + '\n');
fs.writeFileSync(path.join(telDir, 'dispatches.jsonl'), live.map((s) => JSON.stringify(s)).join('\n') + '\n');

t('loadAllSpans merges live + rotated', () => {
  const { spans, files } = loadAllSpans(tmp);
  assert.strictEqual(spans.length, 5);
  assert.strictEqual(files.length, 2);
});

t('listTraces excludes the unknown coverage gap', () => {
  const { spans } = loadAllSpans(tmp);
  const traces = listTraces(spans);
  assert.strictEqual(traces.length, 2);
  assert.ok(!traces.find((x) => x.trace_id === 'unknown'));
});

t('latestTraceId resolves to newest by timestamp', () => {
  const { spans } = loadAllSpans(tmp);
  assert.strictEqual(latestTraceId(spans), 'T2');
});

t('rotation-without-orphaning: T1 assembles across both files', () => {
  const { spans } = loadAllSpans(tmp);
  const tree = assembleTrace(spans, 'T1');
  assert.strictEqual(tree.roots.length, 1, 'one true root');
  assert.strictEqual(tree.orphans.length, 0, 'no orphans across the rotation');
  const root = tree.roots[0];
  assert.strictEqual(root.children.length, 1);          // root -> A
  assert.strictEqual(root.children[0].children.length, 1); // A -> B
  assert.strictEqual(tree.stats.max_depth, 2);
});

t('orphan surfaced when parent missing', () => {
  const orphanSpans = [
    span({ ts: '2026-06-15T10:00:00Z', trace: 'T3', id: 'x', parent: 'ghost', depth: 1, role: 'worker' })
  ];
  const tree = assembleTrace(orphanSpans, 'T3');
  assert.strictEqual(tree.orphans.length, 1);
  assert.strictEqual(tree.roots.length, 1); // orphan re-parented to root so it still renders
  assert.strictEqual(tree.roots[0]._orphan, true);
});

t('sumTree rolls economics over the subtree', () => {
  const { spans } = loadAllSpans(tmp);
  const tree = assembleTrace(spans, 'T1');
  const roll = sumTree(tree.roots[0]);
  assert.strictEqual(roll.tokens, 1200);
  assert.strictEqual(roll.model_calls, 1);   // only A metered tokens
  assert.strictEqual(roll.tool_uses, 3);     // B's tools
  assert.strictEqual(roll.node_count, 3);
});

t('queryTrace latest returns assembled payload', () => {
  const res = queryTrace(tmp, 'latest', { skipCorrelates: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.trace_id, 'T2');
});

t('queryTrace unknown trace returns not-found', () => {
  const res = queryTrace(tmp, 'does-not-exist', { skipCorrelates: true });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'trace-not-found');
});

t('appendLineLocked appends and reports locked', () => {
  const f = path.join(tmp, 'lock-test.jsonl');
  const r1 = appendLineLocked(f, 'line1\n');
  const r2 = appendLineLocked(f, 'line2\n');
  assert.strictEqual(r1.locked, true);
  assert.strictEqual(r2.locked, true);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'line1\nline2\n');
  assert.ok(!fs.existsSync(f + '.lock'), 'lock released');
});

t('depth-0 node with a present parent still roots (documented contract)', () => {
  const rows = [
    span({ ts: '2026-06-15T10:00:00Z', trace: 'T4', id: 'p', depth: 0, role: 'coordinator' }),
    // malformed/repaired row: depth 0 but carries a parent — must stay a root.
    span({ ts: '2026-06-15T10:01:00Z', trace: 'T4', id: 'q', parent: 'p', depth: 0, role: 'coordinator' })
  ];
  const tree = assembleTrace(rows, 'T4');
  assert.strictEqual(tree.roots.length, 2, 'both depth-0 nodes are roots');
  assert.strictEqual(tree.roots[0].children.length, 0, 'q not attached under p');
});

t('newest-wins de-dup on duplicate span_id', () => {
  const rows = [
    span({ ts: '2026-06-15T10:00:00Z', trace: 'T5', id: 'dup', depth: 0, role: 'worker', status: 'ok' }),
    span({ ts: '2026-06-15T10:05:00Z', trace: 'T5', id: 'dup', depth: 0, role: 'worker', status: 'corrected' })
  ];
  const tree = assembleTrace(rows, 'T5');
  assert.strictEqual(tree.stats.node_count, 1, 'duplicate collapsed to one node');
  assert.strictEqual(tree.roots[0].span.status, 'corrected', 'newer row wins');
});

t('append-lock fails open when the lock cannot be acquired', () => {
  const f = path.join(tmp, 'contended.jsonl');
  // Pre-create the lockfile so O_EXCL acquisition always fails; with a tiny
  // deadline the writer must give up the lock yet STILL append (fail-open).
  const lock = f + '.lock';
  fs.writeFileSync(lock, '99999');
  const future = Date.now() + 60 * 1000;
  // Keep mtime fresh so breakIfStale does not clear it within the deadline.
  fs.utimesSync(lock, future / 1000, future / 1000);
  const r = appendLineLocked(f, 'still-written\n', { deadlineMs: 20, retryMs: 2 });
  assert.strictEqual(r.locked, false, 'could not take the lock');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'still-written\n', 'appended anyway');
  fs.unlinkSync(lock);
});

t('loadCorrelates joins a signal by lineage_root_session_id == trace_id', () => {
  const { loadCorrelates } = require('./lib/assemble-tree.cjs');
  const sigDir = path.join(tmp, '_dev/reports/signals');
  fs.mkdirSync(sigDir, { recursive: true });
  fs.writeFileSync(path.join(sigDir, 'ready-for-review__join.json'),
    JSON.stringify({ signal_type: 'ready-for-review', lineage_root_session_id: 'T1', scope: 's' }));
  fs.writeFileSync(path.join(sigDir, 'escalation__x.json'),
    JSON.stringify({ signal_type: 'escalation', correlation_id: 'T1' }));
  const c = loadCorrelates(tmp, 'T1', { scanDebriefs: false });
  assert.strictEqual(c.signals.length, 1, 'one signal joined');
  assert.strictEqual(c.escalations.length, 1, 'one escalation joined');
});

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(`\n${pass} passed\n`);
