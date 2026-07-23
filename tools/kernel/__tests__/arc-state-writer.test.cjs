'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const writer = require(path.join(REPO_ROOT, 'tools/kernel/lib/arc-state-writer.cjs'));

function withTempArcDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-arc-writer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.MYTHOS_ACTOR_ARC_DIR = dir;
  t.after(() => {
    delete process.env.MYTHOS_ACTOR_ARC_DIR;
  });
  return dir;
}

function baseEnvelope(overrides) {
  return Object.assign(
    {
      arc_id: 'arc-001',
      workstream_scope: 'actor-arc-state-machine',
      scope_identity: {
        workstream_scope: 'actor-arc-state-machine',
        owned_artifacts: ['tools/kernel/lib/arc-state-writer.cjs'],
        forbidden_artifacts: ['instructions/canonical/kernel/**']
      },
      declared_write_set: ['tools/kernel/**', '_dev/state/actor-arc/**'],
      forbidden_artifacts: ['instructions/canonical/kernel/**'],
      authority_source: {
        kind: 'approved-plan',
        ref: '_dev/reports/analysis/task-plans/actor-arc-state-machine__plan.json'
      },
      parent_arc_id: null,
      authorized_at: '2026-04-24T16:00:00-0300',
      lifecycle_state: 'authorized-for-arc',
      actor_id: 'claude-main-chain-session:test',
      actor_tier: 'main-chain',
      arc_ended_at: null,
      end_reason: null
    },
    overrides || {}
  );
}

test('createArc writes an initial actor-arc snapshot', (t) => {
  withTempArcDir(t);
  const created = writer.createArc(baseEnvelope());
  const saved = writer.readCurrentArc('claude-main-chain-session:test');
  assert.equal(created.arc_id, 'arc-001');
  assert.ok(saved);
  assert.equal(saved.lifecycle_state, 'authorized-for-arc');
  assert.equal(saved.history.length, 1);
});

test('transitionArc appends history and updates lifecycle_state', (t) => {
  withTempArcDir(t);
  writer.createArc(baseEnvelope());
  const next = writer.transitionArc(
    'claude-main-chain-session:test',
    'executing',
    'first-write',
    { path: 'tools/kernel/lib/arc-state-writer.cjs' }
  );
  assert.equal(next.lifecycle_state, 'executing');
  assert.equal(next.history.length, 2);
  assert.equal(next.history[1].trigger, 'first-write');
});

test('markArcComplete sets closeout fields', (t) => {
  withTempArcDir(t);
  writer.createArc(baseEnvelope());
  writer.transitionArc('claude-main-chain-session:test', 'closing', 'closeout-start', null);
  const completed = writer.markArcComplete('claude-main-chain-session:test', {
    reason: 'closeout-evidence-present',
    debrief_path: '_dev/reports/analysis/run-debrief__actor-arc-state-machine.md'
  });
  assert.equal(completed.lifecycle_state, 'arc-complete');
  assert.equal(completed.end_reason, 'closeout-evidence-present');
  assert.ok(completed.arc_ended_at);
  assert.equal(completed.history.at(-1).trigger, 'markArcComplete');
});

test('getStatePathForActor is stable and atomic writes leave no tmp file behind', (t) => {
  const dir = withTempArcDir(t);
  writer.createArc(baseEnvelope());
  const statePath = writer.getStatePathForActor('claude-main-chain-session:test');
  assert.ok(fs.existsSync(statePath));
  assert.equal(fs.existsSync(statePath + '.tmp'), false);
  assert.match(statePath, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('validateArcSnapshot rejects malformed envelopes', () => {
  const validation = writer.validateArcSnapshot({
    arc_id: '',
    actor_id: 'x'
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((entry) => entry.includes('workstream_scope')));
  assert.ok(validation.errors.some((entry) => entry.includes('authority_source')));
});
