'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  AUTHORITY_FIELDS,
  classifyMutation,
  isAuthorityField
} = require('../repair-vs-amend-classifier');

function buildInput(mutations, fileType) {
  return {
    file_type: fileType || 'json',
    target_plan_path: '/tmp/fake__plan.json',
    mutations: mutations
  };
}

test('task_summary update routes to repair', () => {
  const result = classifyMutation(
    buildInput([{ dotted_path: 'task_summary', operation: 'update' }])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, ['task_summary']);
});

test('non_goals add routes to repair', () => {
  const result = classifyMutation(
    buildInput([{ dotted_path: 'non_goals', operation: 'add' }])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, ['non_goals']);
});

test('bounded_plan.steps.0.description update routes to repair (array-index normalization)', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'bounded_plan.steps.0.description', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'bounded_plan.steps.0.description'
  ]);
});

test('bounded_plan.required_gates update routes to repair', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'bounded_plan.required_gates', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'bounded_plan.required_gates'
  ]);
});

test('bounded_plan.expected_outcomes update routes to repair', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'bounded_plan.expected_outcomes', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'bounded_plan.expected_outcomes'
  ]);
});

test('routing_expectations.risk_tier change routes to repair', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'routing_expectations.risk_tier', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'routing_expectations.risk_tier'
  ]);
});

test('routing_expectations.review_lane change routes to repair', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'routing_expectations.review_lane', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'routing_expectations.review_lane'
  ]);
});

test('exact_next_command change routes to repair', () => {
  const result = classifyMutation(
    buildInput([{ dotted_path: 'exact_next_command', operation: 'update' }])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, ['exact_next_command']);
});

test('md:Next command MD section update routes to repair', () => {
  const result = classifyMutation(
    buildInput(
      [{ dotted_path: 'md:Next command', operation: 'update' }],
      'md'
    )
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, ['md:Next command']);
});

test('overlay field planning_constraints.plan_only update routes to amend', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'planning_constraints.plan_only', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'amend');
  assert.deepStrictEqual(result.matchedAuthorityFields, []);
});

test('empty mutations array returns none', () => {
  const result = classifyMutation(buildInput([]));
  assert.strictEqual(result.route, 'none');
  assert.deepStrictEqual(result.matchedAuthorityFields, []);
});

test('mixed authority + overlay mutations route to repair (any authority triggers repair)', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'planning_constraints.plan_only', operation: 'update' },
      { dotted_path: 'task_summary', operation: 'update' },
      { dotted_path: 'some_overlay_field', operation: 'add' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, ['task_summary']);
});

test('isAuthorityField handles bracket-index normalization', () => {
  assert.strictEqual(
    isAuthorityField('bounded_plan.steps[2].description'),
    true
  );
});

test('isAuthorityField is case-insensitive for md: section names', () => {
  assert.strictEqual(isAuthorityField('md:next command'), true);
  assert.strictEqual(isAuthorityField('md:NEXT COMMAND'), true);
});

test('AUTHORITY_FIELDS export is a non-empty Set', () => {
  assert.ok(AUTHORITY_FIELDS instanceof Set);
  assert.ok(AUTHORITY_FIELDS.size > 0);
});

test('bounded_plan.risk_notes update routes to repair (D1 expansion)', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'bounded_plan.risk_notes', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'bounded_plan.risk_notes'
  ]);
});

test('validation_confidence update routes to repair (D1 expansion)', () => {
  const result = classifyMutation(
    buildInput([
      { dotted_path: 'validation_confidence', operation: 'update' }
    ])
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'validation_confidence'
  ]);
});

test('md:Risk notes MD mirror routes to repair (D1 expansion)', () => {
  const result = classifyMutation(
    buildInput(
      [{ dotted_path: 'md:Risk notes', operation: 'update' }],
      'md'
    )
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, ['md:Risk notes']);
});

test('md:Validation confidence MD mirror routes to repair (D1 expansion)', () => {
  const result = classifyMutation(
    buildInput(
      [{ dotted_path: 'md:Validation confidence', operation: 'update' }],
      'md'
    )
  );
  assert.strictEqual(result.route, 'repair');
  assert.deepStrictEqual(result.matchedAuthorityFields, [
    'md:Validation confidence'
  ]);
});
