#!/usr/bin/env node
'use strict';

// tools/soul-space/generate-blank-seed.js — generate a blank example
// subject-record conforming to the soul-space schema.
//
// "Blank" means: no pre-loaded attributes, no attestation, and an
// attributes object left empty for the caller's own domain vocabulary to
// fill in.
//
// Usage: node generate-blank-seed.js <subject_id> [authored_by]

const { computeContentHash } = require('./validate-soul-space.js');

function generateBlankSeed(subjectId, authoredBy, when) {
  const record = {
    subject_id: subjectId,
    attributes: {},
    version: '1.0.0',
    provenance_chain: [{ version: '1.0.0', who: authoredBy, why: 'genesis: blank example record, no pre-loaded content', when }]
  };
  record.content_hash = computeContentHash(record);
  return record;
}

module.exports = { generateBlankSeed };

if (require.main === module) {
  const [subjectId, authoredBy] = process.argv.slice(2);
  if (!subjectId) {
    process.stderr.write('usage: generate-blank-seed.js <subject_id> [authored_by]\n');
    process.exit(2);
  }
  const when = process.env.SEED_TIMESTAMP || new Date().toISOString();
  const seed = generateBlankSeed(subjectId, authoredBy || 'example-author', when);
  process.stdout.write(JSON.stringify(seed, null, 2) + '\n');
}
