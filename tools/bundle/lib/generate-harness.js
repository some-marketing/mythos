/**
 * Write LLM harness files (AGENTS.md, CLAUDE.md, .cursorrules) to bundle.
 */

import path from 'path';
import { writeText, mkdirp } from './fs.js';
import { agentsMd } from '../templates/agents-md.js';
import { claudeMd } from '../templates/claude-md.js';
import { cursorrules } from '../templates/cursorrules.js';

/**
 * Write harness files to both bundle root and llm/ subdirectory.
 * @param {string} bundleDir - Absolute path to bundle root
 * @param {string} bundleId - Bundle directory name
 * @param {object[]} runs - Array of run descriptors
 * @param {string} scope - Human-readable scope description
 * @returns {string[]} List of written file paths (relative to bundleDir)
 */
export function writeHarnessFiles(bundleDir, bundleId, runs, scope) {
  const llmDir = path.join(bundleDir, 'llm');
  mkdirp(llmDir);

  const agentsContent = agentsMd();
  const claudeContent = claudeMd(scope);
  const cursorContent = cursorrules(scope);

  const written = [];

  // Bundle root
  writeText(path.join(bundleDir, 'AGENTS.md'), agentsContent);
  written.push('AGENTS.md');

  writeText(path.join(bundleDir, 'CLAUDE.md'), claudeContent);
  written.push('CLAUDE.md');

  writeText(path.join(bundleDir, '.cursorrules'), cursorContent);
  written.push('.cursorrules');

  // llm/ subdirectory
  writeText(path.join(llmDir, 'AGENTS.md'), agentsContent);
  written.push('llm/AGENTS.md');

  writeText(path.join(llmDir, 'CLAUDE.md'), claudeContent);
  written.push('llm/CLAUDE.md');

  writeText(path.join(llmDir, '.cursorrules'), cursorContent);
  written.push('llm/.cursorrules');

  return written;
}

export default { writeHarnessFiles };
