/**
 * report command module
 *
 * Generates reports from run artifacts by delegating to the legacy compile-runset.js tool.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HELP_TEXT = `
report - Generate reports from run artifacts

Usage:
  node framework/runner/cli.js report --testcase <id> --runset <id> [options]

Options:
  --testcase <id>         Required. Testcase identifier
  --runset <id>           Required. Runset identifier
  --project-root <path>   Project root path
  --output-dir <path>     Override output directory

Outputs:
  - runset.summary.json   Machine-readable summary
  - runset.summary.md     Human-readable report

Example:
  node framework/runner/cli.js report --testcase my_test --runset run_0001
`.trim();

function findLegacyTool(projectRoot) {
  const toolName = 'compile-runset.js';
  const searchPaths = [
    path.join(__dirname, '..', '..', '..', 'playwright_phased_runner', 'runner', 'tools', toolName),
    path.join(projectRoot, 'playwright_phased_runner', 'runner', 'tools', toolName)
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function argsToArray(args) {
  const result = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === 'command' || key === '_positional' || key === 'help') continue;
    if (value === true) {
      result.push(`--${key.replace(/_/g, '-')}`);
    } else if (value !== false && value !== undefined) {
      result.push(`--${key.replace(/_/g, '-')}`, String(value));
    }
  }
  return result;
}

function legacyCwdFromToolPath(toolPath) {
  return path.resolve(path.dirname(toolPath), '..', '..');
}

function translateFrameworkArgsToLegacy(args) {
  if (!args.runset && args.runset_id) args.runset = args.runset_id;
  if (args.runset && !args.runset_id) args.runset_id = args.runset;
  delete args.runset;
}

export async function run(args) {
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  translateFrameworkArgsToLegacy(args);

  const projectRoot = path.resolve(args.project_root || process.cwd());
  const legacyPath = findLegacyTool(projectRoot);

  if (!legacyPath) {
    console.error('Error: Legacy tool compile-runset.js not found');
    console.error('Searched paths:');
    console.error('  - <framework>/playwright_phased_runner/runner/tools/compile-runset.js');
    console.error('  - <cwd>/playwright_phased_runner/runner/tools/compile-runset.js');
    process.exit(1);
  }

  const childArgs = [legacyPath, ...argsToArray(args)];
  const cwd = legacyCwdFromToolPath(legacyPath);

  return new Promise((resolve) => {
    const child = spawn('node', childArgs, {
      stdio: 'inherit',
      cwd
    });

    child.on('error', (err) => {
      console.error(`Error spawning legacy tool: ${err.message}`);
      process.exit(1);
    });

    child.on('exit', (code) => {
      if (code !== 0) process.exit(code || 1);
      resolve();
    });
  });
}

