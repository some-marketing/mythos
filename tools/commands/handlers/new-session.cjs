'use strict';

// Deterministic /new-session runner (plan session-lifecycle-mechanical-runners, S3).
//
// Executes the mechanical lane of the canonical new-session cascade
// (instructions/canonical/commands/new-session.yaml): auto-commit + disk
// quota check, the dirty-tree gate, optional resume-boundary consumption
// (only for an operator-supplied scope), and system status + continuity
// indexing. Records judgment-lane steps (clean-house custody grouping,
// kernel read) as remaining work rather than executing them, and emits a
// SessionOpenPacket/1.0.
//
// Hard invariants (mirrors tools/commands/handlers/shutdown.cjs, S2):
//  - Drift gate FIRST and BLOCKING: if the live spec's process array does not
//    exactly match SPEC_COVERAGE, the mechanical path is refused (exit 5)
//    before any mechanical execution. Never softened to a warning.
//  - judgment_remaining is computed at runtime from the live parsed spec
//    filtered by SPEC_COVERAGE lanes — never a standalone hardcoded array.
//    Step 3 (/clean-house) only appears when the dirty-tree count is > 0
//    (the spec itself scopes step 3 to "only if dirty"); step 5 (kernel
//    read) always appears — a session open always ends in a kernel read.
//  - No secrets/env values/client payloads in the packet. No commits, no
//    marker consumption beyond an operator-supplied scope, no handoff prose.
//  - Never auto-select or fuzzy-consume a scope the caller did not pass:
//    step 3b only runs — and only ever calls consume-boundary.cjs with the
//    caller-supplied scope argument, verbatim — when a scope was passed.
//  - Fail closed: report-only. This handler adds no mutation authority
//    beyond invoking the sanctioned step tools; it never git-adds/commits,
//    never writes handoffs, never consumes markers implicitly.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseSpecSteps,
  checkDrift,
  renderDriftReport
} = require('../lib/lifecycle-spec-drift.cjs');
const { FORBIDDEN_CHANGED_FILE_FAMILIES, redactChangedFiles } = require('./shutdown.cjs');
const { listPending: boundaryListPending, resolveScope: boundaryResolveScope } = require('../../sessions/lib/boundary-markers.cjs');
const { reapDeadSessions } = require('../../sessions/boot-dead-session-reaper.cjs');

const SPEC_REL_PATH = 'instructions/canonical/commands/new-session.yaml';
const PACKETS_REL_DIR = path.join('_dev', 'reports', 'lifecycle', 'session-open-packets');
const FALLBACK_NOTE = 'mechanical path refused; fall back to YAML spec inference (/new-session --manual)';

// Total map over the live new-session.yaml process array, in order. The
// drift gate (checkDrift) proves this stays a total ordered match at every
// run. Unlike shutdown.yaml, every entry in new-session.yaml's process
// array matches the "Step N — label:" pattern (no free-text preamble or
// postamble entry), so every coverage entry here is a 'step' kind.
const SPEC_COVERAGE = Object.freeze([
  Object.freeze({
    step_id: '1',
    label: 'auto-commit (from /boot)',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: '2',
    label: 'dirty-tree gate',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: '3',
    label: '/clean-house (only if dirty)',
    lane: 'judgment',
    judgment_summary: 'clean-house custody grouping + operator approval (dirty tree present)'
  }),
  Object.freeze({
    step_id: '3b',
    label: 'resume-boundary context load (only when the operator chooses a pending boundary scope)',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: '4',
    label: 'system status + active work (from /boot)',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: '5',
    label: 'kernel read (from /boot)',
    lane: 'judgment',
    judgment_summary: 'kernel read synthesis (spec step 5)'
  })
]);

