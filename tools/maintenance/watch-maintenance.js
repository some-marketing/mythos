#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const { analyzeAndApplyCloseoutMaintenance } = require('./lib/closeout-maintenance');
const { runActorForSignal, selectActorTargetSignal } = require('../signals/lib/actor-auto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INTERVAL_SECONDS = 300;

function help() {
  console.log(`
Poll closeout maintenance conditions, apply low-risk actions, and optionally auto-dispatch unresolved work.

Usage:
  node tools/maintenance/watch-maintenance.js [options]

Options:
  --once                  Run one cycle and exit
  --interval-seconds <n>  Poll interval in seconds (default: ${DEFAULT_INTERVAL_SECONDS})
  --scope <scope>         Optional scope passed to verify-artifact-completeness
  --age <days>            Archive threshold for analysis artifacts (default: 7)
  --dry-run               Preview only; do not apply changes
  --dispatch              Immediately run the emitted actor-targeted maintenance signal
  --help                  Show this help
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const once = Boolean(args.once);
  const dryRun = Boolean(args.dry_run);
  const dispatch = Boolean(args.dispatch);
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    process.exit(1);
  }

  do {
    const report = analyzeAndApplyCloseoutMaintenance(PROJECT_ROOT, {
      execute: !dryRun,
      scope: args.scope || 'latest',
      ageDays: Number(args.age || '7'),
      emitDispatch: true
    });

    console.log(`[${new Date().toISOString()}] maintenance=${report.clearance} unresolved=${report.unresolved_conditions.length}`);

    if (dispatch && report.dispatches.length > 0) {
      const signalName = path.basename(report.dispatches[0].signal_path);
      const signalInfo = selectActorTargetSignal(PROJECT_ROOT, report.dispatches[0].actor, signalName);
      if (signalInfo) {
        const result = await runActorForSignal(PROJECT_ROOT, signalInfo, {
          actor: report.dispatches[0].actor
        });
        console.log(`Dispatched ${report.dispatches[0].actor}: ${result.outcome || result.reason}`);
      }
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
