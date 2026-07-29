/**
 * Filesystem helpers for framework CLI
 */

import fs from 'fs';
import path from 'path';

/**
 * Detect project root by looking for typical markers.
 * @param {string} startDir
 * @returns {string}
 */
export function detectProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    const hasPlaywrightRunner = fs.existsSync(path.join(dir, 'playwright_phased_runner'));
    const hasFrameworkDir = fs.existsSync(path.join(dir, 'framework'));
    const hasProjectsDir = fs.existsSync(path.join(dir, 'projects'));

    // Prefer a project directory (contains the runtime folders)
    if (hasPlaywrightRunner && hasFrameworkDir) return dir;

    // Workspace root isn't a project root
    if (hasProjectsDir && fs.existsSync(path.join(dir, 'WORKSPACE_MANIFEST.json'))) {
      return startDir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

