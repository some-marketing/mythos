'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  resolveTypedInvocation,
  validateTargetCommandCompat
} = require('../target-command-policy.cjs');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'invocation-validation-cases.json'), 'utf8'));

test('typed invocation fixtures resolve or fail closed without silent drops', () => {
  for (const fixture of fixtures) {
    const result = resolveTypedInvocation({
      projectRoot,
      input: fixture.input,
      authorityAllowed: fixture.authority_allowed !== false,
      safetyAllowed: fixture.safety_allowed !== false
    });
    assert.equal(result.terminal_state, fixture.expected_state, fixture.id);
    if (fixture.expected_resolution) assert.equal(result.resolution_state, fixture.expected_resolution, fixture.id);
    assert.equal(result.original_input, fixture.input, fixture.id);
    if (fixture.expected_scope) assert.equal(result.semantic_scope.type, fixture.expected_scope, fixture.id);
    if (fixture.expected_resolved !== undefined) assert.equal(result.resolved_command, fixture.expected_resolved, fixture.id);
    if (fixture.expected_resolved_prefix) assert.ok(result.resolved_command.startsWith(fixture.expected_resolved_prefix), fixture.id);
  }
});

test('routing fallback is recursion-safe and preserves quoted input', () => {
  const input = 'please handle "unclear" work';
  const result = resolveTypedInvocation({ projectRoot, input });
  assert.equal(result.original_input, input);
  assert.equal(result.resolved_command, '/route "please handle \\"unclear\\" work"');

  for (const routed of ['/route "again"', '/help-me-route']) {
    const blocked = resolveTypedInvocation({ projectRoot, input: routed });
    assert.equal(blocked.terminal_state, 'blocked');
    assert.equal(blocked.resolved_command, '');
  }
});

test('authority and safety failures never enter fuzzy routing', () => {
  for (const key of ['authorityAllowed', 'safetyAllowed']) {
    const result = resolveTypedInvocation({ projectRoot, input: 'novel intent', [key]: false });
    assert.equal(result.terminal_state, 'blocked');
    assert.equal(result.resolved_command, '');
  }
});

test('existing dispatch-bridge compatibility behavior remains available', () => {
  const result = validateTargetCommandCompat({ target: 'claude', command: '/review-progress repo', projectRoot });
  assert.equal(result.allowed, true);
});
