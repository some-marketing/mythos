#!/usr/bin/env node
'use strict';

/**
 * Promote a validated candidate into Mythos/frameworks and register it canonically.
 *
 * Promotion gates:
 * 1. computePromotionReadiness must pass (evidence count, no blockers, no failures)
 * 2. At least one preflight run must exist with a "pass" result
 * 3. No replay runs may have "fail" results
 * 4. Evidence bundles must have substantive content (not just directory presence)
 * 5. Sanitization must pass (no leaked paths, emails, client references)
 * 6. Learning readiness: feedback + signal evidence (advisory or required per candidate.json)
 *
 * If any gate fails, promotion is blocked and the specific blockers are reported.
 */

const path = require('path');
const childProcess = require('child_process');
const { parseArgs } = require('./lib/args');
const { copyDir, ensureDir, exists, fileSize, listDirs, readJson, writeJson } = require('./lib/fs');
const { computePromotionReadiness, loadCandidate, summarizeReplayRuns, updateCandidate } = require('./lib/capture-candidate');
const { die, readJsonl, requireCandidateRoot } = require('./lib/workspace');
const { refreshLedger, computeLearningGate } = require('./lib/learning-ledger');

function help() {
  console.log(`
Promote a validated candidate into Mythos/frameworks and register it canonically.

Requires preflight checks to have passed. Will not promote candidates that have
only been scaffolded without running replay-readiness preflight.

Usage:
  node tools/workspace/promote-candidate.js --candidate <candidate-root>
`.trim());
}

function runNodeScript(rootDir, relScript) {
  childProcess.execFileSync(process.execPath, [path.join(rootDir, relScript)], {
    cwd: rootDir,
    stdio: 'inherit'
  });
}

function upsertFrameworkSpec(rootDir, service, frameworkName, manifest) {
  const specDir = path.join(rootDir, 'instructions', 'canonical', 'frameworks', service);
  ensureDir(specDir);
  const specPath = path.join(specDir, `${frameworkName}.yaml`);
  writeJson(specPath, {
    id: `${service}/${frameworkName}`,
    manifest_path: `frameworks/${service}/${frameworkName}/manifest.json`,
    description: manifest.description,
    inputs: (manifest.input_contract?.required || []).map((item) => item.name),
    outputs: [
      ...(manifest.output_contract?.directories || []),
      ...(manifest.output_contract?.artifacts || [])
    ],
    modes: manifest.execution_modes || [],
    operations: [],
    agent_profiles: ['scaffolded candidate'],
    guardrail_overrides: ['Generated from normalized capture evidence']
  });
}

