#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const { runTopologyScout, DEFAULT_STALE_SIGNAL_HOURS } = require('./lib/topology-scout');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Read-only topology scout for Mythos maintenance ecology.

Usage:
  node tools/maintenance/topology-scout.js [options]

Options:
  --stale-signal-hours <n>  Live HandoffSignal age threshold (default: ${DEFAULT_STALE_SIGNAL_HOURS})
  --emit-signal             Emit one fingerprint-gated coordination signal when findings changed
  --json                    Print the ledger JSON
  --help                    Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    return;
  }

  const result = runTopologyScout(PROJECT_ROOT, {
    staleSignalHours: Number(args.stale_signal_hours || DEFAULT_STALE_SIGNAL_HOURS),
    emitSignal: Boolean(args.emit_signal)
  });

  if (args.json) {
    console.log(JSON.stringify(result.ledger, null, 2));
    return;
  }

  console.log(`Maintenance topology scout: ${result.ledger.summary.total} finding(s)`);
  console.log(`Ledger: ${path.relative(PROJECT_ROOT, result.jsonPath)}`);
  console.log(`Markdown: ${path.relative(PROJECT_ROOT, result.markdownPath)}`);
  if (result.signal.emitted) {
    console.log(`Signal: ${path.relative(PROJECT_ROOT, result.signal.path)}`);
  } else {
    console.log(`Signal: not emitted (${result.signal.reason})`);
  }
}

if (require.main === module) {
  main();
}
