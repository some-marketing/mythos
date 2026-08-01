#!/usr/bin/env node
'use strict';

/**
 * run-gemini-bridge.js
 *
 * Thin wrapper that delegates to the shared actor bridge with actor='gemini'.
 * Mirrors run-actor-bridge.js shape but pre-binds the actor so dispatch-bridge.js
 * can spawn it directly without an --actor flag.
 *
 * Per task plan bridge-gemini-runner: flips Gemini from unsupported:true to a
 * first-class dispatch-bridge target. The shared actor lib (tools/signals/lib/actor-auto.js)
 * holds the gemini-specific spawn options; this file is the public CLI.
 */

const path = require('path');
const { parseArgs } = require('../workspace/lib/args');
const {
  runActorForSignal,
  selectActorTargetSignal
} = require('./lib/actor-auto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ACTOR_ID = 'gemini';

function help() {
  console.log(`
Run Gemini non-interactively for the latest live Gemini-targeted coordination signal.

Usage:
  node tools/signals/run-gemini-bridge.js [options]

Options:
  --file <name>   Consume a specific live signal file from _dev/reports/signals/
  --model <name>  Optional Gemini model override
  --dry-run       Print the command/artifacts without launching Gemini
  --json          Print machine-readable output
  --help          Show this help
`.trim());
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const signalInfo = selectActorTargetSignal(PROJECT_ROOT, ACTOR_ID, args.file || '');
  if (!signalInfo) {
    console.error('No live Gemini-targeted coordination signal found.');
    process.exit(1);
  }

  const result = await runActorForSignal(PROJECT_ROOT, signalInfo, {
    actor: ACTOR_ID,
    dryRun: Boolean(args.dry_run),
    model: args.model || ''
  });

  if (Boolean(args.json)) {
    console.log(JSON.stringify({
      mode: result.mode,
      actor: ACTOR_ID,
      outcome: result.outcome || null,
      success: result.success,
      exit_code: result.exitCode,
      reason: result.reason || '',
      prompt_path: result.promptPath ? path.relative(PROJECT_ROOT, result.promptPath) : '',
      completion_report_path: result.completionReportPath ? path.relative(PROJECT_ROOT, result.completionReportPath) : '',
      completion_signal_path: result.completionSignalPath ? path.relative(PROJECT_ROOT, result.completionSignalPath) : '',
      run_result_path: result.runResultPath ? path.relative(PROJECT_ROOT, result.runResultPath) : '',
      lessons_path: result.lessonsPath ? path.relative(PROJECT_ROOT, result.lessonsPath) : '',
      closed_source_path: result.closedSourcePath ? path.relative(PROJECT_ROOT, result.closedSourcePath) : ''
    }, null, 2));
    return;
  }

  if (result.mode === 'dry-run') {
    console.log(`Dry run for signal: ${signalInfo.name}`);
    console.log(`Actor: ${ACTOR_ID}`);
    console.log(`Command: ${result.commandLine}`);
    console.log(`Prompt artifact: ${path.relative(PROJECT_ROOT, result.promptPath)}`);
    return;
  }

  if (result.mode === 'skipped') {
    console.log(`Skipped signal ${signalInfo.name}: ${result.reason}`);
    return;
  }

  console.log(`Consumed signal: ${signalInfo.name}`);
  console.log(`Actor: ${ACTOR_ID}`);
  console.log(`Outcome: ${result.outcome}`);
  if (result.completionReportPath) {
    console.log(`Completion report: ${path.relative(PROJECT_ROOT, result.completionReportPath)}`);
  }
  if (result.runResultPath) {
    console.log(`Run result: ${path.relative(PROJECT_ROOT, result.runResultPath)}`);
  }
  if (result.completionSignalPath) {
    console.log(`Completion signal: ${path.relative(PROJECT_ROOT, result.completionSignalPath)}`);
  }
  if (result.closedSourcePath) {
    console.log(`Closed source signal: ${path.relative(PROJECT_ROOT, result.closedSourcePath)}`);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
