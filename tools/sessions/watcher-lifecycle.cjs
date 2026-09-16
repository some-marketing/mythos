'use strict';

// watcher-lifecycle.cjs — session-scoped watcher daemon lifecycle (plan
// sim-foundation-repairs, S11 / L1).
//
// PURPOSE
//   Watcher daemons are session-lifecycle-bound: started when a /new-session
//   flow begins and stopped when /shutdown runs. This module provides the
//   lifecycle primitives the handlers call — it does NOT wire the handlers
//   itself. The registry lives per session under
//   `_dev/state/active-sessions/<session_id>/watchers.json` and records
//   PER-DAEMON PROCESS IDENTITY, not just a PID:
//
//     { pid, start_time, executable, argv_fingerprint, argv, script }
//
//   - pid               — the spawned daemon's pid
//   - start_time        — process start timestamp, read from the live process
//                         via `ps -o lstart=` immediately after spawn
//   - executable        — the resolved interpreter used to launch the daemon
//   - argv_fingerprint  — sha256 of the normalized spawned command line
//   - argv              — the exact argv passed to spawn (for diagnostics)
//   - script            — the daemon script path (tools/signals/<name>.js)
//
// IDENTITY-VERIFIED SHUTDOWN (fail closed)
//   stopWatchers verifies identity BEFORE signaling each daemon. On POSIX it
//   compares the recorded pid + start_time (via `ps -o lstart= -p <pid>`,
//   whitespace-normalized) + argv fingerprint (via `ps -o command=` or argv
//   match) against the live process. On ANY mismatch (PID reuse / foreign
//   process occupying the pid) the signal is REFUSED, the registry identity
//   is retained for blocked repair, and the refusal is reported in
//   `{ refused: [...] }`. Entries whose process no longer exists are removed
//   as stale WITHOUT signaling. Verified survivors get a graceful SIGTERM
//   first, then (if still alive after the grace window, and only after
//   re-verifying start_time) a SIGKILL escalation.
//
// DEFAULT WATCHER SET
//   The coordination family: watch-codex-bridge + watch-actor-bridge +
//   watch-pipeline-loop (membership OP3), resolved to the actual scripts
//   under tools/signals/ (e.g. tools/signals/watch-codex-bridge.js) and
//   launched with `process.execPath` (node).
//
// WIRING (ConveneReceipt/1.0 sim-foundation-repairs-s11-yaml, CLEARED)
//   The canonical YAML process-array wiring — new-session.yaml Step 0
//   (watcher-start) and shutdown.yaml Step 0 (watcher-stop) — and the handler
//   wiring (tools/commands/handlers/new-session.cjs, shutdown.cjs) landed in
//   the S11 amendment commit. The runners execute this module's primitives via
//   the CLI entry below (start/stop), registered as the '0' mechanical command
//   in each handler's defaultCommands().
//
// PLATFORM SCOPE (S11 amendment, codex finding 5)
//   Process-identity enforcement is POSIX-only (macOS/Linux): ps-based
//   start-time + command verification. On Windows verifyIdentity performs an
//   existence check only — that is NOT identity verification (fail-open on
//   existence; no identity is claimed). The wiring prose in new-session.yaml /
//   shutdown.yaml states this scope explicitly.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const {
  MESSAGE_TYPES,
  ENV: READY_ENV,
  makeWatcherMessage,
  isExactWatcherMessage
} = require('../signals/lib/watcher-ready.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Coordination-family watcher set (membership OP3). Scripts resolve under
// tools/signals/<name>.js.
const DEFAULT_WATCHER_SET = Object.freeze([
  'watch-codex-bridge',
  'watch-actor-bridge',
  'watch-pipeline-loop'
]);

// Session id is embedded in a filesystem path; only safe characters are
// accepted (UUIDs, slugs). Rejects traversal/absolute input.
const SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;

const REGISTRY_FILE = 'watchers.json';
const REGISTRY_SCHEMA = 'watcher-registry/1';

// ps start-time retries right after spawn (the child must be visible to ps).
const START_TIME_RETRIES = 5;
const START_TIME_RETRY_MS = 50;
const PS_TIMEOUT_MS = 2000;
const STARTUP_SETTLE_MS = 100;
const PREPARE_TIMEOUT_MS = 5000;
const COMMITTED_TIMEOUT_MS = 5000;
const SESSION_LOCK_DB = 'watchers-lock.sqlite';
const LEGACY_SESSION_LOCK_FILE = 'watchers.lock';
const MIN_NODE_VERSION = [22, 13, 0];

// In-memory spawned ChildProcess handles, keyed `${sessionId}::${name}`.
// Exported for test introspection (signalCode/exitCode evidence).
const spawned = new Map();

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function normalizeStartTime(value) {
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

// Fingerprint over the same representation `ps -o command=` emits: the argv
// joined with single spaces, whitespace-normalized.
function computeArgvFingerprint(argv) {
  const normalized = normalizeStartTime(Array.isArray(argv) ? argv.join(' ') : argv);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function normalizeSessionId(sessionId) {
  const id = String(sessionId == null ? '' : sessionId).trim();
  if (!id || !SESSION_ID_RE.test(id) || id === '.' || id === '..') {
    throw new Error(`watcher-lifecycle: invalid session_id ${JSON.stringify(sessionId)}`);
  }
  return id;
}

function registryFilePath(sessionId, projectRoot) {
  return path.join(
    projectRoot || PROJECT_ROOT,
    '_dev', 'state', 'active-sessions',
    normalizeSessionId(sessionId),
    REGISTRY_FILE
  );
}

function sessionLockDbPath(sessionId, projectRoot) {
  return path.join(path.dirname(registryFilePath(sessionId, projectRoot)), SESSION_LOCK_DB);
}

function namedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function nodeVersionSupported(version) {
  const parts = String(version || '').split('.').map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part))) return false;
  for (let i = 0; i < MIN_NODE_VERSION.length; i += 1) {
    if ((parts[i] || 0) > MIN_NODE_VERSION[i]) return true;
    if ((parts[i] || 0) < MIN_NODE_VERSION[i]) return false;
  }
  return true;
}

