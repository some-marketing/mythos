'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  NON_AUTHORITY_WARNING,
  classifyHarnessPlanOutput,
  loadContract
} = require('../lib/harness-plan-output-contract');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plan-output-'));
}

test('loadContract exposes non-authority preview warning', () => {
  const contract = loadContract(PROJECT_ROOT);
  assert.equal(contract.schema, 'HarnessPlanOutputContract/1.0');
  assert.equal(contract.authority.non_authority_warning, NON_AUTHORITY_WARNING);
});

test('classifyHarnessPlanOutput accepts an existing canonical task plan bundle without mutation', () => {
  const jsonPath = path.join(PROJECT_ROOT, '_dev/reports/analysis/task-plans/harness-plan-output-contracts__plan.json');
  const markdownPath = path.join(PROJECT_ROOT, '_dev/reports/analysis/task-plans/harness-plan-output-contracts__plan.md');
  const beforeJson = fs.readFileSync(jsonPath, 'utf8');
  const beforeMarkdown = fs.readFileSync(markdownPath, 'utf8');

  const result = classifyHarnessPlanOutput({
    jsonPath,
    markdownPath,
    harness: 'codex',
    category: 'repo_tool_mediated_writer'
  }, { projectRoot: PROJECT_ROOT });

  assert.equal(result.status, 'canonical');
  assert.equal(result.runnable, true);
  assert.equal(result.visual_warning, null);
  assert.equal(fs.readFileSync(jsonPath, 'utf8'), beforeJson);
  assert.equal(fs.readFileSync(markdownPath, 'utf8'), beforeMarkdown);
});

test('classifyHarnessPlanOutput marks markdown-only output as preview-only', () => {
  const dir = tmpDir();
  const markdownPath = path.join(dir, 'plan.md');
  fs.writeFileSync(markdownPath, '# Draft Plan\n\n```mermaid\ngraph TD\nA-->B\n```\n', 'utf8');
  const before = fs.readFileSync(markdownPath, 'utf8');

  const result = classifyHarnessPlanOutput({
    markdownPath,
    harness: 'gemini',
    category: 'review_only'
  }, { projectRoot: PROJECT_ROOT });

  assert.equal(result.status, 'preview_only');
  assert.equal(result.runnable, false);
  assert.equal(result.visual_warning, NON_AUTHORITY_WARNING);
  assert.match(result.issues[0].operator_message, /no canonical TaskPlan\/1.0 JSON/i);
  assert.equal(fs.readFileSync(markdownPath, 'utf8'), before);
});

test('classifyHarnessPlanOutput routes adapter-mediated prose to adapter-needed', () => {
  const result = classifyHarnessPlanOutput({
    harness: 'gemini',
    category: 'adapter_mediated_translator'
  }, { projectRoot: PROJECT_ROOT });

  assert.equal(result.status, 'adapter_needed');
  assert.equal(result.runnable, false);
  assert.equal(result.visual_warning, NON_AUTHORITY_WARNING);
  assert.equal(result.issues[0].recommended_route, 'adapter-review');
});

test('classifyHarnessPlanOutput reports operator-readable repair messages for schema-mismatched JSON', () => {
  const dir = tmpDir();
  const jsonPath = path.join(dir, 'bad-plan.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify({ schema: 'GeminiPlan/0.1', title: 'Draft' }, null, 2)}\n`, 'utf8');
  const before = fs.readFileSync(jsonPath, 'utf8');

  const result = classifyHarnessPlanOutput({
    jsonPath,
    harness: 'gemini',
    category: 'native_canonical_writer'
  }, { projectRoot: PROJECT_ROOT });

  assert.equal(result.status, 'repair_needed');
  assert.equal(result.runnable, false);
  assert.equal(result.visual_warning, NON_AUTHORITY_WARNING);
  assert.match(result.issues[0].operator_message, /not TaskPlan\/1.0/);
  assert.equal(fs.readFileSync(jsonPath, 'utf8'), before);
});

test('classifyHarnessPlanOutput marks unreadable JSON as invalid', () => {
  const dir = tmpDir();
  const jsonPath = path.join(dir, 'invalid.json');
  fs.writeFileSync(jsonPath, '{ nope', 'utf8');

  const result = classifyHarnessPlanOutput({ jsonPath }, { projectRoot: PROJECT_ROOT });

  assert.equal(result.status, 'invalid');
  assert.equal(result.runnable, false);
  assert.match(result.issues[0].operator_message, /could not be parsed/i);
});
