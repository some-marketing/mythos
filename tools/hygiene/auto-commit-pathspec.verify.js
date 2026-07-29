#!/usr/bin/env node
'use strict';

/**
 * Verifies that `git commit --only -- <paths>` is structurally incapable of
 * committing files staged by another actor.
 *
 * Acceptance criteria:
 *   1. A file staged by a "foreground actor" (X.txt) REMAINS staged after the
 *      daemon commits an unrelated file (Y.txt) using `--only`.
 *   2. The HEAD commit contains ONLY Y.txt — not X.txt.
 *   3. A second file staged by the daemon (Z.txt) but NOT included in the
 *      pathspec is also left out of the commit.
 */

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASS = '✓';
const FAIL = '✗';
let failures = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.error(`  ${FAIL} ${label}${detail ? ': ' + detail : ''}`);
    failures++;
  }
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-pathspec-verify-'));
  try {
    // Init throwaway repo
    git(['init'], tmpDir);
    git(['config', 'user.email', 'user@example.com'], tmpDir);
    git(['config', 'user.name', 'Test'], tmpDir);

    // Create and commit base versions of X, Y, Z
    ['X.txt', 'Y.txt', 'Z.txt'].forEach(f => fs.writeFileSync(path.join(tmpDir, f), `base ${f}\n`));
    git(['add', 'X.txt', 'Y.txt', 'Z.txt'], tmpDir);
    git(['commit', '-m', 'initial'], tmpDir);

    // Modify all three
    ['X.txt', 'Y.txt', 'Z.txt'].forEach(f => fs.writeFileSync(path.join(tmpDir, f), `modified ${f}\n`));

    // Foreground actor stages X.txt
    git(['add', 'X.txt'], tmpDir);

    // Daemon stages Y.txt (also stages Z.txt but won't include it in commit)
    git(['add', 'Y.txt'], tmpDir);
    git(['add', 'Z.txt'], tmpDir);

    // Daemon commits ONLY Y.txt using --only pathspec
    git(['commit', '--only', '-m', 'daemon commit', '--', 'Y.txt'], tmpDir);

    // Assertions
    const cachedAfter = git(['diff', '--cached', '--name-only'], tmpDir);
    const cachedFiles = cachedAfter ? cachedAfter.split('\n').filter(Boolean) : [];

    assert(
      'X.txt (foreground) remains staged after daemon commit',
      cachedFiles.includes('X.txt'),
      `staged files: ${JSON.stringify(cachedFiles)}`
    );

    assert(
      'Y.txt is NOT in staged diff after commit (committed == HEAD, diff empty)',
      !cachedFiles.includes('Y.txt') || git(['diff', '--cached', '--', 'Y.txt'], tmpDir) === '',
      `staged files: ${JSON.stringify(cachedFiles)}`
    );

    const showStat = git(['show', '--stat', '--name-only', 'HEAD'], tmpDir);
    const committedFiles = showStat.split('\n').filter(line => line.match(/\.(txt)$/));

    assert(
      'HEAD commit contains Y.txt',
      committedFiles.some(f => f.includes('Y.txt')),
      `show --stat: ${committedFiles.join(', ')}`
    );

    assert(
      'HEAD commit does NOT contain X.txt (foreground file protected)',
      !committedFiles.some(f => f.includes('X.txt')),
      `show --stat: ${committedFiles.join(', ')}`
    );

    assert(
      'HEAD commit does NOT contain Z.txt (excluded from pathspec)',
      !committedFiles.some(f => f.includes('Z.txt')),
      `show --stat: ${committedFiles.join(', ')}`
    );

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('auto-commit-pathspec.verify: git commit --only isolation test');
run();

if (failures > 0) {
  console.error(`\n${FAIL} ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\n${PASS} All assertions passed`);
  process.exit(0);
}
