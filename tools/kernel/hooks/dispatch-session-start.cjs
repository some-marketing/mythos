#!/usr/bin/env node
'use strict';

const { finish, readPayload, runNodeScript } = require('./lib/compat-dispatch.cjs');

// S1c drain surfacing (realtime-inbound-bridge): queued operator Discord
// messages must reach the next live session. Non-destructive — lists live
// discord-intent signals into session context; acking/closing stays with the
// session via tools/signals/drain-discord-intents.cjs --ack. Fail-silent.
function surfaceQueuedDiscordIntents() {
  try {
    const { listDiscordIntents } = require('../../signals/drain-discord-intents.cjs');
    const path = require('path');
    const root = process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..', '..');
    const intents = listDiscordIntents(root);
    if (intents.length === 0) return;
    const lines = [`QUEUED DISCORD MESSAGES (${intents.length} live discord-intent signal(s) — operator DMs the sentinel captured while no session could take them):`];
    for (const info of intents) {
      const ctx = info.signal.context || {};
      lines.push(`  • [${ctx.received_at || info.signal.timestamp}] msg ${ctx.message_id || '?'} (chat ${ctx.chat_id || '?'}): ${String(ctx.raw_message || '').slice(0, 200)}`);
    }
    lines.push(`  Answer the operator, then: node tools/signals/drain-discord-intents.cjs --ack <session-id>`);
    process.stdout.write(lines.join('\n') + '\n');
  } catch {
    /* fail-silent: drain surfacing must never block session start */
  }
}

// Seed the root span at the cascade top (correlation-ID keystone, P1). Roots
// BOTH MYTHOS_TRACE_ID and MYTHOS_SPAN_ID so the first dispatch is a real tree
// edge, not an orphan. Fail-silent — telemetry seeding must never block boot.
function seedCascadeRoot(payload) {
  try {
    const path = require('path');
    const root = process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..', '..');
    const { seedRoot } = require('../../telemetry/dispatches/seed-root-trace.cjs');
    const sessionId = (payload && (payload.session_id || payload.sessionId)) || process.env.CLAUDE_SESSION_ID || null;
    const { rootEnv, alreadySeeded } = seedRoot({ projectRoot: root, sessionId, emitSource: 'session-start' });
    if (!alreadySeeded) {
      // Persist a sourceable env file so the interactive shell / boot scripts can
      // adopt the same root context: `source _dev/state/cascade-trace/root-env.sh`.
      const fs = require('fs');
      const stateDir = path.join(root, '_dev', 'state', 'cascade-trace');
      fs.mkdirSync(stateDir, { recursive: true });
      const lines = Object.entries(rootEnv)
        .filter(([k]) => k.startsWith('MYTHOS_'))
        .map(([k, v]) => `export ${k}='${String(v).replace(/'/g, `'\\''`)}'`);
      fs.writeFileSync(path.join(stateDir, 'root-env.sh'), lines.join('\n') + '\n');
    }
    // C1: persist a PER-SESSION keyed cascade root (session-<id>.json) so the
    // SubagentStop writer — which runs in a fresh process that never adopted
    // this env — can re-read THIS session's root and attribute in-session
    // Agent/Task worker spans to it (flat 2-level tree). Keyed by harness
    // session_id, so it is immune to the global root-env.sh clobber race.
    // Written even when alreadySeeded (rootEnv still carries the live root) —
    // BUT only when the ambient root actually belongs to THIS session. If the
    // hook inherited a different session's seeded env (nested spawn), writing a
    // keyed file under our session_id pointing at another session's root would
    // mis-attribute every worker (codex MAJOR). On mismatch we skip keyed
    // persistence and the in-session path fails open to unknown.
    // Fail-silent; lazy 7-day cleanup on the way in.
    // Strict ownership: when a root was ALREADY seeded into the env, write the
    // keyed record only if that root provably belongs to THIS session. A seeded
    // root with no/!= ownership marker is of unknown ownership — fail open to NO
    // keyed record rather than attribute it (codex MAJOR, re-review).
    const ambientSession = rootEnv.MYTHOS_SESSION_ID;
    const rootBelongsToThisSession = !alreadySeeded ||
      String(ambientSession) === String(sessionId);
    if (sessionId && rootBelongsToThisSession) {
      const { writeSessionTraceRoot, cleanupOldSessionTraces } =
        require('../../telemetry/dispatches/lib/session-trace-store.cjs');
      writeSessionTraceRoot(root, {
        sessionId,
        traceId: rootEnv.MYTHOS_TRACE_ID,
        rootSpanId: rootEnv.MYTHOS_SPAN_ID,
        host: rootEnv.MYTHOS_HOST,
        scope: rootEnv.MYTHOS_WORKSTREAM_SCOPE || null
      });
      cleanupOldSessionTraces(root);
    }
  } catch {
    /* fail-silent: root seeding must never block session start */
  }
}

// Always-on advisory behavioral-contract surface (the highest-leverage
// cross-session lever from _dev/concepts/lesson-enforcement-ladder.md). Reads
// the contract from durable feedback memories, prints a falsifier + temporal
// stamp, persists the surfaced set for the override logger. NEVER blocks.
// Fail-silent — must never block session start.
function emitBehavioralContract(payload) {
  try {
    require('./session-start-contract-emitter.cjs').emit(payload);
  } catch {
    /* fail-silent: contract surface must never block session start */
  }
}

function main() {
  const payload = readPayload();
  require('./session-start-tier-stamp.cjs').main(payload);
  seedCascadeRoot(payload);
  surfaceQueuedDiscordIntents();
  emitBehavioralContract(payload);
  // Disk Quota Monitor warning preflight on session start
  try {
    runNodeScript('tools/hygiene/disk-quota-guard.cjs', ['--check'], payload, { toolName: 'SessionStart' });
  } catch (_) {
    // Disk quota guard is fail-silent; must never block session start
  }

  for (const script of [
    'tools/context/context-budget-report.cjs',
    'tools/context/repo-awareness-init.cjs',
    'tools/sessions/session-start-cross-session-consumer.cjs',
    'tools/memory/build-memory-db.js',
    'tools/memory/contextual-inject.cjs'
  ]) {
    const status = runNodeScript(script, [], payload, { toolName: 'SessionStart' });
    if (status === 2) finish(2);
  }
  finish(0);
}

main();
