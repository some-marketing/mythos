/**
 * validate command module
 *
 * Validates testcase definitions and project structure.
 */

import fs from 'fs';
import path from 'path';

import { resolvePaths } from '../lib/project-layout.js';

const HELP_TEXT = `
validate - Validate testcase definitions and project structure

Usage:
  node framework/runner/cli.js validate --testcase <id> [options]

Options:
  --testcase <id>         Optional. Testcase identifier (validates that testcase only)
  --project-root <path>   Project root path

Example:
  node framework/runner/cli.js validate --testcase my_test
`.trim();

function requiredFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing required ${label}: ${filePath}`);
    return false;
  }
  return true;
}

function validateTestcase(testcaseDir) {
  let ok = true;
  ok = requiredFileExists(path.join(testcaseDir, 'testcase.json'), 'testcase.json') && ok;
  ok = requiredFileExists(path.join(testcaseDir, 'locator_map.json'), 'locator_map.json') && ok;
  ok = requiredFileExists(path.join(testcaseDir, 'identity.json'), 'identity.json') && ok;
  ok = requiredFileExists(path.join(testcaseDir, 'EXPECTED_OUTCOMES.md'), 'EXPECTED_OUTCOMES.md') && ok;
  return ok;
}

export async function run(args) {
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const projectRoot = path.resolve(args.project_root || process.cwd());
  const paths = resolvePaths(projectRoot);

  let ok = true;

  if (!fs.existsSync(paths.testcases)) {
    console.error(`Missing testcases directory: ${paths.testcases}`);
    ok = false;
  }

  const testcaseId = args.testcase ? String(args.testcase).trim() : '';
  if (testcaseId) {
    const dir = path.join(paths.testcases, testcaseId);
    ok = validateTestcase(dir) && ok;
  } else if (fs.existsSync(paths.testcases)) {
    const entries = fs.readdirSync(paths.testcases, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of entries) {
      ok = validateTestcase(path.join(paths.testcases, e.name)) && ok;
    }
  }

  if (!ok) process.exit(1);
  console.log('OK');
}

