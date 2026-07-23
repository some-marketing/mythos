#!/usr/bin/env node
'use strict';

const path = require('path');

const { parseArgs } = require('../workspace/lib/args');
const { buildCodexBridge, writeBridgePrompt } = require('./lib/codex-bridge');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function help() {
  console.log(`
Build a ready-to-paste Codex prompt from the latest live coordination signal.

Usage:
  node tools/signals/build-codex-bridge-prompt.js [--stdout-only] [--json]

Options:
  --stdout-only   Print the prompt without writing the analysis artifact
  --json          Print metadata as JSON after generating the prompt
  --help          Show this help
`.trim());
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    help();
    process.exit(0);
  }

  const bridge = buildCodexBridge(PROJECT_ROOT);
  const stdoutOnly = Boolean(args.stdout_only);
  const asJson = Boolean(args.json);

  let writtenPath = '';
  if (!stdoutOnly) {
    writtenPath = writeBridgePrompt(bridge.outputPath, bridge.content);
  }

  console.log(bridge.content);

  if (asJson) {
    console.log(JSON.stringify({
      mode: bridge.mode,
      scope: bridge.scope,
      source_signal_path: bridge.sourceSignalPath,
      output_path: writtenPath || bridge.outputPath
    }, null, 2));
  } else if (!stdoutOnly) {
    console.log(`\nWrote: ${path.relative(PROJECT_ROOT, writtenPath)}`);
  }
}

main();
