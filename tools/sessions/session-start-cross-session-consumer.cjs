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
//
// Also (repair R2, 2026-08-18): registers a heartbeat for the current session
// at session open. The dreaming sweep (contextual-sweep.js) and the
// branch-match resolver in contextual-inject.cjs discover sessions via
// _dev/state/active-sessions/<sid>.json heartbeat files; env-less harnesses
// (codewhale) set no CLAUDE_*/MYTHOS_* env, so no heartbeat ever existed and
// the sweep found "no fresh active sessions" — dreams computed but never
// surfaced. Registering a heartbeat here restores the surface without touching
// the _current-id sidecar (which stays authoritative-only per the
// custody-poisoning invariant in new-session.cjs). Advisory-only, fail-open.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { listPending } = require('./lib/boundary-markers.cjs');
const { registerSession } = require('./lib/active-session-registry.js');

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function sessionIdFromPayload(payload) {
  if (payload && (payload.session_id || payload.sessionId)) {
    return String(payload.session_id || payload.sessionId).trim();
  }
  for (const name of ['CLAUDE_SESSION_ID', 'CLAUDE_SESSION', 'MYTHOS_SESSION_ID', 'CODEX_SESSION_ID', 'SM_OS_SESSION_ID']) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8'
    }).trim();
  } catch {
    return null;
  }
}

function registerSessionHeartbeat(sessionId) {
  if (!sessionId) return;
  try {
    registerSession({ sessionId, currentBranch: currentBranch() });
  } catch (_) {
    // Advisory-only: a heartbeat registration failure must never block session start.
  }
}

function main() {
  const payload = readPayload();
  const sessionId = sessionIdFromPayload(payload);
  registerSessionHeartbeat(sessionId);

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
