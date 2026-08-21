'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { runMythosCommand } = require('../mythos-command-runner.cjs');
const { loadCanonicalCommand } = require('../lib/command-registry.cjs');
const { resolveCommandAlias } = require('../lib/command-aliases.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('outward-inward has a canonical command specification', () => {
  const canonical = loadCanonicalCommand(ROOT, 'outward-inward');
  assert.ok(canonical);
  assert.equal(canonical.spec.id, 'outward-inward');
  assert.equal(canonical.spec.mode, 'FINDINGS_ONLY');
});

test('oil and chi resolve to outward-inward command authority', () => {
  for (const alias of ['oil', 'chi']) {
    const resolution = resolveCommandAlias(ROOT, alias);
    assert.equal(resolution.executionCommand, 'outward-inward');
    assert.equal(resolution.authoritySource, 'outward-inward');
  }
});

test('managed command resolution recognizes outward-inward aliases as canonical', () => {
  for (const alias of ['oil', 'chi']) {
    const result = runMythosCommand(ROOT, `/${alias} file:a file:b --purpose compare`, { write: false });
    assert.equal(result.exitCode, 2);
    assert.doesNotMatch(result.stderr, /Unknown/);
    assert.match(result.stderr, /canonical but has no deterministic executable handler/);
    assert.match(result.stderr, /resolves to \/outward-inward/);
  }
});

test('FINDINGS_ONLY contract explicitly prohibits repository writes', () => {
  const canonical = loadCanonicalCommand(ROOT, 'outward-inward').spec;
  const contract = JSON.stringify(canonical);
  assert.match(contract, /FINDINGS_ONLY and REVIEW_ONLY never write repository state/);
  assert.match(contract, /return the logical source manifest.*in-session without writing files/);
});
