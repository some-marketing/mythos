#!/usr/bin/env node
'use strict';

const { finish, readPayload } = require('./lib/compat-dispatch.cjs');

function main(opts = {}) {
  const finishHook = opts.finish || finish;
  const writeError = opts.writeError || ((message) => process.stderr.write(message));
  try {
    const payload = opts.payload || readPayload();

    // Snapshot helper is advisory. A failure here must never skip the
    // downstream disk-quota sweep or the closeout-evidence gate — each
    // advisory helper is isolated in its own fail-open block so one broken
    // helper cannot silently disable every gate that runs after it.
    try {
      (opts.snapshotCurrentSession || require('../../transcripts/snapshot-current-session.cjs').snapshotCurrentSession)(payload);
    } catch (err) {
      // fail-open: a broken snapshot helper must never block session stop
      // or skip the gates below
      writeError(`[stop-dispatch] snapshot helper failed: ${err && err.message ? err.message : 'unexpected failure'}\n`);
    }

    // Autonomic Disk Quota Monitor cache sweeps & log rotation on session stop
    try {
      const runNodeScript = opts.runNodeScript || require('./lib/compat-dispatch.cjs').runNodeScript;
      runNodeScript('tools/hygiene/disk-quota-guard.cjs', ['--apply'], payload, { toolName: 'SessionStop' });
    } catch (_) {
      // Disk quota guard is fail-silent; must never block session stop
    }

    // tier-s2d: closeout-evidence gate (quality-process tier add, REPORT-ONLY
    // while the rule mode is report-only — logs deficits to the soak ledger and
    // never traps the session; exit-2 engages only after an operator mode flip).
    let closeout = null;
    try {
      closeout = (opts.closeoutGate || require('./stop-closeout-evidence-gate.cjs').main)(payload);
    } catch {
      closeout = null; // fail-open: a broken gate must never trap the session
    }
    if (closeout && closeout.status === 2) {
      if (closeout.message) process.stderr.write(closeout.message + '\n');
      finishHook(2);
      return 2;
    }
    finishHook(0);
    return 0;
  } catch (err) {
    // Stop reporting is advisory unless a closeout gate explicitly returns 2.
    // A broken lifecycle helper must not cause a generic hook failure.
    writeError(`[stop-dispatch] ${err && err.message ? err.message : 'unexpected hook failure'}\n`);
    finishHook(0);
    return 0;
  }
}

if (require.main === module) main();

module.exports = { main };
