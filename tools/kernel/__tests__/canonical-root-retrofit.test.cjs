'use strict';

/**
 * canonical-root-retrofit.test.cjs — S0 verification for the arc-guard
 * enforcement chain's canonical-root retrofit.
 *
 * Covers the four retrofitted files:
 *   1. tools/kernel/hooks/pretool-arc-guard.cjs  (the advisory hot-path hook)
 *   2. tools/kernel/lib/scope-expansion-detector.cjs
 *   3. tools/kernel/lib/arc-state-writer.cjs
 *   4. tools/kernel/guard-now-write.cjs
 *
 * Property (a) — cwd-independence: each module resolves PROJECT_ROOT to the
 *   REAL repo root even when invoked from a foreign cwd (process.chdir('/tmp')
 *   for in-process requires; child process spawned with cwd:'/tmp' for the
 *   hooks). This proves the location-relative resolveCanonicalRoot fix.
 *
 * Property (b) — fail-safe advisory: when canonical-root resolution is FORCED
 *   to fail (MYTHOS_ROOT pointing at a dir that fails anchor validation —
 *   canonical-root.cjs honors MYTHOS_ROOT), the advisory pretool-arc-guard hook
 *   still exits 0 and never throws / never blocks the write.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const FILES = {
  arcStateWriter: path.join(REPO_ROOT, 'tools/kernel/lib/arc-state-writer.cjs'),
  scopeDetector: path.join(REPO_ROOT, 'tools/kernel/lib/scope-expansion-detector.cjs'),
  guardNowWrite: path.join(REPO_ROOT, 'tools/kernel/guard-now-write.cjs'),
  arcGuardHook: path.join(REPO_ROOT, 'tools/kernel/hooks/pretool-arc-guard.cjs')
};

// ---------------------------------------------------------------------------
// (a) cwd-independence — in-process requires from a foreign cwd
// ---------------------------------------------------------------------------

test('(a) library modules resolve real repo root from a FOREIGN cwd (/tmp)', () => {
  const origCwd = process.cwd();
  const foreign = fs.realpathSync(os.tmpdir());
  try {
    process.chdir(foreign);
    assert.notEqual(process.cwd(), REPO_ROOT, 'precondition: cwd is foreign');

    // Fresh module instances under the foreign cwd.
    delete require.cache[require.resolve(FILES.arcStateWriter)];
    delete require.cache[require.resolve(FILES.scopeDetector)];
    delete require.cache[require.resolve(FILES.guardNowWrite)];

    const arcStateWriter = require(FILES.arcStateWriter);
    const scopeDetector = require(FILES.scopeDetector);
    const guardNowWrite = require(FILES.guardNowWrite);

    assert.equal(arcStateWriter.getProjectRoot(), REPO_ROOT);
    assert.equal(scopeDetector.getProjectRoot(), REPO_ROOT);
    assert.equal(guardNowWrite.getProjectRoot(), REPO_ROOT);

    // guard-now-write must still resolve protected paths under the REAL root,
    // not under /tmp — i.e. the falsifier-protection set is cwd-independent.
    const protectedAbs = guardNowWrite.getProtectedAbsolute();
    assert.ok(
      protectedAbs.every((p) => p.startsWith(REPO_ROOT + path.sep)),
      'protected absolute paths must be anchored at the real repo root'
    );
    assert.equal(
      guardNowWrite.resolveTarget({ file_path: '_dev/state/session-present.json' }),
      path.join(REPO_ROOT, '_dev/state/session-present.json')
    );
  } finally {
    process.chdir(origCwd);
    // Restore clean module instances (rooted at the real cwd) for other tests.
    delete require.cache[require.resolve(FILES.arcStateWriter)];
    delete require.cache[require.resolve(FILES.scopeDetector)];
    delete require.cache[require.resolve(FILES.guardNowWrite)];
  }
});

// ---------------------------------------------------------------------------
// (a) cwd-independence — hooks run as child processes from a foreign cwd
// ---------------------------------------------------------------------------

test('(a) pretool-arc-guard hook exits 0 when spawned from a FOREIGN cwd', () => {
  const env = Object.assign({}, process.env);
  // A write target with no current arc -> guard fails-open silently, exit 0.
  env.CLAUDE_TOOL_INPUT = JSON.stringify({ file_path: 'README.md' });
  const res = spawnSync(process.execPath, [FILES.arcGuardHook], {
    cwd: os.tmpdir(),
    env,
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, `hook should exit 0; stderr: ${res.stderr}`);
});

test('(a) guard-now-write hook resolves real root and REFUSES a protected path from FOREIGN cwd', () => {
  const env = Object.assign({}, process.env);
  delete env.MYTHOS_ROOT;
  // Relative protected path; resolution must anchor at the REAL repo root
  // regardless of the foreign cwd, so the refusal (exit 2) must still fire.
  env.CLAUDE_TOOL_INPUT = JSON.stringify({ file_path: '_dev/state/session-present.json' });
  const res = spawnSync(process.execPath, [FILES.guardNowWrite], {
    cwd: os.tmpdir(),
    env,
    encoding: 'utf8'
  });
  assert.equal(res.status, 2, `protected-path refusal should exit 2; stderr: ${res.stderr}`);
  assert.match(res.stderr, /NOW falsifier is tool-path immutable/);
});

// ---------------------------------------------------------------------------
// (b) fail-safe advisory — forced root-resolution failure must NOT block
// ---------------------------------------------------------------------------

test('(b) pretool-arc-guard hook is fail-safe (exit 0, no throw) when root resolution FAILS', () => {
  // Point MYTHOS_ROOT at a dir that fails anchor validation. canonical-root.cjs
  // honors MYTHOS_ROOT, so mode:'hard' will throw ECANONROOT inside the hook.
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-root-'));
  try {
    const env = Object.assign({}, process.env);
    env.MYTHOS_ROOT = brokenRoot; // no instructions/canonical, .git, package.json
    env.CLAUDE_TOOL_INPUT = JSON.stringify({ file_path: 'README.md' });

    const res = spawnSync(process.execPath, [FILES.arcGuardHook], {
      env,
      encoding: 'utf8'
    });

    assert.equal(
      res.status,
      0,
      `advisory hook MUST exit 0 on root-resolution failure (never block). stderr: ${res.stderr}`
    );
    // It should degrade to an advisory no-op and say so on stderr.
    assert.match(res.stderr, /advisory no-op|ECANONROOT|failed validation/i);
  } finally {
    fs.rmSync(brokenRoot, { recursive: true, force: true });
  }
});

test('(b) advisory hook does not block even with an actionable arc when root FAILS', () => {
  // Even when an actor arc would normally be consulted, a broken root must
  // degrade to no-op BEFORE any arc logic — proving the fail-safe is ordered
  // ahead of the enforcement path.
  const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-root-'));
  try {
    const env = Object.assign({}, process.env);
    env.MYTHOS_ROOT = brokenRoot;
    env.MYTHOS_ACTOR_ID = 'test-actor-canonical-root-retrofit';
    env.CLAUDE_TOOL_INPUT = JSON.stringify({ file_path: 'clients/SOME/forbidden.txt' });

    const res = spawnSync(process.execPath, [FILES.arcGuardHook], {
      env,
      encoding: 'utf8'
    });
    assert.equal(res.status, 0, `hook MUST exit 0; stderr: ${res.stderr}`);
  } finally {
    fs.rmSync(brokenRoot, { recursive: true, force: true });
  }
});
