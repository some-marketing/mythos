'use strict';

/**
 * Hermetic smoke tests for tools/auto-bridge/post-write-note.cjs.
 *
 * Each case constructs a fixture project root under os.tmpdir(), writes a
 * candidate file, and invokes the hook via a fresh `node` process carrying
 * `tool_input.file_path` over stdin — never network, never a real dispatch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK_SOURCE = path.join(__dirname, '..', 'post-write-note.cjs');

function makeFixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'post-write-note-fixture-')));
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  return dir;
}

function pendingCount(root) {
  const dir = path.join(root, '_dev', 'state', 'post-write-pending');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
}

function runHook(root, filePath, extraEnv = {}) {
  const env = {
    ...process.env,
    MYTHOS_PROJECT_DIR: root,
    ...extraEnv
  };
  const r = spawnSync('node', [HOOK_SOURCE], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env,
    encoding: 'utf8',
    cwd: root,
    timeout: 5000
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('matching top-level notes/*.md write -> note recorded', () => {
  const root = makeFixture();
  const filePath = path.join(root, 'notes', 'idea.md');
  fs.writeFileSync(filePath, '# idea\n');
  const r = runHook(root, filePath);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /post-write-note: matched notes\/idea\.md/);
  assert.equal(pendingCount(root), 1);
});

test('non-matching path -> silent, no note', () => {
  const root = makeFixture();
  const filePath = path.join(root, 'README.md');
  fs.writeFileSync(filePath, 'plain readme');
  const r = runHook(root, filePath);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingCount(root), 0);
});

test('nested subdirectory does not match top-level-only pattern', () => {
  const root = makeFixture();
  const subDir = path.join(root, 'notes', 'archive');
  fs.mkdirSync(subDir, { recursive: true });
  const filePath = path.join(subDir, 'old.md');
  fs.writeFileSync(filePath, '# old\n');
  const r = runHook(root, filePath);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingCount(root), 0);
});

test('custom MYTHOS_NOTE_PATTERN is respected', () => {
  const root = makeFixture();
  fs.mkdirSync(path.join(root, 'drafts'), { recursive: true });
  const filePath = path.join(root, 'drafts', 'proposal.md');
  fs.writeFileSync(filePath, '# proposal\n');
  const r = runHook(root, filePath, { MYTHOS_NOTE_PATTERN: 'drafts/*.md' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /post-write-note: matched drafts\/proposal\.md/);
  assert.equal(pendingCount(root), 1);
});

test('nonexistent file path -> silent, no note', () => {
  const root = makeFixture();
  const filePath = path.join(root, 'notes', 'ghost.md');
  const r = runHook(root, filePath);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingCount(root), 0);
});
