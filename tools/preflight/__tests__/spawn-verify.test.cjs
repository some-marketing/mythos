'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { verifySpawn } = require('../spawn-verify.cjs');

test('verifySpawn passes when child process returns expected output', () => {
  const report = verifySpawn({
    runner() {
      return { status: 0, signal: null, stdout: 'spawn-ok', stderr: '' };
    }
  });
  assert.equal(report.schema, 'SpawnPreflight/1.0');
  assert.equal(report.ok, true);
  assert.deepEqual(report.blockers, []);
});

test('verifySpawn reports blockers for failed child process', () => {
  const report = verifySpawn({
    runner() {
      return { status: 1, signal: null, stdout: 'nope', stderr: 'failed' };
    }
  });
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((entry) => /exit status/.test(entry)));
  assert.ok(report.blockers.some((entry) => /unexpected spawn stdout/.test(entry)));
});
