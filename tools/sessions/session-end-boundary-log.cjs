#!/usr/bin/env node
'use strict';

// SessionEnd hook: append a boundary event to the durable log. Informational
// only. Concept: _dev/concepts/cross-session-substrate-crossing.md
// Does NOT consume any boundary marker — SessionStart on the other side does.
//
// S2 repoint (plan session-boundary-leak-repairs): this writer used to read the
// LEGACY single-file marker (_dev/state/session-boundary-pending.json), which
// the boundary lib already replaced with per-scope markers (the concurrent-
// crossing race is fixed at the lib). It now inventories ALL pending per-scope
// markers via the boundary lib (which also migrates any legacy single-file
// marker in on read), so the log reflects every scope crossing, not one.

const fs = require('fs');
const path = require('path');
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');
const { listPending } = require('./lib/boundary-markers.cjs');

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
}

if (require.main === module) main();

module.exports = { buildLogEntry };
