'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const runner = require('../run-harness-capability-crawler.cjs');

test('buildCrawlerArgs runs capability crawler in report-only mode', () => {
  const args = runner.buildCrawlerArgs({ outputPath: '/tmp/capability.json' });

  assert.equal(args[0], path.join(runner.REPO_ROOT, 'tools', 'instructions', 'harness-capability-crawler.js'));
  assert.deepEqual(args.slice(1), [
    '--output',
    '/tmp/capability.json'
  ]);
});

test('buildReducerArgs writes next-action queue from crawler ledger', () => {
  const args = runner.buildReducerArgs({
    outputPath: '/tmp/capability.json',
    nextActionsPath: '/tmp/next-actions.json',
    nextActionsMarkdownPath: '/tmp/next-actions.md'
  });

  assert.equal(args[0], path.join(runner.REPO_ROOT, 'tools', 'instructions', 'harness-capability-next-actions.js'));
  assert.deepEqual(args.slice(1), [
    '--ledger',
    '/tmp/capability.json',
    '--output',
    '/tmp/next-actions.json',
    '--markdown',
    '/tmp/next-actions.md'
  ]);
});

test('buildRunRecord requires crawler and reducer success', () => {
  const record = runner.buildRunRecord({
    startedAt: '2026-06-02T12:00:00Z',
    durationMs: 1200,
    crawler: { status: 0, stdout: 'crawler ok', stderr: '' },
    reducer: { status: 0, stdout: 'reducer ok', stderr: '' }
  });

  assert.equal(record.schema, 'HarnessCapabilityCrawlerLaunchdRun/1.0');
  assert.equal(record.exit_code, 0);
  assert.equal(record.success, true);
  assert.equal(record.report_path, '_dev/reports/analysis/harness-capability-crawler__launchd-latest.json');
  assert.equal(record.next_actions_path, '_dev/reports/analysis/harness-capability-next-actions.json');
  assert.equal(record.next_actions_markdown_path, '_dev/reports/analysis/harness-capability-next-actions.md');
});
