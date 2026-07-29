#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const { runSpiderLedger } = require('./lib/spider-council');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Read-only spider ledger for Mythos maintenance ecology.

Usage:
  node tools/maintenance/spider-council.js [options]

Options:
  --json                    Print the spider ledger JSON
  --help                    Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    return;
  }

  const result = runSpiderLedger(PROJECT_ROOT);

  if (args.json) {
    console.log(JSON.stringify(result.ledger, null, 2));
    return;
  }

  console.log(`Spider ledger: ${result.ledger.summary.total} finding(s) across ${result.ledger.spiders.length} spider(s)`);
  console.log(`Ledger: ${path.relative(PROJECT_ROOT, result.jsonPath)}`);
  console.log(`Markdown: ${path.relative(PROJECT_ROOT, result.markdownPath)}`);
  console.log(`Next: ${result.ledger.next_command}`);
}

if (require.main === module) {
  main();
}
