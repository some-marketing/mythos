'use strict';

const assert = require('assert');
const { main } = require('../dispatch-userprompt.cjs');

let exitStatus = null;
let diagnostic = '';

main({
  payload: { prompt: 'diagnostic', session_id: 'hook-test' },
  snapshotCurrentSession() {
    throw new Error('snapshot unavailable');
  },
  finish(status) {
    exitStatus = status;
  },
  writeError(message) {
    diagnostic += message;
  }
});

assert.strictEqual(exitStatus, 0, 'an advisory prompt hook must fail open');
assert.match(diagnostic, /snapshot unavailable/);

// A snapshot-helper failure must not bypass the downstream plan-review gate:
// a /run-plan prompt missing distinct-review evidence must still receive its
// injected directive even when an earlier advisory helper throws.
let stdout = '';
const restoreWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => { stdout += chunk; return true; };
try {
  main({
    payload: { prompt: '/run-plan some-plan', session_id: 'hook-test' },
    snapshotCurrentSession() {
      throw new Error('snapshot unavailable');
    },
    planGate: {
      parsePrompt() { return { matched: true }; },
      evaluateGate() { return { action: 'inject', text: 'DO NOT EXECUTE: missing distinct review' }; }
    },
    finish(status) { exitStatus = status; },
    writeError(message) { diagnostic += message; }
  });
} finally {
  process.stdout.write = restoreWrite;
}

assert.strictEqual(exitStatus, 0, 'an advisory prompt hook must fail open');
assert.match(stdout, /DO NOT EXECUTE/, 'a failed snapshot helper must not bypass the plan-review gate');

console.log('userprompt dispatcher fail-open test passed');
