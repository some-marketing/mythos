'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const projection = require('../debrief-close-span-projection.cjs');
const cascadeSpan = require('../cascade-span.js');

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-span-projection-'));
}

function fixedInput(root, home, outcome = 'allow') {
  return {
    root,
    home,
    runtimeSessionId: `${home}-runtime-session`,
    scopeIdentity: 'sovereign-core-harness',
    closeReason: outcome === 'tombstone' ? 'sigkill-equivalent-loss' : 'stop',
    outcome,
    enforced: outcome === 'deny',
    startedAt: '2026-07-16T12:00:00.000Z',
    endedAt: '2026-07-16T12:00:00.100Z',
    emitSource: `${home}:fixture`,
    context: {
      action_id: 'action-pair-1',
      trace_id: 'trace-pair-1',
      parent_span_id: 'parent-pair-1',
      logical_session_id: 'logical-session-pair-1',
      scope_identity: 'sovereign-core-harness',
      work_unit: 'P4-S2-native-span-parity',
      lineage_root: 'lineage-pair-1',
      layer_depth: 2
    }
  };
}

for (const outcome of ['allow', 'deny', 'tombstone']) {
  test(`Claude and native ${outcome} observations validate and match on the closed projection`, (t) => {
    const root = sandbox();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const hook = projection.emitDebriefCloseObservation(fixedInput(root, 'claude-hook', outcome));
    const native = projection.emitDebriefCloseObservation(fixedInput(root, 'native', outcome));
    assert.equal(hook.ok, true, hook.error);
    assert.equal(native.ok, true, native.error);
    assert.equal(cascadeSpan.validateSpan(hook.span).ok, true);
    assert.equal(cascadeSpan.validateSpan(native.span).ok, true);
    assert.deepEqual(projection.compareProjections(hook.projection, native.projection), { ok: true, mismatches: [] });
    assert.notEqual(hook.span.span_id, native.span.span_id);
    assert.notEqual(hook.span.node.harness, native.span.node.harness);
    assert.equal(hook.projection.outcome, outcome);
    assert.equal(hook.projection.tombstone, outcome === 'tombstone');
  });
}

test('logical pairing identity does not overwrite actual runtime session identity', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  projection.emitDebriefCloseObservation(fixedInput(root, 'claude-hook'));
  projection.emitDebriefCloseObservation(fixedInput(root, 'native'));
  const rows = fs.readFileSync(path.join(root, '_dev/state/debrief-closeout/span-observations.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].projection.logical_session_id, rows[1].projection.logical_session_id);
  assert.notEqual(rows[0].actual_runtime_session_id, rows[1].actual_runtime_session_id);
});

test('production interface derives a valid root context when upstream context is absent', () => {
  const context = projection.resolveCorrelationContext({ runtimeSessionId: 'runtime-root', env: {} });
  assert.ok(context.action_id);
  assert.equal(context.trace_id, context.action_id);
  assert.equal(context.parent_span_id, null);
  assert.equal(context.logical_session_id, 'runtime-root');
  assert.equal(context.layer_depth, 0);
});

test('field-source map covers the closed projection key set exactly', () => {
  assert.deepEqual(Object.keys(projection.FIELD_SOURCE_MAP).sort(), projection.PROJECTION_KEYS.slice().sort());
  for (const source of Object.values(projection.FIELD_SOURCE_MAP)) {
    assert.ok(source.claude_hook);
    assert.ok(source.native);
  }
});

test('one mutation per invariant is rejected or reported as a mismatch', () => {
  const root = sandbox();
  const base = projection.emitDebriefCloseObservation(fixedInput(root, 'claude-hook')).projection;
  fs.rmSync(root, { recursive: true, force: true });
  for (const key of projection.PROJECTION_KEYS) {
    const changed = { ...base };
    if (typeof changed[key] === 'boolean') changed[key] = !changed[key];
    else if (typeof changed[key] === 'number') changed[key] += 1;
    else if (changed[key] === null) changed[key] = 'mutated';
    else changed[key] = `${changed[key]}-mutated`;
    const result = projection.compareProjections(base, changed);
    assert.equal(result.ok, false, `mutation escaped comparator: ${key}`);
    assert.ok(result.mismatches.some((item) => item.includes(key)), `mismatch did not name ${key}`);
  }
});

test('missing and unknown projection fields are rejected', () => {
  const root = sandbox();
  const base = projection.emitDebriefCloseObservation(fixedInput(root, 'claude-hook')).projection;
  fs.rmSync(root, { recursive: true, force: true });
  const missing = { ...base };
  delete missing.action_id;
  assert.equal(projection.validateProjection(missing).ok, false);
  assert.match(projection.validateProjection(missing).errors.join('\n'), /missing field: action_id/);
  const unknown = { ...base, extra: true };
  assert.equal(projection.validateProjection(unknown).ok, false);
  assert.match(projection.validateProjection(unknown).errors.join('\n'), /unknown field: extra/);
});

test('published JSON schema is closed and validates the emitted projection', () => {
  const root = sandbox();
  const emitted = projection.emitDebriefCloseObservation(fixedInput(root, 'claude-hook')).projection;
  fs.rmSync(root, { recursive: true, force: true });
  const schema = JSON.parse(fs.readFileSync(projection.PROJECTION_SCHEMA_PATH, 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(emitted), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...emitted, unknown: true }), false, 'additionalProperties must remain closed');
  const missing = { ...emitted };
  delete missing.action_id;
  assert.equal(validate(missing), false, 'required action_id must be enforced by the published schema');
});

test('span sink failure does not throw and creates a durable failure signal', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unwritableAsFile = path.join(root, 'span-log-is-a-directory');
  fs.mkdirSync(unwritableAsFile);
  const failureLogPath = path.join(root, 'failures', 'telemetry.jsonl');
  const result = projection.emitDebriefCloseObservation({
    ...fixedInput(root, 'claude-hook'),
    spanLogPath: unwritableAsFile,
    failureLogPath
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /CascadeSpan sink failed/);
  const failure = JSON.parse(fs.readFileSync(failureLogPath, 'utf8').trim());
  assert.equal(failure.schema, 'DebriefCloseTelemetryFailure/1.0');
  assert.equal(failure.home, 'claude-hook');
});
