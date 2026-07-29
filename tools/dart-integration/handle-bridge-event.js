#!/usr/bin/env node
'use strict';

const fs = require('fs');

const dart = require('./lib/dart-api');
const { handleBridgeEvent } = require('./lib/bridge-event');

function parseArgs(argv) {
  const args = {
    eventFile: '',
    json: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--event-file') {
      i += 1;
      args.eventFile = argv[i] || '';
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function help() {
  console.log(`
Handle a minimal Dart bridge event.

Usage:
  npm run dart:bridge:handle -- --event-file payload.json --json

The GitHub Action supplies DART_TOKEN through GitHub Secrets. Local runs may
use the existing macOS Keychain token fallback.
`.trim());
}

function readPayload(eventFile) {
  const raw = eventFile
    ? fs.readFileSync(eventFile, 'utf8')
    : fs.readFileSync(0, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Dart bridge event: ${result.action}`);
  if (result.task_id) console.log(`task=${result.task_id}`);
  if (result.dartboard) console.log(`dartboard=${result.dartboard}`);
  if (result.classification) console.log(`classification=${result.classification}`);
  if (result.target_board) console.log(`target_board=${result.target_board}`);
  if (result.reason) console.log(`reason=${result.reason}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }

  const payload = readPayload(args.eventFile);
  const result = await handleBridgeEvent(payload, { dart });
  printResult(result, args.json);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  readPayload,
};
