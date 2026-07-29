#!/usr/bin/env node
/**
 * Phased Testing Framework CLI
 *
 * Unified command-line interface for all framework operations.
 *
 * Usage:
 *   node framework/runner/cli.js <command> [options]
 *
 * Commands:
 *   new-runset       Allocate a new runset folder for a testcase
 *   run              Execute a phased test run
 *   report           Generate reports from run artifacts
 *   handoff          Create developer handoff bundle
 *   validate         Validate testcase definitions and project structure
 *   compare-exports  Compare backend exports (CRM vs WPForms)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseArgs, printGlobalHelp, printVersion } from './lib/args.js';
import { detectProjectRoot } from './lib/fs.js';

import { run as newRunset } from './commands/new-runset.js';
import { run as runCommand } from './commands/run.js';
import { run as report } from './commands/report.js';
import { run as handoff } from './commands/handoff.js';
import { run as validate } from './commands/validate.js';
import { run as compareExports } from './commands/compare-exports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERSION = '1.0.0';

async function main() {
  const args = parseArgs(process.argv);

  if (args.version) {
    printVersion(VERSION);
    return;
  }

  if (args.help && !args.command) {
    printGlobalHelp();
    return;
  }

  const command = args.command;

  // Resolve project root if not provided
  if (!args.project_root) {
    args.project_root = detectProjectRoot(process.cwd());
  }

  switch (command) {
    case 'new-runset':
      await newRunset(args);
      break;

    case 'run':
      await runCommand(args);
      break;

    case 'report':
      await report(args);
      break;

    case 'handoff':
      await handoff(args);
      break;

    case 'validate':
      await validate(args);
      break;

    case 'compare-exports':
      await compareExports(args);
      break;

    default:
      if (!command || args.help) {
        printGlobalHelp();
        return;
      }

      console.error(`Unknown command: ${command}`);
      console.error('Run with --help for available commands.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

