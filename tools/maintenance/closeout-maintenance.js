#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const { analyzeAndApplyCloseoutMaintenance } = require('./lib/closeout-maintenance');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Run deterministic closeout maintenance, archive-only cleanup, and actor dispatch for unresolved issues.

Usage:
  node tools/maintenance/closeout-maintenance.js [options]

Options:
  --scope <scope>     Optional scope passed to verify-artifact-completeness
  --execute           Apply low-risk maintenance actions
  --age <days>        Archive threshold for analysis artifacts (default: 7)
  --no-dispatch       Do not emit a maintenance coordination signal
  --json              Print the report JSON
  --help              Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const report = analyzeAndApplyCloseoutMaintenance(PROJECT_ROOT, {
    execute: Boolean(args.execute),
    scope: args.scope || 'latest',
    ageDays: Number(args.age || '7'),
    emitDispatch: !Boolean(args.no_dispatch)
  });

  if (Boolean(args.json)) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Closeout maintenance: ${report.clearance}`);
  console.log(`Conditions: ${report.conditions.length}`);
  console.log(`Auto actions: ${report.auto_actions.length}`);
  console.log(`Unresolved: ${report.unresolved_conditions.length}`);
  console.log(`Report: ${path.relative(PROJECT_ROOT, report.report_paths.markdownPath)}`);
  if (report.dispatches.length > 0) {
    console.log(`Dispatch: ${report.dispatches[0].actor} -> ${report.dispatches[0].signal_path}`);
  }
}

main();
