#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  checkDispatchCoverage
} = require('../check-dispatch-coverage.cjs');

function writeJson(root, rel, data) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return full;
}

function baseOutcome(taskId) {
  return {
    task_id: taskId,
    outcome_delta: { completed: true },
    produced_by_actor_id: 'claude',
    produced_by_harness_id: 'claude-code'
  };
}

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-coverage-'));
}

{
  const root = mkRoot();
  const taskId = 'sample-task';
  const input = writeJson(root, `_dev/reports/analysis/task-outcomes/${taskId}.json`, baseOutcome(taskId));
  writeJson(root, `_dev/reports/signals/closed/dispatch-bridge__20260626T000000Z__${taskId}.signal.json`, {
    scope: taskId,
    signal_scope: taskId,
    task_summary: `Review ${taskId}`
  });
  writeJson(root, `_dev/reports/analysis/task-plan-reviews/${taskId}__review.json`, {
    schema: 'TaskPlanReview/1.0',
    generated_at: '2026-06-26T00:10:00.000Z',
    reviewer: {
      actor_id: 'codex',
      harness_id: 'codex-cli'
    },
    target: taskId
  });

  const result = checkDispatchCoverage(root, input, JSON.parse(fs.readFileSync(input, 'utf8')));
  assert.strictEqual(result.gap_classification, 'dispatch-returned');
  assert.strictEqual(result.dispatch_sent, true);
  assert.strictEqual(result.return_artifact, `_dev/reports/analysis/task-plan-reviews/${taskId}__review.json`);
}

{
  const root = mkRoot();
  const taskId = 'dispatch-without-return';
  const input = writeJson(root, `_dev/reports/analysis/task-outcomes/${taskId}.json`, baseOutcome(taskId));
  writeJson(root, `_dev/reports/signals/dispatch-bridge__20260626T000000Z__${taskId}.signal.json`, {
    scope: taskId,
    task_summary: `Review ${taskId}`
  });

  const result = checkDispatchCoverage(root, input, JSON.parse(fs.readFileSync(input, 'utf8')));
  assert.strictEqual(result.gap_classification, 'dispatch-no-return');
  assert.strictEqual(result.dispatch_sent, true);
  assert.strictEqual(result.return_artifact, null);
}

{
  const root = mkRoot();
  const taskId = 'missing-dispatch';
  const input = writeJson(root, `_dev/reports/analysis/task-outcomes/${taskId}.json`, baseOutcome(taskId));

  const result = checkDispatchCoverage(root, input, JSON.parse(fs.readFileSync(input, 'utf8')));
  assert.strictEqual(result.gap_classification, 'no-dispatch');
  assert.strictEqual(result.dispatch_sent, false);
}

{
  const root = mkRoot();
  const taskId = 'not-complete';
  const input = writeJson(root, `_dev/reports/analysis/task-outcomes/${taskId}.json`, {
    task_id: taskId,
    outcome_delta: { completed: false },
    produced_by_actor_id: 'claude',
    produced_by_harness_id: 'claude-code'
  });

  const result = checkDispatchCoverage(root, input, JSON.parse(fs.readFileSync(input, 'utf8')));
  assert.strictEqual(result.gap_classification, 'indeterminate');
  assert.deepStrictEqual(result.evidence.notes, ['event-class-not-present']);
}

console.log('check-dispatch-coverage: passed');
