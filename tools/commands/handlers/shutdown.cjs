'use strict';

// Deterministic /shutdown runner (plan session-lifecycle-mechanical-runners, S2).
//
// Executes the mechanical lane of the canonical shutdown cascade
// (instructions/canonical/commands/shutdown.yaml), records judgment-lane steps
// as remaining work, and emits a SessionClosePacket/1.0 containing a
// NextSessionSkeleton/1.0 built from repo evidence.
//
// Hard invariants:
//  - Drift gate FIRST and BLOCKING: if the live spec's process array does not
//    exactly match SPEC_COVERAGE, the mechanical path is refused (exit 5)
//    before any mechanical execution. Never softened to a warning.
//  - judgment_remaining is computed at runtime from the live parsed spec
//    filtered by SPEC_COVERAGE lanes — never a standalone hardcoded array.
//  - Step 0 (watcher-stop) runs FIRST and fail-closed: it executes the
//    registered watcher-lifecycle.cjs CLI (identity-verified stopWatchers),
//    halting the cascade on any nonzero exit so closeout never races live
//    daemons.
//  - No secrets/env values/client payloads in the packet. No commits, no
//    marker consumption, no signal closing, no handoff prose.
//  - Fail closed: fields the runner cannot ground in evidence stay '' and are
//    named in missing_required_fields with needs_model_lane=true.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseSpecSteps,
  checkDrift,
  renderDriftReport
} = require('../lib/lifecycle-spec-drift.cjs');
const { buildCloseout } = require('../../maintenance/lib/end-session-closeout.js');
const { writeMarker, SCHEMA: BOUNDARY_SCHEMA } = require('../../sessions/lib/boundary-markers.cjs');
// S3 (plan session-lifecycle-mechanical-repairs): command-validity gate for the
// plural-candidate continuity fallback (isExactSlashCommand + canonical
// registry resolution, alias-aware) and the best-effort reaper-stale scope
// exclusion (fail-open — on any reaper error the filter is skipped).
const { isExactSlashCommand } = require('../../verify/lib/signal.cjs');
const { parseSlashCommand, loadCanonicalCommand } = require('../lib/command-registry.cjs');
const { resolveCommandAlias } = require('../lib/command-aliases.cjs');
const { reapDeadSessions } = require('../../sessions/boot-dead-session-reaper.cjs');

const SPEC_REL_PATH = 'instructions/canonical/commands/shutdown.yaml';
const PACKETS_REL_DIR = path.join('_dev', 'reports', 'lifecycle', 'session-close-packets');
const FALLBACK_NOTE = 'mechanical path refused; fall back to YAML spec inference (/shutdown --manual)';

// Forbidden changed_files path families (plan session-lifecycle-mechanical-runners
// required_gates: no private memory/secret/client payloads in packets). Any
// changed_files entry matching one of these is replaced by a single
// { redacted_family, count } summary rather than emitted verbatim.
const FORBIDDEN_CHANGED_FILE_FAMILIES = Object.freeze([
  Object.freeze({ glob: 'Mythos-memories/**', test: (p) => p === 'Mythos-memories' || p.startsWith('Mythos-memories/') }),
  // Legacy memory-root compatibility for older session status payloads.
  Object.freeze({ glob: 'sm_os-memories/**', test: (p) => p === 'sm_os-memories' || p.startsWith('sm_os-memories/') }),
  Object.freeze({ glob: '**/.env', test: (p) => p.split('/').some((seg) => seg === '.env' || seg.startsWith('.env.')) }),
  Object.freeze({ glob: '**/*secret*', test: (p) => /secret/i.test(p) }),
  Object.freeze({ glob: '**/*credential*', test: (p) => /credential/i.test(p) }),
  Object.freeze({ glob: 'clients/**', test: (p) => p === 'clients' || p.startsWith('clients/') })
]);

// The 11 REQUIRED NextSessionSkeleton/1.0 fields
// (_dev/concepts/cross-session-mechanization.md).
const SKELETON_REQUIRED_FIELDS = Object.freeze([
  'scope',
  'current_state',
  'changed_files',
  'live_signals',
  'closed_signals',
  'blockers',
  'recommended_next_command',
  'handoff_path',
  'artifact_receipts',
  'missing_required_fields',
  'needs_model_lane'
]);

