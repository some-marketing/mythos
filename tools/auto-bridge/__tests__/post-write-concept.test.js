'use strict';

/**
 * Hermetic smoke tests for tools/auto-bridge/post-write-concept.cjs.
 *
 * Each case constructs a fixture project root under os.tmpdir() with:
 *  - the hook script copied in (as `tools/auto-bridge/post-write-concept.cjs`)
 *  - a stub `tools/signals/dispatch-bridge.js` that exits 0 (so detached spawn succeeds)
 *  - a `_dev/concepts/` dir with the test concept file
 *
 * The hook is invoked via `node` with stdin or env carrying `tool_input.file_path`.
 * Assertions check stdout, the existence of the pending marker, and the
 * existence of the failure marker — never network/codex.
 *
 * Coverage maps to the gates the bridge-first-dispatch-enforcement plan named:
 *   (a) acceptance path + kernel-class -> dispatch attempted (pending marker written)
 *   (b) non-acceptance path -> silent, no marker
 *   (c) acceptance path + NOT kernel-class -> silent, no marker
 *   (d) suppressed via MYTHOS_NO_AUTO_BRIDGE env -> stdout 'suppressed', no marker
 *   (e) suppressed via sentinel file -> stdout 'suppressed', no marker
 *   (f) suppressed via frontmatter `auto_bridge: false` -> stdout 'suppressed', no marker
 *   (g) stdin input channel only -> dispatch attempted
 *   (h) env CLAUDE_TOOL_INPUT input channel only -> dispatch attempted
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HOOK_SOURCE = path.join(REPO_ROOT, 'tools', 'auto-bridge', 'post-write-concept.cjs');

const KERNEL_CLASS_TRIADIC = `# Test concept

**Triadic form:** yes

Some body content.
`;

const NON_KERNEL = `# Plain doc

Just notes. Nothing structural.
`;

function makeFixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-bridge-fixture-')));
  // Mirror the hook into the fixture
  const hookDir = path.join(dir, 'tools', 'auto-bridge');
  fs.mkdirSync(hookDir, { recursive: true });
  fs.copyFileSync(HOOK_SOURCE, path.join(hookDir, 'post-write-concept.cjs'));
  // Mirror canonical-root lib — required since env-path-hardening s2
  const libDir = path.join(dir, 'tools', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'tools', 'lib', 'canonical-root.cjs'),
    path.join(libDir, 'canonical-root.cjs')
  );
  // Seed anchors so canonical-root validation succeeds
  fs.mkdirSync(path.join(dir, 'instructions', 'canonical'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');

  // Stub dispatch-bridge runner — detached spawn target
  const sigDir = path.join(dir, 'tools', 'signals');
  fs.mkdirSync(sigDir, { recursive: true });
  fs.writeFileSync(
    path.join(sigDir, 'dispatch-bridge.js'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
    { mode: 0o755 }
  );
  // Concepts dir
  fs.mkdirSync(path.join(dir, '_dev', 'concepts'), { recursive: true });
  return dir;
}

function writeConcept(root, name, content) {
  const p = path.join(root, '_dev', 'concepts', `${name}.md`);
  fs.writeFileSync(p, content);
  return p;
}

function pendingMarkerCount(root) {
  const dir = path.join(root, '_dev', 'state', 'auto-bridge-pending');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length;
}

function runHook(root, { stdinPayload = '', envPayload = '', extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: root,
    MYTHOS_NO_AUTO_BRIDGE: '',
    ...extraEnv
  };
  if (envPayload) env.CLAUDE_TOOL_INPUT = envPayload;
  const r = spawnSync('node', [path.join(root, 'tools', 'auto-bridge', 'post-write-concept.cjs')], {
    input: stdinPayload,
    env,
    encoding: 'utf8',
    cwd: root,
    timeout: 5000
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

// ──────────────────────────────────────────────────────────────────────────
// (a) acceptance path + kernel-class -> dispatch attempted
test('acceptance path + kernel-class -> pending marker written and stdout reports dispatched', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'truth', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: dispatched/);
  assert.equal(pendingMarkerCount(root), 1, 'expected exactly one pending marker');
});

// (b) non-acceptance path -> silent
test('non-concept path -> silent, no marker', async () => {
  const root = makeFixture();
  const otherPath = path.join(root, 'README.md');
  fs.writeFileSync(otherPath, 'plain readme');
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: otherPath } }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingMarkerCount(root), 0);
});

// (c) acceptance path + NOT kernel-class -> silent
test('concept path + NON-kernel content -> silent, no marker', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'mundane', NON_KERNEL);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingMarkerCount(root), 0);
});

// (d) suppressed via MYTHOS_NO_AUTO_BRIDGE env
test('MYTHOS_NO_AUTO_BRIDGE=1 -> suppressed, no marker', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'truth', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, {
    stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }),
    extraEnv: { MYTHOS_NO_AUTO_BRIDGE: '1' }
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /suppressed \(env\)/);
  assert.equal(pendingMarkerCount(root), 0);
});

// (e) suppressed via sentinel file
test('integrator-pass-active sentinel -> suppressed, no marker', async () => {
  const root = makeFixture();
  fs.mkdirSync(path.join(root, '_dev', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '_dev', 'state', 'integrator-pass-active'), '');
  const conceptPath = writeConcept(root, 'truth', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /suppressed \(sentinel\)/);
  assert.equal(pendingMarkerCount(root), 0);
});

// (f) suppressed via frontmatter
test('frontmatter auto_bridge: false -> suppressed, no marker', async () => {
  const root = makeFixture();
  const content = `---\nauto_bridge: false\n---\n\n${KERNEL_CLASS_TRIADIC}`;
  const conceptPath = writeConcept(root, 'opt-out', content);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /suppressed \(frontmatter\)/);
  assert.equal(pendingMarkerCount(root), 0);
});

// (g) stdin channel only
test('stdin channel only -> file detected, dispatch attempted', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'stdin-only', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: dispatched/);
  assert.equal(pendingMarkerCount(root), 1);
});

// (h) env channel only
test('env CLAUDE_TOOL_INPUT only (empty stdin) -> file detected, dispatch attempted', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'env-only', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { envPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: dispatched/);
  assert.equal(pendingMarkerCount(root), 1);
});

// (i) subdirectory concept -> NOT matched
test('concept in subdir -> not matched, silent', async () => {
  const root = makeFixture();
  const subDir = path.join(root, '_dev', 'concepts', 'archive');
  fs.mkdirSync(subDir, { recursive: true });
  const conceptPath = path.join(subDir, 'old.md');
  fs.writeFileSync(conceptPath, KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingMarkerCount(root), 0);
});

// (j) integrator-prefixed concept name -> skipped
test('integrator-prefixed __integrator-pass.md -> skipped, no marker', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, '__integrator-pass', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(pendingMarkerCount(root), 0);
});

// (k) claim-aware suppression (F2) -> silence if matching dispatch signal exists
test('acceptance path + existing matching dispatch signal -> silent (F2)', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'truth', KERNEL_CLASS_TRIADIC);
  const conceptRel = path.relative(root, conceptPath);

  // Seed a matching dispatch signal
  const signalDir = path.join(root, '_dev', 'reports', 'signals');
  fs.mkdirSync(signalDir, { recursive: true });
  fs.writeFileSync(path.join(signalDir, 'dispatch-bridge__test.signal.json'), JSON.stringify({
    schema: 'HandoffSignal/1.0',
    signal_type: 'dispatch-bridge',
    decision_context_artifacts: [conceptRel]
  }));

  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: suppressed \(existing-dispatch\)/, 'expected suppression message');
  assert.equal(pendingMarkerCount(root), 0, 'expected no pending marker when signal exists');
});

// (l) skill proposal path -> matched
test('skill proposal path -> matched and dispatched', async () => {
  const root = makeFixture();
  const proposalDir = path.join(root, '_dev', 'drafts', 'skill-proposals');
  fs.mkdirSync(proposalDir, { recursive: true });
  const proposalPath = path.join(proposalDir, 'test-skill.md');
  fs.writeFileSync(proposalPath, KERNEL_CLASS_TRIADIC);
  
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: proposalPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: dispatched/);
  assert.equal(pendingMarkerCount(root), 1);
});

// (m) target resolution -> gemini for triadic
test('target resolution -> gemini for triadic claims', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'triadic', KERNEL_CLASS_TRIADIC);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: dispatched gemini/);
});

// (n) target resolution -> codex for non-triadic structural
test('target resolution -> codex for falsifiable claims without triadic', async () => {
  const root = makeFixture();
  const conceptPath = writeConcept(root, 'logical', `## Falsifiable\nTest it.`);
  const r = runHook(root, { stdinPayload: JSON.stringify({ tool_input: { file_path: conceptPath } }) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /auto-bridge: dispatched codex/);
});