// The open SQLite connection and its BEGIN IMMEDIATE transaction are the
// mutex. The database file may persist after a crash; kernel ownership does
// not. No table or lease row is created.
function acquireSessionLock(sessionId, projectRoot, opts = {}) {
  const sid = normalizeSessionId(sessionId);
  const runtimeVersion = opts.runtimeVersion || process.versions.node;
  if (!nodeVersionSupported(runtimeVersion)) {
    throw namedError('WATCHER_LOCK_UNSUPPORTED', `watcher-lifecycle: Node >=22.13.0 is required for the SQLite lifecycle lock (found ${runtimeVersion})`);
  }
  const file = sessionLockDbPath(sid, projectRoot);
  const legacyFile = path.join(path.dirname(file), LEGACY_SESSION_LOCK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(legacyFile)) {
    throw namedError('WATCHER_LOCK_LEGACY_PRESENT', `watcher-lifecycle: legacy session lock present for ${sid}: ${legacyFile}`);
  }
  let DatabaseSync = opts.DatabaseSync;
  if (!DatabaseSync) ({ DatabaseSync } = require('node:sqlite'));
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('BEGIN IMMEDIATE');
    return { db, file };
  } catch (err) {
    if (db) {
      try { db.close(); } catch (_) { /* preserve acquisition error */ }
    }
    if (err && (err.errcode === 5 || /SQLITE_BUSY|database is locked/i.test(String(err.code || err.message)))) {
      throw namedError('WATCHER_LOCK_BUSY', `watcher-lifecycle: session lock busy for ${sid}`, err);
    }
    throw err;
  }
}

function releaseSessionLock(lock) {
  if (!lock) return;
  let rollbackError;
  try {
    lock.db.exec('ROLLBACK');
  } catch (err) {
    rollbackError = err;
  } finally {
    try {
      lock.db.close();
    } catch (err) {
      if (rollbackError) attachSecondaryError(rollbackError, 'close_error', 'SQLite lock close failed', err);
      else rollbackError = err;
    }
  }
  if (rollbackError) throw rollbackError;
}

function attachSecondaryError(primary, property, label, secondary) {
  primary[property] = secondary;
  primary.message = `${primary.message}; ${label}: ${secondary.message}`;
  return primary;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function registryReadError(code, sessionId, file, cause) {
  return namedError(code, `watcher-lifecycle: ${code} for session ${sessionId} at ${file}`, cause);
}

function validRegistryIdentity(name, identity) {
  return isPlainObject(identity) &&
    identity.name === name &&
    Number.isInteger(identity.pid) && identity.pid > 0 &&
    typeof identity.start_time === 'string' && identity.start_time.length > 0 &&
    typeof identity.executable === 'string' && identity.executable.length > 0 &&
    Array.isArray(identity.argv) &&
    typeof identity.argv_fingerprint === 'string' && /^[0-9a-f]{64}$/.test(identity.argv_fingerprint);
}

function readRegistry(sessionId, projectRoot, options = {}) {
  const sid = normalizeSessionId(sessionId);
  const file = registryFilePath(sid, projectRoot);
  const reader = options.readFileSync || (options.fs && options.fs.readFileSync) || fs.readFileSync;
  let raw;
  try {
    raw = reader.call(options.fs || fs, file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw registryReadError('WATCHER_REGISTRY_UNREADABLE', sid, file, error);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw registryReadError('WATCHER_REGISTRY_INVALID', sid, file, error);
  }
  if (!isPlainObject(parsed) || parsed.schema !== REGISTRY_SCHEMA || parsed.session_id !== sid || !isPlainObject(parsed.watchers) ||
      Object.entries(parsed.watchers).some(([name, identity]) => !validRegistryIdentity(name, identity))) {
    throw registryReadError('WATCHER_REGISTRY_INVALID', sid, file);
  }
  return parsed;
}

function writeRegistry(sessionId, registry, projectRoot) {
  const file = registryFilePath(sessionId, projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = Object.assign(
    { schema: REGISTRY_SCHEMA, session_id: normalizeSessionId(sessionId), updated_at: new Date().toISOString() },
    registry || {},
    { watchers: (registry && registry.watchers) || {} }
  );
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return payload;
}

// ---------------------------------------------------------------------------
// process interrogation (POSIX ps)
// ---------------------------------------------------------------------------

function psQuery(args) {
  try {
    return execFileSync('ps', args, { encoding: 'utf8', timeout: PS_TIMEOUT_MS }).toString();
  } catch (_) {
    return '';
  }
}

// Raw start-time line for a pid, or '' when the process is not visible to ps.
function liveStartTime(pid) {
  return psQuery(['-o', 'lstart=', '-p', String(pid)]).trim();
}

// Full command line for a pid (as spawned), or '' when not visible.
function liveCommand(pid) {
  return psQuery(['-o', 'command=', '-p', String(pid)]).trim();
}

// Terminate and reap a child whose identity was never recorded. This is safe
// only for the child handle created by the current spawn attempt.
function reapOwnedChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve({ ok: true });
      return;
    }

    let finished = false;
    let killTimer;
    let hardTimer;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      child.removeListener('exit', onExit);
      resolve(error ? { ok: false, error } : { ok: true });
    };
    const onExit = () => finish();
    child.once('exit', onExit);
    try {
      child.kill('SIGTERM');
    } catch (err) {
      finish(err);
      return;
    }
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL');
          hardTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              finish(new Error(`watcher-lifecycle: owned child ${child.pid} remained alive after SIGKILL`));
            }
          }, START_TIME_RETRY_MS);
        } catch (err) {
          finish(err);
        }
      }
    }, START_TIME_RETRY_MS);
  });
}

