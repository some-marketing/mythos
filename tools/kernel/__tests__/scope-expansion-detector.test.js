'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { 
  normalizeRepoPath, 
  pathMatchesPattern, 
  checkWriteTargetAgainstArc 
} = require('../lib/scope-expansion-detector.cjs');

test('scope-expansion-detector: path matching', (t) => {
  assert.ok(pathMatchesPattern('src/foo.js', 'src/**/*.js'));
  assert.ok(pathMatchesPattern('src/bar/baz.js', 'src/**/*.js'));
  assert.ok(!pathMatchesPattern('tests/foo.js', 'src/**/*.js'));
  assert.ok(pathMatchesPattern('README.md', 'README.md'));
});

test('scope-expansion-detector: checkWriteTargetAgainstArc', (t) => {
  const arc = {
    declared_write_set: ['src/**/*.js', 'docs/*.md'],
    forbidden_artifacts: ['src/secret.js']
  };

  // Allowed
  assert.ok(checkWriteTargetAgainstArc(arc, 'src/foo.js').allowed);
  assert.ok(checkWriteTargetAgainstArc(arc, 'docs/readme.md').allowed);

  // Forbidden
  const forbiddenResult = checkWriteTargetAgainstArc(arc, 'src/secret.js');
  assert.strictEqual(forbiddenResult.allowed, false);
  assert.strictEqual(forbiddenResult.reason, 'forbidden_artifact');

  // Outside declared
  const outsideResult = checkWriteTargetAgainstArc(arc, 'tests/test.js');
  assert.strictEqual(outsideResult.allowed, false);
  assert.strictEqual(outsideResult.reason, 'outside_declared_write_set');
});
