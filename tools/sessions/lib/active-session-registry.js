// tools/sessions/lib/active-session-registry.js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// CascadeSpan/1.0 emission (sovereign-core-harness P0). The session close path is
// one of the two enforcement homes that must emit the shared span shape; a
// crashed/TTL-expired session swept below writes a lineage-carrying tombstone so
// no cascade is silently lost (registry-as-coroner). trace-context.cjs is the
// owner's identity source we CONSUME lineage from. Both requires only pull in
// fs/path/os/crypto/ajv transitively — safe at load; all emission is fail-open.
const cascadeSpan = require('../../kernel/cascade-span/cascade-span.js');
const { observeExistingDebriefCloseSpan } = require('../../kernel/cascade-span/debrief-close-span-projection.cjs');
const { getTraceContext } = require('../../telemetry/dispatches/lib/trace-context.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_ACTIVE_SESSION_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'active-sessions');
const ACTIVE_SESSION_DIR_ENV = 'MYTHOS_ACTIVE_SESSION_DIR';
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

let dataDirOverride = null;

function getActiveSessionDir() {
  return path.resolve(dataDirOverride || process.env[ACTIVE_SESSION_DIR_ENV] || DEFAULT_ACTIVE_SESSION_DIR);
}

function getClosedSessionDir() {
  return path.join(getActiveSessionDir(), 'closed');
}

function getTtlPolicyPath() {
  return path.join(getActiveSessionDir(), '_ttl-policy.json');
}

function setDataDir(dataDir) {
  dataDirOverride = dataDir ? path.resolve(dataDir) : null;
}

function resetDataDir() {
  dataDirOverride = null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function assertSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }
}

function sessionPath(sessionId) {
  assertSessionId(sessionId);
  return path.join(getActiveSessionDir(), `${sessionId}.json`);
}