async function reapStartedWatchers(sessionId, started) {
  const cleanupErrors = [];
  for (const identity of started) {
    const key = `${sessionId}::${identity.name}`;
    const child = spawned.get(key);
    let cleanupFailed = false;
    try {
      const result = await reapOwnedChild(child);
      if (result && result.ok === false) {
        cleanupFailed = true;
        cleanupErrors.push(new Error(`owned watcher ${identity.name} (pid ${identity.pid}) cleanup failed: ${result.error.message}`));
      }
    } catch (err) {
      cleanupFailed = true;
      cleanupErrors.push(new Error(`owned watcher ${identity.name} (pid ${identity.pid}) cleanup failed: ${err.message}`));
    } finally {
      if (!cleanupFailed) spawned.delete(key);
    }
  }
  if (cleanupErrors.length === 0) return null;
  const cleanupError = new Error(cleanupErrors.map((err) => err.message).join('; '));
  cleanupError.errors = cleanupErrors;
  return cleanupError;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but owned by another user
  }
}

// ---------------------------------------------------------------------------
// identity verification
// ---------------------------------------------------------------------------

function executableBasename(executable) {
  if (!executable) return '';
  return path.basename(String(executable));
}

// Semantically compare the live command line against the recorded identity:
// the live executable basename must match the recorded one, and (for script
// launches) the recorded script path (or its basename) must appear in the
// live command. Used as the "argv match" fallback when the strict fingerprint
// diverges (e.g. interpreter symlink resolution by ps).
function argvMatchesSemantically(identity, commandLine) {
  if (!commandLine) return false;
  const tokens = commandLine.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const liveExecBasename = path.basename(tokens[0]);
  const recordedExecBasename = executableBasename(identity.executable);
  if (recordedExecBasename && liveExecBasename !== recordedExecBasename) {
    return false;
  }
  if (identity.script) {
    const script = String(identity.script);
    const needle = path.isAbsolute(script) ? script : path.basename(script);
    if (!commandLine.includes(needle)) return false;
  }
  return true;
}

// Verify a recorded identity against the LIVE process occupying `pid`.
// Returns { exists, ok, mismatches, live: { start_time, command } }.
// On non-POSIX platforms identity cannot be ps-verified; only existence is
// checked and `verification_skipped` is reported (fail-open on existence,
// fail-closed never applies because no identity is claimed).
function verifyIdentity(identity, opts) {
  const pid = Number(identity && identity.pid);
  const mismatches = [];

  if (process.platform === 'win32') {
    return {
      exists: processExists(pid),
      ok: processExists(pid),
      mismatches,
      verification_skipped: 'non-posix',
      live: { start_time: '', command: '' }
    };
  }

  if (!processExists(pid)) {
    return { exists: false, ok: false, mismatches: ['pid-missing'], live: { start_time: '', command: '' } };
  }

  const live = {
    start_time: liveStartTime(pid),
    command: liveCommand(pid)
  };

  if (!live.start_time && !live.command) {
    // Process exists (kill 0 succeeded) but ps cannot read it — unverifiable.
    return { exists: true, ok: false, mismatches: ['unverifiable'], live };
  }

  const recordedStart = normalizeStartTime(identity.start_time);
  const liveStart = normalizeStartTime(live.start_time);
  if (!recordedStart || recordedStart !== liveStart) {
    mismatches.push('start_time');
  }

  const recordedFingerprint = String(identity.argv_fingerprint || '');
  const liveFingerprint = computeArgvFingerprint(live.command ? live.command.split(/\s+/) : []);
  const fingerprintOk =
    recordedFingerprint.length === 64 && recordedFingerprint === liveFingerprint;
  const semanticOk = argvMatchesSemantically(identity, live.command);
  if (!fingerprintOk && !semanticOk) {
    mismatches.push('argv');
  }

  return { exists: true, ok: mismatches.length === 0, mismatches, live };
}

