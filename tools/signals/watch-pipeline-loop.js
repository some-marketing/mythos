#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  buildClaudeDirective,
  buildLoopState,
  deriveLoopRecommendation,
  formatLoopStatus
} = require('./lib/pipeline-loop');
const { createWatcherReadiness } = require('./lib/watcher-ready.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INTERVAL_SECONDS = 120;

function help() {
  console.log(`
Watch the Mythos coordination-signal surface and summarize the recommended pipeline loop.

Usage:
  node tools/signals/watch-pipeline-loop.js [--once] [--interval-seconds <n>] [--json]

Options:
  --once                  Print one recommendation snapshot and exit
  --interval-seconds <n>  Poll interval in seconds (default: ${DEFAULT_INTERVAL_SECONDS})
  --json                  Print machine-readable JSON instead of text
  --help                  Show this help

Loop model:
  1. New live Claude completion signal -> /review-progress advance-pipeline
  2. Review says planning is stale     -> /plan-pipeline
  3. Fresh planning artifact           -> /advance-pipeline
  4. Master pipeline complete          -> /review-active-workstreams
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSnapshot(deps = {}) {
  const projectRoot = deps.projectRoot || PROJECT_ROOT;
  const buildState = deps.buildLoopState || buildLoopState;
  const deriveRecommendation = deps.deriveLoopRecommendation || deriveLoopRecommendation;
  const state = buildState(projectRoot);
  const recommendation = deriveRecommendation(state);
  return { state, recommendation };
}

function printSnapshot(asJson, deps = {}, preparedSnapshot, usePreparedSnapshot = false) {
  const snapshot = usePreparedSnapshot ? preparedSnapshot : buildSnapshot(deps);
  const log = deps.log || console.log;
  const buildDirective = deps.buildClaudeDirective || buildClaudeDirective;
  const formatStatus = deps.formatLoopStatus || formatLoopStatus;
  if (asJson) {
    const latestSignal = snapshot.recommendation.latest_signal;
    const payload = {
      polled_at: new Date().toISOString(),
      live_signal_count: snapshot.state.liveSignals.length,
      latest_live_signal: latestSignal ? {
        file: latestSignal.name,
        signal_type: latestSignal.signal.signal_type,
        source: latestSignal.signal.source,
        scope: latestSignal.signal.scope,
        recommended_next_command: latestSignal.signal.recommended_next_command || ''
      } : null,
      recommended_next_command: snapshot.recommendation.command || '',
      reason: snapshot.recommendation.reason,
      blocked_by: snapshot.recommendation.blocked_by || [],
      claude_directive: buildDirective(snapshot.recommendation)
    };
    log(JSON.stringify(payload, null, 2));
    return JSON.stringify(payload);
  }

  const text = formatStatus(snapshot.state, snapshot.recommendation);
  log(text);
  return text;
}

async function main(deps = {}) {
  const processRef = deps.process || process;
  const parse = deps.parseArgs || parseArgs;
  const log = deps.log || console.log;
  const args = parse(deps.argv || processRef.argv);
  if (args.help || args.h) {
    help();
    return;
  }

  const once = Boolean(args.once);
  const asJson = Boolean(args.json);
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    throw new Error('--interval-seconds must be a positive number');
  }

  const readiness = deps.readiness || createWatcherReadiness('watch-pipeline-loop', { process: processRef });
  let firstManagedSnapshot;
  let hasFirstManagedSnapshot = false;
  if (readiness.managed) {
    buildSnapshot(deps);
    firstManagedSnapshot = await readiness.prepareAndCommit(() => buildSnapshot(deps));
    hasFirstManagedSnapshot = true;
  }

  let lastOutput = '';
  do {
    const output = printSnapshot(asJson, deps, firstManagedSnapshot, hasFirstManagedSnapshot);
    hasFirstManagedSnapshot = false;
    if (!once && output === lastOutput && !asJson) {
      log('[unchanged] no new signal or planning transition since the previous poll');
    }
    lastOutput = output;

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { buildSnapshot, printSnapshot, main };
