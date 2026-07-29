#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const { analyzeAndApplyCloseoutMaintenance } = require('./lib/closeout-maintenance');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Preview current closeout maintenance status without applying changes.

Usage:
  node tools/maintenance/status.js [options]

Options:
  --scope <scope>   Optional scope passed to verify-artifact-completeness
  --age <days>      Archive threshold for analysis artifacts (default: 7)
  --json            Print the report JSON
  --help            Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const report = analyzeAndApplyCloseoutMaintenance(PROJECT_ROOT, {
    execute: false,
    scope: args.scope || 'latest',
    ageDays: Number(args.age || '7'),
    emitDispatch: false
  });

  if (Boolean(args.json)) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Closeout maintenance status: ${report.clearance}`);
  console.log(`Conditions: ${report.conditions.length}`);
  console.log(`Auto-fixable: ${report.conditions.filter((condition) => condition.auto_fixable).length}`);
  console.log(`Report: ${path.relative(PROJECT_ROOT, report.report_paths.markdownPath)}`);
}

main();