function defaultCommands() {
  return {
    // Step 1: auto-commit. Exit 0/2 = continue and record. Exit 1 = HALT.
    '1-auto-commit': [process.execPath, path.join('tools', 'hygiene', 'auto-commit.js'), '--auto', '--foreground'],
    // Step 1: disk quota guard, warn-only by its own contract.
    '1-disk-quota': [process.execPath, path.join('tools', 'hygiene', 'disk-quota-guard.cjs'), '--check'],
    // Step 3b: resume-boundary consumption. Only invoked when a scope arg is
    // passed; the scope token is appended by the caller.
    '3b-consume-boundary': [process.execPath, path.join('tools', 'sessions', 'consume-boundary.cjs')],
    // Step 4: boot.yaml 1b cache refresh — rebuild repo-awareness before any
    // routing decision; refresh the plan-visibility dashboard only if repo-
    // awareness reports stale plan visibility.
    '4-repo-awareness': [process.execPath, path.join('tools', 'context', 'repo-awareness-init.cjs'), '--json'],
    '4-plans-dashboard': [process.execPath, path.join('tools', 'planning', 'build-plan-visibility-dashboard.js')],
    // Step 4: bounded system status + continuity index.
    '4-status': [process.execPath, path.join('tools', 'status', 'mythos-status.js'), '--json'],
    '4-continuity': [process.execPath, path.join('tools', 'sessions', 'continuity-index.cjs'), '--json']
  };
}

// Harness session id, best-effort, for the SessionOpenPacket/1.0 additive
// `session_id` field. Order: explicit env (the harness sets one of these),
// then the durable active-session sidecar, then (best-effort) the newest live
// registered session — so a harness that registered a session but set no env
// (codewhale) still resolves to its own id and grounds the sidecar. Never
// fabricated — genuinely unavailable resolves to null with a source note.
function resolveSessionId(projectRoot) {
  const env = process.env;
  const fromEnv = env.CLAUDE_SESSION_ID || env.MYTHOS_SESSION_ID || env.CODEX_SESSION_ID || '';
  if (fromEnv) return { session_id: fromEnv, session_id_source: 'env' };
  try {
    const sidecar = path.join(projectRoot, '_dev', 'state', 'active-sessions', '_current-id');
    const id = fs.readFileSync(sidecar, 'utf8').trim();
    if (id) return { session_id: id, session_id_source: 'active-session-sidecar' };
  } catch { /* sidecar absent — fall through to null */ }
  try {
    const registry = require(path.join(projectRoot, 'tools', 'sessions', 'lib', 'active-session-registry.js'));
    const active = registry.listActive({});
    if (active.length === 1) {
      return { session_id: active[0].session_id, session_id_source: 'sole-active-session' };
    }
    if (active.length > 1) {
      const newest = active
        .slice()
        .sort((a, b) => String(b.last_heartbeat || '').localeCompare(String(a.last_heartbeat || '')))[0];
      if (newest && newest.session_id) {
        return { session_id: newest.session_id, session_id_source: 'newest-active-session' };
      }
    }
  } catch { /* registry unreadable — fall through to null */ }
  return { session_id: null, session_id_source: 'unavailable' };
}

function assertSessionIdentityForNewSession(projectRoot) {
  return require('../../sessions/lib/resolve-session-id.cjs')
    .assertAuthoritativeSessionIdentity(projectRoot, 'new-session step 0');
}

// Read a plan-visibility freshness verdict out of repo-awareness-init --json.
// Returns 'stale' | 'fresh' | 'unknown'. Tolerant of the two shapes the
// snapshot has carried (nested freshness object vs. flattened status).
function planVisibilityStatus(parsed) {
  const pv = parsed && parsed.snapshot && parsed.snapshot.plan_visibility;
  if (!pv) return 'unknown';
  if (pv.freshness && typeof pv.freshness.status === 'string') return pv.freshness.status;
  if (typeof pv.status === 'string') return pv.status;
  return 'unknown';
}

// Advisory-only: surface any pending SessionBoundary/1.0 markers (and, when no
// resume scope was passed, the default `system` marker prominently) so the
// operator sees what /shutdown left to resume. NEVER consumes — consumption
// stays operator-selected (step 3b), matching current semantics.
function surfacePendingBoundaries(projectRoot, scopeArg) {
  if (scopeArg) return { available_boundaries: null, default_scope_boundary: null };
  try {
    const pending = boundaryListPending({ root: projectRoot });
    if (!pending.length) return { available_boundaries: null, default_scope_boundary: null };
    const summarize = (p) => ({
      scope: p.scope,
      handoff_path: p.handoff_path || null,
      recommended_next_command: p.recommended_next_command || null,
      consume_command: `node tools/sessions/consume-boundary.cjs ${p.scope}`
    });
    const available = pending.map((m) => summarize(m.payload));
    let defaultScopeBoundary = null;
    const sys = boundaryResolveScope('system', { root: projectRoot });
    if (sys.status === 'exact') {
      defaultScopeBoundary = {
        ...summarize(sys.marker.payload),
        note: 'A pending SessionBoundary/1.0 marker exists for the default (system) scope. NOT auto-consumed — pass the scope to /new-session or run the consume command to resume it.'
      };
    }
    return { available_boundaries: available, default_scope_boundary: defaultScopeBoundary };
  } catch {
    // The boundary surface is advisory; it never blocks a session open.
    return { available_boundaries: null, default_scope_boundary: null };
  }
}

