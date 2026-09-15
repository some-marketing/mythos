#!/usr/bin/env node
'use strict';

// Compatibility entry point. Projection authority lives in sync-codex-skills.cjs.
const path = require('node:path');
const { isApplicable, loadProjectionConfig, mergeManagedTargetCustody, parseArgs, preflightManagedTargetCustody, sync, validateCandidateDir, validateTargetRoot } = require('./sync-codex-skills.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LIFECYCLE_COMMANDS = Object.freeze(['boot', 'new-session', 'next-session', 'cross-session', 'end-session', 'shutdown']);

function lifecycleManagedTarget(id, config) {
  if (!config) return `.agents/skills/source-command-${id}/SKILL.md`;
  return path.posix.join(
    String(config.target_root),
    `${config.families.canonical_commands.target_prefix}${id}`,
    'SKILL.md'
  );
}

function isLifecycle(candidate, config) {
  return candidate.receipt.projection_kind === 'canonical_command'
    && isLifecycleManagedTarget(candidate.receipt.target_exact_path, config);
}

function isLifecycleManagedTarget(target, config) {
  return LIFECYCLE_COMMANDS.some((id) => target === lifecycleManagedTarget(id, config));
}

function lifecycleAvailabilityDrift(candidates, config) {
  return LIFECYCLE_COMMANDS.filter((id) => candidates
    .filter((candidate) => candidate.receipt.target_exact_path === lifecycleManagedTarget(id, config))
    .filter(isApplicable).length !== 1).length;
}

function syncLifecycle(options = {}) {
  const root = options.root || PROJECT_ROOT;
  const { config } = loadProjectionConfig(root);
  if (options.check && !options.candidateDir) {
    const result = sync({
      ...options,
      root,
      candidateDir: path.join(root, config.candidate_root),
      checkCandidate: (candidate) => isLifecycle(candidate, config),
      checkEvidenceCandidate: (candidate) => isLifecycle(candidate, config),
      checkManagedTarget: (target) => isLifecycleManagedTarget(target, config)
    });
    result.drift += lifecycleAvailabilityDrift(result.candidates, config);
    return result;
  }
  const candidateDir = options.candidateDir || path.join(root, config.candidate_root, 'lifecycle');
  const canonicalCandidateDir = path.join(root, config.candidate_root);
  let validatedCanonicalCandidateDir;
  if (options.apply && !options.candidateDir) {
    const targetRoot = validateTargetRoot(root, options.targetDir || path.join(root, config.target_root));
    validatedCanonicalCandidateDir = validateCandidateDir(root, targetRoot, canonicalCandidateDir, canonicalCandidateDir);
    preflightManagedTargetCustody(validatedCanonicalCandidateDir, config.generator_id, [], config.target_root);
  }
  const result = sync({ ...options, root, candidateDir, includeCandidate: (candidate) => isLifecycle(candidate, config) });
  if (options.check) result.drift += lifecycleAvailabilityDrift(result.candidates, config);
  if (options.apply && !options.candidateDir) {
    const appliedTargets = result.candidates
      .filter((candidate) => ['applied_additive', 'already_aligned'].includes(candidate.receipt.application_status))
      .map((candidate) => candidate.receipt.target_exact_path);
    mergeManagedTargetCustody(validatedCanonicalCandidateDir, config.generator_id, appliedTargets, config.target_root);
  }
  return result;
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

module.exports = { LIFECYCLE_COMMANDS, isLifecycle, isLifecycleManagedTarget, syncLifecycle };
