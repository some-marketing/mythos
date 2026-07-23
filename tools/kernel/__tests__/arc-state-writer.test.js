'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { 
  getStatePathForActor, 
  createArc, 
  readCurrentArc, 
  transitionArc, 
  markArcComplete 
} = require('../lib/arc-state-writer.cjs');

const TEST_ACTOR = 'test-actor-' + Date.now();
const STATE_DIR = path.resolve(__dirname, '../../../_dev/state/actor-arc');

test('arc-state-writer: lifecycle', (t) => {
  const envelope = {
    arc_id: 'arc-123',
    workstream_scope: 'test-scope',
    actor_id: TEST_ACTOR,
    actor_tier: 'subagent',
    scope_identity: { task_id: 'test-task' },
    declared_write_set: ['src/**/*.js'],
    forbidden_artifacts: ['tests/**/*.js'],
    authority_source: { kind: 'operator-turn', ref: 'transcript-1' }
  };

  // 1. Create
  const arc = createArc(envelope);
  assert.strictEqual(arc.actor_id, TEST_ACTOR);
  assert.strictEqual(arc.lifecycle_state, 'authorized-for-arc');
  assert.ok(fs.existsSync(getStatePathForActor(TEST_ACTOR)));

  // 2. Read
  const read = readCurrentArc(TEST_ACTOR);
  assert.deepStrictEqual(read, arc);

  // 3. Transition
  const transitioned = transitionArc(TEST_ACTOR, 'executing', 'first-write');
  assert.strictEqual(transitioned.lifecycle_state, 'executing');
  assert.strictEqual(transitioned.history.length, 2);
  assert.strictEqual(transitioned.history[1].trigger, 'first-write');

  // 4. Complete
  const completed = markArcComplete(TEST_ACTOR, { reason: 'done', evidence_path: 'report.md' });
  assert.strictEqual(completed.lifecycle_state, 'arc-complete');
  assert.strictEqual(completed.end_reason, 'done');
  assert.ok(completed.arc_ended_at);

  // Cleanup
  fs.rmSync(getStatePathForActor(TEST_ACTOR));
});
