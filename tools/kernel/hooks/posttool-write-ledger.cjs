#!/usr/bin/env node
'use strict';

// S1: PostToolUse session write-ledger
// Wire into dispatch-posttool.cjs: on Write/Edit/MultiEdit/Bash-mutation,
// append the resolved written path to _dev/state/active-sessions/{session_id}/write_log.json.
//
// B2: Bash capture. dispatch-posttool.cjs invokes this hook for the Bash tool
// too, but only ever on the PostToolUse event — a failed/errored tool
// invocation routes through the entirely separate dispatch-posttoolfailure.cjs
// dispatcher, which never calls this module. That routing IS the success
// gate: this hook performs no independent exit-code or success check of its
// own, because by the time it runs it has already been filtered to the
// success path. A Bash command that ran and returned a non-zero shell exit
// status still reaches here (the tool invocation itself succeeded); only a
// hard tool-level failure is excluded.
//
// Bash capture is BEST-EFFORT ADVISORY tier, not enforcement: it calls
// lib/bash-write-extract.cjs, a pure static scanner over the command string,
// to guess which files a command wrote. Static analysis cannot see every
// write (arbitrary scripts, inline interpreters, command substitution, etc.),
// so a command that writes files with no detectable candidate produces a
// single {opaque:true, tool:'Bash', reasons:[...]} sentinel entry instead of
// silence — this is what lets a reader distinguish "this Bash call touched
// no tracked files" from "this Bash call may have written files this ledger
// could not see." Direct scan (scratch-leak-check) remains the enumeration
// source of truth for what actually changed on disk; this ledger is a
// best-effort index, never a substitute for scanning the working tree.

const fs = require('fs');
const path = require('path');

function getProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '../../..');
}

function getSessionId(payload) {
  if (payload && payload.session_id) return payload.session_id;
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  if (process.env.CLAUDE_SESSION) return process.env.CLAUDE_SESSION;
  // Identity parity with pretool-git-custody-gate.cjs: fall back to the
  // active-session registry `_current-id` sidecar before the day bucket. The
  // codewhale harness registers a session but sets no CLAUDE_* env, so without
  // this its writes land in day-* and its own custody set stays empty.
  try {
    // Resolve relative to this hook (not CLAUDE_PROJECT_DIR), so the registry
    // lookup is stable under test fixtures that redirect the project dir.
    const registry = require(path.join(__dirname, '..', '..', 'sessions', 'lib', 'active-session-registry.js'));
    const id = registry.getCurrentSessionId();
    if (id) return id;
  } catch (_) { /* sidecar absent or registry unreadable — fall through */ }
  return 'day-' + new Date().toISOString().slice(0, 10);
}

function resolveWrittenPaths(payload) {
  const tool = (payload && payload.tool_name) || '';
  const input = payload && payload.tool_input;
  if (!input) return [];

  const paths = [];
  
  // Track top-level file_path (universal for Write/Edit/MultiEdit)
  if (input.file_path) {
    paths.push(input.file_path);
  }

  // Also support nested edits in MultiEdit payloads for complete coverage
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (edit.file_path) paths.push(edit.file_path);
    }
  }

  const projectRoot = getProjectRoot();
  return paths.map(p => path.isAbsolute(p) ? path.relative(projectRoot, p) : p)
    .filter(p => p && !p.startsWith('..')); // Only track repo-relative paths
}

// Shared append plumbing: load the ledger, dedupe path-bearing entries
// against what's already there, push any sentinel/cap-note entries verbatim
// (they carry no 'path' key so the path-dedupe never touches them), and
// atomic temp+rename the file back out. Every path-bearing shape appended
// through here stays whatever its caller built it as — this function never
// adds or removes fields from an entry.
function appendLedgerEntries(sessionId, entries, extras) {
  const pathEntries = entries || [];
  const sentinel = extras && extras.sentinel;
  const capNote = extras && extras.capNote;
  if (pathEntries.length === 0 && !sentinel && !capNote) return;

  const projectRoot = getProjectRoot();
  const sessionDir = path.join(projectRoot, '_dev', 'state', 'active-sessions', sessionId);
  const logFile = path.join(sessionDir, 'write_log.json');
  const tempFile = logFile + '.tmp.' + process.pid + '.' + Date.now();

  try {
    fs.mkdirSync(sessionDir, { recursive: true });

    let data = { paths: [] };
    if (fs.existsSync(logFile)) {
      try {
        data = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      } catch (_) {}
    }

    if (!Array.isArray(data.paths)) data.paths = [];

    const existing = new Set(data.paths.map(e => (typeof e === 'string' ? e : e.path)).filter(Boolean));

    for (const entry of pathEntries) {
      if (entry.path && existing.has(entry.path)) continue;
      data.paths.push(entry);
      if (entry.path) existing.add(entry.path);
    }

    if (sentinel) data.paths.push(sentinel);
    if (capNote) data.paths.push(capNote);

    // updated_at is read by tools/sessions/lib/active-session-registry.js
    // (ledgerDirLastActivityMs) to decide whether a session dir is still
    // live. The caller-side guard above (pathEntries.length === 0 &&
    // !sentinel && !capNote) already screens out invocations with no
    // activity at all, so every invocation that reaches this point had
    // *some* recognized activity — refresh and persist even when every
    // path entry in this call turned out to be a dedup hit against what's
    // already on disk, so a session that keeps re-touching the same file
    // still reads as live instead of going stale and risking premature
    // orphan-sweep.
    data.updated_at = new Date().toISOString();
    // atomic temp+validate+rename
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tempFile, logFile);
  } catch (err) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) {}
    // fail-open
  }
}

