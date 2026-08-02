#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readMarkdownBinding,
  renderNarrativeContractPrompt
} = require('../review-task-plan-narrative');
const {
  resolveDeclaredTier
} = require('../../../kernel/hooks/session-start-tier-stamp.cjs');

const binding = {
  schema: 'TaskPlanNarrativeCompletion/1.0',
  run_id: 'review-test',
  plan_content_hash: 'abc123',
  status: 'complete'
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-narrative-marker-'));

for (const marker of ['mythos_narrative_completion', 'sm_os_narrative_completion']) {
  const filePath = path.join(tempDir, `${marker}.md`);
  fs.writeFileSync(filePath, `<!-- ${marker}: ${JSON.stringify(binding)} -->\n`);
  assert.deepStrictEqual(readMarkdownBinding(filePath), binding);
}

const prompt = renderNarrativeContractPrompt(process.cwd(), {
  run_id: 'review-test',
  plan_content_hash: 'abc123',
  plan_json_sha256: 'json123',
  plan_markdown_sha256: 'markdown123',
  plan_json_path: path.join(process.cwd(), 'plan.json'),
  plan_markdown_path: path.join(process.cwd(), 'plan.md'),
  canonical_json: path.join(process.cwd(), 'review.json'),
  canonical_markdown: path.join(process.cwd(), 'review.md'),
  scratch_json: path.join(process.cwd(), 'scratch.json'),
  scratch_markdown: path.join(process.cwd(), 'scratch.md')
});

assert.match(prompt, /mythos_narrative_completion/);
assert.doesNotMatch(prompt, /sm_os_narrative_completion/);
assert.strictEqual(resolveDeclaredTier({ mythos_process_tier: 'associate' }), 'associate');
assert.strictEqual(resolveDeclaredTier({ sm_os_process_tier: 'scaffold' }), 'scaffold');

fs.rmSync(tempDir, { recursive: true, force: true });
process.stdout.write('review-task-plan-narrative marker tests passed\n');
