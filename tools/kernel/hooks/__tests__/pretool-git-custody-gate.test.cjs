#!/usr/bin/env node
'use strict';

/**
 * Tests for pretool-git-custody-gate.cjs
 *
 * Run: node tools/kernel/hooks/__tests__/pretool-git-custody-gate.test.cjs
 *
 * Covers:
 *   (a) own path passes (path in this session's write_log)
 *   (b) foreign path (in another session's write_log) hard-blocks (exit 2)
 *   (c) unknown path passes + recorded as unresolved_custody
 *   (d) kill-switch file disables blocking (observe-only)
 *   (e) fail-open when write_log is unreadable
 *   (f) pathspec expansion: git commit <path> and git add <path>
 *   (g) git commit -a uses git diff --cached + git diff output
 *   (h) bare git commit uses staged paths
 *   (i) strict mode (MYTHOS_GIT_CUSTODY_GATE=1) blocks unknown paths
 *   (j) not-bash tool is a no-op
 *   (k) non-git command is a no-op
 *   (l) fail-open on internal exception
 *
 * NEGATIVE TESTS (FIX 7 — bypass coverage):
 *   (n1) git add . with foreign file present → BLOCK (FIX 1)
 *   (n2) git add . with only own files → PASS (FIX 1)
 *   (n3) git commit -F <file> with staged foreign path → BLOCK (FIX 2)
 *   (n4) git commit -C <hash> with staged foreign path → BLOCK (FIX 2)
 *   (n5) git commit --fixup=<hash> with staged foreign path → BLOCK (FIX 2)
 *   (n6) git commit --amend with staged foreign path → BLOCK (FIX 2)
 *   (n7) foreign path via another plan's owned_artifacts → BLOCK (FIX 3)
 *   (n8) grant consume-failure stays blocked (FIX 6)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gate = require('../pretool-git-custody-gate.cjs');

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

// ── Sandbox helpers ────────────────────────────────────────────────────────────

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gcgate-test-'));
  const sessionId = `gcgate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionsDir = path.join(root, '_dev', 'state', 'active-sessions');
  const gcStateDir = path.join(root, '_dev', 'state', 'git-custody-gate');
  fs.mkdirSync(path.join(sessionsDir, sessionId), { recursive: true });
  fs.mkdirSync(gcStateDir, { recursive: true });
  return { root, sessionId, sessionsDir, gcStateDir };
}

function writeLog(dir, sessionId, paths) {
  const sessionDir = path.join(dir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const logFile = path.join(sessionDir, 'write_log.json');
  const entries = paths.map((p) => ({ path: p, at: new Date().toISOString(), tool: 'Write' }));
  fs.writeFileSync(logFile, JSON.stringify({ session_id: sessionId, paths: entries }), 'utf8');
}

// Make an fs that stubs existsSync for the disabled marker.
function makeFs(sb, { killSwitchExists = false } = {}) {
  const disabledMarker = path.join(sb.gcStateDir, 'disabled');
  return {
    ...fs,
    existsSync: (p) => {
      if (p === disabledMarker) return killSwitchExists;
      return fs.existsSync(p);
    },
  };
}

function makePayload(sb, command) {
  return {
    session_id: sb.sessionId,
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function makeOptions(sb, command, extras = {}) {
  return {
    tool: 'bash',
    payload: makePayload(sb, command),
    projectDir: sb.root,
    cwd: sb.root,
    fs: makeFs(sb, extras),
    path,
    // exec: stub that always returns '' (no git subprocess needed in most tests)
    exec: extras.exec || (() => ''),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

check('(a) own path passes — path in this session write_log', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/foo.js']);
  const opts = makeOptions(sb, 'git add tools/foo.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  assert.ok(!result.foreignPaths || result.foreignPaths.length === 0);
});

check('(b) foreign path blocks (exit 2) — path in another session write_log', () => {
  const sb = makeSandbox();
  const otherSession = 'other-session-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-file.js']);
  const opts = makeOptions(sb, 'git add tools/foreign-file.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.reason, 'foreign-custody');
  assert.ok(result.foreignPaths && result.foreignPaths.length === 1);
  assert.strictEqual(result.foreignPaths[0].path, 'tools/foreign-file.js');
  assert.strictEqual(result.foreignPaths[0].owningSession, otherSession);
});

check('(c) unknown path passes + recorded as unresolved_custody', () => {
  const sb = makeSandbox();
  // No write_log for this session, path is in no session
  const opts = makeOptions(sb, 'git add tools/unknown-path.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  // Check state file records the unknown path
  const stateFile = path.join(sb.gcStateDir, sb.sessionId + '.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const unknownEntry = state.gc_log.find((e) => e.classification === 'unknown');
  assert.ok(unknownEntry, 'expected unresolved_custody log entry');
  assert.ok(unknownEntry.paths.includes('tools/unknown-path.js'));
});

check('(d) kill-switch disables blocking — foreign path observed, not blocked', () => {
  const sb = makeSandbox();
  const otherSession = 'other-session-ks-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-ks.js']);
  const opts = makeOptions(sb, 'git add tools/foreign-ks.js', { killSwitchExists: true });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.reason, 'kill-switch-observe');
});

check('(e) fail-open when write_log is unreadable (corrupt JSON)', () => {
  const sb = makeSandbox();
  // Write a corrupt write_log for the current session
  const sessionLogDir = path.join(sb.sessionsDir, sb.sessionId);
  fs.mkdirSync(sessionLogDir, { recursive: true });
  fs.writeFileSync(path.join(sessionLogDir, 'write_log.json'), '{ CORRUPT', 'utf8');
  // Write a foreign session with the same path
  const otherSession = 'other-session-corrupt-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/corrupt-test.js']);
  // Gate should still work (foreign block still applies — corrupt own log = not own)
  const opts = makeOptions(sb, 'git add tools/corrupt-test.js');
  const result = gate.main(opts);
  // A corrupt own log means the path is not found as OWN — but it IS in another
  // session's log, so foreign block still fires.
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.reason, 'foreign-custody');
});

check('(f) pathspec expansion: git commit <path>', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/commit-path.js']);
  const opts = makeOptions(sb, 'git commit -m "msg" tools/commit-path.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
});

check('(f) pathspec expansion: git add <path>', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/add-path.js']);
  const opts = makeOptions(sb, 'git add tools/add-path.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
});

check('(g) git commit -a reads staged + modified via exec', () => {
  const sb = makeSandbox();
  // exec returns the modified files for this session
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/staged.js', 'tools/modified.js']);
  let callCount = 0;
  const mockExec = (cmd) => {
    callCount++;
    if (cmd.includes('--cached')) return 'tools/staged.js\n';
    if (cmd.includes('diff --name-only')) return 'tools/modified.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit -a -m "all"', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  assert.ok(callCount >= 2, 'expected exec called for both staged + modified');
});

check('(h) bare git commit uses staged paths from git diff --cached', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/staged-bare.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/staged-bare.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit -m "staged only"', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
});

check('(h) bare git commit: foreign staged path is blocked', () => {
  const sb = makeSandbox();
  const otherSession = 'other-session-staged-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-staged.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/foreign-staged.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit -m "foreign staged"', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.reason, 'foreign-custody');
});

check('(i) strict mode blocks unknown paths when MYTHOS_GIT_CUSTODY_GATE=1', () => {
  const sb = makeSandbox();
  const origEnv = process.env.MYTHOS_GIT_CUSTODY_GATE;
  process.env.MYTHOS_GIT_CUSTODY_GATE = '1';
  try {
    // unknown path (no session claims it)
    const opts = makeOptions(sb, 'git add tools/strict-mode-unknown.js');
    const result = gate.main(opts);
    assert.strictEqual(result.status, 2);
    assert.strictEqual(result.reason, 'strict-mode-unknown');
  } finally {
    if (origEnv === undefined) delete process.env.MYTHOS_GIT_CUSTODY_GATE;
    else process.env.MYTHOS_GIT_CUSTODY_GATE = origEnv;
  }
});

check('(j) non-bash tool is a no-op (status 0)', () => {
  const sb = makeSandbox();
  const opts = {
    tool: 'Write',
    payload: { session_id: sb.sessionId, tool_name: 'Write', tool_input: { file_path: 'foo.js' } },
    projectDir: sb.root,
    cwd: sb.root,
    fs: makeFs(sb),
    path,
    exec: () => '',
  };
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.reason, 'not-bash');
});

check('(k) non-git bash command is a no-op (status 0)', () => {
  const sb = makeSandbox();
  const opts = makeOptions(sb, 'ls -la');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.reason, 'not-git-custody-command');
});

check('(l) fail-open on internal exception from bad injected fs', () => {
  const sb = makeSandbox();
  const opts = {
    tool: 'bash',
    payload: makePayload(sb, 'git add tools/exception-test.js'),
    projectDir: sb.root,
    cwd: sb.root,
    fs: {
      readFileSync: () => { throw new Error('simulated fs error'); },
      existsSync: () => { throw new Error('simulated fs error'); },
      mkdirSync: () => {},
      readdirSync: () => { throw new Error('simulated fs error'); },
      writeFileSync: () => {},
      renameSync: () => {},
    },
    path,
    exec: () => '',
  };
  const result = gate.main(opts);
  // Must fail-open (status 0), never throw
  assert.strictEqual(result.status, 0);
});

check('git add . with no files (nothing to stage) → uncertain-expansion pass', () => {
  const sb = makeSandbox();
  // exec returns empty status (nothing to stage)
  const opts = makeOptions(sb, 'git add .', { exec: () => '' });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
  // When git status returns nothing, we fail-open (uncertain-expansion)
  assert.strictEqual(result.reason, 'uncertain-expansion');
});

check('cd dir && git add path — cd prefix stripped, path resolved', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/cd-prefix.js']);
  // The cd prefix changes cwd but path is relative to that cwd
  // Since root is sb.root, `cd tools && git add cd-prefix.js` resolves to tools/cd-prefix.js
  const opts = makeOptions(sb, `cd tools && git add cd-prefix.js`);
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
});

check('sh -c "git add path" — wrapper peeled', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/sh-wrap.js']);
  const opts = makeOptions(sb, `sh -c "git add tools/sh-wrap.js"`);
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0);
});

// ── FIX 7 NEGATIVE TESTS ────────────────────────────────────────────────────────

// (n1) FIX 1: git add . with foreign file present → must BLOCK
check('(n1) git add . with foreign file present → BLOCK (FIX 1)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-broad-add-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-broad.js']);
  // Mock git status --porcelain to return the foreign file as modified
  const mockExec = (cmd) => {
    if (cmd.includes('status --porcelain')) return ' M tools/foreign-broad.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git add .', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'git add . must block when foreign file would be staged');
  assert.strictEqual(result.reason, 'foreign-custody');
  assert.ok(
    result.foreignPaths && result.foreignPaths.some((f) => f.path === 'tools/foreign-broad.js'),
    'expected foreign path tools/foreign-broad.js in result'
  );
});

// (n2) FIX 1: git add . with only own files → PASS
check('(n2) git add . with only own files → PASS (FIX 1)', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['tools/own-broad.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('status --porcelain')) return ' M tools/own-broad.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git add .', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0, 'git add . must pass when only own files would be staged');
});

// (n3) FIX 2: git commit -F <file> with staged foreign path → BLOCK
check('(n3) git commit -F <file> with staged foreign → BLOCK (FIX 2)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-commit-F-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/staged-foreign-F.js']);
  // -F msgfile: msgfile must NOT be treated as a pathspec
  // staged files are foreign
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/staged-foreign-F.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit -F commit-msg.txt', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'git commit -F <file> must block when staged set is foreign');
  assert.strictEqual(result.reason, 'foreign-custody');
  // CRITICAL: commit-msg.txt must NOT appear in foreign paths (it's an option operand, not a pathspec)
  if (result.foreignPaths) {
    const hasCommitMsgAsPath = result.foreignPaths.some((f) => f.path.includes('commit-msg'));
    assert.ok(!hasCommitMsgAsPath, 'commit-msg.txt must NOT be treated as a pathspec');
  }
});

// (n4) FIX 2: git commit -C <hash> with staged foreign path → BLOCK
check('(n4) git commit -C <hash> with staged foreign → BLOCK (FIX 2)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-commit-C-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/staged-foreign-C.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/staged-foreign-C.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit -C HEAD~1', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'git commit -C <hash> must block when staged set is foreign');
  assert.strictEqual(result.reason, 'foreign-custody');
  if (result.foreignPaths) {
    const hasHashAsPath = result.foreignPaths.some((f) => f.path === 'HEAD~1');
    assert.ok(!hasHashAsPath, 'HEAD~1 must NOT be treated as a pathspec');
  }
});

// (n5) FIX 2: git commit --fixup=<hash> with staged foreign path → BLOCK
check('(n5) git commit --fixup=hash with staged foreign → BLOCK (FIX 2)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-fixup-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/staged-foreign-fixup.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/staged-foreign-fixup.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit --fixup=abc1234', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'git commit --fixup=hash must block when staged set is foreign');
  assert.strictEqual(result.reason, 'foreign-custody');
  if (result.foreignPaths) {
    // The fixup hash 'abc1234' must NOT appear as a pathspec in foreign paths.
    // The only foreign path must be the staged file, not the hash value itself.
    const hasHashAsPath = result.foreignPaths.some((f) => f.path === 'abc1234' || f.path === '--fixup=abc1234');
    assert.ok(!hasHashAsPath, 'fixup hash abc1234 must NOT be treated as a pathspec');
    // The actual staged foreign file must be the one blocked
    assert.ok(
      result.foreignPaths.some((f) => f.path === 'tools/staged-foreign-fixup.js'),
      'expected staged foreign file in result.foreignPaths'
    );
  }
});

// (n6) FIX 2: git commit --amend with staged foreign path → BLOCK
check('(n6) git commit --amend with staged foreign → BLOCK (FIX 2)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-amend-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/staged-foreign-amend.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/staged-foreign-amend.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'git commit --amend --no-edit', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'git commit --amend must block when staged set is foreign');
  assert.strictEqual(result.reason, 'foreign-custody');
});

// (n7) FIX 3: path in another plan's owned_artifacts → BLOCK
check('(n7) path in another plan owned_artifacts → BLOCK (FIX 3)', () => {
  const sb = makeSandbox();

  // Write a fake plan file that claims ownership of a path
  const planDir = path.join(sb.root, '_dev', 'reports', 'analysis', 'task-plans');
  fs.mkdirSync(planDir, { recursive: true });
  const otherPlan = {
    schema: 'TaskPlan/1.0',
    plan_id: 'some-other-plan',
    scope_identity: {
      owned_artifacts: ['tools/claimed-by-other-plan.js'],
    },
  };
  fs.writeFileSync(
    path.join(planDir, 'some-other-plan__plan.json'),
    JSON.stringify(otherPlan, null, 2),
    'utf8'
  );

  // The path is NOT in any session's write_log (only claimed via plan)
  const opts = makeOptions(sb, 'git add tools/claimed-by-other-plan.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'path in another plan owned_artifacts must be blocked');
  assert.strictEqual(result.reason, 'foreign-custody');
  assert.ok(
    result.foreignPaths && result.foreignPaths.some((f) => f.path === 'tools/claimed-by-other-plan.js'),
    'expected foreign path tools/claimed-by-other-plan.js in result'
  );
});

// (n8) FIX 6: grant consume-failure stays blocked (fail-closed)
check('(n8) grant consume-failure stays blocked (FIX 6)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-consume-fail-' + Date.now();

  // Create session log for foreign path
  const sessionDir = path.join(sb.sessionsDir, otherSession);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, 'write_log.json'),
    JSON.stringify({ session_id: otherSession, paths: [{ path: 'tools/consume-fail.js', at: new Date().toISOString(), tool: 'Write' }] }),
    'utf8'
  );

  // Write a valid grant file
  const crypto = require('crypto');
  const grantHash = crypto.createHash('sha256').update(`tools/consume-fail.js:${sb.sessionId}`).digest('hex');
  const grantsDir = path.join(sb.gcStateDir, 'grants');
  fs.mkdirSync(grantsDir, { recursive: true });
  const grantFile = path.join(grantsDir, grantHash + '.json');
  fs.writeFileSync(
    grantFile,
    JSON.stringify({
      schema: 'CustodyGrant/1.0',
      path: 'tools/consume-fail.js',
      to_session: sb.sessionId,
      consumed: false,
      consumed_at: null,
      granted_at: new Date().toISOString(),
      granted_by: 'operator',
    }, null, 2),
    'utf8'
  );

  // Inject an fs that lets reads succeed but fails on renameSync (atomic write of consumed grant)
  const baseFs = makeFs(sb);
  const faultyFs = {
    ...baseFs,
    renameSync: (src, dst) => {
      // Block renaming grant files (simulates consume failure)
      if (src.includes(grantHash)) throw new Error('simulated disk full');
      return fs.renameSync(src, dst);
    },
  };

  const opts = {
    tool: 'bash',
    payload: {
      session_id: sb.sessionId,
      tool_name: 'Bash',
      tool_input: { command: 'git add tools/consume-fail.js' },
    },
    projectDir: sb.root,
    cwd: sb.root,
    fs: faultyFs,
    path,
    exec: () => '',
  };

  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'grant consume-failure must keep path blocked (fail-closed)');
  assert.strictEqual(result.reason, 'foreign-custody');
});

// ── FIX A NEGATIVE TESTS — env-prefix / git-global-option bypass forms ────────
//
// Each form below was a bypass (detectGitAction returned null / 'not-git-custody-command')
// before FIX A.  After FIX A, all must be DETECTED and a positively-foreign path must BLOCK.

// (na1) git -C <dir> add <foreign> → must DETECT + BLOCK
check('(na1) git -C dir add <foreign> → DETECT + BLOCK (FIX A)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-gitC-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-gitC.js']);
  const opts = makeOptions(sb, 'git -C tools add foreign-gitC.js');
  const result = gate.main(opts);
  assert.strictEqual(result.reason, 'foreign-custody', 'git -C dir add must be detected and block a foreign path');
  assert.strictEqual(result.status, 2);
});

// (na2) git -c core.hooksPath=/tmp add <foreign> → must DETECT + BLOCK
check('(na2) git -c core.hooksPath=/tmp add <foreign> → DETECT + BLOCK (FIX A)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-gitc-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-gitc.js']);
  const opts = makeOptions(sb, 'git -c core.hooksPath=/tmp add tools/foreign-gitc.js');
  const result = gate.main(opts);
  assert.strictEqual(result.reason, 'foreign-custody', 'git -c <k=v> add must be detected and block a foreign path');
  assert.strictEqual(result.status, 2);
});

// (na3) git --git-dir=.git add <foreign> → must DETECT + BLOCK
check('(na3) git --git-dir=.git add <foreign> → DETECT + BLOCK (FIX A)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-gitdir-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-gitdir.js']);
  const opts = makeOptions(sb, 'git --git-dir=.git add tools/foreign-gitdir.js');
  const result = gate.main(opts);
  assert.strictEqual(result.reason, 'foreign-custody', 'git --git-dir=x add must be detected and block a foreign path');
  assert.strictEqual(result.status, 2);
});

// (na4) VAR=val git add <foreign> → must DETECT + BLOCK
check('(na4) VAR=val git add <foreign> → DETECT + BLOCK (FIX A)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-envvar-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-envvar.js']);
  const opts = makeOptions(sb, 'GIT_INDEX_FILE=/tmp/index git add tools/foreign-envvar.js');
  const result = gate.main(opts);
  assert.strictEqual(result.reason, 'foreign-custody', 'VAR=val git add must be detected and block a foreign path');
  assert.strictEqual(result.status, 2);
});

// (na5) env VAR=val git commit <foreign staged> → must DETECT + BLOCK
check('(na5) env VAR=val git commit → DETECT + BLOCK (FIX A)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-env-commit-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-env-commit.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('--cached')) return 'tools/foreign-env-commit.js\n';
    return '';
  };
  const opts = makeOptions(sb, 'env GIT_INDEX_FILE=/tmp/index git commit -m "msg"', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.reason, 'foreign-custody', 'env VAR=val git commit must be detected and block a foreign path');
  assert.strictEqual(result.status, 2);
});

// (na6) git -C <dir> add with foreign file: gitCwd applied to expansion cwd
check('(na6) git -C dir sets effective cwd for expansion (FIX A)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-gitC-cwd-' + Date.now();
  // File is foreign (in another session)
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-in-tools.js']);
  // exec: git status returns the file relative to the tools/ dir
  const mockExec = (cmd) => {
    if (cmd.includes('status --porcelain')) return ' M tools/foreign-in-tools.js\n';
    return '';
  };
  // git -C tools add . → cwd should be tools/, mockExec returns foreign file
  const opts = makeOptions(sb, 'git -C tools add .', { exec: mockExec });
  const result = gate.main(opts);
  // Should detect + block (foreign path in tools/ is in scope for git -C tools add .)
  assert.strictEqual(result.status, 2, 'git -C tools add . must block when foreign file in that dir');
  assert.strictEqual(result.reason, 'foreign-custody');
});

// ── FIX B TESTS — cwd-scoped broad add must NOT false-block out-of-scope foreign files ──

// (nb1) cd tools && git add . — foreign file OUTSIDE tools/ → must NOT BLOCK
check('(nb1) cd tools && git add . does NOT false-block foreign file in clients/ (FIX B)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-fixb-' + Date.now();
  // Foreign file is outside tools/
  writeLog(sb.sessionsDir, otherSession, ['clients/{CLIENT_CODE}/foo.js']);
  // exec: git status returns BOTH the foreign file in clients/ AND a file in tools/
  // but git add . from tools/ only stages tools/ files
  const mockExec = (cmd) => {
    if (cmd.includes('status --porcelain')) {
      return [
        ' M clients/{CLIENT_CODE}/foo.js',    // foreign, but OUTSIDE tools/ cwd
        ' M tools/own-in-tools.js',     // not in any session = unknown = pass
      ].join('\n') + '\n';
    }
    return '';
  };
  // cd tools sets cwd to <root>/tools
  const opts = makeOptions(sb, 'cd tools && git add .', { exec: mockExec });
  const result = gate.main(opts);
  // clients/{CLIENT_CODE}/foo.js is outside tools/ and must NOT cause a block
  assert.notStrictEqual(result.reason, 'foreign-custody',
    'cd tools && git add . must NOT false-block a foreign file outside tools/ (FIX B)');
  assert.strictEqual(result.status, 0);
});

// (nb2) cd tools && git add . — foreign file INSIDE tools/ → must BLOCK
check('(nb2) cd tools && git add . BLOCKS foreign file inside tools/ (FIX B)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-fixb2-' + Date.now();
  writeLog(sb.sessionsDir, otherSession, ['tools/foreign-inside-tools.js']);
  const mockExec = (cmd) => {
    if (cmd.includes('status --porcelain')) {
      return ' M tools/foreign-inside-tools.js\n';
    }
    return '';
  };
  const opts = makeOptions(sb, 'cd tools && git add .', { exec: mockExec });
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'cd tools && git add . must block foreign file inside tools/');
  assert.strictEqual(result.reason, 'foreign-custody');
});

// ── FIX E TESTS — dynamic current-plan detection ──────────────────────────────

// (ne1) Current plan's owned_artifacts must NOT be treated as foreign
check('(ne1) current-plan owned_artifacts are NOT foreign (FIX E)', () => {
  const sb = makeSandbox();
  const planDir = path.join(sb.root, '_dev', 'reports', 'analysis', 'task-plans');
  fs.mkdirSync(planDir, { recursive: true });

  // Write a plan that belongs to the current session via session_or_run_id
  const currentPlan = {
    schema: 'TaskPlan/1.0',
    plan_id: 'my-current-plan',
    scope_identity: {
      session_or_run_id: sb.sessionId, // matches current session
      owned_artifacts: ['tools/my-current-plan-file.js'],
    },
  };
  fs.writeFileSync(
    path.join(planDir, 'my-current-plan__plan.json'),
    JSON.stringify(currentPlan, null, 2),
    'utf8'
  );

  // The file is ONLY in the current plan (not in write_log), but must NOT be foreign
  const opts = makeOptions(sb, 'git add tools/my-current-plan-file.js');
  const result = gate.main(opts);
  // Must PASS (not foreign) — the plan belongs to the current session
  assert.strictEqual(result.status, 0, 'current-plan owned_artifacts must not be blocked as foreign');
  assert.notStrictEqual(result.reason, 'foreign-custody');
});

// (ne2) Other plan's owned_artifacts must still be foreign
check('(ne2) other-plan owned_artifacts are still foreign when current plan known (FIX E)', () => {
  const sb = makeSandbox();
  const planDir = path.join(sb.root, '_dev', 'reports', 'analysis', 'task-plans');
  fs.mkdirSync(planDir, { recursive: true });

  // Write a plan that belongs to the current session
  const currentPlan = {
    schema: 'TaskPlan/1.0',
    plan_id: 'my-session-plan',
    scope_identity: {
      session_or_run_id: sb.sessionId,
      owned_artifacts: ['tools/my-own.js'],
    },
  };
  fs.writeFileSync(
    path.join(planDir, 'my-session-plan__plan.json'),
    JSON.stringify(currentPlan, null, 2),
    'utf8'
  );

  // Write another plan belonging to a DIFFERENT session
  const otherPlan = {
    schema: 'TaskPlan/1.0',
    plan_id: 'other-session-plan',
    scope_identity: {
      session_or_run_id: 'some-other-session-xyz',
      owned_artifacts: ['tools/other-session-file.js'],
    },
  };
  fs.writeFileSync(
    path.join(planDir, 'other-session-plan__plan.json'),
    JSON.stringify(otherPlan, null, 2),
    'utf8'
  );

  // Adding the other plan's file must be BLOCKED
  const opts = makeOptions(sb, 'git add tools/other-session-file.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'other-plan owned_artifacts must be blocked when we know current session plan');
  assert.strictEqual(result.reason, 'foreign-custody');
});

// ── REGRESSION: shell-operator chains must not leak into pathspecs ──────────────
// Bug: `git add X && git status` parsed `X && git status`, treating `&&`, `git`,
// `status` as pathspecs → bogus custody classification / false foreign-blocks.
check('(reg1) && chain: git add args bounded to first segment', () => {
  const a = gate.detectGitAction('git add foo.txt && git status');
  assert.strictEqual(a.action, 'add');
  assert.strictEqual(a.args, 'foo.txt', 'must not include "&& git status"');
});
check('(reg2) && chain: multiple files then chained command', () => {
  assert.strictEqual(gate.detectGitAction('git add a.js b.js && echo done').args, 'a.js b.js');
});
check('(reg3) ; and | separators also bound the segment', () => {
  assert.strictEqual(gate.detectGitAction('git add a.txt; rm -rf x').args, 'a.txt');
  assert.strictEqual(gate.detectGitAction('git add a.txt | tee log').args, 'a.txt');
});
check('(reg4) quoted operator in commit message is NOT a separator', () => {
  const c = gate.detectGitAction('git commit -m "fix a && b; c" -- x.txt');
  assert.strictEqual(c.action, 'commit');
  assert.strictEqual(c.args, '-m "fix a && b; c" -- x.txt');
});
check('(reg4b) ESCAPED quote inside message does not mis-bound the segment', () => {
  // The \" is an escaped quote — the && after it is still inside the message,
  // the real boundary is the && before "git status".
  const c = gate.detectGitAction('git commit -m "a \\" && b" -- x.txt && git status');
  assert.strictEqual(c.action, 'commit');
  assert.strictEqual(c.args, '-m "a \\" && b" -- x.txt', 'escaped quote must not end the quote early');
});
check('(reg5) cd prefix + && chain: classifies only the add target', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, 'other-reg5-' + Date.now(), ['status']); // pathological foreign "status"
  const opts = makeOptions(sb, 'git add own.txt && git status');
  const result = gate.main(opts);
  assert.notStrictEqual(result.reason, 'foreign-custody',
    '"status" from the chained command must not be parsed as a foreign pathspec');
  assert.strictEqual(result.status, 0);
});

// ── REGRESSION: multi-segment custody evasion must be blocked ────────────────────
// A foreign git add/commit hidden in a NON-FIRST segment must still be caught.
check('(ev1) git add own && git commit -- foreign BLOCKS the foreign commit', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['own.txt']);
  writeLog(sb.sessionsDir, 'other-ev1-' + Date.now(), ['foreign.txt']);
  const result = gate.main(makeOptions(sb, 'git add own.txt && git commit -- foreign.txt'));
  assert.strictEqual(result.status, 2, 'foreign commit in 2nd segment must block');
  assert.strictEqual(result.reason, 'foreign-custody');
});
check('(ev2) git status && git add foreign BLOCKS (1st segment is not git add/commit)', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, 'other-ev2-' + Date.now(), ['foreign.txt']);
  const result = gate.main(makeOptions(sb, 'git status && git add foreign.txt'));
  assert.strictEqual(result.status, 2, 'foreign add after a non-git first segment must block');
  assert.strictEqual(result.reason, 'foreign-custody');
});
check('(ev3) benign git add own && git status still passes (no false block)', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, sb.sessionId, ['own.txt']);
  const result = gate.main(makeOptions(sb, 'git add own.txt && git status'));
  assert.strictEqual(result.status, 0);
  assert.notStrictEqual(result.reason, 'foreign-custody');
});
check('(ev5) bash -c "..." wrapper is peeled and the inner foreign add blocks', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, 'other-ev5-' + Date.now(), ['foreign.txt']);
  const result = gate.main(makeOptions(sb, 'bash -c "git add foreign.txt"'));
  assert.strictEqual(result.status, 2, 'bash -c wrapper must be peeled and the foreign add blocked');
  assert.strictEqual(result.reason, 'foreign-custody');
});
check('(ev6) subshell ( git add foreign ) is unwrapped and blocks', () => {
  const sb = makeSandbox();
  writeLog(sb.sessionsDir, 'other-ev6-' + Date.now(), ['foreign.txt']);
  const result = gate.main(makeOptions(sb, '(git add foreign.txt)'));
  assert.strictEqual(result.status, 2, 'subshell-wrapped foreign add must block');
  assert.strictEqual(result.reason, 'foreign-custody');
});
check('(ev4) splitTopLevelSegments is quote/escape-aware', () => {
  assert.deepStrictEqual(gate.splitTopLevelSegments('git add a && git commit'), ['git add a', 'git commit']);
  assert.deepStrictEqual(gate.splitTopLevelSegments('git commit -m "a && b"'), ['git commit -m "a && b"']);
  assert.deepStrictEqual(gate.detectGitActions('echo hi; git add x.txt', '/r').map((a) => a.action), ['add']);
});

// ── Summary ─────────────────────────────────────────────────────────────────────

process.stdout.write(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
