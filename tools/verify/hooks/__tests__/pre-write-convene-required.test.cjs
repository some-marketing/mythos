#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluate,
  normalizeRelPath,
  pathMatchesAuthorized,
  receiptCoversPath
} = require('../pre-write-convene-required.cjs');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error(`FAIL: ${label} — ${err.message}`);
  }
}

const root = process.cwd();
const receiptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convene-receipt-test-'));
const now = Date.parse('2026-06-10T18:00:00Z');

function writeReceipt(name, receipt) {
  fs.writeFileSync(path.join(receiptsDir, name), JSON.stringify(receipt), 'utf8');
}

function receipt(paths, expires = '2026-06-11T18:00:00Z') {
  return {
    schema: 'ConveneReceipt/1.0',
    verdict: 'approved',
    operator_ratified: true,
    authorized_paths: paths,
    expires
  };
}

check('normalizes absolute repo path', () => {
  assert.equal(
    normalizeRelPath(path.join(root, 'instructions/canonical/x.yaml'), root),
    'instructions/canonical/x.yaml'
  );
});

check('exact path coverage', () => {
  assert.equal(pathMatchesAuthorized('instructions/canonical/x.yaml', 'instructions/canonical/x.yaml'), true);
  assert.equal(pathMatchesAuthorized('instructions/canonical/y.yaml', 'instructions/canonical/x.yaml'), false);
});

check('directory path coverage requires slash', () => {
  assert.equal(pathMatchesAuthorized('instructions/canonical/', 'instructions/canonical/x.yaml'), true);
  assert.equal(pathMatchesAuthorized('instructions/canonical', 'instructions/canonical/x.yaml'), false);
});

check('valid receipt covers path', () => {
  assert.equal(receiptCoversPath(receipt(['instructions/canonical/']), 'instructions/canonical/x.yaml', now), true);
});

check('expired receipt does not cover path', () => {
  assert.equal(receiptCoversPath(receipt(['instructions/canonical/'], '2026-06-09T18:00:00Z'), 'instructions/canonical/x.yaml', now), false);
});

check('protected path blocks without receipt', () => {
  const result = evaluate(
    { file_path: 'instructions/canonical/x.yaml', content: 'ok' },
    { root, receiptsDir, nowMs: now }
  );
  assert.equal(result.allow, false);
  assert.match(result.message, /requires a live ConveneReceipt/);
});

check('protected path allows with matching receipt', () => {
  writeReceipt('good.json', receipt(['instructions/canonical/x.yaml']));
  const result = evaluate(
    { file_path: 'instructions/canonical/x.yaml', content: 'ok' },
    { root, receiptsDir, nowMs: now }
  );
  assert.equal(result.allow, true);
});

check('receipt for path A does not unlock path B', () => {
  const result = evaluate(
    { file_path: 'instructions/canonical/y.yaml', content: 'ok' },
    { root, receiptsDir, nowMs: now }
  );
  assert.equal(result.allow, false);
});

check('keyword in report is advisory, not blocking', () => {
  const result = evaluate(
    { file_path: '_dev/reports/analysis/report.md', content: 'kernel convene council lobe' },
    { root, receiptsDir, nowMs: now }
  );
  assert.equal(result.allow, true);
  assert.match(result.notice, /governance-adjacent/);
});

check('model-typeable old override does not unlock protected path', () => {
  const legacyOverride = [['CONVENE', 'OVERRIDE'].join('_'), 'operator-approved'].join(': ');
  const result = evaluate(
    { file_path: '.claude/settings.json', content: legacyOverride },
    { root, receiptsDir, nowMs: now }
  );
  assert.equal(result.allow, false);
});

fs.rmSync(receiptsDir, { recursive: true, force: true });

console.log(`\npre-write convene gate: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
