/**
 * Legacy Phased Runner Adapter
 *
 * Adapter layer to work with the existing playwright_phased_runner tooling.
 * This wraps the legacy runner and provides consistent interfaces for the
 * framework CLI.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find legacy runner tool
 * @param {string} toolName
 * @param {string} projectRoot
 * @returns {string|null}
 */
export function findLegacyTool(toolName, projectRoot) {
  const searchPaths = [
    path.join(__dirname, '..', '..', '..', 'playwright_phased_runner', 'runner', 'tools', toolName),
    path.join(projectRoot, 'playwright_phased_runner', 'runner', 'tools', toolName)
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Legacy tool CWD
 * @param {string} toolPath
 * @returns {string}
 */
export function legacyCwdFromToolPath(toolPath) {
  // <...>/playwright_phased_runner/runner/tools/<tool>.js -> <...>/playwright_phased_runner
  return path.resolve(path.dirname(toolPath), '..', '..');
}

/**
 * Convert args object to argv for spawning legacy tool
 * @param {object} args
 * @returns {string[]}
 */
export function argsToArray(args) {
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

/**
 * Spawn legacy tool with proper cwd/stdout handling
 * @param {string} toolPath
 * @param {object} args
 * @returns {Promise<void>}
 */
export async function spawnLegacyTool(toolPath, args) {
  const childArgs = [toolPath, ...argsToArray(args)];
  const cwd = legacyCwdFromToolPath(toolPath);

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

