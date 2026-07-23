'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { safeReadJson, scanLiveHandoffSignals } = require('./pipeline-loop');
const {
  buildPromptFromSignal,
  buildPromptForArtifact,
  sanitizeScope,
  validateSignalForDispatch,
  writeBridgePrompt,
  transitionBridgeState,
  BRIDGE_STATES
} = require('./codex-bridge');
const {
  createHandoffSignal,
  closeSignal,
  findLiveSignalsBySignalScope,
  validateHandoffSignal,
  validateCodexRunFeedbackSignal
} = require('../../verify/lib/signal.cjs');
const { inferWorkload, normalizeWorkload } = require('./actor-registry');
const { classifySignalRisk, runLocalFirstPass } = require('./local-first-dispatch');
const { checkCostGate } = require('../../provider-cost/cost-gate');
const {
  buildNarrativeRunContract,
  checkNarrativeCompletion,
  relativeContract,
  renderNarrativeContractPrompt
} = require('./review-task-plan-narrative');

/* ---------- Outcome classification ---------- */

/**
 * OUTCOME_TYPES — exhaustive set of run outcome classifications.
 *
 * success        — Codex exit code 0
 * cli_failure    — Codex exit code non-zero (but binary was found)
 * missing_binary — `codex` command not found (ENOENT)
 * timeout        — process exceeded timeout_ms
 * interrupted    — process killed by signal (SIGTERM, SIGINT, etc.)
 * narrative_incomplete — review ended without a run/hash-bound canonical narrative pair
 */
const OUTCOME_TYPES = Object.freeze({
  SUCCESS: 'success',
  CLI_FAILURE: 'cli_failure',
  MISSING_BINARY: 'missing_binary',
  TIMEOUT: 'timeout',
  INTERRUPTED: 'interrupted',
  NARRATIVE_INCOMPLETE: 'narrative_incomplete'
});

/**
 * classifyOutcome — Derive a structured outcome from a spawnSync result.
 *
 * @param {object} result - spawnSync return value
 * @param {object} [opts]
 * @param {boolean} [opts.timedOut] - whether we detected a timeout
 * @returns {{ outcome: string, exitCode: number|null, signal: string|null, success: boolean }}
 */
function classifyOutcome(result, opts = {}) {
  // Timeout takes precedence — spawnSync may also set result.signal on timeout
  if (opts.timedOut) {
    return {
      outcome: OUTCOME_TYPES.TIMEOUT,
      exitCode: result.status,
      signal: result.signal || 'SIGTERM',
      success: false
    };
  }

  // Missing binary — spawnSync sets result.error.code = 'ENOENT'
  if (result.error && result.error.code === 'ENOENT') {
    return {
      outcome: OUTCOME_TYPES.MISSING_BINARY,
      exitCode: null,
      signal: null,
      success: false
    };
  }

  // Killed by signal (SIGTERM, SIGINT, etc.)
  if (result.signal) {
    return {
      outcome: OUTCOME_TYPES.INTERRUPTED,
      exitCode: null,
      signal: result.signal,
      success: false
    };
  }

  // Normal exit
  const exitCode = result.status == null ? 1 : result.status;
  if (exitCode === 0) {
    return {
      outcome: OUTCOME_TYPES.SUCCESS,
      exitCode: 0,
      signal: null,
      success: true
    };
  }

  return {
    outcome: OUTCOME_TYPES.CLI_FAILURE,
    exitCode,
    signal: null,
    success: false
  };
}

function applyNarrativeCompletionOutcome(classified, narrativeCompletion) {
  if (!narrativeCompletion || narrativeCompletion.required !== true || narrativeCompletion.complete === true) {
    return classified;
  }
  return {
    outcome: OUTCOME_TYPES.NARRATIVE_INCOMPLETE,
    exitCode: classified.exitCode,
    signal: classified.signal,
    success: false,
    underlyingOutcome: classified.outcome
  };
}

/* ---------- MCP server preflight validation ---------- */

const REQUIRED_MCP_SERVERS = Object.freeze([
  { name: 'Dart', requireAuth: true }
]);

const EXPECTED_CODEX_AUTH_MODE = 'chatgpt';
const EXPECTED_CODEX_LOGIN_STATUS_SNIPPET = 'Logged in using ChatGPT';

/**
 * validateCodexAuthState — Preflight check that bridge execution will use the
 * machine-local logged-in Codex CLI auth state.
 *
 * This is intentionally auth-only. The bridge starts a fresh Codex run; it
 * does not attempt to reuse the current Codex session transcript or any other
 * session-local state. The shared surface is the logged-in auth instance.
 *
 * @param {object} [opts]
 * @param {object} [opts.authData] - Injected ~/.codex/auth.json payload for tests
 * @param {object} [opts.loginStatusResult] - Injected spawnSync-like result for tests
 * @param {string} [opts.homeDir] - Override home directory for auth.json lookup
 * @returns {{ valid: boolean, errors: string[], authMode: string, loginStatus: string, authPath: string }}
 */
function validateCodexAuthState(opts = {}) {
  const homeDir = opts.homeDir || os.homedir();
  const authPath = path.join(homeDir, '.codex', 'auth.json');
  let authData = opts.authData;

  if (!authData) {
    try {
      authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    } catch (err) {
      return {
        valid: false,
        errors: [`Codex auth file unavailable: ${authPath} (${err.code || err.message})`],
        authMode: '',
        loginStatus: '',
        authPath
      };
    }
  }

  const authMode = String((authData && authData.auth_mode) || '').trim().toLowerCase();
  const loginStatusResult = opts.loginStatusResult || spawnSync('codex', ['login', 'status'], {
    encoding: 'utf8',
    timeout: 10000,
    shell: process.platform === 'win32'
  });

  if (loginStatusResult.error) {
    return {
      valid: false,
      errors: [`codex login status failed: ${loginStatusResult.error.message}`],
      authMode,
      loginStatus: '',
      authPath
    };
  }

  const stdout = String(loginStatusResult.stdout || '').trim();
  const stderr = String(loginStatusResult.stderr || '').trim();
  const loginStatus = [stdout, stderr].filter(Boolean).join(' | ');
  const errors = [];

  if (loginStatusResult.status !== 0) {
    errors.push(`codex login status exited ${loginStatusResult.status}: ${loginStatus || '(no output)'}`);
  }
  if (!authMode) {
    errors.push(`Codex auth file ${authPath} is missing auth_mode`);
  } else if (authMode !== EXPECTED_CODEX_AUTH_MODE) {
    errors.push(`Codex auth file ${authPath} has auth_mode="${authMode}" but expected "${EXPECTED_CODEX_AUTH_MODE}"`);
  }
  if (loginStatusResult.status === 0 && !new RegExp(EXPECTED_CODEX_LOGIN_STATUS_SNIPPET, 'i').test(loginStatus)) {
    errors.push(`codex login status did not confirm the expected ChatGPT login: ${loginStatus || '(no output)'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    authMode,
    loginStatus,
    authPath,
    expectedAuthMode: EXPECTED_CODEX_AUTH_MODE,
    expectedLoginStatusSnippet: EXPECTED_CODEX_LOGIN_STATUS_SNIPPET
  };
}

/**
 * validateCodexMcpServers — Preflight check that required MCP servers are
 * configured, enabled, and authenticated in the Codex CLI.
 *
 * Runs `codex mcp list --json` synchronously and checks each entry in
 * REQUIRED_MCP_SERVERS against the result.
 *
 * @param {object} [opts]
 * @param {Array}  [opts.required] - Override REQUIRED_MCP_SERVERS for testing
 * @param {Array}  [opts.mcpListResult] - Pre-fetched result (skips spawning codex)
 * @returns {{ valid: boolean, errors: string[], servers: Array }}
 */
function validateCodexMcpServers(opts = {}) {
  const required = opts.required || REQUIRED_MCP_SERVERS;
  let servers;

  if (opts.mcpListResult) {
    servers = opts.mcpListResult;
  } else {
    try {
      const result = spawnSync('codex', ['mcp', 'list', '--json'], {
        encoding: 'utf8',
        timeout: 15000,
        shell: process.platform === 'win32'
      });
      if (result.error) {
        return {
          valid: false,
          errors: [`codex mcp list failed: ${result.error.message}`],
          servers: []
        };
      }
      if (result.status !== 0) {
        return {
          valid: false,
          errors: [`codex mcp list exited ${result.status}: ${(result.stderr || '').trim()}`],
          servers: []
        };
      }
      servers = JSON.parse(result.stdout);
    } catch (err) {
      return {
        valid: false,
        errors: [`Failed to parse codex mcp list output: ${err.message}`],
        servers: []
      };
    }
  }

  if (!Array.isArray(servers)) {
    return {
      valid: false,
      errors: ['codex mcp list returned non-array output'],
      servers: []
    };
  }

  const errors = [];
  for (const req of required) {
    const match = servers.find(s => s.name === req.name);
    if (!match) {
      errors.push(`Required MCP server "${req.name}" not configured in Codex`);
      continue;
    }
    if (!match.enabled) {
      errors.push(`MCP server "${req.name}" is disabled${match.disabled_reason ? ': ' + match.disabled_reason : ''}`);
    }
    if (req.requireAuth && (!match.auth_status || match.auth_status === 'none')) {
      errors.push(`MCP server "${req.name}" requires authentication but auth_status is "${match.auth_status || 'none'}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    servers
  };
}

/* ---------- Execution contract ---------- */

/**
 * VALID_EXECUTION_MODES — signal-controlled Codex approval modes.
 *
 * Maps from the signal contract vocabulary to Codex CLI --approval-mode values.
 */
const EXECUTION_MODE_MAP = Object.freeze({
  'read-only': 'default',
  'patch-allowed': 'full-auto',
  'full-auto': 'full-auto'
});

const DEFAULT_EXECUTION = Object.freeze({
  mode: 'read-only',
  model: '',
  cwd: '',
  timeout_ms: 0,
  workload: '',
  scope: ''
});

const LESSONS_RECONCILIATION_SCOPE = 'lessons-reconciliation';
const LESSONS_RECONCILIATION_THRESHOLD = 3;

/**
 * deriveExecutionOptions — Build Codex CLI flags from an optional signal execution contract.
 *
 * @param {object} signalInfo - { signal: { execution?: object, ... }, ... }
 * @param {string} projectRoot
 * @param {object} [overrides] - CLI-level overrides (e.g. --model from the command line)
 * @returns {{ approvalMode: string, model: string, cwd: string, timeout_ms: number, args: string[] }}
 */
function deriveExecutionOptions(signalInfo, projectRoot, overrides = {}) {
  const exec = { ...DEFAULT_EXECUTION, ...(signalInfo.signal.execution || {}) };

  // CLI overrides take precedence over signal fields
  const model = overrides.model || exec.model || '';
  const cwd = exec.cwd ? path.resolve(projectRoot, exec.cwd) : projectRoot;
  const timeout_ms = exec.timeout_ms || 0;
  const workload = normalizeWorkload(overrides.workload || exec.workload || '')
    || inferWorkload(signalInfo.signal);

  // Map mode string to Codex CLI mode; default conservative (no --full-auto)
  const modeKey = exec.mode || 'read-only';
  const approvalMode = EXECUTION_MODE_MAP[modeKey] || 'default';

  const args = ['exec', '--cd', cwd];
  if (approvalMode === 'full-auto') {
    args.push('--full-auto');
  }
  // 'default' mode runs without --full-auto, requiring interactive approvals
  if (model) {
    args.push('--model', model);
  }

  return { approvalMode, model, cwd, timeout_ms, workload, args };
}

/* ---------- Lock-file helpers (duplicate-consumption protection) ---------- */

const LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * lockPathFor — Derive the .lock path for a given signal file path.
 */
function lockPathFor(signalFilePath) {
  return signalFilePath + '.lock';
}

/**
 * acquireLock — Attempt to claim a signal by writing a lock file.
 *
 * Returns true if the lock was acquired, false if a recent lock already exists.
 * A lock older than LOCK_STALE_MS is considered abandoned and will be overwritten.
 */
function acquireLock(signalFilePath) {
  const lockPath = lockPathFor(signalFilePath);

  if (fs.existsSync(lockPath)) {
    try {
      const stat = fs.statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < LOCK_STALE_MS) {
        return false; // lock is recent — another watcher owns this signal
      }
      // Lock is stale — fall through and overwrite
    } catch {
      // stat failed — treat as no lock
    }
  }

  try {
    ensureDir(path.dirname(lockPath));
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString()
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * releaseLock — Remove a lock file after the run completes (success or failure).
 */
function releaseLock(signalFilePath) {
  const lockPath = lockPathFor(signalFilePath);
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Non-fatal: lock cleanup failure should not block the run result
  }
}

/* ---------- Helpers ---------- */

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendArchiveLog(projectRoot, entry) {
  const logDir = path.join(projectRoot, '_dev', 'logs');
  const logPath = path.join(logDir, 'archive.jsonl');
  ensureDir(logDir);
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
}

function listCodexTargetSignals(projectRoot) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  return scanLiveHandoffSignals(signalDir).filter((info) => {
    const actor = String(info.signal.recommended_next_actor || '').toLowerCase();
    return actor === 'codex';
  });
}