// ---------------------------------------------------------------------------
// watcher set normalization + spawning
// ---------------------------------------------------------------------------

// Accepts an array of:
//   string            — name; script resolved to tools/signals/<name>.js,
//                       launched with process.execPath
//   { name, script }  — script resolved relative to the project root,
//                       launched with process.execPath
//   { name, command, args } — fully custom argv (e.g. node -e ...), launched
//                       with `command` as the executable
// Returns normalized entries: { name, executable, argv, script }.
function normalizeWatcherSet(watcherSet, projectRoot) {
  const root = projectRoot || PROJECT_ROOT;
  const source = watcherSet == null ? DEFAULT_WATCHER_SET : watcherSet;
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error('watcher-lifecycle: watcherSet must be a non-empty array of names or entry objects');
  }

  const seen = new Set();
  const entries = [];
  for (const item of source) {
    let name;
    let executable;
    let argvTail = [];
    let script = null;
    let readiness;
    let env = {};

    if (typeof item === 'string') {
      name = item;
      script = path.resolve(root, 'tools', 'signals', `${item}.js`);
      executable = process.execPath;
      argvTail = [script];
      readiness = 'ipc-required';
    } else if (item && typeof item === 'object') {
      name = item.name;
      readiness = item.readiness;
      env = item.env && typeof item.env === 'object' ? Object.assign({}, item.env) : {};
      if (readiness !== 'ipc-required' && readiness !== 'liveness-only') {
        throw new Error(`watcher-lifecycle: custom watcher ${String(name || '<unnamed>')} must declare readiness 'ipc-required' or 'liveness-only'`);
      }
      if (item.command) {
        executable = String(item.command);
        argvTail = Array.isArray(item.args) ? item.args.map(String) : [];
        if (item.script) script = String(item.script);
      } else if (item.script) {
        script = path.isAbsolute(String(item.script))
          ? String(item.script)
          : path.resolve(root, String(item.script));
        executable = process.execPath;
        argvTail = [script];
      } else {
        throw new Error(`watcher-lifecycle: watcher entry ${JSON.stringify(item)} needs script or command`);
      }
    } else {
      throw new Error(`watcher-lifecycle: invalid watcher entry ${JSON.stringify(item)}`);
    }

    if (!name || typeof name !== 'string') {
      throw new Error('watcher-lifecycle: watcher entry missing name');
    }
    if (seen.has(name)) {
      throw new Error(`watcher-lifecycle: duplicate watcher name ${name}`);
    }
    if (DEFAULT_WATCHER_SET.includes(name) && readiness !== 'ipc-required') {
      throw new Error(`watcher-lifecycle: default watcher ${name} requires readiness 'ipc-required'`);
    }
    seen.add(name);
    if (script && !fs.existsSync(script)) {
      throw new Error(`watcher-lifecycle: watcher script not found: ${script}`);
    }
    entries.push({ name, executable, argv: [executable, ...argvTail], script, readiness, env });
  }
  return entries;
}

function watcherIdentity(entry, child, startTime) {
  return {
    name: entry.name,
    pid: child.pid,
    start_time: startTime,
    executable: entry.executable,
    executable_basename: executableBasename(entry.executable),
    argv: entry.argv.slice(),
    argv_fingerprint: computeArgvFingerprint(entry.argv),
    script: entry.script || null,
    spawned_at: new Date().toISOString(),
    readiness: entry.readiness,
    readiness_degraded: entry.readiness === 'liveness-only'
  };
}

function protocolWaiter(child, entry, nonce, expectedType, timeoutMs) {
  let settled = false;
  let timer;
  let rejectPromise;
  let onMessage;
  let onExit;
  let onError;
  let onDisconnect;
  const cleanup = () => {
    clearTimeout(timer);
    child.removeListener('message', onMessage);
    child.removeListener('exit', onExit);
    child.removeListener('error', onError);
    child.removeListener('disconnect', onDisconnect);
  };
  const rejectOnce = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(error);
  };
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    const succeed = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(message);
    };
    onMessage = (message) => {
      if (!isExactWatcherMessage(message, expectedType, { name: entry.name, nonce, pid: child.pid })) {
        rejectOnce(new Error(`watcher-lifecycle: watcher ${entry.name} sent malformed or unexpected ${expectedType} acknowledgement`));
        return;
      }
      succeed(message);
    };
    onExit = (code, signal) => rejectOnce(new Error(`watcher-lifecycle: watcher ${entry.name} exited before ${expectedType} (code ${code}, signal ${signal || 'none'})`));
    onError = (error) => rejectOnce(error);
    onDisconnect = () => rejectOnce(new Error(`watcher-lifecycle: watcher ${entry.name} disconnected before ${expectedType}`));
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
    child.once('disconnect', onDisconnect);
    timer = setTimeout(() => rejectOnce(new Error(`watcher-lifecycle: watcher ${entry.name} timed out waiting for ${expectedType}`)), timeoutMs);
  });
  return { promise, cancel: cleanup };
}

function sendControl(child, entry, nonce, type) {
  return new Promise((resolve, reject) => {
    if (!child.connected) {
      reject(new Error(`watcher-lifecycle: watcher ${entry.name} IPC disconnected before ${type}`));
      return;
    }
    child.send(makeWatcherMessage(type, entry.name, child.pid, nonce), (error) => error ? reject(error) : resolve());
  });
}

