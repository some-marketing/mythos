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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('actual codex watcher discards a deleted pre-COMMIT result and performs no dispatch', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-managed-'));
  const stateFile = path.join(projectRoot, 'signal.json');
  fs.writeFileSync(stateFile, JSON.stringify({ name: 'stale' }));
  const proc = new ManagedProcess('watch-codex-bridge', 'codex-nonce');
  const order = [];
  proc.on('sent', (message) => order.push(message.type));
  let scans = 0;
  const dispatched = [];
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    listCodexTargetSignals: () => {
      scans += 1;
      order.push(`scan-${scans}`);
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
  assert.equal(scans, 2, 'fresh authoritative discovery runs exactly once after COMMIT and before COMMITTED');
  assert.deepStrictEqual(dispatched, [], 'deleted stale result never dispatches');
  assert.deepStrictEqual(order, ['scan-1', MESSAGE_TYPES.PREPARED, 'scan-2', MESSAGE_TYPES.COMMITTED]);
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

test('actual codex watcher sends no COMMITTED or dispatch when the fresh post-COMMIT scan fails', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-managed-fresh-fail-'));
  const proc = new ManagedProcess('watch-codex-bridge', 'codex-fresh-fail-nonce');
  let scans = 0;
  let dispatches = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    listCodexTargetSignals: () => {
      scans += 1;
      if (scans === 2) throw new Error('fixture fresh discovery failed');
      return [{ name: 'prepared-only' }];
    },
    runCodexForSignal: async () => { dispatches += 1; return { mode: 'skipped', reason: 'fixture' }; },
    updateListenerPoll: () => {},
    writeListenerStatus: () => {},
    readBridgeStatus: () => null
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'codex-fresh-fail-nonce'));
  await assert.rejects(running, /fixture fresh discovery failed/);
  assert.equal(scans, 2);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  assert.equal(dispatches, 0);
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

test('duplicate COMMIT during an async fresh scan runs one scan and produces one COMMITTED acknowledgement', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'duplicate-nonce');
  const scan = deferred();
  let scans = 0;
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(() => { scans += 1; return scan.promise; });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  const commit = makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'duplicate-nonce');
  proc.emit('message', commit);
  proc.emit('message', commit);
  assert.equal(scans, 1);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  const fresh = [{ name: 'fresh' }];
  scan.resolve(fresh);
  assert.strictEqual(await waiting, fresh);
  assert.equal(proc.sent.filter((message) => message.type === MESSAGE_TYPES.COMMITTED).length, 1);
  assert.equal(proc.listenerCount('message'), 0);
  assert.equal(proc.listenerCount('disconnect'), 0);
});

test('managed readiness operation is one-use', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'one-use-nonce');
  const readiness = createWatcherReadiness('watch-codex-bridge', { process: proc });
  const waiting = readiness.prepareAndCommit(() => []);
  await assert.rejects(readiness.prepareAndCommit(() => []), /prepareAndCommit may only be called once/);
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.ABORT, 'watch-codex-bridge', proc.pid, 'one-use-nonce'));
  await assert.rejects(waiting, /startup aborted during waiting-commit/);
});

test('ABORT during an async fresh scan rejects and discards its late value without COMMITTED', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'abort-scan-nonce');
  const scan = deferred();
  let scans = 0;
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(() => { scans += 1; return scan.promise; });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'abort-scan-nonce'));
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.ABORT, 'watch-codex-bridge', proc.pid, 'abort-scan-nonce'));
  await assert.rejects(waiting, /startup aborted during fresh-scan/);
  scan.resolve([{ name: 'too-late' }]);
  await nextTurn();
  assert.equal(scans, 1);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  assert.equal(proc.listenerCount('message'), 0);
  assert.equal(proc.listenerCount('disconnect'), 0);
});

test('disconnect and unexpected messages during an async fresh scan reject without COMMITTED', async () => {
  for (const variant of ['disconnect', 'unexpected']) {
    const proc = new ManagedProcess('watch-codex-bridge', `${variant}-nonce`);
    const scan = deferred();
    const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
      .prepareAndCommit(() => scan.promise);
    await waitForSent(proc, MESSAGE_TYPES.PREPARED);
    proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, `${variant}-nonce`));
    if (variant === 'disconnect') proc.emit('disconnect');
    else proc.emit('message', { type: 'unexpected' });
    await assert.rejects(waiting, variant === 'disconnect' ? /IPC disconnected during fresh-scan/ : /unexpected managed startup message/);
    scan.resolve('late');
    await nextTurn();
    assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
    assert.equal(proc.listenerCount('message'), 0);
    assert.equal(proc.listenerCount('disconnect'), 0);
  }
});

test('fresh scan rejection preserves the original error and sends no COMMITTED', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'reject-scan-nonce');
  const original = new Error('authoritative scan rejected');
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(async () => { throw original; });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'reject-scan-nonce'));
  await assert.rejects(waiting, (error) => error === original);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
});

