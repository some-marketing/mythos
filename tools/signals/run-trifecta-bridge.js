#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SIGNALS_DIR = path.join(PROJECT_ROOT, '_dev/state/signals');

function help() {
  console.log(`
Orchestrate a parallel consultation with Codex, Claude, and Gemini.

Usage:
  node tools/signals/run-trifecta-bridge.js --task "..." [--context file1,file2]

Options:
  --task "..."    The specific query or proposal to be reviewed by the Trifecta.
  --context ...   Optional comma-separated list of files to include in the context.
  --help          Show this help.
`.trim());
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.task) {
    help();
    process.exit(args.help ? 0 : 1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const taskId = `trifecta_${timestamp}`;
  const context = args.context ? args.context.split(',') : [];

  console.log(`[Trifecta] Initiating parallel consultation for: "${args.task}"`);

  const actors = ['codex', 'claude', 'gemini'];
  const signals = [];

  for (const actor of actors) {
    const signalName = `ready-for-review__${timestamp}__${actor}__${taskId}.json`;
    const signalPath = path.join(SIGNALS_DIR, signalName);
    
    const signal = {
      id: taskId,
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      type: "ready-for-review",
      status: "ready-for-review",
      recommended_next_actor: actor,
      task: args.task,
      context: context,
      governance: {
        lane: actor === 'codex' ? 'local-slow' : 'cloud-slow',
        contract: "synthetic-consensus"
      }
    };

    fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));
    signals.push(signalPath);
    console.log(`[Trifecta] Created signal for ${actor}: ${signalName}`);
  }

  console.log(`\n[Trifecta] All signals dispatched to ${SIGNALS_DIR}.`);
  console.log(`[Trifecta] As Above, So Below: Awaiting three completion reports for synthesis.`);
  console.log(`[Trifecta] Next Step: Run 'npm run signals:watch:actors' or individual bridge runners.`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
