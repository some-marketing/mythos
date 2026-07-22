#!/usr/bin/env node
'use strict';

// CLI: write a per-scope session-boundary marker atomically.
// Used by /cross-session so the skill no longer hand-rolls the atomic write.
//
// Usage:
//   node tools/sessions/write-boundary.cjs <payload.json>     # path to a JSON file
//   echo '<json>' | node tools/sessions/write-boundary.cjs -  # JSON on stdin
//
// Payload must include: schema:"SessionBoundary/1.0", scope, handoff_path,
// recommended_next_command. Optional: summary, written_by, written_at.

const fs = require('fs');
const { writeMarker } = require('./lib/boundary-markers.cjs');

function readInput() {
  const arg = process.argv[2];
  if (!arg) throw new Error('usage: write-boundary.cjs <payload.json | ->');
  if (arg === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(arg, 'utf8');
}

function main() {
  let payload;
  try { payload = JSON.parse(readInput()); }
  catch (e) { process.stderr.write(`write-boundary: invalid JSON — ${e.message}\n`); process.exit(2); }
  try {
    const p = writeMarker(payload, { mode: 'hard' });
    process.stdout.write(`boundary marker written: ${p}\n`);
  } catch (e) {
    process.stderr.write(`write-boundary: ${e.message}\n`);
    process.exit(2);
  }
}

main();
