#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { writeDrawioExport } = require('./lib/drawio-plan-corrections.cjs');

function parseArgs(argv) {
  const args = {
    includeClient: false,
    taskId: null,
    clusterId: null,
    output: null,
    baselineOutput: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-client') args.includeClient = true;
    else if (arg === '--plan') {
      args.taskId = argv[i + 1];
      i += 1;
    } else if (arg === '--cluster') {
      args.clusterId = argv[i + 1];
      i += 1;
    } else if (arg === '--output') {
      args.output = argv[i + 1];
      i += 1;
    } else if (arg === '--baseline-output') {
      args.baselineOutput = argv[i + 1];
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
    'Usage: node tools/planning/export-drawio-plan.js (--plan <task-id> | --cluster <cluster-id>) [--output <path>] [--baseline-output <path>] [--include-client]',
    '',
    'Writes an uncompressed draw.io diagram and immutable .baseline.json sidecar for visual plan correction.',
    'Default scope is system-only. Pass --include-client only when client-plan visibility is explicitly needed.'
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
  if (Boolean(args.taskId) === Boolean(args.clusterId)) {
    console.error('Pass exactly one of --plan or --cluster.');
    console.error(usage());
    process.exit(2);
  }

  try {
    const output = writeDrawioExport(process.cwd(), args);
    console.log(`Wrote ${output.diagramPath}`);
    console.log(`Wrote ${output.baselinePath}`);
    console.log(`Scope ${output.baseline.scope.kind}:${output.baseline.scope.id}`);
    console.log(`Open ${path.basename(output.diagramPath)} in app.diagrams.net, edit visually, then run npm run plans:visual:corrections -- --diagram ${output.diagramPath}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
