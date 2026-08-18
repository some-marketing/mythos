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
//   process occupying the pid) the signal is REFUSED, the registry entry is
//   removed WITHOUT signaling its occupant, and the refusal is reported in
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

function readRegistry(sessionId, projectRoot) {
  const file = registryFilePath(sessionId, projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.watchers || typeof parsed.watchers !== 'object') {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
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

    if (typeof item === 'string') {
      name = item;
      script = path.resolve(root, 'tools', 'signals', `${item}.js`);
      executable = process.execPath;
      argvTail = [script];
    } else if (item && typeof item === 'object') {
      name = item.name;
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
    seen.add(name);
    if (script && !fs.existsSync(script)) {
      throw new Error(`watcher-lifecycle: watcher script not found: ${script}`);
    }
    entries.push({ name, executable, argv: [executable, ...argvTail], script });
  }
  return entries;
}

// Spawn one normalized entry, then record its identity immediately after
// spawn. Resolves to { name, child, identity }.
function spawnWatcher(entry, opts) {
  return new Promise((resolve, reject) => {
    const name = entry.name;
    let child;
    try {
      child = spawn(entry.executable, entry.argv.slice(1), {
        stdio: (opts && opts.stdio) || 'ignore'
      });
    } catch (err) {
      reject(err);
      return;
    }
    // Asynchronous spawn failure (e.g. ENOENT for a bad command): reject
    // rather than recording a pid-less identity.
    child.once('error', (err) => reject(err));

    const record = () => {
      if (child.pid == null) return; // settles via 'error' or next retry
      let startTime = null;
      for (let i = 0; i < START_TIME_RETRIES && !startTime; i += 1) {
        startTime = liveStartTime(child.pid);
        if (!startTime && i < START_TIME_RETRIES - 1) {
          setTimeout(record, START_TIME_RETRY_MS);
          return;
        }
      }
      const identity = {
        name,
        pid: child.pid,
        start_time: startTime,
        executable: entry.executable,
        executable_basename: executableBasename(entry.executable),
        argv: entry.argv.slice(),
        argv_fingerprint: computeArgvFingerprint(entry.argv),
        script: entry.script || null,
        spawned_at: new Date().toISOString()
      };
      spawned.set(`${opts && opts.sessionId}::${name}`, child);
      resolve({ name, child, identity });
    };
    record();
  });
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

// Start every daemon in watcherSet (default: DEFAULT_WATCHER_SET), recording
// per-daemon process identity in the session registry immediately after each
// spawn. Resolves
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
  const root = (opts && opts.projectRoot) || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const entries = normalizeWatcherSet(watcherSet, root);

  const preemptivelyStopped = [];
  const cleanupRefused = [];
  const existing = readRegistry(sid, root);
  if (existing && Object.keys(existing.watchers).length > 0) {
    const stop = await stopWatchers(sid, { projectRoot: root });
    preemptivelyStopped.push(...stop.signaled, ...stop.stale);
    for (const refusal of stop.refused) {
      cleanupRefused.push({ name: refusal.name, mismatches: refusal.mismatches, reason: refusal.reason });
    }
  }

  const registry = readRegistry(sid, root) || { watchers: {} };
  const started = [];
  const failed = cleanupRefused.map((refusal) => ({
    name: refusal.name,
    error: `pre-emptive cleanup refused: ${refusal.reason} (${refusal.mismatches.join(', ')})`
  }));

  for (const entry of entries) {
    try {
      const { identity } = await spawnWatcher(entry, { projectRoot: root, sessionId: sid });
      registry.watchers[identity.name] = identity;
      started.push(identity);
    } catch (err) {
      failed.push({ name: entry.name, error: err.message });
    }
  }

  // Persist the freshly started identities BEFORE any rollback decision:
  // stopWatchers re-reads the registry from disk, so an in-memory-only set
  // would be invisible to the rollback and the fresh daemon would be orphaned.
  writeRegistry(sid, registry, root);

  // Partial-start failure: roll back the set started in THIS call so a broken
  // session open never leaves an orphaned subset running. The registry at this
  // point holds exactly the freshly started identities (any previous generation
  // was cleaned above), so stopWatchers is a precise identity-verified rollback.
  const rolledBack = [];
  if (failed.length > 0 && started.length > 0) {
    const stop = await stopWatchers(sid, { projectRoot: root });
    rolledBack.push(...stop.signaled, ...stop.stale);
    for (const refusal of stop.refused) {
      failed.push({ name: refusal.name, error: `rollback refused: ${refusal.reason} (${refusal.mismatches.join(', ')})` });
    }
  }

  // Persist the post-rollback state from a fresh disk read: after a rollback
  // the in-memory registry is stale (stopWatchers mutated the on-disk copy).
  writeRegistry(sid, readRegistry(sid, root) || { watchers: {} }, root);
  return {
    ok: failed.length === 0,
    started,
    failed,
    preemptively_stopped: preemptivelyStopped,
    cleanup_refused: cleanupRefused,
    rolled_back: rolledBack
  };
}

// Stop exactly the session-start set recorded in the registry. Each entry is
// identity-verified BEFORE signaling: mismatches are refused (entry removed,
// occupant NOT signaled, reported in refused), dead processes are removed as
// stale without signaling, and verified survivors get SIGTERM (then SIGKILL
// after `graceMs` if still alive, re-verifying start_time before escalation).
// Resolves { signaled: [name...], refused: [{name, mismatches, reason}],
//            stale: [name...], registry_missing: bool }.
async function stopWatchers(sessionId, opts) {
  const root = (opts && opts.projectRoot) || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const signal = (opts && opts.signal) || 'SIGTERM';
  const escalateSignal = (opts && opts.escalateSignal) || 'SIGKILL';
  const graceMs = (opts && opts.graceMs) || 5000;

  const registry = readRegistry(sid, root);
  if (!registry) {
    return { signaled: [], refused: [], stale: [], registry_missing: true };
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
      delete registry.watchers[name];
      refused.push({
        name,
        mismatches: verification.mismatches,
        reason: 'identity-mismatch-fail-closed'
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
        // Cannot signal — fail closed, keep nothing we cannot manage.
        delete registry.watchers[name];
        refused.push({ name, mismatches: ['signal-permission'], reason: err.code });
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
          delete registry.watchers[name];
          refused.push({ name, mismatches: ['escalate-signal'], reason: err.code });
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
      refused.push({ name, mismatches: ['unreapable'], reason: 'still-alive-after-escalation' });
      continue;
    }
    delete registry.watchers[name];
    spawned.delete(`${sid}::${name}`);
    signaled.push(name);
  }

  if (names.length > 0) writeRegistry(sid, registry, root);
  return { signaled, refused, stale, registry_missing: false };
}

// List the current registry entries for a session (array of identities, in
// insertion order) or [] when the registry does not exist.
function listRegistry(sessionId, opts) {
  const root = (opts && opts.projectRoot) || PROJECT_ROOT;
  const sid = normalizeSessionId(sessionId);
  const registry = readRegistry(sid, root);
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
  readRegistry,
  writeRegistry,
  spawnWatcher,
  verifyIdentity,
  processExists,
  liveStartTime,
  liveCommand,
  spawnedChildren
};
