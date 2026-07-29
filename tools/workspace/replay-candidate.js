#!/usr/bin/env node
'use strict';

/**
 * Replay-readiness preflight for framework candidates.
 *
 * IMPORTANT: This tool performs PREFLIGHT READINESS CHECKS, not true prompt-chain
 * replay execution. It validates that replay cases have well-formed inputs, that
 * the proposed framework structure is complete, and that capture evidence meets
 * minimum quality thresholds. It does NOT execute the candidate's prompt chain
 * against the replay case inputs.
 *
 * What is CHECKED (preflight):
 * - Replay case readiness flags and input completeness
 * - Input file substantiveness (non-trivial content)
 * - Proposed framework structural completeness (manifest, prompts, schemas)
 * - Capture evidence quality (normalized fields, non-placeholder content)
 * - Sanitization (no leaked paths, emails, or client references)
 *
 * What is NOT done (would require a runtime replay engine):
 * - Actual prompt-chain execution against replay inputs
 * - Output generation and comparison
 * - Live success-criteria evaluation
 *
 * The output clearly labels results as "preflight" to avoid overstating rigor.
 */

const path = require('path');
const { parseArgs } = require('./lib/args');
const { ensureDir, exists, fileSize, listDirs, listFiles, listFilesRecursive, readJson, readText, writeJson, writeText } = require('./lib/fs');
const { computePromotionReadiness, loadCandidate, updateCandidate } = require('./lib/capture-candidate');
const { validateNamedModel } = require('./lib/models');
const { die, readJsonl, requireCandidateRoot, timestampId } = require('./lib/workspace');
const { refreshLedger, writeSignalEntry } = require('./lib/learning-ledger');

function help() {
  console.log(`
Run replay-readiness preflight checks for a framework candidate.

This performs structural and evidence-quality validation. It does NOT execute
the candidate's prompt chain. Results are labeled as preflight assessments.

Usage:
  node tools/workspace/replay-candidate.js --candidate <candidate-root> [--case <case-id|all>]
`.trim());
}

function selectCases(candidateRoot, caseArg) {
  const casesRoot = path.join(candidateRoot, 'replay_cases');
  if (!exists(casesRoot)) return [];
  const allCases = listDirs(casesRoot).map((dirName) => {
    const caseRoot = path.join(casesRoot, dirName);
    const caseJsonPath = path.join(caseRoot, 'case.json');
    if (!exists(caseJsonPath)) {
      die(`Replay case missing case.json: ${caseRoot}`);
    }
    const data = readJson(caseJsonPath);
    validateNamedModel('replay-case.schema.json', data, `replay case ${dirName}`);
    return { root: caseRoot, data };
  });
  if (!caseArg || caseArg === 'all') return allCases;
  return allCases.filter((item) => item.data.case_id === caseArg || path.basename(item.root) === caseArg);
}

/**
 * Check that input files contain non-trivial content (not just placeholders).
 * Returns an array of issue strings for inputs that are empty, too small, or
 * contain only placeholder text.
 */
function validateInputSubstance(inputFiles, inputsRoot) {
  const issues = [];
  const MIN_INPUT_SIZE_BYTES = 50;

  for (const relFile of inputFiles) {
    const absPath = path.join(inputsRoot, relFile);
    const size = fileSize(absPath);
    if (size === 0) {
      issues.push(`Input file is empty: ${relFile}`);
      continue;
    }
    if (size < MIN_INPUT_SIZE_BYTES) {
      issues.push(`Input file is trivially small (${size} bytes): ${relFile}`);
      continue;
    }
    // Check for placeholder-only content in text files
    if (/\.(json|md|txt|jsonl|yaml|yml)$/i.test(relFile)) {
      const text = readText(absPath).trim();
      if (/^(TODO|PLACEHOLDER|FIXME|TBD)[:\s]/i.test(text)) {
        issues.push(`Input file appears to be a placeholder: ${relFile}`);
      }
    }
  }

  return issues;
}

/**
 * Validate the proposed framework has real structural completeness beyond
 * just directory existence. Checks for actual prompt files, schema content,
 * and manifest integrity.
 */
