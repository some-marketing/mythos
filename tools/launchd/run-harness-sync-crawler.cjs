#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = '/Users/admin/dev/Mythos-recovered';
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'harness-sync-crawler');
const RUNS_LOG = path.join(STATE_DIR, 'runs.jsonl');
const LATEST_REPORT = path.join(REPO_ROOT, '_dev', 'reports', 'analysis', 'harness-sync-crawler__launchd-latest.json');

function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

function preview(text, max = 4000) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

function buildCrawlerArgs(opts = {}) {
  const args = [
    path.join(REPO_ROOT, 'tools', 'instructions', 'harness-sync-crawler.js'),
    '--apply',
    '--include-claude',
    '--output',
    opts.outputPath || LATEST_REPORT
  ];
  if (opts.json) args.push('--json');
  return args;
}

function buildRunRecord({ startedAt, durationMs, child, reportPath = LATEST_REPORT }) {
  const exitCode = child.status == null ? -1 : child.status;
  return {
    schema: 'HarnessSyncCrawlerLaunchdRun/1.0',
    ts: startedAt,
    exit_code: exitCode,
    duration_s: Math.round(durationMs / 1000),
    report_path: path.relative(REPO_ROOT, reportPath),
    stdout_preview: preview(child.stdout || ''),
    stderr_preview: preview(child.stderr || ''),
    success: exitCode === 0
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
  const args = buildCrawlerArgs(opts);

  if (opts.dryRun) {
    const planned = {
      schema: 'HarnessSyncCrawlerLaunchdDryRun/1.0',
      ts: startedAt,
      command: [process.execPath, ...args],
      cwd: REPO_ROOT,
      state_dir: path.relative(REPO_ROOT, STATE_DIR),
      report_path: path.relative(REPO_ROOT, opts.outputPath || LATEST_REPORT)
    };
    process.stdout.write(`${JSON.stringify(planned, null, 2)}\n`);
    return 0;
  }

  fs.mkdirSync(path.dirname(opts.outputPath || LATEST_REPORT), { recursive: true });
  const child = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8'
  });

  const record = buildRunRecord({
    startedAt,
    durationMs: Date.now() - startMs,
    child,
    reportPath: opts.outputPath || LATEST_REPORT
  });
  writeRunRecord(record);

  process.stdout.write(`[run-harness-sync-crawler] ts=${record.ts} exit=${record.exit_code} report=${record.report_path}\n`);
  if (record.stderr_preview) process.stderr.write(record.stderr_preview);
  return record.exit_code;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    json: argv.includes('--json')
  };
}

if (require.main === module) {
  process.exit(run(parseArgs(process.argv.slice(2))));
}

module.exports = {
  buildCrawlerArgs,
  buildRunRecord,
  parseArgs,
  preview,
  run,
  stamp,
  writeRunRecord,
  REPO_ROOT,
  STATE_DIR,
  RUNS_LOG,
  LATEST_REPORT
};
