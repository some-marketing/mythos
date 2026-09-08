'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8')); }
function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
function buildCases(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-grammar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = [];
  function add(plan, expected, state) {
    write(root, '_dev/reports/analysis/task-plans/' + plan.task_id + '__plan.json', plan);
    cases.push({ plan, expected, state });
    return plan;
  }
  add(fixture('plan-complete.json'), 'complete', 'complete');
  write(root, '_dev/reports/analysis/task-outcomes/cg-complete.json', fixture('outcome-complete.json'));
  write(root, '_dev/reports/analysis/run-debrief__cg-complete.md', '# Synthetic acceptance fixture only\n');
  for (const name of ['plan-declared-complete.json', 'plan-debrief-only.json', 'plan-steps-done.json']) {
    const plan = fixture(name);
    add(plan, plan.approval?.status === 'approved' ? 'ready' : 'planned', 'planned');
  }
  write(root, '_dev/reports/analysis/run-debrief__cg-debrief-only.md', '# Debrief only\n');
  add(fixture('plan-bridge-blocked.json'), 'blocked', 'blocked');
  add(fixture('plan-bridge-no-evidence.json'), 'planned', 'planned');
  for (const approval of ['approved', 'pending', 'needs_review']) {
    for (const admitted of [false, true]) {
      const id = 'cg-' + approval + (admitted ? '-admitted' : '-only');
      const plan = {
        task_id: id, title: id, scope_type: 'system', approval: { status: approval },
        routing_expectations: { review_lane: 'codex-bridge' },
        // Bare completed steps are declarations, not artifact-backed execution.
        bounded_plan: { steps: [{ step_id: 'S1', status: 'complete' }, { step_id: 'S2', status: 'planned' }] }
      };
      if (approval === 'approved') plan.bounded_plan.steps[1].status = 'ready';
      if (admitted) {
        plan.distinct_reviews = [{ actor: 'fixture-reviewer', verdict: 'approved', artifact: '_dev/reports/analysis/task-plan-reviews/' + id + '__review.json' }];
        write(root, '_dev/reports/signals/codex-bridge__' + id + '.signal.json', { scope: id, signal_scope: id, lifecycle_state: 'live', status: 'dispatched' });
        write(root, '_dev/reports/analysis/codex-bridge-prompt__' + id + '.md', '# Synthetic admission prompt\n');
        write(root, '_dev/reports/analysis/codewhale-context-sweep__' + id + '__fixture.md', '# Synthetic admission context\n');
        write(root, '_dev/reports/analysis/task-plan-reviews/' + id + '__review.json', { verdict: 'approved' });
        write(root, '_dev/state/plan-task-review-state/' + id + '.json', { schema: 'PlanTaskReviewState/1.0', task_id: id, post_review: { decision: 'approved' }, post_repair: { review_status: 'approved' }, distinct_reviews: plan.distinct_reviews });
      }
      add(plan, approval === 'approved' ? 'ready' : 'needs_review', 'planned');
    }
  }
  for (const status of ['in_progress', 'in-progress', 'blocked']) {
    for (const approval of [undefined, 'blocked', 'approved', 'pending']) {
      const id = 'cg-declared-step-' + status + '-' + (approval || 'none');
      const plan = { task_id: id, bounded_plan: { steps: [{ step_id: 'S1', status }] } };
      if (approval) plan.approval = { status: approval };
      add(plan, approval === 'approved' ? 'ready' : approval === 'pending' ? 'needs_review' : 'planned', 'planned');
    }
  }
  add({ task_id: 'cg-running', outcome_delta: { completed: false } }, 'in_progress', 'in_progress');
  for (const [suffix, value] of [['null', null], ['array', []], ['string', 'complete'], ['boolean', true]]) {
    add({ task_id: 'cg-invalid-' + suffix, outcome_delta: value }, 'planned', 'planned');
  }
  return { root, cases };
}
module.exports = { buildCases, fixture, write };
