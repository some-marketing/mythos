#!/usr/bin/env node
'use strict';

/**
 * Unit tests for the once-per-session emission dedupe.
 * Stdlib-only — run: node tools/kernel/hooks/__tests__/once-per-session.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { shouldEmit, STATE_DIR } = require('../lib/once-per-session.cjs');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
  } catch {
    fail++;
    console.error(`  FAIL: ${label} — got "${actual}", expected "${expected}"`);
  }
}

const SID = `test-once-${process.pid}`;
const SID2 = `${SID}-b`;
const stateFile = (sid) => path.join(STATE_DIR, `${sid}.json`);

function cleanup() {
  for (const sid of [SID, SID2]) {
    try { fs.unlinkSync(stateFile(sid)); } catch { /* absent is fine */ }
  }
}
cleanup();

// First emission fires; second is silent; distinct keys are independent.
check('first emit fires', shouldEmit(SID, 'debrief-reminder'), true);
check('repeat is silent', shouldEmit(SID, 'debrief-reminder'), false);
check('third is silent', shouldEmit(SID, 'debrief-reminder'), false);
check('distinct key fires', shouldEmit(SID, 'plan-mode-notice'), true);
check('distinct key repeat silent', shouldEmit(SID, 'plan-mode-notice'), false);

// New session resets.
check('new session fires again', shouldEmit(SID2, 'debrief-reminder'), true);

// FAIL OPEN: missing identifiers, corrupt state, unwritable state never suppress.
check('no session id -> emit', shouldEmit('', 'debrief-reminder'), true);
check('no key -> emit', shouldEmit(SID, ''), true);
fs.writeFileSync(stateFile(SID), 'not json at all');
check('corrupt state -> emit (fail open)', shouldEmit(SID, 'debrief-reminder'), true);
check('corrupt state recovered -> dedupes again', shouldEmit(SID, 'debrief-reminder'), false);

// Session ids are sanitized into safe filenames (no path traversal).
const evil = '../../escape';
check('traversal id still works', shouldEmit(evil, 'k'), true);
check('traversal id dedupes', shouldEmit(evil, 'k'), false);
check('traversal id stayed inside state dir',
  fs.existsSync(path.join(STATE_DIR, '.._.._escape.json')), true);
try { fs.unlinkSync(path.join(STATE_DIR, '.._.._escape.json')); } catch { /* best effort */ }

cleanup();
console.log(`\nonce-per-session dedupe: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
