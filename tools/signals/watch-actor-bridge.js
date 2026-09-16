#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  listRunnableActorSignals,
  runActorForSignal
} = require('./lib/actor-auto');
const { detectInstalledActors } = require('./lib/actor-registry');
const { createWatcherReadiness } = require('./lib/watcher-ready.cjs');

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

async function main(deps = {}) {
  const projectRoot = deps.projectRoot || PROJECT_ROOT;
  const processRef = deps.process || process;
  const parse = deps.parseArgs || parseArgs;
  const detectActors = deps.detectInstalledActors || detectInstalledActors;
  const listSignals = deps.listRunnableActorSignals || listRunnableActorSignals;
  const runSignal = deps.runActorForSignal || runActorForSignal;
  const args = parse(deps.argv || processRef.argv);
  if (args.help || args.h) {
    help();
    return;
  }

  const once = Boolean(args.once);
  const dryRun = Boolean(args.dry_run);
  const actorFilter = String(args.actor || '').trim().toLowerCase();
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    throw new Error('--interval-seconds must be a positive number');
  }

  const discoverSignals = () => {
    const runtimes = detectActors();
    return listSignals(projectRoot, { runtimes })
      .filter((info) => !actorFilter || String(info.signal.recommended_next_actor || '').toLowerCase() === actorFilter);
  };
  const readiness = deps.readiness || createWatcherReadiness('watch-actor-bridge', { process: processRef });
  if (readiness.managed) {
    discoverSignals();
    await readiness.prepareAndWait();
  }

  do {
    const signals = discoverSignals();
    const next = signals[0] || null;

    if (!next) {
      console.log(`[${new Date().toISOString()}] No live actor-targeted coordination signal found.`);
    } else {
      const actorId = String(next.signal.recommended_next_actor || '').toLowerCase();
      const result = await runSignal(projectRoot, next, {
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
        console.log(`Completion signal: ${path.relative(projectRoot, result.completionSignalPath)}`);
      }
    }

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