function upsertSystemFramework(rootDir, service, frameworkName) {
  const systemPath = path.join(rootDir, 'instructions', 'canonical', 'system.yaml');
  const system = readJson(systemPath);
  const id = `${service}/${frameworkName}`;
  system.frameworks = Array.isArray(system.frameworks) ? system.frameworks : [];
  if (!system.frameworks.some((item) => item.id === id)) {
    system.frameworks.push({
      id,
      manifest: `frameworks/${service}/${frameworkName}/manifest.json`,
      guardrails: `frameworks/${service}/${frameworkName}/guardrails.md`
    });
    system.frameworks.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  writeJson(systemPath, system);
}

/**
 * Verify that preflight runs actually exist and at least one passed.
 * Returns an array of blocking issue strings.
 */
function verifyPreflightEvidence(candidateRoot) {
  const issues = [];
  const replayRunsRoot = path.join(candidateRoot, 'replay_runs');

  if (!exists(replayRunsRoot)) {
    issues.push('No replay_runs/ directory exists. Run preflight checks first.');
    return issues;
  }

  const runDirs = listDirs(replayRunsRoot);
  if (runDirs.length === 0) {
    issues.push('No preflight runs found. Run replay-candidate.js first.');
    return issues;
  }

  let passCount = 0;
  let failCount = 0;
  let preflightOnlyCount = 0;
  for (const runDir of runDirs) {
    const runJsonPath = path.join(replayRunsRoot, runDir, 'run.json');
    if (!exists(runJsonPath)) continue;
    const run = readJson(runJsonPath);
    if (run.result === 'pass') passCount += 1;
    if (run.result === 'fail') failCount += 1;
    if (run.run_type === 'preflight') preflightOnlyCount += 1;
  }

  if (passCount === 0) {
    issues.push('No replay runs have passed. At least one passing run is required.');
  }
  if (failCount > 0) {
    issues.push(`${failCount} replay run(s) have failures. Resolve all failures before promotion.`);
  }
  if (passCount > 0 && preflightOnlyCount === runDirs.length) {
    issues.push('All passing runs are preflight-only. At least one actual prompt-chain execution (run_type: "manual_replay") is required before promotion.');
  }

  return issues;
}

/**
 * Verify evidence bundles have substantive content, not just directory stubs.
 */
function verifyEvidenceSubstance(candidateRoot) {
  const issues = [];
  const evidenceRoot = path.join(candidateRoot, 'evidence');

  if (!exists(evidenceRoot)) {
    issues.push('No evidence/ directory exists.');
    return issues;
  }

  const summaryPath = path.join(evidenceRoot, 'capture-summary.json');
  if (!exists(summaryPath)) {
    issues.push('Evidence is missing capture-summary.json.');
    return issues;
  }

  const summary = readJson(summaryPath);
  if (!Array.isArray(summary.source_captures) || summary.source_captures.length === 0) {
    issues.push('capture-summary.json lists no source captures.');
    return issues;
  }

  // Verify at least one evidence bundle has substantive steps
  let bundlesWithSteps = 0;
  for (const dirName of listDirs(evidenceRoot)) {
    const stepsPath = path.join(evidenceRoot, dirName, 'steps.jsonl');
    if (exists(stepsPath)) {
      const steps = readJsonl(stepsPath);
      if (steps.length >= 2) bundlesWithSteps += 1;
    }
  }

  if (bundlesWithSteps === 0) {
    issues.push('No evidence bundles have substantive step logs (at least 2 steps required).');
  }

  return issues;
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const candidateArg = args.candidate;
if (!candidateArg) die('Missing --candidate <candidate-root>');

const ctx = requireCandidateRoot(candidateArg);
const candidate = loadCandidate(ctx.candidateRoot);

// Gate 1: Standard promotion readiness (evidence count, sanitization, structural checks)
const readiness = computePromotionReadiness(ctx.candidateRoot, candidate, ctx);
if (!readiness.promotionReady) {
  die(`Candidate is not promotion ready: ${readiness.blockingIssues.join(' | ')}`);
}

// Gate 2: Preflight evidence must exist and pass
const preflightIssues = verifyPreflightEvidence(ctx.candidateRoot);
if (preflightIssues.length) {
  die(`Preflight evidence is insufficient for promotion: ${preflightIssues.join(' | ')}`);
}

// Gate 3: Evidence substance check
const evidenceIssues = verifyEvidenceSubstance(ctx.candidateRoot);
if (evidenceIssues.length) {
  die(`Evidence substance is insufficient for promotion: ${evidenceIssues.join(' | ')}`);
}

// Gate 4: Learning readiness check
const frameworkId = `${candidate.service_category}/${candidate.framework_name}`;
const ledger = refreshLedger(ctx.candidateRoot, frameworkId);
const gateMode = candidate.learning_required || 'advisory';
const learningGate = computeLearningGate(ledger, gateMode);

if (!learningGate.pass) {
  die(`Learning evidence is insufficient for promotion: ${learningGate.blockers.join(' | ')}`);
}
if (learningGate.advisories.length) {
  console.log(`WARNING: Learning advisories (non-blocking):`);
  for (const adv of learningGate.advisories) {
    console.log(`  - ${adv}`);
  }
}

/**
 * U2a: promotion VALIDATES the persisted service_category — it never rewrites
 * candidate identity (the category was fixed at scaffold time, whether from an
 * explicit --service or the config-driven default). This only guards against a
 * corrupted/hand-edited candidate.json (empty, non-string, or not a valid slug)
 * reaching the framework-copy step; a well-formed persisted category, however it
 * got there, passes through untouched. Duplicate-id promotion still refuses via
 * the existing targetRoot exists() check below — this validation does not change
 * that gate.
 */
function validateServiceCategory(service) {
  if (typeof service !== 'string' || !service.trim()) {
    die('Candidate has no service_category recorded — candidate.json is malformed or was hand-edited.');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(service)) {
    die(`Candidate's persisted service_category "${service}" is not a valid slug — candidate.json is malformed or was hand-edited.`);
  }
  return service;
}

const smosRoot = path.resolve(__dirname, '..', '..');
const service = validateServiceCategory(candidate.service_category);
const frameworkName = candidate.framework_name;
const targetRoot = path.join(smosRoot, 'frameworks', service, frameworkName);
if (exists(targetRoot)) {
  die(`Target framework already exists: ${targetRoot}`);
}

const proposedRoot = path.join(ctx.candidateRoot, 'proposed_framework');
copyDir(proposedRoot, targetRoot);

const manifest = readJson(path.join(targetRoot, 'manifest.json'));
upsertFrameworkSpec(smosRoot, service, frameworkName, manifest);
upsertSystemFramework(smosRoot, service, frameworkName);

runNodeScript(smosRoot, 'tools/instructions/generate.js');
runNodeScript(smosRoot, 'tools/instructions/validate.js');

updateCandidate(ctx.candidateRoot, {
  ...candidate,
  status: 'production',
  promotion_ready: true,
  updated_at: new Date().toISOString(),
  replay_summary: readiness.replaySummary,
  blocking_issues: []
});

console.log(`OK promoted candidate to framework: frameworks/${service}/${frameworkName}`);
console.log(`  Gates passed:`);
console.log(`  - promotion readiness: yes (evidence count: ${readiness.evidenceCount})`);
console.log(`  - preflight runs: ${readiness.replaySummary.pass} passed, ${readiness.replaySummary.fail} failed`);
console.log(`  - sanitization: passed`);
console.log(`  - evidence substance: verified`);
console.log(`  - learning: feedback=${ledger.feedback_count}, signals=${ledger.signal_count}, mode=${gateMode}`);
if (learningGate.advisories.length) {
  console.log(`  - learning advisories: ${learningGate.advisories.length}`);
}
