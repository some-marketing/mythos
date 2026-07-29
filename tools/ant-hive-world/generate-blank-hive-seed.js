#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/generate-blank-hive-seed.js — generate a blank-start
// hive-mind seed: empty hive_state (no pre-loaded instinct/behavior), per
// the operator's "let them figure it out through experience" resolution.
//
// Usage: node generate-blank-hive-seed.js <identity> [authored_by]

function generateBlankHiveSeed(identity, authoredBy, when) {
  return {
    identity,
    hive_state: { resources: {}, territory: {}, worker_dispatch_state: {} },
    knock_equivalent: { reachable: true },
    dignity_floor_equivalent: {},
    version: '1.0.0',
    provenance: { who: authoredBy, why: 'genesis: blank-start hive seed, no pre-loaded instinct/behavior content', when }
  };
}

module.exports = { generateBlankHiveSeed };

if (require.main === module) {
  const [identity, authoredBy] = process.argv.slice(2);
  if (!identity) {
    process.stderr.write('usage: generate-blank-hive-seed.js <identity> [authored_by]\n');
    process.exit(2);
  }
  const when = process.env.SEED_TIMESTAMP || new Date().toISOString();
  const seed = generateBlankHiveSeed(identity, authoredBy || 'claude-sonnet-5', when);
  process.stdout.write(JSON.stringify(seed, null, 2) + '\n');
}
