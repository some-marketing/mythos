#!/usr/bin/env node
'use strict';

/**
 * reconcile-vault-drift.test.js — node --test suite for the repo↔vault drift
 * reconciler. Covers the pure diff logic (with a mocked vault list) and the
 * safety invariant that a no-flag (dry-run) run performs ZERO writes.
 *
 * Run: node --test tools/memory/test/reconcile-vault-drift.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');

const reconciler = require('../reconcile-vault-drift.js');

test('computeMissing: repo-only files are the diff', () => {
  const repo = ['a.md', 'b.md', 'c.md'];
  const vault = new Set(['b.md']);
  assert.deepStrictEqual(reconciler.computeMissing(repo, vault), ['a.md', 'c.md']);
});

test('computeMissing: accepts an array for vaultFiles', () => {
  const repo = ['x.md', 'y.md'];
  assert.deepStrictEqual(reconciler.computeMissing(repo, ['y.md']), ['x.md']);
});

test('computeMissing: empty diff when vault is a superset', () => {
  const repo = ['a.md', 'b.md'];
  const vault = new Set(['a.md', 'b.md', 'z.md']);
  assert.deepStrictEqual(reconciler.computeMissing(repo, vault), []);
});

test('computeMissing: everything missing when vault is empty', () => {
  const repo = ['a.md', 'b.md'];
  assert.deepStrictEqual(reconciler.computeMissing(repo, new Set()), ['a.md', 'b.md']);
});

test('computeMissing: output is sorted', () => {
  const repo = ['c.md', 'a.md', 'b.md'];
  assert.deepStrictEqual(reconciler.computeMissing(repo, new Set()), ['a.md', 'b.md', 'c.md']);
});

test('reconcile: mocked vault list produces correct missing report', () => {
  const result = reconciler.reconcile({
    repoFiles: ['one.md', 'two.md', 'three.md'],
    vaultFiles: new Set(['two.md'])
  });
  assert.strictEqual(result.repoCount, 3);
  assert.strictEqual(result.vaultCount, 1);
  assert.strictEqual(result.missingCount, 2);
  assert.deepStrictEqual(result.missing, ['one.md', 'three.md']);
});

test('INVARIANT: no-flag (dry-run) run performs ZERO writes', () => {
  let writeCalls = 0;
  const result = reconciler.reconcile({
    repoFiles: ['a.md', 'b.md', 'c.md'],
    vaultFiles: new Set(), // everything missing — maximal write temptation
    writeMemory: () => {
      writeCalls += 1;
      return { ok: true };
    }
    // NOTE: apply is omitted → defaults to dry-run.
  });
  assert.strictEqual(result.applied, false, 'dry-run must not mark applied');
  assert.deepStrictEqual(result.writes, [], 'dry-run must record no writes');
  assert.strictEqual(writeCalls, 0, 'writeMemory must never be invoked without --apply');
  assert.strictEqual(result.missingCount, 3);
});

test('INVARIANT: apply:false explicitly still performs ZERO writes', () => {
  let writeCalls = 0;
  reconciler.reconcile({
    apply: false,
    repoFiles: ['a.md'],
    vaultFiles: new Set(),
    writeMemory: () => {
      writeCalls += 1;
      return { ok: true };
    }
  });
  assert.strictEqual(writeCalls, 0);
});

test('reconcile: --apply invokes the writer exactly once per missing file', () => {
  const written = [];
  const result = reconciler.reconcile({
    apply: true,
    repoFiles: ['a.md', 'b.md', 'c.md'],
    vaultFiles: new Set(['b.md']),
    writeMemory: (filename) => {
      written.push(filename);
      return { filename, ok: true, status: 0 };
    }
  });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(written, ['a.md', 'c.md']);
  assert.strictEqual(result.writes.length, 2);
});

test('reconcile: --apply --limit caps the number of writes', () => {
  const written = [];
  reconciler.reconcile({
    apply: true,
    limit: 1,
    repoFiles: ['a.md', 'b.md', 'c.md'],
    vaultFiles: new Set(),
    writeMemory: (filename) => {
      written.push(filename);
      return { filename, ok: true, status: 0 };
    }
  });
  assert.deepStrictEqual(written, ['a.md']);
});

test('reconcile: uses injected collectVault when vaultFiles absent', () => {
  let collectCalled = 0;
  const result = reconciler.reconcile({
    repoFiles: ['a.md', 'b.md'],
    collectVault: () => {
      collectCalled += 1;
      return new Set(['a.md']);
    }
  });
  assert.strictEqual(collectCalled, 1);
  assert.deepStrictEqual(result.missing, ['b.md']);
});

test('parseArgs: --apply and --limit parse correctly; default is dry-run', () => {
  assert.strictEqual(reconciler.parseArgs([]).apply, false);
  assert.strictEqual(reconciler.parseArgs(['--apply']).apply, true);
  assert.strictEqual(reconciler.parseArgs(['--limit', '5']).limit, 5);
  assert.strictEqual(reconciler.parseArgs(['--limit=7']).limit, 7);
  assert.strictEqual(reconciler.parseArgs(['--json']).json, true);
});