function closedSessionPath(sessionId) {
  assertSessionId(sessionId);
  return path.join(getClosedSessionDir(), `${sessionId}.json`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function writeJson(filePath, data) {
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

function normalizeWorkingSurface(value) {
  if (!value) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function hasOption(options, key) {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function normalizeOptionalString(value) {
  return value === undefined ? null : value;
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function loadTtlPolicy() {
  try {
    return readJson(getTtlPolicyPath());
  } catch (error) {
    return {
      default_ttl_ms: DEFAULT_MAX_AGE_MS,
      policies: {}
    };
  }
}

function computedTtlForSession(session) {
  const expectedIntervalMs = normalizeOptionalNumber(session.expected_interval_ms);
  if (!Number.isFinite(expectedIntervalMs)) {
    return null;
  }
  return expectedIntervalMs * 2;
}

function applyComputedTtl(session, policy) {
  const actorPolicy = policy.policies && policy.policies[session.actor_type];
  if (
    actorPolicy &&
    actorPolicy.ttl_ms === null &&
    actorPolicy.ttl_strategy === 'compute_at_register'
  ) {
    const ttlMs = computedTtlForSession(session);
    if (Number.isFinite(ttlMs)) {
      return {
        ...session,
        ttl_ms: ttlMs
      };
    }
  }
  return session;
}

function ttlForSession(session, policy) {
  const actorPolicy = policy.policies && policy.policies[session.actor_type];

  if (
    actorPolicy &&
    actorPolicy.ttl_ms === null &&
    actorPolicy.ttl_strategy === 'compute_at_register'
  ) {
    const storedTtlMs = normalizeOptionalNumber(session.ttl_ms);
    if (Number.isFinite(storedTtlMs)) {
      return storedTtlMs;
    }
    return normalizeOptionalNumber(policy.default_ttl_ms);
  }

  const actorTtlMs = actorPolicy ? normalizeOptionalNumber(actorPolicy.ttl_ms) : null;
  if (Number.isFinite(actorTtlMs)) {
    return actorTtlMs;
  }

  return normalizeOptionalNumber(policy.default_ttl_ms);
}

function listSessionFiles() {
  const activeDir = getActiveSessionDir();
  if (!fs.existsSync(activeDir)) {
    return [];
  }

  return fs.readdirSync(activeDir)
    .filter((entry) => entry.endsWith('.json') && !entry.startsWith('_'))
    .map((entry) => path.join(activeDir, entry));
}

// Session write-ledger DIRECTORIES (<id>/write_log.json), created by the
// posttool-write-ledger hook — distinct from the <id>.json session records.
// These are NOT cleaned by the file sweep and accumulate forever; the git
// custody gate reads every one as a foreign-owning session, so a long-dead
// session's ledger causes permanent false foreign-blocks. Returns dir entries
// that look like a session id (not 'closed', not '_'-prefixed).
const SESSION_DIR_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function listSessionDirs() {
  const activeDir = getActiveSessionDir();
  if (!fs.existsSync(activeDir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(activeDir)) {
    if (entry.startsWith('_') || entry === 'closed') continue;
    if (!SESSION_DIR_SHAPE.test(entry)) continue; // name-shape guard
    const full = path.join(activeDir, entry);
    try {
      // lstatSync (NOT statSync) so a symlink is never treated as a sweepable
      // directory — we must never recurse/delete through a symlink target.
      if (fs.lstatSync(full).isDirectory()) out.push({ id: entry, dir: full });
    } catch (error) {
      // unreadable entry — skip (fail-open)
    }
  }
  return out;
}

// Determine the last-activity epoch-ms for a write-ledger directory: the MOST
// RECENT of the write_log.json updated_at field and the directory mtime. Using
// the max (not just updated_at) means a freshly-created or restored directory
// whose updated_at is old (copy/restore/clock-skew) is treated as recent and is
// NOT swept — closing the registration-gap window where the ledger dir exists
// before the <id>.json record is written. Returns null when neither resolves.
function ledgerDirLastActivityMs(dir) {
  const signals = [];
  try {
    const log = readJson(path.join(dir, 'write_log.json'));
    const updatedMs = Date.parse(log && log.updated_at);
    if (Number.isFinite(updatedMs)) signals.push(updatedMs);
  } catch (error) {
    // missing/corrupt write_log — fall through to dir mtime
  }
  try {
    signals.push(fs.statSync(dir).mtimeMs);
  } catch (error) {
    // dir mtime unavailable
  }
  return signals.length ? Math.max(...signals) : null;
}

function registerSession(options = {}) {
  const sessionId = options.sessionId || crypto.randomUUID();
  const now = options.now || new Date().toISOString();
  const filePath = sessionPath(sessionId);
  const policy = loadTtlPolicy();

  if (fs.existsSync(filePath)) {
    let existing = null;
    try {
      existing = readJson(filePath);
    } catch (error) {
      existing = null;
    }

    if (existing) {
      const refreshed = applyComputedTtl({
        ...existing,
        session_id: existing.session_id || sessionId,
        status: 'active',
        last_heartbeat: now,
        working_surface: hasOption(options, 'workingSurface')
          ? normalizeWorkingSurface(options.workingSurface)
          : normalizeWorkingSurface(existing.working_surface),
        current_branch: hasOption(options, 'currentBranch')
          ? normalizeOptionalString(options.currentBranch)
          : existing.current_branch,
        actor_id: hasOption(options, 'actorId')
          ? normalizeOptionalString(options.actorId)
          : existing.actor_id,
        session_type: hasOption(options, 'sessionType')
          ? normalizeOptionalString(options.sessionType)
          : existing.session_type,
        actor_type: hasOption(options, 'actorType')
          ? normalizeOptionalString(options.actorType)
          : existing.actor_type,
        expected_interval_ms: hasOption(options, 'expectedIntervalMs')
          ? normalizeOptionalNumber(options.expectedIntervalMs)
          : existing.expected_interval_ms
      }, policy);
      writeJson(filePath, refreshed);
      return refreshed;
    }
  }

  const session = applyComputedTtl({
    session_id: sessionId,
    status: 'active',
    started_at: now,
    last_heartbeat: now,
    working_surface: normalizeWorkingSurface(options.workingSurface),
    current_branch: normalizeOptionalString(options.currentBranch),
    actor_id: normalizeOptionalString(options.actorId),
    session_type: normalizeOptionalString(options.sessionType),
    actor_type: normalizeOptionalString(options.actorType),
    expected_interval_ms: normalizeOptionalNumber(options.expectedIntervalMs),
    pid: process.pid
  }, policy);

  writeJson(filePath, session);
  return session;
}

function heartbeat(sessionId, options = {}) {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`active session not found: ${sessionId}`);
  }

  const session = readJson(filePath);
  const refreshed = {
    ...session,
    status: 'active',
    last_heartbeat: options.now || new Date().toISOString()
  };
  writeJson(filePath, refreshed);
  return refreshed;
}

// Best-effort model-family classification from an actor_type/actor_id string.
// Null when unknown — an honest "no model witnessed" rather than a guess.
function deriveModelFamily(actorType) {
  const s = String(actorType || '').toLowerCase();
  if (!s) return null;
  if (s.includes('claude') || s.includes('opus') || s.includes('sonnet') || s.includes('haiku') || s.includes('fable')) return 'claude';
  if (s.includes('codex') || s.includes('gpt')) return 'gpt';
  if (s.includes('gemini')) return 'gemini';
  if (s.includes('codewhale') || s.includes('deepseek')) return 'deepseek';
  return null;
}

// Emit ONE CascadeSpan/1.0 for a session close or sweep. Fail-open by
// construction: any error is swallowed to stderr so emission never throws into,
// and never blocks, close/sweep. Lineage is CONSUMED from the owner's trace
// context (trace-context.cjs); span_id/timestamps are supplied here (the lib is
// a passive sensor and never invents them).
function emitCloseSpan({ session, sessionId, reason, crashed, now }) {
  try {
    const trace = getTraceContext();
    const traceId = trace.trace_id && trace.trace_id !== 'unknown'
      ? trace.trace_id
      : (trace.session_id || sessionId);
    const span = cascadeSpan.fromSessionClose({
      span_id: crypto.randomUUID(),
      parent_span_id: trace.span_id || null,
      trace_id: traceId,
      scope_identity: trace.scope_identity || (session && session.current_scope) || null,
      work_unit: trace.step_id || null,
      lineage_root: trace.lineage_root_session_id || (session && session.session_id) || sessionId,
      actor: (session && session.actor_id) || 'coordinator',
      model_family: deriveModelFamily(session && session.actor_type),
      session_id: sessionId,
      reason,
      crashed,
      started_at: (session && session.started_at) || now,
      ended_at: now
    });
    cascadeSpan.writeSpan(span, { projectRoot: PROJECT_ROOT });
    if (crashed) {
      observeExistingDebriefCloseSpan({
        root: PROJECT_ROOT,
        home: 'claude-hook',
        span,
        runtimeSessionId: sessionId,
        scopeIdentity: span.scope.scope_identity,
        closeReason: reason,
        enforced: false,
        emitSource: 'claude-session-registry:sweepExpired',
        context: {
          action_id: process.env.MYTHOS_DEBRIEF_ACTION_ID || crypto.randomUUID(),
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id,
          logical_session_id: process.env.MYTHOS_DEBRIEF_LOGICAL_SESSION_ID || sessionId,
          scope_identity: span.scope.scope_identity,
          work_unit: span.scope.work_unit,
          lineage_root: span.scope.lineage_root,
          layer_depth: trace.layer_depth || 0
        },
        observationLogPath: dataDirOverride ? path.join(getActiveSessionDir(), 'debrief-close-span-observations.jsonl') : undefined,
        failureLogPath: dataDirOverride ? path.join(getActiveSessionDir(), 'debrief-close-telemetry-failures.jsonl') : undefined
      });
    }
  } catch (error) {
    process.stderr.write(`[active-session-registry] cascade-span emit failed (fail-open): ${error.message}\n`);
  }
}

function closeSession(sessionId, options = {}) {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`active session not found: ${sessionId}`);
  }

  const session = readJson(filePath);
  const closed = {
    ...session,
    status: 'closed',
    closed_at: options.now || new Date().toISOString()
  };

  if (options.reason) {
    closed.close_reason = options.reason;
  }

  const targetPath = closedSessionPath(sessionId);
  writeJson(targetPath, closed);
  fs.unlinkSync(filePath);
  emitCloseSpan({
    session,
    sessionId,
    reason: closed.close_reason || 'closed',
    crashed: false,
    now: closed.closed_at
  });
  return closed;
}

function getSession(sessionId) {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJson(filePath);
}

function getCurrentSessionId() {
  const sidecar = path.join(getActiveSessionDir(), '_current-id');
  if (!fs.existsSync(sidecar)) {
    return null;
  }
  const id = fs.readFileSync(sidecar, 'utf8').trim();
  return id || null;
}

// Ground the machine-wide "current session" sidecar. Written by the session
// lifecycle entry points (session.js register, consume-boundary crossing, and
// the coordination-dispatcher SessionStart handler) so write-ledger and
// custody hooks resolve the SAME session id even when the harness sets no
// env var (codewhale harness registers a session but sets no CLAUDE_* env).
// Fail-closed on write errors: a caller that explicitly grounds identity
// should see the failure rather than silently proceeding with an ungrounded
// sidecar.
function setCurrentSessionId(sessionId) {
  assertSessionId(sessionId);
  const sidecar = path.join(getActiveSessionDir(), '_current-id');
  ensureDir(getActiveSessionDir());
  const tmp = `${sidecar}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, `${sessionId}\n`);
    fs.renameSync(tmp, sidecar);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (unlinkError) {
      // ignore cleanup failure; preserve the original write failure
    }
    throw error;
  }
  return sessionId;
}

// Adopt another session's write-log paths into this session's custody set.
// Used at session crossing: when a new session consumes a boundary marker
// whose payload carries `session_id` (the session it is crossing from), the
// prior session's write-log entries are merged into the current session's
// write_log.json with adopted_from provenance. This makes clean-house custody
// scoping see those paths as OWN and the git-custody gate classify them as
// own (own-check runs before the foreign scan). Fail-open: no prior ledger
// or an unreadable one is a no-op, never a throw.
// Optional `filter` (fn path -> boolean) scopes the adoption to a subset of
// the prior session's paths (e.g. one workstream) so adopting a large ledger
// never drags unrelated workstreams into the current session's custody.
function adoptSessionCustody({ fromSessionId, toSessionId, now, filter }) {
  const out = {
    from_session_id: fromSessionId,
    to_session_id: toSessionId,
    adopted: false,
    adopted_count: 0,
    paths: [],
    reason: null
  };
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
    out.reason = 'invalid-session-ids';
    return out;
  }
  let prior = null;
  try {
    prior = readJson(path.join(getActiveSessionDir(), fromSessionId, 'write_log.json'));
  } catch (error) {
    prior = null;
  }
  if (!prior || !Array.isArray(prior.paths) || prior.paths.length === 0) {
    out.reason = 'no-prior-write-log';
    return out;
  }
  const matcher = typeof filter === 'function' ? filter : null;
  const relevant = matcher ? prior.paths.filter((entry) => {
    const p = typeof entry === 'string' ? entry : (entry && entry.path);
    return p ? matcher(p) : false;
  }) : prior.paths;
  if (relevant.length === 0) {
    out.reason = 'no-paths-match-filter';
    return out;
  }

  const toDir = path.join(getActiveSessionDir(), toSessionId);
  const toFile = path.join(toDir, 'write_log.json');
  let current = { paths: [] };
  try {
    current = readJson(toFile);
  } catch (error) {
    current = { paths: [] };
  }
  if (!Array.isArray(current.paths)) current.paths = [];
  const seen = new Set(current.paths.map((entry) => (typeof entry === 'string' ? entry : entry.path)));

  const stamp = now || new Date().toISOString();
  let added = 0;
  const addedPaths = [];
  for (const entry of relevant) {
    const p = typeof entry === 'string' ? entry : (entry && entry.path);
    if (!p || seen.has(p)) continue;
    current.paths.push({
      path: p,
      at: stamp,
      tool: 'adopt',
      adopted_from: fromSessionId
    });
    seen.add(p);
    added++;
    addedPaths.push(p);
  }

  if (added > 0) {
    ensureDir(toDir);
    writeJson(toFile, current);
  }
  out.adopted = added > 0;
  out.adopted_count = added;
  out.paths = addedPaths;
  if (added === 0) out.reason = 'all-paths-already-owned';
  return out;
}

function setCurrentTask(sessionId, task, options = {}) {
  const filePath = sessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`active session not found: ${sessionId}`);
  }

  const session = readJson(filePath);
  const now = options.now || new Date().toISOString();
  const taskText = task == null ? '' : String(task).trim();

  const refreshed = {
    ...session,
    status: 'active',
    last_heartbeat: now,
    current_task: taskText,
    current_task_at: now
  };

  if (options.command !== undefined) {
    refreshed.current_command = normalizeOptionalString(options.command);
  }
  if (options.scope !== undefined) {
    refreshed.current_scope = normalizeOptionalString(options.scope);
  }
  if (options.appendToSurface && taskText) {
    const surface = normalizeWorkingSurface(session.working_surface);
    if (!surface.includes(taskText)) {
      surface.unshift(taskText);
      refreshed.working_surface = surface.slice(0, 8);
    }
  }

  writeJson(filePath, refreshed);
  return refreshed;
}

function isExpired(session, policy, nowMs, overrideMaxAgeMs) {
  const maxAgeMs = Number.isFinite(overrideMaxAgeMs) ? overrideMaxAgeMs : ttlForSession(session, policy);
  if (!Number.isFinite(maxAgeMs)) {
    return false;
  }

  const heartbeatMs = Date.parse(session.last_heartbeat);
  return Number.isFinite(heartbeatMs) && nowMs - heartbeatMs > maxAgeMs;
}

function sweepExpired(options = {}) {
  const policy = loadTtlPolicy();
  const now = options.now || new Date().toISOString();
  const nowMs = Date.parse(now);
  const archive = options.archive !== false;
  const overrideMaxAgeMs = hasOption(options, 'maxAgeMs') ? Number(options.maxAgeMs) : null;
  const swept = [];
  const errors = [];

  for (const filePath of listSessionFiles()) {
    let session = null;
    try {
      session = readJson(filePath);
      if (!isExpired(session, policy, nowMs, overrideMaxAgeMs)) {
        continue;
      }

      const sessionId = session.session_id || path.basename(filePath, '.json');
      if (archive) {
        const closed = {
          ...session,
          session_id: sessionId,
          status: 'closed',
          closed_at: now,
          close_reason: 'ttl-expired'
        };
        writeJson(closedSessionPath(sessionId), closed);
      }

      fs.unlinkSync(filePath);
      // Lineage-carrying tombstone: a crashed/TTL-expired session is swept, never
      // silently lost. Fail-open — emission cannot fault the sweep.
      emitCloseSpan({ session, sessionId, reason: 'ttl-expired', crashed: true, now });
      swept.push({
        session_id: sessionId,
        reason: 'ttl-expired'
      });
    } catch (error) {
      errors.push({
        file: filePath,
        session_id: session && session.session_id ? session.session_id : null,
        error: error.message
      });
    }
  }

  // Sweep orphaned write-ledger directories (<id>/write_log.json) whose session
  // is no longer live. Without this they accumulate forever and the git custody
  // gate keeps treating dead sessions' ledgers as foreign-owning. A directory is
  // swept only when: it is not the current session, has no live <id>.json record,
  // and its last activity is older than the TTL. Fail-open per entry.
  const sweptDirs = [];
  const dirMaxAgeMs = Number.isFinite(overrideMaxAgeMs)
    ? overrideMaxAgeMs
    : normalizeOptionalNumber(policy.default_ttl_ms) || DEFAULT_MAX_AGE_MS;
  let currentId = null;
  try { currentId = getCurrentSessionId(); } catch (error) { currentId = null; }

  for (const { id, dir } of listSessionDirs()) {
    try {
      if (id === currentId) continue;                       // never sweep current session
      if (fs.existsSync(sessionPath(id))) continue;         // a live <id>.json exists — keep

      // Consistency guard: a genuine ledger's internal session_id must match its
      // directory name. A mismatch (copied/restored/renamed dir) is suspicious —
      // do not sweep it.
      let ledger = null;
      try { ledger = readJson(path.join(dir, 'write_log.json')); } catch (error) { ledger = null; }
      if (ledger && ledger.session_id && ledger.session_id !== id) continue;
      // When NOT archiving, refuse to delete a ledger we can't positively identify
      // (missing/unreadable session_id) — no durable copy + unverifiable owner.
      if (!archive && !(ledger && ledger.session_id === id)) continue;

      const lastMs = ledgerDirLastActivityMs(dir);
      if (!Number.isFinite(lastMs)) continue;               // can't determine age — don't sweep
      if (!Number.isFinite(dirMaxAgeMs) || nowMs - lastMs <= dirMaxAgeMs) continue;

      if (archive) {
        // Archive BEFORE removal. If the durable archive write fails, do NOT
        // delete — preserve the custody ledger and retry on a later sweep.
        try {
          if (ledger === null) ledger = readJson(path.join(dir, 'write_log.json'));
          writeJson(path.join(getClosedSessionDir(), id, 'write_log.json'), ledger);
        } catch (error) {
          errors.push({ file: dir, session_id: id, error: 'archive-failed: ' + error.message });
          continue;
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      sweptDirs.push({ session_id: id, reason: 'orphan-ledger-ttl-expired' });
    } catch (error) {
      errors.push({ file: dir, session_id: id, error: error.message });
    }
  }

  swept.sort((a, b) => String(a.session_id).localeCompare(String(b.session_id)));
  sweptDirs.sort((a, b) => String(a.session_id).localeCompare(String(b.session_id)));
  return { swept, errors, sweptDirs };
}

function listActive(options = {}) {
  if (options.sweepExpired === true) {
    sweepExpired({
      now: options.now,
      archive: options.archiveExpired !== false,
      maxAgeMs: options.maxAgeMs
    });
  }

  const policy = loadTtlPolicy();
  const overrideMaxAgeMs = hasOption(options, 'maxAgeMs') ? Number(options.maxAgeMs) : null;
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  const malformedDiagnostics = [];
  const active = [];

  for (const filePath of listSessionFiles()) {
    let session = null;
    try {
      session = readJson(filePath);
    } catch (error) {
      malformedDiagnostics.push({
        file: filePath,
        error: error.message,
        observed_at: new Date().toISOString()
      });
      continue;
    }

    const maxAgeMs = hasOption(options, 'maxAgeMs') ? overrideMaxAgeMs : ttlForSession(session, policy);
    if (!Number.isFinite(maxAgeMs)) {
      active.push(session);
      continue;
    }

    const heartbeatMs = Date.parse(session.last_heartbeat);
    if (Number.isFinite(heartbeatMs) && nowMs - heartbeatMs <= maxAgeMs) {
      active.push(session);
    }
  }

  active.sort((a, b) => String(a.session_id).localeCompare(String(b.session_id)));
  active._malformed_diagnostics = malformedDiagnostics;
  return active;
}

function findByWorkingSurface(needle, options = {}) {
  if (!needle) {
    return [];
  }
  const query = String(needle);
  return listActive(options).filter((session) => {
    return normalizeWorkingSurface(session.working_surface).some((surface) => surface.includes(query));
  });
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_ACTIVE_SESSION_DIR,
  ACTIVE_SESSION_DIR_ENV,
  DEFAULT_MAX_AGE_MS,
  getActiveSessionDir,
  getClosedSessionDir,
  getTtlPolicyPath,
  setDataDir,
  resetDataDir,
  registerSession,
  heartbeat,
  closeSession,
  sweepExpired,
  listSessionDirs,
  listActive,
  getSession,
  getCurrentSessionId,
  setCurrentSessionId,
  adoptSessionCustody,
  setCurrentTask,
  findByWorkingSurface
};
