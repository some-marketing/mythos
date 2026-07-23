#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  DEFAULT_INTERVAL_SECONDS,
  readListenerStatus,
  startCodexListener,
  stopCodexListener
} = require('./lib/codex-listener');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Manage the Codex watcher listener lifecycle.

Usage:
  node tools/signals/manage-codex-listener.js <start|stop|status> [options]

Options:
  --interval-seconds <n>  Poll interval when starting (default: ${DEFAULT_INTERVAL_SECONDS})
  --model <name>          Optional Codex model override when starting
  --json                  Print machine-readable output
  --help                  Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  const action = String(args._[0] || '').trim().toLowerCase();

  if (args.help || args.h || !action) {
    help();
    process.exit(action ? 0 : 1);
  }

  let result;
  if (action === 'start') {
    result = startCodexListener(PROJECT_ROOT, {
      intervalSeconds: args.interval_seconds || DEFAULT_INTERVAL_SECONDS,
      model: args.model || ''
    });
  } else if (action === 'stop') {
    result = stopCodexListener(PROJECT_ROOT);
  } else if (action === 'status') {
    result = readListenerStatus(PROJECT_ROOT);
  } else {
    console.error(`Unknown action: ${action}`);
    help();
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (action === 'start') {
    if (result.alreadyActive) {
      console.log(`Codex listener already active (pid ${result.pid}).`);
    } else {
      console.log(`Started Codex listener (pid ${result.pid}).`);
    }
    console.log(`Status: ${path.relative(PROJECT_ROOT, result.statusPath)}`);
    return;
  }

  if (action === 'stop') {
    if (!result.stopped) {
      console.log('Codex listener status file not found.');
    } else {
      console.log(`Stopped Codex listener${result.pid ? ` (pid ${result.pid})` : ''}.`);
      console.log(`Status: ${path.relative(PROJECT_ROOT, result.statusPath)}`);
    }
    return;
  }

  if (!result.exists) {
    console.log('Codex listener is not configured.');
    console.log(`Status path: ${path.relative(PROJECT_ROOT, result.statusPath)}`);
    return;
  }

  console.log(`Codex listener active: ${result.active ? 'yes' : 'no'}`);
  if (result.pid) {
    console.log(`PID: ${result.pid}`);
  }
  console.log(`Status: ${path.relative(PROJECT_ROOT, result.statusPath)}`);
  if (result.data && result.data.log_path) {
    console.log(`Log: ${result.data.log_path}`);
  }
}

main();
