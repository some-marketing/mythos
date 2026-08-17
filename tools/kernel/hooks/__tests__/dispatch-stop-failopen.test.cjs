'use strict';

const assert = require('assert');
const { main } = require('../dispatch-stop.cjs');

let exitStatus = null;
let diagnostic = '';

main({
  payload: { session_id: 'hook-test' },
  snapshotCurrentSession() { throw new Error('snapshot unavailable'); },
  finish(status) { exitStatus = status; },
  writeError(message) { diagnostic += message; }
});

assert.strictEqual(exitStatus, 0, 'unexpected stop-hook errors must fail open');
assert.match(diagnostic, /snapshot unavailable/);

exitStatus = null;
main({
  payload: { session_id: 'hook-test' },
  snapshotCurrentSession() {},
  runNodeScript() {},
  closeoutGate() { return { status: 2, message: 'closeout required' }; },
  finish(status) { exitStatus = status; },
  writeError() {}
});

assert.strictEqual(exitStatus, 2, 'an explicit closeout gate must retain its blocking status');

console.log('stop dispatcher fail-open test passed');
