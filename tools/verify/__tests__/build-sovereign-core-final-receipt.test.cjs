'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EVIDENCE, bound } = require('../build-sovereign-core-final-receipt.cjs');

test('final receipt evidence map covers P0-P5, final validation, and both final review families only', () => {
  assert.deepEqual(Object.keys(EVIDENCE), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'final']);
  assert.ok(EVIDENCE.final.some((path) => path.includes('fable')));
  assert.ok(EVIDENCE.final.some((path) => path.includes('gemini')));
  assert.ok(EVIDENCE.final.some((path) => path.includes('validation')));
  assert.doesNotMatch(JSON.stringify(EVIDENCE), /P6|P7|native-mcp|subagent-spawner|phase.?4/i);
});

test('final receipt evidence binding rejects symlinked artifacts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-final-receipt-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-final-receipt-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'evidence.md'), 'APPROVE\n');
  fs.symlinkSync(outside, path.join(root, 'redirect'));
  assert.throws(() => bound(root, 'redirect/evidence.md'), /symbolic link|outside project root/);
});
