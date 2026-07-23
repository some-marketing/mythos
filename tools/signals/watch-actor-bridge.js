#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  listRunnableActorSignals,
  runActorForSignal
} = require('./lib/actor-auto');
const { detectInstalledActors } = require('./lib/actor-registry');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INTERVAL_SECONDS = 120;

function help() {
  console.log(`
Poll for live actor-targeted coordination signals and launch the recommended harness automatically.

Usage:
  node tools/signals/watch-actor-bridge.js [options]

Options:
  --once                  Poll once and exit
  --actor <id>            Restrict to one actor (codex, claude, opencode)
  --interval-seconds <n>  Poll interval in seconds (default: ${DEFAULT_INTERVAL_SECONDS})
  --model <name>          Optional model override
  --dry-run               Do not launch the actor; print what would run
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
  const actorFilter = String(args.actor || '').trim().toLowerCase();
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    process.exit(1);
  }

  do {
    const runtimes = detectInstalledActors();
    const signals = listRunnableActorSignals(PROJECT_ROOT, { runtimes })
      .filter((info) => !actorFilter || String(info.signal.recommended_next_actor || '').toLowerCase() === actorFilter);
    const next = signals[0] || null;

    if (!next) {
      console.log(`[${new Date().toISOString()}] No live actor-targeted coordination signal found.`);
    } else {
      const actorId = String(next.signal.recommended_next_actor || '').toLowerCase();
      const result = await runActorForSignal(PROJECT_ROOT, next, {
        actor: actorId,
        dryRun,
        model: args.model || ''
      });

      if (result.mode === 'skipped') {
        console.log(`[${new Date().toISOString()}] Skipped ${next.name}: ${result.reason}`);
      } else if (dryRun) {
        console.log(`Dry-run target: ${next.name}`);
        console.log(`Actor: ${actorId}`);
        console.log(`Command: ${result.commandLine}`);
      } else {
        console.log(`Ran ${actorId} for: ${next.name}`);
        console.log(`Outcome: ${result.outcome}`);
        console.log(`Completion signal: ${path.relative(PROJECT_ROOT, result.completionSignalPath)}`);
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