// Spawn one normalized entry and settle its declared readiness boundary. The
// returned child stays referenced and under parent custody until finalize().
function spawnWatcher(entry, opts = {}) {
  return new Promise((resolve, reject) => {
    const name = entry.name;
    const prepareTimeoutMs = opts.prepareTimeoutMs || PREPARE_TIMEOUT_MS;
    const committedTimeoutMs = opts.committedTimeoutMs || COMMITTED_TIMEOUT_MS;
    const startupSettleMs = opts.startupSettleMs || STARTUP_SETTLE_MS;
    const nonce = crypto.randomBytes(24).toString('hex');
    let child;
    let identity;
    let settled = false;
    let settleTimer;
    let preparedWaiter;
    let startupFailure = null;
    let startupAccepted = false;
    const latchStartupFailure = (error) => {
      if (!startupAccepted && !startupFailure) startupFailure = error;
      return startupFailure;
    };
    const fail = (err, reapChild) => {
      if (settled) return;
      latchStartupFailure(err);
      settled = true;
      clearTimeout(settleTimer);
      if (preparedWaiter) preparedWaiter.cancel();
      if (child) {
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        child.removeListener('disconnect', onDisconnect);
      }
      if (reapChild && child && child.pid != null) {
        reapOwnedChild(child).then((result) => {
          if (result && result.ok === false) {
            attachSecondaryError(
              err,
              'cleanup_error',
              `owned watcher ${name} (pid ${child.pid}) cleanup failed`,
              result.error
            );
            if (identity) {
              err.owned_control = { name, child, identity, entry, nonce, abort: async () => {}, finalize: () => {} };
            }
          }
          reject(err);
        });
      } else {
        reject(err);
      }
    };
    const onError = (err) => {
      latchStartupFailure(err);
      fail(err, true);
    };
    const onExit = (code, signal) => {
      const error = new Error(`watcher-lifecycle: watcher ${name} exited during startup (code ${code}, signal ${signal || 'none'})`);
      latchStartupFailure(error);
      fail(error, true);
    };
    const onDisconnect = () => {
      const error = new Error(`watcher-lifecycle: watcher ${name} disconnected during startup`);
      latchStartupFailure(error);
      fail(error, true);
    };
    try {
      child = spawn(entry.executable, entry.argv.slice(1), {
        stdio: entry.readiness === 'ipc-required' ? ['ignore', 'ignore', 'ignore', 'ipc'] : (opts.stdio || 'ignore'),
        env: Object.assign({}, process.env, entry.env, entry.readiness === 'ipc-required' ? {
          [READY_ENV.NONCE]: nonce,
          [READY_ENV.NAME]: name,
          [READY_ENV.COMMIT_TIMEOUT_MS]: String(committedTimeoutMs)
        } : {})
      });
    } catch (err) {
      onError(err);
      return;
    }
    // Asynchronous spawn failure (e.g. ENOENT for a bad command): reject
    // rather than recording a pid-less identity.
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('disconnect', onDisconnect);
    if (entry.readiness === 'ipc-required') {
      preparedWaiter = protocolWaiter(child, entry, nonce, MESSAGE_TYPES.PREPARED, prepareTimeoutMs);
      preparedWaiter.promise.catch(() => {});
    }

    const record = (attempt = 0) => {
      if (settled || child.pid == null) return; // settles via 'error' or next retry
      const startTime = liveStartTime(child.pid);
      if (!startTime) {
        if (attempt < START_TIME_RETRIES - 1) {
          setTimeout(() => record(attempt + 1), START_TIME_RETRY_MS);
          return;
        }
        fail(new Error(`watcher-lifecycle: unable to determine start time for spawned watcher ${name} (pid ${child.pid})`), true);
        return;
      }
      identity = watcherIdentity(entry, child, startTime);
      const ready = () => {
        if (settled) return;
        if (startupFailure) {
          fail(startupFailure, true);
          return;
        }
        if (child.exitCode !== null || child.signalCode !== null || !processExists(child.pid)) {
          fail(new Error(`watcher-lifecycle: watcher ${name} exited during startup`), true);
          return;
        }
        const finalStartTime = liveStartTime(child.pid);
        if (!finalStartTime || normalizeStartTime(finalStartTime) !== normalizeStartTime(startTime)) {
          fail(new Error(`watcher-lifecycle: watcher ${name} became unverifiable during startup`), true);
          return;
        }
        spawned.set(`${opts.sessionId}::${name}`, child);
        settled = true;
        const control = {
          name, child, identity, entry, nonce,
          async commit() {
            if (startupFailure) throw startupFailure;
            if (entry.readiness !== 'ipc-required') return;
            const committed = protocolWaiter(child, entry, nonce, MESSAGE_TYPES.COMMITTED, committedTimeoutMs);
            try {
              await sendControl(child, entry, nonce, MESSAGE_TYPES.COMMIT);
              await committed.promise;
              if (startupFailure) throw startupFailure;
            } catch (error) {
              committed.cancel();
              // A direct caller may catch this rejection. Preserve the
              // terminal startup failure so it cannot later accept/finalize
              // this control as though COMMIT had succeeded.
              latchStartupFailure(error);
              throw startupFailure || error;
            }
          },
          async abort() {
            // ABORT is a terminal startup decision even when its IPC delivery
            // succeeds. Latch it before sending so a direct caller cannot
            // accept this control after requesting rollback.
            latchStartupFailure(new Error(`watcher-lifecycle: watcher ${name} startup aborted`));
            if (entry.readiness === 'ipc-required' && child.connected) {
              try { await sendControl(child, entry, nonce, MESSAGE_TYPES.ABORT); } catch (error) {
                latchStartupFailure(error);
                /* reap owns cleanup */
              }
            }
          },
          finalize() {
            if (startupFailure) throw startupFailure;
            startupAccepted = true;
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
            child.removeListener('disconnect', onDisconnect);
            if (child.connected) child.disconnect();
            child.unref();
          },
          getStartupFailure() {
            return startupFailure;
          },
          acceptStartup() {
            if (startupFailure) throw startupFailure;
            startupAccepted = true;
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
            child.removeListener('disconnect', onDisconnect);
          }
        };
        resolve(control);
      };
      if (entry.readiness === 'ipc-required') {
        preparedWaiter.promise.then(ready, (error) => fail(error, true));
      } else {
        settleTimer = setTimeout(ready, startupSettleMs);
      }
    };
    record();
  });
}

