#!/usr/bin/env node
'use strict';

/**
 * export-plandoc.js — CLI entry point for the layman plandoc renderer.
 *
 * Usage:
 *   node tools/planning/export-plandoc.js --plan <task-id|path> [options]
 *
 * Writes _dev/reports/analysis/visual-plans/<task-id>.plandoc.html
 *
 * Follows the same conventions as export-step-plan.js.
 * DO NOT modify that file — the two coexist and produce different layout artifacts.
 */

const fs   = require('node:fs');
const path = require('node:path');

const { resolveTaskPlanPaths } = require('./lib/resolve-task-plan.js');
const { renderPlandocHtml }    = require('./lib/plandoc-renderer.cjs');

const DEFAULT_OUTPUT_ROOT = path.join('_dev', 'reports', 'analysis', 'visual-plans');

function parseArgs(argv) {
  const args = {
    plan: '',
    write: true,
    outputRoot: '',
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan') {
      args.plan = argv[i + 1];
      i += 1;
    } else if (arg === '--output-root') {
      args.outputRoot = argv[i + 1];
      i += 1;
    } else if (arg === '--stdout' || arg === '--no-open') {
      // --no-open is a passthrough alias (matches plan's smoke test invocation)
      args.write = arg === '--stdout' ? false : args.write;
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
    'Usage: node tools/planning/export-plandoc.js --plan <task-id|path> [--output-root <dir>] [--json] [--stdout] [--no-open]',
    '',
    'Writes _dev/reports/analysis/visual-plans/<task-id>.plandoc.html',
    '',
    'Options:',
    '  --plan <id|path>       Task ID (e.g. my-plan) or path to __plan.json',
    '  --output-root <dir>    Override the output directory (default: _dev/reports/analysis/visual-plans)',
    '  --stdout               Print HTML to stdout instead of writing a file',
    '  --no-open              Write the file but do not open it in a browser (default behavior)',
    '  --json                 Print a JSON manifest of the written artifact',
    '  --help, -h             Print this usage message',
    '',
    'The renderer is deterministic and refuses to render if the framing lint fails.',
    'Missing operator audience fields use deterministic source-derived fallback text.'
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

  // Resolve plan paths
  let resolved;
  try {
    resolved = resolveTaskPlanPaths(projectRoot, args.plan);
  } catch (error) {
    console.error(`Error resolving plan: ${error.message}`);
    process.exit(1);
  }

  if (!resolved) {
    console.error(`Plan not found: ${args.plan}`);
    console.error(`Searched system plans in _dev/reports/analysis/task-plans/ and client plans.`);
    process.exit(1);
  }

  // Read and parse plan JSON
  let planJson;
  try {
    const raw = fs.readFileSync(resolved.jsonPath, 'utf8');
    planJson = JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read plan JSON at ${resolved.jsonPath}: ${error.message}`);
    process.exit(1);
  }

  // Derive task ID
  const taskId = (planJson && planJson.task_id)
    ? String(planJson.task_id).trim()
    : path.basename(resolved.jsonPath, '.json').replace(/__plan$/, '');

  // Render
  let html;
  try {
    html = renderPlandocHtml(planJson);
  } catch (error) {
    console.error(`Render failed: ${error.message}`);
    process.exit(1);
  }

  // Handle --stdout
  if (!args.write) {
    process.stdout.write(html);
    return;
  }

  // Determine output path
  const outputRoot = args.outputRoot
    ? path.resolve(projectRoot, args.outputRoot)
    : path.resolve(projectRoot, DEFAULT_OUTPUT_ROOT);
  const outputPath = path.join(outputRoot, `${taskId}.plandoc.html`);

  try {
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(outputPath, html);
  } catch (error) {
    console.error(`Failed to write output: ${error.message}`);
    process.exit(1);
  }

  if (args.json) {
    const relOutput = path.relative(projectRoot, outputPath).split(path.sep).join('/');
    const relSource = path.relative(projectRoot, resolved.jsonPath).split(path.sep).join('/');
    console.log(JSON.stringify({
      schema: 'PlandocExport/1.0',
      task_id: taskId,
      source_plan: relSource,
      paths: {
        html: relOutput
      },
      lint: { ok: true }
    }, null, 2));
    return;
  }

  console.log(`Wrote ${path.relative(projectRoot, outputPath).split(path.sep).join('/')}`);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
