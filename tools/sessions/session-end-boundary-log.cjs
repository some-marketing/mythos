#!/usr/bin/env node
'use strict';

// SessionEnd hook: append a boundary event to the durable log, THEN run the
// L3 scratch-leak check for the closing session. The boundary-log write is
// informational only and never blocks session end; the leak-check step
// (added under plan reflexive-artifact-durability, L3) is likewise
// never-blocking — see "Leak-check step" below for its capability tier and
// coverage.
// Concept: _dev/concepts/cross-session-substrate-crossing.md
// Does NOT consume any boundary marker — SessionStart on the other side does.
//
// S2 repoint (plan session-boundary-leak-repairs): this writer used to read the
// LEGACY single-file marker (_dev/state/session-boundary-pending.json), which
// the boundary lib already replaced with per-scope markers (the concurrent-
// crossing race is fixed at the lib). It now inventories ALL pending per-scope
// markers via the boundary lib (which also migrates any legacy single-file
// marker in on read), so the log reflects every scope crossing, not one.
//
// Leak-check step (L3, plan reflexive-artifact-durability):
//
// Capability tier: L3 boundary-wired loud-warn — ADVISORY; not BLOCKING
// until a registered hook enforces it. This file invokes the L2 scratch-leak
// validator (tools/verify/scratch-leak-check.cjs — migrated to its final home
// 2026-08-12 under ConveneReceipt, previously staged under tools/scoped/)
// and prints a loud, greppable warning listing every leak, but
// never throws on a leak and never blocks session end on a validator crash.
// Default is loud-warn, never a silent pass: a clean scan prints one quiet
// line with the scanned count so the check's own execution is observable
// (reflexivity — it runs on every crossing, no opt-in). Promoting this to
// fail-closed (actually blocking session end on a leak) is a later,
// separately operator-gated change; this file does not do that.
//
// Ordering: AC3 requires this leak-check to run AFTER the crash-floor/
// auto-commit close hook (hooks/session-lifecycle/session-end-close.cjs), so
// that artifacts session-end-close.cjs creates late (e.g. the crash-floor
// stub marker) are covered by the same close. Within THIS file the leak-check
// call is placed last, after the boundary-log write. But hook ORDER ACROSS
// files is controlled by SessionEnd hook registration order in
// .claude/settings.json (governance-gated; writes require a live
// ConveneReceipt). ORDERING FIXED 2026-08-12 under ConveneReceipt: the
// SessionEnd array now registers session-end-close.cjs FIRST and this file
// SECOND (repo-awareness-closeout.cjs third), so artifacts the crash-floor/
// auto-commit close hook writes during its own run (e.g. the crash-floor
// stub) are on disk before this leak-check scans — the AC3 ordering.
//
// Coverage: SessionEnd hook (this file, every session close) + explicit
// consume-boundary.cjs crossings (tools/sessions/consume-boundary.cjs). As of
// this change, consume-boundary.cjs does NOT require or invoke this file or
// runLeakCheckStep — verified by reading its requires (boundary-markers.cjs,
// resume-packet.cjs, active-session-registry.js only). So a consume-boundary
// crossing gets NO leak-check coverage from this wiring; only SessionEnd
// closes do. runLeakCheckStep is exported specifically so a future change to
// consume-boundary.cjs (not owned here) could call it for the same coverage
// on that path — that wiring does not exist yet.

const fs = require('fs');
const path = require('path');
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');
const { listPending } = require('./lib/boundary-markers.cjs');

// Validator path (final home; migrated 2026-08-12 under ConveneReceipt after
// an initial staging under tools/scoped/ — see git history).
const STAGED_VALIDATOR_PATH = '../verify/scratch-leak-check.cjs';

/**
 * Load the scratch-leak validator module. Exists as its own function so a
 * test can inject a fake validator (via runLeakCheckStep's `validator` opt)
 * without ever exercising this require path.
 */
function loadValidator() {
  // eslint-disable-next-line global-require
  return require(STAGED_VALIDATOR_PATH);
}

/**
 * Run the scratch-leak check for the closing session and report the result
 * loudly. NEVER throws — a validator load/run crash is caught and reported
 * as one loud line, then treated as "nothing to report" (session end must
 * never block on this). NEVER silently passes — a clean scan still prints a
 * quiet single line naming the scanned count.
 *
 * Injection points for tests (do not change production defaults):
 *   opts.root      — override the scan root (production default: the
 *                    resolved canonical project root, or
 *                    process.env.MYTHOS_SCRATCH_LEAK_ROOT if set).
 *   opts.validator  — override the { runScratchLeakCheck } module (production
 *                    default: require(STAGED_VALIDATOR_PATH)).
 *   opts.log/opts.warn — override the output sinks (production default:
 *                    console.log/console.warn) so tests can capture output.
 *
 * Returns the validator's result object, or null if the validator itself
 * failed to load/run (the crash is still reported via opts.warn).
 */
function runLeakCheckStep(opts = {}) {
  const warn = opts.warn || ((...args) => console.warn(...args));
  const log = opts.log || ((...args) => console.log(...args));
  let mod;
  try {
    mod = opts.validator || loadValidator();
  } catch (err) {
    warn(`[scratch-leak-warn] validator failed to load — never blocking session end — ${err}`);
    return null;
  }
  let result;
  try {
    result = mod.runScratchLeakCheck(opts.root ? { root: opts.root } : {});
  } catch (err) {
    warn(`[scratch-leak-warn] validator crashed — never blocking session end — ${err}`);
    return null;
  }
  if (result.ok) {
    log(`[scratch-leak-check] OK — ${result.scanned} durable artifact(s) scanned, 0 leaks.`);
  } else {
    warn(`[scratch-leak-warn] ${result.leaks.length} leak(s) found across ${result.scanned} scanned durable artifact(s):`);
    for (const leak of result.leaks) {
      warn(`[scratch-leak-warn]   ${leak.artifact} [${leak.field_or_line}] -> ${leak.offending_path}`);
    }
  }
  return result;
}

// Build the durable log entry from the per-scope pending surface (read-only).
function buildLogEntry(rootOpts) {
  const pending = listPending(rootOpts);
  return {
    schema: 'SessionBoundaryLog/1.0',
    timestamp: new Date().toISOString(),
    event: 'session_end',
    pending_marker_present: pending.length > 0,
    pending_marker_count: pending.length,
    pending_scopes: pending.map((m) => ({
      scope: m.payload.scope || null,
      recommended_next_command: m.payload.recommended_next_command || null
    }))
  };
}

function main() {
  const opts = { mode: 'hard' };
  const projectRoot = resolveCanonicalRoot(opts);
  const stateDir = path.join(projectRoot, '_dev', 'state');
  const logPath = path.join(stateDir, 'session-boundary-log.jsonl');
  fs.mkdirSync(stateDir, { recursive: true });
  let entry;
  try {
    entry = buildLogEntry(opts);
  } catch (err) {
    // Best-effort logging; never block session end.
    process.stderr.write(`session-end-log: build failed — ${err}\n`);
    return;
  }
  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    process.stderr.write(`session-end-log: append failed — ${err}\n`);
  }

  // Leak-check step runs LAST within this file — see the "Ordering" header
  // note above for why cross-file ordering (relative to session-end-close.cjs)
  // is a reported gap, not something this call can fix.
  runLeakCheckStep({ root: process.env.MYTHOS_SCRATCH_LEAK_ROOT || projectRoot });
}

if (require.main === module) main();

module.exports = { buildLogEntry, runLeakCheckStep, STAGED_VALIDATOR_PATH };
