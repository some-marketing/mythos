'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FILES, PROMPT, resolveInput, resolveOutput } = require('../build-sovereign-core-final-review-bundle.cjs');

test('final review bundle covers P0-P5 closure without circular downstream artifacts', () => {
  const files = JSON.stringify(FILES);
  for (const token of ['p0-', 'p4-s0-', 'custody-pass4', 'p3-receipt', 'p4-s3-soak', 'native-promotion-gate', 'rollback-proof', 'p5-receipt', 'hardening-gradient', 'perplexity', 'validation__final']) {
    assert.match(files, new RegExp(token));
  }
  assert.doesNotMatch(files, /final-fable-review|final-gemini-review|final-receipt\.json|run-debrief__sovereign|task-outcomes/);
  assert.doesNotMatch(files, /P6|P7|native-mcp|subagent-spawner|phase.?4/i);
  assert.match(PROMPT, /downstream of this independent approval/i);
  assert.match(PROMPT, /do not block merely because those downstream closeout artifacts are absent/i);
});

test('final review bundle rejects symlinked input and output parents', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-final-review-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-final-review-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'private.md'), 'private\n');
  fs.symlinkSync(outside, path.join(root, 'redirect'));
  assert.throws(() => resolveInput(root, 'redirect/private.md'), /symbolic link|outside root/);
  assert.throws(() => resolveOutput(root, 'redirect/review.md'), /symbolic link|outside root/);
});
