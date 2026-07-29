'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('../launcher-stub.js');

test('launch captures stdout from a successful process', () => {
  const result = launch('node', ['-e', "process.stdout.write('hello')"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, '');
});

test('launch captures stderr and a nonzero exit code', () => {
  const result = launch('node', ['-e', "process.stderr.write('bad'); process.exit(3)"]);
  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, 'bad');
});

test('launch reports an error for a nonexistent binary', () => {
  const result = launch('this-binary-does-not-exist-xyz', []);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.length > 0);
});

test('launch requires a binary name', () => {
  assert.throws(() => launch('', []));
});

test('launch honors a custom cwd', () => {
  const result = launch('node', ['-e', 'process.stdout.write(process.cwd())'], { cwd: '/tmp' });
  assert.equal(result.exitCode, 0);
  // macOS /tmp is a symlink to /private/tmp; accept either form.
  assert.ok(result.stdout === '/tmp' || result.stdout === '/private/tmp');
});
