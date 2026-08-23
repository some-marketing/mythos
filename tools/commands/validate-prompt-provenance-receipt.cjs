#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../workspace/lib/args');

function validatePromptProvenanceReceipt(receipt) {
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
    for (const field of ['prompt_id', 'rewriter_actor_id', 'attester_actor_id']) {
      if (typeof prompt[field] !== 'string' || prompt[field].trim() === '') {
        errors.push(`${label}.${field} must be a non-empty string`);
      }
    }
    if (prompt.rewriter_actor_id && prompt.rewriter_actor_id === prompt.attester_actor_id) {
      errors.push(`${label} rewriter_actor_id and attester_actor_id must be distinct`);
    }
    if (prompt.attestation !== 'pass') {
      errors.push(`${label}.attestation must be pass`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.receipt) {
    process.stderr.write('Missing --receipt <path>\n');
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
  const result = validatePromptProvenanceReceipt(receipt);
  if (!result.ok) {
    process.stderr.write(result.errors.join('\n') + '\n');
    process.exit(1);
  }
  process.stdout.write('Prompt-provenance receipt: PASS\n');
}

if (require.main === module) main();

module.exports = { validatePromptProvenanceReceipt };
