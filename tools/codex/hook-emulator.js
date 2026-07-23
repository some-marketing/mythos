#!/usr/bin/env node
'use strict';

const { runCodexHook } = require('../runtime/hook-emulation');

function parseArgs(argv) {
  const parsed = {
    event: '',
    command: '',
    filePath: '',
    cwd: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--event') {
      parsed.event = next || '';
      i += 1;
    } else if (arg === '--command' || arg === '--prompt') {
      parsed.command = next || '';
      i += 1;
    } else if (arg === '--file') {
      parsed.filePath = next || '';
      i += 1;
    } else if (arg === '--cwd') {
      parsed.cwd = next || undefined;
      i += 1;
    }
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));

if (!args.event) {
  process.stderr.write('Usage: node tools/codex/hook-emulator.js --event <session-start|userprompt-submit|enter-plan-mode|pre-agent|pre-bash|post-write|post-edit|SubagentStop> [--command "..."] [--prompt "..."] [--file <path>] [--cwd <path>]\n');
  process.exit(1);
}

const result = runCodexHook(args);
if (result.stdout) process.stdout.write(`${result.stdout}\n`);
process.exit(result.exitCode);
