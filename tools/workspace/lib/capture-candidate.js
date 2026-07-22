'use strict';

const path = require('path');
const { exists, listDirs, listFilesRecursive, readJson, readText, writeJson, writeText } = require('./fs');
const { validateNamedModel } = require('./models');
const { readJsonl, relPosix } = require('./workspace');

function hasNonPlaceholderText(filePath) {
  if (!exists(filePath)) return false;
  const text = readText(filePath).trim();
  if (!text) return false;
  // Reject obvious placeholders
  if (/^(TODO|PLACEHOLDER|FIXME|TBD)[:\s]/i.test(text)) return false;
  if (text.includes('[Fill this in]')) return false;
  // Reject files that are only a heading with TODO
  if (text.includes('TODO:')) {
    const nonTodoLines = text.split('\n').filter((line) => !line.includes('TODO:') && line.trim().length > 0 && !line.startsWith('#'));
    if (nonTodoLines.length === 0) return false;
  }
  return true;
}

function loadCapture(captureRoot) {
  const metaPath = path.join(captureRoot, 'CAPTURE_META.json');
  const successPath = path.join(captureRoot, 'success_criteria.json');
  const meta = readJson(metaPath);
  validateNamedModel('capture-meta.schema.json', meta, 'CAPTURE_META.json');

  let successCriteria = { criteria: [] };
  if (exists(successPath)) {
    successCriteria = readJson(successPath);
    validateNamedModel('capture-success-criteria.schema.json', successCriteria, 'success_criteria.json');
  }

  const steps = readJsonl(path.join(captureRoot, 'steps.jsonl'));
  const decisions = readJsonl(path.join(captureRoot, 'decisions.jsonl'));
  return {
    meta,
    successCriteria,
    steps,
    decisions
  };
}

function inspectCapture(captureRoot) {
  const { meta, successCriteria, steps, decisions } = loadCapture(captureRoot);
  const importedRoot = path.join(captureRoot, 'artifacts', 'imported');
  const importedFiles = exists(importedRoot) ? listFilesRecursive(importedRoot) : [];

  const missing = [];
  if (!hasNonPlaceholderText(path.join(captureRoot, 'goal.md'))) missing.push('goal.md');
  if (!hasNonPlaceholderText(path.join(captureRoot, 'context.md'))) missing.push('context.md');
  if (!Array.isArray(successCriteria.criteria) || !successCriteria.criteria.length) missing.push('success_criteria.json criteria');
  if (!steps.length) missing.push('steps.jsonl');
  if (meta.source_type !== 'summary' && !importedFiles.length) missing.push('artifacts/imported/');

  const notes = [];
  if (!decisions.length) notes.push('No decisions.jsonl entries recorded; scaffolding can proceed, but branch detection will be weak.');
  if (!hasNonPlaceholderText(path.join(captureRoot, 'retrospective.md'))) {
    notes.push('retrospective.md is still a placeholder; capture quality will be lower.');
  }

  const ready = missing.length === 0;
  return {
    captureRoot,
    meta,
    successCriteria,
    steps,
    decisions,
    importedFiles,
    missing,
    notes,
    ready
  };
}

function updateCaptureMeta(captureRoot, patch) {
  const metaPath = path.join(captureRoot, 'CAPTURE_META.json');
  const current = readJson(metaPath);
  const next = { ...current, ...patch };
  validateNamedModel('capture-meta.schema.json', next, 'CAPTURE_META.json');
  writeJson(metaPath, next);
  return next;
}

function loadCandidate(candidateRoot) {
  const candidate = readJson(path.join(candidateRoot, 'candidate.json'));
  validateNamedModel('candidate.schema.json', candidate, 'candidate.json');
  return candidate;
}

function collectCandidateBlockingIssues(candidateRoot, candidate, { workspaceRoot, projectRoot } = {}) {
  const issues = [];
  const proposedFrameworkRoot = path.join(candidateRoot, 'proposed_framework');
  const required = ['manifest.json', 'guardrails.md', 'prompts', 'schemas'];
  for (const rel of required) {
    if (!exists(path.join(proposedFrameworkRoot, rel))) {
      issues.push(`Missing proposed framework path: ${rel}`);
    }
  }

  const suspicious = [];
  if (exists(proposedFrameworkRoot)) {
    for (const relFile of listFilesRecursive(proposedFrameworkRoot)) {
      const absFile = path.join(proposedFrameworkRoot, relFile);
      const text = readText(absFile);
      if (text.includes('/Users/')) suspicious.push(`${relFile}: absolute filesystem path`);
      if (workspaceRoot && text.includes(workspaceRoot)) suspicious.push(`${relFile}: workspace root reference`);
      if (projectRoot && text.includes(projectRoot)) suspicious.push(`${relFile}: project root reference`);
      if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) suspicious.push(`${relFile}: email-like content`);
      if (/https?:\/\/[^\s)]+/i.test(text)) suspicious.push(`${relFile}: url-like content`);
    }
  }

  if (suspicious.length) {
    issues.push(`Sanitization blockers detected: ${suspicious.join('; ')}`);
  }

  return {
    issues,
    suspicious
  };
}

