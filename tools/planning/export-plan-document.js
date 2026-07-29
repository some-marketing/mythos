#!/usr/bin/env node
'use strict';

//
// export-plan-document.js — ONE command for a READABLE plan document.
//
// Renders a self-contained, human-readable plan document (what/why prose, full
// per-step Stakeholder Summary, inline SVG diagram, inline glossary so nothing
// is a dangling reference, and a clearly-marked Agent Grounding block), wraps it
// in HTML, writes it next to the visual plans, and opens it in an explicit
// browser. Useful to the operator, dealership stakeholders, AND agents.
//
// Usage:
//   node tools/planning/export-plan-document.js <plan-id> [--no-open] [--output <path>]
//     <plan-id>    plan id (matches _dev/reports/analysis/task-plans/<id>__plan.json
//                  or clients/<C>/plans/<id>__plan.json)
//     --no-open    write only; print path, don't launch the browser
//     --output     write the HTML to this path instead of the default
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { renderPlanDocumentHtml } = require('./lib/plan-visibility');

function parseArgs(argv) {
  const args = { taskId: null, noOpen: false, output: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-open') args.noOpen = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--output') {
      args.output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (!args.taskId) {
      args.taskId = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node tools/planning/export-plan-document.js <plan-id> [--no-open] [--output <path>]',
    '',
    'Renders a readable plan document (prose + inline SVG diagram + inline glossary +',
    'Agent Grounding block), writes it as HTML, and opens it in a browser.'
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

  if (!args.taskId) {
    console.error('Pass a <plan-id>.');
    console.error(usage());
    process.exit(2);
  }

  const projectRoot = process.cwd();
  let html;
  try {
    html = renderPlanDocumentHtml(projectRoot, { taskId: args.taskId });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const outputPath = path.resolve(
    projectRoot,
    args.output || path.join('_dev', 'reports', 'analysis', 'visual-plans', `${args.taskId}.plan.html`)
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);

  if (args.noOpen) return;

  // Prefer an explicit browser so a .html association to a non-browser app
  // (e.g. a photo editor for the sibling .svg) can't hijack the open.
  const browsers = ['Google Chrome', 'Safari', 'Firefox', 'Microsoft Edge'];
  let opened = false;
  for (const browser of browsers) {
    try {
      execFileSync('open', ['-a', browser, outputPath], { cwd: projectRoot, stdio: 'ignore' });
      console.log(`Opened in ${browser}.`);
      opened = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!opened) {
    try {
      execFileSync('open', [outputPath], { cwd: projectRoot });
      console.log('Opened (default app).');
    } catch (error) {
      console.error('open failed (path above):', error.message);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