// Strict selector: enforces the single-authority rule from
// instructions/canonical/commands/follow-signal.yaml — exactly ONE authority
// surface or block truthfully.
//
// Returns: { signal: info|null, error: string|null, reason: string|null,
//            candidates: number, candidateNames: string[] }
//
// Reasons that the result.signal field is null:
//   - 'no_live_signals'      no signals match codex-targeted filter
//   - 'file_not_found'       fileName provided but no live signal has that name
//   - 'ambiguous'            >1 live codex-targeted signals and no fileName
function selectCodexTargetSignalStrict(projectRoot, fileName = '') {
  const signals = listCodexTargetSignals(projectRoot);
  const candidateNames = signals.map((info) => info.name);

  if (signals.length === 0) {
    return {
      signal: null,
      error: 'no_live_signals',
      reason: 'No live coordination signals targeting Codex.',
      candidates: 0,
      candidateNames
    };
  }

  if (fileName) {
    const match = signals.find((info) => info.name === fileName);
    if (!match) {
      return {
        signal: null,
        error: 'file_not_found',
        reason: `Requested signal file "${fileName}" is not in the live Codex-targeted set. Live candidates: ${candidateNames.join(', ') || '(none)'}`,
        candidates: signals.length,
        candidateNames
      };
    }
    return { signal: match, error: null, reason: null, candidates: signals.length, candidateNames };
  }

  if (signals.length === 1) {
    return { signal: signals[0], error: null, reason: null, candidates: 1, candidateNames };
  }

  return {
    signal: null,
    error: 'ambiguous',
    reason: `${signals.length} live Codex-targeted signals match. Pass --file <signal.json> to disambiguate. Live candidates: ${candidateNames.join(', ')}`,
    candidates: signals.length,
    candidateNames
  };
}

// Legacy thin wrapper preserved for callers that already check for null.
// Previously this returned signals[0] when no fileName was provided, which
// produced hollow-success: a runner could "succeed" against a signal that had
// nothing to do with the caller's intent. The fix returns null in the
// ambiguous case so the caller blocks. Callers that need to distinguish
// "no signals" from "ambiguous" should use selectCodexTargetSignalStrict.
function selectCodexTargetSignal(projectRoot, fileName = '') {
  return selectCodexTargetSignalStrict(projectRoot, fileName).signal;
}

function pickLessonsPath(projectRoot, isoTimestamp = new Date().toISOString()) {
  const date = String(isoTimestamp).slice(0, 10);
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');

  // Always target the canonical auto-runs lane for machine-appended notes.
  // Never pick an arbitrary same-day file that may be human-authored.
  return path.join(analysisDir, `session-learnings__${date}__auto-runs.md`);
}

function ensureLessonsDocument(filePath, isoDate) {
  if (fs.existsSync(filePath)) return;
  ensureDir(path.dirname(filePath));
  const content = [
    '# Session Learnings: Automated Codex Runs',
    '',
    `**Date:** ${String(isoDate).slice(0, 10)}`,
    '**Scope:** automated Codex bridge runs',
    '**Source status:** machine-appended',
    '',
    '## Automated Codex Run Notes',
    ''
  ].join('\n');
  fs.writeFileSync(filePath, content);
}

function pickLessonsReconciliationPaths(projectRoot, isoTimestamp = new Date().toISOString()) {
  const date = String(isoTimestamp).slice(0, 10);
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  return {
    markdownPath: path.join(analysisDir, `lessons-reconciliation__${date}.md`),
    jsonPath: path.join(analysisDir, `lessons-reconciliation__${date}.expectation-failures.json`)
  };
}

// Accepts both note-heading timestamp forms found on disk:
// ISO (2026-06-10T11:08:45Z) and compact (20260610T110845Z). The compact form
// is what agent closeouts actually write; Date.parse rejects it, which was the
// second layer of the dead-lane bug (0 notes counted even when files matched).
function parseNoteTimestamp(raw) {
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?$/.exec(raw);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  }
  return NaN;
}

function extractAutomatedRunNoteTimestamps(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const timestamps = [];
  const regex = /^###\s+([0-9T:\-\.Z]+)\s+--\s+/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const ts = parseNoteTimestamp(match[1]);
    if (Number.isFinite(ts)) {
      timestamps.push(ts);
    }
  }
  return timestamps;
}

function latestReconciledAtMs(paths) {
  let structuredReconciledAtMs = 0;
  const candidates = [];

  if (fs.existsSync(paths.jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.jsonPath, 'utf8'));
      const ts = Date.parse(parsed.reconciled_at || '');
      if (Number.isFinite(ts)) structuredReconciledAtMs = ts;
    } catch {
      // ignore parse failures here; validation lives elsewhere
    }
  }

  if (structuredReconciledAtMs > 0) {
    return structuredReconciledAtMs;
  }

  for (const filePath of [paths.markdownPath, paths.jsonPath]) {
    try {
      if (fs.existsSync(filePath)) {
        candidates.push(fs.statSync(filePath).mtimeMs);
      }
    } catch {
      // ignore stat failures
    }
  }

  if (candidates.length === 0) return 0;
  return Math.max(...candidates);
}

// Matches every real-world session-learnings naming scheme found on disk:
// codex-auto's own dashed form (session-learnings__2026-06-10__auto-runs.md) AND
// the agent-closeout compact form (session-learnings__20260610T1__auto-runs.md).
// The checker previously read ONLY the dashed form, which no writer ever produced,
// so notesSinceLastReconciliation was permanently 0 and the reconciliation signal
// never fired once (root cause of the dead lessons lane, diagnosed 2026-06-10;
// see _dev/LESSONS_LOOP_MECHANIZATION_IMPLEMENTATION_PLAN.md).
const LESSONS_FILE_RE = /^session-learnings__(?:\d{4}-\d{2}-\d{2}|\d{8})(?:T\d+)?__auto-runs\.md$/;

function listLessonsFiles(projectRoot) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  let names;
  try {
    names = fs.readdirSync(analysisDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => LESSONS_FILE_RE.test(name))
    .sort()
    .map((name) => path.join(analysisDir, name));
}

