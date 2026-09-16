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

test('actual pipeline watcher prints only a fresh superseding snapshot after COMMITTED', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-managed-'));
  const stateFile = path.join(projectRoot, 'state');
  fs.writeFileSync(stateFile, 'stale');
  const proc = new ManagedProcess();
  const outputs = [];
  let scans = 0;
  const running = main({
    projectRoot,
    process: proc,
    argv: proc.argv,
    buildLoopState: () => { scans += 1; return { value: fs.readFileSync(stateFile, 'utf8'), liveSignals: [] }; },
    deriveLoopRecommendation: (state) => ({ action: state.value, command: state.value, reason: state.value, blocked_by: [], latest_signal: null }),
    buildClaudeDirective: (recommendation) => recommendation.action,
    log: (value) => outputs.push(String(value))
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
});
