#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { writeStepPlanArtifacts, buildStepPlanArtifacts } = require('./lib/step-plan-renderer.cjs');

function parseArgs(argv) {
  const args = { plan: '', write: true, outputRoot: '', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan') {
      args.plan = argv[i + 1];
      i += 1;
    } else if (arg === '--output-root') {
      args.outputRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--stdout') {
      args.write = false;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!args.plan && !arg.startsWith('--')) {
      args.plan = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/export-step-plan.js --plan <task-id|path> [--output-root <dir>] [--json] [--stdout]',
    '',
    'Writes _dev/reports/analysis/visual-plans/<task-id>.steps.{mmd,md,html}.',
    'The renderer is deterministic and refuses to render if the S3 audience framing lint fails.'
  ].join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.plan) {
    console.error('--plan is required.');
    console.error(usage());
    process.exit(2);
  }

  const projectRoot = process.cwd();
  try {
    const options = { plan: args.plan };
    if (args.outputRoot) options.outputRoot = args.outputRoot;
    const built = args.write
      ? writeStepPlanArtifacts(projectRoot, options)
      : buildStepPlanArtifacts(projectRoot, options);
    if (args.json) {
      console.log(JSON.stringify({
        schema: built.schema,
        task_id: built.task_id,
        source_plan: built.source_plan,
        paths: built.paths,
        lint: built.lint
      }, null, 2));
      return;
    }
    if (!args.write) {
      process.stdout.write(built.html);
      return;
    }
    console.log(`Wrote ${built.paths.mmd}`);
    console.log(`Wrote ${built.paths.md}`);
    console.log(`Wrote ${built.paths.html}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
