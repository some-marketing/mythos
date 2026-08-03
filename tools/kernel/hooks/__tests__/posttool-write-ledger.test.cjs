'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { main } = require('../posttool-write-ledger.cjs');

test('posttool-write-ledger - records written files per session', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-write-ledger-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;

    // Simulate a write tool payload
    const payload1 = {
      session_id: 'test-session-123',
      tool_name: 'Write',
      tool_input: { file_path: 'foo/bar.txt' }
    };
    
    main(payload1);

    const logFile = path.join(tmpDir, '_dev', 'state', 'active-sessions', 'test-session-123', 'write_log.json');
    assert.ok(fs.existsSync(logFile), 'Write log should be created');
    
    let log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    assert.strictEqual(log.paths.length, 1);
    assert.strictEqual(log.paths[0].path, 'foo/bar.txt');

    // Simulate an edit tool payload
    const payload2 = {
      session_id: 'test-session-123',
      tool_name: 'Edit',
      tool_input: { file_path: 'foo/bar.txt' }
    };
    
    main(payload2);
    log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    assert.strictEqual(log.paths.length, 1, 'Should deduplicate paths');

    // Simulate MultiEdit tool payload (with both top-level file_path and nested edits)
    const payload3 = {
      session_id: 'test-session-123',
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'foo/baz.txt',
        edits: [{ file_path: 'foo/qux.txt' }]
      }
    };
    
    main(payload3);
    log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    assert.strictEqual(log.paths.length, 3);
    assert.strictEqual(log.paths[1].path, 'foo/baz.txt');
    assert.strictEqual(log.paths[2].path, 'foo/qux.txt');

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_PROJECT_DIR;
  }
});

test('posttool-write-ledger - falls back to _current-id sidecar when no env/payload session id', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-write-ledger-sidecar-'));
  const originalSessionEnv = {
    CLAUDE_SESSION_ID: process.env.CLAUDE_SESSION_ID,
    CLAUDE_SESSION: process.env.CLAUDE_SESSION,
    MYTHOS_ACTIVE_SESSION_DIR: process.env.MYTHOS_ACTIVE_SESSION_DIR
  };

  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    delete process.env.CLAUDE_SESSION_ID;
    delete process.env.CLAUDE_SESSION;
    // Point the active-session registry at the fixture dir (same tree the hook
    // writes into) and ground the _current-id sidecar.
    process.env.MYTHOS_ACTIVE_SESSION_DIR = path.join(tmpDir, '_dev', 'state', 'active-sessions');
    const sidecarDir = process.env.MYTHOS_ACTIVE_SESSION_DIR;
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, '_current-id'), 'sidecar-grounded-session\n');

    const payload = {
      // no session_id — the fallback must resolve via the sidecar
      tool_name: 'Write',
      tool_input: { file_path: 'from/sidecar.txt' }
    };
    main(payload);

    const logFile = path.join(sidecarDir, 'sidecar-grounded-session', 'write_log.json');
    assert.ok(fs.existsSync(logFile), 'write log lands in the sidecar-grounded session dir');
    const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    assert.strictEqual(log.paths.length, 1);
    assert.strictEqual(log.paths[0].path, 'from/sidecar.txt');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_PROJECT_DIR;
    delete process.env.MYTHOS_ACTIVE_SESSION_DIR;
    if (originalSessionEnv.CLAUDE_SESSION_ID) process.env.CLAUDE_SESSION_ID = originalSessionEnv.CLAUDE_SESSION_ID;
    else delete process.env.CLAUDE_SESSION_ID;
    if (originalSessionEnv.CLAUDE_SESSION) process.env.CLAUDE_SESSION = originalSessionEnv.CLAUDE_SESSION;
    else delete process.env.CLAUDE_SESSION;
  }
});
