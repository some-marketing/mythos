'use strict';

/**
 * append-lock.cjs — Fail-open advisory append-locking for dispatches.jsonl (P2).
 *
 * The council named **append-locking** as a store-robustness requirement: when
 * several shell boundaries (codex-auto, actor-auto, dispatch-bridge, the
 * SessionStart hook) append concurrently, two writers can interleave a partial
 * line and corrupt a span row. On local POSIX filesystems a single
 * `appendFileSync` of one short newline-terminated line is effectively atomic
 * (O_APPEND + write < PIPE_BUF), but the line length is unbounded (a span can
 * carry long actor_reason / framework arrays), so we serialize appends behind a
 * short-lived lockfile.
 *
 * CONSTITUTIONAL INVARIANT (inherited from emit-span): the telemetry surface is
 * a PASSIVE SENSOR, never a regulator. Locking is therefore FAIL-OPEN — if the
 * lock cannot be acquired (contention past the deadline, EROFS, a stale lock we
 * cannot clear), we append anyway rather than drop or block a span. A missed
 * lock degrades to the pre-P2 behavior (plain append); it never throws into, and
 * never blocks, a dispatch.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_RETRY_MS = 5;       // backoff between lock attempts
const DEFAULT_DEADLINE_MS = 250;  // give up and append unlocked past this
const STALE_LOCK_MS = 10 * 1000;  // a lock older than this is presumed orphaned

function lockPathFor(file) {
  return file + '.lock';
}

/**
 * tryAcquire — attempt an exclusive create of the lockfile. Returns true on
 * success. O_EXCL gives us cross-process mutual exclusion on a single host.
 */
function tryAcquire(lockFile) {
  try {
    const fd = fs.openSync(lockFile, 'wx'); // wx === O_CREAT|O_EXCL|O_WRONLY
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    // Any other error (EROFS, EACCES, ENOENT on dir) — surface as "could not
    // lock" so the caller fails open.
    throw err;
  }
}

/**
 * breakIfStale — clear a lock whose mtime is older than STALE_LOCK_MS. A crashed
 * writer must not wedge the surface forever (a regulator failure mode). Best
 * effort: any error is swallowed and the caller proceeds to fail open.
 */
function breakIfStale(lockFile) {
  try {
    const st = fs.statSync(lockFile);
    if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
      fs.unlinkSync(lockFile);
    }
  } catch (_) {
    // missing or unreadable lock — nothing to break.
  }
}

function busySleep(ms) {
  // Synchronous tiny sleep without pulling in worker_threads. The append path is
  // already synchronous (appendFileSync); a few ms of spin under rare contention
  // is acceptable and keeps the writer a single straight-line call.
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/**
 * appendLineLocked — append one line to `file` under a best-effort lock.
 *
 * Never throws. Returns { locked: boolean } so a caller / test can observe
 * whether serialization was achieved, but a false `locked` is NOT an error — the
 * line is still appended (fail-open).
 */
function appendLineLocked(file, line, opts = {}) {
  const deadline = Date.now() + (opts.deadlineMs || DEFAULT_DEADLINE_MS);
  const retryMs = opts.retryMs || DEFAULT_RETRY_MS;
  const lockFile = lockPathFor(file);
  let locked = false;

  try {
    while (Date.now() < deadline) {
      let acquired = false;
      try {
        acquired = tryAcquire(lockFile);
      } catch (_) {
        // Lock medium itself is unusable — fail open immediately.
        break;
      }
      if (acquired) { locked = true; break; }
      breakIfStale(lockFile);
      busySleep(retryMs);
    }

    try {
      fs.appendFileSync(file, line);
    } finally {
      if (locked) {
        try { fs.unlinkSync(lockFile); } catch (_) { /* already gone */ }
      }
    }
  } catch (err) {
    // Last-ditch fail-open: try a raw append even if the locked path threw.
    try { fs.appendFileSync(file, line); } catch (_) { /* give up silently */ }
  }

  return { locked };
}

/**
 * withFileLock — run `fn` inside the same best-effort critical section used by
 * appendLineLocked, so a multi-step write (e.g. rotate-then-append) is atomic
 * against other lock-respecting writers. Fail-open: if the lock cannot be
 * acquired, `fn` STILL runs exactly once (passive-sensor invariant — never drop
 * or block a span). `fn` receives `locked` for observability. Never throws.
 */
function withFileLock(file, fn, opts = {}) {
  const deadline = Date.now() + (opts.deadlineMs || DEFAULT_DEADLINE_MS);
  const retryMs = opts.retryMs || DEFAULT_RETRY_MS;
  const lockFile = lockPathFor(file);
  let locked = false;
  while (Date.now() < deadline) {
    try {
      if (tryAcquire(lockFile)) { locked = true; break; }
    } catch (_) {
      break; // lock medium unusable — fail open
    }
    breakIfStale(lockFile);
    busySleep(retryMs);
  }
  try {
    return fn(locked);
  } finally {
    if (locked) {
      try { fs.unlinkSync(lockFile); } catch (_) { /* already gone */ }
    }
  }
}

module.exports = { appendLineLocked, withFileLock, lockPathFor };
