/**
 * Project Layout Resolver
 *
 * Detects whether a project uses legacy or template_project layout
 * and provides consistent path resolution for all project components.
 */

import fs from 'fs';
import path from 'path';

export const LAYOUT_TYPES = {
  LEGACY: 'legacy',
  TEMPLATE: 'template',
  UNKNOWN: 'unknown'
};

export function detectLayout(projectRoot) {
  const root = path.resolve(projectRoot);

  const hasConfigDir = fs.existsSync(path.join(root, 'config'));
  const hasArtifactsDir = fs.existsSync(path.join(root, 'artifacts'));
  const hasTopLevelTestcases = fs.existsSync(path.join(root, 'testcases'));

  const hasPlaywrightRunner = fs.existsSync(path.join(root, 'playwright_phased_runner'));
  const hasNestedRunner = fs.existsSync(path.join(root, 'playwright_phased_runner', 'runner'));

  if (hasConfigDir && hasTopLevelTestcases && !hasPlaywrightRunner) {
    return LAYOUT_TYPES.TEMPLATE;
  }

  if (hasPlaywrightRunner && hasNestedRunner) {
    return LAYOUT_TYPES.LEGACY;
  }

  if (hasTopLevelTestcases || hasPlaywrightRunner) {
    return LAYOUT_TYPES.LEGACY;
  }

  return LAYOUT_TYPES.UNKNOWN;
}

export function resolvePaths(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const layout = options.layout || detectLayout(root);

  let paths;

  if (layout === LAYOUT_TYPES.TEMPLATE) {
    paths = {
      root,
      layout,
      testcases: path.join(root, 'testcases'),
      config: path.join(root, 'config'),
      artifacts: path.join(root, 'artifacts'),
      runs: path.join(root, 'artifacts', 'runs'),
      reports: path.join(root, 'artifacts', 'reports'),
      derived: path.join(root, 'artifacts', 'derived'),
      exports: path.join(root, 'exports'),
      authStates: path.join(root, 'auth_states'),
      projectConfig: path.join(root, 'config', 'project.json'),
      defaultsConfig: path.join(root, 'config', 'defaults.json')
    };
  } else {
    const runnerBase = fs.existsSync(path.join(root, 'playwright_phased_runner'))
      ? path.join(root, 'playwright_phased_runner')
      : root;

    paths = {
      root,
      layout,
      testcases: fs.existsSync(path.join(runnerBase, 'testcases'))
        ? path.join(runnerBase, 'testcases')
        : path.join(root, 'testcases'),
      config: path.join(runnerBase, 'runner', 'config'),
      artifacts: runnerBase,
      runs: path.join(runnerBase, 'runs'),
      reports: path.join(runnerBase, 'reports'),
      derived: path.join(runnerBase, 'derived'),
      exports: path.join(runnerBase, 'exports'),
      authStates: path.join(runnerBase, 'auth_states'),
      projectConfig: null,
      defaultsConfig: path.join(runnerBase, 'runner', 'config', 'defaults.json'),
      legacyRunner: path.join(runnerBase, 'runner'),
      legacyTools: path.join(runnerBase, 'runner', 'tools')
    };
  }

  return paths;
}

