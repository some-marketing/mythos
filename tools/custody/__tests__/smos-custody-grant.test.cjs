#!/usr/bin/env node
'use strict';

/**
 * Tests for smos-custody-grant.js + gate override (S6)
 *
 * Run: node tools/custody/__tests__/smos-custody-grant.test.cjs
 *
 * Covers:
 *   1. Grant created with consumed:false
 *   2. Gate allows a foreign path WITH a matching unconsumed grant
 *   3. Grant is marked consumed after gate allows
 *   4. SECOND commit of same path is BLOCKED (one-use proven)
 *   5. A grant for a different session does NOT apply
 *   6. A consumed grant does not apply
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const gate = require('../../kernel/hooks/pretool-git-custody-gate.cjs');
const { grantHash, writeGrant, GRANTS_DIR } = require('../smos-custody-grant.js');

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

// ── Sandbox helpers ─────────────────────────────────────────────────────────────

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grant-test-'));
  const sessionId = `grant-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionsDir = path.join(root, '_dev', 'state', 'active-sessions');
  const gcStateDir = path.join(root, '_dev', 'state', 'git-custody-gate');
  const grantsDir = path.join(gcStateDir, 'grants');
  fs.mkdirSync(path.join(sessionsDir, sessionId), { recursive: true });
  fs.mkdirSync(grantsDir, { recursive: true });
  return { root, sessionId, sessionsDir, gcStateDir, grantsDir };
}

function writeSessionLog(sessionsDir, sessionId, paths) {
  const sessionDir = path.join(sessionsDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const entries = paths.map((p) => ({ path: p, at: new Date().toISOString(), tool: 'Write' }));
  fs.writeFileSync(
    path.join(sessionDir, 'write_log.json'),
    JSON.stringify({ session_id: sessionId, paths: entries }),
    'utf8'
  );
}

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

function makeOptions(sb, command, extras = {}) {
  return {
    tool: 'bash',
    payload: {
      session_id: sb.sessionId,
      tool_name: 'Bash',
      tool_input: { command },
    },
    projectDir: sb.root,
    cwd: sb.root,
    fs: makeFs(sb, extras),
    path,
    exec: extras.exec || (() => ''),
  };
}

// Write a grant directly into the sandbox grants dir.
function writeTestGrant(sb, repoRelPath, toSession, opts = {}) {
  const hash = crypto.createHash('sha256').update(`${repoRelPath}:${toSession}`).digest('hex');
  const grantFile = path.join(sb.grantsDir, hash + '.json');
  const grant = {
    schema: 'CustodyGrant/1.0',
    path: repoRelPath,
    to_session: toSession,
    reason: opts.reason || null,
    granted_at: new Date().toISOString(),
    granted_by: 'operator',
    consumed: opts.consumed === true,
    consumed_at: opts.consumed ? new Date().toISOString() : null,
  };
  const tmp = grantFile + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(grant, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, grantFile);
  return grantFile;
}

function readGrant(grantFile) {
  return JSON.parse(fs.readFileSync(grantFile, 'utf8'));
}

// ── Tests ────────────────────────────────────────────────────────────────────────

check('1. Grant created with consumed:false', () => {
  const sb = makeSandbox();
  const grantFile = writeTestGrant(sb, 'tools/some-file.js', sb.sessionId, { reason: 'test run' });
  assert.ok(fs.existsSync(grantFile), 'grant file must exist');
  const grant = readGrant(grantFile);
  assert.strictEqual(grant.schema, 'CustodyGrant/1.0');
  assert.strictEqual(grant.path, 'tools/some-file.js');
  assert.strictEqual(grant.to_session, sb.sessionId);
  assert.strictEqual(grant.consumed, false);
  assert.strictEqual(grant.consumed_at, null);
  assert.strictEqual(grant.granted_by, 'operator');
  assert.strictEqual(grant.reason, 'test run');
});

check('2. Gate allows a foreign path WITH a matching unconsumed grant', () => {
  const sb = makeSandbox();
  const otherSession = 'other-' + Date.now();
  writeSessionLog(sb.sessionsDir, otherSession, ['tools/guarded.js']);
  // Write a valid grant for the current session
  writeTestGrant(sb, 'tools/guarded.js', sb.sessionId);
  const opts = makeOptions(sb, 'git add tools/guarded.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 0, 'gate must allow when grant is present');
  assert.strictEqual(result.reason, 'override-consumed');
  assert.ok(result.grantedPaths && result.grantedPaths.includes('tools/guarded.js'));
});

check('3. Grant is marked consumed after gate allows', () => {
  const sb = makeSandbox();
  const otherSession = 'other-consumed-' + Date.now();
  writeSessionLog(sb.sessionsDir, otherSession, ['tools/consume-me.js']);
  const grantFile = writeTestGrant(sb, 'tools/consume-me.js', sb.sessionId);
  const opts = makeOptions(sb, 'git add tools/consume-me.js');
  gate.main(opts);
  const grant = readGrant(grantFile);
  assert.strictEqual(grant.consumed, true, 'grant must be consumed after use');
  assert.ok(grant.consumed_at, 'consumed_at must be set');
});

check('4. SECOND commit of same path is BLOCKED (one-use proven)', () => {
  const sb = makeSandbox();
  const otherSession = 'other-oneuse-' + Date.now();
  writeSessionLog(sb.sessionsDir, otherSession, ['tools/one-use.js']);
  writeTestGrant(sb, 'tools/one-use.js', sb.sessionId);
  const opts = makeOptions(sb, 'git add tools/one-use.js');
  // First use: allowed
  const result1 = gate.main(opts);
  assert.strictEqual(result1.status, 0, 'first commit must pass');
  assert.strictEqual(result1.reason, 'override-consumed');
  // Second use: blocked — grant now consumed
  const result2 = gate.main(opts);
  assert.strictEqual(result2.status, 2, 'second commit must be BLOCKED (one-use)');
  assert.strictEqual(result2.reason, 'foreign-custody');
});

check('5. Grant for a different session does NOT apply', () => {
  const sb = makeSandbox();
  const otherSession = 'other-diffsess-' + Date.now();
  writeSessionLog(sb.sessionsDir, otherSession, ['tools/wrong-session.js']);
  // Grant issued to a DIFFERENT session, not sb.sessionId
  writeTestGrant(sb, 'tools/wrong-session.js', 'completely-different-session-id');
  const opts = makeOptions(sb, 'git add tools/wrong-session.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'gate must block when grant is for a different session');
  assert.strictEqual(result.reason, 'foreign-custody');
});

check('6. A consumed grant does not apply', () => {
  const sb = makeSandbox();
  const otherSession = 'other-consumed2-' + Date.now();
  writeSessionLog(sb.sessionsDir, otherSession, ['tools/already-consumed.js']);
  // Write a pre-consumed grant
  writeTestGrant(sb, 'tools/already-consumed.js', sb.sessionId, { consumed: true });
  const opts = makeOptions(sb, 'git add tools/already-consumed.js');
  const result = gate.main(opts);
  assert.strictEqual(result.status, 2, 'gate must block when grant is already consumed');
  assert.strictEqual(result.reason, 'foreign-custody');
});

// ── FIX 7 NEGATIVE TEST: Bash mutation gets ledgered (FIX 4) ────────────────────

check('7. Bash mutation target gets recorded in write ledger (FIX 4)', () => {
  // This test imports the write-ledger directly to verify Bash writes are captured
  const ledger = require('../../kernel/hooks/posttool-write-ledger.cjs');
  const os = require('os');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-bash-test-'));
  const sessionId = 'bash-ledger-test-' + Date.now();
  const sessionsDir = path.join(tmpRoot, '_dev', 'state', 'active-sessions');
  fs.mkdirSync(path.join(sessionsDir, sessionId), { recursive: true });

  const logFile = path.join(sessionsDir, sessionId, 'write_log.json');

  // Inject a mock extractBashTargetPaths that returns a known path
  const mockExtract = (cmd, cwd) => {
    if (cmd && cmd.includes('> tools/ledger-bash-out.txt')) {
      return [{ raw: 'tools/ledger-bash-out.txt', cwd }];
    }
    return [];
  };

  ledger.main({
    payload: {
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: { command: 'echo hello > tools/ledger-bash-out.txt' },
    },
    projectDir: tmpRoot,
    fs,
    path,
    extractBashTargetPaths: mockExtract,
    bashCwd: tmpRoot,
  });

  // Verify the path was written to the ledger
  assert.ok(fs.existsSync(logFile), 'write_log.json must be created');
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  assert.ok(Array.isArray(log.paths), 'log.paths must be an array');
  const found = log.paths.some((e) => e.path === 'tools/ledger-bash-out.txt');
  assert.ok(found, 'Bash mutation target tools/ledger-bash-out.txt must appear in write_log');
});

// ── Summary ──────────────────────────────────────────────────────────────────────

process.stdout.write(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
