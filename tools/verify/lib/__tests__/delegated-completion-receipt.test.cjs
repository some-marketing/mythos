'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RECEIPT_SCHEMA, validateDelegatedCompletionReceipt } = require('../delegated-completion-receipt.cjs');
const { validateActorReturn } = require('../../../signals/lib/recursive-actor-work-order.js');

function receipt(overrides = {}) {
  return { schema: RECEIPT_SCHEMA, status: 'complete', scope: 'task/example', changed_files: [{ path: 'tools/example.js' }], test_results: [{ schema: 'TestExecutionReceipt/1.0', command: 'node --test focused.test.cjs', exit_code: 0, status: 'passed', started_at: '2026-08-17T14:00:00Z', completed_at: '2026-08-17T14:00:01Z', counts: { passed: 1, failed: 0, skipped: 0, todo: 0 }, producer: { actor_id: 'worker', harness_id: 'node' } }], acceptance_criteria: [{ criterion_id: 'AC1' }], acceptance_evidence: [{ criterion_id: 'AC1', evidence: ['test_results[0]'], independently_verified: true }], parent_verification: { observed: true, actor_id: 'parent', changed_files_verified: true, observed_changed_files: ['tools/example.js'], acceptance_criteria_verified: ['AC1'] }, ...overrides };
}

test('valid completion is accepted and forged completion is rejected', () => {
  assert.equal(validateDelegatedCompletionReceipt(receipt(), { parentScope: 'task/example' }).valid, true);
  assert.equal(validateDelegatedCompletionReceipt({ status: 'complete', summary: 'done' }).valid, false);
});

test('done is a completion status and cannot bypass receipt validation', () => {
  assert.equal(validateDelegatedCompletionReceipt({ status: 'done', summary: 'done' }).valid, false);
  assert.equal(validateDelegatedCompletionReceipt(receipt({ status: 'done' }), { parentScope: 'task/example' }).valid, true);
});

test('parent verifier must be distinct from the completion producer', () => {
  const value = receipt({ parent_verification: { ...receipt().parent_verification, actor_id: 'worker' } });
  assert.equal(validateDelegatedCompletionReceipt(value).valid, false);
});

test('no-op requires parent verified clean workspace', () => {
  const value = receipt({ changed_files: [], parent_verification: { observed: true, actor_id: 'parent', changed_files_verified: true, workspace_clean: true, acceptance_criteria_verified: ['AC1'] } });
  assert.equal(validateDelegatedCompletionReceipt(value).valid, true);
  assert.equal(validateDelegatedCompletionReceipt({ ...value, parent_verification: { ...value.parent_verification, workspace_clean: false } }).valid, false);
});

test('parent reintegration rejects ungated completion and preserves incomplete', () => {
  const common = { evidence_locations: ['receipt.json'], next_command: 'continue', parent_impact: 'repair', bubble_up_gate: 'none' };
  assert.equal(validateActorReturn({ ...common, status: 'incomplete' }).valid, true);
  assert.equal(validateActorReturn({ ...common, status: 'done', summary: 'done' }).valid, false);
  assert.equal(validateActorReturn({ ...common, status: 'complete', summary: 'done' }).valid, false);
  assert.equal(validateActorReturn({ ...common, status: 'complete', completion_receipt: receipt() }, { parentScope: 'task/example' }).valid, true);
});
