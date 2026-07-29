#!/usr/bin/env node
'use strict';

// SessionStart hook: surface ALL pending session-boundary markers.
// Concept: _dev/concepts/cross-session-substrate-crossing.md
//
// Per-scope markers live in _dev/state/session-boundary/pending/<scope>.json
// (see tools/sessions/lib/boundary-markers.cjs). Multiple crossings can be
// pending at once (one per client scope). This hook does NOT auto-consume —
// auto-consuming a single shared marker was the old bug that made it impossible
// to resume a specific client scope and silently dropped concurrent crossings.
//
// Instead it LISTS every resumable scope so the operator can pick one. The
// chosen scope is consumed explicitly via:
//   node tools/sessions/consume-boundary.cjs <scope>
// (run by /new-session, or by the operator, when committing to that scope).
// A legacy single-file marker is migrated into the per-scope dir on read.

const { listPending } = require('./lib/boundary-markers.cjs');

function main() {
  const pending = listPending({ mode: 'hard' });
  if (pending.length === 0) return;

  const lines = [];
  if (pending.length === 1) {
    lines.push('PENDING SESSION-BOUNDARY CROSSING (1 resumable scope):');
  } else {
    lines.push(`PENDING SESSION-BOUNDARY CROSSINGS (${pending.length} resumable scopes — pick one):`);
  }
  for (const m of pending) {
    const p = m.payload;
    lines.push(`  • scope: ${p.scope}`);
    lines.push(`      handoff: ${p.handoff_path}`);
    lines.push(`      next:    ${p.recommended_next_command || '/whats-next'}`);
    if (p.summary) lines.push(`      summary: ${p.summary}`);
    lines.push(`      consume: node tools/sessions/consume-boundary.cjs ${p.scope}`);
  }
  lines.push('  (markers are non-destructive — none consumed until you run the consume command for the scope you resume.)');
  process.stdout.write(lines.join('\n') + '\n');
}

main();
