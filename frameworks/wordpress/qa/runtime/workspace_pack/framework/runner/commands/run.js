/**
 * run command module
 *
 * Executes a phased test run by delegating to the legacy run-phased-wrapper.js tool.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HELP_TEXT = `
run - Execute a phased test run

Usage:
  node framework/runner/cli.js run --testcase <id> --runset <id> --env <id> [options]

Options:
  --testcase <id>         Required. Testcase identifier
  --runset <id>           Required. Runset identifier (e.g., run_0001)
  --env <id>              Required. Environment (e.g., A-logged_out, B-logged_in, C-incognito)
  --project-root <path>   Project root path
  --headed                Run browser in headed mode (visible)
  --slowmo <ms>           Slow down operations by milliseconds
  --storage-state-in <path>   Load Playwright storageState JSON (required for env B-logged_in)
  --storage-state-out <path>  Save Playwright storageState JSON at end of run

Example:
  node framework/runner/cli.js run --testcase my_test --runset run_0001 --env A-logged_out --headed
  node framework/runner/cli.js run --testcase my_test --runset run_0001 --env B-logged_in --storage-state-in auth_states/site/B-logged_in.storage.json
`.trim();

function findLegacyTool(projectRoot) {
  const toolName = 'run-phased-wrapper.js';
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

function envLetterFromEnvId(envId) {
  const raw = String(envId || '').trim();
  if (!raw) return '';
  const first = raw.split('-')[0];
  return String(first || '').trim().toUpperCase();
}

function translateFrameworkArgsToLegacy(args) {
  if (!args.runset && args.runset_id) args.runset = args.runset_id;
  if (args.runset && !args.runset_id) args.runset_id = args.runset;

  const envLetter = envLetterFromEnvId(args.env);
  if (envLetter) args.env = envLetter;

  if (!args.run_id) {
    const runset = String(args.runset_id || args.runset || '').trim();
    const runN = runset.startsWith('run_') ? runset.slice('run_'.length) : runset;
    if (envLetter && runN) args.run_id = `${envLetter}_run_${runN}`;
  }

  delete args.runset;
}

export async function run(args) {
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  translateFrameworkArgsToLegacy(args);

  const projectRoot = path.resolve(args.project_root || process.cwd());
  for (const key of ['storage_state_in', 'storage_state_out']) {
    if (args[key] && typeof args[key] === 'string' && !path.isAbsolute(args[key])) {
      args[key] = path.resolve(projectRoot, args[key]);
    }
  }

  const legacyPath = findLegacyTool(projectRoot);

  if (!legacyPath) {
    console.error('Error: Legacy tool run-phased-wrapper.js not found');
    console.error('Searched paths:');
    console.error('  - <framework>/playwright_phased_runner/runner/tools/run-phased-wrapper.js');
    console.error('  - <cwd>/playwright_phased_runner/runner/tools/run-phased-wrapper.js');
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
