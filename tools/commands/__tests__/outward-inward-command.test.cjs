'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { runMythosCommand } = require('../mythos-command-runner.cjs');
const { loadCanonicalCommand } = require('../lib/command-registry.cjs');
const { resolveCommandAlias } = require('../lib/command-aliases.cjs');
const { isManaged } = require('../../codex/lib/managed-command-registry.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('outward-inward has a canonical command specification', () => {
  const canonical = loadCanonicalCommand(ROOT, 'outward-inward');
  assert.ok(canonical);
  assert.equal(canonical.spec.id, 'outward-inward');
  assert.equal(canonical.spec.mode, 'COORDINATOR');
});

test('oil and chi resolve to outward-inward command authority', () => {
  for (const alias of ['oil', 'chi']) {
    const resolution = resolveCommandAlias(ROOT, alias);
    assert.equal(resolution.executionCommand, 'outward-inward');
    assert.equal(resolution.authoritySource, 'outward-inward');
  }
});

test('agentic outward-inward aliases opt out of managed shell routing', () => {
  for (const alias of ['oil', 'chi']) {
    assert.equal(isManaged(alias, ROOT), false);
  }
  for (const existingAlias of ['help-me-route', 'blueprint', 'el']) {
    assert.equal(isManaged(existingAlias, ROOT), true);
  }
});

test('direct deterministic runner reports outward-inward as agentic', () => {
  for (const alias of ['oil', 'chi']) {
    const result = runMythosCommand(ROOT, `/${alias} file:a file:b --purpose compare`, { write: false });
    assert.equal(result.exitCode, 2);
    assert.doesNotMatch(result.stderr, /Unknown/);
    assert.match(result.stderr, /canonical but has no deterministic executable handler/);
    assert.match(result.stderr, /resolves to \/outward-inward/);
  }
});

test('coordinator contract keeps default analysis write-free', () => {
  const canonical = loadCanonicalCommand(ROOT, 'outward-inward').spec;
  const contract = JSON.stringify(canonical);
  assert.doesNotMatch(contract, /--mode PATCH_ALLOWED/);
  assert.match(contract, /delegated FINDINGS_ONLY and REVIEW_ONLY lanes never write repository state/);
  assert.match(contract, /return the logical source manifest.*in-session/);
  assert.match(contract, /rewriter actor id and attester actor id/);
  assert.match(contract, /block execution when they match or either identity is missing/);
});