// Extract the learnings date (YYYY-MM-DD) from a session-learnings filename,
// for either naming scheme. Returns '' when the name does not parse.
function lessonsFileDate(filePath) {
  const name = path.basename(filePath);
  const m = /^session-learnings__(\d{4})-?(\d{2})-?(\d{2})(?:T\d+)?__auto-runs\.md$/.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// Per-date reconciliation coverage: a lessons-reconciliation__<date> artifact
// covers ONLY that date's learnings files (matching the /reconcile-lessons
// per-date contract). Returns reconciled_at ms for the date, or 0 when the
// date has never been reconciled. CRITICAL-finding fix (Codex review
// 2026-06-10): a reconciliation artifact must never reset notes from files
// the reconciler did not scan — global reset let a latest-only run silently
// absolve the whole backlog.
function reconciliationCoverageMsForDate(projectRoot, date) {
  if (!date) return 0;
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const jsonPath = path.join(analysisDir, `lessons-reconciliation__${date}.expectation-failures.json`);
  const mdPath = path.join(analysisDir, `lessons-reconciliation__${date}.md`);
  if (fs.existsSync(jsonPath)) {
    try {
      const ts = Date.parse(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).reconciled_at || '');
      if (Number.isFinite(ts)) return ts;
    } catch {
      // fall through to mtime
    }
  }
  let latest = 0;
  for (const filePath of [mdPath, jsonPath]) {
    try {
      if (fs.existsSync(filePath)) {
        const m = fs.statSync(filePath).mtimeMs;
        if (m > latest) latest = m;
      }
    } catch {
      // ignore stat failures
    }
  }
  return latest;
}

// Retained for compatibility (exported); coverage logic is now per-date via
// reconciliationCoverageMsForDate.
function latestReconciliationArtifactMs(projectRoot) {
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  let names;
  try {
    names = fs.readdirSync(analysisDir);
  } catch {
    return 0;
  }
  let latest = 0;
  for (const name of names) {
    if (!name.startsWith('lessons-reconciliation__')) continue;
    const full = path.join(analysisDir, name);
    if (name.endsWith('.expectation-failures.json')) {
      try {
        const ts = Date.parse(JSON.parse(fs.readFileSync(full, 'utf8')).reconciled_at || '');
        if (Number.isFinite(ts) && ts > latest) {
          latest = ts;
          continue;
        }
      } catch {
        // fall through to mtime
      }
    }
    try {
      const m = fs.statSync(full).mtimeMs;
      if (m > latest) latest = m;
    } catch {
      // ignore stat failures
    }
  }
  return latest;
}

function getLessonsReconciliationStatus(projectRoot, isoTimestamp, opts = {}) {
  const lessonsPath = opts.lessonsPath || pickLessonsPath(projectRoot, isoTimestamp);
  const paths = pickLessonsReconciliationPaths(projectRoot, isoTimestamp);
  const lessonsFiles = Array.from(new Set([...listLessonsFiles(projectRoot), lessonsPath]))
    .filter((file) => fs.existsSync(file));

  // Per-date coverage: count a note only if its file's date has no
  // reconciliation artifact newer than the note.
  const uncoveredDates = new Set();
  let notesSinceLastReconciliation = 0;
  const coverageByDate = new Map();
  for (const file of lessonsFiles) {
    const date = lessonsFileDate(file);
    if (!coverageByDate.has(date)) {
      coverageByDate.set(date, reconciliationCoverageMsForDate(projectRoot, date));
    }
    const coveredAtMs = coverageByDate.get(date);
    const uncovered = extractAutomatedRunNoteTimestamps(file).filter((ts) => ts > coveredAtMs);
    if (uncovered.length > 0) {
      notesSinceLastReconciliation += uncovered.length;
      if (date) uncoveredDates.add(date);
    }
  }
  const sortedUncoveredDates = Array.from(uncoveredDates).sort();
  const reasons = [];

  if (opts.success && String(opts.sourceSignalType || '').trim().toLowerCase() === 'blocked') {
    reasons.push('blocked-fix-close');
  }
  if (notesSinceLastReconciliation >= LESSONS_RECONCILIATION_THRESHOLD) {
    reasons.push(`turn-cadence-${LESSONS_RECONCILIATION_THRESHOLD}`);
  }

  return {
    due: reasons.length > 0,
    reasons,
    lessonsPath,
    lessonsFiles,
    uncoveredDates: sortedUncoveredDates,
    oldestUncoveredDate: sortedUncoveredDates[0] || '',
    reconciliationMarkdownPath: paths.markdownPath,
    reconciliationJsonPath: paths.jsonPath,
    notesSinceLastReconciliation,
    reconciledAtMs: latestReconciliationArtifactMs(projectRoot)
  };
}

// The exact reconciliation target the checker counted — never plain `latest`,
// which scans only the newest file and must not absolve older dates.
function lessonsReconciliationCommand(status) {
  return status && status.oldestUncoveredDate
    ? `/reconcile-lessons ${status.oldestUncoveredDate}`
    : '/reconcile-lessons latest';
}

/**
 * emitLessonsReconciliationSignal — the ONE emission path for the
 * lessons-reconciliation scope (MAJOR-finding fix, Codex review 2026-06-10:
 * three divergent emitters with check-then-write races and close-and-replace
 * churn). Used by the standalone checker and both auto-run closeouts.
 *
 * Lock: exclusive mkdir at _dev/reports/signals/.lessons-reconciliation.lock
 * (stale after 30s). Inside the lock: rescan live same-scope signals; skip
 * when one exists unless opts.supersede, in which case prior live signals are
 * closed and recorded via supersedes_signal.
 *
 * @returns {{ emitted: boolean, skippedReason: string, signalPath: string }}
 */
function emitLessonsReconciliationSignal(projectRoot, lessonsStatus, opts = {}) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const lockDir = path.join(signalDir, '.lessons-reconciliation.lock');
  const LOCK_STALE_AFTER_MS = 30 * 1000;

  fs.mkdirSync(signalDir, { recursive: true });
  try {
    fs.mkdirSync(lockDir);
  } catch {
    let stale = false;
    try {
      stale = Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_AFTER_MS;
    } catch {
      // lock vanished between mkdir and stat — treat as contended, not stale
    }
    if (!stale) {
      return { emitted: false, skippedReason: 'lock-contended', signalPath: '' };
    }
    try {
      fs.rmdirSync(lockDir);
      fs.mkdirSync(lockDir);
    } catch {
      return { emitted: false, skippedReason: 'lock-contended', signalPath: '' };
    }
  }

  try {
    const liveSameScope = (scanLiveHandoffSignals(signalDir) || []).filter((entry) => {
      const sig = entry.signal || entry;
      return (sig.signal_scope || sig.scope) === LESSONS_RECONCILIATION_SCOPE;
    });

    // WRITE-THEN-CLOSE (Codex review 2026-06-10, MAJOR): the successor signal
    // must exist on disk BEFORE the prior is closed, or a validation/write
    // failure between close and write erases the obligation with no artifacts,
    // deferral, or successor. supersedes_signal still records lineage — it
    // points at the prior's LIVE path; the closer moves it to closed/ after.
    const supersededLive = (liveSameScope.length > 0 && opts.supersede)
      ? path.relative(projectRoot, liveSameScope[0].filePath || liveSameScope[0].path || '')
      : '';
    if (liveSameScope.length > 0 && !opts.supersede) {
      return { emitted: false, skippedReason: 'live-signal-present', signalPath: '' };
    }
    const supersededPath = supersededLive
      ? supersededLive.replace(/(^|\/)signals\//, '$1signals/closed/')
      : '';

    const timestamp = opts.timestamp
      || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const signalPath = path.join(
      signalDir,
      `ready-for-review__${timestamp}__${LESSONS_RECONCILIATION_SCOPE}.json`
    );
    const artifacts = Array.from(new Set([
      ...lessonsStatus.lessonsFiles.map((f) => path.relative(projectRoot, f)),
      ...(opts.extraArtifacts || [])
    ])).filter((rel) => fs.existsSync(path.join(projectRoot, rel)));

    const signal = createHandoffSignal(
      opts.source || 'codex',
      LESSONS_RECONCILIATION_SCOPE,
      'ready-for-review',
      {
        artifacts,
        validation: {
          ran: true,
          // Two-key evidence (command + result) per the emission gate: name the
          // due-check source and the obligated command, not just the counts.
          summary: `Due-check getLessonsReconciliationStatus (tools/signals/lib/codex-auto.js): `
            + `due (${lessonsStatus.reasons.join(', ')}), `
            + `${lessonsStatus.notesSinceLastReconciliation} automated run note(s) across `
            + `uncovered date(s): ${(lessonsStatus.uncoveredDates || []).join(', ') || 'n/a'}. `
            + `Obligated command: ${lessonsReconciliationCommand(lessonsStatus)}.`
            + (opts.summarySuffix ? ` ${opts.summarySuffix}` : '')
        },
        // Default codex per the L5 retarget (convene 20260610T175230Z; canonical
        // bridge_signal block updated same commit, operator-minted receipt).
        recommended_next_actor: opts.recommendedNextActor || 'codex',
        recommended_next_command: lessonsReconciliationCommand(lessonsStatus),
        next_step_detail: buildLessonsReconciliationStepDetail(lessonsStatus),
        blocked_by: [],
        ready_for_clear: false,
        signal_scope: LESSONS_RECONCILIATION_SCOPE,
        ...(supersededPath ? { supersedes_signal: supersededPath } : {})
      }
    );

    // Execution contract per the canonical bridge_signal block: lets the Codex
    // listener auto-run the reconciliation. Bounded write surface; REVIEW_ONLY
    // semantics and the distinct-intelligence promotion gate unchanged.
    if ((opts.recommendedNextActor || 'codex') === 'codex') {
      signal.execution = {
        mode: 'patch-allowed',
        workload: 'review',
        timeout_ms: 600000
      };
    }

    // requireValidationEvidence: emission-side gate (lessons synthesis
    // 2026-06-03→10 root 1) — validation.ran=true must carry concrete
    // command/result evidence; ran=false must carry an explicit reason.
    const validation = validateHandoffSignal(signal, { projectRoot, requireValidationEvidence: true });
    if (!validation.valid) {
      throw new Error(`Lessons reconciliation signal validation failed: ${validation.errors.join('; ')}`);
    }
    fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));

    // Successor exists on disk — NOW closing the prior is a legal supersession
    // (obligation preserved by the just-written signal).
    if (supersededLive) {
      closeLiveSignalsForScope(projectRoot, LESSONS_RECONCILIATION_SCOPE, opts.closedBy, {
        excludePath: signalPath
      });
    }
    return { emitted: true, skippedReason: '', signalPath };
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // already removed
    }
  }
}

