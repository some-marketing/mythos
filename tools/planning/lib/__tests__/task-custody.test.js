'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildScopeIdentity, buildScopeIdentityForPlan } = require('../task-custody');

test('buildScopeIdentity generates system-scope custody mechanically', () => {
  const identity = buildScopeIdentity({
    taskId: 'review-task-plan-state-aware-output',
    scopeType: 'system',
    storageRoot: '_dev/reports/analysis/task-plans',
    planJsonPath: '_dev/reports/analysis/task-plans/review-task-plan-state-aware-output__plan.json',
    planMdPath: '_dev/reports/analysis/task-plans/review-task-plan-state-aware-output__plan.md',
    sessionOrRunId: 'session-1',
    forbiddenArtifacts: ['clients/{CLIENT_CODE}/plans/parallel__plan.json']
  });
  assert.equal(identity.workstream_scope, 'review-task-plan-state-aware-output');
  assert.equal(identity.session_or_run_id, 'session-1');
  assert.equal(identity.working_surface, 'Mythos/_dev/reports/analysis/task-plans');
  assert.equal(identity.custody_hierarchy.parent_scope, 'system:Mythos');
  assert.deepEqual(identity.forbidden_artifacts, ['clients/{CLIENT_CODE}/plans/parallel__plan.json']);
});

test('buildScopeIdentity generates task to project to client hierarchy', () => {
  const identity = buildScopeIdentity({
    taskId: 'landing-page-copy', scopeType: 'client', clientCode: '{CLIENT_CODE}', projectId: 'website-refresh',
    storageRoot: 'clients/{CLIENT_CODE}/plans', sessionOrRunId: 'signal-1', childScopes: ['landing-page-copy-review']
  });
  assert.equal(identity.working_surface, 'Mythos/clients/{CLIENT_CODE}/projects/website-refresh');
  assert.equal(identity.custody_hierarchy.parent_scope, 'client:{CLIENT_CODE}/project:website-refresh');
  assert.deepEqual(identity.custody_hierarchy.child_scopes, ['landing-page-copy-review']);
});

test('buildScopeIdentityForPlan derives plan paths without filesystem access', () => {
  const identity = buildScopeIdentityForPlan({
    task_id: 'fixture-task', scope_type: 'system', storage_root: '_dev/reports/analysis/task-plans'
  });
  assert.deepEqual(identity.owned_artifacts, [
    '_dev/reports/analysis/task-plans/fixture-task__plan.json',
    '_dev/reports/analysis/task-plans/fixture-task__plan.md'
  ]);
  const source = require('node:fs').readFileSync(require.resolve('../task-custody'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:fs|child_process)['"]\)|spawn|execFile/);
});
