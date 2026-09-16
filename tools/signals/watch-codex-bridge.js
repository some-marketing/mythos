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
const { createWatcherReadiness } = require('./lib/watcher-ready.cjs');

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

function watchLogPath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, '_dev', 'logs', 'codex-watch.log');
}

function appendWatchLog(message, projectRoot = PROJECT_ROOT, fsImpl = fs) {
  const logPath = watchLogPath(projectRoot);
  fsImpl.mkdirSync(path.dirname(logPath), { recursive: true });
  fsImpl.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

function writeRunningStatus(intervalSeconds, projectRoot = PROJECT_ROOT, fsImpl = fs, writeStatus = writeListenerStatus) {
  const now = new Date().toISOString();
  const statusDir = path.dirname(statusPathFor(projectRoot));
  fsImpl.mkdirSync(statusDir, { recursive: true });
  writeStatus(projectRoot, {
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

function writeStoppedStatus(projectRoot = PROJECT_ROOT, fsImpl = fs, writeStatus = writeListenerStatus) {
  const statusPath = statusPathFor(projectRoot);
  let data = {};
  if (fsImpl.existsSync(statusPath)) {
    try { data = JSON.parse(fsImpl.readFileSync(statusPath, 'utf8')); } catch { /* ignore */ }
  }
  data.status = 'stopped';
  data.active = false;
  data.stopped_at = new Date().toISOString();
  data.error = null;
  writeStatus(projectRoot, data);
}

async function main(deps = {}) {
  const projectRoot = deps.projectRoot || PROJECT_ROOT;
  const fsImpl = deps.fs || fs;
  const processRef = deps.process || process;
  const parse = deps.parseArgs || parseArgs;
  const listSignals = deps.listCodexTargetSignals || listCodexTargetSignals;
  const runSignal = deps.runCodexForSignal || runCodexForSignal;
  const updatePoll = deps.updateListenerPoll || updateListenerPoll;
  const writeStatus = deps.writeListenerStatus || writeListenerStatus;
  const readBridgeStatus = deps.readBridgeStatus || (() => {
    const bridgeStatus = require('../status/bridge-status');
    return bridgeStatus.readLatestSnapshot(projectRoot);
  });
  const args = parse(deps.argv || processRef.argv);
  if (args.help || args.h) {
    help();
    return;
  }

  const once = Boolean(args.once);
  const dryRun = Boolean(args.dry_run);
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    throw new Error('--interval-seconds must be a positive number');
  }

  // Write running status on start
  writeRunningStatus(intervalSeconds, projectRoot, fsImpl, writeStatus);
  appendWatchLog(`Watcher started (pid=${processRef.pid}, interval=${intervalSeconds}s, once=${once})`, projectRoot, fsImpl);

  // Ensure stopped status is written on clean exit
  processRef.on('SIGTERM', () => {
    writeStoppedStatus(projectRoot, fsImpl, writeStatus);
    appendWatchLog('Watcher stopped (SIGTERM)', projectRoot, fsImpl);
    processRef.exit(0);
  });
  processRef.on('SIGINT', () => {
    writeStoppedStatus(projectRoot, fsImpl, writeStatus);
    appendWatchLog('Watcher stopped (SIGINT)', projectRoot, fsImpl);
    processRef.exit(0);
  });

  const discoverTargets = () => {
    updatePoll(projectRoot);
    try {
      const latest = readBridgeStatus();
      if (latest && latest.summary) {
        appendWatchLog('Bridge status: ' + latest.summary.total_scopes + ' scopes, ' + latest.summary.active + ' active, ' + latest.summary.blocked + ' blocked', projectRoot, fsImpl);
      }
    } catch (_) { /* status read is informational */ }
    return listSignals(projectRoot);
  };

  const readiness = deps.readiness || createWatcherReadiness('watch-codex-bridge', { process: processRef });
  if (readiness.managed) {
    discoverTargets();
    await readiness.prepareAndWait();
  }

  do {
    const targets = discoverTargets();
    const next = targets[0] || null;

    if (next) {
      appendWatchLog(`Found target signal: ${next.name}`, projectRoot, fsImpl);
      const result = await runSignal(projectRoot, next, {
        dryRun,
        model: args.model || ''
      });

      if (result.mode === 'skipped') {
        console.log(`[${new Date().toISOString()}] Skipped ${next.name}: ${result.reason}`);
        appendWatchLog(`Skipped ${next.name}: ${result.reason}`, projectRoot, fsImpl);
      } else if (dryRun) {
        console.log(`Dry-run target: ${next.name}`);
        console.log(`Command: ${result.commandLine}`);
        if (result.executionOptions) {
          console.log(`Approval mode: ${result.executionOptions.approvalMode}`);
        }
        appendWatchLog(`Dry-run: ${next.name}`, projectRoot, fsImpl);
      } else {
        console.log(`Ran Codex for: ${next.name}`);
        console.log(`Outcome: ${result.outcome}`);
        console.log(`Completion signal: ${path.relative(projectRoot, result.completionSignalPath)}`);
        if (result.lessonsReconciliationSignalPath) {
          console.log(`Lessons reconciliation signal: ${path.relative(projectRoot, result.lessonsReconciliationSignalPath)}`);
        }
        appendWatchLog(`Ran Codex for ${next.name}: outcome=${result.outcome}`, projectRoot, fsImpl);
      }
    } else {
      console.log(`[${new Date().toISOString()}] No live Codex-targeted coordination signal found.`);
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);

  // Write stopped status on normal exit (--once mode)
  writeStoppedStatus(projectRoot, fsImpl, writeStatus);
  appendWatchLog('Watcher stopped (normal exit)', projectRoot, fsImpl);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`ERROR: ${err.message}`);
    writeListenerError(PROJECT_ROOT, err.message);
    appendWatchLog(`Watcher error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