function blockedRepairRecord(operation, sid, root, identity, blocker, originalError, durable) {
  return {
    status: 'blocked_repair',
    operation,
    session_id: sid,
    watcher_name: identity.name,
    pid: identity.pid,
    observed_start_time: identity.start_time || 'unavailable',
    blocker,
    original_operation_error: originalError,
    gate_owner: 'lifecycle integrator/coordinator',
    forbidden_repeat_action: `startWatchers for session ${sid} while owned residue is unresolved`,
    safe_pickup_command: `node tools/sessions/watcher-lifecycle.cjs stop ${sid} --root ${root}`,
    durable_identity_persisted: Boolean(durable),
    storage_note: durable
      ? 'owned identity is durably retained in the session registry'
      : 'durable persistence was not achieved; only this result carries the owned handle evidence'
  };
}

async function cleanupOwnedControls(sid, root, controls, originalError, registryWasDurable, opts = {}) {
  const residue = [];
  const survivors = {};
  for (const control of controls) {
    try { await control.abort(); } catch (_) { /* reap below */ }
    const result = await (opts.reapOwnedChild || reapOwnedChild)(control.child);
    if (result.ok) {
      spawned.delete(`${sid}::${control.name}`);
    } else {
      survivors[control.name] = control.identity;
      residue.push(blockedRepairRecord('start', sid, root, control.identity, result.error.message, originalError, registryWasDurable));
    }
  }
  if (registryWasDurable) writeRegistry(sid, { watchers: survivors }, root);
  return residue;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

// Start every daemon in watcherSet (default: DEFAULT_WATCHER_SET). Managed
// children first prove PREPARED; the complete identity set is then published
// before any COMMIT is sent. Resolves
//   { ok, started: [identity...], failed: [{name, error}...],
//     preemptively_stopped: [name...], cleanup_refused: [{name, mismatches,
//     reason}...], rolled_back: [name...] }.
//
// PRE-EMPTIVE CLEANUP PASS (S11 amendment, gemini finding 2 + codex finding 4):
// re-running /new-session must never orphan duplicate daemons. BEFORE spawning,
// any live entries already in the session registry are identity-verified and
// stopped via stopWatchers; identity-mismatched occupants are REFUSED (never
// signaled, fail-closed) and the refusal is surfaced in `cleanup_refused` and
// counted as a failure, so the fresh start is rolled back and the caller halts.
//
// PARTIAL-START FAILURE HANDLING (S11 amendment, codex finding 4): if ANY
// watcher in the set fails to start, the already-started set of THIS call is
// stopped again (rollback) and `ok` is false, so the session-open path halts
// and no orphaned partial set is left running. A fresh daemon that cannot be
// reaped stays recorded in the registry (durable partial record) for a later
// /shutdown to clean up.
async function startWatchers(sessionId, watcherSet, opts) {
  opts = opts || {};
  const root = opts.projectRoot || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const entries = normalizeWatcherSet(watcherSet, root);
  const lock = acquireSessionLock(sid, root, opts);
  let operationError;

  try {
    const preemptivelyStopped = [];
    const cleanupRefused = [];
    const existing = readRegistry(sid, root, opts);
    if (existing && Object.keys(existing.watchers).length > 0) {
      const stop = await stopWatchersUnlocked(sid, Object.assign({}, opts, { projectRoot: root }));
      preemptivelyStopped.push(...stop.signaled, ...stop.stale);
      for (const refusal of stop.refused) {
        cleanupRefused.push({ name: refusal.name, mismatches: refusal.mismatches, reason: refusal.reason, identity: refusal.identity });
      }
    }

    if (cleanupRefused.length > 0) {
      return {
        ok: false,
        status: 'blocked_repair',
        started: [],
        failed: cleanupRefused.map((item) => ({ name: item.name, error: `pre-emptive cleanup refused: ${item.reason}` })),
        preemptively_stopped: preemptivelyStopped,
        cleanup_refused: cleanupRefused,
        rolled_back: [],
        blocked_repair: cleanupRefused.map((item) => blockedRepairRecord(
          'start', sid, root, item.identity, item.reason,
          `pre-emptive cleanup refused: ${item.mismatches.join(', ')}`,
          true
        ))
      };
    }

    const controls = [];
    const failed = [];

    for (const entry of entries) {
      try {
        controls.push(await spawnWatcher(entry, Object.assign({}, opts, { projectRoot: root, sessionId: sid })));
      } catch (err) {
        if (err.owned_control) controls.push(err.owned_control);
        failed.push({ name: entry.name, error: err.message });
        break;
      }
    }

    if (failed.length > 0) {
      const residue = await cleanupOwnedControls(sid, root, controls, failed[0].error, false, opts);
      return {
        ok: false,
        status: residue.length ? 'blocked_repair' : 'failed',
        started: controls.map((item) => item.identity),
        failed,
        preemptively_stopped: preemptivelyStopped,
        cleanup_refused: [],
        rolled_back: controls.filter((item) => !residue.some((record) => record.watcher_name === item.name)).map((item) => item.name),
        blocked_repair: residue
      };
    }

    const registry = { watchers: Object.fromEntries(controls.map((control) => [control.name, control.identity])) };
    let registryDurable = false;
    try {
      writeRegistry(sid, registry, root);
      registryDurable = true;
      for (const control of controls) {
        await control.commit();
      }
      for (const control of controls) {
        const final = verifyIdentity(control.identity, { projectRoot: root });
        if (!final.exists || !final.ok) {
          throw new Error(`watcher-lifecycle: watcher ${control.name} failed final identity verification (${final.mismatches.join(', ')})`);
        }
      }
      for (const control of controls) {
        const failure = control.getStartupFailure();
        if (failure) throw failure;
      }
      // This synchronous acceptance turn is the startup linearization point:
      // all terminal events observed through the final identity check must be
      // latched before listeners are removed and the child is detached.
      for (const control of controls) control.acceptStartup();
      for (const control of controls) control.finalize();
      return {
        ok: true,
        status: 'committed',
        started: controls.map((item) => item.identity),
        failed: [],
        preemptively_stopped: preemptivelyStopped,
        cleanup_refused: [],
        rolled_back: []
      };
    } catch (err) {
      const residue = await cleanupOwnedControls(sid, root, controls, err.message, registryDurable, opts);
      if (residue.length > 0) {
        return {
          ok: false,
          status: 'blocked_repair',
          started: controls.map((item) => item.identity),
          failed: [{ name: 'managed-startup', error: err.message }],
          preemptively_stopped: preemptivelyStopped,
          cleanup_refused: [],
          rolled_back: controls.filter((item) => !residue.some((record) => record.watcher_name === item.name)).map((item) => item.name),
          blocked_repair: residue
        };
      }
      if (registryDurable) writeRegistry(sid, { watchers: {} }, root);
      throw err;
    }
  } catch (err) {
    operationError = err;
    throw err;
  }
  finally {
    try {
      releaseSessionLock(lock);
    } catch (err) {
      if (operationError) {
        attachSecondaryError(operationError, 'lock_release_error', 'session lock release failed', err);
      } else {
        throw err;
      }
    }
  }
}

// Stop exactly the session-start set recorded in the registry. Each entry is
// identity-verified BEFORE signaling: mismatches are refused (entry retained,
// occupant NOT signaled, reported in refused/blocked_repair), dead processes are removed as
// stale without signaling, and verified survivors get SIGTERM (then SIGKILL
// after `graceMs` if still alive, re-verifying start_time before escalation).
// Resolves { signaled: [name...], refused: [{name, mismatches, reason}],
//            stale: [name...], registry_missing: bool }.
async function stopWatchersUnlocked(sessionId, opts) {
  const root = (opts && opts.projectRoot) || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const signal = (opts && opts.signal) || 'SIGTERM';
  const escalateSignal = (opts && opts.escalateSignal) || 'SIGKILL';
  const graceMs = (opts && opts.graceMs) || 5000;

  const registry = readRegistry(sid, root, opts);
  if (!registry) {
    return { status: 'stopped', signaled: [], refused: [], stale: [], registry_missing: true, blocked_repair: [] };
  }

  const signaled = [];
  const refused = [];
  const stale = [];
  const names = Object.keys(registry.watchers);

  for (const name of names) {
    const identity = registry.watchers[name];
    const verification = verifyIdentity(identity, { projectRoot: root });

    if (!verification.exists) {
      delete registry.watchers[name];
      stale.push(name);
      continue;
    }
    if (!verification.ok) {
      refused.push({
        name,
        mismatches: verification.mismatches,
        reason: 'identity-mismatch-fail-closed',
        identity
      });
      continue;
    }

    // Identity verified — signal gracefully.
    try {
      process.kill(identity.pid, signal);
    } catch (err) {
      if (err.code === 'ESRCH') {
        delete registry.watchers[name];
        stale.push(name);
        continue;
      }
      if (err.code === 'EPERM') {
        refused.push({ name, mismatches: ['signal-permission'], reason: err.code, identity });
        continue;
      }
      throw err;
    }

    // Wait for graceful exit (bounded by graceMs).
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && processExists(identity.pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!processExists(identity.pid)) {
      delete registry.watchers[name];
      spawned.delete(`${sid}::${name}`);
      signaled.push(name);
      continue;
    }

    // Still alive — re-verify identity (PID-reuse guard) before escalation.
    const recheck = verifyIdentity(identity, { projectRoot: root });
    if (recheck.exists && recheck.ok) {
      try {
        process.kill(identity.pid, escalateSignal);
      } catch (err) {
        if (err.code !== 'ESRCH') {
          refused.push({ name, mismatches: ['escalate-signal'], reason: err.code, identity });
          continue;
        }
      }
      const hardDeadline = Date.now() + graceMs;
      while (Date.now() < hardDeadline && processExists(identity.pid)) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (processExists(identity.pid)) {
      // Could not reap after escalation — do not drop identity evidence.
      refused.push({ name, mismatches: ['unreapable'], reason: 'still-alive-after-escalation', identity });
      continue;
    }
    delete registry.watchers[name];
    spawned.delete(`${sid}::${name}`);
    signaled.push(name);
  }

  if (names.length > 0) writeRegistry(sid, registry, root);
  const blockedRepair = refused.map((item) => blockedRepairRecord(
    'stop', sid, root, item.identity,
    item.reason,
    `stop refused: ${item.mismatches.join(', ')}`,
    true
  ));
  return {
    status: blockedRepair.length > 0 ? 'blocked_repair' : 'stopped',
    signaled,
    refused,
    stale,
    registry_missing: false,
    blocked_repair: blockedRepair
  };
}

async function stopWatchers(sessionId, opts) {
  opts = opts || {};
  const root = opts.projectRoot || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const lock = acquireSessionLock(sid, root, opts);
  let operationError;
  try {
    return await stopWatchersUnlocked(sid, opts);
  } catch (err) {
    operationError = err;
    throw err;
  } finally {
    try {
      releaseSessionLock(lock);
    } catch (err) {
      if (operationError) {
        attachSecondaryError(operationError, 'lock_release_error', 'session lock release failed', err);
      } else {
        throw err;
      }
    }
  }
}

// List the current registry entries for a session (array of identities, in
// insertion order) or [] when the registry does not exist.
function listRegistry(sessionId, opts) {
  const root = (opts && opts.projectRoot) || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const registry = readRegistry(sid, root, opts);
  if (!registry) return [];
  return Object.values(registry.watchers);
}

// ---------------------------------------------------------------------------
// CLI entry (S11 wiring)
// ---------------------------------------------------------------------------
//
// Executed by the /new-session and /shutdown mechanical runners via the
// registered '0' commands in each handler's defaultCommands():
//
//   node tools/sessions/watcher-lifecycle.cjs start <session-id> [--root <dir>]
//   node tools/sessions/watcher-lifecycle.cjs stop  <session-id> [--root <dir>]
//
//   start — runs startWatchers(DEFAULT_WATCHER_SET): exit 0 when the whole set
//           is running after the pre-emptive cleanup pass; exit 1 when any
//           watcher failed to start (partial-start rollback already ran) or a
//           pre-emptive cleanup refusal was encountered (fail closed).
//   stop  — runs stopWatchers: exit 0 when every recorded watcher was signaled
//           or found stale/missing; exit 1 when any entry was refused
//           (identity-mismatch fail-closed — those watchers may still be
//           running and the caller must NOT continue closeout around them).
//
// An empty/unresolvable session id is a clean no-op (exit 0, reported): a
// daemon that cannot be recorded under a session registry could never be
// identity-verified later, so nothing is spawned. --root overrides the project
// root (explicit wiring + test seam; defaults to the real repo).
async function main() {
  const args = process.argv.slice(2);
  const op = args[0];
  const sid = String(args[1] || '').trim();
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : PROJECT_ROOT;

  if (op !== 'start' && op !== 'stop') {
    process.stderr.write('usage: node tools/sessions/watcher-lifecycle.cjs <start|stop> <session-id> [--root <dir>]\n');
    process.exitCode = 2;
    return;
  }
  if (!sid) {
    process.stdout.write(JSON.stringify({ ok: true, noop: 'no session id; no watcher lifecycle action taken' }) + '\n');
    process.exitCode = 0;
    return;
  }

  if (op === 'start') {
    const result = await startWatchers(sid, DEFAULT_WATCHER_SET, { projectRoot: root });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const result = await stopWatchers(sid, { projectRoot: root });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.refused.length > 0 ? 1 : 0;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`watcher-lifecycle: ${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

// Test/introspection surface.
function spawnedChildren() {
  return spawned;
}

module.exports = {
  DEFAULT_WATCHER_SET,
  REGISTRY_FILE,
  REGISTRY_SCHEMA,
  startWatchers,
  stopWatchers,
  listRegistry,
  // helpers (used by the test suite)
  normalizeStartTime,
  computeArgvFingerprint,
  normalizeSessionId,
  normalizeWatcherSet,
  registryFilePath,
  sessionLockDbPath,
  acquireSessionLock,
  releaseSessionLock,
  nodeVersionSupported,
  readRegistry,
  writeRegistry,
  spawnWatcher,
  verifyIdentity,
  processExists,
  liveStartTime,
  liveCommand,
  spawnedChildren
};