function summarizeReplayRuns(candidateRoot) {
  const replayRoot = path.join(candidateRoot, 'replay_runs');
  if (!exists(replayRoot)) {
    return { total: 0, pass: 0, fail: 0, partial: 0, manual_intervention: 0, preflight_only: true, passed_case_ids: [] };
  }

  let total = 0;
  let pass = 0;
  let fail = 0;
  let partial = 0;
  let manualIntervention = 0;
  let hasManualReplay = false;
  const passedCaseIds = new Set();

  for (const runDir of listDirs(replayRoot)) {
    const runJsonPath = path.join(replayRoot, runDir, 'run.json');
    if (!exists(runJsonPath)) continue;
    const run = readJson(runJsonPath);
    total += 1;
    if (run.result === 'pass') {
      pass += 1;
      if (run.case_id) passedCaseIds.add(String(run.case_id));
    }
    else if (run.result === 'fail') fail += 1;
    else partial += 1;
    manualIntervention += Number(run.manual_intervention_count || 0);
    if (run.run_type === 'manual_replay') hasManualReplay = true;
  }

  return {
    total,
    pass,
    fail,
    partial,
    manual_intervention: manualIntervention,
    preflight_only: !hasManualReplay,
    passed_case_ids: Array.from(passedCaseIds).sort()
  };
}

function computePromotionReadiness(candidateRoot, candidate, ctx) {
  const replaySummary = summarizeReplayRuns(candidateRoot);
  const blocking = collectCandidateBlockingIssues(candidateRoot, candidate, ctx);
  const evidenceCount = new Set([
    ...(Array.isArray(candidate.source_captures) ? candidate.source_captures : []),
    ...(Array.isArray(replaySummary.passed_case_ids) ? replaySummary.passed_case_ids : [])
  ]).size;

  // Gate: preflight must have been run
  if (replaySummary.total === 0) {
    blocking.issues.push('Preflight checks have not been run yet. Run replay-candidate.js first.');
  }

  // Gate: minimum evidence threshold
  if (evidenceCount < 3) {
    blocking.issues.push(`At least 3 source captures or replay cases are required; found ${evidenceCount}.`);
  }

  // Gate: no failing runs allowed
  if (replaySummary.fail > 0) {
    blocking.issues.push(`${replaySummary.fail} preflight run(s) failed. Resolve all failures before promotion.`);
  }

  // Gate: at least one run must have passed
  if (replaySummary.total > 0 && replaySummary.pass === 0) {
    blocking.issues.push('No preflight runs have passed. At least one passing run is required.');
  }

  // Advisory: note if all evidence is preflight-only (no manual replay)
  const preflightOnly = replaySummary.preflight_only;

  const promotionReady = blocking.issues.length === 0 && replaySummary.fail === 0 && replaySummary.partial === 0 && evidenceCount >= 3;
  return {
    promotionReady,
    evidenceCount,
    replaySummary,
    preflightOnly,
    blockingIssues: blocking.issues,
    suspicious: blocking.suspicious
  };
}

function updateCandidate(candidateRoot, nextCandidate) {
  validateNamedModel('candidate.schema.json', nextCandidate, 'candidate.json');
  writeJson(path.join(candidateRoot, 'candidate.json'), nextCandidate);
}

function writeJsonReport(filePath, data) {
  writeJson(filePath, data);
}

function writeMarkdownReport(filePath, title, lines) {
  writeText(filePath, [`# ${title}`, '', ...lines].join('\n') + '\n');
}

module.exports = {
  collectCandidateBlockingIssues,
  computePromotionReadiness,
  inspectCapture,
  loadCandidate,
  loadCapture,
  summarizeReplayRuns,
  updateCandidate,
  updateCaptureMeta,
  writeJsonReport,
  writeMarkdownReport
};
