/**
 * Framework Execution Engine
 *
 * Shared helper for command execution and structured output.
 */

import path from 'path';
import fs from 'fs';

import { resolvePaths } from '../lib/project-layout.js';

/**
 * Load testcase configuration
 * @param {string} projectRoot
 * @param {string} testcaseId
 * @returns {object}
 */
export function loadTestcase(projectRoot, testcaseId) {
  const paths = resolvePaths(projectRoot);
  const testcasePath = path.join(paths.testcases, testcaseId, 'testcase.json');
  if (!fs.existsSync(testcasePath)) {
    throw new Error(`Testcase not found: ${testcasePath}`);
  }
  return JSON.parse(fs.readFileSync(testcasePath, 'utf8'));
}

/**
 * Resolve runset folder for a testcase
 * @param {string} projectRoot
 * @param {string} testcaseId
 * @param {string} runsetId
 * @returns {string}
 */
export function runsetDir(projectRoot, testcaseId, runsetId) {
  const paths = resolvePaths(projectRoot);
  return path.join(paths.testcases, testcaseId, 'runs', runsetId);
}