function splitArgs(argsText) {
  return String(argsText || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) || [];
}

function toPosix(relPath) {
  return String(relPath).replace(/\\/g, '/');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeSkipToken(token) {
  return slugify(String(token || '').replace(/^\//, ''));
}

function stepMatchesSkip(coverageEntry, skipSet) {
  if (skipSet.size === 0) return false;
  const aliases = [String(coverageEntry.step_id), slugify(String(coverageEntry.label).replace(/^\//, ''))];
  return aliases.some((alias) => skipSet.has(alias));
}

// git status --short (read-only); returns raw lines, unredacted.
function gitChangedFiles(projectRoot, exec) {
  const result = exec('git', ['status', '--short'], { cwd: projectRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) return { ok: false, files: [] };
  const files = String(result.stdout || '').split('\n').filter(Boolean).slice(0, 1000);
  return { ok: true, files };
}

// Bounded extraction from mythos-status.js --json output — summary fields
// only, never the full status dump (which can carry live-ad and inventory
// payloads far larger than a session-open packet should carry).
function extractStatusSummary(parsedStatus) {
  if (!parsedStatus || typeof parsedStatus !== 'object') return null;
  const nextStep = parsedStatus.next_step || {};
  const maintenance = parsedStatus.maintenance || {};
  const liveSignals = Array.isArray(parsedStatus.live_signals) ? parsedStatus.live_signals : [];
  return {
    next_step: {
      command: nextStep.command || null,
      reason: nextStep.reason || null,
      source: nextStep.source || null,
      blocked_by_count: Array.isArray(nextStep.blocked_by) ? nextStep.blocked_by.length : 0
    },
    maintenance_clearance: maintenance.available ? (maintenance.clearance || null) : null,
    maintenance_condition_count: Array.isArray(maintenance.conditions) ? maintenance.conditions.length : 0,
    live_signal_count: liveSignals.length
  };
}

function runNewSessionInner(projectRoot, opts) {
  const dryRun = Boolean(opts.dryRun) || opts.exec === false;
  const specPath = path.join(projectRoot, SPEC_REL_PATH);

  // 1. Drift gate FIRST — BLOCKING. No mechanical execution on drift.
  if (!fs.existsSync(specPath)) {
    return {
      exitCode: 5,
      packet: null,
      stdout: '',
      stderr: `Canonical spec not found at ${SPEC_REL_PATH}; cannot verify coverage.\n${FALLBACK_NOTE}`
    };
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const specSteps = parseSpecSteps(spec.process);
  const drift = checkDrift(SPEC_COVERAGE, specSteps);
  if (!drift.ok) {
    return {
      exitCode: 5,
      packet: null,
      stdout: '',
      stderr: `${renderDriftReport(drift, { specPath: SPEC_REL_PATH })}\n${FALLBACK_NOTE}`
    };
  }

  // Identity is an execution precondition, not a SessionStart registration
  // precondition. Enforce it immediately before step 0 so no mechanical work
  // can run under a guessed or unavailable identity.
  try {
    assertSessionIdentityForNewSession(projectRoot);
  } catch (err) {
    return {
      exitCode: 2,
      packet: null,
      stdout: '',
      stderr: `${err.message}\n${FALLBACK_NOTE}`
    };
  }

  const exec = opts.spawn || spawnSync;
  const commands = { ...defaultCommands(), ...(opts.commands || {}) };
  const skipSet = new Set((opts.skip || []).map(normalizeSkipToken).filter(Boolean));
  const scopeArg = opts.scope ? String(opts.scope).trim() : '';

  let halted = false;
  let haltReason = null;
  const stepRecords = [];
  let dirtyFileCount = 0;
  let changedFilesRaw = [];
  let resumeBoundary = null;
  let statusSummary = null;
  let continuityIndex = null;
  let deadSessionReaper = null;

  for (let i = 0; i < SPEC_COVERAGE.length; i += 1) {
    const coverage = SPEC_COVERAGE[i];
    const record = {
      step_id: coverage.step_id,
      label: coverage.label,
      lane: coverage.lane,
      status: null,
      exit_code: null,
      detail: ''
    };

    if (halted) {
      record.status = 'not_reached';
      record.detail = `cascade halted at step ${haltReason.step_id}`;
      stepRecords.push(record);
      continue;
    }

    if (stepMatchesSkip(coverage, skipSet)) {
      record.status = 'skipped';
      record.detail = 'skipped via --skip';
      stepRecords.push(record);
      continue;
    }

    if (coverage.lane === 'judgment') {
      // Step 3 (/clean-house) is only judgment-remaining when the tree is
      // actually dirty — the spec itself scopes it to "only if dirty".
      if (coverage.step_id === '3' && dirtyFileCount === 0) {
        record.status = 'not_applicable';
        record.detail = 'dirty-tree count is 0; /clean-house is not applicable this session';
        stepRecords.push(record);
        continue;
      }
      record.status = 'judgment_remaining';
      record.detail = coverage.judgment_summary || 'judgment work remains';
      stepRecords.push(record);
      continue;
    }

    // Mechanical lane.
    if (coverage.step_id === '1') {
      if (dryRun) {
        record.status = 'skipped(dry-run)';
        record.detail = 'would run: auto-commit --auto --foreground, disk-quota-guard --check';
        stepRecords.push(record);
        continue;
      }
      const autoCommitArgv = commands['1-auto-commit'];
      const autoCommitResult = exec(autoCommitArgv[0], autoCommitArgv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
      const autoCommitExit = autoCommitResult.status === undefined ? null : autoCommitResult.status;
      const diskQuotaArgv = commands['1-disk-quota'];
      const diskQuotaResult = exec(diskQuotaArgv[0], diskQuotaArgv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
      const diskQuotaExit = diskQuotaResult.status === undefined ? null : diskQuotaResult.status;
      record.sub_steps = [
        {
          id: 'auto-commit',
          exit_code: autoCommitExit,
          status: autoCommitExit === 1 ? 'failed' : (autoCommitExit === 0 ? 'complete' : 'partial'),
          detail: autoCommitResult.error
            ? `spawn error: ${autoCommitResult.error.message}`
            : (autoCommitExit === 1
              ? 'auto-commit exited 1 (failure) — halting'
              : (autoCommitExit === 2 ? 'partial: ungrouped files skipped' : 'clean, all committed, or skipped via branch gate'))
        },
        {
          id: 'disk-quota-guard',
          exit_code: diskQuotaExit,
          status: diskQuotaExit === 0 ? 'complete' : 'warn',
          detail: diskQuotaResult.error
            ? `spawn error: ${diskQuotaResult.error.message}`
            : (diskQuotaExit === 0 ? 'disk space above threshold' : 'disk-quota-guard exited nonzero; warn-only fail-safe, session-open continues')
        }
      ];
      if (autoCommitExit === 1) {
        record.status = 'failed';
        record.detail = 'auto-commit exited 1 (failure); halting per spec step 1';
        halted = true;
        haltReason = {
          step_id: coverage.step_id,
          label: coverage.label,
          exit_code: autoCommitExit,
          reason: record.detail
        };
      } else {
        record.status = 'complete';
        record.detail = 'auto-commit + disk-quota-guard ran; see sub_steps';
      }
      stepRecords.push(record);
      continue;
    }

    if (coverage.step_id === '2') {
      const git = gitChangedFiles(projectRoot, exec);
      changedFilesRaw = git.files;
      dirtyFileCount = git.files.length;
      record.status = git.ok ? 'complete' : 'warn';
      record.detail = git.ok
        ? `dirty file count: ${dirtyFileCount}`
        : 'git status --short failed; dirty-tree count could not be determined';
      stepRecords.push(record);
      continue;
    }

    if (coverage.step_id === '3b') {
      if (!scopeArg) {
        record.status = 'not_applicable';
        record.detail = 'no scope argument passed; step 3b never auto-selects or fuzzy-consumes a scope';
        stepRecords.push(record);
        continue;
      }
      if (dryRun) {
        record.status = 'skipped(dry-run)';
        record.detail = `would run: consume-boundary.cjs ${scopeArg}`;
        stepRecords.push(record);
        continue;
      }
      const argv = commands['3b-consume-boundary'];
      const result = exec(argv[0], [...argv.slice(1), scopeArg], { cwd: projectRoot, encoding: 'utf8' });
      const exitCode = result.status === undefined ? null : result.status;
      // The resolver's distinct exit codes (0 exact-consumed, 2 usage error,
      // 3 SCOPE_NOT_FOUND, or any other) surface here VERBATIM — never
      // flattened into a generic error string.
      resumeBoundary = {
        scope: scopeArg,
        exit_code: exitCode,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      };
      record.exit_code = exitCode;
      record.status = exitCode === 0 ? 'complete' : 'warn';
      record.detail = exitCode === 0
        ? `resume-boundary consumed for scope "${scopeArg}"`
        : `consume-boundary exited ${exitCode} for scope "${scopeArg}"; see resume_boundary field`;
      stepRecords.push(record);
      continue;
    }

    if (coverage.step_id === '4') {
      if (dryRun) {
        record.status = 'skipped(dry-run)';
        record.detail = 'would run: repo-awareness-init.cjs --json (+ plans:dashboard if stale), mythos-status.js --json, continuity-index.cjs --json';
        stepRecords.push(record);
        continue;
      }
      // boot.yaml step 1b: rebuild the repo-awareness surface before routing,
      // then refresh the plan-visibility dashboard only if it reports stale.
      // Warn-only — a cache-refresh miss never halts a session open.
      const repoAwarenessArgv = commands['4-repo-awareness'];
      const repoAwarenessResult = exec(repoAwarenessArgv[0], repoAwarenessArgv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
      const repoAwarenessExit = repoAwarenessResult.status === undefined ? null : repoAwarenessResult.status;
      const parsedRepoAwareness = repoAwarenessExit === 0 ? safeParseJson(repoAwarenessResult.stdout) : null;
      const planStatus = planVisibilityStatus(parsedRepoAwareness);
      const cacheSubSteps = [{
        id: 'repo-awareness',
        exit_code: repoAwarenessExit,
        status: repoAwarenessExit === 0 ? 'complete' : 'warn',
        plan_visibility: planStatus,
        detail: repoAwarenessResult.error
          ? `spawn error: ${repoAwarenessResult.error.message}`
          : (repoAwarenessExit === 0
            ? `repo-awareness rebuilt; plan visibility: ${planStatus}`
            : 'repo-awareness-init exited nonzero; warn-only, session-open continues')
      }];
      if (planStatus === 'stale') {
        const dashboardArgv = commands['4-plans-dashboard'];
        const dashboardResult = exec(dashboardArgv[0], dashboardArgv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
        const dashboardExit = dashboardResult.status === undefined ? null : dashboardResult.status;
        cacheSubSteps.push({
          id: 'plans-dashboard',
          exit_code: dashboardExit,
          status: dashboardExit === 0 ? 'complete' : 'warn',
          detail: dashboardResult.error
            ? `spawn error: ${dashboardResult.error.message}`
            : (dashboardExit === 0 ? 'plan-visibility cache refreshed (was stale)' : 'plans:dashboard exited nonzero; warn-only')
        });
      } else {
        cacheSubSteps.push({
          id: 'plans-dashboard',
          status: 'not_applicable',
          detail: `plan visibility is ${planStatus}; dashboard refresh skipped (boot.yaml 1b: refresh only when stale)`
        });
      }
      const statusArgv = commands['4-status'];
      const statusResult = exec(statusArgv[0], statusArgv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
      const statusExit = statusResult.status === undefined ? null : statusResult.status;
      const parsedStatus = statusExit === 0 ? safeParseJson(statusResult.stdout) : null;
      statusSummary = extractStatusSummary(parsedStatus);

      const continuityArgv = commands['4-continuity'];
      const continuityResult = exec(continuityArgv[0], continuityArgv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
      const continuityExit = continuityResult.status === undefined ? null : continuityResult.status;
      const parsedContinuity = continuityExit === 0 ? safeParseJson(continuityResult.stdout) : null;
      continuityIndex = {
        exit_code: continuityExit,
        paths: parsedContinuity && parsedContinuity.paths ? parsedContinuity.paths : null
      };

      // Dead-session reaper (S2): report-only advisory scan of the pending
      // boundary surface for crash-stub orphans and stale-completed scopes
      // (M135-class). ADVISORY ONLY (gate G3) — it never consumes or tombstones;
      // the full report rides the packet as dead_session_reaper.
      let reaperSub;
      try {
        deadSessionReaper = reapDeadSessions({ root: projectRoot });
        reaperSub = {
          id: 'dead-session-reaper',
          status: 'complete',
          surfaced_count: deadSessionReaper.surfaced_count,
          detail: deadSessionReaper.surfaced_count > 0
            ? `advisory: ${deadSessionReaper.surfaced_count} pending scope(s) need resume-or-tombstone; see packet.dead_session_reaper (no auto-tombstone)`
            : 'no orphaned or stale-completed pending scopes'
        };
      } catch (err) {
        reaperSub = { id: 'dead-session-reaper', status: 'warn', detail: `reaper scan failed: ${err && err.message ? err.message : String(err)}` };
      }

      record.sub_steps = [
        ...cacheSubSteps,
        { id: 'mythos-status', exit_code: statusExit, status: statusExit === 0 ? 'complete' : 'warn' },
        { id: 'continuity-index', exit_code: continuityExit, status: continuityExit === 0 ? 'complete' : 'warn' },
        reaperSub
      ];
      // Parent status reflects ALL sub-steps (including the boot-1b cache
      // refreshes): a warned refresh must not be hidden behind a 'complete'
      // parent, or the packet overclaims that boot caches are fresh (L3).
      // 'complete' and 'not_applicable' are clean; any 'warn' warns the parent.
      const anySubWarn = record.sub_steps.some((sub) => sub.status === 'warn');
      record.status = anySubWarn ? 'warn' : 'complete';
      record.detail = 'repo-awareness + plan-visibility refresh, mythos-status + continuity-index ran; see sub_steps';
      stepRecords.push(record);
      continue;
    }

    // Should be unreachable given SPEC_COVERAGE's fixed shape.
    record.status = 'warn';
    record.detail = `no execution mapping for mechanical step ${coverage.step_id}`;
    stepRecords.push(record);
  }

  // judgment_remaining: computed at runtime from the LIVE parsed spec steps
  // filtered by SPEC_COVERAGE lane=judgment, with step 3 gated on the
  // measured dirty-tree count (never hardcoded).
  const judgmentRemaining = specSteps
    .map((specStep, index) => ({ specStep, coverage: SPEC_COVERAGE[index] }))
    .filter(({ coverage }) => coverage.lane === 'judgment')
    .filter(({ coverage }) => coverage.step_id !== '3' || dirtyFileCount > 0)
    .map(({ specStep, coverage }) => ({
      step_id: coverage.step_id,
      label: specStep.label,
      judgment_summary: coverage.judgment_summary || null
    }));

  const sessionInfo = resolveSessionId(projectRoot);
  const pendingBoundaries = surfacePendingBoundaries(projectRoot, scopeArg);

  // Ground the machine-wide current-session sidecar at session open: a harness
  // that registered a session but set no env (codewhale) leaves _current-id
  // absent, which silently orphans its write-ledger and custody set. Writing
  // it here is idempotent and never fabricates — only a genuinely resolved
  // session id is grounded.
  if (sessionInfo.session_id) {
    try {
      const sidecar = path.join(projectRoot, '_dev', 'state', 'active-sessions', '_current-id');
      fs.mkdirSync(path.dirname(sidecar), { recursive: true });
      fs.writeFileSync(sidecar, `${sessionInfo.session_id}\n`);
    } catch { /* best-effort; grounding is advisory, never blocks open */ }
  }

  const generatedAt = new Date().toISOString();
  const packet = {
    schema: 'SessionOpenPacket/1.0',
    session_id: sessionInfo.session_id,
    session_id_source: sessionInfo.session_id_source,
    generated_at: generatedAt,
    spec: { path: SPEC_REL_PATH, step_count: specSteps.length },
    drift: { ok: true },
    steps: stepRecords,
    dirty_file_count: dirtyFileCount,
    changed_files: redactChangedFiles(changedFilesRaw),
    resume_boundary: resumeBoundary,
    available_boundaries: pendingBoundaries.available_boundaries,
    default_scope_boundary: pendingBoundaries.default_scope_boundary,
    status_summary: statusSummary,
    continuity_index: continuityIndex,
    dead_session_reaper: deadSessionReaper,
    judgment_remaining: judgmentRemaining,
    judgment_remaining_source: 'computed-from-spec-coverage',
    halted,
    halt_reason: haltReason
  };

  const stamp = generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const packetRel = toPosix(path.join(PACKETS_REL_DIR, `${stamp}__session-open.json`));
  if (opts.write !== false) {
    const packetAbs = path.join(projectRoot, packetRel);
    fs.mkdirSync(path.dirname(packetAbs), { recursive: true });
    fs.writeFileSync(packetAbs, JSON.stringify(packet, null, 2) + '\n');
  }

  const exitCode = halted ? 1 : 0;
  let stdout;
  if (opts.json !== false) {
    stdout = JSON.stringify({
      ok: exitCode === 0,
      packet_path: opts.write !== false ? packetRel : null,
      packet
    }, null, 2);
  } else {
    const lines = [];
    lines.push(`Session open packet: ${opts.write !== false ? packetRel : '(not written; --no-write)'}`);
    lines.push(`Steps: ${stepRecords.map((step) => `${step.step_id}=${step.status}`).join(', ')}`);
    lines.push(`Dirty file count: ${dirtyFileCount}`);
    lines.push(`Judgment remaining: ${judgmentRemaining.map((entry) => entry.label).join(', ') || 'none'}`);
    if (halted) lines.push(`HALTED at step ${haltReason.step_id}: ${haltReason.reason}`);
    stdout = lines.join('\n');
  }
  return {
    exitCode,
    packet,
    packetPath: opts.write !== false ? packetRel : null,
    stdout,
    stderr: halted ? `New-session cascade halted at step ${haltReason.step_id} (exit ${haltReason.exit_code}): ${haltReason.reason}` : ''
  };
}

/**
 * Composable API.
 *
 * opts: { scope, skip: [], dryRun, exec, json, write, commands, spawn }
 *  - scope: optional operator-supplied boundary scope for step 3b. NEVER
 *    inferred or fuzzy-matched by this handler — passed verbatim to
 *    consume-boundary.cjs, whose own resolver enforces exact-match-only
 *    consumption.
 *  - commands: internal test seam — a map of key -> argv array that
 *    overrides the default mechanical commands.
 *  - spawn: spawnSync-compatible injection point for tests.
 *
 * Returns { exitCode, packet, packetPath, stdout, stderr }.
 */
function runNewSession(projectRoot, opts = {}) {
  try {
    return runNewSessionInner(projectRoot, opts);
  } catch (err) {
    return {
      exitCode: 6,
      packet: null,
      stdout: '',
      stderr: `Unexpected /new-session runner exception: ${err && err.message ? err.message : String(err)}\nfall back to YAML spec inference path (${SPEC_REL_PATH}; /new-session --manual).`
    };
  }
}

function parseNewSessionArgs(argsText) {
  const tokens = splitArgs(argsText);
  const opts = { scope: '', skip: [], dryRun: false, manual: false, unknown: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--skip') opts.skip.push(tokens[++i] || '');
    else if (token === '--dry-run') opts.dryRun = true;
    else if (token === '--manual') opts.manual = true;
    else if (token.startsWith('--')) opts.unknown.push(token);
    // The first bare (non-flag) token is the optional resume-boundary scope.
    else if (!opts.scope) opts.scope = token;
    else opts.unknown.push(token);
  }
  return opts;
}

// Runner-handler wrapper: (projectRoot, argsText, options) -> {exitCode, stdout, stderr}.
function newSession(projectRoot, argsText, options = {}) {
  const args = parseNewSessionArgs(argsText);
  if (args.manual) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Manual bypass requested: the deterministic runner was not used. Follow the YAML spec inference path at ${SPEC_REL_PATH} (bypass protocol for /new-session --manual).`
    };
  }
  return runNewSession(projectRoot, {
    scope: args.scope,
    skip: args.skip,
    dryRun: args.dryRun,
    json: options.json,
    write: options.write,
    commands: options.commands,
    spawn: options.spawn
  });
}

module.exports = {
  SPEC_COVERAGE,
  SPEC_REL_PATH,
  FORBIDDEN_CHANGED_FILE_FAMILIES,
  redactChangedFiles,
  parseNewSessionArgs,
  runNewSession,
  newSession
};
