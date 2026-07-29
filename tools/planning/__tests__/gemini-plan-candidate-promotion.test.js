'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  promoteGeminiPlanCandidate
} = require('../lib/gemini-plan-candidate-promotion');
const {
  writeGeminiPlanCandidate
} = require('../lib/gemini-plan-output-translator');

function fixtureDraft() {
  return [
    '---',
    'title: Promotion Candidate Fixture',
    'scope_type: system',
    '---',
    '',
    '## Summary',
    '',
    'Promote a translated candidate safely.',
    '',
    '## Description',
    '',
    'Promotion fixture.',
    '',
    '## Current State',
    '',
    'A candidate exists outside active roots.',
    '',
    '## Question / Work',
    '',
    'Promote the candidate into active task-plan storage.',
    '',
    '## Desired State',
    '',
    'The active plan exists with pending review state.',
    '',
    '## Steps',
    '',
    '1. S1-promote: Copy candidate files.',
    '2. S2-review: Require review before run.',
    ''
  ].join('\n');
}

function makeProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-promotion-project-'));
  fs.mkdirSync(path.join(root, '_dev', 'reports', 'analysis', 'task-plans'), { recursive: true });
  fs.mkdirSync(path.join(root, '_dev', 'state', 'plan-task-review-state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'instructions', 'canonical'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools', 'planning'), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'instructions', 'canonical', 'harness-plan-output-contract.yaml'),
    path.join(root, 'instructions', 'canonical', 'harness-plan-output-contract.yaml')
  );
  fs.copyFileSync(
    path.join(process.cwd(), 'tools', 'planning', 'task-intake.schema.json'),
    path.join(root, 'tools', 'planning', 'task-intake.schema.json')
  );
  return root;
}

test('promoteGeminiPlanCandidate copies valid candidate and writes pending review marker', () => {
  const root = makeProjectRoot();
  const candidate = writeGeminiPlanCandidate(fixtureDraft(), {
    projectRoot: process.cwd(),
    outputRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-candidate-')),
    timestamp: '2026-06-25T01:38:00Z'
  });
  const projectCandidateRoot = path.join(root, '_dev', 'reports', 'analysis', 'harness-plan-output-candidates', candidate.plan.task_id);
  fs.mkdirSync(projectCandidateRoot, { recursive: true });
  for (const [name, source] of Object.entries({
    [`${candidate.plan.task_id}__plan.json`]: candidate.paths.jsonPath,
    [`${candidate.plan.task_id}__plan.md`]: candidate.paths.markdownPath,
    [`${candidate.plan.task_id}__translation.json`]: candidate.paths.manifestPath
  })) {
    fs.copyFileSync(source, path.join(projectCandidateRoot, name));
  }
  const manifestPath = path.join(projectCandidateRoot, `${candidate.plan.task_id}__translation.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.json_path = path.relative(root, path.join(projectCandidateRoot, `${candidate.plan.task_id}__plan.json`));
  manifest.markdown_path = path.relative(root, path.join(projectCandidateRoot, `${candidate.plan.task_id}__plan.md`));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const result = promoteGeminiPlanCandidate({
    projectRoot: root,
    manifestPath,
    promotedAt: '2026-06-25T01:39:00Z',
    promotedBy: 'test'
  });

  assert.equal(result.task_id, 'promotion-candidate-fixture');
  assert.equal(result.next_command, '/review-task-plan promotion-candidate-fixture');
  assert.ok(fs.existsSync(path.join(root, result.promoted_json)));
  assert.ok(fs.existsSync(path.join(root, result.promoted_markdown)));
  assert.ok(fs.existsSync(path.join(root, result.review_state)));

  const promotedPlan = JSON.parse(fs.readFileSync(path.join(root, result.promoted_json), 'utf8'));
  assert.equal(promotedPlan.candidate_promotion.authority_state, 'pending-review');
  assert.equal(promotedPlan.exact_next_command, '/review-task-plan promotion-candidate-fixture');

  const marker = JSON.parse(fs.readFileSync(path.join(root, result.review_state), 'utf8'));
  assert.equal(marker.last_event, 'candidate_promoted_pending_review');
  assert.equal(marker.candidate_promotion.review_status, 'pending');
  assert.deepEqual(marker.distinct_reviews, []);
});

test('promoteGeminiPlanCandidate refuses overwrite by default', () => {
  const root = makeProjectRoot();
  const candidate = writeGeminiPlanCandidate(fixtureDraft(), {
    projectRoot: process.cwd(),
    outputRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-candidate-')),
    timestamp: '2026-06-25T01:38:00Z'
  });
  const targetDir = path.join(root, '_dev', 'reports', 'analysis', 'harness-plan-output-candidates', candidate.plan.task_id);
  fs.mkdirSync(targetDir, { recursive: true });
  const manifestPath = path.join(targetDir, `${candidate.plan.task_id}__translation.json`);
  const jsonPath = path.join(targetDir, `${candidate.plan.task_id}__plan.json`);
  const mdPath = path.join(targetDir, `${candidate.plan.task_id}__plan.md`);
  fs.copyFileSync(candidate.paths.jsonPath, jsonPath);
  fs.copyFileSync(candidate.paths.markdownPath, mdPath);
  const manifest = JSON.parse(fs.readFileSync(candidate.paths.manifestPath, 'utf8'));
  manifest.json_path = path.relative(root, jsonPath);
  manifest.markdown_path = path.relative(root, mdPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  promoteGeminiPlanCandidate({ projectRoot: root, manifestPath, promotedBy: 'test' });
  assert.throws(
    () => promoteGeminiPlanCandidate({ projectRoot: root, manifestPath, promotedBy: 'test' }),
    /Refusing to overwrite existing promotion target/
  );
});