function validateProposedFramework(proposedRoot) {
  const issues = [];

  // Manifest must exist and have required fields
  const manifestPath = path.join(proposedRoot, 'manifest.json');
  if (!exists(manifestPath)) {
    issues.push('Proposed framework is missing manifest.json.');
    return issues;
  }
  const manifest = readJson(manifestPath);
  if (!manifest.prompt_count || manifest.prompt_count < 1) {
    issues.push('Manifest declares zero prompts.');
  }
  if (!manifest.service_category) {
    issues.push('Manifest is missing service_category.');
  }
  if (!manifest.framework_name) {
    issues.push('Manifest is missing framework_name.');
  }

  // Prompts directory must have actual prompt files matching declared count
  const promptsDir = path.join(proposedRoot, 'prompts');
  if (!exists(promptsDir)) {
    issues.push('Proposed framework is missing prompts/ directory.');
  } else {
    const promptFiles = listFiles(promptsDir).filter((f) => f.endsWith('.md'));
    if (promptFiles.length === 0) {
      issues.push('Proposed framework has no prompt files in prompts/.');
    } else if (manifest.prompt_count && promptFiles.length < manifest.prompt_count) {
      issues.push(`Manifest declares ${manifest.prompt_count} prompts but only ${promptFiles.length} prompt files exist.`);
    }
    // Check that prompt files have non-trivial content
    for (const pf of promptFiles) {
      const size = fileSize(path.join(promptsDir, pf));
      if (size < 50) {
        issues.push(`Prompt file is trivially small (${size} bytes): ${pf}`);
      }
    }
  }

  // Guardrails must exist
  if (!exists(path.join(proposedRoot, 'guardrails.md'))) {
    issues.push('Proposed framework is missing guardrails.md.');
  }

  // Schemas directory should exist
  if (!exists(path.join(proposedRoot, 'schemas'))) {
    issues.push('Proposed framework is missing schemas/ directory.');
  }

  return issues;
}

/**
 * Validate that the candidate has substantive capture evidence, not just
 * directory presence. Checks evidence bundles for required normalized fields.
 */
function validateEvidenceQuality(candidateRoot, candidate) {
  const issues = [];
  const evidenceRoot = path.join(candidateRoot, 'evidence');

  if (!exists(evidenceRoot)) {
    issues.push('Candidate has no evidence/ directory.');
    return issues;
  }

  // Check capture-summary.json exists and has content
  const summaryPath = path.join(evidenceRoot, 'capture-summary.json');
  if (!exists(summaryPath)) {
    issues.push('Evidence is missing capture-summary.json.');
  } else {
    const summary = readJson(summaryPath);
    if (!Array.isArray(summary.source_captures) || summary.source_captures.length === 0) {
      issues.push('capture-summary.json lists no source captures.');
    }
  }

  // Check individual evidence bundles have normalized content
  const evidenceDirs = listDirs(evidenceRoot);
  let bundlesWithContent = 0;
  for (const dirName of evidenceDirs) {
    const bundleRoot = path.join(evidenceRoot, dirName);
    const metaPath = path.join(bundleRoot, 'CAPTURE_META.json');
    if (!exists(metaPath)) continue; // Not a capture bundle

    const requiredFiles = ['goal.md', 'steps.jsonl', 'success_criteria.json'];
    let bundleComplete = true;
    for (const req of requiredFiles) {
      const reqPath = path.join(bundleRoot, req);
      if (!exists(reqPath) || fileSize(reqPath) < 10) {
        bundleComplete = false;
      }
    }

    // Verify steps.jsonl has actual step entries
    const stepsPath = path.join(bundleRoot, 'steps.jsonl');
    if (exists(stepsPath)) {
      const steps = readJsonl(stepsPath);
      if (steps.length === 0) {
        bundleComplete = false;
        issues.push(`Evidence bundle ${dirName} has empty steps.jsonl.`);
      }
    }

    if (bundleComplete) bundlesWithContent += 1;
  }

  if (bundlesWithContent === 0 && evidenceDirs.length > 0) {
    issues.push('No evidence bundles have complete normalized content.');
  }

  return issues;
}

