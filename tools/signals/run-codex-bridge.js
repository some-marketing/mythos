#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  runCodexForSignal,
  selectCodexTargetSignalStrict
} = require('./lib/codex-auto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendExecLog(message) {
  const logPath = path.join(PROJECT_ROOT, '_dev', 'logs', 'codex-exec-live.log');
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

function appendArchiveEntry(entry) {
  const logPath = path.join(PROJECT_ROOT, '_dev', 'logs', 'archive.jsonl');
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function help() {
  console.log(`
Run Codex non-interactively for the latest live Codex-targeted coordination signal.

Usage:
  node tools/signals/run-codex-bridge.js [options]

Options:
  --file <name>   Consume a specific live signal file from _dev/reports/signals/
  --model <name>  Optional Codex model override
  --dry-run       Print the command/artifacts without launching Codex
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

  const selection = selectCodexTargetSignalStrict(PROJECT_ROOT, args.file || '');
  if (!selection.signal) {
    if (Boolean(args.json)) {
      console.log(JSON.stringify({
        mode: 'blocked',
        error: selection.error,
        reason: selection.reason,
        candidates: selection.candidates,
        candidate_names: selection.candidateNames
      }, null, 2));
    } else {
      console.error(`Blocked: ${selection.reason}`);
      if (selection.error === 'ambiguous') {
        console.error('Pass --file <signal.json> to disambiguate. Live candidates above.');
      }
    }
    process.exit(1);
  }
  const signalInfo = selection.signal;

  const result = await runCodexForSignal(PROJECT_ROOT, signalInfo, {
    dryRun: Boolean(args.dry_run),
    model: args.model || ''
  });

  if (!result || typeof result !== 'object') {
    if (Boolean(args.json)) {
      console.log(JSON.stringify({ mode: 'error', reason: 'runCodexForSignal returned falsy or non-object', signal_name: signalInfo.name }, null, 2));
    } else {
      console.error('runCodexForSignal returned falsy or non-object result');
    }
    process.exit(1);
  }

  if (result.mode === 'skipped') {
    if (Boolean(args.json)) {
      console.log(JSON.stringify({ mode: 'skipped', reason: result.reason, signal_name: result.signalName }, null, 2));
    } else {
      console.log(`Skipped signal ${result.signalName}: ${result.reason}`);
    }
    process.exit(0);
  }

  if (Boolean(args.json)) {
    console.log(JSON.stringify({
      mode: result.mode,
      outcome: result.outcome || null,
      success: result.success,
      exit_code: result.exitCode,
      signal_name: signalInfo.name,
      source_signal_path: signalInfo.filePath ? path.relative(PROJECT_ROOT, signalInfo.filePath) : '',
      scope: signalInfo.signal ? (signalInfo.signal.scope || signalInfo.signal.signal_scope || '') : '',
      signal_type: signalInfo.signal ? (signalInfo.signal.signal_type || '') : '',
      recommended_next_actor: signalInfo.signal ? (signalInfo.signal.recommended_next_actor || '') : '',
      recommended_next_command: signalInfo.signal ? (signalInfo.signal.recommended_next_command || '') : '',
      prompt_path: result.promptPath ? path.relative(PROJECT_ROOT, result.promptPath) : '',
      completion_report_path: result.completionReportPath ? path.relative(PROJECT_ROOT, result.completionReportPath) : '',
      completion_signal_path: result.completionSignalPath ? path.relative(PROJECT_ROOT, result.completionSignalPath) : '',
      run_result_path: result.runResultPath ? path.relative(PROJECT_ROOT, result.runResultPath) : '',
      lessons_path: result.lessonsPath ? path.relative(PROJECT_ROOT, result.lessonsPath) : '',
      lessons_reconciliation_signal_path: result.lessonsReconciliationSignalPath
        ? path.relative(PROJECT_ROOT, result.lessonsReconciliationSignalPath)
        : '',
      closed_source_path: result.closedSourcePath ? path.relative(PROJECT_ROOT, result.closedSourcePath) : '',
      closeout_coherent: result.closeoutCoherence ? result.closeoutCoherence.coherent : null,
      closeout_warnings: result.closeoutCoherence ? result.closeoutCoherence.warnings : []
    }, null, 2));
    return;
  }

  if (result.mode === 'dry-run') {
    console.log(`Dry run for signal: ${signalInfo.name}`);
    console.log(`Command: ${result.commandLine}`);
    console.log(`Prompt artifact: ${path.relative(PROJECT_ROOT, result.promptPath)}`);
    if (result.executionOptions) {
      console.log(`Approval mode: ${result.executionOptions.approvalMode}`);
    }
    appendExecLog(`dry-run scope=${signalInfo.signal ? signalInfo.signal.scope : 'unknown'} signal=${signalInfo.name}`);
    return;
  }

  const scope = signalInfo.signal ? (signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general') : 'general';
  const reportRelPath = result.completionReportPath ? path.relative(PROJECT_ROOT, result.completionReportPath) : '';

  console.log(`Consumed signal: ${signalInfo.name}`);
  console.log(`Outcome: ${result.outcome}`);
  console.log(`Completion report: ${reportRelPath}`);
  console.log(`Run result: ${result.runResultPath ? path.relative(PROJECT_ROOT, result.runResultPath) : ''}`);
  console.log(`Completion signal: ${result.completionSignalPath ? path.relative(PROJECT_ROOT, result.completionSignalPath) : ''}`);
  console.log(`Lessons updated: ${result.lessonsPath ? path.relative(PROJECT_ROOT, result.lessonsPath) : ''}`);
  if (result.lessonsReconciliationSignalPath) {
    console.log(`Lessons reconciliation signal: ${path.relative(PROJECT_ROOT, result.lessonsReconciliationSignalPath)}`);
  }
  console.log(`Closed source signal: ${result.closedSourcePath ? path.relative(PROJECT_ROOT, result.closedSourcePath) : ''}`);
  console.log(`Exit code: ${result.exitCode}`);
  if (result.closeoutCoherence && !result.closeoutCoherence.coherent) {
    console.log(`Closeout warnings: ${result.closeoutCoherence.warnings.join('; ')}`);
  }

  // Log to codex-exec-live.log and archive.jsonl
  appendExecLog(`scope=${scope} outcome=${result.outcome} exit=${result.exitCode} artifact=${reportRelPath}`);
  appendArchiveEntry({
    ts: new Date().toISOString(),
    event: 'codex.bridge.run',
    scope,
    outcome: result.outcome,
    exit_code: result.exitCode,
    artifact_path: reportRelPath,
    signal_name: signalInfo.name,
    operator: 'signals:codex-run',
    dry_run: false
  });
}

main().catch(err => { console.error(err.message); process.exit(1); });
