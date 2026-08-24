#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseArgs } = require('../workspace/lib/args');

function normalizeIdentity(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function loadExpectedPrompts(candidatePath) {
  const resolved = path.resolve(candidatePath);
  const frameworkRoot = fs.existsSync(path.join(resolved, 'proposed_framework', 'manifest.json'))
    ? path.join(resolved, 'proposed_framework')
    : resolved;
  const manifest = JSON.parse(fs.readFileSync(path.join(frameworkRoot, 'manifest.json'), 'utf8'));
  const promptIds = Object.values(manifest.prompt_chain || {}).flat();
  return promptIds.map((promptId) => {
    const promptPath = path.join(frameworkRoot, 'prompts', `${promptId}.md`);
    return {
      prompt_id: promptId,
      prompt_sha256: crypto.createHash('sha256').update(fs.readFileSync(promptPath)).digest('hex')
    };
  });
}

function loadSourceEnvelope(sourceManifestPath) {
  const bytes = fs.readFileSync(path.resolve(sourceManifestPath));
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schema !== 'PromptProvenanceSourceManifest/1.0') {
    throw new Error('source manifest schema must be PromptProvenanceSourceManifest/1.0');
  }
  if (typeof manifest.source_envelope_id !== 'string' || manifest.source_envelope_id.trim() === '') {
    throw new Error('source manifest source_envelope_id must be a non-empty string');
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('source manifest sources must contain at least one source');
  }
  const sources = new Map();
  for (const [index, source] of manifest.sources.entries()) {
    if (typeof source.source_id !== 'string' || source.source_id.trim() === '') {
      throw new Error(`source manifest sources[${index}].source_id must be a non-empty string`);
    }
    if (typeof source.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.content_sha256)) {
      throw new Error(`source manifest sources[${index}].content_sha256 must be a SHA-256 digest`);
    }
    if (sources.has(source.source_id)) throw new Error(`source manifest source_id is duplicated: ${source.source_id}`);
    sources.set(source.source_id, source.content_sha256);
  }
  if (!manifest.prompt_sources || typeof manifest.prompt_sources !== 'object' || Array.isArray(manifest.prompt_sources)) {
    throw new Error('source manifest prompt_sources must map prompt ids to source ids');
  }
  for (const [promptId, sourceIds] of Object.entries(manifest.prompt_sources)) {
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new Error(`source manifest prompt_sources.${promptId} must contain at least one source id`);
    }
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new Error(`source manifest prompt_sources.${promptId} contains duplicate source ids`);
    }
    for (const sourceId of sourceIds) {
      if (!sources.has(sourceId)) {
        throw new Error(`source manifest prompt_sources.${promptId} references unknown source: ${sourceId}`);
      }
    }
  }
  return {
    source_envelope_id: manifest.source_envelope_id,
    source_envelope_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sources: Object.fromEntries(sources),
    prompt_sources: manifest.prompt_sources
  };
}

