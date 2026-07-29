#!/usr/bin/env node
'use strict';

/**
 * watch-workstream-loop.js — Watch coordination signals for a bounded side workstream.
 *
 * Filters by signal_scope and recommends the next command in the
 * review -> plan -> advance loop, just like watch-pipeline-loop.js
 * does for the main pipeline.
 *
 * Usage:
 *   node tools/signals/watch-workstream-loop.js --scope <signal_scope> [--once] [--json] [--interval-seconds <n>]
 *
 * Examples:
 *   node tools/signals/watch-workstream-loop.js --scope simpleminions-routing-integration --once
 *   node tools/signals/watch-workstream-loop.js --scope simpleminions-routing-integration --json --once
 */

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  buildWorkstreamDirective,
  buildWorkstreamState,
  deriveWorkstreamRecommendation,
  formatWorkstreamStatus
} = require('./lib/workstream-loop');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INTERVAL_SECONDS = 120;

function help() {
  console.log(`
Watch coordination signals for a bounded side workstream.

Usage:
  node tools/signals/watch-workstream-loop.js --scope <signal_scope> [options]

Options:
  --scope <name>          Required. The signal_scope to filter on.
  --once                  Print one snapshot and exit.
  --interval-seconds <n>  Poll interval in seconds (default: ${DEFAULT_INTERVAL_SECONDS}).
  --json                  Print machine-readable JSON instead of text.
  --help                  Show this help.

Loop model (same as main pipeline):
  1. New live signal from Claude   -> /review-progress
  2. Review says planning is stale -> /plan-pipeline
  3. Fresh planning artifact       -> advance the workstream

Handoff contract:
  Every coordination signal for a workstream must include:
  - signal_scope: the workstream's stable scope identifier
  - artifacts: array of changed file paths
  - validation: { ran: boolean, summary: string }
  - recommended_next_actor: who should act next
  - recommended_next_command: the exact next command
  - blocked_by: array of blockers (empty if unblocked)
`.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSnapshot(signalScope) {
  const state = buildWorkstreamState(PROJECT_ROOT, signalScope);
  const recommendation = deriveWorkstreamRecommendation(state);
  return { state, recommendation };
}

function printSnapshot(signalScope, asJson) {
  const snapshot = buildSnapshot(signalScope);

  if (asJson) {
    const latestSignal = snapshot.recommendation.latest_signal;
    const payload = {
      polled_at: new Date().toISOString(),
      signal_scope: signalScope,
      scoped_signal_count: snapshot.state.scopedSignals.length,
      latest_scoped_signal: latestSignal ? {
        file: latestSignal.name,
        signal_type: latestSignal.signal.signal_type,
        source: latestSignal.signal.source,
        scope: latestSignal.signal.scope,
        signal_scope: latestSignal.signal.signal_scope,
        recommended_next_command: latestSignal.signal.recommended_next_command || ''
      } : null,
      recommended_next_command: snapshot.recommendation.command || '',
      reason: snapshot.recommendation.reason,
      blocked_by: snapshot.recommendation.blocked_by || [],
      claude_directive: buildWorkstreamDirective(snapshot.recommendation, signalScope)
    };
    console.log(JSON.stringify(payload, null, 2));
    return JSON.stringify(payload);
  }

  const text = formatWorkstreamStatus(snapshot.state, snapshot.recommendation);
  console.log(text);
  return text;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const signalScope = args.scope;
  if (!signalScope) {
    console.error('ERROR: --scope is required. Example: --scope simpleminions-routing-integration');
    process.exit(1);
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
    const output = printSnapshot(signalScope, asJson);
    if (!once && output === lastOutput && !asJson) {
      console.log('[unchanged] no new scoped signal since the previous poll');
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
