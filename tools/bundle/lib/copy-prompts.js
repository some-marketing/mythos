/**
 * Copy framework prompts into the bundle llm/prompts/ directory.
 */

import path from 'path';
import { safeCp } from './copy-artifacts.js';
import { mkdirp } from './fs.js';

const PROMPTS_TO_COPY = [
  '13_PAYLOAD_DEEP_ANALYSIS_AND_{DEVELOPER_NAME}_HANDOFF.md',
  '16_CHANGELOG_CAPTURE_FROM_DEV.md',
];

/**
 * Copy prompt 13 and 16 into the bundle.
 * @param {string} projectRoot - Absolute path to the repo root
 * @param {string} bundleLlmPromptsDir - Absolute path to llm/prompts/ in the bundle
 * @returns {string[]} List of copied filenames
 */
export function copyPrompts(projectRoot, bundleLlmPromptsDir) {
  mkdirp(bundleLlmPromptsDir);
  const copied = [];

  for (const filename of PROMPTS_TO_COPY) {
    const candidates = [
      path.join(projectRoot, 'framework', 'prompts', filename),
      path.join(projectRoot, 'frameworks', 'wordpress', 'qa', 'prompts', filename)
    ];
    const dest = path.join(bundleLlmPromptsDir, filename);
    const src = candidates.find((p) => safeCp(p, dest));
    if (src) {
      copied.push(filename);
    }
  }
  return copied;
}

export default { copyPrompts };
