'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FILES, PROMPT } = require('../build-p4-s3-review-bundle.cjs');

test('P4-S3 review bundle carries command evidence without requiring its own downstream gate', () => {
  assert.ok(FILES.includes('_dev/reports/analysis/sovereign-core-harness-validation__final.json'));
  assert.match(PROMPT, /concrete promotion gate does not exist yet by design/i);
  assert.match(PROMPT, /build and validate it only after both reviews approve/i);
  assert.doesNotMatch(PROMPT, /absence.*promotion-gate validation.*review blocker/i);
});
