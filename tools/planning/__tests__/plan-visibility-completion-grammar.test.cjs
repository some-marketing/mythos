'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const visibility = require('../lib/plan-visibility');
const { classifyPlanState } = require('../lib/completion-classifier');
const { listAllTaskPlans } = require('../lib/resolve-task-plan');
const { buildCases, fixture, write } = require('../__fixtures__/completion-grammar/cases.cjs');

test('shared completion grammar preserves completion evidence and admission-only lanes', (t) => {
  const { root, cases } = buildCases(t);
  const summaries = new Map(visibility.collectPlanSummaries(root).map(row => [row.task_id, row.status]));
  for (const { plan, expected, state } of cases) {
    const actual = classifyPlanState(root, plan);
    assert.equal(actual.state, state, plan.task_id + ': ' + actual.reason);
    assert.equal(visibility.classifyPlan(plan, root), expected, plan.task_id);
    assert.equal(summaries.get(plan.task_id), expected, plan.task_id);
    if (plan.task_id.includes('admitted') || plan.task_id.includes('-only')) assert.equal(actual.evidence.hasExecutionEvidence, false, plan.task_id);
  }
  assert.ok([...summaries.values()].includes('ready'));
  assert.ok([...summaries.values()].includes('needs_review'));
  assert.equal(classifyPlanState(root, fixture('plan-bridge-blocked.json')).evidence.bridgeBlocked.blocked, true);
  assert.equal(classifyPlanState(root, fixture('plan-bridge-no-evidence.json')).evidence.bridgeBlocked.blocked, true);
});

test('both document classification paths match collection for the same evidence', (t) => {
  const { root, cases } = buildCases(t);
  const summaries = new Map(visibility.collectPlanSummaries(root).map(row => [row.task_id, row.status]));
  for (const { plan } of cases) {
    const status = summaries.get(plan.task_id);
    const phrase = 'it is currently ' + status + ',';
    assert.ok(visibility.buildPlanDocumentLead(plan, { projectRoot: root }).includes(phrase), plan.task_id + ' lead');
    assert.ok(visibility.renderPlanDocumentMarkdown(root, { taskId: plan.task_id }).includes(phrase), plan.task_id + ' markdown');
  }
});

test('declared completion and completed steps cannot establish completion without a root', () => {
  for (const name of ['plan-complete.json', 'plan-declared-complete.json', 'plan-steps-done.json']) {
    const plan = fixture(name);
    for (const root of [undefined, null, '']) assert.notEqual(visibility.classifyPlan(plan, root), 'complete');
    assert.ok(!visibility.buildPlanDocumentLead(plan).includes('it is currently complete,'));
  }
});

test('explicit declared blockers retain their dashboard override', (t) => {
  const { root } = buildCases(t);
  assert.equal(visibility.classifyPlan({ task_id: 'declared-blocker', status: 'blocked' }, root), 'blocked');
});

test('classification observes an outcome appearing or changing between reads', (t) => {
  const { root } = buildCases(t);
  const plan = fixture('plan-complete.json');
  const location = '_dev/reports/analysis/task-outcomes/cg-complete.json';
  fs.unlinkSync(path.join(root, location));
  assert.notEqual(visibility.classifyPlan(plan, root), 'complete');
  write(root, location, fixture('outcome-complete.json'));
  assert.equal(visibility.classifyPlan(plan, root), 'complete');
  write(root, location, { task_id: plan.task_id, outcome_delta: { completed: false } });
  assert.notEqual(visibility.classifyPlan(plan, root), 'complete');
});

test('synthetic portfolio classification agrees with shared authority subject to declared-blocker override', (t) => {
  const { root } = buildCases(t);
  write(root, '_dev/reports/analysis/task-plans/explicit-blocker__plan.json', { task_id: 'explicit-blocker', status: 'blocked' });
  const entries = listAllTaskPlans(root);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    let plan;
    try { plan = JSON.parse(fs.readFileSync(entry.jsonPath, 'utf8')); } catch { continue; }
    const state = classifyPlanState(root, plan).state;
    const dashboard = visibility.classifyPlan(plan, root);
    if (String(plan.status || '').trim().toLowerCase() === 'blocked') assert.equal(dashboard, 'blocked', entry.taskId);
    else if (state !== 'planned') assert.equal(dashboard, state, entry.taskId);
    else assert.ok(['planned', 'ready', 'needs_review'].includes(dashboard), entry.taskId + ': shared planned must not become ' + dashboard);
  }
});

test('one collection lists each evidence directory once across distinct bridge plans', (t) => {
  const { root } = buildCases(t);
  const directories = ['_dev/reports/analysis', '_dev/reports/signals', '_dev/reports/signals/closed'].map(dir => path.join(root, dir));
  fs.mkdirSync(directories[2], { recursive: true });
  const original = fs.readdirSync;
  const reads = new Map();
  t.mock.method(fs, 'readdirSync', function (dir, ...args) {
    if (directories.includes(String(dir))) reads.set(String(dir), (reads.get(String(dir)) || 0) + 1);
    return original.call(fs, dir, ...args);
  });
  visibility.collectPlanSummaries(root);
  for (const dir of directories) assert.equal(reads.get(dir), 1, dir);
});

test('new collection observes newly created outcome and review feedback filenames', (t) => {
  const { root } = buildCases(t);
  const id = 'cg-bridge-blocked';
  const plan = fixture('plan-bridge-blocked.json');
  assert.equal(visibility.collectPlanSummaries(root).find(row => row.task_id === id).status, 'blocked');
  // These are new filenames, not edits to already indexed evidence.
  write(root, '_dev/reports/analysis/codex-cli-run__fixture__' + id + '.result.json', { outcome: 'success', closeout_coherent: true });
  write(root, '_dev/reports/signals/ready-for-review__fixture__' + id + '.json', { run_outcome: { success: true } });
  write(root, '_dev/reports/signals/codex-bridge__' + id + '.signal.json', { lifecycle_state: 'feedback_received' });
  write(root, '_dev/reports/analysis/codex-bridge-prompt__' + id + '.md', '# Synthetic prompt\n');
  const outcome = fixture('outcome-complete.json');
  outcome.task_id = id;
  write(root, '_dev/reports/analysis/task-outcomes/' + id + '.json', outcome);
  assert.equal(classifyPlanState(root, plan).state, 'complete');
  assert.equal(visibility.collectPlanSummaries(root).find(row => row.task_id === id).status, 'complete');
});

test('root-bound read context cannot be reused for another project root', (t) => {
  const { root } = buildCases(t);
  const { root: otherRoot } = buildCases(t);
  const { createCompletionReadContext } = require('../lib/completion-classifier');
  const readContext = createCompletionReadContext(root);
  assert.throws(() => classifyPlanState(otherRoot, { task_id: 'other' }, { readContext }), /context does not match project root/);
  assert.equal(classifyPlanState(root, { task_id: 'first' }, { readContext }).state, 'planned');
});

test('directory context never caches acceptance decisions or outcome contents', (t) => {
  const { root } = buildCases(t);
  const { createCompletionReadContext } = require('../lib/completion-classifier');
  const readContext = createCompletionReadContext(root);
  const plan = fixture('plan-complete.json');
  assert.equal(classifyPlanState(root, plan, { readContext }).state, 'complete');
  const outcome = fixture('outcome-complete.json');
  outcome.completion_evidence.verification_passed = false;
  write(root, '_dev/reports/analysis/task-outcomes/cg-complete.json', outcome);
  assert.notEqual(classifyPlanState(root, plan, { readContext }).state, 'complete');
});
