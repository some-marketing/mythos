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

// A snapshot-helper failure must not bypass the closeout gate: the gate must
// still run and its blocking status must still be honored.
exitStatus = null;
diagnostic = '';
main({
  payload: { session_id: 'hook-test' },
  snapshotCurrentSession() { throw new Error('snapshot unavailable'); },
  runNodeScript() {},
  closeoutGate() { return { status: 2, message: 'closeout required' }; },
  finish(status) { exitStatus = status; },
  writeError(message) { diagnostic += message; }
});

assert.strictEqual(exitStatus, 2, 'a failed snapshot helper must not bypass the closeout gate');
assert.match(diagnostic, /snapshot unavailable/);

console.log('stop dispatcher fail-open test passed');
