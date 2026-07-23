#!/usr/bin/env node
'use strict';

const {
  classifyHarnessPlanOutput
} = require('./lib/harness-plan-output-contract');

function parseArgs(argv) {
  const args = {
    jsonPath: '',
    markdownPath: '',
    harness: '',
    category: 'unknown',
    json: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan-json') { args.jsonPath = argv[++i] || ''; continue; }
    if (arg === '--markdown') { args.markdownPath = argv[++i] || ''; continue; }
    if (arg === '--harness') { args.harness = argv[++i] || ''; continue; }
    if (arg === '--category') { args.category = argv[++i] || 'unknown'; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/validate-harness-plan-output.js --plan-json <path> [options]',
    '',
    'Classifies harness plan-like output before Mythos treats it as runnable plan authority.',
    '',
    'Options:',
    '  --plan-json <path>   Candidate TaskPlan/1.0 JSON.',
    '  --markdown <path>    Paired Markdown or preview artifact.',
    '  --harness <id>       Harness id for evidence.',
    '  --category <id>      Harness plan-output category.',
    '  --json               Print machine-readable classification.',
    '  --help               Show this help.'
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

  const result = classifyHarnessPlanOutput(args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Harness plan output: ${result.status}`);
    console.log(`Runnable: ${result.runnable ? 'yes' : 'no'}`);
    console.log(result.operator_message);
    if (result.visual_warning) console.log(result.visual_warning);
    for (const issue of result.issues) {
      console.log(`- ${issue.path}: ${issue.operator_message}`);
    }
  }

  process.exit(result.runnable ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`validate-harness-plan-output FATAL: ${error.message}`);
    process.exit(1);
  });
}
