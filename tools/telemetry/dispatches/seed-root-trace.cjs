#!/usr/bin/env node
'use strict';

/**
 * seed-root-trace.cjs — Seed the root span at the cascade top (P1 keystone).
 *
 * Seeds BOTH MYTHOS_TRACE_ID and MYTHOS_SPAN_ID (trace-only seeding leaves every
 * child's parent_span_id null — NOW catch). Writes one root span row and prints
 * shell `export` statements so a coordinator boot / SessionStart shell can adopt
 * the context with: `eval "$(node seed-root-trace.cjs --export-shell)"`.
 *
 * Physical-equivalence contract: with --from-signal <path>, the root trace_id is
 * the parent signal's lineage_root_session_id, so the span joins straight back
 * to the signal surface (no synced copy).
 *
 * Idempotent: if a real trace context is already in the environment, it is
 * re-exported unchanged and NO duplicate root span is written.
 *
 * Usage:
 *   node seed-root-trace.cjs [--from-signal <path>] [--session-id <id>]
 *                            [--scope <scope>] [--export-shell] [--json]
 */

const fs = require('fs');
const path = require('path');
const { buildRootTraceEnv } = require('./lib/trace-context.cjs');
const { emitSpan } = require('./lib/emit-span.cjs');

function parseArgs(argv) {
  const out = { fromSignal: null, sessionId: null, scope: null, exportShell: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from-signal') out.fromSignal = argv[++i];
    else if (a === '--session-id') out.sessionId = argv[++i];
    else if (a === '--scope') out.scope = argv[++i];
    else if (a === '--export-shell') out.exportShell = true;
    else if (a === '--json') out.json = true;
  }
  return out;
}

function readSignalLineage(signalPath) {
  // Returns { lineageRootSessionId, sessionId, scope } from a coordination
  // signal, honoring the upward-escalation-channel field names. Reads only —
  // P1 never mutates the signal surface.
  try {
    const raw = fs.readFileSync(signalPath, 'utf8');
    const sig = JSON.parse(raw);
    return {
      lineageRootSessionId: sig.lineage_root_session_id
        || sig.produced_by_session_id
        || null,
      sessionId: sig.produced_by_session_id || sig.session_id || null,
      scope: sig.scope || sig.signal_scope || null
    };
  } catch (err) {
    process.stderr.write(`[seed-root-trace] could not read signal ${signalPath}: ${err.message}\n`);
    return { lineageRootSessionId: null, sessionId: null, scope: null };
  }
}

function shellExport(env) {
  // Emit only the MYTHOS_* keys (drop the __already_seeded marker) as safe,
  // single-quoted export statements.
  return Object.entries(env)
    .filter(([k]) => k.startsWith('MYTHOS_'))
    .map(([k, v]) => `export ${k}='${String(v).replace(/'/g, `'\\''`)}'`)
    .join('\n');
}

/**
 * seedRoot — core seeding logic, reusable from the SessionStart hook.
 * Returns { rootEnv, alreadySeeded, span }. Mutates process.env so subsequent
 * emitSpan calls (and child scripts spawned by the same process) inherit the
 * seeded context. Writes the root span exactly once (skips when already seeded).
 */
function seedRoot(opts = {}) {
  const projectRoot = opts.projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let lineageRootSessionId = opts.lineageRootSessionId || null;
  let sessionId = opts.sessionId || null;
  let scope = opts.scope || null;
  if (opts.fromSignal) {
    const fromSig = readSignalLineage(opts.fromSignal);
    lineageRootSessionId = lineageRootSessionId || fromSig.lineageRootSessionId;
    sessionId = sessionId || fromSig.sessionId;
    scope = scope || fromSig.scope;
  }
  sessionId = sessionId || process.env.CLAUDE_SESSION_ID || null;

  const rootEnv = buildRootTraceEnv({
    lineageRootSessionId,
    sessionId,
    scope,
    executionMode: 'managed'
  });
  const alreadySeeded = rootEnv.__already_seeded === true;
  delete rootEnv.__already_seeded;

  // Apply to this process so emitSpan picks up the seeded context.
  for (const [k, v] of Object.entries(rootEnv)) {
    if (v !== '' && v != null) process.env[k] = String(v);
  }

  let span = null;
  if (!alreadySeeded) {
    span = emitSpan(projectRoot, {
      actor_role: 'coordinator',
      subagent_type: 'cascade-root',
      routing_decision: 'do-self',
      status: 'ok',
      actor_reason: scope ? `root seed for scope ${scope}` : 'cascade root seed',
      emit_source: opts.emitSource || 'seed-root-trace'
    });
  }

  return { rootEnv, alreadySeeded, span };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rootEnv, alreadySeeded, span } = seedRoot({
    fromSignal: args.fromSignal,
    sessionId: args.sessionId,
    scope: args.scope
  });

  if (args.exportShell) {
    process.stdout.write(shellExport(rootEnv) + '\n');
  } else if (args.json) {
    process.stdout.write(JSON.stringify({
      already_seeded: alreadySeeded,
      trace_id: rootEnv.MYTHOS_TRACE_ID,
      span_id: rootEnv.MYTHOS_SPAN_ID,
      lineage_root_session_id: rootEnv.MYTHOS_LINEAGE_ROOT_SESSION_ID || null,
      root_span_written: Boolean(span)
    }, null, 2) + '\n');
  } else {
    process.stdout.write(
      `[seed-root-trace] trace_id=${rootEnv.MYTHOS_TRACE_ID} span_id=${rootEnv.MYTHOS_SPAN_ID}`
      + (alreadySeeded ? ' (already seeded — no new root span)' : ' (root span written)')
      + '\n'
    );
  }
}

if (require.main === module) {
  main();
  process.exit(0);
}

module.exports = { seedRoot, readSignalLineage, shellExport };
