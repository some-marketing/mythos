#!/usr/bin/env node
'use strict';

// CLI: consume (archive) the pending boundary marker for ONE scope. Other
// scopes' markers are left untouched, so concurrent crossings survive.
//
// Usage:
//   node tools/sessions/consume-boundary.cjs <scope>
//   e.g. node tools/sessions/consume-boundary.cjs client:{CLIENT_CODE}
//
// Run by /new-session (or the operator) when committing to resume a scope.
//
// Exit codes:
//   0 — exact match consumed; resume packet (if any) on stdout.
//   2 — usage error: no scope argument given. Pending scopes (if any)
//       listed on stderr.
//   3 — SCOPE_NOT_FOUND: the requested scope matched no pending marker,
//       exactly or fuzzily. This is a fail-loud miss, NOT a success — it
//       used to return exit 0 with a plain "no pending marker" message,
//       which let a typo'd/wrong scope look like a clean no-op (verified
//       live incident 2026-07-09, operator passed `system-fable-lite`
//       against pending `system-*` scopes with no exact match). stderr
//       carries `SCOPE_NOT_FOUND: ...` plus ranked candidates with exact
//       consume commands; stdout is empty. resolveScope() never consumes
//       on a fuzzy match — only an exact match ever archives a marker.

const { consume, resolveScope, listPending } = require('./lib/boundary-markers.cjs');
const { buildResumePacket } = require('./lib/resume-packet.cjs');
const registry = require('./lib/active-session-registry.js');

// Resolve the CURRENT session id for a crossing. Precedence mirrors the
// custody gate: env → _current-id sidecar → (best-effort) newest live
// registered session. Never fabricates an id: if nothing resolves, returns
// null and the caller skips custody adoption (surfacing the gap).
function resolveCurrentSessionId() {
  const env = process.env;
  const fromEnv = env.MYTHOS_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_SESSION_ID || '';
  if (fromEnv) return { session_id: fromEnv, source: 'env' };

  const sidecar = registry.getCurrentSessionId();
  if (sidecar) return { session_id: sidecar, source: 'current-id-sidecar' };

  try {
    const active = registry.listActive({});
    if (active.length === 1) {
      return { session_id: active[0].session_id, source: 'sole-active-session' };
    }
    if (active.length > 1) {
      const newest = active
        .slice()
        .sort((a, b) => String(b.last_heartbeat || '').localeCompare(String(a.last_heartbeat || '')))[0];
      if (newest && newest.session_id) {
        return { session_id: newest.session_id, source: 'newest-active-session' };
      }
    }
  } catch (_) { /* best-effort; fall through to null */ }

  return { session_id: null, source: 'unresolved' };
}

function runConsumeBoundary(scope, rootOpts = { mode: 'hard' }) {
  const lines = [];
  if (!scope) {
    const pending = listPending(rootOpts);
    const stderr = ['usage: consume-boundary.cjs <scope>'];
    if (pending.length) {
      stderr.push('pending scopes:');
      for (const m of pending) stderr.push(`  ${m.payload.scope}`);
    }
    return { exitCode: 2, stdout: '', stderr: `${stderr.join('\n')}\n` };
  }

  const resolved = resolveScope(scope, rootOpts);
  if (resolved.status === 'not_found') {
    const candidates = resolved.candidates;
    const stderrLines = [`SCOPE_NOT_FOUND: no pending marker for scope: ${scope}`];
    if (candidates.length) {
      stderrLines.push('candidates (ranked, none consumed):');
      for (const c of candidates) {
        stderrLines.push(`  ${c.scope} — ${c.score_reason} — ${c.consume_command}`);
      }
    } else {
      stderrLines.push('no pending scopes');
    }
    return {
      exitCode: 3,
      code: 'SCOPE_NOT_FOUND',
      requested_scope: scope,
      candidates,
      stdout: '',
      stderr: `${stderrLines.join('\n')}\n`,
    };
  }

  const pendingMarker = resolved.marker;
  const consumedPath = consume(scope, rootOpts);
  lines.push(`consumed boundary marker for ${scope} -> ${consumedPath}`);

  // Custody adoption on crossing: the marker's session_id is the session this
  // crossing takes over. Merge its write-log paths into the current session's
  // ledger so clean-house sees them as OWN and the custody gate classifies
  // them own — the new session inherits custody of the session it crossed.
  const priorSessionId = pendingMarker && pendingMarker.payload
    ? pendingMarker.payload.session_id
    : null;
  let adoption = null;
  if (priorSessionId) {
    const current = resolveCurrentSessionId();
    if (current && current.session_id) {
      try {
        // Ground the current-session sidecar so subsequent hooks (write-ledger,
        // custody gate, auto-commit) resolve the same crossing session.
        registry.setCurrentSessionId(current.session_id);
      } catch (_) { /* best-effort; adoption still proceeds */ }
      adoption = registry.adoptSessionCustody({
        fromSessionId: priorSessionId,
        toSessionId: current.session_id
      });
      if (adoption && adoption.adopted && adoption.adopted_count > 0) {
        lines.push(
          `adopted custody from session ${priorSessionId}: ` +
          `${adoption.adopted_count} path(s) merged into ${current.session_id}`
        );
      } else {
        lines.push(
          `custody adoption skipped for prior session ${priorSessionId}: ` +
          `${(adoption && adoption.reason) || 'no paths to adopt'} (current session: ${current.session_id})`
        );
      }
    } else {
      lines.push(
        `CUSTODY ADOPTION GAP: marker for ${scope} references prior session ${priorSessionId} ` +
        `but no current session id resolved (${current ? current.source : 'unknown'}). ` +
        `Adopt manually via a session that registers _current-id first.`
      );
    }
  }

  if (pendingMarker && pendingMarker.payload) {
    const packet = buildResumePacket(pendingMarker.payload, {
      ...rootOpts,
      consumedPath
    });
    lines.push(packet.text.trimEnd());
  }
  return {
    exitCode: 0,
    stdout: `${lines.join('\n')}\n`,
    stderr: '',
    adoption,
    prior_session_id: priorSessionId
  };
}

function main() {
  const result = runConsumeBoundary(process.argv[2], { mode: 'hard' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (require.main === module) main();

module.exports = { runConsumeBoundary };
