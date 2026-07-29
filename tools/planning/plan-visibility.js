#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  renderPlanVisibilityHtml,
  renderPlanVisibilityMarkdown
} = require('./lib/plan-visibility');

function parseArgs(argv) {
  const args = {
    includeClient: false,
    format: 'markdown',
    write: false,
    output: path.join('_dev', 'reports', 'analysis', 'plan-visibility__current.md')
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-client') args.includeClient = true;
    else if (arg === '--format') {
      args.format = argv[i + 1];
      i += 1;
    }
    else if (arg === '--html') {
      args.format = 'html';
      if (args.output === path.join('_dev', 'reports', 'analysis', 'plan-visibility__current.md')) {
        args.output = path.join('_dev', 'reports', 'analysis', 'plan-visibility__current.html');
      }
    }
    else if (arg === '--write') args.write = true;
    else if (arg === '--output') {
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
    'Usage: node tools/planning/plan-visibility.js [--write] [--output <path>] [--include-client] [--format markdown|html]',
    '',
    'Generates a derived plan dashboard from Mythos task-plan artifacts.',
    'Pass --html as shorthand for --format html.',
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

  const projectRoot = process.cwd();
  if (!['markdown', 'html'].includes(args.format)) {
    console.error(`Unsupported format: ${args.format}`);
    console.error(usage());
    process.exit(2);
  }
  if (
    args.format === 'html'
    && args.output === path.join('_dev', 'reports', 'analysis', 'plan-visibility__current.md')
  ) {
    args.output = path.join('_dev', 'reports', 'analysis', 'plan-visibility__current.html');
  }

  const output = args.format === 'html'
    ? renderPlanVisibilityHtml(projectRoot, { includeClient: args.includeClient })
    : renderPlanVisibilityMarkdown(projectRoot, { includeClient: args.includeClient });

  if (!args.write) {
    process.stdout.write(output);
    return;
  }

  const outputPath = path.resolve(projectRoot, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
}

if (require.main === module) {
  main();
}