const args = parseArgs(process.argv);
if (args.help || args.h) {
  help();
  process.exit(0);
}

const candidateArg = args.candidate;
const caseArg = args.case || 'all';
if (!candidateArg) die('Missing --candidate <candidate-root>');

const ctx = requireCandidateRoot(candidateArg);
const candidate = loadCandidate(ctx.candidateRoot);
const selectedCases = selectCases(ctx.candidateRoot, caseArg);
if (!selectedCases.length) {
  die(`No replay cases found for selector: ${caseArg}`);
}

const proposedRoot = path.join(ctx.candidateRoot, 'proposed_framework');
if (!exists(path.join(proposedRoot, 'manifest.json'))) {
  die(`Candidate is missing proposed framework manifest: ${proposedRoot}`);
}

// Validate proposed framework structural completeness
const frameworkIssues = validateProposedFramework(proposedRoot);

// Validate evidence quality
const evidenceIssues = validateEvidenceQuality(ctx.candidateRoot, candidate);

const runRootBase = path.join(ctx.candidateRoot, 'replay_runs');
ensureDir(runRootBase);

for (const replayCase of selectedCases) {
  const runId = `${timestampId(replayCase.data.case_id)}__${replayCase.data.case_id}`;
  const runRoot = path.join(runRootBase, runId);
  ensureDir(runRoot);
  ensureDir(path.join(runRoot, 'outputs'));

  const blockingFailures = [];
  const preflightWarnings = [];
  const manualInterventions = [];

  if (!replayCase.data.ready) {
    blockingFailures.push('Replay case is not marked ready.');
  }

  const inputsRoot = path.join(replayCase.root, 'inputs');
  const inputFiles = listFilesRecursive(inputsRoot);
  if (!inputFiles.length) {
    blockingFailures.push('Replay case inputs/ is empty.');
  } else {
    // Validate input substance beyond mere presence
    const inputIssues = validateInputSubstance(inputFiles, inputsRoot);
    for (const issue of inputIssues) {
      blockingFailures.push(issue);
    }
  }

  // Include framework structural issues as blockers for this case
  for (const issue of frameworkIssues) {
    blockingFailures.push(`[framework] ${issue}`);
  }

  // Include evidence quality issues as warnings
  for (const issue of evidenceIssues) {
    preflightWarnings.push(`[evidence] ${issue}`);
  }

  const notesPath = path.join(proposedRoot, 'docs', 'SCAFFOLD_SUMMARY.md');
  if (exists(notesPath) && /manual/i.test(readText(notesPath))) {
    manualInterventions.push('Scaffold summary still references manual handling.');
  }

  const result = blockingFailures.length ? 'fail' : manualInterventions.length ? 'partial' : 'pass';
  const finishedAt = new Date().toISOString();

  const runJson = {
    run_id: runId,
    case_id: replayCase.data.case_id,
    candidate_id: candidate.candidate_id,
    started_at: finishedAt,
    finished_at: finishedAt,
    result,
    run_type: 'preflight',
    manual_intervention_count: manualInterventions.length,
    blocking_failures: blockingFailures,
    prompt_failures: [],
    preflight_warnings: preflightWarnings
  };
  validateNamedModel('replay-run.schema.json', runJson, `replay run ${runId}`);
  writeJson(path.join(runRoot, 'run.json'), runJson);

  writeText(
    path.join(runRoot, 'execution_log.jsonl'),
    [JSON.stringify({ ts: finishedAt, event: 'preflight_check', case_id: replayCase.data.case_id, result })].join('\n') + '\n'
  );
  writeText(
    path.join(runRoot, 'manual_interventions.jsonl'),
    `${manualInterventions.map((item) => JSON.stringify({ note: item })).join('\n')}${manualInterventions.length ? '\n' : ''}`
  );
  writeText(
    path.join(runRoot, 'summary.md'),
    [
      '# Replay Preflight Summary',
      '',
      '> NOTE: This is a preflight readiness assessment, not a true prompt-chain replay.',
      '> The checks below validate structure, inputs, and evidence quality.',
      '> Actual replay execution requires running the framework prompt chain manually.',
      '',
      `- case: \`${replayCase.data.case_id}\``,
      `- run type: \`preflight\``,
      `- result: \`${result}\``,
      '',
      '## What was CHECKED',
      '- Case readiness flag and input completeness',
      '- Input file substance (non-trivial content, no placeholders)',
      '- Proposed framework structural completeness',
      '- Capture evidence quality',
      '- Sanitization (no leaked paths, emails, or client references)',
      '',
      '## What was NOT replayed',
      '- Prompt chain execution against these inputs',
      '- Output generation or comparison',
      '- Live success-criteria evaluation',
      '',
      '## Results',
      `- blocking failures: ${blockingFailures.length}`,
      ...(blockingFailures.length ? blockingFailures.map((f) => `  - ${f}`) : []),
      `- preflight warnings: ${preflightWarnings.length}`,
      ...(preflightWarnings.length ? preflightWarnings.map((w) => `  - ${w}`) : []),
      `- manual interventions: ${manualInterventions.length}`,
      ...(manualInterventions.length ? manualInterventions.map((m) => `  - ${m}`) : [])
    ].join('\n') + '\n'
  );
}

