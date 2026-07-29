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
  if (pendingMarker && pendingMarker.payload) {
    const packet = buildResumePacket(pendingMarker.payload, {
      ...rootOpts,
      consumedPath
    });
    lines.push(packet.text.trimEnd());
  }
  return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
}

function main() {
  const result = runConsumeBoundary(process.argv[2], { mode: 'hard' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (require.main === module) main();

module.exports = { runConsumeBoundary };
