'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  parseArgs,
  runPublisher
} = require('../../publish-plan-diagram.js');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function makeRoot(withDartTask) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-plan-diagram-cli-'));
  const planRoot = path.join(root, '_dev/reports/analysis/task-plans');
  writeJson(path.join(planRoot, 'demo-plan__plan.json'), {
    schema: 'TaskPlan/1.0',
    task_id: 'demo-plan',
    title: 'Demo Plan',
    scope_type: 'system',
    dart_task_id: withDartTask ? 'DART123' : undefined,
    bounded_plan: { steps: [{ step_id: 's1', status: 'completed' }] }
  });
  return root;
}

test('parseArgs requires values for value flags', () => {
  assert.throws(() => parseArgs(['--plan']), /Missing value for --plan/);
  assert.throws(() => parseArgs(['--event', '--force']), /Missing value for --event/);
  assert.throws(() => parseArgs(['--publish-url']), /Missing value for --publish-url/);
});

test('runPublisher does not call Dart when --apply-comment is absent', async () => {
  const root = makeRoot(true);
  const calls = [];
  const summary = await runPublisher(root, {
    plan: 'demo-plan',
    event: 'manual',
    publishUrl: '',
    includeClient: false,
    force: false,
    applyComment: false
  }, {
    dart: {
      async addComment(taskId, text) {
        calls.push({ taskId, text });
      }
    }
  });
  assert.equal(summary.applied_comment, false);
  assert.equal(calls.length, 0);
});

test('runPublisher apply-comment is a no-op when dart_task_id is absent', async () => {
  const root = makeRoot(false);
  const calls = [];
  const summary = await runPublisher(root, {
    plan: 'demo-plan',
    event: 'manual',
    publishUrl: '',
    includeClient: false,
    force: false,
    applyComment: true
  }, {
    dart: {
      async addComment(taskId, text) {
        calls.push({ taskId, text });
      }
    }
  });
  assert.equal(summary.action, 'publication-written-comment-not-applied');
  assert.equal(summary.reason, 'plan has no dart_task_id; publisher does not create Dart tasks');
  assert.equal(calls.length, 0);
});

test('runPublisher apply-comment calls Dart only when dart_task_id exists', async () => {
  const root = makeRoot(true);
  const calls = [];
  const summary = await runPublisher(root, {
    plan: 'demo-plan',
    event: 'manual',
    publishUrl: '',
    includeClient: false,
    force: false,
    applyComment: true
  }, {
    dart: {
      async addComment(taskId, text) {
        calls.push({ taskId, text });
        return { item: { id: 'COMMENT1' } };
      }
    }
  });
  assert.equal(summary.action, 'publication-written-comment-applied');
  assert.equal(summary.applied_comment, true);
  assert.equal(summary.comment_id, 'COMMENT1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskId, 'DART123');
  assert.match(calls[0].text, /Artifact Index:/);
});
