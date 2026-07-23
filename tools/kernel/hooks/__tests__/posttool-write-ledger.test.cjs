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