test('fresh scan preserves falsy synchronous throws and asynchronous rejection reasons', async () => {
  const cases = [
    { label: 'undefined-sync', reason: undefined, async: false },
    { label: 'null-async', reason: null, async: true },
    { label: 'false-sync', reason: false, async: false },
    { label: 'zero-async', reason: 0, async: true },
    { label: 'empty-sync', reason: '', async: false }
  ];
  for (const entry of cases) {
    const proc = new ManagedProcess('watch-codex-bridge', `${entry.label}-nonce`);
    const scan = entry.async
      ? () => Promise.reject(entry.reason)
      : () => { throw entry.reason; };
    const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
      .prepareAndCommit(scan);
    await waitForSent(proc, MESSAGE_TYPES.PREPARED);
    proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, `${entry.label}-nonce`));
    const outcome = await waiting.then(
      (value) => ({ resolved: true, value }),
      (reason) => ({ resolved: false, reason })
    );
    assert.equal(outcome.resolved, false, `${entry.label} must reject`);
    assert.strictEqual(outcome.reason, entry.reason);
    assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
    assert.equal(proc.listenerCount('message'), 0);
    assert.equal(proc.listenerCount('disconnect'), 0);
  }
});

test('successful undefined fresh value is acknowledged and returned without coercion', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'undefined-success-nonce');
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(() => undefined);
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'undefined-success-nonce'));
  assert.strictEqual(await waiting, undefined);
  assert.equal(proc.sent.filter((message) => message.type === MESSAGE_TYPES.COMMITTED).length, 1);
  assert.equal(proc.listenerCount('message'), 0);
  assert.equal(proc.listenerCount('disconnect'), 0);
});

test('managed startup timeout discards a late scan result and cleans listeners', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'timeout-scan-nonce');
  proc.env[ENV.COMMIT_TIMEOUT_MS] = '20';
  const scan = deferred();
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(() => scan.promise);
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'timeout-scan-nonce'));
  await assert.rejects(waiting, /managed startup timed out during fresh-scan/);
  scan.resolve('late');
  await nextTurn();
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  assert.equal(proc.listenerCount('message'), 0);
  assert.equal(proc.listenerCount('disconnect'), 0);
});

test('duplicate COMMIT during a delayed successful COMMITTED callback resolves once after manual release', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'delayed-success-nonce');
  let committedCallback;
  proc.send = function send(message, callback) {
    this.sent.push(message);
    this.emit('sent', message);
    if (message.type === MESSAGE_TYPES.COMMITTED) committedCallback = callback;
    else if (callback) callback();
  };
  const fresh = [{ name: 'exact-fresh-value' }];
  let scans = 0;
  let settled = false;
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(() => { scans += 1; return fresh; });
  waiting.then(() => { settled = true; }, () => { settled = true; });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  const commit = makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'delayed-success-nonce');
  proc.emit('message', commit);
  await waitForSent(proc, MESSAGE_TYPES.COMMITTED);
  proc.emit('message', commit);
  await nextTurn();
  assert.equal(scans, 1);
  assert.equal(proc.sent.filter((message) => message.type === MESSAGE_TYPES.COMMITTED).length, 1);
  assert.equal(settled, false, 'helper must remain pending until the send callback succeeds');
  assert.equal(typeof committedCallback, 'function');
  committedCallback();
  assert.strictEqual(await waiting, fresh);
  assert.equal(settled, true);
  assert.equal(proc.sent.filter((message) => message.type === MESSAGE_TYPES.COMMITTED).length, 1);
  assert.equal(proc.listenerCount('message'), 0);
  assert.equal(proc.listenerCount('disconnect'), 0);
});

test('duplicate COMMIT and cancellation while COMMITTED send callback is pending produce one acknowledgement and reject', async () => {
  const proc = new ManagedProcess('watch-codex-bridge', 'pending-send-nonce');
  let committedCallback;
  proc.send = function send(message, callback) {
    this.sent.push(message);
    this.emit('sent', message);
    if (message.type === MESSAGE_TYPES.COMMITTED) committedCallback = callback;
    else if (callback) callback();
  };
  const fresh = [{ name: 'fresh-but-cancelled' }];
  const waiting = createWatcherReadiness('watch-codex-bridge', { process: proc })
    .prepareAndCommit(() => fresh);
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  const commit = makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-codex-bridge', proc.pid, 'pending-send-nonce');
  proc.emit('message', commit);
  await waitForSent(proc, MESSAGE_TYPES.COMMITTED);
  proc.emit('message', commit);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.ABORT, 'watch-codex-bridge', proc.pid, 'pending-send-nonce'));
  await assert.rejects(waiting, /startup aborted during committed-send/);
  assert.equal(typeof committedCallback, 'function');
  committedCallback();
  await nextTurn();
  assert.equal(proc.sent.filter((message) => message.type === MESSAGE_TYPES.COMMITTED).length, 1);
  assert.equal(proc.listenerCount('message'), 0);
  assert.equal(proc.listenerCount('disconnect'), 0);
});
