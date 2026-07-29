#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs } = require('../workspace/lib/args');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function usage() {
  return [
    'Detect omitted distinct-intelligence dispatch coverage for outcome_delta.completed.',
    '',
    'Usage:',
    '  node tools/signals/check-dispatch-coverage.cjs --task-id <task_id> [--json]',
    '  node tools/signals/check-dispatch-coverage.cjs --plan <path-to-json> [--json]',
    '',
    'Detect-only: exits nonzero only for gap_classification=no-dispatch.'
  ].join('\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pathExists(projectRoot, maybePath) {
  if (!maybePath || typeof maybePath !== 'string') return false;
  const abs = path.isAbsolute(maybePath) ? maybePath : path.join(projectRoot, maybePath);
  return fs.existsSync(abs);
}

function toRel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function taskIdFromPlanPath(planPath) {
  const base = path.basename(planPath);
  return base
    .replace(/__plan\.json$/, '')
    .replace(/\.json$/, '');
}

function resolveInput(projectRoot, args) {
  const planArg = args.plan || args.file;
  if (planArg) {
    const abs = path.isAbsolute(planArg) ? planArg : path.join(projectRoot, planArg);
    return { path: abs, data: readJson(abs) };
  }

  const taskId = args.task_id || args.task || args._[0];
  if (!taskId) {
    throw new Error('Missing --task-id or --plan.');
  }

  const candidates = [
    path.join(projectRoot, '_dev/reports/analysis/task-outcomes', `${taskId}.json`),
    path.join(projectRoot, '_dev/reports/analysis/task-plans', `${taskId}__plan.json`)
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    throw new Error(`No task plan or task outcome found for task_id=${taskId}`);
  }
  return { path: existing, data: readJson(existing) };
}

function isCompletedOutcome(data) {
  return Boolean(data && data.outcome_delta && data.outcome_delta.completed === true);
}

function producerFrom(data) {
  return {
    actor_id: data.produced_by_actor_id || null,
    harness_id: data.produced_by_harness_id || null
  };
}

function candidateTextMatches(filePath, needles) {
  const text = fs.readFileSync(filePath, 'utf8');
  return needles.some((needle) => needle && text.includes(needle));
}

function discoverDispatchEvidence(projectRoot, taskId) {
  const signalRoot = path.join(projectRoot, '_dev/reports/signals');
  const analysisRoot = path.join(projectRoot, '_dev/reports/analysis');
  const signalFiles = walkFiles(signalRoot)
    .filter((file) => /(^|\/)dispatch-bridge__.+\.signal\.json$/.test(toRel(projectRoot, file)));
  const analysisFiles = walkFiles(analysisRoot)
    .filter((file) => /(^|\/)dispatch-bridge__.+\.json$/.test(toRel(projectRoot, file)));

  const matches = [];
  const scopes = new Set();
  for (const file of [...signalFiles, ...analysisFiles]) {
    if (!candidateTextMatches(file, [taskId])) continue;
    const rel = toRel(projectRoot, file);
    matches.push(rel);
    try {
      const json = readJson(file);
      for (const key of ['scope', 'signal_scope', 'workflow_scope']) {
        if (json[key]) scopes.add(String(json[key]));
      }
    } catch (_) {
      // Keep text evidence even when legacy JSON is malformed.
    }
  }
  return { paths: matches.sort(), scopes: [...scopes].sort() };
}

function returnCandidatePaths(projectRoot, taskId, dispatchScopes) {
  const analysisRoot = path.join(projectRoot, '_dev/reports/analysis');
  const signalRoot = path.join(projectRoot, '_dev/reports/signals');
  const needles = [taskId, ...dispatchScopes].filter(Boolean);
  const candidates = [];

  const exact = [
    path.join(analysisRoot, 'task-plan-reviews', `${taskId}__review.json`),
    path.join(analysisRoot, 'task-plan-reviews', `${taskId}__review.md`),
    path.join(analysisRoot, 'task-outcomes', `${taskId}.json`)
  ];
  for (const file of exact) {
    if (fs.existsSync(file)) candidates.push(file);
  }

  for (const file of walkFiles(signalRoot)) {
    const rel = toRel(projectRoot, file);
    if (!/(^|\/)ready-for-review__.+\.json$/.test(rel)) continue;
    if (candidateTextMatches(file, needles)) candidates.push(file);
  }

  for (const file of walkFiles(analysisRoot)) {
    const rel = toRel(projectRoot, file);
    if (!/(^|\/)review-progress__.+\.md$/.test(rel)) continue;
    if (candidateTextMatches(file, needles)) candidates.push(file);
  }

  return [...new Set(candidates.map((file) => toRel(projectRoot, file)))].sort();
}