function appendToWriteLog(sessionId, repoRelPaths, toolName) {
  if (!repoRelPaths || repoRelPaths.length === 0) return;
  const now = new Date().toISOString();
  const entries = repoRelPaths.map(p => ({ path: p, at: now, tool: toolName }));
  appendLedgerEntries(sessionId, entries);
}

// Repo-relative filter shared with resolveWrittenPaths: only track paths
// inside the project root, mirroring the existing path.relative +
// startsWith('..') guard.
function toRepoRelative(absOrRelPath, projectRoot) {
  const rel = path.isAbsolute(absOrRelPath) ? path.relative(projectRoot, absOrRelPath) : absOrRelPath;
  return (rel && !rel.startsWith('..')) ? rel : null;
}

const BASH_CANDIDATE_CAP = 32;

// Best-effort Bash write capture. Wrapped end-to-end in try/catch so a crash
// anywhere in extraction or ledger append never blocks or delays the tool
// result — see the header note on why no invocation ever reaches here on a
// failed tool call.
//
// Shared by both 'Bash' and 'run_shell_command': dispatch-posttool.cjs
// routes both tool names into this hook (they are the same shell-execution
// surface under two harness identities), so both branch through this one
// path rather than duplicating the extraction/cap/sentinel logic. `toolName`
// is recorded verbatim into every entry/sentinel/cap-note this call produces
// so provenance stays honest — a run_shell_command invocation is never
// mislabeled as 'Bash' in the ledger.
function appendBashWrites(sessionId, payload, toolName) {
  try {
    const input = payload && payload.tool_input;
    const command = input && typeof input.command === 'string' ? input.command : '';
    if (!command) return;

    const cwd = (payload && typeof payload.cwd === 'string' && payload.cwd) ? payload.cwd : process.cwd();
    const { extractBashWrites } = require('./lib/bash-write-extract.cjs');
    const result = extractBashWrites(command, { cwd });

    const projectRoot = getProjectRoot();
    const now = new Date().toISOString();

    const repoRelCandidates = [];
    for (const c of (result.candidates || [])) {
      const rel = toRepoRelative(c.path, projectRoot);
      if (!rel) continue;
      repoRelCandidates.push({ path: rel, mechanism: c.mechanism, confidence: c.confidence });
    }

    const overCap = repoRelCandidates.length > BASH_CANDIDATE_CAP;
    const bounded = overCap ? repoRelCandidates.slice(0, BASH_CANDIDATE_CAP) : repoRelCandidates;

    const entries = bounded.map(c => ({
      path: c.path,
      at: now,
      tool: toolName,
      mechanism: c.mechanism,
      confidence: c.confidence
    }));

    const reasons = [];
    for (const o of (result.opaque || [])) {
      if (o && o.reason && !reasons.includes(o.reason)) reasons.push(o.reason);
    }
    if (result.truncated && !reasons.includes('over-budget')) reasons.push('over-budget');

    const sentinel = reasons.length > 0
      ? { opaque: true, at: now, tool: toolName, reasons }
      : null;

    const capNote = overCap
      ? { truncated_entries: true, at: now, tool: toolName, dropped: repoRelCandidates.length - BASH_CANDIDATE_CAP }
      : null;

    appendLedgerEntries(sessionId, entries, { sentinel, capNote });
  } catch (_) {
    // fail-open: extraction/append must never block or delay the tool result
  }
}

// Tool names dispatch-posttool.cjs routes into this hook as shell-execution
// invocations — both share the appendBashWrites path with honest per-name
// provenance (see the comment on appendBashWrites).
const SHELL_TOOL_NAMES = new Set(['Bash', 'run_shell_command']);

function main(passedPayload) {
  const payload = passedPayload || {};
  const sessionId = getSessionId(payload);
  const tool = payload.tool_name || 'unknown';

  if (SHELL_TOOL_NAMES.has(tool)) {
    appendBashWrites(sessionId, payload, tool);
    return;
  }

  const paths = resolveWrittenPaths(payload);
  appendToWriteLog(sessionId, paths, tool);
}

if (require.main === module) {
  try {
    let payloadStr = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => payloadStr += chunk);
    process.stdin.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(payloadStr); } catch (_) {}
      // main() runs inside this async callback, outside the outer try's
      // stack — an exception here (e.g. a non-string file_path reaching
      // path.isAbsolute) would otherwise be an uncaught async exception
      // that crashes the process instead of failing open like every other
      // error path in this hook.
      try { main(payload); } catch (_) {}
      process.exit(0);
    });
  } catch (_) {
    process.exit(0);
  }
} else {
  module.exports = { main };
}
