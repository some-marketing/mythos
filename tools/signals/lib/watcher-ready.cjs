'use strict';

const PROTOCOL = 'mythos-watcher-managed/1';
const MESSAGE_TYPES = Object.freeze({
  PREPARED: 'mythos-watcher-prepared',
  COMMIT: 'mythos-watcher-commit',
  COMMITTED: 'mythos-watcher-committed',
  ABORT: 'mythos-watcher-abort'
});
const ENV = Object.freeze({
  NONCE: 'MYTHOS_WATCHER_MANAGED_NONCE',
  NAME: 'MYTHOS_WATCHER_MANAGED_NAME',
  COMMIT_TIMEOUT_MS: 'MYTHOS_WATCHER_COMMIT_TIMEOUT_MS'
});
const DEFAULT_COMMIT_TIMEOUT_MS = 10000;
const MESSAGE_KEYS = Object.freeze(['name', 'nonce', 'pid', 'protocol', 'type']);

function protocolError(message) {
  const error = new Error(`watcher-ready: ${message}`);
  error.code = 'WATCHER_READY_PROTOCOL';
  return error;
}

function makeWatcherMessage(type, name, pid, nonce) {
  return { type, protocol: PROTOCOL, name, pid, nonce };
}

function isExactWatcherMessage(message, type, expected) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message).sort();
  if (keys.length !== MESSAGE_KEYS.length || keys.some((key, index) => key !== MESSAGE_KEYS[index])) return false;
  return message.type === type &&
    message.protocol === PROTOCOL &&
    message.name === expected.name &&
    message.pid === expected.pid &&
    message.nonce === expected.nonce;
}

function sendMessage(proc, message) {
  return new Promise((resolve, reject) => {
    try {
      proc.send(message, (error) => error ? reject(error) : resolve());
    } catch (error) {
      reject(error);
    }
  });
}

function createWatcherReadiness(name, opts = {}) {
  const proc = opts.process || process;
  const env = opts.env || proc.env || {};
  const nonce = String(env[ENV.NONCE] || '');
  const managedName = String(env[ENV.NAME] || '');

  if (!nonce && !managedName) {
    return {
      managed: false,
      prepareAndCommit: async () => ({ managed: false, committed: true })
    };
  }
  if (!nonce || !managedName) throw protocolError('managed name and nonce must be provided together');
  if (managedName !== name) throw protocolError(`managed name mismatch for ${name}`);
  if (typeof proc.send !== 'function' || proc.connected !== true) throw protocolError('managed watcher requires a connected IPC channel');

  const configuredTimeout = Number(env[ENV.COMMIT_TIMEOUT_MS] || DEFAULT_COMMIT_TIMEOUT_MS);
  if (!Number.isInteger(configuredTimeout) || configuredTimeout <= 0) {
    throw protocolError('commit timeout must be a positive integer');
  }

  let used = false;
  return {
    managed: true,
    async prepareAndCommit(freshLocalAuthorityScan) {
      if (used) throw protocolError('prepareAndCommit may only be called once');
      if (typeof freshLocalAuthorityScan !== 'function') {
        throw protocolError('prepareAndCommit requires a fresh local authority scan callback');
      }
      used = true;
      const expected = { name, pid: proc.pid, nonce };

      return await new Promise((resolve, reject) => {
        let settled = false;
        let commitSeen = false;
        let phase = 'waiting-commit';
        const settle = (kind, value) => {
          if (settled) return;
          settled = true;
          phase = 'settled';
          clearTimeout(timer);
          proc.removeListener('message', onMessage);
          proc.removeListener('disconnect', onDisconnect);
          if (kind === 'reject') reject(value);
          else resolve(value);
        };
        const fail = (reason) => settle('reject', reason);
        const succeed = (value) => settle('resolve', value);
        const cancellationError = (kind) => protocolError(`${kind} during ${phase}`);
        const onDisconnect = () => fail(cancellationError('IPC disconnected'));
        const onMessage = (message) => {
          if (isExactWatcherMessage(message, MESSAGE_TYPES.ABORT, expected)) {
            fail(cancellationError('startup aborted'));
            return;
          }
          if (isExactWatcherMessage(message, MESSAGE_TYPES.COMMIT, expected)) {
            if (commitSeen) return;
            commitSeen = true;
            phase = 'fresh-scan';
            let scan;
            try {
              scan = freshLocalAuthorityScan();
            } catch (error) {
              fail(error);
              return;
            }
            Promise.resolve(scan).then((freshValue) => {
              if (settled) return;
              phase = 'committed-send';
              sendMessage(proc, makeWatcherMessage(MESSAGE_TYPES.COMMITTED, name, proc.pid, nonce))
                .then(() => succeed(freshValue))
                .catch((error) => fail(protocolError(`unable to send COMMITTED: ${error.message}`)));
            }, fail);
            return;
          }
          fail(protocolError('unexpected managed startup message'));
        };
        const timer = setTimeout(() => fail(cancellationError('managed startup timed out')), configuredTimeout);
        proc.on('message', onMessage);
        proc.once('disconnect', onDisconnect);
        sendMessage(proc, makeWatcherMessage(MESSAGE_TYPES.PREPARED, name, proc.pid, nonce))
          .catch((error) => fail(protocolError(`unable to send PREPARED: ${error.message}`)));
      });
    }
  };
}

module.exports = {
  PROTOCOL,
  MESSAGE_TYPES,
  ENV,
  DEFAULT_COMMIT_TIMEOUT_MS,
  makeWatcherMessage,
  isExactWatcherMessage,
  createWatcherReadiness
};