// Total map over the live shutdown.yaml process array, in order. The drift
// gate (checkDrift) proves this stays a total ordered match at every run.
// shutdown.yaml now leads with "Step 0 — watcher-stop"; the scope-resolution
// preamble entry that follows no longer occupies index 0, so the drift parser
// classifies it `unrecognized-1` (covered below, executed like the former
// preamble).
const SPEC_COVERAGE = Object.freeze([
  Object.freeze({
    step_id: '0',
    label: 'watcher-stop',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: 'unrecognized-1',
    label: 'Resolve scope from $ARGUMENTS',
    lane: 'mechanical',
    note: 'Scope-resolution preamble (shutdown.yaml process entry 2). With Step 0 watcher-stop leading the array, the drift parser classifies this entry unrecognized-1; it executes exactly like the former preamble. Mechanical when --system/--client/--scope is given; ambiguous scope is judgment, so the runner refuses (exit 2) instead of inferring.'
  }),
  Object.freeze({
    step_id: '1',
    label: '/normalize-signals',
    lane: 'judgment',
    judgment_summary: 'signal-anomaly judgment; the runner only inventories signals read-only'
  }),
  Object.freeze({
    step_id: '2',
    label: '/clean-house',
    lane: 'judgment',
    judgment_summary: 'custody grouping + operator approval gate'
  }),
  Object.freeze({
    step_id: '3',
    label: '/debrief-run',
    lane: 'judgment',
    judgment_summary: 'debrief prose'
  }),
  Object.freeze({
    step_id: '4',
    label: '/next-session',
    lane: 'judgment',
    judgment_summary: 'handoff prose'
  }),
  Object.freeze({
    step_id: '4b',
    label: '/disk-quota-guard',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: '5',
    label: 'Sync private remotes',
    lane: 'mechanical'
  }),
  Object.freeze({
    step_id: 'postamble',
    label: 'Report a concise three-line summary',
    lane: 'mechanical',
    note: 'The emitted SessionClosePacket/1.0 IS the report.'
  })
]);

function defaultCommands(projectRoot) {
  return {
    // Step 0: watcher-stop. Executes tools/sessions/watcher-lifecycle.cjs
    // (identity-verified stopWatchers). Nonzero exit (identity-refused or
    // unreapable watchers) halts the cascade so closeout never races live
    // daemons. Empty session id -> clean no-op exit 0.
    '0': [process.execPath, path.join('tools', 'sessions', 'watcher-lifecycle.cjs'), 'stop', (resolveSessionId(projectRoot).session_id || ''), '--root', projectRoot],
    // Warn-only by its own contract: nonzero exit is a warn, shutdown continues.
    '4b': [process.execPath, path.join('tools', 'hygiene', 'disk-quota-guard.cjs'), '--apply'],
    // Exit 1 = HALT (push rejection requires human resolution; never force-push).
    '5': ['bash', path.join('tools', 'hygiene', 'sync-private-remotes.sh')]
  };
}

