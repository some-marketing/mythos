#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  runActorForSignal,
  selectActorTargetSignal
} = require('./lib/actor-auto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Run the shared actor bridge for the latest live actor-targeted coordination signal.

Usage:
  node tools/signals/run-actor-bridge.js [options]

Options:
  --actor <id>    Restrict to one actor (codex, claude, opencode, opencode-local)
  --file <name>   Consume a specific live signal file from _dev/reports/signals/
  --model <name>  Optional model override
  --dry-run       Print the command/artifacts without launching the actor
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

  const actorId = args.actor || '';
  const signalInfo = selectActorTargetSignal(PROJECT_ROOT, actorId, args.file || '');
  if (!signalInfo) {
    console.error('No live actor-targeted coordination signal found.');
    process.exit(1);
  }

  const result = await runActorForSignal(PROJECT_ROOT, signalInfo, {
    actor: actorId,
    dryRun: Boolean(args.dry_run),
    model: args.model || ''
  });

  if (Boolean(args.json)) {
    console.log(JSON.stringify({
      mode: result.mode,
      actor: result.actor || actorId || signalInfo.signal.recommended_next_actor || '',
      outcome: result.outcome || null,
      success: result.success,
      exit_code: result.exitCode,
      reason: result.reason || '',
      prompt_path: result.promptPath ? path.relative(PROJECT_ROOT, result.promptPath) : '',
      completion_report_path: result.completionReportPath ? path.relative(PROJECT_ROOT, result.completionReportPath) : '',
      completion_signal_path: result.completionSignalPath ? path.relative(PROJECT_ROOT, result.completionSignalPath) : '',
      run_result_path: result.runResultPath ? path.relative(PROJECT_ROOT, result.runResultPath) : '',
      lessons_path: result.lessonsPath ? path.relative(PROJECT_ROOT, result.lessonsPath) : '',
      closed_source_path: result.closedSourcePath ? path.relative(PROJECT_ROOT, result.closedSourcePath) : '',
      closeout_coherent: result.closeoutCoherence ? result.closeoutCoherence.coherent : null,
      closeout_warnings: result.closeoutCoherence ? result.closeoutCoherence.warnings : []
    }, null, 2));
    return;
  }

  if (result.mode === 'dry-run') {
    console.log(`Dry run for signal: ${signalInfo.name}`);
    console.log(`Actor: ${result.actor || actorId || signalInfo.signal.recommended_next_actor}`);
    console.log(`Command: ${result.commandLine}`);
    console.log(`Prompt artifact: ${path.relative(PROJECT_ROOT, result.promptPath)}`);
    return;
  }

  if (result.mode === 'skipped') {
    console.log(`Skipped signal ${signalInfo.name}: ${result.reason}`);
    return;
  }

  console.log(`Consumed signal: ${signalInfo.name}`);
  console.log(`Actor: ${result.actor}`);
  console.log(`Outcome: ${result.outcome}`);
  console.log(`Completion report: ${path.relative(PROJECT_ROOT, result.completionReportPath)}`);
  console.log(`Run result: ${path.relative(PROJECT_ROOT, result.runResultPath)}`);
  console.log(`Completion signal: ${path.relative(PROJECT_ROOT, result.completionSignalPath)}`);
  console.log(`Closed source signal: ${path.relative(PROJECT_ROOT, result.closedSourcePath)}`);
  if (result.lessonsReconciliationSignalPath) {
    console.log(`Lessons reconciliation signal: ${path.relative(PROJECT_ROOT, result.lessonsReconciliationSignalPath)}`);
  }
  if (result.closeoutCoherence && !result.closeoutCoherence.coherent) {
    console.log(`Closeout warnings: ${result.closeoutCoherence.warnings.join('; ')}`);
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
