#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { renderFocusedVisualPlanMarkdown } = require('./lib/plan-visibility');

function parseArgs(argv) {
  const args = {
    includeClient: false,
    write: false,
    output: null,
    taskId: null,
    clusterId: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-client') args.includeClient = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--plan') {
      args.taskId = argv[i + 1];
      i += 1;
    } else if (arg === '--cluster') {
      args.clusterId = argv[i + 1];
      i += 1;
    } else if (arg === '--output') {
      args.output = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/export-visual-plan.js (--plan <task-id> | --cluster <cluster-id>) [--write] [--output <path>] [--include-client]',
    '',
    'Generates a portable Markdown visual brief with Mermaid flowchart, related plans, relationships, and source links.',
    'Default scope is system-only. Pass --include-client only when client-plan visibility is explicitly needed.'
  ].join('\n');
}

function defaultOutputPath(args) {
  const id = args.taskId || args.clusterId || 'focus';
  return path.join('_dev', 'reports', 'analysis', 'visual-plans', `${id}.md`);
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

  if (Boolean(args.taskId) === Boolean(args.clusterId)) {
    console.error('Pass exactly one of --plan or --cluster.');
    console.error(usage());
    process.exit(2);
  }

  const projectRoot = process.cwd();
  let output;
  try {
    output = renderFocusedVisualPlanMarkdown(projectRoot, {
      includeClient: args.includeClient,
      taskId: args.taskId,
      clusterId: args.clusterId
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (!args.write) {
    process.stdout.write(output);
    return;
  }

  const outputPath = path.resolve(projectRoot, args.output || defaultOutputPath(args));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
}

if (require.main === module) {
  main();
}
