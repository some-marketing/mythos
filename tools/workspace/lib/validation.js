'use strict';

const path = require('path');
const { exists, fileSize, isDir, listFilesRecursive, readJson, readText } = require('./fs');

const CAPTURE_REQUIRED_FILES = [
  'CAPTURE_META.json',
  'goal.md',
  'context.md',
  'steps.jsonl',
  'decisions.jsonl',
  'success_criteria.json',
  'retrospective.md'
];

const CANDIDATE_REQUIRED_PATHS = [
  'candidate.json',
  'evidence',
  'replay_cases',
  'replay_runs',
  'proposed_framework/manifest.json',
  'proposed_framework/guardrails.md',
  'proposed_framework/prompts'
];

function validateRequiredKeys(obj, keys) {
  return keys.filter((key) => !(key in obj));
}

function validateCaptureMeta(meta) {
  return validateRequiredKeys(meta, [
    'capture_id',
    'task_type',
    'service_category',
    'source_mode',
    'source_type',
    'normalization_status',
    'created_at',
    'status'
  ]);
}

function validateCandidateMeta(meta) {
  return validateRequiredKeys(meta, [
    'candidate_id',
    'service_category',
    'framework_name',
    'status',
    'source_captures',
    'created_at',
    'updated_at',
    'promotion_ready',
    'blocking_issues',
    'replay_summary'
  ]);
}

function hasMeaningfulContent(filePath, { json = false } = {}) {
  if (!exists(filePath) || fileSize(filePath) === 0) return false;
  if (json) {
    try {
      const data = readJson(filePath);
      return Boolean(data && Object.keys(data).length);
    } catch {
      return false;
    }
  }
  const text = readText(filePath).trim();
  return Boolean(text) && !/^todo[:\s-]/i.test(text);
}

function parseJsonLines(filePath) {
  if (!exists(filePath)) return [];
  const lines = readText(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSONL in ${filePath} line ${index + 1}: ${err.message}`);
    }
  });
}

function captureBlockers(captureRoot) {
  const blockers = [];
  for (const rel of CAPTURE_REQUIRED_FILES) {
    if (!exists(path.join(captureRoot, rel))) blockers.push(`missing:${rel}`);
  }
  if (!hasMeaningfulContent(path.join(captureRoot, 'goal.md'))) blockers.push('goal.md is empty');
  if (!hasMeaningfulContent(path.join(captureRoot, 'context.md'))) blockers.push('context.md is empty');
  if (!hasMeaningfulContent(path.join(captureRoot, 'success_criteria.json'), { json: true })) {
    blockers.push('success_criteria.json is empty or invalid');
  }
  const stepCount = parseJsonLines(path.join(captureRoot, 'steps.jsonl')).length;
  if (!stepCount) blockers.push('steps.jsonl has no steps');
  return blockers;
}

function countImportedArtifacts(captureRoot) {
  const importedRoot = path.join(captureRoot, 'artifacts', 'imported');
  return isDir(importedRoot) ? listFilesRecursive(importedRoot).length : 0;
}

function candidateBlockers(candidateRoot) {
  const blockers = [];
  for (const rel of CANDIDATE_REQUIRED_PATHS) {
    const fullPath = path.join(candidateRoot, rel);
    const expectsDir = !path.extname(rel);
    const ok = expectsDir ? isDir(fullPath) : exists(fullPath);
    if (!ok) blockers.push(`missing:${rel}`);
  }
  return blockers;
}

module.exports = {
  CANDIDATE_REQUIRED_PATHS,
  CAPTURE_REQUIRED_FILES,
  candidateBlockers,
  captureBlockers,
  countImportedArtifacts,
  parseJsonLines,
  validateCandidateMeta,
  validateCaptureMeta
};
