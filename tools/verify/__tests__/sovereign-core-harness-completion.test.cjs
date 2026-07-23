'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { approvedArtifact } = require('../sovereign-core-harness-completion.cjs');

test('completion auditor accepts explicit approval envelopes and rejects blocking text', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-completion-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'approved.json'), JSON.stringify({ response_text: 'APPROVE\nNo blockers.' }));
  fs.writeFileSync(path.join(root, 'approved.md'), '# Review\n\nVerdict: **APPROVED**\n');
  fs.writeFileSync(path.join(root, 'blocked.md'), 'BLOCK\nMissing evidence.\n');
  fs.writeFileSync(path.join(root, 'contradictory.md'), 'BLOCK\nThe repair may later earn approval.\nVerdict: APPROVE\n');
  fs.writeFileSync(path.join(root, 'contradictory.json'), JSON.stringify({ response_text: 'BLOCK\nVerdict: APPROVE\n' }));
  assert.equal(approvedArtifact(root, 'approved.json'), true);
  assert.equal(approvedArtifact(root, 'approved.md'), true);
  assert.equal(approvedArtifact(root, 'blocked.md'), false);
  assert.equal(approvedArtifact(root, 'contradictory.md'), false);
  assert.equal(approvedArtifact(root, 'contradictory.json'), false);
});

test('completion auditor rejects approval reached through a symlink', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-completion-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-completion-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'approval.md'), 'APPROVE\n');
  fs.symlinkSync(path.join(outside, 'approval.md'), path.join(root, 'approval.md'));
  assert.equal(approvedArtifact(root, 'approval.md'), false);
});
