'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const runner = require('../run-harness-sync-crawler.cjs');

test('buildCrawlerArgs applies canonical output to live and preview harnesses', () => {
  const args = runner.buildCrawlerArgs({ outputPath: '/tmp/harness-sync.json' });

  assert.equal(args[0], path.join(runner.REPO_ROOT, 'tools', 'instructions', 'harness-sync-crawler.js'));
  assert.deepEqual(args.slice(1), [
    '--apply',
    '--include-claude',
    '--output',
    '/tmp/harness-sync.json'
  ]);
});

test('buildRunRecord captures bounded scheduler evidence', () => {
  const record = runner.buildRunRecord({
    startedAt: '2026-06-02T12:00:00Z',
    durationMs: 1499,
    child: { status: 0, stdout: 'ok', stderr: '' },
    reportPath: runner.LATEST_REPORT
  });

  assert.equal(record.schema, 'HarnessSyncCrawlerLaunchdRun/1.0');
  assert.equal(record.exit_code, 0);
  assert.equal(record.duration_s, 1);
  assert.equal(record.success, true);
  assert.equal(record.stdout_preview, 'ok');
  assert.equal(record.report_path, '_dev/reports/analysis/harness-sync-crawler__launchd-latest.json');
});

test('preview truncates long output for state ledgers', () => {
  const text = 'a'.repeat(12);
  assert.equal(runner.preview(text, 5), 'aaaaa\n[truncated 7 chars]');
});