function splitArgs(argsText) {
  return String(argsText || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) || [];
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function toPosix(relPath) {
  return String(relPath).replace(/\\/g, '/');
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function resolveScopeSelector(opts) {
  const hasSystem = Boolean(opts.system);
  const client = opts.client ? String(opts.client).trim() : '';
  const scope = opts.scope ? String(opts.scope).trim() : '';
  const selected = [hasSystem, Boolean(client), Boolean(scope)].filter(Boolean);
  if (selected.length !== 1) return null;
  if (hasSystem) {
    return { selector: '--system', scope_type: 'system', scope_value: 'system', scope_key: 'system' };
  }
  if (client) {
    return { selector: '--client', scope_type: 'client', scope_value: client, scope_key: `client-${slugify(client)}` };
  }
  return { selector: '--scope', scope_type: 'workstream', scope_value: scope, scope_key: slugify(scope) };
}

// Harness session id for the SessionClosePacket/1.0 additive `session_id`
// field (S2, plan session-lifecycle-mechanical-repairs): delegated to the
// shared resolver (tools/sessions/lib/resolve-session-id.cjs) so all three
// consumers agree on identity. Display/packet use only — best_effort rungs are
// fine here; custody never keys off this id.
function resolveSessionId(projectRoot) {
  return require('../../sessions/lib/resolve-session-id.cjs').resolveSessionId(projectRoot);
}

// The scope string carried in the emitted SessionBoundary/1.0 marker — exactly
// what /new-session (or the operator) would pass to consume-boundary.cjs to
// resume. Mirrors the /cross-session marker convention so the two rituals are
// symmetric: --system -> "system", --client CODE -> "client:CODE",
// --scope WS -> the workstream value verbatim.
function boundaryScopeString(scopeInfo) {
  if (scopeInfo.scope_type === 'system') return 'system';
  if (scopeInfo.scope_type === 'client') return `client:${scopeInfo.scope_value}`;
  return scopeInfo.scope_value;
}

// Emit a per-scope SessionBoundary/1.0 marker from the NextSessionSkeleton so
// the close ritual writes exactly what /new-session consumes (closes the
// structural asymmetry, leak L2). FAIL-CLOSED (gate G2): no marker is written
// unless the skeleton grounded BOTH handoff_path and recommended_next_command;
// a miss returns { written:false, blocking:true } so the caller surfaces a loud
// blocking item — never a silent skip. In dry-run / --no-write the decision is
// computed but nothing touches disk.
function emitBoundaryMarker(projectRoot, scopeInfo, skeleton, sessionInfo, opts) {
  const dryRun = Boolean(opts.dryRun) || opts.exec === false;
  const required = ['handoff_path', 'recommended_next_command'];
  const missing = required.filter((field) => !skeleton[field] || String(skeleton[field]).trim() === '');
  const scope = boundaryScopeString(scopeInfo);
  if (missing.length > 0) {
    return {
      schema: BOUNDARY_SCHEMA,
      scope,
      written: false,
      blocking: true,
      reason: `fail-closed: SessionBoundary/1.0 not emitted — missing ${missing.join(', ')}. The next /new-session cannot resume this scope from a marker.`,
      missing_fields: missing,
      required_fields: required
    };
  }
  if (dryRun || opts.write === false) {
    return { schema: BOUNDARY_SCHEMA, scope, written: false, blocking: false, dry_run: true, would_emit: true };
  }
  const payload = {
    schema: BOUNDARY_SCHEMA,
    scope,
    handoff_path: skeleton.handoff_path,
    recommended_next_command: skeleton.recommended_next_command,
    // Additive fields (gate G6 — additive only, no parallel format).
    summary: skeleton.current_state || '',
    scope_key: scopeInfo.scope_key,
    session_id: sessionInfo.session_id,
    session_id_source: sessionInfo.session_id_source,
    written_by: 'tools/commands/handlers/shutdown.cjs'
  };
  try {
    const markerPath = writeMarker(payload, { root: projectRoot });
    return { schema: BOUNDARY_SCHEMA, scope, written: true, blocking: false, marker_path: toPosix(path.relative(projectRoot, markerPath)) };
  } catch (err) {
    return {
      schema: BOUNDARY_SCHEMA,
      scope,
      written: false,
      blocking: true,
      reason: `SessionBoundary/1.0 write failed: ${err && err.message ? err.message : String(err)}`,
      missing_fields: [],
      required_fields: required
    };
  }
}

function walkJsonFiles(dirPath, limit = 800) {
  const out = [];
  function walk(current) {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    // Files BEFORE subdirectories: live signals sit in the scan root while
    // closed/ accumulates unboundedly. Depth-first-into-closed exhausted the
    // limit before any live root signal was read (observed 2026-08-13 with
    // 802 closed files vs limit 800 — a silent-truncation false fail-closed
    // on recommended_next_command grounding).
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isFile() && entry.name.endsWith('.json')) out.push(path.join(current, entry.name));
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isDirectory()) walk(path.join(current, entry.name));
    }
  }
  walk(dirPath);
  return out.sort();
}

// Read-only signal scan under _dev/reports/signals/** (including closed/).
// Never closes or mutates anything. Only bounded, non-sensitive fields are
// carried into the skeleton.
function scanSignals(projectRoot, scopeInfo) {
  const signalsDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const live = [];
  const closed = [];
  // S3: candidates carry { command, scope } so the reaper-stale exclusion can
  // filter by signal scope before distinct-candidate counting.
  const nextCommandCandidates = [];
  let newestLiveTimestamp = null;
  for (const filePath of walkJsonFiles(signalsDir)) {
    const parsed = safeReadJson(filePath);
    if (!parsed || typeof parsed.schema !== 'string' || !parsed.schema.startsWith('CoordinationSignal/')) continue;
    const relPath = toPosix(path.relative(projectRoot, filePath));
    const signalScope = String(parsed.signal_scope || parsed.scope || '');
    const relevant = scopeInfo.scope_type === 'system'
      ? true
      : signalScope.toLowerCase().includes(scopeInfo.scope_key)
        || (scopeInfo.scope_value && signalScope.toLowerCase().includes(String(scopeInfo.scope_value).toLowerCase()))
        || path.basename(filePath).includes(scopeInfo.scope_key);
    if (!relevant) continue;
    const nextCommand = typeof parsed.recommended_next_command === 'string'
      ? parsed.recommended_next_command.trim()
      : '';
    // Bounded timestamp for the S3 freshness gate: the signal's own timestamp,
    // else the file mtime. Used to prove a continuity entry is not older than
    // the newest live scope-matching signal.
    const parsedTs = typeof parsed.timestamp === 'string' ? parsed.timestamp.trim() : '';
    const entry = {
      path: relPath,
      schema: parsed.schema,
      signal_type: parsed.signal_type || parsed.type || null,
      signal_scope: signalScope || null,
      lifecycle_state: parsed.lifecycle_state || null,
      recommended_next_command_present: Boolean(nextCommand),
      timestamp: parsedTs || null
    };
    if (parsed.lifecycle_state === 'closed') {
      closed.push(entry);
    } else {
      live.push(entry);
      if (nextCommand) nextCommandCandidates.push({ command: nextCommand, scope: signalScope });
      const tsMs = parsedTs ? Date.parse(parsedTs) : Number.NaN;
      if (Number.isFinite(tsMs) && (newestLiveTimestamp === null || tsMs > Date.parse(newestLiveTimestamp))) {
        newestLiveTimestamp = parsedTs;
      }
    }
  }
  return { live, closed, nextCommandCandidates, newestLiveTimestamp };
}