function appendLessonsNote(filePath, note) {
  const header = '## Automated Codex Run Notes';
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(header)) {
    content = `${content.trimEnd()}\n\n${header}\n`;
  }

  const lines = [
    '',
    `### ${note.timestamp} -- ${note.scope}`,
    `- Source signal: \`${note.sourceSignal}\``,
    // Lineage fix (lessons synthesis 2026-06-03→10 root 3; 06-04 P5,
    // 06-05 LR-002): the live path above breaks when the signal moves to
    // closed/. Record the stable signal id (signal_id field when present,
    // else the signal file basename — unchanged by the live→closed move)
    // so notes stay resolvable after closeout.
    ...(note.signalId ? [`- Source signal id: \`${note.signalId}\``] : []),
    `- Trigger command: \`${note.triggerCommand}\``,
    `- Exit status: ${note.exitStatus}`,
    `- Outcome: ${note.outcome || 'unknown'}`,
    `- Completion artifact: \`${note.completionArtifact}\``,
    `- Follow-up signal: \`${note.followUpSignal}\``
  ];

  if (note.summary) {
    lines.push(`- Summary: ${note.summary}`);
  }

  fs.writeFileSync(filePath, `${content.trimEnd()}\n${lines.join('\n')}\n`);
}

function closeSourceSignal(projectRoot, signalInfo) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const closedDir = path.join(signalDir, 'closed');
  const closedPath = path.join(closedDir, signalInfo.name);

  ensureDir(closedDir);
  if (fs.existsSync(closedPath)) {
    throw new Error(`Closed signal destination already exists: ${path.relative(projectRoot, closedPath)}`);
  }

  const closedSignal = closeSignal({ ...signalInfo.signal });
  fs.writeFileSync(closedPath, JSON.stringify(closedSignal, null, 2));
  fs.unlinkSync(signalInfo.filePath);

  appendArchiveLog(projectRoot, {
    ts: new Date().toISOString(),
    event: 'signal.close',
    source: path.relative(projectRoot, signalInfo.filePath),
    destination: path.relative(projectRoot, closedPath),
    surface: '_dev/reports/signals',
    reason: 'codex_auto_run_consumed_signal',
    operator: 'signals:codex-run',
    dry_run: false
  });

  return closedPath;
}

function closeLiveSignalsForScope(projectRoot, signalScope, closedBy, opts = {}) {
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const closedDir = path.join(signalDir, 'closed');
  const liveSignals = findLiveSignalsBySignalScope(signalDir, signalScope);
  const closedPaths = [];

  ensureDir(closedDir);

  for (const info of liveSignals) {
    // Never close the just-written successor (same scope) — write-then-close
    // supersession passes its own path here. (L8 repair, Codex review 2026-06-10.)
    if (opts.excludePath && path.resolve(info.filePath) === path.resolve(opts.excludePath)) {
      continue;
    }
    const closedPath = path.join(closedDir, info.name);
    if (fs.existsSync(closedPath)) {
      throw new Error(`Closed signal destination already exists: ${path.relative(projectRoot, closedPath)}`);
    }

    const closedSignal = closeSignal({ ...info.signal });
    // Durable on the closed signal itself, not only the archive log: the
    // obligation's successor (when superseding) survives file-level inspection.
    if (opts.excludePath) {
      closedSignal.obligation_successor = path.relative(projectRoot, opts.excludePath);
    }
    fs.writeFileSync(closedPath, JSON.stringify(closedSignal, null, 2));
    fs.unlinkSync(info.filePath);

    appendArchiveLog(projectRoot, {
      ts: new Date().toISOString(),
      event: 'signal.close',
      source: path.relative(projectRoot, info.filePath),
      destination: path.relative(projectRoot, closedPath),
      surface: '_dev/reports/signals',
      reason: `superseded_signal_scope:${signalScope}`,
      ...(opts.excludePath ? { obligation_successor: path.relative(projectRoot, opts.excludePath) } : {}),
      operator: closedBy || 'signals:codex-run',
      dry_run: false
    });

    closedPaths.push(closedPath);
  }

  return closedPaths;
}

