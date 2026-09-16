'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runShutdown, SPEC_COVERAGE } = require('../../commands/handlers/shutdown.cjs');
const registry = require('../lib/active-session-registry.js');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-shutdown-boundary-'));
  const specPath = path.join(root, 'instructions', 'canonical', 'commands', 'shutdown.yaml');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'instructions', 'canonical', 'commands', 'shutdown.yaml'), specPath);
  const handoffPath = path.join(root, '_dev', 'reports', 'analysis', 'next-session-handoff__system.md');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, '# System handoff\nResume the system scope.\n');
  return root;
}

function writeSignal(root, name, signal) {
  const signalPath = path.join(root, '_dev', 'reports', 'signals', name);
  fs.mkdirSync(path.dirname(signalPath), { recursive: true });
  fs.writeFileSync(signalPath, JSON.stringify(signal));
}

function closeoutRunner() {
  return () => ({ status: 0, stdout: JSON.stringify({ verdict: 'PASS', findings: [] }), stderr: '' });
}

function runWithIdentity(root, identity, callback) {
  const names = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'MYTHOS_SESSION_ID', 'CODEX_SESSION_ID', 'SM_OS_SESSION_ID'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  if (identity) process.env.MYTHOS_SESSION_ID = identity;
  try {
    return callback();
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function runWithRegistry(root, sessionIds, sidecarId, identity, callback) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smos-shutdown-registry-'));
  const identityNames = ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'MYTHOS_SESSION_ID', 'CODEX_SESSION_ID', 'SM_OS_SESSION_ID'];
  const saved = Object.fromEntries(identityNames.map((name) => [name, process.env[name]]));
  registry.setDataDir(dataDir);
  for (const sessionId of sessionIds) registry.registerSession({ sessionId, now: new Date().toISOString() });
  if (sidecarId) {
    const sidecarPath = path.join(root, '_dev', 'state', 'active-sessions', '_current-id');
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, `${sidecarId}\n`);
  }
  for (const name of identityNames) delete process.env[name];
  if (identity) process.env.MYTHOS_SESSION_ID = identity;
  try {
    return callback();
  } finally {
    registry.resetDataDir();
    for (const name of identityNames) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function makeSpawn(calls) {
  return (file, args) => {
    calls.push([file, args]);
    if (file === 'git') return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('shutdown inventories live HandoffSignal 1.0 and 2.0 files and ignores the obsolete family', () => {
  const root = makeRoot();
  const now = new Date().toISOString();
  writeSignal(root, 'live-v1.json', {
    schema: 'HandoffSignal/1.0',
    lifecycle_state: 'live',
    signal_scope: 'system',
    recommended_next_command: '/whats-next',
    timestamp: now
  });
  writeSignal(root, 'live-v2.json', {
    schema: 'HandoffSignal/2.0',
    lifecycle_state: 'live',
    signal_scope: 'system',
    recommended_next_command: '/whats-next',
    timestamp: now
  });
  writeSignal(root, 'closed-v1.json', {
    schema: 'HandoffSignal/1.0',
    lifecycle_state: 'closed',
    signal_scope: 'system',
    timestamp: now
  });
  writeSignal(root, 'obsolete.json', {
    schema: 'LegacySignal/1.0',
    lifecycle_state: 'live',
    signal_scope: 'system',
    recommended_next_command: '/obsolete-command',
    timestamp: now
  });

  const calls = [];
  const result = runWithIdentity(root, null, () => runShutdown(root, {
    system: true,
    write: false,
    skip: ['4b', '5'],
    spawn: makeSpawn(calls),
    closeoutRunner: closeoutRunner()
  }));

  assert.equal(result.packet.drift.ok, true);
  assert.equal(SPEC_COVERAGE.find((entry) => entry.step_id === '5').label, 'Sync locally configured redundancy remotes');
  assert.equal(result.packet.next_session_skeleton.live_signals.length, 2);
  assert.equal(result.packet.next_session_skeleton.closed_signals.length, 1);
  assert.deepEqual(
    result.packet.next_session_skeleton.live_signals.map((signal) => signal.schema).sort(),
    ['HandoffSignal/1.0', 'HandoffSignal/2.0']
  );
  assert.equal(result.packet.steps.find((step) => step.step_id === '0').status, 'skipped');
  assert.equal(calls.some(([, args]) => args.includes('watcher-lifecycle.cjs')), false);
});

test('shutdown does not stop watchers from a sidecar when multiple sessions are active', () => {
  const root = makeRoot();
  const calls = [];
  const result = runWithRegistry(root, ['session-a', 'session-b'], 'session-a', null, () => runShutdown(root, {
    system: true,
    write: false,
    skip: ['4b', '5'],
    spawn: makeSpawn(calls),
    closeoutRunner: closeoutRunner()
  }));

  assert.equal(result.packet.steps.find((step) => step.step_id === '0').status, 'skipped');
  assert.equal(calls.some(([, args]) => args.some((arg) => String(arg).endsWith('watcher-lifecycle.cjs'))), false);
});

test('shutdown does not stop watchers from a sole best-effort registry session', () => {
  const root = makeRoot();
  const calls = [];
  const result = runWithRegistry(root, ['sole-session'], null, null, () => runShutdown(root, {
    system: true,
    write: false,
    skip: ['4b', '5'],
    spawn: makeSpawn(calls),
    closeoutRunner: closeoutRunner()
  }));

  assert.equal(result.packet.steps.find((step) => step.step_id === '0').status, 'skipped');
  assert.equal(calls.some(([, args]) => args.some((arg) => String(arg).endsWith('watcher-lifecycle.cjs'))), false);
});

test('shutdown uses an explicit environment identity over best-effort registry state', () => {
  const root = makeRoot();
  const calls = [];
  const result = runWithRegistry(root, ['session-a', 'session-b'], 'session-a', 'explicit-test-session', () => runShutdown(root, {
    system: true,
    write: false,
    skip: ['4b', '5'],
    spawn: makeSpawn(calls),
    closeoutRunner: closeoutRunner()
  }));

  assert.equal(result.packet.steps.find((step) => step.step_id === '0').status, 'complete');
  assert.equal(calls.some(([, args]) => args.some((arg) => String(arg).endsWith('watcher-lifecycle.cjs')) && args.includes('explicit-test-session')), true);
});
