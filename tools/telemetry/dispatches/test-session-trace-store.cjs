#!/usr/bin/env node
'use strict';

/**
 * test-session-trace-store.cjs — C1 coverage tests.
 *
 * Covers the per-session cascade-root store AND the SubagentStop writer
 * end-to-end (runs the real hook in an isolated CLAUDE_PROJECT_DIR with a piped
 * payload): proves an in-session Agent/Task completion emits a NON-unknown
 * worker span attributed to the session root (flat 2-level tree), and proves
 * the fail-open ambient/unknown fallback when no keyed root exists.
 *
 * Run: node tools/telemetry/dispatches/test-session-trace-store.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const store = require('./lib/session-trace-store.cjs');

const REPO = path.resolve(__dirname, '../../..');
const WRITER = path.join(REPO, '.claude/hooks/subagent-telemetry-writer.cjs');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); pass++; } catch (err) { fail++; console.error(`FAIL: ${label}\n  ${err.message}`); }
}

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sts-')); }

// 1. round-trip
check('writeSessionTraceRoot + readSessionTraceRoot round-trips', () => {
  const root = tmpRoot();
  const ok = store.writeSessionTraceRoot(root, { sessionId: 'sess-A', traceId: 'trace-A', rootSpanId: 'span-A', host: 'h' });
  assert.strictEqual(ok, true);
  const rec = store.readSessionTraceRoot(root, 'sess-A');
  assert.strictEqual(rec.trace_id, 'trace-A');
  assert.strictEqual(rec.root_span_id, 'span-A');
  assert.strictEqual(rec.session_id, 'sess-A');
});

// 2. rejects degenerate inputs (no write, returns false)
check('writeSessionTraceRoot rejects unknown/missing trace ids', () => {
  const root = tmpRoot();
  assert.strictEqual(store.writeSessionTraceRoot(root, { sessionId: 's', traceId: 'unknown', rootSpanId: 'x' }), false);
  assert.strictEqual(store.writeSessionTraceRoot(root, { sessionId: 's', traceId: 't', rootSpanId: '' }), false);
  assert.strictEqual(store.writeSessionTraceRoot(root, { sessionId: '', traceId: 't', rootSpanId: 'x' }), false);
});

// 3. read of absent/corrupt → null (fail-open)
check('readSessionTraceRoot returns null on absent and corrupt', () => {
  const root = tmpRoot();
  assert.strictEqual(store.readSessionTraceRoot(root, 'nope'), null);
  fs.mkdirSync(path.join(root, store.STORE_DIR_REL), { recursive: true });
  fs.writeFileSync(store.sessionTracePath(root, 'bad'), '{not json');
  assert.strictEqual(store.readSessionTraceRoot(root, 'bad'), null);
});

// 3b. read rejects a record whose session_id does not match the key, and a
// record with the wrong schema (codex MAJOR — never mis-attribute under a
// stale/corrupt root).
check('readSessionTraceRoot rejects session_id mismatch and wrong schema', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, store.STORE_DIR_REL), { recursive: true });
  // session_id mismatch: file keyed "A" but record claims "B"
  fs.writeFileSync(store.sessionTracePath(root, 'A'),
    JSON.stringify({ schema: 'SessionTraceRoot/1.0', session_id: 'B', trace_id: 't', root_span_id: 's' }));
  assert.strictEqual(store.readSessionTraceRoot(root, 'A'), null, 'mismatched session_id must fail open');
  // wrong schema
  fs.writeFileSync(store.sessionTracePath(root, 'C'),
    JSON.stringify({ schema: 'Other/9', session_id: 'C', trace_id: 't', root_span_id: 's' }));
  assert.strictEqual(store.readSessionTraceRoot(root, 'C'), null, 'wrong schema must fail open');
});

// 4. filename is sanitized (no path escape)
check('sanitizeSessionId neutralizes path-escape characters', () => {
  const s = store.sanitizeSessionId('../../etc/passwd');
  assert.ok(!s.includes('/'));
  assert.ok(!s.includes('..') || !s.includes('/'));
});

// 5. lazy cleanup removes only stale files
check('cleanupOldSessionTraces removes files older than maxAge only', () => {
  const root = tmpRoot();
  store.writeSessionTraceRoot(root, { sessionId: 'fresh', traceId: 't', rootSpanId: 's' });
  store.writeSessionTraceRoot(root, { sessionId: 'stale', traceId: 't', rootSpanId: 's' });
  const stalePath = store.sessionTracePath(root, 'stale');
  const old = new Date('2020-01-01').getTime();
  fs.utimesSync(stalePath, old / 1000, old / 1000);
  const removed = store.cleanupOldSessionTraces(root); // default 7d
  assert.strictEqual(removed, 1);
  assert.strictEqual(store.readSessionTraceRoot(root, 'stale'), null);
  assert.ok(store.readSessionTraceRoot(root, 'fresh'));
});

// Helper: run the real SubagentStop writer in an isolated project dir.
function runWriter(root, payload) {
  execFileSync('node', [WRITER], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_TOOL_INPUT: '', CLAUDE_TOOL_OUTPUT: '' }
  });
  const logFile = path.join(root, '_dev/reports/telemetry/dispatches.jsonl');
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// 6. WRITER end-to-end: keyed root present → attributed worker span (NON-unknown).
check('SubagentStop writer attributes worker span to session root (flat 2-level)', () => {
  const root = tmpRoot();
  store.writeSessionTraceRoot(root, { sessionId: 'live-sess', traceId: 'trace-live', rootSpanId: 'root-span-live', host: 'h' });
  const rows = runWriter(root, {
    session_id: 'live-sess',
    tool_input: { agent_name: 'general-purpose', prompt: 'do work' },
    tool_output: { usage: { duration_ms: 100, total_tokens: 50, tool_uses: 3 } }
  });
  assert.strictEqual(rows.length, 1);
  const span = rows[0];
  assert.strictEqual(span.trace_id, 'trace-live', 'trace_id must be the session root, not unknown');
  assert.notStrictEqual(span.trace_id, 'unknown');
  assert.strictEqual(span.parent_span_id, 'root-span-live', 'parent must be the session root span');
  assert.strictEqual(span.layer_depth, 1);
  assert.strictEqual(span.session_id, 'live-sess');
  assert.strictEqual(span.actor_role, 'worker');
  assert.strictEqual(span.subagent_type, 'general-purpose');
  assert.ok(span.span_id && span.span_id !== 'root-span-live', 'worker gets its own fresh span_id');
});

// 7. WRITER fail-open: NO keyed root → ambient/unknown fallback, still writes a row.
check('SubagentStop writer falls back to unknown when no keyed root (fail-open)', () => {
  const root = tmpRoot();
  const rows = runWriter(root, {
    session_id: 'orphan-sess',
    tool_input: { agent_name: 'explore' },
    tool_output: { usage: { tool_uses: 1 } }
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].trace_id, 'unknown', 'no keyed root → ambient unknown, never throws');
});

// 8. assemble-tree: an attributed root+worker pair forms a correct parent→child tree.
check('attributed spans assemble into a correct parent→child tree', () => {
  const { assembleTrace } = require('./lib/assemble-tree.cjs');
  const rootSpan = { trace_id: 'T', span_id: 'R', parent_span_id: null, layer_depth: 0, subagent_type: 'cascade-root' };
  const worker = { trace_id: 'T', span_id: 'W', parent_span_id: 'R', layer_depth: 1, subagent_type: 'general-purpose' };
  const tree = assembleTrace([rootSpan, worker], 'T');
  assert.ok(tree, 'tree assembled');
  const json = JSON.stringify(tree);
  assert.ok(json.includes('"W"') && json.includes('"R"'), 'both spans present in tree');
});

console.log(`\nsession-trace-store + writer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
