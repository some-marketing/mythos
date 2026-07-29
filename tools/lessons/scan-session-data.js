#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const {
  scanSessionData,
  writeSessionScanArtifacts
} = require('./lib/session-scan');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Scan same-day session artifacts and supporting context for lessons reconciliation.

Usage:
  node tools/lessons/scan-session-data.js [options]

Options:
  --date <YYYY-MM-DD|today|latest>  Target date to scan (default: today)
  --project <substring>             Optional project/path filter
  --json                            Print JSON to stdout
  --stdout-only                     Print results without writing analysis artifacts
  --help                            Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  let scan;
  try {
    scan = scanSessionData(PROJECT_ROOT, {
      date: args.date || 'today',
      project_filter: args.project || ''
    });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  let outputPaths = null;
  if (!Boolean(args.stdout_only)) {
    outputPaths = writeSessionScanArtifacts(PROJECT_ROOT, scan);
  }

  if (Boolean(args.json)) {
    console.log(JSON.stringify({
      ...scan,
      output_paths: outputPaths
        ? {
            markdown: path.relative(PROJECT_ROOT, outputPaths.markdownPath),
            json: path.relative(PROJECT_ROOT, outputPaths.jsonPath)
          }
        : null
    }, null, 2));
    return;
  }

  console.log(`Lessons session scan for ${scan.target_date}`);
  console.log(`- primary reconcile inputs: ${scan.summary.primary}`);
  console.log(`- supporting context files: ${scan.summary.supporting}`);
  console.log(`- suggested next command: ${scan.suggested_next_command}`);
  if (scan.filters.project_filter) {
    console.log(`- project filter: ${scan.filters.project_filter}`);
  }
  if (outputPaths) {
    console.log(`- markdown: ${path.relative(PROJECT_ROOT, outputPaths.markdownPath)}`);
    console.log(`- json: ${path.relative(PROJECT_ROOT, outputPaths.jsonPath)}`);
  }
  if (scan.notes.length > 0) {
    console.log(`- notes: ${scan.notes.join(' | ')}`);
  }
}

main();
