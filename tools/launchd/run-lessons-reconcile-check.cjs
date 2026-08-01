#!/usr/bin/env node
'use strict';

/**
 * run-lessons-reconcile-check.cjs — launchd entrypoint for the lessons lane.
 *
 * Runs the same-day session scan (tools/lessons/scan-session-data.js) and then
 * the reconciliation due-check with --emit (tools/lessons/check-reconciliation-due.cjs).
 * Bounded, idempotent, exits after one pass — launchd re-fires on StartInterval.
 *
 * Pattern cloned from run-harness-sync-crawler.cjs (the proven launchd shape
 * in this repo). Kill switch: _dev/state/lessons-reconcile/disabled.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '_dev', 'state', 'lessons-reconcile');
const RUNS_LOG = path.join(STATE_DIR, 'runs.jsonl');
const KILL_SWITCH = path.join(STATE_DIR, 'disabled');

function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

function preview(text, max = 4000) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

function runStep(label, args) {
  const started = Date.now();
  const child = spawnSync('node', args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 });
  return {
    label,
    exit_code: child.status == null ? -1 : child.status,
    duration_s: Math.round((Date.now() - started) / 1000),
    stdout_preview: preview(child.stdout || ''),
    stderr_preview: preview(child.stderr || '')
  };
}

function main() {
  if (fs.existsSync(KILL_SWITCH)) {
    process.exit(0); // silent, reversible disable
  }

  const startedAt = stamp();
  const steps = [];

  steps.push(runStep('session-scan', [
    path.join(REPO_ROOT, 'tools', 'lessons', 'scan-session-data.js'),
    '--date', 'today'
  ]));

  steps.push(runStep('reconcile-check', [
    path.join(REPO_ROOT, 'tools', 'lessons', 'check-reconciliation-due.cjs'),
    '--emit', '--json'
  ]));

  // L6 (convene 20260610T175230Z): actionable reconciliation findings flow to
  // next-session intake mechanically. Idempotent — routed state is tracked.
  steps.push(runStep('intake-routing', [
    path.join(REPO_ROOT, 'tools', 'lessons', 'route-reconciliation-intake.cjs'),
    '--json'
  ]));

  const record = {
    schema: 'LessonsReconcileLaunchdRun/1.0',
    ts: startedAt,
    success: steps.every((s) => s.exit_code === 0),
    steps
  };

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(RUNS_LOG, JSON.stringify(record) + '\n');
  capLogs();

  process.exit(record.success ? 0 : 1);
}

// Bounded growth: keep the run ledger to the last 200 records and truncate
// launchd's persistent stdout/stderr files past 1MB (no rotation machinery in
// launchd itself).
function capLogs() {
  try {
    if (fs.existsSync(RUNS_LOG) && fs.statSync(RUNS_LOG).size > 256 * 1024) {
      const lines = fs.readFileSync(RUNS_LOG, 'utf8').trimEnd().split('\n');
      fs.writeFileSync(RUNS_LOG, lines.slice(-200).join('\n') + '\n');
    }
    for (const name of ['launchd.stdout.log', 'launchd.stderr.log']) {
      const p = path.join(STATE_DIR, name);
      if (fs.existsSync(p) && fs.statSync(p).size > 1024 * 1024) {
        fs.truncateSync(p, 0);
      }
    }
  } catch {
    // log capping must never fail the run
  }
}

main();
