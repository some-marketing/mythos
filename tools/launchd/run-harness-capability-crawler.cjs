#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = '/Users/admin/dev/Mythos-recovered';
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'harness-capability-crawler');
const LATEST_REPORT = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'harness-capability-crawler__launchd-latest.json');
const NEXT_ACTIONS_REPORT = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'harness-capability-next-actions.json');
const NEXT_ACTIONS_MARKDOWN = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'harness-capability-next-actions.md');

function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

function preview(text, max = 4000) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

function buildCrawlerArgs(opts = {}) {
  return [
    path.join(REPO_ROOT, 'tools', 'instructions', 'harness-capability-crawler.js'),
    '--output',
    opts.outputPath || LATEST_REPORT
  ];
}

function buildReducerArgs(opts = {}) {
  return [
    path.join(REPO_ROOT, 'tools', 'instructions', 'harness-capability-next-actions.js'),
    '--ledger',
    opts.outputPath || LATEST_REPORT,
    '--output',
    opts.nextActionsPath || NEXT_ACTIONS_REPORT,
    '--markdown',
    opts.nextActionsMarkdownPath || NEXT_ACTIONS_MARKDOWN
  ];
}

function buildRunRecord({ startedAt, durationMs, crawler, reducer, reportPath = LATEST_REPORT, nextActionsPath = NEXT_ACTIONS_REPORT, nextActionsMarkdownPath = NEXT_ACTIONS_MARKDOWN }) {
  const crawlerExit = crawler.status == null ? -1 : crawler.status;
  const reducerExit = reducer.status == null ? -1 : reducer.status;
  return {
    schema: 'HarnessCapabilityCrawlerLaunchdRun/1.0',
    ts: startedAt,
    exit_code: crawlerExit === 0 ? reducerExit : crawlerExit,
    duration_s: Math.round(durationMs / 1000),
    report_path: path.relative(REPO_ROOT, reportPath),
    next_actions_path: path.relative(REPO_ROOT, nextActionsPath),
    next_actions_markdown_path: path.relative(REPO_ROOT, nextActionsMarkdownPath),
    crawler_stdout_preview: preview(crawler.stdout || ''),
    crawler_stderr_preview: preview(crawler.stderr || ''),
    reducer_stdout_preview: preview(reducer.stdout || ''),
    reducer_stderr_preview: preview(reducer.stderr || ''),
    success: crawlerExit === 0 && reducerExit === 0
  };
}

function writeRunRecord(record, stateDir = STATE_DIR) {
  fs.mkdirSync(stateDir, { recursive: true });
  const statePath = path.join(stateDir, 'state.json');
  const runsLog = path.join(stateDir, 'runs.jsonl');
  fs.writeFileSync(statePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.appendFileSync(runsLog, `${JSON.stringify(record)}\n`, 'utf8');
  return { statePath, runsLog };
}

function run(opts = {}) {
  process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  process.env.HOME = process.env.HOME || '/Users/admin';
  process.env.LC_ALL = process.env.LC_ALL || 'en_CA.UTF-8';

  const startedAt = stamp();
  const startMs = Date.now();
  const crawlerArgs = buildCrawlerArgs(opts);
  const reducerArgs = buildReducerArgs(opts);

  if (opts.dryRun) {
    const planned = {
      schema: 'HarnessCapabilityCrawlerLaunchdDryRun/1.0',
      ts: startedAt,
      crawler_command: [process.execPath, ...crawlerArgs],
      reducer_command: [process.execPath, ...reducerArgs],
      cwd: REPO_ROOT,
      state_dir: path.relative(REPO_ROOT, STATE_DIR),
      report_path: path.relative(REPO_ROOT, opts.outputPath || LATEST_REPORT),
      next_actions_path: path.relative(REPO_ROOT, opts.nextActionsPath || NEXT_ACTIONS_REPORT),
      next_actions_markdown_path: path.relative(REPO_ROOT, opts.nextActionsMarkdownPath || NEXT_ACTIONS_MARKDOWN)
    };
    process.stdout.write(`${JSON.stringify(planned, null, 2)}\n`);
    return 0;
  }

  fs.mkdirSync(path.dirname(opts.outputPath || LATEST_REPORT), { recursive: true });
  const crawler = spawnSync(process.execPath, crawlerArgs, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8'
  });

  const reducer = crawler.status === 0
    ? spawnSync(process.execPath, reducerArgs, { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' })
    : { status: -1, stdout: '', stderr: 'crawler failed; reducer skipped' };

  const record = buildRunRecord({
    startedAt,
    durationMs: Date.now() - startMs,
    crawler,
    reducer,
    reportPath: opts.outputPath || LATEST_REPORT,
    nextActionsPath: opts.nextActionsPath || NEXT_ACTIONS_REPORT,
    nextActionsMarkdownPath: opts.nextActionsMarkdownPath || NEXT_ACTIONS_MARKDOWN
  });
  writeRunRecord(record);

  process.stdout.write(`[run-harness-capability-crawler] ts=${record.ts} exit=${record.exit_code} report=${record.report_path} next=${record.next_actions_path}\n`);
  if (record.crawler_stderr_preview) process.stderr.write(record.crawler_stderr_preview);
  if (record.reducer_stderr_preview) process.stderr.write(record.reducer_stderr_preview);
  return record.exit_code;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run')
  };
}

if (require.main === module) {
  process.exit(run(parseArgs(process.argv.slice(2))));
}

module.exports = {
  buildCrawlerArgs,
  buildReducerArgs,
  buildRunRecord,
  parseArgs,
  preview,
  run,
  stamp,
  writeRunRecord,
  REPO_ROOT,
  STATE_DIR,
  LATEST_REPORT,
  NEXT_ACTIONS_REPORT
};