function metadataFromReturnArtifact(projectRoot, relPath) {
  const abs = path.join(projectRoot, relPath);
  if (!fs.existsSync(abs) || !relPath.endsWith('.json')) return null;
  let data;
  try {
    data = readJson(abs);
  } catch (_) {
    return null;
  }

  if (data.reviewer && (data.reviewer.actor_id || data.reviewer.harness_id)) {
    return {
      actor_id: data.reviewer.actor_id || null,
      harness_id: data.reviewer.harness_id || null,
      validated_at: data.generated_at || data.timestamp || null,
      validation_artifact: relPath
    };
  }

  return {
    actor_id: data.validated_by_actor_id || null,
    harness_id: data.validated_by_harness_id || null,
    validated_at: data.validated_at || null,
    validation_artifact: data.validation_artifact || null
  };
}

function isIsoTimestamp(value) {
  if (!value || typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function validateReturnMetadata(projectRoot, metadata, producer) {
  if (!metadata) return false;
  if (!metadata.actor_id || !metadata.harness_id) return false;
  if (!isIsoTimestamp(metadata.validated_at)) return false;
  if (!pathExists(projectRoot, metadata.validation_artifact)) return false;
  if (producer.actor_id && metadata.actor_id === producer.actor_id) return false;
  if (producer.harness_id && metadata.harness_id === producer.harness_id) return false;
  return true;
}

function checkDispatchCoverage(projectRoot, inputPath, data) {
  const taskId = data.task_id || taskIdFromPlanPath(inputPath);
  const producer = producerFrom(data);
  const notes = [];

  const result = {
    task_id: taskId,
    event_class: 'outcome_delta.completed',
    dispatch_sent: false,
    return_artifact: null,
    gap_classification: 'indeterminate',
    producer,
    validator: {
      actor_id: null,
      harness_id: null,
      validated_at: null,
      validation_artifact: null
    },
    evidence: {
      dispatch_signal_paths: [],
      return_artifact_paths: [],
      notes
    }
  };

  if (!isCompletedOutcome(data)) {
    notes.push('event-class-not-present');
    return result;
  }

  if (!producer.actor_id || !producer.harness_id) {
    notes.push('producer-metadata-missing');
    return result;
  }

  const dispatchEvidence = discoverDispatchEvidence(projectRoot, taskId);
  result.evidence.dispatch_signal_paths = dispatchEvidence.paths;
  result.dispatch_sent = dispatchEvidence.paths.length > 0;

  const returnPaths = returnCandidatePaths(projectRoot, taskId, dispatchEvidence.scopes);
  result.evidence.return_artifact_paths = returnPaths;

  for (const rel of returnPaths) {
    const metadata = metadataFromReturnArtifact(projectRoot, rel);
    if (!validateReturnMetadata(projectRoot, metadata, producer)) continue;
    result.return_artifact = rel;
    result.validator = {
      actor_id: metadata.actor_id,
      harness_id: metadata.harness_id,
      validated_at: metadata.validated_at,
      validation_artifact: metadata.validation_artifact
    };
    break;
  }

  if (result.dispatch_sent && result.return_artifact) {
    result.gap_classification = 'dispatch-returned';
  } else if (result.dispatch_sent) {
    result.gap_classification = 'dispatch-no-return';
  } else if (result.return_artifact) {
    result.gap_classification = 'indeterminate';
    notes.push('return-artifact-without-dispatch-evidence');
  } else {
    result.gap_classification = 'no-dispatch';
  }

  return result;
}

function formatText(result) {
  return [
    `Dispatch coverage: ${result.gap_classification}`,
    `Task: ${result.task_id}`,
    `Event class: ${result.event_class}`,
    `Dispatch sent: ${result.dispatch_sent ? 'yes' : 'no'}`,
    `Return artifact: ${result.return_artifact || '(none)'}`,
    `Producer: ${result.producer.actor_id || '(unknown)'} / ${result.producer.harness_id || '(unknown)'}`,
    `Validator: ${result.validator.actor_id || '(unknown)'} / ${result.validator.harness_id || '(unknown)'}`
  ].join('\n');
}

function main(argv = process.argv, projectRoot = PROJECT_ROOT) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(usage());
    return 0;
  }

  const input = resolveInput(projectRoot, args);
  const result = checkDispatchCoverage(projectRoot, input.path, input.data);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }

  return result.gap_classification === 'no-dispatch' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(2);
  }
}

module.exports = {
  checkDispatchCoverage,
  discoverDispatchEvidence,
  returnCandidatePaths,
  validateReturnMetadata,
  main
};
