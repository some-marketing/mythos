#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  listCodexTargetSignals,
  runCodexForSignal
} = require('./lib/codex-auto');
const {
  statusPathFor,
  writeListenerStatus,
  updateListenerPoll,
  writeListenerError,
  STATUS_SCHEMA
} = require('./lib/codex-listener');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INTERVAL_SECONDS = 120;

function help() {
  console.log(`
Poll for live Codex-targeted coordination signals and launch Codex automatically.

Usage:
  node tools/signals/watch-codex-bridge.js [options]

Options:
  --once                  Poll once and exit
  --interval-seconds <n>  Poll interval in seconds (default: ${DEFAULT_INTERVAL_SECONDS})
  --model <name>          Optional Codex model override
  --dry-run               Do not launch Codex; print what would run
  --help                  Show this help
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function watchLogPath() {
  return path.join(PROJECT_ROOT, '_dev', 'logs', 'codex-watch.log');
}

function appendWatchLog(message) {
  const logPath = watchLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

function writeRunningStatus(intervalSeconds) {
  const now = new Date().toISOString();
  const statusDir = path.dirname(statusPathFor(PROJECT_ROOT));
  fs.mkdirSync(statusDir, { recursive: true });
  writeListenerStatus(PROJECT_ROOT, {
    schema: STATUS_SCHEMA,
    listener: 'codex-watch',
    status: 'running',
    active: true,
    scope: 'codex-watch',
    pid: process.pid,
    started_at: now,
    stopped_at: null,
    last_poll_at: null,
    error: null,
    interval_seconds: intervalSeconds
  });
}

function writeStoppedStatus() {
  const statusPath = statusPathFor(PROJECT_ROOT);
  let data = {};
  if (fs.existsSync(statusPath)) {
    try { data = JSON.parse(fs.readFileSync(statusPath, 'utf8')); } catch { /* ignore */ }
  }
  data.status = 'stopped';
  data.active = false;
  data.stopped_at = new Date().toISOString();
  data.error = null;
  writeListenerStatus(PROJECT_ROOT, data);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const once = Boolean(args.once);
  const dryRun = Boolean(args.dry_run);
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    process.exit(1);
  }

  // Write running status on start
  writeRunningStatus(intervalSeconds);
  appendWatchLog(`Watcher started (pid=${process.pid}, interval=${intervalSeconds}s, once=${once})`);

  // Ensure stopped status is written on clean exit
  process.on('SIGTERM', () => {
    writeStoppedStatus();
    appendWatchLog('Watcher stopped (SIGTERM)');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    writeStoppedStatus();
    appendWatchLog('Watcher stopped (SIGINT)');
    process.exit(0);
  });

  do {
    // Update last_poll_at on each cycle
    updateListenerPoll(PROJECT_ROOT);

    // Read canonical bridge status for observability
    try {
      var bridgeStatus = require('../status/bridge-status');
      var latest = bridgeStatus.readLatestSnapshot(PROJECT_ROOT);
      if (latest && latest.summary) {
        appendWatchLog('Bridge status: ' + latest.summary.total_scopes + ' scopes, ' + latest.summary.active + ' active, ' + latest.summary.blocked + ' blocked');
      }
    } catch (_) { /* status read is informational */ }

    const targets = listCodexTargetSignals(PROJECT_ROOT);
    const next = targets[0] || null;

    if (next) {
      appendWatchLog(`Found target signal: ${next.name}`);
      const result = await runCodexForSignal(PROJECT_ROOT, next, {
        dryRun,
        model: args.model || ''
      });

      if (result.mode === 'skipped') {
        console.log(`[${new Date().toISOString()}] Skipped ${next.name}: ${result.reason}`);
        appendWatchLog(`Skipped ${next.name}: ${result.reason}`);
      } else if (dryRun) {
        console.log(`Dry-run target: ${next.name}`);
        console.log(`Command: ${result.commandLine}`);
        if (result.executionOptions) {
          console.log(`Approval mode: ${result.executionOptions.approvalMode}`);
        }
        appendWatchLog(`Dry-run: ${next.name}`);
      } else {
        console.log(`Ran Codex for: ${next.name}`);
        console.log(`Outcome: ${result.outcome}`);
        console.log(`Completion signal: ${path.relative(PROJECT_ROOT, result.completionSignalPath)}`);
        if (result.lessonsReconciliationSignalPath) {
          console.log(`Lessons reconciliation signal: ${path.relative(PROJECT_ROOT, result.lessonsReconciliationSignalPath)}`);
        }
        appendWatchLog(`Ran Codex for ${next.name}: outcome=${result.outcome}`);
      }
    } else {
      console.log(`[${new Date().toISOString()}] No live Codex-targeted coordination signal found.`);
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);

  // Write stopped status on normal exit (--once mode)
  writeStoppedStatus();
  appendWatchLog('Watcher stopped (normal exit)');
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  writeListenerError(PROJECT_ROOT, err.message);
  appendWatchLog(`Watcher error: ${err.message}`);
  process.exit(1);
});
