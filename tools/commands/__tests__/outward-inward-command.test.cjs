'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runMythosCommand } = require('../mythos-command-runner.cjs');
const { loadCanonicalCommand } = require('../lib/command-registry.cjs');
const { resolveCommandAlias } = require('../lib/command-aliases.cjs');
const { isManaged } = require('../../codex/lib/managed-command-registry.js');
const { loadSourceEnvelope, validatePromptProvenanceReceipt } = require('../validate-prompt-provenance-receipt.cjs');

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

test('coordinator contract keeps default analysis write-free and reports execution capability honestly', () => {
  const canonical = loadCanonicalCommand(ROOT, 'outward-inward').spec;
  const contract = JSON.stringify(canonical);
  assert.doesNotMatch(contract, /--mode PATCH_ALLOWED/);
  assert.match(contract, /delegated FINDINGS_ONLY and REVIEW_ONLY lanes never write repository state/);
  assert.match(contract, /return the logical source manifest.*in-session/);
  assert.match(contract, /rewriter_actor_id.*attester_actor_id/);
  assert.match(contract, /validate-prompt-provenance-receipt\.cjs/);
  assert.equal(canonical.capability_status.prompt_receipt_validator, 'ADVISORY');
  assert.equal(canonical.capability_status.comparative_execution, 'ABSENT');
  assert.match(contract, /record execution_blocked until a registered runner invokes the provenance validator/);
});

test('prompt-provenance receipt validator rejects missing or matching identities', () => {
  const expectedPrompts = [
    { prompt_id: '01_SCOPE', prompt_sha256: 'a'.repeat(64) },
    { prompt_id: '02_REVIEW', prompt_sha256: 'b'.repeat(64) }
  ];
  const expectedSourceEnvelope = {
    source_envelope_id: 'chi-source-envelope',
    source_envelope_sha256: 'c'.repeat(64),
    sources: {
      'source-a': 'd'.repeat(64),
      'source-b': 'e'.repeat(64)
    },
    prompt_sources: {
      '01_SCOPE': ['source-a'],
      '02_REVIEW': ['source-b']
    }
  };
  const receipt = {
    schema: 'PromptProvenanceReceipt/1.0',
    prompts: [{
      prompt_id: '01_SCOPE',
      prompt_sha256: 'a'.repeat(64),
      source_envelope_id: 'chi-source-envelope',
      source_envelope_sha256: 'c'.repeat(64),
      source_revisions: [{ source_id: 'source-a', content_sha256: 'd'.repeat(64) }],
      rewriter_actor_id: 'rewriter',
      rewriter_model_provider_family: 'anthropic',
      attester_actor_id: 'rewriter',
      attester_model_provider_family: 'Anthropic ',
      attestation: 'pass'
    }]
  };
  assert.equal(validatePromptProvenanceReceipt(receipt, [], expectedSourceEnvelope).ok, false);
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts).ok, false);
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope).ok, false);
  receipt.prompts[0].attester_actor_id = 'attester';
  receipt.prompts[0].attester_model_provider_family = 'openai';
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope).ok, false);
  receipt.prompts.push({
    prompt_id: '02_REVIEW',
    prompt_sha256: 'stale',
    source_envelope_id: 'chi-source-envelope',
    source_envelope_sha256: 'stale',
    source_revisions: [{ source_id: 'source-a', content_sha256: 'd'.repeat(64) }],
    rewriter_actor_id: 'rewriter',
    rewriter_model_provider_family: 'anthropic',
    attester_actor_id: 'attester',
    attester_model_provider_family: 'openai',
    attestation: 'pass'
  });
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope).ok, false);
  receipt.prompts[1].prompt_sha256 = 'b'.repeat(64);
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope).ok, false);
  receipt.prompts[1].source_envelope_sha256 = 'c'.repeat(64);
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope).ok, false);
  receipt.prompts[1].source_revisions = [{ source_id: 'source-b', content_sha256: 'e'.repeat(64) }];
  assert.equal(validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope).ok, true);
});

test('source envelope loader requires hashed source revisions', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-source-envelope-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const manifestPath = path.join(tempRoot, 'source-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema: 'PromptProvenanceSourceManifest/1.0',
    source_envelope_id: 'chi-source-envelope',
    sources: [{ source_id: 'source-a', content_sha256: 'd'.repeat(64) }],
    prompt_sources: { '01_SCOPE': ['source-a'] }
  }));
  const envelope = loadSourceEnvelope(manifestPath);
  assert.equal(envelope.source_envelope_id, 'chi-source-envelope');
  assert.match(envelope.source_envelope_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(envelope.prompt_sources, { '01_SCOPE': ['source-a'] });
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema: 'PromptProvenanceSourceManifest/1.0',
    source_envelope_id: 'chi-source-envelope',
    sources: [],
    prompt_sources: {}
  }));
  assert.throws(() => loadSourceEnvelope(manifestPath), /at least one source/);
});
