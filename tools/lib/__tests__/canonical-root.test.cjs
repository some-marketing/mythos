#!/usr/bin/env node
'use strict';

/**
 * canonical-root.test.cjs — pins the root-resolution contract that the
 * 2026-08-12 L4 diagnosis turned up.
 *
 * What the diagnosis found (see the report accompanying this change): the
 * repo-root refusals observed in the codex run logs were NOT produced by a
 * cwd-dependent resolver. They came from a tracked *duplicate* of
 * canonical-root.cjs sitting one directory shallower than the canonical copy
 * (`<root>/lib/canonical-root.cjs` vs `<root>/tools/lib/canonical-root.cjs`),
 * so its `path.resolve(__dirname, '..', '..')` yielded `/Users/admin` instead
 * of the repo root. cwd was correct in every observed occurrence.
 *
 * That splits the contract into two halves, both pinned here:
 *
 *   1. canonical-root.cjs is cwd-INDEPENDENT. Running it from a foreign cwd
 *      must change nothing and must not warn. (Tests 1-3.)
 *   2. canonical-root.cjs is DEPTH-dependent, and a copy at the wrong depth
 *      must refuse rather than answer with a wrong root. (Tests 4-5.)
 *
 * Test 6-7 cover the consumer this change hardened: actor-registry.js's
 * resolveProjectRoot, whose cwd walk now defers to the canonical root and
 * warns only on a genuine mismatch.
 *
 * Run: node tools/lib/__tests__/canonical-root.test.cjs
 *  or: node --test tools/lib/__tests__/canonical-root.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const canonicalRoot = require('../canonical-root.cjs');
const REPO_ROOT = canonicalRoot.RESOLVED_ROOT;
const ACTOR_REGISTRY = path.join(REPO_ROOT, 'tools', 'signals', 'lib', 'actor-registry.js');

/** A scratch dir with no CLAUDE.md and no repo anchors anywhere above it. */
function makeForeignCwd() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'canonroot-'));
}

/**
 * Run `body` in a child node process with a chosen cwd, so cwd-sensitivity is
 * observed for real instead of simulated by monkey-patching process.cwd().
 * MYTHOS_ROOT is stripped so the env override never leaks in from the parent.
 */
function runInChild(body, cwd) {
  const scriptDir = makeForeignCwd();
  const script = path.join(scriptDir, 'probe.cjs');
  fs.writeFileSync(script, body, 'utf8');
  const env = { ...process.env };
  delete env.MYTHOS_ROOT;
  const res = spawnSync(process.execPath, [script], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 20000
  });
  fs.rmSync(scriptDir, { recursive: true, force: true });
  return res;
}

test('canonical-root: resolves identically from a foreign cwd (cwd-independence)', () => {
  const foreign = makeForeignCwd();
  try {
    const res = runInChild(
      `const { resolveCanonicalRoot } = require(${JSON.stringify(
        path.join(REPO_ROOT, 'tools', 'lib', 'canonical-root.cjs')
      )});\n` + 'process.stdout.write(resolveCanonicalRoot({ mode: "hard" }));\n',
      foreign
    );
    assert.strictEqual(res.status, 0, `child failed: ${res.stderr}`);
    assert.strictEqual(res.stdout, REPO_ROOT);
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});

test('canonical-root: a foreign cwd produces NO warning (the control)', () => {
  const foreign = makeForeignCwd();
  try {
    const res = runInChild(
      `require(${JSON.stringify(
        path.join(REPO_ROOT, 'tools', 'lib', 'canonical-root.cjs')
      )}).resolveCanonicalRoot({ mode: "circuit-breaker" });\n`,
      foreign
    );
    assert.strictEqual(res.status, 0, `child failed: ${res.stderr}`);
    // A warn here would be the mis-warn the L4 task went looking for. There
    // isn't one: cwd is not an input to this module.
    assert.strictEqual(res.stderr.trim(), '', 'cwd alone must never trigger a canonical-root warning');
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});

test('canonical-root: cwd is not consulted anywhere in the module source', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'lib', 'canonical-root.cjs'), 'utf8');
  // The module's own docstring names process.cwd() as the thing it exists to
  // replace, so strip comments before asserting on the executable source.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/process\.cwd\(\)/.test(code), 'canonical-root must stay __dirname-relative, never cwd-relative');
});

