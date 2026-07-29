'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  NON_AUTHORITY_WARNING,
  classifyHarnessPlanOutput
} = require('../lib/harness-plan-output-contract');
const {
  assertCandidateOutputRoot,
  buildTaskPlanFromGeminiDraft,
  writeGeminiPlanCandidate
} = require('../lib/gemini-plan-output-translator');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function fixtureDraft() {
  return [
    '---',
    'title: Gemini Draft Translator Smoke',
    'scope_type: system',
    '---',
    '',
    '## Summary',
    '',
    'Translate a Gemini draft into a candidate plan.',
    '',
    '## Description',
    '',
    'A small fixture for plan-output translation.',
    '',
    '## Current State',
    '',
    'Gemini can produce useful draft plans, but they are not active Mythos authority.',
    '',
    '## Question / Work',
    '',
    'Convert the draft into a canonical candidate bundle.',
    '',
    '## Desired State',
    '',
    'The candidate validates and remains outside active task-plan roots.',
    '',
    '## Steps',
    '',
    '1. S1-parse: Parse the Gemini draft.',
    '2. S2-render: Render JSON and Markdown candidate files.',
    '3. S3-validate: Validate the candidate through the plan-output classifier.',
    ''
  ].join('\n');
}

test('buildTaskPlanFromGeminiDraft creates canonical gap-routed TaskPlan shape', () => {
  const plan = buildTaskPlanFromGeminiDraft(fixtureDraft(), {
    timestamp: '2026-06-25T01:20:00Z'
  });

  assert.equal(plan.schema, 'TaskPlan/1.0');
  assert.equal(plan.task_id, 'gemini-draft-translator-smoke');
  assert.equal(plan.bounded_plan.steps.length, 3);
  assert.equal(plan.bounded_plan.steps[0].route.kind, 'gap');
  assert.equal(plan.methodology_routing.enforcement, 'enforced');
});

test('writeGeminiPlanCandidate writes non-authority candidate bundle and validates output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-plan-candidate-'));
  const result = writeGeminiPlanCandidate(fixtureDraft(), {
    projectRoot: PROJECT_ROOT,
    outputRoot: dir,
    timestamp: '2026-06-25T01:20:00Z'
  });

  assert.ok(fs.existsSync(result.paths.jsonPath));
  assert.ok(fs.existsSync(result.paths.markdownPath));
  assert.ok(fs.existsSync(result.paths.manifestPath));
  assert.equal(result.manifest.warning, NON_AUTHORITY_WARNING);
  assert.equal(result.manifest.validation.status, 'canonical');
  assert.match(fs.readFileSync(result.paths.markdownPath, 'utf8'), /NON-AUTHORITY PREVIEW/);

  const classification = classifyHarnessPlanOutput({
    jsonPath: result.paths.jsonPath,
    markdownPath: result.paths.markdownPath,
    harness: 'gemini',
    category: 'adapter_mediated_translator'
  }, { projectRoot: PROJECT_ROOT });
  assert.equal(classification.status, 'canonical');
});

test('assertCandidateOutputRoot refuses active authority roots', () => {
  assert.throws(
    () => assertCandidateOutputRoot('_dev/reports/analysis/task-plans', PROJECT_ROOT),
    /active system task-plan authority root/
  );
  assert.throws(
    () => assertCandidateOutputRoot('clients/{CLIENT_CODE}/plans', PROJECT_ROOT),
    /client task-plan authority roots/
  );
});

test('writeGeminiPlanCandidate does not mutate active task-plan roots', () => {
  const activeRoot = path.join(PROJECT_ROOT, '_dev', 'reports', 'analysis', 'task-plans');
  const before = new Set(fs.readdirSync(activeRoot));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-plan-candidate-'));
  writeGeminiPlanCandidate(fixtureDraft(), {
    projectRoot: PROJECT_ROOT,
    outputRoot: dir,
    timestamp: '2026-06-25T01:20:00Z'
  });
  const after = new Set(fs.readdirSync(activeRoot));
  assert.deepEqual(after, before);
});
