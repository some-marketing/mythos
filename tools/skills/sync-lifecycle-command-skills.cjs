#!/usr/bin/env node
'use strict';

// Compatibility entry point. Projection authority lives in sync-codex-skills.cjs.
const path = require('node:path');
const { loadProjectionConfig, parseArgs, sync } = require('./sync-codex-skills.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LIFECYCLE_COMMANDS = Object.freeze(['boot', 'new-session', 'next-session', 'cross-session', 'end-session', 'shutdown']);

function isLifecycle(candidate) {
  return candidate.receipt.projection_kind === 'canonical_command'
    && LIFECYCLE_COMMANDS.some((id) => candidate.id === `command-${id}`);
}

function syncLifecycle(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const { config } = loadProjectionConfig(root);
  const candidateDir = options.candidateDir || path.join(root, config.candidate_root, 'lifecycle');
  return sync({ ...options, root, candidateDir, includeCandidate: isLifecycle });
}

function main() {
  const options = parseArgs(process.argv);
  const result = syncLifecycle(options);
  if (options.check) {
    if (result.drift) {
      process.stderr.write(`Lifecycle Codex skill drift: ${result.drift}\n`);
      process.exitCode = 1;
    } else process.stdout.write(`Lifecycle Codex skills aligned: ${LIFECYCLE_COMMANDS.length}\n`);
    return;
  }
  process.stdout.write(`Lifecycle compatibility projection complete: ${LIFECYCLE_COMMANDS.length}; additive applications: ${result.applied}\n`);
}

if (require.main === module) main();

module.exports = { LIFECYCLE_COMMANDS, isLifecycle, syncLifecycle };
