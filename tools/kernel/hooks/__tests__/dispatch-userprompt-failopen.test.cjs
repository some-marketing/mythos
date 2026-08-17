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

console.log('userprompt dispatcher fail-open test passed');
