#!/usr/bin/env node
'use strict';

/**
 * Frozen-fixture rerun for the Mythos Self-Improving Loop Protocol grade-record
 * closure gate (law-candidate invariant 6, seam: grade-record + closure gate).
 *
 * Walks the frozen fixture corpus under fixtures/{accept,reject}/**.frozen.json
 * and asserts each fixture yields its EXPECTED closure outcome under
 * assertClosable(): fixtures in accept/ MUST be closable; fixtures in reject/
 * MUST throw. Directory placement IS the expected-outcome declaration, so the
 * frozen files stay pure grade records.
 *
 * Also proves the grade-record JSON Schema is a valid JSON Schema (ajv compiles
 * it — a malformed schema throws) and that every accept/ fixture validates
 * against it.
 *
 * Run: node tools/kernel/loop-protocol/rerun-fixtures.cjs
 * Exit 0 = every fixture matched its expected verdict AND the schema is valid.
 */

const fs = require('fs');
const path = require('path');

const { assertClosable } = require('../../planning/lib/loop-grade-record.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  'workspace',
  'schemas',
  'loop-grade-record.schema.json'
);

/** Recursively collect *.frozen.json files under a directory. */
function collectFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFixtures(full));
    } else if (entry.isFile() && entry.name.endsWith('.frozen.json')) {
      out.push(full);
    }
  }
  return out.sort();
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const results = [];
  let failures = 0;

  // ---- (A) Prove the schema is a valid JSON Schema (ajv compiles it). --------
  const Ajv2020 = require('ajv/dist/2020');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = readJson(SCHEMA_PATH);
  let validateSchema;
  try {
    validateSchema = ajv.compile(schema);
    console.log('SCHEMA OK    valid JSON Schema: ' + path.relative(process.cwd(), SCHEMA_PATH));
  } catch (err) {
    console.error('SCHEMA FAIL  ' + err.message);
    process.exit(1);
  }

  // ---- (B) Rerun the closure gate across the frozen corpus. ------------------
  const buckets = [
    { dir: path.join(FIXTURES_DIR, 'accept'), expect: 'accept' },
    { dir: path.join(FIXTURES_DIR, 'reject'), expect: 'reject' }
  ];

  let total = 0;
  for (const bucket of buckets) {
    for (const file of collectFixtures(bucket.dir)) {
      total += 1;
      const rel = path.relative(process.cwd(), file);
      let record;
      try {
        record = readJson(file);
      } catch (err) {
        failures += 1;
        console.error('PARSE  FAIL  ' + rel + ' :: ' + err.message);
        continue;
      }

      // Actual closure outcome.
      let actual;
      let detail = '';
      try {
        assertClosable(record);
        actual = 'accept';
      } catch (err) {
        actual = 'reject';
        detail = err.message;
      }

      // Accept fixtures additionally must validate against the schema.
      if (bucket.expect === 'accept') {
        const schemaOk = validateSchema(record);
        if (!schemaOk) {
          failures += 1;
          const msg = ajv.errorsText(validateSchema.errors, { separator: '; ' });
          console.error('SCHEMA FAIL  ' + rel + ' :: ' + msg);
          results.push({ file: rel, expect: bucket.expect, actual, schemaOk: false });
          continue;
        }
      }

      const pass = actual === bucket.expect;
      if (!pass) failures += 1;
      results.push({ file: rel, expect: bucket.expect, actual, pass });
      const tag = pass ? 'PASS' : 'FAIL';
      const line =
        tag +
        '   expect=' +
        bucket.expect +
        ' actual=' +
        actual +
        '  ' +
        rel +
        (actual === 'reject' && detail ? '\n             reason: ' + detail : '');
      if (pass) console.log(line);
      else console.error(line);
    }
  }

  console.log('\n' + (failures === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + (total - failures) + '/' + total + ' fixtures matched expected verdict.');
  process.exit(failures === 0 ? 0 : 1);
}

main();
