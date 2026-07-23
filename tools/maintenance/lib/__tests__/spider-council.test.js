'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  aggregateOwnedArtifactFindings,
  classifyOwnedArtifactFinding,
  OWNED_ARTIFACT_CLASSIFICATIONS
} = require('../spider-council.js');

function finding(id, text) {
  return {
    id,
    diet_class: 'task_plan_owned_artifact_missing',
    message: text,
    notes: text,
    evidence_paths: ['plan.json', text]
  };
}

test('owned-artifact classifier covers the five bounded labels', () => {
  const cases = [
    [finding('future', 'Planned (NEW) candidate output'), 'expected-future'],
    [finding('optional', 'Optional output when available'), 'optional'],
    [finding('stale', 'Superseded stale plan output'), 'stale-plan'],
    [finding('missing', 'Required output is missing'), 'missing-output'],
    [finding('ambiguous', 'Artifact <path>'), 'ambiguous']
  ];
  assert.deepEqual(OWNED_ARTIFACT_CLASSIFICATIONS, cases.map(([, label]) => label));
  for (const [item, expected] of cases) {
    assert.equal(classifyOwnedArtifactFinding(item), expected, item.id);
  }
});

test('multiple findings aggregate into exactly one blocked operator loop state', () => {
  const findings = [
    finding('a', 'Required output is missing'),
    finding('b', 'Optional output when available'),
    finding('c', 'Artifact <path>')
  ];
  for (const item of findings) item.classification = classifyOwnedArtifactFinding(item);
  const loopStates = aggregateOwnedArtifactFindings(findings);
  assert.strictEqual(loopStates.length, 1);
  assert.equal(loopStates[0].state, 'blocked');
  assert.equal(loopStates[0].authority, 'operator');
  assert.equal(loopStates[0].finding_count, 3);
  assert.equal(loopStates[0].classifications['missing-output'], 1);
  assert.equal(loopStates[0].classifications.optional, 1);
  assert.equal(loopStates[0].classifications.ambiguous, 1);
  assert.equal(loopStates[0].next_command, '/review-progress spider-ledger');
});

test('aggregation does not create per-finding dispatches', () => {
  const loopStates = aggregateOwnedArtifactFindings([
    finding('a', 'Required output is missing'),
    finding('b', 'Required output is missing')
  ]);
  assert.strictEqual(loopStates.length, 1);
  assert.ok(!loopStates[0].next_command.includes('/review-task-plan'));
});
