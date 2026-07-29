#!/usr/bin/env node
'use strict';

const {
  promoteGeminiPlanCandidate
} = require('./lib/gemini-plan-candidate-promotion');

function parseArgs(argv) {
  const args = {
    manifestPath: '',
    scopeType: '',
    clientCode: '',
    promotedBy: 'codex',
    json: false,
    help: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') { args.manifestPath = argv[++i] || ''; continue; }
    if (arg === '--scope') { args.scopeType = argv[++i] || ''; continue; }
    if (arg === '--client') { args.clientCode = argv[++i] || ''; args.scopeType = 'client'; continue; }
    if (arg === '--promoted-by') { args.promotedBy = argv[++i] || 'codex'; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/promote-gemini-plan-candidate.js --manifest <translation.json> [options]',
    '',
    'Promotes a GeminiPlanTranslation/1.0 candidate bundle into the active task-plan root with pending-review state.',
    '',
    'Options:',
    '  --scope system        Promote to the system task-plan root. Default follows candidate scope.',
    '  --client CODE         Promote to clients/CODE/plans and client review-state root.',
    '  --promoted-by <id>    Actor id for provenance. Default: codex.',
    '  --json                Print machine-readable result.',
    '  --help                Show this help.'
  ].join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.manifestPath) {
    console.error('Missing --manifest <translation.json>');
    console.error(usage());
    process.exit(2);
  }

  const result = promoteGeminiPlanCandidate(args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Promoted Gemini plan candidate: ${result.task_id}`);
    console.log(`JSON: ${result.promoted_json}`);
    console.log(`Markdown: ${result.promoted_markdown}`);
    console.log(`Review state: ${result.review_state}`);
    console.log(`Next: ${result.next_command}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`promote-gemini-plan-candidate FATAL: ${error.message}`);
    process.exit(1);
  });
}
