'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { main } = require('../watch-actor-bridge.js');
const { ENV, MESSAGE_TYPES, makeWatcherMessage } = require('../lib/watcher-ready.cjs');

class ManagedProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 41002;
    this.connected = true;
    this.argv = ['node', 'watch-actor-bridge.js', '--once'];
    this.env = { [ENV.NAME]: 'watch-actor-bridge', [ENV.NONCE]: 'actor-nonce', [ENV.COMMIT_TIMEOUT_MS]: '1000' };
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

test('actual actor watcher re-discovers a changed signal and dispatches only the fresh value', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-managed-'));
  const stateFile = path.join(projectRoot, 'signal.json');
  fs.writeFileSync(stateFile, JSON.stringify({ name: 'stale', signal: { recommended_next_actor: 'codex' } }));
  const proc = new ManagedProcess();
  const order = [];
  proc.on('sent', (message) => order.push(message.type));
  let scans = 0;
  const dispatched = [];
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    detectInstalledActors: () => ({ codex: true }),
    listRunnableActorSignals: () => { scans += 1; order.push(`scan-${scans}`); return [JSON.parse(fs.readFileSync(stateFile, 'utf8'))]; },
    runActorForSignal: async (_root, info) => {
      order.push('dispatch');
      dispatched.push(info.name);
      return { mode: 'skipped', reason: 'fixture' };
    }
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  assert.equal(scans, 1);
  assert.deepStrictEqual(dispatched, []);
  fs.writeFileSync(stateFile, JSON.stringify({ name: 'fresh', signal: { recommended_next_actor: 'codex' } }));
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-actor-bridge', proc.pid, 'actor-nonce'));
  await waitForSent(proc, MESSAGE_TYPES.COMMITTED);
  await running;
  assert.equal(scans, 2);
  assert.deepStrictEqual(dispatched, ['fresh']);
  assert.deepStrictEqual(order, ['scan-1', MESSAGE_TYPES.PREPARED, 'scan-2', MESSAGE_TYPES.COMMITTED, 'dispatch']);
});

test('actual actor watcher sends no COMMITTED or actor dispatch when the fresh post-COMMIT scan fails', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-managed-fresh-fail-'));
  const proc = new ManagedProcess();
  proc.env[ENV.NONCE] = 'actor-fresh-fail-nonce';
  let scans = 0;
  let dispatches = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    detectInstalledActors: () => ({ codex: true }),
    listRunnableActorSignals: () => {
      scans += 1;
      if (scans === 2) throw new Error('fixture fresh actor discovery failed');
      return [{ name: 'prepared-only', signal: { recommended_next_actor: 'codex' } }];
    },
    runActorForSignal: async () => { dispatches += 1; return { mode: 'skipped', reason: 'fixture' }; }
  });
  await waitForSent(proc, MESSAGE_TYPES.PREPARED);
  proc.emit('message', makeWatcherMessage(MESSAGE_TYPES.COMMIT, 'watch-actor-bridge', proc.pid, 'actor-fresh-fail-nonce'));
  await assert.rejects(running, /fixture fresh actor discovery failed/);
  assert.equal(scans, 2);
  assert.equal(proc.sent.some((message) => message.type === MESSAGE_TYPES.COMMITTED), false);
  assert.equal(dispatches, 0);
});
