#!/usr/bin/env node
'use strict';

// Compatibility entry point. Projection authority lives in sync-codex-skills.cjs.
const path = require('node:path');
const { isApplicable, loadProjectionConfig, mergeManagedTargetCustody, parseArgs, preflightManagedTargetCustody, sync, validateCandidateDir, validateTargetRoot } = require('./sync-codex-skills.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LIFECYCLE_COMMANDS = Object.freeze(['boot', 'new-session', 'next-session', 'cross-session', 'end-session', 'shutdown']);

function isLifecycle(candidate) {
  return candidate.receipt.projection_kind === 'canonical_command'
    && isLifecycleManagedTarget(candidate.receipt.target_exact_path);
}

function isLifecycleManagedTarget(target) {
  return LIFECYCLE_COMMANDS.some((id) => target === `.agents/skills/source-command-${id}/SKILL.md`);
}

function lifecycleAvailabilityDrift(candidates) {
  return LIFECYCLE_COMMANDS.filter((id) => candidates
    .filter((candidate) => candidate.receipt.target_exact_path === `.agents/skills/source-command-${id}/SKILL.md`)
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
      checkCandidate: isLifecycle,
      checkEvidenceCandidate: isLifecycle,
      checkManagedTarget: isLifecycleManagedTarget
    });
    result.drift += lifecycleAvailabilityDrift(result.candidates);
    return result;
  }
  const candidateDir = options.candidateDir || path.join(root, config.candidate_root, 'lifecycle');
  const canonicalCandidateDir = path.join(root, config.candidate_root);
  let validatedCanonicalCandidateDir;
  if (options.apply && !options.candidateDir) {
    const targetRoot = validateTargetRoot(root, options.targetDir || path.join(root, config.target_root));
    validatedCanonicalCandidateDir = validateCandidateDir(root, targetRoot, canonicalCandidateDir, canonicalCandidateDir);
    preflightManagedTargetCustody(validatedCanonicalCandidateDir, config.generator_id);
  }
  const result = sync({ ...options, root, candidateDir, includeCandidate: isLifecycle });
  if (options.check) result.drift += lifecycleAvailabilityDrift(result.candidates);
  if (options.apply && !options.candidateDir) {
    const appliedTargets = result.candidates
      .filter((candidate) => ['applied_additive', 'already_aligned'].includes(candidate.receipt.application_status))
      .map((candidate) => candidate.receipt.target_exact_path);
    mergeManagedTargetCustody(validatedCanonicalCandidateDir, config.generator_id, appliedTargets);
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