test('canonical-root: a copy at the wrong depth REFUSES in hard mode', () => {
  // The diagnosed 2026-08-12 defect, reproduced synthetically so the pin does
  // not depend on the stray tracked copy continuing to exist. A module placed
  // at <dir>/lib/ resolves two levels up to <dir>'s parent, which has no repo
  // anchors — it must throw, not answer.
  const sandbox = makeForeignCwd();
  try {
    const wrongDepthDir = path.join(sandbox, 'shallow', 'lib');
    fs.mkdirSync(wrongDepthDir, { recursive: true });
    const copy = path.join(wrongDepthDir, 'canonical-root.cjs');
    fs.copyFileSync(path.join(REPO_ROOT, 'tools', 'lib', 'canonical-root.cjs'), copy);

    let err;
    try {
      require(copy).resolveCanonicalRoot({ mode: 'hard' });
    } catch (caught) {
      err = caught;
    }
    assert.ok(err, 'a wrong-depth copy must refuse, not answer with a wrong root');
    assert.strictEqual(err.code, 'ECANONROOT');
    assert.match(err.message, /FAILED anchor validation/);
    assert.match(err.message, /__dirname-relative/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('canonical-root: a copy at the wrong depth warns-and-degrades in circuit-breaker mode', () => {
  const sandbox = makeForeignCwd();
  try {
    const wrongDepthDir = path.join(sandbox, 'shallow2', 'lib');
    fs.mkdirSync(wrongDepthDir, { recursive: true });
    const copy = path.join(wrongDepthDir, 'canonical-root.cjs');
    fs.copyFileSync(path.join(REPO_ROOT, 'tools', 'lib', 'canonical-root.cjs'), copy);

    const res = runInChild(
      `require(${JSON.stringify(copy)}).resolveCanonicalRoot({ mode: "circuit-breaker" });\n`,
      REPO_ROOT
    );
    assert.strictEqual(res.status, 0);
    assert.match(res.stderr, /FAILED anchor validation/);
    assert.match(res.stderr, /circuit-breaker/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('actor-registry: a foreign cwd warns and still returns the canonical root', () => {
  const foreign = makeForeignCwd();
  try {
    const res = runInChild(
      `const r = require(${JSON.stringify(ACTOR_REGISTRY)});\n` +
        'process.stdout.write(r.resolveProjectRoot());\n',
      foreign
    );
    assert.strictEqual(res.status, 0, `child failed: ${res.stderr}`);
    assert.strictEqual(res.stdout, REPO_ROOT, 'must prefer the canonical root over the cwd-derived one');
    assert.match(res.stderr, /project-root mismatch/);
    assert.match(res.stderr, new RegExp(foreign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});

test('actor-registry: the canonical cwd resolves silently (the control)', () => {
  const res = runInChild(
    `const r = require(${JSON.stringify(ACTOR_REGISTRY)});\n` +
      'process.stdout.write(r.resolveProjectRoot());\n',
    REPO_ROOT
  );
  assert.strictEqual(res.status, 0, `child failed: ${res.stderr}`);
  assert.strictEqual(res.stdout, REPO_ROOT);
  assert.doesNotMatch(res.stderr, /project-root mismatch/, 'the canonical cwd must not warn');
});

test('actor-registry: a canonical-root anchor failure falls back to the cwd walk with a loud, once-per-process stderr line', () => {
  // Force resolveCanonicalRoot's hard-mode throw via MYTHOS_ROOT pointing at
  // an anchor-less directory. Unlike runInChild's helper, this test needs
  // MYTHOS_ROOT to survive into the child, so it spawns directly.
  const badRoot = makeForeignCwd();
  const scriptDir = makeForeignCwd();
  const script = path.join(scriptDir, 'probe.cjs');
  fs.writeFileSync(
    script,
    `const r = require(${JSON.stringify(ACTOR_REGISTRY)});\n` +
      'const a = r.resolveProjectRoot();\n' +
      'const b = r.resolveProjectRoot();\n' +
      'process.stdout.write(a + "\\n" + b);\n',
    'utf8'
  );
  try {
    const env = { ...process.env, MYTHOS_ROOT: badRoot };
    const res = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout: 20000
    });
    assert.strictEqual(res.status, 0, `child failed: ${res.stderr}`);
    const [a, b] = res.stdout.split('\n');
    // canonical-root failed, so the fallback must be the cwd walk's answer.
    assert.strictEqual(a, REPO_ROOT, 'falls back to the cwd-walk root, not the bad MYTHOS_ROOT');
    assert.strictEqual(b, REPO_ROOT, 'the fallback root is stable across repeated calls');
    const hits = res.stderr.split('[actor-registry] canonical-root failed').length - 1;
    assert.strictEqual(hits, 1, 'the fallback warning must fire at most once per process, even across two calls');
    assert.match(res.stderr, /ECANONROOT/);
    assert.match(res.stderr, new RegExp(`falling back to cwd-walk root ${REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    fs.rmSync(badRoot, { recursive: true, force: true });
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test('actor-registry: the mismatch warning fires at most once per process', () => {
  const foreign = makeForeignCwd();
  try {
    const res = runInChild(
      `const r = require(${JSON.stringify(ACTOR_REGISTRY)});\n` +
        'r.resolveProjectRoot(); r.resolveProjectRoot(); r.resolveProjectRoot();\n',
      foreign
    );
    assert.strictEqual(res.status, 0, `child failed: ${res.stderr}`);
    const hits = res.stderr.split('project-root mismatch').length - 1;
    assert.strictEqual(hits, 1, 'a per-call warn would flood batch resolvers');
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});
