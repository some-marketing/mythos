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

function validatePromptProvenanceReceipt(receipt, expectedPrompts = []) {
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
    }
    for (const promptId of observed.keys()) {
      if (!expected.has(promptId)) errors.push(`unexpected prompt receipt: ${promptId}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.receipt || !args.candidate) {
    process.stderr.write('Usage: validate-prompt-provenance-receipt.cjs --receipt <path> --candidate <candidate-or-framework-root>\n');
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
  try {
    expectedPrompts = loadExpectedPrompts(args.candidate);
  } catch (err) {
    process.stderr.write(`Unable to load candidate prompt inventory: ${err.message}\n`);
    process.exit(2);
  }
  const result = validatePromptProvenanceReceipt(receipt, expectedPrompts);
  if (!result.ok) {
    process.stderr.write(result.errors.join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('Prompt-provenance receipt: PASS\n');
}

if (require.main === module) main();

module.exports = { loadExpectedPrompts, validatePromptProvenanceReceipt };
