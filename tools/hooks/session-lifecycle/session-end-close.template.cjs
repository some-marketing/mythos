#!/usr/bin/env node
'use strict';

// TEMPLATE — SessionEnd hook pattern: a mechanical crash-floor marker.
//
// This is a worked example, not a wired-in mythos hook. Session-lifecycle
// commands (a full shutdown ritual, a whats-next daily brief, etc.) are
// reserved vocabulary in mythos (see docs/LEXICON.md's "Reserved Vocabulary"
// section) and have not shipped publicly — so the three private helpers this
// pattern originally depended on (an atomic boundary-marker writer, a
// forbidden-path redaction filter shared with a shutdown command, and a
// read-only closeout-view builder) are stubbed inline below with minimal,
// self-contained equivalents. Replace the stubs with your own guild's real
// implementations once you have session-lifecycle commands of your own; the
// control flow (auto-commit, check-for-a-fresh-marker, write-an-enriched-stub)
// is the reusable part.
//
// The pattern: no session should die silently mid-work with no durable trace.
// 1. Run your own auto-commit tool, if you have one (same one your session-open
//    ritual would use).
// 2. If no per-scope boundary marker was touched in the last 6h, write an
//    ENRICHED stub marker so the next session always has a thread to pick up.
//    The stub carries a crash floor's read-only view of the repo — changed-file
//    count, a live-signal count, last commit, and a missing-fields note — so a
//    crash-path resume converges to roughly the same effective state a clean
//    session-close would have left. This is the floor, not the ceiling — a
//    full closeout ritual's debrief + handoff remain the real thing. Fails
//    silent; never blocks exit.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Stubs standing in for your own guild's session-lifecycle libraries ---
// Replace these three with real implementations once you have them.

// Minimal atomic-enough marker writer: writes JSON to
// _dev/state/session-boundary/pending/<scope>.json. A real implementation
// should validate the SessionBoundary/1.0 schema and write atomically
// (write-to-temp + rename) rather than a direct writeFileSync.
function writeMarker(marker, { root }) {
  const dir = path.join(root, '_dev', 'state', 'session-boundary', 'pending');
  fs.mkdirSync(dir, { recursive: true });
  const markerPath = path.join(dir, `${marker.scope}.json`);
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
  return markerPath;
}

// Minimal redaction: drops any changed-file line whose path looks like it
// might carry secrets or private state. A real implementation should share
// its forbidden-path list with whatever gate scans commits for the same
// classes (client codes, private hostnames, credentials, etc.).
function redactChangedFiles(statusLines) {
  const forbidden = /\.env|secret|credential|\.key$|token/i;
  return statusLines.filter((line) => !forbidden.test(line));
}

// Minimal closeout view: a real implementation would read your live-signal
// surface and readiness state. This stub always reports zero signals, which
// is a safe (if uninformative) default — better than throwing.
function buildCloseout() {
  return { signals: [] };
}

const STUB_SCOPE = 'system-unclosed-session';
const STANDING_HANDOFF = '_dev/reports/analysis/next-session-handoff.md';
const FRESH_WINDOW_MS = 6 * 3600 * 1000;

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

// A per-scope pending marker touched within the fresh window means a clean
// crossing already happened; the crash floor stands down.
function hasFreshMarker(root, now = Date.now()) {
  const pendingDir = path.join(root, '_dev', 'state', 'session-boundary', 'pending');
  return safe(() => fs.readdirSync(pendingDir).some((f) => {
    if (!f.endsWith('.json') || f.startsWith('.')) return false;
    return fs.statSync(path.join(pendingDir, f)).mtimeMs > (now - FRESH_WINDOW_MS);
  }), false);
}

// Build the enriched crash-floor marker (read-only). Injectable git/closeout
// runners keep it testable; production uses the real git + verifier.
function buildStubMarker(root, opts = {}) {
  const sid = String(opts.sessionId || 'unknown').slice(0, 8);
  const gitRunner = opts.gitRunner || ((args) => execSync(`git ${args}`, { cwd: root, timeout: 8000 }).toString().trim());
  const lastCommit = safe(() => gitRunner('log --oneline -1'), 'n/a');

  // Changed files, redacted through the same forbidden-family filter your
  // real session-close ritual would use, so the crash marker never leaks
  // memory/secret/client paths.
  const statusRaw = safe(() => gitRunner('status --short'), '');
  const statusLines = String(statusRaw || '').split('\n').filter(Boolean);
  const changedFiles = redactChangedFiles(statusLines).slice(0, 40);

  // Live signals + readiness view via the shared closeout builder (read-only;
  // only writeCloseout writes). Fail-safe to an empty view.
  const closeout = safe(() => buildCloseout(root, { system: true }, opts.closeoutRunner ? { runner: opts.closeoutRunner } : {}), null);
  const liveSignalCount = closeout && Array.isArray(closeout.signals) ? closeout.signals.length : 0;

  const missingFields = [];
  if (!fs.existsSync(path.join(root, STANDING_HANDOFF))) {
    missingFields.push('handoff_path (standing handoff file is missing — reconstruct from git log since the last commit)');
  }

  return {
    schema: 'SessionBoundary/1.0',
    scope: STUB_SCOPE,
    handoff_path: STANDING_HANDOFF,
    recommended_next_command: '<your daily-brief command>',
    summary: `MECHANICAL STUB (session-end crash floor): session ${sid} ended without a fresh boundary marker or a full session-close ritual. Last commit at exit: ${lastCommit}. Changed files at exit: ${statusLines.length}. Live signals: ${liveSignalCount}.${missingFields.length ? ' MISSING: ' + missingFields.join('; ') + '.' : ''} The standing handoff may be stale for this session's work — check git log since the handoff date.`,
    // Additive enrichment fields (gate G6 — additive only).
    crash_floor: true,
    session_id: opts.sessionId || null,
    last_commit: lastCommit,
    changed_file_count: statusLines.length,
    changed_files: changedFiles,
    live_signal_count: liveSignalCount,
    missing_fields: missingFields,
    written_by: `session-end-close.cjs (mechanical stub, session ${sid})`,
    written_at: new Date().toISOString()
  };
}

// The crash floor itself: auto-commit, then write the enriched stub iff nothing
// fresh exists. Returns a structured result for tests; never throws.
function runCrashFloor(root, opts = {}) {
  if (!opts.skipAutoCommit && opts.autoCommitCommand) {
    // Plug in your own guild's auto-commit tool here, if you have one, e.g.
    // opts.autoCommitCommand = 'node tools/hygiene/auto-commit.js --auto --foreground'
    safe(() => execSync(opts.autoCommitCommand, { cwd: root, timeout: 45000, stdio: 'ignore' }));
  }
  if (!opts.force && hasFreshMarker(root, opts.now)) {
    return { wrote: false, reason: 'fresh_marker_present' };
  }
  const marker = buildStubMarker(root, opts);
  const markerPath = safe(() => writeMarker(marker, { root }), null);
  return { wrote: Boolean(markerPath), marker, marker_path: markerPath };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no stdin payload */ }
  safe(() => runCrashFloor(root, { sessionId: input.session_id }));
}

if (require.main === module) main();

module.exports = { buildStubMarker, runCrashFloor, hasFreshMarker, STUB_SCOPE };