function firstNonEmptyLine(filePath, maxChars = 240) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const line = text.split('\n').map((entry) => entry.trim()).find(Boolean) || '';
    return line.slice(0, maxChars);
  } catch {
    return '';
  }
}

// Latest scope-matching continuity entry from the deterministic continuity
// index, if present (NextSessionContinuityIndex/1.0).
function latestContinuityEntry(projectRoot, scopeInfo) {
  const indexPath = path.join(projectRoot, '_dev', 'reports', 'analysis', 'next-session-continuity.json');
  const index = safeReadJson(indexPath);
  if (!index || !Array.isArray(index.entries)) return null;
  const matches = index.entries.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (scopeInfo.scope_type === 'system') return entry.scope_type === 'system';
    if (scopeInfo.scope_type === 'client') {
      return entry.scope_type === 'client'
        && String(entry.client_code || '').toLowerCase() === String(scopeInfo.scope_value).toLowerCase();
    }
    return String(entry.scope || '').toLowerCase().includes(scopeInfo.scope_key);
  });
  matches.sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
  return matches[0] || null;
}

function gitChangedFiles(projectRoot, exec) {
  const result = exec('git', ['status', '--short'], { cwd: projectRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) return { ok: false, files: [] };
  const files = String(result.stdout || '').split('\n').filter(Boolean).slice(0, 1000);
  return { ok: true, files };
}

// Extract the path portion(s) from a `git status --short` line ("XY path" or
// "XY old -> new" for renames), for matching against FORBIDDEN_CHANGED_FILE_FAMILIES.
// For a plain (non-rename) line, source and dest are identical. For a rename
// line, source is the pre-rename path and dest is the post-rename path — both
// must be checked independently, since a rename can move a path INTO a
// forbidden family or OUT of one.
function extractStatusPaths(line) {
  const rest = String(line).slice(2).trim();
  const arrowIndex = rest.indexOf(' -> ');
  if (arrowIndex === -1) return { source: rest, dest: rest };
  return { source: rest.slice(0, arrowIndex), dest: rest.slice(arrowIndex + 4) };
}

// Redact forbidden path families out of raw git-status changed_files entries
// before they can reach the packet, collapsing each matched family into one
// { redacted_family, count } summary entry. Non-matching entries pass through
// unchanged (verbatim git-status lines). A rename line matches a family if
// EITHER its source or its destination path matches (renames both into and
// out of a forbidden family must never leak the raw line); when both match
// the same family it is counted once, and when they match different
// families the source family wins the count so the invariant "no forbidden
// path string ever appears verbatim" holds regardless of rename direction.
function redactChangedFiles(files) {
  const counts = new Map();
  const passthrough = [];
  for (const line of files) {
    const { source, dest } = extractStatusPaths(line);
    const sourceFamily = FORBIDDEN_CHANGED_FILE_FAMILIES.find((entry) => entry.test(source));
    const destFamily = FORBIDDEN_CHANGED_FILE_FAMILIES.find((entry) => entry.test(dest));
    const family = sourceFamily || destFamily;
    if (family) {
      counts.set(family.glob, (counts.get(family.glob) || 0) + 1);
    } else {
      passthrough.push(line);
    }
  }
  const summaries = FORBIDDEN_CHANGED_FILE_FAMILIES
    .filter((entry) => counts.has(entry.glob))
    .map((entry) => ({ redacted_family: entry.glob, count: counts.get(entry.glob) }));
  return [...passthrough, ...summaries];
}

// S3 helpers (plan session-lifecycle-mechanical-repairs):

// Normalize a scope string for matching (lowercase, trimmed).
function normalizeScope(scope) {
  return String(scope || '').trim().toLowerCase();
}

// Best-effort reaper-stale scope set: boundary-marker scopes the dead-session
// reaper grades stale_completed / stale_review_approved. FAIL-OPEN — on any
// error (module unresolvable, unreadable state) returns null so the caller
// skips the filter and behaves exactly as the pre-filter rule.
function staleReaperScopes(projectRoot) {
  try {
    const report = reapDeadSessions({ root: projectRoot });
    const stale = new Set();
    for (const item of report.surfaced || []) {
      const classifications = Array.isArray(item.classifications) ? item.classifications : [];
      if (classifications.includes('stale_completed') || classifications.includes('stale_review_approved')) {
        if (item.scope) stale.add(normalizeScope(item.scope));
      }
    }
    return stale;
  } catch (_) {
    return null;
  }
}

// Freshness gate (S3 v2 gate a): the continuity entry's mtime must be within a
// 7-day window AND not older than the newest live scope-matching signal.
const CONTINUITY_FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isContinuityFresh(continuity, signals) {
  const mtimeMs = Date.parse(String(continuity.mtime || ''));
  if (!Number.isFinite(mtimeMs)) return false;
  const nowMs = Date.now();
  if (nowMs - mtimeMs > CONTINUITY_FRESHNESS_WINDOW_MS) return false;
  if (signals.newestLiveTimestamp) {
    const newestMs = Date.parse(String(signals.newestLiveTimestamp));
    if (Number.isFinite(newestMs) && mtimeMs < newestMs) return false;
  }
  return true;
}

// Command-validity gate (S3 v2 gate b): the command must be an exact slash
// command (isExactSlashCommand) that parses and resolves in the canonical
// command registry (alias-resolved). Malformed / unregistered / freeform
// commands are rejected.
function isValidSlashCommandForScope(projectRoot, command) {
  try {
    if (!isExactSlashCommand(command)) return false;
    const parsed = parseSlashCommand(command);
    if (!parsed.ok) return false;
    const alias = resolveCommandAlias(projectRoot, parsed.commandId);
    const commandId = alias && alias.isAlias ? alias.resolvedCommand : parsed.commandId;
    return Boolean(loadCanonicalCommand(projectRoot, commandId));
  } catch (_) {
    return false;
  }
}

function buildSkeleton(projectRoot, scopeInfo, opts, judgmentRemaining, exec) {
  const missing = [];

  // Changed files from git status --short (read-only).
  const git = gitChangedFiles(projectRoot, exec);
  if (!git.ok) missing.push('changed_files');

  // Signals (read-only inventory; never closes anything).
  const signals = scanSignals(projectRoot, scopeInfo);

  // Closeout inventory: COMPOSE tools/maintenance/lib/end-session-closeout.js.
  // buildCloseout is read-only (only writeCloseout writes).
  const closeout = buildCloseout(projectRoot, {
    system: scopeInfo.scope_type === 'system',
    client: scopeInfo.scope_type === 'client' ? scopeInfo.scope_value : null,
    scope: scopeInfo.scope_type === 'workstream' ? scopeInfo.scope_value : null
  }, opts.closeoutRunner ? { runner: opts.closeoutRunner } : {});

  const inventoryRecords = Object.values(closeout.artifact_inventory || {}).flat();
  const artifactReceipts = inventoryRecords
    .map((record) => ({ kind: record.kind, path: toPosix(record.path), bytes: record.bytes, mtime: record.mtime }))
    .slice(0, 200);

  // Latest scope-matching handoff target from closeout evidence, falling back
  // to the continuity index. Fail closed when neither names a target.
  const handoffs = (closeout.artifact_inventory && closeout.artifact_inventory.handoffs) || [];
  const sortedHandoffs = [...handoffs].sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
  const continuity = latestContinuityEntry(projectRoot, scopeInfo);
  let handoffPath = sortedHandoffs.length > 0 ? toPosix(sortedHandoffs[0].path) : '';
  if (!handoffPath && continuity && continuity.path) handoffPath = toPosix(continuity.path);
  if (!handoffPath) missing.push('handoff_path');

  // current_state seeded mechanically from the latest scope-matching
  // handoff/continuity artifact; '' + fail closed when none is found.
  let currentState = '';
  if (handoffPath) {
    const seedLine = firstNonEmptyLine(path.join(projectRoot, handoffPath));
    currentState = seedLine
      ? `${seedLine} [seeded from ${handoffPath}]`
      : `[seeded from ${handoffPath}]`;
  }
  if (!currentState) missing.push('current_state');

  // recommended_next_command (S3, plan session-lifecycle-mechanical-repairs):
  //   - live signal candidates are FIRST filtered of reaper-stale scopes
  //     (best-effort, fail-open: on any reaper error the filter is skipped and
  //     behavior is exactly the pre-filter rule) — v3 codewhale C2.
  //   - exactly one distinct surviving candidate wins (unchanged).
  //   - zero candidates: latest scope-matching continuity entry (regression-
  //     green, unchanged).
  //   - MORE than one distinct candidate: the plural-candidate continuity
  //     fallback is GATED (v2 codex Major 2) — the continuity entry's command
  //     is used ONLY IF it passes BOTH gates: (a) FRESHNESS — mtime within a
  //     7-day window AND not older than the newest live scope-matching signal;
  //     (b) COMMAND VALIDITY — exact slash command that resolves in the
  //     canonical command registry (alias-resolved). Any gate failure keeps
  //     fail-closed ('' + missing_required_fields + exit 3) exactly as today.
  //   - the skeleton records the bounded candidate list and the fallback
  //     disposition (used | rejected-stale | rejected-invalid | absent).
  let recommendedNextCommand = '';
  let nextCommandFallbackDisposition = null;
  // v3 (codewhale C2): reaper-stale scopes excluded from candidacy BEFORE
  // counting (best-effort, fail-open); the disposition records how many
  // candidate commands were removed by the exclusion.
  const reaperStaleScopes = staleReaperScopes(projectRoot); // Set|null; null = filter skipped
  let candidateScopes = signals.nextCommandCandidates;
  let reaperExcludedCount = 0;
  if (reaperStaleScopes && reaperStaleScopes.size > 0) {
    candidateScopes = signals.nextCommandCandidates.filter((c) => {
      const stale = reaperStaleScopes.has(normalizeScope(c.scope));
      if (stale) reaperExcludedCount++;
      return !stale;
    });
  }
  const distinctSignalCommands = [...new Set(candidateScopes.map((c) => c.command))];
  if (distinctSignalCommands.length === 1) {
    recommendedNextCommand = distinctSignalCommands[0];
  } else if (distinctSignalCommands.length === 0 && continuity && typeof continuity.recommended_next_command === 'string' && continuity.recommended_next_command.trim()) {
    recommendedNextCommand = continuity.recommended_next_command.trim();
    nextCommandFallbackDisposition = 'used';
  } else if (distinctSignalCommands.length > 1 && continuity && typeof continuity.recommended_next_command === 'string' && continuity.recommended_next_command.trim()) {
    const continuityCmd = continuity.recommended_next_command.trim();
    if (!isContinuityFresh(continuity, signals)) {
      nextCommandFallbackDisposition = 'rejected-stale';
    } else if (!isValidSlashCommandForScope(projectRoot, continuityCmd)) {
      nextCommandFallbackDisposition = 'rejected-invalid';
    } else {
      recommendedNextCommand = continuityCmd;
      nextCommandFallbackDisposition = 'used';
    }
  } else if (distinctSignalCommands.length > 1) {
    nextCommandFallbackDisposition = 'absent';
  }
  if (!recommendedNextCommand) missing.push('recommended_next_command');

  const skeleton = {
    schema: 'NextSessionSkeleton/1.0',
    scope: scopeInfo.scope_key,
    current_state: currentState,
    changed_files: redactChangedFiles(git.files),
    live_signals: signals.live,
    closed_signals: signals.closed,
    blockers: closeout.blockers || [],
    recommended_next_command: recommendedNextCommand,
    // S3: bounded candidate list + fallback disposition so the model lane sees
    // what was ambiguous and why.
    signal_command_candidates: distinctSignalCommands.slice(0, 20),
    recommended_next_command_fallback: nextCommandFallbackDisposition,
    reaper_stale_excluded_candidates: reaperExcludedCount,
    handoff_path: handoffPath,
    artifact_receipts: artifactReceipts,
    missing_required_fields: missing,
    needs_model_lane: judgmentRemaining.length > 0 || missing.length > 0
  };
  return skeleton;
}

function normalizeSkipToken(token) {
  return slugify(String(token || '').replace(/^\//, ''));
}

function stepMatchesSkip(coverageEntry, skipSet) {
  if (skipSet.size === 0) return false;
  const aliases = [String(coverageEntry.step_id), slugify(String(coverageEntry.label).replace(/^\//, ''))];
  return aliases.some((alias) => skipSet.has(alias));
}

function runShutdownInner(projectRoot, opts) {
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

  // 2. Resolve scope — ambiguous scope fails loud; the runner never infers.
  const scopeInfo = resolveScopeSelector(opts);
  if (!scopeInfo) {
    return {
      exitCode: 2,
      packet: null,
      stdout: '',
      stderr: 'Ambiguous scope: exactly one of --system, --client CODE, or --scope <workstream> is required. The deterministic runner never infers scope.'
    };
  }

  const exec = opts.spawn || spawnSync;
  const commands = { ...defaultCommands(projectRoot), ...(opts.commands || {}) };
  const skipSet = new Set((opts.skip || []).map(normalizeSkipToken).filter(Boolean));

  // judgment_remaining: computed at runtime from the LIVE parsed spec steps
  // filtered by SPEC_COVERAGE lane=judgment. Never hardcoded.
  const judgmentRemaining = specSteps
    .map((specStep, index) => ({ specStep, coverage: SPEC_COVERAGE[index] }))
    .filter(({ coverage }) => coverage.lane === 'judgment')
    .map(({ specStep, coverage }) => ({
      step_id: coverage.step_id,
      label: specStep.label,
      judgment_summary: coverage.judgment_summary || null
    }));

  // 3. Execute spec steps in order.
  let halted = false;
  let haltReason = null;
  const stepRecords = [];
  for (let i = 0; i < specSteps.length; i += 1) {
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
      record.status = 'judgment_remaining';
      record.detail = coverage.judgment_summary || 'judgment work remains';
      stepRecords.push(record);
      continue;
    }
    // Mechanical lane.
    if (coverage.step_id === 'preamble' || coverage.step_id === 'unrecognized-1') {
      record.status = 'complete';
      record.detail = `scope resolved mechanically via ${scopeInfo.selector} (${scopeInfo.scope_key})`;
      stepRecords.push(record);
      continue;
    }
    if (coverage.step_id === 'postamble') {
      record.status = 'complete';
      record.detail = 'SessionClosePacket/1.0 emitted as the shutdown report';
      stepRecords.push(record);
      continue;
    }
    const argv = commands[coverage.step_id];
    if (!Array.isArray(argv) || argv.length === 0) {
      record.status = 'warn';
      record.detail = `no command mapping for mechanical step ${coverage.step_id}`;
      stepRecords.push(record);
      continue;
    }
    if (dryRun) {
      record.status = 'skipped(dry-run)';
      record.detail = `would run: ${argv.join(' ')}`;
      stepRecords.push(record);
      continue;
    }
    const result = exec(argv[0], argv.slice(1), { cwd: projectRoot, encoding: 'utf8' });
    // Composed tools' exit codes surface verbatim as a packet field —
    // never flattened into an error string.
    record.exit_code = result.status === undefined ? null : result.status;
    if (result.error) record.detail = `spawn error: ${result.error.message}`;
    if (coverage.step_id === '4b') {
      if (record.exit_code === 0) {
        record.status = 'complete';
      } else {
        record.status = 'warn';
        record.detail = record.detail || `disk-quota-guard exited nonzero; warn-only fail-safe, shutdown continues`;
      }
    } else if (record.exit_code === 0) {
      record.status = 'complete';
    } else if (coverage.step_id === '5' || coverage.step_id === '0') {
      record.status = 'failed';
      record.detail = record.detail || (coverage.step_id === '5'
        ? 'sync-private-remotes exited nonzero; divergence requires human resolution; never force-push'
        : 'watcher-stop exited nonzero (identity-refused or unreapable watchers); halting so closeout never races live daemons');
      halted = true;
      haltReason = {
        step_id: coverage.step_id,
        label: coverage.label,
        exit_code: record.exit_code,
        reason: record.detail
      };
    } else {
      record.status = 'warn';
    }
    stepRecords.push(record);
  }

  // 4. NextSessionSkeleton/1.0 from repo evidence (read-only).
  const skeleton = buildSkeleton(projectRoot, scopeInfo, opts, judgmentRemaining, exec);

  // 4b. Per-scope SessionBoundary/1.0 emission from the skeleton (leak L2).
  // Fail-closed (gate G2): no marker without handoff_path + next command.
  const sessionInfo = resolveSessionId(projectRoot);
  const boundaryEmission = emitBoundaryMarker(projectRoot, scopeInfo, skeleton, sessionInfo, opts);

  // 5. SessionClosePacket/1.0.
  const generatedAt = new Date().toISOString();
  const packet = {
    schema: 'SessionClosePacket/1.0',
    scope: scopeInfo.scope_key,
    session_id: sessionInfo.session_id,
    session_id_source: sessionInfo.session_id_source,
    generated_at: generatedAt,
    spec: { path: SPEC_REL_PATH, step_count: specSteps.length },
    drift: { ok: true },
    steps: stepRecords,
    judgment_remaining: judgmentRemaining,
    next_session_skeleton: skeleton,
    boundary_emission: boundaryEmission,
    halted,
    halt_reason: haltReason,
    judgment_remaining_source: 'computed-from-spec-coverage'
  };

  const stamp = generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const packetRel = toPosix(path.join(PACKETS_REL_DIR, `${stamp}__${slugify(scopeInfo.scope_key)}.json`));
  if (opts.write !== false) {
    const packetAbs = path.join(projectRoot, packetRel);
    fs.mkdirSync(path.dirname(packetAbs), { recursive: true });
    fs.writeFileSync(packetAbs, JSON.stringify(packet, null, 2) + '\n');
  }

  // Blocked boundary emission is a failed close, not a quiet warning: a
  // /shutdown that could not ground a handoff + next command must not report
  // success (exit 3), or the closeout gate it exists to enforce is advisory.
  const exitCode = halted ? 1 : (boundaryEmission.blocking ? 3 : 0);
  let stdout;
  if (opts.json !== false) {
    stdout = JSON.stringify({
      ok: exitCode === 0,
      packet_path: opts.write !== false ? packetRel : null,
      packet
    }, null, 2);
  } else {
    const lines = [];
    lines.push(`Session close packet: ${opts.write !== false ? packetRel : '(not written; --no-write)'}`);
    lines.push(`Steps: ${stepRecords.map((step) => `${step.step_id}=${step.status}`).join(', ')}`);
    lines.push(`Judgment remaining: ${judgmentRemaining.map((entry) => entry.label).join(', ') || 'none'}`);
    if (boundaryEmission.written) {
      lines.push(`Boundary marker: ${boundaryEmission.marker_path}`);
    } else if (boundaryEmission.blocking) {
      lines.push(`BLOCKING — boundary marker NOT emitted: ${boundaryEmission.reason}`);
    }
    if (halted) lines.push(`HALTED at step ${haltReason.step_id}: ${haltReason.reason}`);
    stdout = lines.join('\n');
  }
  const stderrParts = [];
  if (halted) stderrParts.push(`Shutdown cascade halted at step ${haltReason.step_id} (exit ${haltReason.exit_code}): ${haltReason.reason}`);
  if (boundaryEmission.blocking) {
    stderrParts.push(`FAIL-CLOSED: SessionBoundary/1.0 not emitted for scope "${boundaryEmission.scope}" — ${boundaryEmission.reason} Resolve via the model lane (/next-session) so a handoff + recommended next command exist, then re-run /shutdown.`);
  }
  return {
    exitCode,
    packet,
    packetPath: opts.write !== false ? packetRel : null,
    stdout,
    stderr: stderrParts.join('\n')
  };
}

/**
 * Composable API. /cross-session may import this directly or invoke the
 * stable CLI (node tools/commands/mythos-command-runner.cjs --command
 * "/shutdown --system"); both hold.
 *
 * opts: { scope, system, client, skip: [], dryRun, exec, json, write,
 *         commands, spawn, closeoutRunner }
 *  - commands: internal test seam — a map of step_id -> argv array that
 *    overrides the default mechanical commands.
 *  - spawn / closeoutRunner: spawnSync-compatible injection points for tests.
 *
 * Returns { exitCode, packet, packetPath, stdout, stderr }.
 */
function runShutdown(projectRoot, opts = {}) {
  try {
    return runShutdownInner(projectRoot, opts);
  } catch (err) {
    return {
      exitCode: 6,
      packet: null,
      stdout: '',
      stderr: `Unexpected /shutdown runner exception: ${err && err.message ? err.message : String(err)}\nfall back to YAML spec inference path (${SPEC_REL_PATH}; /shutdown --manual).`
    };
  }
}

function parseShutdownArgs(argsText) {
  const tokens = splitArgs(argsText);
  const opts = { system: false, client: '', scope: '', skip: [], dryRun: false, manual: false, unknown: [] };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--system') opts.system = true;
    else if (token === '--client') opts.client = tokens[++i] || '';
    else if (token === '--scope') opts.scope = tokens[++i] || '';
    else if (token === '--skip') opts.skip.push(tokens[++i] || '');
    else if (token === '--dry-run') opts.dryRun = true;
    else if (token === '--manual') opts.manual = true;
    else opts.unknown.push(token);
  }
  return opts;
}

// Runner-handler wrapper: (projectRoot, argsText, options) -> {exitCode, stdout, stderr}.
function shutdown(projectRoot, argsText, options = {}) {
  const args = parseShutdownArgs(argsText);
  if (args.manual) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Manual bypass requested: the deterministic runner was not used. Follow the YAML spec inference path at ${SPEC_REL_PATH} (bypass protocol for /shutdown --manual).`
    };
  }
  return runShutdown(projectRoot, {
    system: args.system,
    client: args.client,
    scope: args.scope,
    skip: args.skip,
    dryRun: args.dryRun,
    json: options.json,
    write: options.write,
    commands: options.commands,
    spawn: options.spawn,
    closeoutRunner: options.closeoutRunner
  });
}

module.exports = {
  SPEC_COVERAGE,
  SPEC_REL_PATH,
  SKELETON_REQUIRED_FIELDS,
  FORBIDDEN_CHANGED_FILE_FAMILIES,
  redactChangedFiles,
  parseShutdownArgs,
  runShutdown,
  shutdown
};