// Write a signal entry for this preflight run
const learningRoot = path.join(ctx.candidateRoot, 'learning');
const preflightSignalId = `signal-preflight-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
const allCaseResults = selectedCases.map((rc) => {
  const latestRunDir = listDirs(runRootBase).filter((d) => d.includes(rc.data.case_id)).pop();
  if (!latestRunDir) return 'unknown';
  const runData = readJson(path.join(runRootBase, latestRunDir, 'run.json'));
  return runData.result;
});
const overallPreflightResult = allCaseResults.includes('fail') ? 'fail' : allCaseResults.includes('partial') ? 'partial' : 'pass';

try {
  writeSignalEntry(learningRoot, {
    entry_id: preflightSignalId,
    framework_id: candidate.candidate_id.replace('__', '/'),
    signal_type: 'structural_check',
    result: overallPreflightResult,
    details: `Preflight check across ${selectedCases.length} case(s): ${allCaseResults.join(', ')}`,
    source: 'replay-candidate',
    captured_at: new Date().toISOString()
  });
} catch (err) {
  // Non-fatal: learning signal write should not block replay
  console.log(`WARNING: Could not write learning signal: ${err.message}`);
}

// Refresh learning ledger
const frameworkId = candidate.candidate_id.replace('__', '/');
try {
  refreshLedger(ctx.candidateRoot, frameworkId);
} catch (err) {
  console.log(`WARNING: Could not refresh learning ledger: ${err.message}`);
}

const readiness = computePromotionReadiness(ctx.candidateRoot, candidate, ctx);
const nextCandidate = {
  ...candidate,
  updated_at: new Date().toISOString(),
  replay_summary: readiness.replaySummary,
  promotion_ready: readiness.promotionReady,
  blocking_issues: readiness.blockingIssues,
  sanitization_passed: readiness.suspicious.length === 0,
  status: readiness.promotionReady ? 'validated' : candidate.status === 'production' ? 'production' : candidate.status
};
updateCandidate(ctx.candidateRoot, nextCandidate);

console.log(`OK preflight completed for candidate: ${ctx.candidateRoot}`);
console.log(`  (preflight checks structural readiness; does not execute the prompt chain)`);
console.log(
  `- preflight summary: total=${readiness.replaySummary.total}, pass=${readiness.replaySummary.pass}, fail=${readiness.replaySummary.fail}, partial=${readiness.replaySummary.partial}`
);
if (frameworkIssues.length) {
  console.log(`- framework issues: ${frameworkIssues.length}`);
  for (const issue of frameworkIssues) console.log(`  - ${issue}`);
}
if (evidenceIssues.length) {
  console.log(`- evidence issues: ${evidenceIssues.length}`);
  for (const issue of evidenceIssues) console.log(`  - ${issue}`);
}
console.log(`- promotion ready: ${readiness.promotionReady ? 'yes' : 'no'}`);
if (readiness.blockingIssues.length) {
  console.log(`- promotion blockers:`);
  for (const blocker of readiness.blockingIssues) console.log(`  - ${blocker}`);
}
