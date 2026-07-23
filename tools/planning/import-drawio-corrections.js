#!/usr/bin/env node
'use strict';

const { writeCorrectionImport } = require('./lib/drawio-plan-corrections.cjs');

function parseArgs(argv) {
  const args = {
    diagramPath: null,
    baselinePath: null,
    outputDir: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--diagram') {
      args.diagramPath = argv[i + 1];
      i += 1;
    } else if (arg === '--baseline') {
      args.baselinePath = argv[i + 1];
      i += 1;
    } else if (arg === '--output-dir') {
      args.outputDir = argv[i + 1];
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
    'Usage: node tools/planning/import-drawio-corrections.js --diagram <path> [--baseline <path>] [--output-dir <path>]',
    '',
    'Imports visual edits from a draw.io diagram against its export-time baseline sidecar.',
    'Writes VisualPlanCorrections/1.0 JSON plus a human-readable amendment-draft Markdown file.',
    'This command never mutates task-plan source JSON or Markdown.'
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
  if (!args.diagramPath) {
    console.error('Pass --diagram <path>.');
    console.error(usage());
    process.exit(2);
  }

  try {
    const result = writeCorrectionImport(process.cwd(), args);
    console.log(`Wrote ${result.packetPath}`);
    console.log(`Wrote ${result.draftPath}`);
    console.log(`Corrections ${result.packet.correction_count}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