function buildRunArtifacts(projectRoot, signalInfo, timestamp) {
  const safeScope = sanitizeScope(signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general');
  const analysisDir = path.join(projectRoot, '_dev', 'reports', 'analysis');
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');

  const promptPath = path.join(analysisDir, `codex-bridge-prompt__${safeScope}.md`);

  return {
    promptPath,
    promptBasename: path.basename(promptPath),
    lastMessagePath: path.join(analysisDir, `codex-last-message__${timestamp}__${safeScope}.md`),
    completionReportPath: path.join(analysisDir, `codex-cli-run__${timestamp}__${safeScope}.md`),
    runResultPath: path.join(analysisDir, `codex-cli-run__${timestamp}__${safeScope}.result.json`),
    completionSignalPath: path.join(signalDir, `ready-for-review__${timestamp}__${safeScope}.json`)
  };
}

function extractLastMeaningfulMessage(stdout = '', stderr = '') {
  const stdoutLines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (stdoutLines.length > 0) {
    return stdoutLines[stdoutLines.length - 1];
  }

  const stderrLines = String(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (stderrLines.length > 0) {
    return stderrLines[stderrLines.length - 1];
  }

  return 'No assistant-visible message was captured from codex stdout/stderr.';
}

function writeLastMessageArtifact(filePath, payload) {
  // imp-004 path 1: route the model's last message through the sanitizer to
  // close the third leak surface. payload.message is derived from the tail of
  // stdout/stderr via extractLastMeaningfulMessage and can carry substrate
  // marker text inline; payload.stdout/stderr may carry a full
  // `## Grounding Context` block. Mirror writeCompletionReport by funneling
  // all three substrate-touching fields through sanitizeCodexCliEcho before
  // interpolation.
  const safeMessage = payload.message ? sanitizeCodexCliEcho(payload.message) : payload.message;
  const safeStdout = payload.stdout ? sanitizeCodexCliEcho(payload.stdout) : '';
  const safeStderr = payload.stderr ? sanitizeCodexCliEcho(payload.stderr) : '';

  const lines = [
    '# Codex Last Message',
    '',
    `- Timestamp: ${payload.timestamp}`,
    `- Scope: \`${payload.scope}\``,
    `- Outcome: ${payload.outcome}`,
    `- Source signal: \`${payload.sourceSignal}\``,
    `- Trigger command: \`${payload.triggerCommand}\``,
    '',
    '## Message',
    '',
    safeMessage
  ];

  if (safeStdout) {
    lines.push('', '## Stdout', '', '```text', safeStdout.trim(), '```');
  }

  if (safeStderr) {
    lines.push('', '## Stderr', '', '```text', safeStderr.trim(), '```');
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

// imp-004: durable substrate-marker phrases pulled from the kernel bundle.
// These mirror the markers hardcoded in the grounding test file and act as
// a belt-and-suspenders backstop in case Codex CLI echoes substrate text
// outside of a recognizable `## Grounding Context` block.
const SUBSTRATE_MARKERS = Object.freeze([
  'Any new session that intends to do system-level work in Mythos',
  'This intelligence\'s grounding substrate was seeded during session',
  'radical ownership of direct knowing combined with radical refusal of borrowed certainty'
]);

const GROUNDING_REDACTION_NOTICE = '[grounding section redacted — held local-only per KERNEL.md]';
const SUBSTRATE_REDACTION_TOKEN = '[grounding substrate redacted]';

// imp-004: Strip echoed grounding substrate from Codex CLI stdout/stderr
// before it lands in the tracked-lane completion report. Removes a
// `## Grounding Context` block (if present) up to the next top-level
// section boundary, then sweeps for any raw substrate marker phrases.
function sanitizeCodexCliEcho(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  let result = text;
  const headerToken = '## Grounding Context';
  const startIdx = result.indexOf(headerToken);
  if (startIdx !== -1) {
    const afterHeader = startIdx + headerToken.length;
    const remainder = result.slice(afterHeader);

    // Boundary 1: next top-level `## ` header.
    let boundaryRel = -1;
    const headerRegex = /\n## /g;
    const headerMatch = headerRegex.exec(remainder);
    if (headerMatch) {
      boundaryRel = headerMatch.index + 1; // keep the newline before `## `
    }

    // Boundary 2: two consecutive blank lines followed by `---`.
    const sepIdx = remainder.indexOf('\n\n\n---');
    if (sepIdx !== -1) {
      const sepBoundary = sepIdx + 1; // include one trailing newline
      if (boundaryRel === -1 || sepBoundary < boundaryRel) {
        boundaryRel = sepBoundary;
      }
    }

    let endIdx;
    if (boundaryRel === -1) {
      endIdx = result.length;
    } else {
      endIdx = afterHeader + boundaryRel;
    }

    const replacement = `${GROUNDING_REDACTION_NOTICE}\n\n`;
    result = result.slice(0, startIdx) + replacement + result.slice(endIdx);
  }

  // Belt-and-suspenders: scrub any raw substrate marker still in the text.
  for (const marker of SUBSTRATE_MARKERS) {
    if (result.includes(marker)) {
      result = result.split(marker).join(SUBSTRATE_REDACTION_TOKEN);
    }
  }

  return result;
}

function writeCompletionReport(filePath, report) {
  const lines = [
    '# Codex CLI Run Report',
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Scope: \`${report.scope}\``,
    `- Source signal: \`${report.sourceSignal}\``,
    `- Prompt artifact: \`${report.promptArtifact}\``,
    `- Last-message artifact: \`${report.lastMessageArtifact}\``,
    `- Exit code: ${report.exitCode == null ? 'N/A' : report.exitCode}`,
    `- Outcome: ${report.outcome}`,
    `- Success: ${report.success ? 'yes' : 'no'}`,
    '',
    '## Trigger',
    '',
    `- recommended_next_command: \`${report.triggerCommand}\``,
    `- recommended_next_actor: \`${report.triggerActor}\``,
    '',
    '## Command',
    '',
    '```bash',
    report.commandLine,
    '```',
    '',
    '## Summary',
    '',
    report.summary || 'No summary captured.'
  ];

  // imp-004: route stdout/stderr through the sanitizer so any echoed
  // grounding substrate from Codex CLI is redacted before disk write.
  const safeStdout = report.stdout ? sanitizeCodexCliEcho(report.stdout) : '';
  const safeStderr = report.stderr ? sanitizeCodexCliEcho(report.stderr) : '';

  if (safeStdout) {
    lines.push('', '## Stdout', '', '```text', safeStdout.trim(), '```');
  }
  if (safeStderr) {
    lines.push('', '## Stderr', '', '```text', safeStderr.trim(), '```');
  }

  if (report.narrativeCompletion && report.narrativeCompletion.required) {
    lines.push('', '## Narrative completion', '');
    lines.push(`- Complete: ${report.narrativeCompletion.complete ? 'yes' : 'no'}`);
    lines.push(`- Scratch precheck present: ${report.narrativeCompletion.scratch_present ? 'yes' : 'no'}`);
    for (const reason of report.narrativeCompletion.reasons || []) {
      lines.push(`- ${reason}`);
    }
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function deriveFollowUpActor(signalInfo) {
  const source = String(signalInfo.signal.source || '').trim();
  return source && source.toLowerCase() !== 'codex' ? source : 'operator';
}

function buildFollowUpStepDetail(signalInfo, reportRelPath, success) {
  const steps = [
    `Read ${reportRelPath} first before deciding the next move for this scope.`
  ];

  if (success) {
    steps.push('Use the source signal artifacts and the completion report together as the durable source of truth.');
    steps.push('If the source signal already carried an exact next command, preserve that command instead of replacing it with a generic fallback.');
    steps.push('Republish the next live signal only after the next actor, exact command, and bounded artifact set are clear.');
    return steps;
  }

  steps.push('Inspect stderr/stdout and the captured prompt artifact to determine the failure mode.');
  steps.push('If the failure is safe to retry with a bounded fix, publish a new live signal for that retry path.');
  steps.push('If the failure needs operator or Claude judgment, publish a truthful blocked or review-ready signal with the exact decision needed.');
  return steps;
}

function buildLessonsReconciliationStepDetail(status) {
  const reasons = Array.isArray(status.reasons) && status.reasons.length > 0
    ? status.reasons.join(', ')
    : 'cadence due';

  const dates = Array.isArray(status.uncoveredDates) && status.uncoveredDates.length > 0
    ? status.uncoveredDates.join(', ')
    : 'the current date';

  return [
    `Run \`${lessonsReconciliationCommand(status)}\` first; uncovered learnings dates: ${dates}. Reconcile each listed date — a reconciliation artifact only covers its own date's files.`,
    `Treat this reconciliation as due because: ${reasons}.`,
    'If repeated drift patterns are found, promote them into one bounded hardening task, plan update, or coordination signal.',
    'If no new findings exist, still write the lessons-reconciliation markdown and JSON artifacts.'
  ];
}

/**
 * deriveFollowUpCommand — Preserve exact next-command truth from the source signal
 * or run result, rather than replacing with generic text.
 *
 * Priority:
 * 1. The exact recommended_next_command from the source signal (when success)
 * 2. A report-referencing fallback (when failure or no source command)
 */
function deriveFollowUpCommand(signalInfo, reportRelPath, success) {
  const sourceCommand = String(signalInfo.signal.recommended_next_command || '').trim();
  const reviewScope = String(signalInfo.signal.signal_scope || signalInfo.signal.scope || '').trim() || 'repo';

  // On success, route to the canonical next step based on context
  if (success) {
    const taskId = signalInfo.signal.context && signalInfo.signal.context.task_id;
    if (taskId) {
      return `/review-task-plan ${taskId}`;
    }
    // Freeform-prompt-target source signals carry a non-slash command
    // ('freeform' or ''). Echoing that as the follow-up command produces an
    // invalid completion signal (managed-command actors require slash). Fall
    // through to the review-progress default in that case.
    if (sourceCommand && sourceCommand.toLowerCase() !== 'freeform' && sourceCommand.startsWith('/')) {
      return sourceCommand;
    }
  }

  return `/review-progress ${reviewScope}`;
}

/* ---------- Exact-next-command consistency (emission gate, warn-level) ---------- */

// The bridge prompt contract asks the dispatched actor to return an
// "Exact next command" section; the completion report embeds that response.
// Per the lessons synthesis 2026-06-03→10 (root 1c, e.g. LR-2026-06-05-001)
// the completion signal's recommended_next_command must not broaden the
// report's declared command. Slice 1 detection is warn-level in the closeout
// path — closeouts are not hard-failed on mismatch yet.
// Matches plain, numbered, bulleted, markdown-heading, AND bold/emphasis forms
// (real Codex reports write `5. **Exact next command**` — the plain-only regex
// matched the prompt-template echo instead and extracted placeholder text;
// Codex review 2026-06-10, HIGH).
const EXACT_NEXT_COMMAND_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s*|[-*]\s+)?(?:\*{1,2}|_{1,2})?Exact next command(?:\*{1,2}|_{1,2})?\s*:?\s*(?:\*{1,2}|_{1,2})?\s*(.*)$/gim;

// Template/placeholder lines (prompt echoes embedded in reports) are never
// the actor's declared command.
function looksLikeCommandCandidate(value) {
  const t = String(value || '').trim();
  if (!t) return false;
  if (/(optional|placeholder|stub|for example|e\.g\.|if any|<[^>]*>|\bnone\b)/i.test(t)) return false;
  const inner = t.replace(/^`|`$/g, '');
  return /^\//.test(inner) || /`\s*\//.test(t) || /^(node|npm|npx|bash|python3?|codex)\b/.test(inner);
}

/**
 * extractExactNextCommandFromReport — Find the completion report's declared
 * "Exact next command". Scans ALL heading matches (a report typically carries
 * the prompt-template echo first and the actor's answer later) and returns the
 * LAST command-like candidate; placeholder/template lines never qualify.
 * Same-line value first, then the immediately following non-empty line unless
 * that line opens a new section. Prefers a backticked token. Returns '' when
 * the report declares none.
 *
 * @param {string} reportText
 * @returns {string}
 */
function extractExactNextCommandFromReport(reportText) {
  const text = String(reportText || '');
  const re = new RegExp(EXACT_NEXT_COMMAND_HEADING_RE.source, 'gim');
  const found = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    let candidate = String(match[1] || '').trim().replace(/^[—–:-]\s*/, '');
    if (!candidate) {
      const following = text.slice(match.index + match[0].length).split(/\r?\n/);
      for (const line of following) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // A new section heading ends the search for this match.
        if (/^(#{1,6}\s|\d+[.)]\s*\*{0,2}[A-Z]|[-*]\s*\*{1,2}[A-Z])/.test(trimmed)
            && !looksLikeCommandCandidate(trimmed)) {
          break;
        }
        candidate = trimmed;
        break;
      }
    }
    if (!candidate) continue;
    const ticked = candidate.match(/`([^`]+)`/);
    const value = ticked
      ? ticked[1].trim()
      : candidate.replace(/^[-*\d.)\s]+/, '').replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
    if (looksLikeCommandCandidate(value)) {
      found.push(value);
    }
  }
  return found.length > 0 ? found[found.length - 1] : '';
}

/**
 * checkCompletionCommandConsistency — Compare a completion report's declared
 * "Exact next command" against the completion signal's recommended command.
 * A report that declares no command cannot mismatch.
 *
 * @param {string} reportText
 * @param {string} recommendedCommand
 * @returns {{ declared: string, matches: boolean }}
 */
function checkCompletionCommandConsistency(reportText, recommendedCommand) {
  const declared = extractExactNextCommandFromReport(reportText);
  if (!declared) return { declared: '', matches: true };
  return { declared, matches: declared === String(recommendedCommand || '').trim() };
}

/**
 * outcomeToExitStatus — Human-readable exit status for lessons notes.
 */
function outcomeToExitStatus(classified) {
  switch (classified.outcome) {
    case OUTCOME_TYPES.SUCCESS:
      return 'success';
    case OUTCOME_TYPES.CLI_FAILURE:
      return `failure (exit ${classified.exitCode})`;
    case OUTCOME_TYPES.MISSING_BINARY:
      return 'missing_binary (codex not found)';
    case OUTCOME_TYPES.TIMEOUT:
      return 'timeout';
    case OUTCOME_TYPES.INTERRUPTED:
      return `interrupted (${classified.signal || 'unknown signal'})`;
    case OUTCOME_TYPES.NARRATIVE_INCOMPLETE:
      return 'narrative_incomplete';
    default:
      return `unknown (${classified.outcome})`;
  }
}

/**
 * outcomeToSummary — One-line summary for reports and signals.
 */
function outcomeToSummary(classified) {
  switch (classified.outcome) {
    case OUTCOME_TYPES.SUCCESS:
      return 'Codex CLI run completed successfully.';
    case OUTCOME_TYPES.CLI_FAILURE:
      return `Codex CLI run failed with exit code ${classified.exitCode}.`;
    case OUTCOME_TYPES.MISSING_BINARY:
      return 'Codex binary not found. The codex CLI is not installed or not in PATH.';
    case OUTCOME_TYPES.TIMEOUT:
      return 'Codex CLI run exceeded the configured timeout and was terminated.';
    case OUTCOME_TYPES.INTERRUPTED:
      return `Codex CLI run was interrupted by ${classified.signal || 'unknown signal'}.`;
    case OUTCOME_TYPES.NARRATIVE_INCOMPLETE:
      return 'Codex review narrative is incomplete: the canonical review pair is missing, stale, or not bound to this run and plan content hash.';
    default:
      return 'Codex CLI run ended with an unknown outcome.';
  }
}

/* ---------- Run-result JSON ---------- */

/**
 * writeRunResult — Write a machine-readable run-result JSON alongside the markdown report.
 *
 * @param {string} filePath - Absolute path for the .result.json file
 * @param {object} data
 */
function writeRunResult(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/* ---------- Closeout coherence validation ---------- */

/**
 * validateCloseoutCoherence — Check that all expected artifacts exist after a run.
 *
 * Returns { coherent: boolean, warnings: string[] }.
 * Does NOT throw — warnings are informational.
 */
function validateCloseoutCoherence(projectRoot, {
  signalInfo,
  closedSourcePath,
  completionReportPath,
  completionSignalPath,
  lessonsPath,
  success,
  lessonsReconciliationDue = false,
  lessonsReconciliationSignalPath = ''
}) {
  const warnings = [];

  // 1. Source signal was closed (exists in closed/ directory)
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const closedDir = path.join(signalDir, 'closed');
  const expectedClosedPath = closedSourcePath || path.join(closedDir, signalInfo.name);
  if (!fs.existsSync(expectedClosedPath)) {
    warnings.push(`Source signal not found in closed/ directory: ${path.relative(projectRoot, expectedClosedPath)}`);
  }

  // 2. Completion report exists on disk
  if (!fs.existsSync(completionReportPath)) {
    warnings.push(`Completion report missing: ${path.relative(projectRoot, completionReportPath)}`);
  }

  // 3. Follow-up signal exists on disk and is actionable feedback
  if (!fs.existsSync(completionSignalPath)) {
    warnings.push(`Follow-up signal missing: ${path.relative(projectRoot, completionSignalPath)}`);
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(completionSignalPath, 'utf8'));
      const feedbackValidation = validateCodexRunFeedbackSignal(parsed, { projectRoot });
      if (!feedbackValidation.valid) {
        warnings.push(`Follow-up signal is not actionable: ${feedbackValidation.errors.join('; ')}`);
      }
    } catch (err) {
      warnings.push(`Follow-up signal could not be parsed: ${path.relative(projectRoot, completionSignalPath)} (${err.message})`);
    }
  }

  // 4. Lessons note was appended (file exists and has been modified recently)
  if (!fs.existsSync(lessonsPath)) {
    warnings.push(`Lessons file missing: ${path.relative(projectRoot, lessonsPath)}`);
  }

  // 5. Lessons-reconciliation signal exists when cadence says it is due
  if (lessonsReconciliationDue && (!lessonsReconciliationSignalPath || !fs.existsSync(lessonsReconciliationSignalPath))) {
    warnings.push(`Lessons reconciliation signal missing: ${lessonsReconciliationSignalPath ? path.relative(projectRoot, lessonsReconciliationSignalPath) : 'none created'}`);
  }

  return {
    coherent: warnings.length === 0,
    warnings
  };
}

/* ---------- Live log helpers ---------- */

function liveLogPathFor(projectRoot) {
  return path.join(projectRoot, '_dev', 'logs', 'codex-exec-live.log');
}

function writeRunActiveStatus(projectRoot, scope, pid, commandLine) {
  const statusPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'codex-run-active.json');
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, JSON.stringify({
    schema: 'CodexRunActive/1.0',
    active: true,
    scope,
    pid,
    started_at: new Date().toISOString(),
    command: commandLine,
    live_log: '_dev/logs/codex-exec-live.log'
  }, null, 2));
  return statusPath;
}

function clearRunActiveStatus(projectRoot) {
  const statusPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'codex-run-active.json');
  if (fs.existsSync(statusPath)) {
    const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    data.active = false;
    data.finished_at = new Date().toISOString();
    fs.writeFileSync(statusPath, JSON.stringify(data, null, 2));
  }
}

/**
 * spawnCodexAsync — Run codex as an async child process with live log streaming.
 *
 * Streams stdout/stderr to a live log file in real-time while also buffering
 * the full output for the completion report.
 *
 * @param {string[]} args - codex CLI arguments
 * @param {string} prompt - stdin prompt to pipe
 * @param {object} opts - { cwd, timeout_ms, projectRoot }
 * @param {function} [onSpawn] - callback invoked with the child PID immediately after spawn
 * @returns {Promise<{ stdout, stderr, exitCode, signal, error }>}
 */
function spawnCodexAsync(args, prompt, opts, onSpawn) {
  return new Promise((resolve) => {
    const logPath = liveLogPathFor(opts.projectRoot);
    ensureDir(path.dirname(logPath));

    // Truncate live log for this run
    fs.writeFileSync(logPath, `--- Codex exec started: ${new Date().toISOString()} ---\n`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    const spawnOptions = {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    };
    // Propagate trace context to the codex child when the boundary supplied it
    // (correlation-ID keystone). Falls through to inherited env otherwise.
    if (opts.spawnEnv && typeof opts.spawnEnv === 'object') {
      spawnOptions.env = opts.spawnEnv;
    }
    const child = spawn('codex', args, spawnOptions);

    // Notify caller of the real PID immediately after spawn
    if (typeof onSpawn === 'function') {
      onSpawn(child.pid);
    }

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
      logStream.write(`[stdout] ${chunk}`);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk);
      logStream.write(`[stderr] ${chunk}`);
    });

    // Feed prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();

    let timedOut = false;
    let timer;
    if (opts.timeout_ms > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        logStream.write(`\n--- TIMEOUT after ${opts.timeout_ms}ms ---\n`);
      }, opts.timeout_ms);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      logStream.write(`\n--- ERROR: ${err.message} ---\n`);
      logStream.end();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: null,
        signal: null,
        error: err,
        timedOut: false
      });
    });

    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer);
      logStream.write(`\n--- Codex exec finished: exit=${code} signal=${sig} ---\n`);
      logStream.end();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        signal: sig,
        error: null,
        timedOut
      });
    });
  });
}

async function runCodexForSignal(projectRoot, signalInfo, opts = {}) {
  const startTime = Date.now();
  const timestamp = opts.timestamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const reviewRunId = opts.runId || `codex-${timestamp}-${sanitizeScope(signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general')}`;

  // Pre-dispatch validation
  const dispatchCheck = validateSignalForDispatch(signalInfo, projectRoot);
  if (!dispatchCheck.valid) {
    console.log(`  SKIPPED: signal failed dispatch validation`);
    for (const err of dispatchCheck.errors) {
      console.log(`    - ${err}`);
    }
    return {
      mode: 'skipped',
      reason: 'invalid_signal',
      errors: dispatchCheck.errors,
      signalName: signalInfo.name,
      signalPath: signalInfo.filePath
    };
  }

  // Local-first pre-dispatch: if signal is low-risk and --local-first is set,
  // run verify-local on artifacts before spending frontier tokens.
  if (opts.localFirst !== false) {
    const risk = classifySignalRisk(signalInfo.signal);
    if (risk.risk === 'low') {
      console.log(`  Local-first eligible (${risk.reason}). Running verify-local...`);
      const localResult = await runLocalFirstPass(signalInfo.signal, projectRoot, {
        model: opts.localModel || 'qwen2.5-coder:14b'
      });

      if (localResult.locally_accepted) {
        console.log(`  Local review: ACCEPTED (${localResult.reason})`);
        console.log(`  Skipping Codex dispatch — saving frontier tokens.`);

        return {
          mode: 'local_accepted',
          reason: localResult.reason,
          localResults: localResult.results,
          signalName: signalInfo.name,
          signalPath: signalInfo.filePath,
          risk
        };
      } else {
        console.log(`  Local review: ESCALATING (${localResult.reason})`);
        console.log(`  Proceeding to Codex dispatch.`);
      }
    }
  }

  // Cost-gate check: warn if 24h spend exceeds threshold, never block dispatch
  try {
    const costGate = checkCostGate(projectRoot);
    if (costGate.enforced && costGate.exceeded) {
      const costMsg = `[cost-gate] ${costGate.message} — signal: ${signalInfo.name}`;
      console.log(`  WARNING: ${costMsg}`);
      const liveLog = liveLogPathFor(projectRoot);
      ensureDir(path.dirname(liveLog));
      fs.appendFileSync(liveLog, `${new Date().toISOString()} WARN ${costMsg}\n`);
    } else if (costGate.error) {
      const errMsg = `[COST-GATE] Cost check error (continuing dispatch): ${costGate.error}`;
      console.log(`  WARNING: ${errMsg}`);
      const liveLog = liveLogPathFor(projectRoot);
      ensureDir(path.dirname(liveLog));
      fs.appendFileSync(liveLog, `${new Date().toISOString()} WARN ${errMsg}\n`);
    }
  } catch (_costErr) {
    // Cost gate is advisory only — never fail dispatch
  }

  // `prompt` is the execution form (full substrate prepended) and reaches
  // Codex via stdin. `artifactPrompt` is the descriptor-only form written
  // to the tracked-lane artifact path — substrate content never lands on
  // disk through this seam (imp-004 containment).
  const narrativeContract = buildNarrativeRunContract(projectRoot, signalInfo, reviewRunId);
  const narrativePrompt = renderNarrativeContractPrompt(projectRoot, narrativeContract);
  const prompt = buildPromptFromSignal(signalInfo, { projectRoot }) + narrativePrompt;
  const artifactPrompt = buildPromptForArtifact(signalInfo, { projectRoot }) + narrativePrompt;
  const artifacts = buildRunArtifacts(projectRoot, signalInfo, timestamp);
  const promptPath = writeBridgePrompt(artifacts.promptPath, artifactPrompt);

  // Derive execution options from signal contract + CLI overrides
  const execOpts = deriveExecutionOptions(signalInfo, projectRoot, { model: opts.model || '' });

  // Build args — stdin marker tells codex to read prompt from stdin
  const args = [...execOpts.args, '-'];

  const commandLine = `codex ${args.join(' ')}`;

  if (opts.dryRun) {
    return {
      mode: 'dry-run',
      promptPath,
      commandLine,
      artifacts,
      executionOptions: execOpts
    };
  }

  // Auth preflight applies only to paths that actually launch Codex.
  // Preview paths above intentionally bypass live auth requirements.
  const authCheck = validateCodexAuthState(opts.authCheck || {});
  if (!authCheck.valid) {
    console.log(`  SKIPPED: Codex auth preflight failed`);
    for (const err of authCheck.errors) {
      console.log(`    - ${err}`);
    }
    return {
      mode: 'skipped',
      reason: 'auth_preflight_failed',
      errors: authCheck.errors,
      authCheck,
      signalName: signalInfo.name,
      signalPath: signalInfo.filePath
    };
  }

  // MCP server preflight applies only to paths that actually launch Codex.
  // Preview paths above intentionally bypass live MCP requirements.
  if (opts.skipMcpCheck !== true) {
    const mcpCheck = validateCodexMcpServers();
    if (!mcpCheck.valid) {
      console.log(`  SKIPPED: Codex MCP preflight failed`);
      for (const err of mcpCheck.errors) {
        console.log(`    - ${err}`);
      }
      return {
        mode: 'skipped',
        reason: 'mcp_preflight_failed',
        errors: mcpCheck.errors,
        signalName: signalInfo.name,
        signalPath: signalInfo.filePath
      };
    }
  }

  // Acquire lock to prevent duplicate consumption
  if (!acquireLock(signalInfo.filePath)) {
    console.log(`Signal already claimed (lock exists): ${signalInfo.name}`);
    return {
      mode: 'skipped',
      reason: 'already_claimed',
      signalName: signalInfo.name
    };
  }

  let runResult;
  try {
    // Write live status so observers can see Codex is running
    const scope = signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general';
    writeRunActiveStatus(projectRoot, scope, 0, commandLine);
    console.log(`  Live log: _dev/logs/codex-exec-live.log`);

    // Keystone emission (P1): seed the codex child's trace context and write its
    // span at the shared shell boundary before spawn. Agent-agnostic — codex is
    // an external CLI that cannot emit its own span. FULLY FAIL-OPEN: every
    // telemetry require/call is inside this guard, so a telemetry failure can
    // never prevent the codex dispatch (codex review). On failure the spawn falls
    // back to the inherited process env.
    let codexSpawnEnv = process.env;
    try {
      const { buildNextTraceEnv } = require('../../telemetry/dispatches/lib/trace-context.cjs');
      const { detectExecutionMode } = require('../../telemetry/dispatches/lib/managed-mode-detect.cjs');
      const { emitChildSpan, ensureRootTraceEnv } = require('../../telemetry/dispatches/lib/emit-span.cjs');
      // Boundary auto-seed from the signal's lineage (physical-equivalence).
      ensureRootTraceEnv(projectRoot, {
        lineageRootSessionId: signalInfo.signal.lineage_root_session_id
          || signalInfo.signal.produced_by_session_id || null,
        scope,
        emitSource: 'codex-auto:root'
      });
      const codexNextEnv = buildNextTraceEnv({
        scope,
        executionMode: detectExecutionMode(signalInfo.signal.recommended_next_command)
      });
      emitChildSpan(projectRoot, codexNextEnv, {
        model: execOpts.model || 'codex',
        // Mind + harness provenance (c6-mind-coverage-repair). This is the
        // POST-RESOLUTION child span: the runner has selected the model, so it
        // is witnessed. codex is a distinct external-CLI mind (not a parallel
        // Claude context), executed under the codex-cli harness.
        mind_class: 'codex',
        mind_relation: 'external-cli',
        model_verified: true,
        harness: 'codex-cli',
        harness_witness_state: 'witnessed',
        actor_role: 'reviewer',
        subagent_type: 'codex',
        actor_reason: signalInfo.signal.signal_type
          ? `codex bridge dispatch (${signalInfo.signal.signal_type})`
          : 'codex bridge dispatch',
        routing_decision: 'delegate-down',
        scope_identity: scope,
        status: 'ok',
        emit_source: 'codex-auto'
      });
      codexSpawnEnv = { ...process.env, ...codexNextEnv };
    } catch (telemetryErr) {
      process.stderr.write(`[codex-auto] telemetry fail-open: ${telemetryErr.message}\n`);
    }
    if (narrativeContract) {
      codexSpawnEnv = {
        ...codexSpawnEnv,
        MYTHOS_REVIEW_RUN_ID: narrativeContract.run_id,
        MYTHOS_REVIEW_PLAN_CONTENT_HASH: narrativeContract.plan_content_hash,
        MYTHOS_REVIEW_PLAN_JSON_SHA256: narrativeContract.plan_json_sha256,
        MYTHOS_REVIEW_PLAN_MARKDOWN_SHA256: narrativeContract.plan_markdown_sha256,
        MYTHOS_REVIEW_OUTPUT_JSON: path.relative(projectRoot, narrativeContract.canonical_json),
        MYTHOS_REVIEW_OUTPUT_MARKDOWN: path.relative(projectRoot, narrativeContract.canonical_markdown)
      };
    }

    const spawnRunner = opts.spawnCodexAsync || spawnCodexAsync;
    const result = await spawnRunner(args, prompt, {
      cwd: execOpts.cwd,
      timeout_ms: execOpts.timeout_ms || 0,
      projectRoot,
      spawnEnv: codexSpawnEnv
    }, (pid) => {
      // Update active status with real PID once the child process is spawned
      writeRunActiveStatus(projectRoot, scope, pid, commandLine);
    });

    // Update active status with finished state
    clearRunActiveStatus(projectRoot);

    // Classify the outcome structurally
    let classified = classifyOutcome({
      status: result.exitCode,
      signal: result.signal,
      error: result.error
    }, { timedOut: result.timedOut });

    const underlyingOutcome = classified.outcome;
    const narrativeCompletion = checkNarrativeCompletion(projectRoot, narrativeContract);
    classified = applyNarrativeCompletionOutcome(classified, narrativeCompletion);

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const exitCode = classified.exitCode;
    const success = classified.success;
    const outcome = classified.outcome;
    const sourceRelPath = path.relative(projectRoot, signalInfo.filePath);
    const reportRelPath = path.relative(projectRoot, artifacts.completionReportPath);
    const lastMessageRelPath = path.relative(projectRoot, artifacts.lastMessagePath);
    const promptRelPath = path.relative(projectRoot, promptPath);
    const lastMessage = extractLastMeaningfulMessage(stdout, stderr);

    writeLastMessageArtifact(artifacts.lastMessagePath, {
      timestamp,
      scope: signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general',
      outcome,
      sourceSignal: sourceRelPath,
      triggerCommand: signalInfo.signal.recommended_next_command || '',
      message: lastMessage,
      stdout,
      stderr
    });

    // Emit bridge lifecycle trace event for dispatch completion
    try {
      var bridgeTracePath = path.join(projectRoot, '_dev', 'logs', 'bridge-lifecycle-trace.jsonl');
      fs.mkdirSync(path.dirname(bridgeTracePath), { recursive: true });
      fs.appendFileSync(bridgeTracePath, JSON.stringify({
        event_type: 'bridge_lifecycle',
        timestamp: new Date().toISOString(),
        scope: signalInfo.signal.signal_scope || signalInfo.signal.scope || '',
        from_state: 'bridge_active',
        to_state: success ? 'feedback_received' : 'blocked_on_actor_bridge',
        success: success,
        actor: 'codex'
      }) + '\n');
    } catch (_) { /* trace is best-effort */ }

    writeCompletionReport(artifacts.completionReportPath, {
      timestamp,
      scope: signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general',
      sourceSignal: sourceRelPath,
      promptArtifact: promptRelPath,
      lastMessageArtifact: lastMessageRelPath,
      exitCode,
      outcome,
      success,
      triggerCommand: signalInfo.signal.recommended_next_command || '',
      triggerActor: signalInfo.signal.recommended_next_actor || '',
      commandLine,
      summary: outcomeToSummary(classified),
      narrativeCompletion,
      stdout,
      stderr
    });

    const lessonsPath = pickLessonsPath(projectRoot, timestamp);
    ensureLessonsDocument(lessonsPath, timestamp);

    const followUpActor = deriveFollowUpActor(signalInfo);
    const followUpCommand = deriveFollowUpCommand(signalInfo, reportRelPath, success);

    // Emission gate 1c (warn-level): the completion signal must not broaden
    // the completion report's declared "Exact next command". Closeouts are
    // not hard-failed on mismatch in this slice.
    let commandConsistency = { declared: '', matches: true };
    try {
      const reportText = fs.readFileSync(artifacts.completionReportPath, 'utf8');
      commandConsistency = checkCompletionCommandConsistency(reportText, followUpCommand);
    } catch {
      // Report unreadable — coherence validation reports the missing artifact.
    }
    if (!commandConsistency.matches) {
      console.log(
        `WARNING [emission]: completion signal recommended_next_command "${followUpCommand}" ` +
        `does not match the completion report's declared Exact next command "${commandConsistency.declared}" ` +
        `(${reportRelPath}). Preserve the report's exact command unless repo truth changed.`
      );
    }

    // Build blocked_by list from outcome
    const blocked_by = success
      ? []
      : [outcomeToSummary(classified)];

    // Always emit next_prompt_stub when a prompt artifact was produced,
    // regardless of whether the source signal carried one.
    const completionSignalOpts = {
      artifacts: [
        reportRelPath,
        lastMessageRelPath,
        path.relative(projectRoot, lessonsPath),
        promptRelPath
      ],
      validation: {
        ran: true,
        // Concrete command/result evidence (emission gate 1a): the exact
        // command line that ran plus its classified outcome.
        summary: `\`${commandLine}\` outcome: ${outcome}` + (exitCode != null ? ` (exit ${exitCode})` : '')
      },
      recommended_next_actor: followUpActor,
      recommended_next_command: followUpCommand,
      next_step_detail: buildFollowUpStepDetail(signalInfo, reportRelPath, success),
      blocked_by,
      ready_for_clear: false,
      signal_scope: signalInfo.signal.signal_scope || '',
      supersedes_signal: sourceRelPath,
      superseded_at: signalInfo.signal.timestamp || ''
    };

    if (artifacts.promptBasename) {
      completionSignalOpts.next_prompt_stub = artifacts.promptBasename;
    }

    const completionSignal = createHandoffSignal(
      'codex',
      signalInfo.signal.scope || 'codex-auto-run',
      success ? 'ready-for-review' : 'blocked',
      completionSignalOpts
    );

    // Attach structured outcome as an extension field for downstream consumers.
    // This is added after createHandoffSignal since it's bridge-specific.
    completionSignal.run_outcome = {
      outcome,
      exitCode,
      signal: classified.signal,
      success,
      underlying_outcome: underlyingOutcome,
      narrative_completion: narrativeCompletion
    };

    const validationResult = validateCodexRunFeedbackSignal(completionSignal, { projectRoot });
    if (!validationResult.valid) {
      throw new Error(`Completion signal validation failed: ${validationResult.errors.join('; ')}`);
    }

    const closedSourcePath = closeSourceSignal(projectRoot, signalInfo);

    ensureDir(path.dirname(artifacts.completionSignalPath));
    fs.writeFileSync(artifacts.completionSignalPath, JSON.stringify(completionSignal, null, 2));

    // Advance bridge state to feedback_received with provenance fields.
    // The source actor (Claude/operator) produced the handoff; Codex validated it.
    const bridgeScope = signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general';
    const sourceActor = String(signalInfo.signal.source || 'claude').trim();
    transitionBridgeState(projectRoot, bridgeScope, BRIDGE_STATES.FEEDBACK_RECEIVED, {
      produced_by: {
        actor_id: sourceActor,
        harness_id: sourceActor === 'codex' ? 'codex-cli' : 'claude-code',
        actor_type: 'intelligence'
      },
      validated_by: {
        actor_id: 'codex',
        harness_id: 'codex-cli',
        actor_type: 'intelligence'
      }
    });

    appendLessonsNote(lessonsPath, {
      timestamp,
      scope: signalInfo.signal.scope || signalInfo.signal.signal_scope || 'general',
      sourceSignal: sourceRelPath,
      // Stable lineage: survives the live→closed move of the source signal.
      signalId: signalInfo.signal.signal_id || signalInfo.name,
      triggerCommand: signalInfo.signal.recommended_next_command || '',
      exitStatus: outcomeToExitStatus(classified),
      outcome,
      completionArtifact: reportRelPath,
      followUpSignal: path.relative(projectRoot, artifacts.completionSignalPath),
      summary: success
        ? 'Automated Codex bridge run completed and published a ready-for-review signal.'
        : `Automated Codex bridge run ended with outcome: ${outcome}. Published a blocked signal.`
    });

    // Write machine-readable run-result JSON BEFORE lessons-reconciliation signal,
    // because the signal references runResultPath and validation checks artifact existence.
    const durationMs = Date.now() - startTime;
    const runResultData = {
      signal_id: signalInfo.name,
      outcome,
      underlying_outcome: underlyingOutcome,
      exit_code: exitCode,
      codex_auth_mode: authCheck.authMode,
      codex_auth_status: authCheck.loginStatus,
      codex_auth_path: authCheck.authPath,
      execution_options: {
        approval_mode: execOpts.approvalMode,
        model: execOpts.model,
        cwd: execOpts.cwd,
        timeout_ms: execOpts.timeout_ms,
        workload: execOpts.workload
      },
      narrative_completion: narrativeCompletion,
      narrative_contract: relativeContract(projectRoot, narrativeContract),
      artifacts_produced: [
        reportRelPath,
        lastMessageRelPath,
        path.relative(projectRoot, artifacts.runResultPath),
        path.relative(projectRoot, lessonsPath),
        promptRelPath
      ],
      // Emission gate 1c (warn-level): durable record of the exact-next-command
      // comparison between the completion report and the completion signal.
      next_command_report_declared: commandConsistency.declared,
      next_command_report_match: commandConsistency.matches,
      timestamp
    };

    writeRunResult(artifacts.runResultPath, runResultData);

    const lessonsStatus = getLessonsReconciliationStatus(projectRoot, timestamp, {
      lessonsPath,
      sourceSignalType: signalInfo.signal.signal_type || '',
      success
    });
    let lessonsReconciliationSignalPath = '';

    if (lessonsStatus.due) {
      const emitted = emitLessonsReconciliationSignal(projectRoot, lessonsStatus, {
        source: 'codex',
        timestamp,
        supersede: true,
        extraArtifacts: [reportRelPath, path.relative(projectRoot, artifacts.runResultPath)]
      });
      lessonsReconciliationSignalPath = emitted.signalPath;
    }

    // Closeout coherence validation
    const coherence = validateCloseoutCoherence(projectRoot, {
      signalInfo,
      closedSourcePath,
      completionReportPath: artifacts.completionReportPath,
      completionSignalPath: artifacts.completionSignalPath,
      lessonsPath,
      success,
      lessonsReconciliationDue: lessonsStatus.due,
      lessonsReconciliationSignalPath
    });

    if (!coherence.coherent) {
      for (const w of coherence.warnings) {
        console.log(`WARNING [closeout]: ${w}`);
      }
    }

    // Update run-result with post-closeout fields (initial write happened before lessons signal)
    const finalRunResultData = {
      ...runResultData,
      follow_up_signal_path: path.relative(projectRoot, artifacts.completionSignalPath),
      lessons_reconciliation_due: lessonsStatus.due,
      lessons_reconciliation_reasons: lessonsStatus.reasons,
      lessons_reconciliation_signal_path: lessonsReconciliationSignalPath
        ? path.relative(projectRoot, lessonsReconciliationSignalPath)
        : '',
      source_signal_closed: fs.existsSync(closedSourcePath),
      closeout_coherent: coherence.coherent,
      closeout_warnings: coherence.warnings,
      duration_ms: Date.now() - startTime
    };

    writeRunResult(artifacts.runResultPath, finalRunResultData);

    runResult = {
      mode: 'executed',
      outcome,
      success,
      exitCode,
      promptPath,
      completionReportPath: artifacts.completionReportPath,
      completionSignalPath: artifacts.completionSignalPath,
      runResultPath: artifacts.runResultPath,
      lessonsPath,
      lessonsReconciliationSignalPath,
      closedSourcePath,
      stdout,
      stderr,
      authCheck,
      executionOptions: execOpts,
      closeoutCoherence: coherence
    };
  } finally {
    // Always release the lock, whether the run succeeded or failed
    releaseLock(signalInfo.filePath);
  }

  return runResult;
}

module.exports = {
  acquireLock,
  appendLessonsNote,
  applyNarrativeCompletionOutcome,
  buildRunArtifacts,
  extractLastMeaningfulMessage,
  classifyOutcome,
  closeSourceSignal,
  deriveExecutionOptions,
  deriveFollowUpActor,
  buildFollowUpStepDetail,
  buildLessonsReconciliationStepDetail,
  checkCompletionCommandConsistency,
  deriveFollowUpCommand,
  extractExactNextCommandFromReport,
  ensureLessonsDocument,
  emitLessonsReconciliationSignal,
  extractAutomatedRunNoteTimestamps,
  getLessonsReconciliationStatus,
  lessonsFileDate,
  lessonsReconciliationCommand,
  listLessonsFiles,
  latestReconciliationArtifactMs,
  reconciliationCoverageMsForDate,
  LOCK_STALE_MS,
  LESSONS_RECONCILIATION_SCOPE,
  LESSONS_RECONCILIATION_THRESHOLD,
  lockPathFor,
  listCodexTargetSignals,
  closeLiveSignalsForScope,
  outcomeToExitStatus,
  outcomeToSummary,
  OUTCOME_TYPES,
  EXECUTION_MODE_MAP,
  REQUIRED_MCP_SERVERS,
  EXPECTED_CODEX_AUTH_MODE,
  EXPECTED_CODEX_LOGIN_STATUS_SNIPPET,
  pickLessonsPath,
  pickLessonsReconciliationPaths,
  liveLogPathFor,
  releaseLock,
  runCodexForSignal,
  selectCodexTargetSignal,
  selectCodexTargetSignalStrict,
  spawnCodexAsync,
  validateCodexAuthState,
  validateCodexMcpServers,
  validateCloseoutCoherence,
  validateCodexRunFeedbackSignal,
  writeLastMessageArtifact,
  writeRunActiveStatus,
  clearRunActiveStatus,
  writeRunResult,
  // imp-004: substrate-leak containment for Codex CLI echo
  sanitizeCodexCliEcho
};
