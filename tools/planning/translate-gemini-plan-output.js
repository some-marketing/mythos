#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_CANDIDATE_ROOT,
  writeGeminiPlanCandidate
} = require('./lib/gemini-plan-output-translator');

function parseArgs(argv) {
  const args = {
    input: '',
    outputRoot: DEFAULT_CANDIDATE_ROOT,
    requestedBy: 'Gemini translated candidate',
    json: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') { args.input = argv[++i] || ''; continue; }
    if (arg === '--output-root') { args.outputRoot = argv[++i] || DEFAULT_CANDIDATE_ROOT; continue; }
    if (arg === '--requested-by') { args.requestedBy = argv[++i] || args.requestedBy; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/translate-gemini-plan-output.js --input <draft.md> [options]',
    '',
    'Translates structured Gemini draft-plan Markdown into a non-authority TaskPlan/1.0 candidate bundle.',
    '',
    'Options:',
    `  --output-root <path>   Candidate output root. Default: ${DEFAULT_CANDIDATE_ROOT}`,
    '  --requested-by <name>  requested_by value for candidate metadata.',
    '  --json                 Print machine-readable translation manifest.',
    '  --help                 Show this help.'
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

  if (!args.input) {
    console.error('Missing --input <draft.md>');
    console.error(usage());
    process.exit(2);
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const result = writeGeminiPlanCandidate(markdown, {
    outputRoot: args.outputRoot,
    requestedBy: args.requestedBy
  });

  if (args.json) {
    console.log(JSON.stringify(result.manifest, null, 2));
  } else {
    console.log(`Gemini plan candidate: ${result.manifest.task_id}`);
    console.log(`Warning: ${result.manifest.warning}`);
    console.log(`JSON: ${result.manifest.json_path}`);
    console.log(`Markdown: ${result.manifest.markdown_path}`);
    console.log(`Manifest: ${path.relative(process.cwd(), result.paths.manifestPath).split(path.sep).join('/')}`);
    console.log(`Validation: ${result.manifest.validation.status}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`translate-gemini-plan-output FATAL: ${error.message}`);
    process.exit(1);
  });
}
