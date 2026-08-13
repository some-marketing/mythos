#!/usr/bin/env node
'use strict';

/**
 * durable-artifact.test.cjs — node --test suite for the scratch-vs-durable
 * path classifier.
 *
 * Run: node tools/lib/__tests__/durable-artifact.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

const { isScratch, isDurable, durablePath } = require('../durable-artifact.cjs');

const REPO_ROOT = '/Users/admin/mythos';

// --- isScratch: each scratch class -----------------------------------------

test('isScratch: /private/tmp/** is scratch', () => {
  assert.strictEqual(isScratch('/private/tmp/claude-501/foo.json'), true);
});

test('isScratch: /tmp/** is scratch', () => {
  assert.strictEqual(isScratch('/tmp/foo.json'), true);
});

test('isScratch: a /scratchpad/ path segment is scratch regardless of location', () => {
  assert.strictEqual(
    isScratch('/Users/admin/mythos/some/nested/scratchpad/out.json'),
    true
  );
});

test('isScratch: under os.tmpdir() is scratch', () => {
  const p = path.join(os.tmpdir(), 'durable-artifact-test-file.json');
  assert.strictEqual(isScratch(p), true);
});

test('isScratch: /var spelling of os.tmpdir() normalizes the same as /private/var', () => {
  // macOS resolves /tmp and /var as symlinks into /private/*; a path spelled
  // with the unresolved /var/... prefix must classify the same as the
  // /private/var/... spelling, for the actual live os.tmpdir() value.
  const realTmpdir = path.resolve(os.tmpdir());
  if (!realTmpdir.startsWith('/private/var/')) {
    // Not macOS (or tmpdir isn't under /private/var here) — this class of
    // spelling collision doesn't apply; skip rather than assert a false fact.
    return;
  }
  const varSpelling = realTmpdir.replace(/^\/private\/var\//, '/var/');
  assert.strictEqual(isScratch(path.join(varSpelling, 'foo.json')), true);
  assert.strictEqual(isScratch(path.join(realTmpdir, 'foo.json')), true);
});

// --- AC0: isScratch is false for the durable roots --------------------------

test('isScratch: _dev/state/** is not scratch (repo-relative)', () => {
  assert.strictEqual(isScratch('_dev/state/x.json', REPO_ROOT), false);
});

test('isScratch: _dev/state/** is not scratch (absolute, under repo root)', () => {
  assert.strictEqual(isScratch(path.join(REPO_ROOT, '_dev/state/x.json'), REPO_ROOT), false);
});

test('isScratch: _dev/reports/** is not scratch (repo-relative)', () => {
  assert.strictEqual(isScratch('_dev/reports/y.md', REPO_ROOT), false);
});

test('isScratch: _dev/reports/** is not scratch (absolute, under repo root)', () => {
  assert.strictEqual(isScratch(path.join(REPO_ROOT, '_dev/reports/y.md'), REPO_ROOT), false);
});

// --- isDurable: each durable root -------------------------------------------

test('isDurable: _dev/state/** is durable (repo-relative)', () => {
  assert.strictEqual(isDurable('_dev/state/run-001.json', REPO_ROOT), true);
});

test('isDurable: _dev/reports/** is durable (repo-relative)', () => {
  assert.strictEqual(isDurable('_dev/reports/analysis/x.json', REPO_ROOT), true);
});

test('isDurable: scratch paths are never durable', () => {
  assert.strictEqual(isDurable('/tmp/foo.json', REPO_ROOT), false);
  assert.strictEqual(isDurable('/private/tmp/foo.json', REPO_ROOT), false);
});

// --- absolute-vs-relative pair for the same logical path -------------------

test('absolute-vs-relative pair: _dev/state path classifies identically either way', () => {
  const rel = '_dev/state/foo.json';
  const abs = path.join(REPO_ROOT, rel);
  assert.strictEqual(isDurable(rel, REPO_ROOT), isDurable(abs, REPO_ROOT));
  assert.strictEqual(isDurable(rel, REPO_ROOT), true);
});

test('absolute-vs-relative pair: /tmp path classifies identically either way', () => {
  // /tmp is already absolute; pair it against a relative path that resolves
  // to the same location via `root`.
  const abs = '/tmp/foo.json';
  const rel = 'foo.json';
  assert.strictEqual(isScratch(abs), true);
  assert.strictEqual(isScratch(rel, '/tmp'), true);
  assert.strictEqual(isScratch(abs), isScratch(rel, '/tmp'));
});

// --- neither-class case ------------------------------------------------------

test('neither-class: an unrelated absolute path is neither scratch nor durable', () => {
  const p = '/Users/admin/Desktop/notes.txt';
  assert.strictEqual(isScratch(p, REPO_ROOT), false);
  assert.strictEqual(isDurable(p, REPO_ROOT), false);
});

test('neither-class: a repo-relative path outside _dev/state and _dev/reports is neither', () => {
  const p = 'creative/configs/foo.json';
  assert.strictEqual(isScratch(p, REPO_ROOT), false);
  assert.strictEqual(isDurable(p, REPO_ROOT), false);
});

// --- durablePath -------------------------------------------------------------

test('durablePath: "state" maps to _dev/state/<name>', () => {
  assert.strictEqual(durablePath('state', 'run-001.json'), '_dev/state/run-001.json');
});

test('durablePath: "report" maps to _dev/reports/<name>', () => {
  assert.strictEqual(durablePath('report', 'audit.json'), '_dev/reports/audit.json');
});

test('durablePath: "reports" is accepted as a synonym for "report"', () => {
  assert.strictEqual(durablePath('reports', 'audit.json'), '_dev/reports/audit.json');
});

test('durablePath: an unknown kind throws', () => {
  assert.throws(() => durablePath('cache', 'x.json'), /unknown kind/);
});

test('durablePath: a name containing ".." is rejected', () => {
  assert.throws(() => durablePath('state', '../../etc/passwd'), /\.\./);
  assert.throws(() => durablePath('state', 'foo/../../bar.json'), /\.\./);
});
