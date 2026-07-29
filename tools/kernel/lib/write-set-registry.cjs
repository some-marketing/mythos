'use strict';

/**
 * write-set-registry.cjs — S1 of cross-session-scope-isolation.
 *
 * A LIVE, cross-session registry of per-actor reserved write-set globs. Each
 * entry is keyed by sessionId+pid and carries a ttl + heartbeat so a dead
 * actor's reservation self-expires. The registry is the substrate the S2
 * cross-session conflict check will read (the UNION of OTHER live actors'
 * reservations) and the S3 enforcing guard will block against — but THIS file
 * does NO enforcement. Overlaps are surfaced at INFO only.
 *
 * Atomicity: each reservation is a SEPARATE file under the registry dir,
 * written with the active-session-registry tmp+fsync+rename+fsyncdir pattern
 * (reused, not reinvented). A separate-file-per-actor layout means concurrent
 * actors never contend on one shared file (the very last-writer-wins race this
 * workstream exists to kill).
 *
 * Hot-path cost (nervous-system speed tiers): check() is a Tier-2 autonomic
 * operation on the write path, so it must NOT do a full directory scan +
 * JSON.parse per write. A short-TTL in-memory fast-path cache of the parsed,
 * pruned registry serves repeated checks; it is invalidated on any local
 * reserve()/release() and re-validated by file mtime/count, so cross-process
 * reservations are picked up within the cache window without re-reading on
 * every single call.
 *
 * Canonical root resolves via resolveCanonicalRoot({mode:'hard'}), lazy +
 * memoized so merely require()-ing this module (e.g. from a hook on the
 * advisory require() path) can NEVER throw at module-load on a broken root.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { resolveCanonicalRoot } = require('../../lib/canonical-root.cjs');
const {
  normalizeRepoPath,
  pathMatchesPattern
} = require('./scope-expansion-detector.cjs');

// --- canonical root (lazy + memoized) --------------------------------------

let _projectRoot = null;
function getProjectRoot() {
  if (_projectRoot === null) {
    _projectRoot = resolveCanonicalRoot({ mode: 'hard' });
  }
  return _projectRoot;
}

const REGISTRY_DIR_ENV = 'MYTHOS_WRITE_SET_REGISTRY_DIR';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — matches active-session default
const FASTPATH_CACHE_TTL_MS = 1000; // 1s autonomic window for the hot write path

function getDefaultRegistryDir() {
  return path.join(getProjectRoot(), '_dev', 'state', 'write-set-registry');
}

let _dirOverride = null;
function getRegistryDir() {
  return path.resolve(_dirOverride || process.env[REGISTRY_DIR_ENV] || getDefaultRegistryDir());
}

/** Test/affordance: pin the registry dir (mirrors active-session-registry.setDataDir). */
function setRegistryDir(dir) {
  _dirOverride = dir ? path.resolve(dir) : null;
  invalidateCache();
}
function resetRegistryDir() {
  _dirOverride = null;
  invalidateCache();
}

// --- actor / time helpers ---------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function resolveSessionId(explicit) {
  return (
    explicit ||
    process.env.MYTHOS_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    null
  );
}

function resolveActorId(explicit) {
  return (
    explicit ||
    process.env.MYTHOS_ACTOR_ID ||
    process.env.CLAUDE_AGENT_ID ||
    process.env.CLAUDE_SUBAGENT_ID ||
    (process.env.CLAUDE_SESSION_ID
      ? `claude-main-chain-session:${process.env.CLAUDE_SESSION_ID}`
      : 'unknown-actor')
  );
}

function reservationKey(sessionId, pid) {
  return `${sessionId}::${pid}`;
}

function keyToFileName(key) {
  return String(key).replace(/[\\/:]/g, '__') + '.json';
}

// --- atomic write (active-session-registry tmp+fsync+rename+fsyncdir) -------

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fsyncDir(dirPath) {
  let dirFd = null;
  try {
    dirFd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(dirFd);
  } catch (error) {
    return;
  } finally {
    if (dirFd !== null) {
      fs.closeSync(dirFd);
    }
  }
}

