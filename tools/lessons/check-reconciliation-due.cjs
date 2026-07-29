#!/usr/bin/env node
'use strict';

/**
 * check-reconciliation-due.cjs — standalone mechanical driver for the
 * lessons-reconciliation lane.
 *
 * PURPOSE
 *   The reconciliation signal was previously emitted ONLY inside the Codex
 *   auto-run closeout (tools/signals/lib/codex-auto.js), so it could never
 *   fire when runs bypassed that path — and a filename/timestamp contract
 *   drift meant it never fired at all (0 reconciliation artifacts ever,
 *   diagnosed 2026-06-10). This tool makes due-checking and signal emission
 *   independently invocable: by launchd, by end-session closeout, or by hand.
 *
 *   Mechanical tier per process-tier doctrine: this script detects and
 *   packages; it performs NO reconciliation judgment. The signal it emits
 *   routes to the /reconcile-lessons command (REVIEW_ONLY) for an LLM actor.
 *
 * USAGE
 *   node tools/lessons/check-reconciliation-due.cjs            # status only
 *   node tools/lessons/check-reconciliation-due.cjs --emit     # emit signal if due
 *   node tools/lessons/check-reconciliation-due.cjs --json     # machine output
 *
 * IDEMPOTENT: --emit skips (exit 0) when a live lessons-reconciliation signal
 * already exists. Exit codes: 0 ok (due or not), 1 unexpected error.
 *
 * Stdlib + in-repo libs only.
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const {
  getLessonsReconciliationStatus,
  emitLessonsReconciliationSignal,
  lessonsReconciliationCommand,
  LESSONS_RECONCILIATION_SCOPE
} = require('../signals/lib/codex-auto');
const { scanLiveHandoffSignals } = require('../signals/lib/pipeline-loop');

function liveReconciliationSignals(projectRoot) {
  // scanLiveHandoffSignals takes the SIGNALS DIRECTORY, not the project root.
  const signalDir = path.join(projectRoot, '_dev', 'reports', 'signals');
  const live = scanLiveHandoffSignals(signalDir) || [];
  return live.filter((entry) => {
    const sig = entry.signal || entry;
    return (sig.signal_scope || sig.scope) === LESSONS_RECONCILIATION_SCOPE;
  });
}

function main() {
  const args = process.argv.slice(2);
  const emit = args.includes('--emit');
  const json = args.includes('--json');
  // --supersede: close any live same-scope signal and emit a fresh one (use
  // after semantics change so a stale recommended command is replaced).
  const supersede = args.includes('--supersede');

  const status = getLessonsReconciliationStatus(PROJECT_ROOT, new Date().toISOString(), {});
  const live = liveReconciliationSignals(PROJECT_ROOT);
  const result = {
    schema: 'LessonsReconciliationCheck/1.0',
    checked_at: new Date().toISOString(),
    due: status.due,
    reasons: status.reasons,
    notes_since_last_reconciliation: status.notesSinceLastReconciliation,
    uncovered_dates: status.uncoveredDates,
    recommended_next_command: lessonsReconciliationCommand(status),
    lessons_files: status.lessonsFiles.map((f) => path.relative(PROJECT_ROOT, f)),
    live_signal_already_present: live.length > 0,
    emitted_signal: '',
    skipped_reason: ''
  };

  if (emit && status.due) {
    const emitted = emitLessonsReconciliationSignal(PROJECT_ROOT, status, {
      supersede,
      summarySuffix: 'Emitted by the standalone mechanical checker (tools/lessons/check-reconciliation-due.cjs).'
    });
    result.emitted_signal = emitted.emitted ? path.relative(PROJECT_ROOT, emitted.signalPath) : '';
    result.skipped_reason = emitted.skippedReason;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const lines = [
      `due: ${result.due} (${result.reasons.join(', ') || 'no trigger'})`,
      `notes since last reconciliation: ${result.notes_since_last_reconciliation}`,
      `live signal already present: ${result.live_signal_already_present}`
    ];
    if (result.emitted_signal) lines.push(`emitted: ${result.emitted_signal}`);
    else if (emit && result.due) lines.push(`emit skipped: ${result.skipped_reason || 'live signal already present'}`);
    else if (emit) lines.push('emit skipped: not due');
    process.stdout.write(lines.join('\n') + '\n');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`check-reconciliation-due failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { liveReconciliationSignals };
