// tools/sessions/lib/__tests__/active-session-registry-cascade-span.test.js
'use strict';

/**
 * CascadeSpan/1.0 emission on the session close path (sovereign-core-harness P0
 * step 2 + acceptance c). Proves:
 *   - a normal closeSession emits a valid span with status 'ok' and lineage;
 *   - a simulated headless crash / TTL expiry (sweepExpired) writes a lineage-
 *     carrying TOMBSTONE span (status 'tombstone') — no silent loss;
 *   - emission is fail-open: an unwritable span sink never throws into, or
 *     blocks, close/sweep, and the close/sweep result is unaffected.
 *
 * Run: node --test tools/sessions/lib/__tests__/active-session-registry-cascade-span.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const registry = require('../active-session-registry');
const { validateSpan } = require('../../../kernel/cascade-span/cascade-span.js');

function setupRegistry(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-span-'));
  const sink = path.join(dataDir, 'cascade-spans.jsonl');
  const savedLog = process.env.MYTHOS_CASCADE_SPAN_LOG;
  const savedTrace = {
    trace: process.env.MYTHOS_TRACE_ID,
    span: process.env.MYTHOS_SPAN_ID,
    scope: process.env.MYTHOS_WORKSTREAM_SCOPE,
    lineage: process.env.MYTHOS_LINEAGE_ROOT_SESSION_ID,
    action: process.env.MYTHOS_DEBRIEF_ACTION_ID,
    logicalSession: process.env.MYTHOS_DEBRIEF_LOGICAL_SESSION_ID,
    step: process.env.MYTHOS_STEP_ID,
    depth: process.env.MYTHOS_LAYER_DEPTH
  };
  process.env.MYTHOS_CASCADE_SPAN_LOG = sink;
  process.env.MYTHOS_TRACE_ID = 'trace-registry-0001';
  process.env.MYTHOS_SPAN_ID = 'parent-span-registry-0001';
  process.env.MYTHOS_WORKSTREAM_SCOPE = 'sovereign-core-harness';
  process.env.MYTHOS_LINEAGE_ROOT_SESSION_ID = 'lineage-root-registry-0001';
  process.env.MYTHOS_DEBRIEF_ACTION_ID = 'registry-loss-action-0001';
  process.env.MYTHOS_DEBRIEF_LOGICAL_SESSION_ID = 'registry-loss-logical-session-0001';
  process.env.MYTHOS_STEP_ID = 'P4-S2-native-span-parity';
  process.env.MYTHOS_LAYER_DEPTH = '2';
  registry.setDataDir(dataDir);
  t.after(() => {
    registry.resetDataDir();
    if (savedLog === undefined) delete process.env.MYTHOS_CASCADE_SPAN_LOG;
    else process.env.MYTHOS_CASCADE_SPAN_LOG = savedLog;
    for (const [envKey, saved] of [
      ['MYTHOS_TRACE_ID', savedTrace.trace],
      ['MYTHOS_SPAN_ID', savedTrace.span],
      ['MYTHOS_WORKSTREAM_SCOPE', savedTrace.scope],
      ['MYTHOS_LINEAGE_ROOT_SESSION_ID', savedTrace.lineage],
      ['MYTHOS_DEBRIEF_ACTION_ID', savedTrace.action],
      ['MYTHOS_DEBRIEF_LOGICAL_SESSION_ID', savedTrace.logicalSession],
      ['MYTHOS_STEP_ID', savedTrace.step],
      ['MYTHOS_LAYER_DEPTH', savedTrace.depth]
    ]) {
      if (saved === undefined) delete process.env[envKey];
      else process.env[envKey] = saved;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, sink };
}

function readSpans(sink) {
  if (!fs.existsSync(sink)) return [];
  return fs.readFileSync(sink, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('closeSession emits a valid CascadeSpan with status ok and lineage', (t) => {
  const { sink } = setupRegistry(t);
  registry.registerSession({ sessionId: 'sess-a', actorType: 'claude-opus-4-8', now: '2026-07-09T12:00:00.000Z' });
  const closed = registry.closeSession('sess-a', { now: '2026-07-09T12:05:00.000Z' });

  assert.equal(closed.status, 'closed'); // close path itself is unchanged

  const spans = readSpans(sink);
  assert.equal(spans.length, 1, 'exactly one span emitted for one close');
  const span = spans[0];
  const v = validateSpan(span);
  assert.ok(v.ok, `close span invalid: ${v.errors.join('; ')}`);
  assert.equal(span.enforcement_home, 'claude-hook');
  assert.equal(span.status, 'ok');
  assert.equal(span.action.classified_layer, 'read-only');
  assert.equal(span.trace_id, 'trace-registry-0001');
  assert.equal(span.parent_span_id, 'parent-span-registry-0001');
  assert.equal(span.scope.scope_identity, 'sovereign-core-harness');
  assert.equal(span.scope.lineage_root, 'lineage-root-registry-0001');
  assert.equal(span.node.model_family, 'claude');
  assert.ok(span.span_id, 'span_id missing');
});

test('sweepExpired writes a lineage-carrying tombstone for a TTL-expired (crashed/headless) session', (t) => {
  const { dataDir, sink } = setupRegistry(t);
  // A headless session that stopped heartbeating an hour ago — the crash/TTL case.
  registry.registerSession({ sessionId: 'sess-crashed', actorType: 'claude-opus-4-8', now: '2026-07-09T11:00:00.000Z' });

  const result = registry.sweepExpired({
    now: '2026-07-09T12:00:00.000Z',
    archive: true,
    maxAgeMs: 10 * 60 * 1000
  });
  assert.deepEqual(result.swept.map((s) => s.session_id), ['sess-crashed']);

  const spans = readSpans(sink);
  assert.equal(spans.length, 1, 'exactly one tombstone span emitted for one swept session');
  const tomb = spans[0];
  const v = validateSpan(tomb);
  assert.ok(v.ok, `tombstone invalid: ${v.errors.join('; ')}`);
  assert.equal(tomb.status, 'tombstone', 'swept session must be a tombstone');
  assert.equal(tomb.enforcement_home, 'claude-hook');
  assert.equal(tomb.action.proposed, 'session-sweep: ttl-expired');
  // Lineage is carried — the crash is not a silent loss.
  assert.ok(tomb.span_id, 'tombstone lost span_id');
  assert.equal(tomb.trace_id, 'trace-registry-0001');
  assert.equal(tomb.scope.lineage_root, 'lineage-root-registry-0001');
  const observation = JSON.parse(fs.readFileSync(path.join(dataDir, 'debrief-close-span-observations.jsonl'), 'utf8').trim());
  assert.equal(observation.home, 'claude-hook');
  assert.equal(observation.projection.outcome, 'tombstone');
  assert.equal(observation.projection.action_id, 'registry-loss-action-0001');
  assert.equal(observation.projection.logical_session_id, 'registry-loss-logical-session-0001');
});

test('emission is fail-open: an unwritable span sink never breaks close', (t) => {
  const { dataDir } = setupRegistry(t);
  // Point the sink at a path whose parent is a FILE, so mkdir -p fails.
  const blocker = path.join(dataDir, 'blocker-file');
  fs.writeFileSync(blocker, 'x');
  process.env.MYTHOS_CASCADE_SPAN_LOG = path.join(blocker, 'cannot', 'cascade-spans.jsonl');

  registry.registerSession({ sessionId: 'sess-failopen', now: '2026-07-09T12:00:00.000Z' });

  // Must NOT throw, and must return the normal closed record.
  let closed;
  assert.doesNotThrow(() => {
    closed = registry.closeSession('sess-failopen', { now: '2026-07-09T12:05:00.000Z' });
  });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closed_at, '2026-07-09T12:05:00.000Z');
  assert.equal(fs.existsSync(path.join(dataDir, 'closed', 'sess-failopen.json')), true);

  // Sweep must be fail-open too.
  registry.registerSession({ sessionId: 'sess-failopen-2', now: '2026-07-09T11:00:00.000Z' });
  let result;
  assert.doesNotThrow(() => {
    result = registry.sweepExpired({ now: '2026-07-09T12:00:00.000Z', archive: true, maxAgeMs: 10 * 60 * 1000 });
  });
  assert.deepEqual(result.swept.map((s) => s.session_id), ['sess-failopen-2']);
  assert.deepEqual(result.errors, [], 'span-emit failure must not register as a sweep error');
});