function writeJsonAtomic(filePath, data) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);

  const tempPath = path.join(
    dirPath,
    `${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );

  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'w');
    fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    fsyncDir(dirPath);
  } catch (error) {
    if (fd !== null) {
      fs.closeSync(fd);
    }
    try {
      fs.unlinkSync(tempPath);
    } catch (unlinkError) {
      // Ignore cleanup failures; preserve the original write failure.
    }
    throw error;
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err; // malformed handled by callers that swallow per-file
  }
}

// --- fast-path cache --------------------------------------------------------
//
// Cache holds the parsed + TTL-pruned list of reservations plus a cheap
// signature (dir mtimeMs + entry count). On a check(), if the cache is younger
// than FASTPATH_CACHE_TTL_MS we reuse it without touching disk. Past the
// window we re-read the directory listing only (one stat), and only re-parse
// when the signature changed — so the steady-state hot path is one stat, not N
// JSON.parse calls.

let _cache = null; // { at: ms, dir: string, signature: string, entries: [] }

function invalidateCache() {
  _cache = null;
}

function dirSignature(dirPath) {
  let names;
  try {
    names = fs.readdirSync(dirPath).filter((n) => n.endsWith('.json'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return { signature: 'EMPTY', files: [] };
    throw err;
  }
  names.sort();
  let mtimeAcc = 0;
  for (const n of names) {
    try {
      mtimeAcc += fs.statSync(path.join(dirPath, n)).mtimeMs;
    } catch {
      // file vanished mid-scan; ignore
    }
  }
  return { signature: `${names.length}:${mtimeAcc}`, files: names };
}

function listReservationFiles(dirPath) {
  try {
    return fs
      .readdirSync(dirPath)
      .filter((n) => n.endsWith('.json'))
      .map((n) => path.join(dirPath, n));
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isExpired(entry, nowMs) {
  const ttlMs = Number.isFinite(entry.ttl_ms) ? entry.ttl_ms : DEFAULT_TTL_MS;
  const hbMs = Date.parse(entry.heartbeat);
  if (!Number.isFinite(hbMs)) return false; // can't judge -> treat as live
  return nowMs - hbMs > ttlMs;
}

/**
 * Load all live (non-expired) reservations, honoring the fast-path cache.
 * Returns a fresh array of reservation objects. opts.force bypasses the cache.
 */
function loadLiveReservations(opts) {
  const options = opts || {};
  const dirPath = getRegistryDir();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  if (
    !options.force &&
    _cache &&
    _cache.dir === dirPath &&
    Date.now() - _cache.at <= FASTPATH_CACHE_TTL_MS
  ) {
    // Inside the autonomic window: serve cached parse, re-prune for the supplied
    // clock so a passed-in nowMs (tests) still expires correctly.
    return _cache.entries.filter((e) => !isExpired(e, nowMs));
  }

  const { signature } = dirSignature(dirPath);
  if (
    !options.force &&
    _cache &&
    _cache.dir === dirPath &&
    _cache.signature === signature
  ) {
    // Window lapsed but nothing changed on disk: refresh timestamp, reuse parse.
    _cache.at = Date.now();
    return _cache.entries.filter((e) => !isExpired(e, nowMs));
  }

  const entries = [];
  for (const filePath of listReservationFiles(dirPath)) {
    let entry = null;
    try {
      entry = readJsonIfExists(filePath);
    } catch (err) {
      continue; // malformed reservation -> skip, never throw on the read path
    }
    if (entry && typeof entry === 'object') {
      entry.__file = filePath;
      entries.push(entry);
    }
  }

  _cache = { at: Date.now(), dir: dirPath, signature, entries };
  return entries.filter((e) => !isExpired(e, nowMs));
}

// --- public API -------------------------------------------------------------

/**
 * reserve(globs, opts) — register/refresh this actor's reserved write-set.
 * opts: { sessionId, actorId, pid, ttlMs, now }
 * Returns the persisted reservation record.
 */
function reserve(globs, opts) {
  const options = opts || {};
  const sessionId = resolveSessionId(options.sessionId);
  if (!sessionId) {
    throw new Error('reserve: sessionId is required (pass opts.sessionId or set MYTHOS_SESSION_ID/CLAUDE_SESSION_ID)');
  }
  const pid = Number.isFinite(options.pid) ? options.pid : process.pid;
  const actorId = resolveActorId(options.actorId);
  const now = options.now || nowIso();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;

  const normalizedGlobs = (Array.isArray(globs) ? globs : [globs])
    .filter((g) => g != null && String(g).trim() !== '')
    .map((g) => normalizeRepoPath(g));

  const key = reservationKey(sessionId, pid);
  const filePath = path.join(getRegistryDir(), keyToFileName(key));
  const existing = readJsonIfExists(filePath);

  const record = {
    key,
    session_id: sessionId,
    pid,
    actor_id: actorId,
    write_set: normalizedGlobs,
    ttl_ms: ttlMs,
    reserved_at: (existing && existing.reserved_at) || now,
    heartbeat: now
  };

  writeJsonAtomic(filePath, record);
  invalidateCache();
  return record;
}

/**
 * heartbeat(opts) — refresh the heartbeat on this actor's reservation without
 * changing its write_set, so a long-lived actor's reservation stays live.
 * opts: { sessionId, pid, now }. Returns the record, or null if none exists.
 */
function heartbeat(opts) {
  const options = opts || {};
  const sessionId = resolveSessionId(options.sessionId);
  if (!sessionId) {
    throw new Error('heartbeat: sessionId is required');
  }
  const pid = Number.isFinite(options.pid) ? options.pid : process.pid;
  const filePath = path.join(getRegistryDir(), keyToFileName(reservationKey(sessionId, pid)));
  const existing = readJsonIfExists(filePath);
  if (!existing) return null;
  existing.heartbeat = options.now || nowIso();
  writeJsonAtomic(filePath, existing);
  invalidateCache();
  return existing;
}

/**
 * release(sessionId, opts) — drop this actor's reservation(s). With opts.pid,
 * releases the single sessionId+pid reservation; without it, releases every
 * reservation under that sessionId (all pids). Returns count released.
 */
function release(sessionId, opts) {
  const options = opts || {};
  const sid = resolveSessionId(sessionId);
  if (!sid) {
    throw new Error('release: sessionId is required');
  }
  const dirPath = getRegistryDir();
  let released = 0;

  if (Number.isFinite(options.pid)) {
    const filePath = path.join(dirPath, keyToFileName(reservationKey(sid, options.pid)));
    try {
      fs.unlinkSync(filePath);
      released += 1;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
  } else {
    for (const filePath of listReservationFiles(dirPath)) {
      const entry = readJsonIfExists(filePath);
      if (entry && entry.session_id === sid) {
        try {
          fs.unlinkSync(filePath);
          released += 1;
        } catch (err) {
          if (!err || err.code !== 'ENOENT') throw err;
        }
      }
    }
  }

  if (released > 0) {
    fsyncDir(dirPath);
    invalidateCache();
  }
  return released;
}

/**
 * pruneStale(opts) — delete every reservation whose heartbeat is older than
 * its ttl. Also runs implicitly on the read path (loadLiveReservations filters
 * expired entries out of results), but this physically removes them from disk.
 * opts: { now } / { nowMs }. Returns { pruned: [keys], remaining: count }.
 */
function pruneStale(opts) {
  const options = opts || {};
  const nowMs = Number.isFinite(options.nowMs)
    ? options.nowMs
    : options.now
    ? Date.parse(options.now)
    : Date.now();
  const dirPath = getRegistryDir();
  const pruned = [];
  let remaining = 0;

  for (const filePath of listReservationFiles(dirPath)) {
    const entry = readJsonIfExists(filePath);
    if (!entry) continue;
    if (isExpired(entry, nowMs)) {
      try {
        fs.unlinkSync(filePath);
        pruned.push(entry.key || path.basename(filePath, '.json'));
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
    } else {
      remaining += 1;
    }
  }

  if (pruned.length > 0) {
    fsyncDir(dirPath);
    invalidateCache();
  }
  return { pruned, remaining };
}

/**
 * readRegistry(opts) — return all LIVE (TTL-pruned) reservations as plain
 * records (the __file marker is stripped). opts.force bypasses the fast-path
 * cache; opts.now / opts.nowMs control the expiry clock.
 */
function readRegistry(opts) {
  const options = opts || {};
  const nowMs = Number.isFinite(options.nowMs)
    ? options.nowMs
    : options.now
    ? Date.parse(options.now)
    : Date.now();
  return loadLiveReservations({ force: options.force, nowMs }).map((e) => {
    const { __file, ...rest } = e;
    return rest;
  });
}

/**
 * check(intendedPath, actor, opts) — ADVISORY ONLY. Determine whether an
 * intended write overlaps a DIFFERENT live actor's reserved write-set. Nothing
 * is blocked; an overlap is logged at INFO and returned structurally.
 *
 * actor: { sessionId, pid } (or a string actorId for logging). The current
 *   actor's OWN reservation(s) are excluded from the overlap set — you can
 *   always write inside your own reservation.
 * opts: { now, nowMs, logger, force }. logger defaults to a stderr INFO line;
 *   pass { logger: null } to suppress logging (structural result still returned).
 *
 * Returns:
 *   {
 *     path, actor_session_id, actor_pid,
 *     overlaps: [{ session_id, pid, actor_id, matched_glob }],
 *     un_arc_overlap: boolean,   // current actor holds NO reservation AND overlaps another's
 *     conflict: boolean          // any overlap with a different actor
 *   }
 *
 * NOTE (S2 hook point): the structured `overlaps` array here is exactly the
 * "UNION of OTHER live actors' reservations" surface S2's cross-session
 * conflict check in scope-expansion-detector.cjs will consume. S2 turns this
 * advisory finding into a typed conflict; S3 turns the typed conflict into a
 * block. Neither belongs in this file.
 */
function check(intendedPath, actor, opts) {
  const options = opts || {};
  const actorObj = actor && typeof actor === 'object' ? actor : {};
  const sessionId = resolveSessionId(actorObj.sessionId);
  const pid = Number.isFinite(actorObj.pid) ? actorObj.pid : process.pid;
  const nowMs = Number.isFinite(options.nowMs)
    ? options.nowMs
    : options.now
    ? Date.parse(options.now)
    : Date.now();

  const normalizedPath = normalizeRepoPath(intendedPath);
  const live = loadLiveReservations({ force: options.force, nowMs });

  let currentActorHasReservation = false;
  const overlaps = [];

  for (const entry of live) {
    const isSelf =
      sessionId != null &&
      entry.session_id === sessionId &&
      entry.pid === pid;
    if (isSelf) {
      currentActorHasReservation = true;
      continue; // never conflict with your own reservation
    }
    for (const glob of entry.write_set || []) {
      if (pathMatchesPattern(normalizedPath, glob)) {
        overlaps.push({
          session_id: entry.session_id,
          pid: entry.pid,
          actor_id: entry.actor_id,
          matched_glob: glob
        });
        break; // one matched glob per actor is enough to flag the overlap
      }
    }
  }

  const conflict = overlaps.length > 0;
  const unArcOverlap = conflict && !currentActorHasReservation;

  const result = {
    path: normalizedPath,
    actor_session_id: sessionId,
    actor_pid: pid,
    overlaps,
    un_arc_overlap: unArcOverlap,
    conflict
  };

  if (conflict) {
    const logger = options.logger === undefined ? defaultInfoLogger : options.logger;
    if (logger) {
      logger(formatOverlapInfo(result));
    }
  }

  return result;
}

function formatOverlapInfo(result) {
  const others = result.overlaps
    .map((o) => `${o.actor_id || o.session_id}#${o.pid}(${o.matched_glob})`)
    .join(', ');
  const gap = result.un_arc_overlap ? ' [registry-coverage-gap: writer holds no reservation]' : '';
  return (
    `INFO [write-set-registry] advisory overlap: write to "${result.path}" ` +
    `by session=${result.actor_session_id || 'unknown'} pid=${result.actor_pid} ` +
    `overlaps reservation(s) of ${others}${gap} (no enforcement; logged only)`
  );
}

function defaultInfoLogger(line) {
  process.stderr.write(line + '\n');
}

module.exports = {
  // root + dir affordances
  getProjectRoot,
  getRegistryDir,
  getDefaultRegistryDir,
  setRegistryDir,
  resetRegistryDir,
  REGISTRY_DIR_ENV,
  DEFAULT_TTL_MS,
  FASTPATH_CACHE_TTL_MS,
  // identity helpers
  resolveSessionId,
  resolveActorId,
  reservationKey,
  // core API
  reserve,
  heartbeat,
  release,
  pruneStale,
  readRegistry,
  check,
  // cache control (mostly for tests)
  invalidateCache,
  // formatting (exposed for S2/S3 reuse + tests)
  formatOverlapInfo
};
