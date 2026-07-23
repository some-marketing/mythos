#!/usr/bin/env node
'use strict';

/**
 * Tests for approval-gate-stub.js
 * Run: node tools/oversight/__tests__/approval-gate-stub.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { requiresApproval, recordApproval } = require('../approval-gate-stub.js');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    fail += 1;
    process.stderr.write(`  FAIL  ${name}\n    ${err.stack || err.message}\n`);
  }
}

check('1. Missing risk_tier and review_lane requires approval', () => {
  const result = requiresApproval({});
  assert.strictEqual(result.requiresApproval, true);
});

check('2. High risk_tier requires approval', () => {
  const result = requiresApproval({ risk_tier: 'high' });
  assert.strictEqual(result.requiresApproval, true);
});

check('3. Critical risk_tier requires approval', () => {
  const result = requiresApproval({ risk_tier: 'CRITICAL' });
  assert.strictEqual(result.requiresApproval, true);
});

check('4. Low risk_tier does not require approval', () => {
  const result = requiresApproval({ risk_tier: 'low' });
  assert.strictEqual(result.requiresApproval, false);
});

check('5. Medium risk_tier does not require approval', () => {
  const result = requiresApproval({ risk_tier: 'Medium' });
  assert.strictEqual(result.requiresApproval, false);
});

check('6. Unrecognized risk_tier fails closed (requires approval)', () => {
  const result = requiresApproval({ risk_tier: 'unknown-value' });
  assert.strictEqual(result.requiresApproval, true);
});

check('7. review_lane alone (no risk_tier) avoids the missing-both case', () => {
  const result = requiresApproval({ review_lane: 'standard' });
  // review_lane present but risk_tier absent -> falls to "unrecognized" tier ('') path,
  // which fails closed.
  assert.strictEqual(result.requiresApproval, true);
});

check('8. recordApproval appends and persists an approval entry', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-gate-test-'));
  const approvalsFile = path.join(tmpDir, 'approvals.json');

  const entry1 = recordApproval('plan-1', 'operator', 'first approval', approvalsFile);
  assert.strictEqual(entry1.plan_id, 'plan-1');
  assert.strictEqual(entry1.approved_by, 'operator');
  assert.strictEqual(entry1.note, 'first approval');

  recordApproval('plan-2', 'operator', null, approvalsFile);

  const log = JSON.parse(fs.readFileSync(approvalsFile, 'utf8'));
  assert.strictEqual(log.schema, 'ApprovalLog/1.0');
  assert.strictEqual(log.approvals.length, 2);
  assert.strictEqual(log.approvals[1].plan_id, 'plan-2');
});

check('9. recordApproval requires planId and approvedBy', () => {
  assert.throws(() => recordApproval(null, 'operator'));
  assert.throws(() => recordApproval('plan-x', null));
});

process.stdout.write(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
