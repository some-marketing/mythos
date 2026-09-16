'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { main } = require('../watch-pipeline-loop.js');
const { ENV, MESSAGE_TYPES, makeWatcherMessage } = require('../lib/watcher-ready.cjs');

class ManagedProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 41003;
    this.connected = true;
    this.argv = ['node', 'watch-pipeline-loop.js', '--once', '--json'];
    this.env = { [ENV.NAME]: 'watch-pipeline-loop', [ENV.NONCE]: 'pipeline-nonce', [ENV.COMMIT_TIMEOUT_MS]: '1000' };
    this.sent = [];
  }
  send(message, callback) { this.sent.push(message); this.emit('sent', message); if (callback) callback(); }
  exit(code) { this.exitCode = code; }
}

function waitForSent(proc, type) {
  const existing = proc.sent.find((message) => message.type === type);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => proc.on('sent', function listener(message) {
    if (message.type === type) { proc.removeListener('sent', listener); resolve(message); }
  }));
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('actual pipeline watcher prints only a fresh superseding snapshot after COMMITTED', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-managed-'));
  const stateFile = path.join(projectRoot, 'state');
  fs.writeFileSync(stateFile, 'stale');
  const proc = new ManagedProcess();
  const order = [];
  proc.on('sent', (message) => order.push(message.type));
  const outputs = [];
  let scans = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    buildLoopState: () => { scans += 1; order.push(`scan-${scans}`); return { value: fs.readFileSync(stateFile, 'utf8'), liveSignals: [] }; },
    deriveLoopRecommendation: (state) => ({ action: state.value, command: state.value, reason: state.value, blocked_by: [], latest_signal: null }),
    buildClaudeDirective: (recommendation) => recommendation.action,
    log: (value) => { order.push('output'); outputs.push(String(value)); }
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  assert.equal(scans, 1);
  assert.deepStrictEqual(outputs, []);
  fs.writeFileSync(stateFile, 'fresh');
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-pipeline-loop', proc.pid, 'pipeline-nonce'));
  await waitForSent(proc, MESSAGE_TYPES.COMMITTED);
  await running;
  assert.equal(scans, 2);
  assert.equal(outputs.length, 1);
  assert.match(outputs[0], /fresh/);
  assert.doesNotMatch(outputs[0], /stale/);
  assert.deepStrictEqual(order, ['scan-1', MESSAGE_TYPES.PREPARED, 'scan-2', MESSAGE_TYPES.COMMITTED, 'output']);
});

test('actual pipeline watcher sends no COMMITTED or output when the fresh post-COMMIT snapshot fails', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-managed-fresh-fail-'));
  const proc = new ManagedProcess();
  proc.env[ENV.NONCE] = 'pipeline-fresh-fail-nonce';
  const outputs = [];
  let scans = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    buildLoopState: () => {
      scans += 1;
      if (scans === 2) throw new Error('fixture fresh pipeline snapshot failed');
      return { liveSignals: [] };
    },
    deriveLoopRecommendation: () => ({ action: 'prepared-only', command: '', reason: '', blocked_by: [], latest_signal: null }),
    buildClaudeDirective: () => '',
    log: (value) => outputs.push(String(value))
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-pipeline-loop', proc.pid, 'pipeline-fresh-fail-nonce'));
  await assert.rejects(running, /fixture fresh pipeline snapshot failed/);
  assert.equal(scans, 2);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  assert.deepStrictEqual(outputs, []);
});

test('actual pipeline watcher preserves throw undefined as rejection with no acknowledgement, output, or rescan', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-managed-undefined-fail-'));
  const proc = new ManagedProcess();
  proc.env[ENV.NONCE] = 'pipeline-undefined-fail-nonce';
  const outputs = [];
  let scans = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    buildLoopState: () => {
      scans += 1;
      if (scans === 2) throw undefined;
      return { liveSignals: [] };
    },
    deriveLoopRecommendation: () => ({ action: 'prepared-only', command: '', reason: '', blocked_by: [], latest_signal: null }),
    buildClaudeDirective: () => '',
    log: (value) => outputs.push(String(value))
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-pipeline-loop', proc.pid, 'pipeline-undefined-fail-nonce'));
  const outcome = await running.then(
    (value) => ({ resolved: true, value }),
    (reason) => ({ resolved: false, reason })
  );
  await nextTurn();
  assert.equal(outcome.resolved, false);
  assert.strictEqual(outcome.reason, undefined);
  assert.equal(scans, 2, 'undefined rejection must not trigger an unchecked third scan');
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  assert.deepStrictEqual(outputs, []);
});

test('managed undefined first value uses explicit presence and never triggers another scan', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-managed-undefined-value-'));
  const proc = new ManagedProcess();
  proc.env = {};
  const outputs = [];
  let scans = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    readiness: {
      managed: true,
      prepareAndCommit: async () => undefined
    },
    buildLoopState: () => {
      scans += 1;
      return { liveSignals: [] };
    },
    deriveLoopRecommendation: () => ({ command: '', reason: '', blocked_by: [], latest_signal: null }),
    buildClaudeDirective: () => '',
    log: (value) => outputs.push(String(value))
  });
  const outcome = await running.then(
    (value) => ({ resolved: true, value }),
    (reason) => ({ resolved: false, reason })
  );
  assert.equal(outcome.resolved, false, 'undefined prepared value is consumed, not treated as absent');
  assert.equal(scans, 1, 'explicit presence must prevent a second unchecked scan');
  assert.deepStrictEqual(outputs, []);
});