function validatePromptProvenanceReceipt(receipt, expectedPrompts = [], expectedSourceEnvelope = null) {
  const errors = [];
  if (!receipt || receipt.schema !== 'PromptProvenanceReceipt/1.0') {
    errors.push('schema must be PromptProvenanceReceipt/1.0');
  }
  if (!receipt || !Array.isArray(receipt.prompts) || receipt.prompts.length === 0) {
    errors.push('prompts must contain at least one attested prompt');
    return { ok: false, errors };
  }
  for (const [index, prompt] of receipt.prompts.entries()) {
    const label = `prompts[${index}]`;
    for (const field of [
      'prompt_id',
      'prompt_sha256',
      'source_envelope_id',
      'source_envelope_sha256',
      'rewriter_actor_id',
      'rewriter_model_provider_family',
      'attester_actor_id',
      'attester_model_provider_family'
    ]) {
      if (typeof prompt[field] !== 'string' || prompt[field].trim() === '') {
        errors.push(`${label}.${field} must be a non-empty string`);
      }
    }
    if (normalizeIdentity(prompt.rewriter_actor_id) === normalizeIdentity(prompt.attester_actor_id)) {
      errors.push(`${label} rewriter_actor_id and attester_actor_id must be distinct`);
    }
    if (normalizeIdentity(prompt.rewriter_model_provider_family) === normalizeIdentity(prompt.attester_model_provider_family)) {
      errors.push(`${label} rewriter_model_provider_family and attester_model_provider_family must be distinct`);
    }
    if (prompt.attestation !== 'pass') {
      errors.push(`${label}.attestation must be pass`);
    }
    if (expectedSourceEnvelope) {
      if (prompt.source_envelope_id !== expectedSourceEnvelope.source_envelope_id) {
        errors.push(`${label}.source_envelope_id does not match the current source manifest`);
      }
      if (prompt.source_envelope_sha256 !== expectedSourceEnvelope.source_envelope_sha256) {
        errors.push(`${label}.source_envelope_sha256 does not match the current source manifest`);
      }
      const expectedSourceIds = expectedSourceEnvelope.prompt_sources?.[prompt.prompt_id];
      if (!Array.isArray(expectedSourceIds) || expectedSourceIds.length === 0) {
        errors.push(`${label} has no source assignment in the current source manifest`);
      } else if (!Array.isArray(prompt.source_revisions) || prompt.source_revisions.length === 0) {
        errors.push(`${label}.source_revisions must contain the source revisions assigned to this prompt`);
      } else {
        const observedSources = new Map();
        for (const [sourceIndex, source] of prompt.source_revisions.entries()) {
          if (!source || typeof source.source_id !== 'string' ||
              typeof source.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.content_sha256)) {
            errors.push(`${label}.source_revisions[${sourceIndex}] must contain source_id and content_sha256`);
            continue;
          }
          if (observedSources.has(source.source_id)) errors.push(`${label} contains duplicate source revision: ${source.source_id}`);
          observedSources.set(source.source_id, source.content_sha256);
        }
        for (const sourceId of expectedSourceIds) {
          if (!observedSources.has(sourceId)) errors.push(`${label} is missing assigned source revision: ${sourceId}`);
          else if (observedSources.get(sourceId) !== expectedSourceEnvelope.sources?.[sourceId]) {
            errors.push(`${label} has a stale source revision: ${sourceId}`);
          }
        }
        for (const sourceId of observedSources.keys()) {
          if (!expectedSourceIds.includes(sourceId)) errors.push(`${label} includes an unassigned source revision: ${sourceId}`);
        }
      }
    }
  }
  if (!expectedSourceEnvelope ||
      typeof expectedSourceEnvelope.source_envelope_id !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(expectedSourceEnvelope.source_envelope_sha256 || '') ||
      !expectedSourceEnvelope.sources || !expectedSourceEnvelope.prompt_sources) {
    errors.push('expected source envelope must include identity, digest, sources, and prompt assignments');
  }
  if (!Array.isArray(expectedPrompts) || expectedPrompts.length === 0) {
    errors.push('expected prompt inventory must contain at least one runnable prompt');
  } else {
    const expected = new Map(expectedPrompts.map((prompt) => [prompt.prompt_id, prompt.prompt_sha256]));
    const observed = new Map();
    for (const prompt of receipt.prompts) {
      if (observed.has(prompt.prompt_id)) errors.push(`duplicate prompt receipt: ${prompt.prompt_id}`);
      observed.set(prompt.prompt_id, prompt.prompt_sha256);
    }
    for (const [promptId, promptSha256] of expected) {
      if (!observed.has(promptId)) errors.push(`missing prompt receipt: ${promptId}`);
      else if (observed.get(promptId) !== promptSha256) errors.push(`stale prompt hash: ${promptId}`);
      if (!Array.isArray(expectedSourceEnvelope?.prompt_sources?.[promptId])) {
        errors.push(`missing source assignment for expected prompt: ${promptId}`);
      }
    }
    for (const promptId of observed.keys()) {
      if (!expected.has(promptId)) errors.push(`unexpected prompt receipt: ${promptId}`);
    }
    for (const promptId of Object.keys(expectedSourceEnvelope?.prompt_sources || {})) {
      if (!expected.has(promptId)) errors.push(`unexpected prompt source assignment: ${promptId}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.receipt || !args.candidate || !args['source-manifest']) {
    process.stderr.write('Usage: validate-prompt-provenance-receipt.cjs --receipt <path> --candidate <candidate-or-framework-root> --source-manifest <path>\n');
    process.exit(2);
  }
  const receiptPath = path.resolve(args.receipt);
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`Unable to read prompt-provenance receipt: ${err.message}\n`);
    process.exit(2);
  }
  let expectedPrompts;
  let expectedSourceEnvelope;
  try {
    expectedPrompts = loadExpectedPrompts(args.candidate);
    expectedSourceEnvelope = loadSourceEnvelope(args['source-manifest']);
  } catch (err) {
    process.stderr.write(`Unable to load prompt provenance inputs: ${err.message}\n`);
    process.exit(2);
  }
  const result = validatePromptProvenanceReceipt(receipt, expectedPrompts, expectedSourceEnvelope);
  if (!result.ok) {
    process.stderr.write(result.errors.join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('Prompt-provenance receipt: PASS\n');
}

if (require.main === module) main();

module.exports = { loadExpectedPrompts, loadSourceEnvelope, validatePromptProvenanceReceipt };
