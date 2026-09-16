'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { main } = require('../watch-codex-bridge.js');
const { ENV, MESSAGE_TYPES, makeWatcherMessage, createWatcherReadiness } = require('../lib/watcher-ready.cjs');

class ManagedProcess extends EventEmitter {
  constructor(name, nonce) {
    super();
    this.pid = 41001;
    this.connected = true;
    this.argv = ['node', 'watch-codex-bridge.js', '--once'];
    this.env = { [ENV.NAME]: name, [ENV.NONCE]: nonce, [ENV.COMMIT_TIMEOUT_MS]: '1000' };
    this.sent = [];
  }
  send(message, callback) { this.sent.push(message); this.emit('sent', message); if (callback) callback(); }
  exit(code) { this.exitCode = code; }
}

function waitForSent(proc, type) {
  const existing = proc.sent.find((message) => message.type === type);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const listener = (message) => {
      if (message.type === type) { proc.removeListener('sent', listener); resolve(message); }
    };
    proc.on('sent', listener);
  });
}

test('actual codex watcher discards a deleted pre-COMMIT result and performs no dispatch', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-managed-'));
  const stateFile = path.join(projectRoot, 'signal.json');
  fs.writeFileSync(stateFile, JSON.stringify({ name: 'stale' }));
  const proc = new ManagedProcess('watch-codex-bridge', 'codex-nonce');
  let scans = 0;
  const dispatched = [];
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    listCodexTargetSignals: () => {
      scans += 1;
      return fs.existsSync(stateFile) ? [JSON.parse(fs.readFileSync(stateFile, 'utf8'))] : [];
    },
    runCodexForSignal: async (_root, signal) => { dispatched.push(signal.name); return { mode: 'skipped', reason: 'fixture' }; },
    updateListenerPoll: () => {},
    writeListenerStatus: () => {},
    readBridgeStatus: () => null
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  assert.equal(scans, 1);
  assert.deepStrictEqual(dispatched, []);
  fs.unlinkSync(stateFile);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'codex-nonce'));
  await waitForSent(proc, MESSAGE_TYPES.COMMITTED);
  await running;
  assert.equal(scans, 2, 'fresh authoritative discovery runs exactly once after COMMITTED');
  assert.deepStrictEqual(dispatched, [], 'deleted stale result never dispatches');
});

test('actual codex watcher sends no PREPARED when initial discovery fails', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-managed-fail-'));
  const proc = new ManagedProcess('watch-codex-bridge', 'codex-fail-nonce');
  await assert.rejects(main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    listCodexTargetSignals: () => { throw new Error('fixture discovery failed'); },
    updateListenerPoll: () => {},
    writeListenerStatus: () => {},
    readBridgeStatus: () => null
  }), /fixture discovery failed/);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.PREPARED), false);
});

test('direct launch remains standalone and performs one authoritative scan', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-standalone-'));
  const proc = new ManagedProcess('watch-codex-bridge', 'unused');
  proc.env = {};
  let scans = 0;
  let dispatches = 0;
  await main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    listCodexTargetSignals: () => { scans += 1; return [{ name: 'direct' }]; },
    runCodexForSignal: async () => { dispatches += 1; return { mode: 'skipped', reason: 'fixture' }; },
    updateListenerPoll: () => {},
    writeListenerStatus: () => {},
    readBridgeStatus: () => null
  });
  assert.equal(scans, 1);
  assert.equal(dispatches, 1);
  assert.deepStrictEqual(proc.sent, []);
});

test('duplicate COMMIT during a delayed send callback produces one COMMITTED acknowledgement', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'duplicate-nonce');
  proc.send = function send(message, callback) {
    this.sent.push(message);
    this.emit('sent', message);
    setTimeout(() => { if (callback) callback(); }, 20);
  };
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc }).prepareAndWait();
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  const commit = makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'duplicate-nonce');
  proc.emit('message', commit);
  proc.emit('message', commit);
  await waiting;
  assert.equal(proc.sent.filter((message) => message.type === MESSAGE_TYPES.COMMITTED).length, 1);
});
