#!/usr/bin/env node
'use strict';

const { finish, readPayload } = require('./lib/compat-dispatch.cjs');

function main() {
  const payload = readPayload();
  require('../../transcripts/snapshot-current-session.cjs').snapshotCurrentSession(payload);

  // Autonomic Disk Quota Monitor cache sweeps & log rotation on session stop
  try {
    const { runNodeScript } = require('./lib/compat-dispatch.cjs');
    runNodeScript('tools/hygiene/disk-quota-guard.cjs', ['--apply'], payload, { toolName: 'SessionStop' });
  } catch (_) {
    // Disk quota guard is fail-silent; must never block session stop
  }

  // tier-s2d: closeout-evidence gate (quality-process tier add, REPORT-ONLY
  // while the rule mode is report-only — logs deficits to the soak ledger and
  // never traps the session; exit-2 engages only after an operator mode flip).
  let closeout = null;
  try {
    closeout = require('./stop-closeout-evidence-gate.cjs').main(payload);
  } catch {
    closeout = null; // fail-open: a broken gate must never trap the session
  }
  if (closeout && closeout.status === 2) {
    if (closeout.message) process.stderr.write(closeout.message + '\n');
    finish(2);
  }
  finish(0);
}

main();
