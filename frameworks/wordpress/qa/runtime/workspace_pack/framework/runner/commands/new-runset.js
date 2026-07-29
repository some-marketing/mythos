/**
 * new-runset command module
 *
 * Allocates a new runset folder for a testcase by delegating to the legacy new-runset.js tool.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { findLegacyTool, spawnLegacyTool } from '../adapters/legacy-phased.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HELP_TEXT = `
new-runset - Allocate a new runset folder for a testcase

Usage:
  node framework/runner/cli.js new-runset --testcase <id> [options]

Options:
  --testcase <id>         Required. Testcase identifier
  --project-root <path>   Project root path
  --tags <csv>            Optional. Comma-separated tags for this runset

Example:
  node framework/runner/cli.js new-runset --testcase my_test --tags "smoke,release-2026-01-24"
`.trim();

export async function run(args) {
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const projectRoot = path.resolve(args.project_root || process.cwd());
  const legacyPath = findLegacyTool('new-runset.js', projectRoot);

  if (!legacyPath) {
    console.error('Error: Legacy tool new-runset.js not found');
    console.error('Searched paths:');
    console.error('  - <framework>/playwright_phased_runner/runner/tools/new-runset.js');
    console.error('  - <cwd>/playwright_phased_runner/runner/tools/new-runset.js');
    process.exit(1);
  }

  await spawnLegacyTool(legacyPath, args);
}

