#!/usr/bin/env node
'use strict';

/**
 * Tests for mythos-custody-grant.js
 *
 * Run: node tools/custody/__tests__/mythos-custody-grant.test.cjs
 *
 * This is a scaffold port: the private custody-gate hook that consumes these
 * grants (pretool-git-custody-gate style enforcement) is not part of this
 * export target, so these tests cover only the grant-writing module itself:
 *   1. Grant created with consumed:false and the expected shape
 *   2. Grant hashing is stable and path/session-sensitive
 *   3. writeGrant is idempotent (overwrite of an unconsumed grant for the
 *      same path+session reuses the same file)
 *   4. toRepoRelative rejects paths outside the repo root
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { grantHash, writeGrant, toRepoRelative } = require('../mythos-custody-grant.js');

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

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-grant-test-'));
  const grantsDir = path.join(root, '_dev', 'state', 'custody-gate', 'grants');
  fs.mkdirSync(grantsDir, { recursive: true });
  return { root, grantsDir };
}

check('1. Grant created with consumed:false and expected shape', () => {
  const sb = makeSandbox();
  const grantFile = writeGrant('tools/some-file.js', 'session-abc', 'test run', sb.grantsDir);
  assert.ok(fs.existsSync(grantFile), 'grant file must exist');
  const grant = JSON.parse(fs.readFileSync(grantFile, 'utf8'));
  assert.strictEqual(grant.schema, 'CustodyGrant/1.0');
  assert.strictEqual(grant.path, 'tools/some-file.js');
  assert.strictEqual(grant.to_session, 'session-abc');
  assert.strictEqual(grant.consumed, false);
  assert.strictEqual(grant.consumed_at, null);
  assert.strictEqual(grant.granted_by, 'operator');
  assert.strictEqual(grant.reason, 'test run');
});

check('2. Grant hashing is stable and path/session-sensitive', () => {
  const h1 = grantHash('tools/a.js', 'session-1');
  const h2 = grantHash('tools/a.js', 'session-1');
  const h3 = grantHash('tools/a.js', 'session-2');
  const h4 = grantHash('tools/b.js', 'session-1');
  assert.strictEqual(h1, h2, 'same inputs must hash identically');
  assert.notStrictEqual(h1, h3, 'different session must hash differently');
  assert.notStrictEqual(h1, h4, 'different path must hash differently');
});

check('3. writeGrant overwrites the same file for repeated path+session', () => {
  const sb = makeSandbox();
  const first = writeGrant('tools/repeat.js', 'session-x', null, sb.grantsDir);
  const second = writeGrant('tools/repeat.js', 'session-x', 'updated reason', sb.grantsDir);
  assert.strictEqual(first, second, 'grant file path must be stable for same path+session');
  const grant = JSON.parse(fs.readFileSync(second, 'utf8'));
  assert.strictEqual(grant.reason, 'updated reason');
});

check('4. toRepoRelative rejects paths outside the repo root', () => {
  const sb = makeSandbox();
  assert.throws(() => {
    toRepoRelative('/completely/outside/path.js', sb.root);
  }, /outside repo root/);
});

check('5. toRepoRelative resolves a nested relative path correctly', () => {
  const sb = makeSandbox();
  const abs = path.join(sb.root, 'tools', 'nested', 'file.js');
  const rel = toRepoRelative(abs, sb.root);
  assert.strictEqual(rel, path.join('tools', 'nested', 'file.js'));
});

process.stdout.write(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
