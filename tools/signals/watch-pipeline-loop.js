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

function buildSnapshot() {
  const state = buildLoopState(PROJECT_ROOT);
  const recommendation = deriveLoopRecommendation(state);
  return { state, recommendation };
}

function printSnapshot(asJson) {
  const snapshot = buildSnapshot();
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
      claude_directive: buildClaudeDirective(snapshot.recommendation)
    };
    console.log(JSON.stringify(payload, null, 2));
    return JSON.stringify(payload);
  }

  const text = formatLoopStatus(snapshot.state, snapshot.recommendation);
  console.log(text);
  return text;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const once = Boolean(args.once);
  const asJson = Boolean(args.json);
  const intervalSeconds = Number(args.interval_seconds || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    console.error('ERROR: --interval-seconds must be a positive number');
    process.exit(1);
  }

  let lastOutput = '';
  do {
    const output = printSnapshot(asJson);
    if (!once && output === lastOutput && !asJson) {
      console.log('[unchanged] no new signal or planning transition since the previous poll');
    }
    lastOutput = output;

    if (once) break;
    await sleep(intervalSeconds * 1000);
  } while (true);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
