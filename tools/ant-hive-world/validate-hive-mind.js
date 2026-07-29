#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/validate-hive-mind.js — hive-mind schema validator.
//
// Deliberately minimal: this schema does not claim an immutable true-self
// layer, so there is no content-hash recomputation here. What IS checked:
// schema shape, and (for seed documents specifically) that no pre-loaded
// instinct/behavior content exists at creation -- per the "let them figure
// it out through experience" design intent (see README.md).

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const HIVE_MIND_SCHEMA = require('./schema/hive-mind.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateShape = ajv.compile(HIVE_MIND_SCHEMA);

function validateHiveMind(doc) {
  const errors = [];
  const shapeValid = validateShape(doc);
  if (!shapeValid) {
    for (const e of validateShape.errors || []) {
      errors.push({ invariant: 'SCHEMA_SHAPE', message: `${e.instancePath || '(root)'} ${e.message}` });
    }
  }
  return { valid: errors.length === 0, errors };
}

// G-NO-PRELOADED-INSTINCT: a freshly-generated seed must have empty
// operational state -- no foraging algorithms, no behavior heuristics,
// nothing that would count as instinct handed to the hive at creation.
function isBlankSeed(doc) {
  const errors = [];
  const hs = doc.hive_state || {};
  for (const key of ['resources', 'territory', 'worker_dispatch_state']) {
    const val = hs[key];
    if (val && Object.keys(val).length > 0) {
      errors.push({
        invariant: 'G_NO_PRELOADED_INSTINCT',
        message: `hive_state.${key} is non-empty at seed time (${JSON.stringify(val)}). A blank-start seed must not carry pre-loaded behavioral/operational content.`
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateHiveMind, isBlankSeed };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('usage: validate-hive-mind.js <hive-mind.json> [--seed]\n');
    process.exit(2);
  }
  const doc = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
  const shapeResult = validateHiveMind(doc);
  const out = { shape: shapeResult };
  if (process.argv.includes('--seed')) {
    out.blank_seed = isBlankSeed(doc);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  const allValid = shapeResult.valid && (!out.blank_seed || out.blank_seed.valid);
  process.exit(allValid ? 0 : 1);
}
