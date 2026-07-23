'use strict';

/**
 * fire-reflex.cjs — Harness wrapper for hook-path reflex firings.
 *
 * Wires doctrine-reflex.cjs to four of the five firing points as a hook
 * binary (PostToolUse, Stop, bridge-return, worker-return). The three
 * signal-close call sites use the Node-API helper
 * fireReflexFromSignalClose() exported below.
 *
 * Reads CLAUDE_TOOL_INPUT for PostToolUse/Stop-path event context and
 * constructs a typed ReflexEventEnvelope/1.0. Writes the verdict to
 * session-present.json with a harness-signed writer-attestation.
 *
 * On verdict=stall at project/system tier:
 *   - Append stall entry to _dev/state/session-drift-log.json
 *   - Emit stderr marker (operator notification surface)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { runReflex, loadSessionPresent } = require('./doctrine-reflex.cjs');
const { resolveCanonicalRoot } = require('../lib/canonical-root.cjs');

// env-path-hardening s2: repo root was previously taken from the runtime
// working directory, which a stale/foreign launch silently resurrected old
// paths through (mkdir-p never ENOENTs). Now resolves through the ONE
// canonical source. circuit-breaker mode during staged rollout (logs loud on
// invalid root but still proceeds); promoted to 'hard' after s5 clean-pass.
const PROJECT_ROOT = resolveCanonicalRoot({ mode: 'hard' });
const SESSION_PRESENT_PATH = path.resolve(PROJECT_ROOT, '_dev/state/session-present.json');
const DRIFT_LOG_PATH = path.resolve(PROJECT_ROOT, '_dev/state/session-drift-log.json');

// ---------------------------------------------------------------------------
// T5 narrow promotion (mech-rebase-tranche-1) — per-check exit-2 allowlist.
//
// Exit-2 is driven ONLY by individual findings whose check ID is in
// PROMOTED_CHECK_IDS — NEVER by the aggregate reflex verdict. check6 emits
// level 'stall' internally (write_to_forbidden_path); a naive
// `verdict === 'stall' → exit 2` would hard-block check6, violating
// acceptance correction 2. Every non-promoted check stays exit-0 advisory
// regardless of finding level or aggregate verdict.
//
// Observe-only by default: enforcement requires MYTHOS_DOCTRINE_REFLEX_GATE=1
// (the flag flip is operator-only; never set it from agent code).
// Inline degrade (sanctioned for T5 — this is NOT the secret gate):
// MYTHOS_DOCTRINE_REFLEX_BYPASS_JUSTIFICATION="<why>" turns exit-2 into
// exit-0 loud-warn and appends a drift-log entry flagged for async review.
// ---------------------------------------------------------------------------

const PROMOTED_CHECK_IDS = new Set([
  2, // acceptance-grade write has distinct-intelligence review artifact
  5  // external content wrapped in <observed>
]);
const ENFORCE_ENV = 'MYTHOS_DOCTRINE_REFLEX_GATE';
const BYPASS_ENV = 'MYTHOS_DOCTRINE_REFLEX_BYPASS_JUSTIFICATION';

const PROMOTED_NEXT_STEP = {
  2: 'reference the distinct-intelligence review artifact (declared_intent.review_artifact) before the acceptance-grade write',
  5: 'wrap the external content in <observed>...</observed> before dispatch'
};

function isGateEnforcing(env) {
  const raw = String((env || process.env)[ENFORCE_ENV] || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function promotedBlockMessage(promotedFindings) {
  const lines = [
    'BLOCKED_DOCTRINE_REFLEX: promoted reflex check fired (per-check allowlist: 2, 5).'
  ];
  for (const f of promotedFindings) {
    lines.push(`  rule fired: check ${f.check} [${f.code}] — evidence: ${JSON.stringify(f.detail || {})}`);
    lines.push(`  sanctioned next step: ${PROMOTED_NEXT_STEP[f.check] || 'resolve the finding'}`);
  }
  lines.push(
    `  degrade path: re-run with ${BYPASS_ENV}="<justification>" — exits 0 as a loud warn and is logged to the drift ledger flagged for async review.`
  );
  return lines.join('\n');
}

/**
 * Decide the CLI exit code from individual findings. Consults ONLY the
 * per-finding check IDs against PROMOTED_CHECK_IDS — never the aggregate
 * verdict, never the finding level.
 */
function resolveReflexExitCode(findings, opts) {
  const env = (opts && opts.env) || process.env;
  const promoted = (findings || []).filter((f) => f && PROMOTED_CHECK_IDS.has(f.check));
  if (promoted.length === 0) return { exitCode: 0, mode: 'advisory', promoted };
  if (!isGateEnforcing(env)) return { exitCode: 0, mode: 'observe', promoted };
  const justification = String(env[BYPASS_ENV] || '').trim();
  if (justification) {
    return { exitCode: 0, mode: 'bypassed', promoted, bypass_justification: justification };
  }
  return { exitCode: 2, mode: 'enforced', promoted };
}

function buildHarnessId(eventType) {
  return `claude-code:fire-reflex.cjs:${eventType}`;
}

function signAttestation(record, harnessId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${harnessId}:${JSON.stringify(record)}`)
    .digest('hex');
  return {
    writer_harness_id: harnessId,
    signature_alg: 'sha256-harness-concat-v1',
    signature: digest,
    signed_at: new Date().toISOString()
  };
}

function appendDriftEntry(eventType, scopeTier, findings, extra) {
  let log;
  try {
    log = JSON.parse(fs.readFileSync(DRIFT_LOG_PATH, 'utf8'));
  } catch (_) {
    log = {
      schema: 'SessionDriftLog/1.0',
      entries: []
    };
  }
  if (!Array.isArray(log.entries)) log.entries = [];
  log.entries.push({
    id: `drift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event_type: eventType,
    scope_tier: scopeTier,
    status: 'open',
    logged_at: new Date().toISOString(),
    findings: findings || [],
    ...(extra && typeof extra === 'object' ? extra : {})
  });
  try {
    fs.mkdirSync(path.dirname(DRIFT_LOG_PATH), { recursive: true });
    fs.writeFileSync(DRIFT_LOG_PATH, JSON.stringify(log, null, 2) + '\n');
  } catch (err) {
    process.stderr.write(`[fire-reflex] drift-log write failed: ${err.message}\n`);
  }
}

function writeSessionPresentUpdate(eventType, verdict, findings) {
  const prior = loadSessionPresent();
  const harnessId = buildHarnessId(eventType);
  const record = {
    ...prior,
    schema: 'SessionPresent/1.0',
    last_reflex_verdict: verdict,
    last_reflex_event: eventType,
    last_reflex_findings_count: (findings || []).length,
    last_updated_by: harnessId,
    last_updated_at: new Date().toISOString()
  };
  delete record.writer_attestation;
  const attestation = signAttestation(record, harnessId);
  const envelope = { ...record, writer_attestation: attestation };
  try {
    fs.mkdirSync(path.dirname(SESSION_PRESENT_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PRESENT_PATH, JSON.stringify(envelope, null, 2) + '\n');
  } catch (err) {
    process.stderr.write(`[fire-reflex] session-present write failed: ${err.message}\n`);
  }
}

function surfaceOperatorNotification(eventType, verdict, findings) {
  if (verdict !== 'stall') return;
  const msg = [
    '',
    '==============================================================',
    `REFLEX STALL (${eventType}) — doctrine-reflex emitted verdict=stall`,
    `findings=${findings.length}`,
    ...findings.slice(0, 5).map((f) => `  [${f.check}][${f.level}] ${f.code}`),
    '==============================================================',
    ''
  ].join('\n');
  process.stderr.write(msg);
}

function buildEnvelopeFromToolInput(eventType) {
  const raw = process.env.CLAUDE_TOOL_INPUT || '{}';
  let toolInput;
  try {
    toolInput = JSON.parse(raw);
  } catch (_) {
    toolInput = {};
  }
  const writeTarget =
    toolInput.file_path ||
    toolInput.filePath ||
    (toolInput.tool_input && toolInput.tool_input.file_path) ||
    null;
  const observedWriteSet = writeTarget ? [writeTarget] : [];
  const snapshot = loadSessionPresent();
  return {
    event_type: eventType,
    scope_tier: snapshot.scope_tier || 'task',
    declared_intent: {
      workstream_scope: snapshot.workstream_scope || '',
      owned_artifacts: snapshot.owned_artifacts || [],
      forbidden_artifacts: snapshot.forbidden_artifacts || [],
      stated_goal: snapshot.stated_goal || ''
    },
    observed_write_set: observedWriteSet,
    observed_tool_outputs: [],
    session_present_snapshot: snapshot
  };
}

function fireReflex(eventType, envelopeOverride) {
  const envelope = envelopeOverride || buildEnvelopeFromToolInput(eventType);
  const result = runReflex(envelope);
  writeSessionPresentUpdate(eventType, result.verdict, result.findings);
  const tier = envelope.scope_tier;
  if (result.verdict === 'stall' && (tier === 'project' || tier === 'system')) {
    appendDriftEntry(eventType, tier, result.findings);
    surfaceOperatorNotification(eventType, result.verdict, result.findings);
  }
  return result;
}

/**
 * Convenience API for signal-close paths — called from
 * tools/signals/close-signal.js, tools/signals/lib/actor-auto.js,
 * tools/signals/lib/codex-auto.js.
 */
function fireReflexFromSignalClose(signalInfo) {
  const snapshot = loadSessionPresent();
  const envelope = {
    event_type: 'signal-close',
    scope_tier: snapshot.scope_tier || 'task',
    declared_intent: {
      workstream_scope: snapshot.workstream_scope || '',
      owned_artifacts: snapshot.owned_artifacts || [],
      forbidden_artifacts: snapshot.forbidden_artifacts || [],
      stated_goal: 'close_signal'
    },
    observed_write_set: signalInfo && signalInfo.relPath ? [signalInfo.relPath] : [],
    observed_tool_outputs: [
      {
        tool: 'signal-close',
        target: (signalInfo && signalInfo.name) || '',
        verdict: 'closed'
      }
    ],
    session_present_snapshot: snapshot
  };
  return fireReflex('signal-close', envelope);
}

/**
 * Convenience API for bridge-return path — called after codex-bridge
 * response lands. Caller passes prompt body + response summary.
 */
function fireReflexFromBridgeReturn({ promptBody, cardHashExpected, tier }) {
  const snapshot = loadSessionPresent();
  const envelope = {
    event_type: 'bridge-return',
    scope_tier: tier || snapshot.scope_tier || 'task',
    declared_intent: {
      workstream_scope: snapshot.workstream_scope || '',
      owned_artifacts: snapshot.owned_artifacts || [],
      forbidden_artifacts: snapshot.forbidden_artifacts || [],
      stated_goal: 'bridge_return'
    },
    observed_write_set: [],
    observed_tool_outputs: [{ tool: 'codex-bridge', target: 'response', verdict: 'received' }],
    session_present_snapshot: snapshot,
    bridge_prompt_body: promptBody || '',
    card_hash_expected: cardHashExpected || ''
  };
  return fireReflex('bridge-return', envelope);
}

/**
 * Convenience API for worker-return path — called after a Task-tool
 * subagent returns.
 */
function fireReflexFromWorkerReturn({ workerId, writeSet }) {
  const snapshot = loadSessionPresent();
  const envelope = {
    event_type: 'worker-return',
    scope_tier: snapshot.scope_tier || 'task',
    declared_intent: {
      workstream_scope: snapshot.workstream_scope || '',
      owned_artifacts: snapshot.owned_artifacts || [],
      forbidden_artifacts: snapshot.forbidden_artifacts || [],
      stated_goal: 'worker_return'
    },
    observed_write_set: Array.isArray(writeSet) ? writeSet : [],
    observed_tool_outputs: [{ tool: 'Task', target: workerId || 'subagent', verdict: 'returned' }],
    session_present_snapshot: snapshot
  };
  return fireReflex('worker-return', envelope);
}

// ---------------------------------------------------------------------------
// CLI — invoked from hooks. First arg is event_type.
// ---------------------------------------------------------------------------

if (require.main === module) {
  try {
    const eventType = process.argv[2] || 'PostToolUse';
    // Fixture/replay hook: an explicit envelope may be injected (drift-log
    // replay fixtures). Production hook invocations leave this unset and use
    // the CLAUDE_TOOL_INPUT path.
    let envelopeOverride = null;
    if (process.env.MYTHOS_REFLEX_ENVELOPE_JSON) {
      try {
        envelopeOverride = JSON.parse(process.env.MYTHOS_REFLEX_ENVELOPE_JSON);
      } catch (_) {
        envelopeOverride = null;
      }
    }
    const envelope = envelopeOverride || buildEnvelopeFromToolInput(eventType);
    const result = fireReflex(eventType, envelope);
    // Exit code is decided from the per-finding allowlist ONLY (checks 2/5).
    // NEVER from result.verdict — check6 stalls (and all other findings)
    // remain exit-0 advisory; their visibility stays stderr + drift log.
    const decision = resolveReflexExitCode(result.findings);
    if (decision.mode === 'observe') {
      const checks = [...new Set(decision.promoted.map((f) => f.check))].join(',');
      process.stderr.write(
        `[fire-reflex observe-only] WOULD BLOCK (promoted check ${checks}) — set ${ENFORCE_ENV}=1 to enforce.\n` +
          promotedBlockMessage(decision.promoted) + '\n'
      );
    } else if (decision.mode === 'bypassed') {
      process.stderr.write(
        `[fire-reflex] PROMOTED CHECK BYPASSED — exit-2 degraded to loud-warn via ${BYPASS_ENV}; flagged for async review.\n` +
          promotedBlockMessage(decision.promoted) +
          `\n  justification: ${decision.bypass_justification}\n`
      );
      appendDriftEntry(eventType, envelope.scope_tier, decision.promoted, {
        gate: 'doctrine-reflex-promoted-check',
        bypass_justification: decision.bypass_justification,
        review: 'async_pending'
      });
    } else if (decision.exitCode === 2) {
      process.stderr.write(promotedBlockMessage(decision.promoted) + '\n');
    }
    process.exit(decision.exitCode);
  } catch (err) {
    // Fail-open preserved: a broken gate must never brick a session.
    process.stderr.write(`[fire-reflex] ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = {
  fireReflex,
  fireReflexFromSignalClose,
  fireReflexFromBridgeReturn,
  fireReflexFromWorkerReturn,
  buildEnvelopeFromToolInput,
  appendDriftEntry,
  signAttestation,
  resolveReflexExitCode,
  promotedBlockMessage,
  isGateEnforcing,
  PROMOTED_CHECK_IDS,
  ENFORCE_ENV,
  BYPASS_ENV,
  SESSION_PRESENT_PATH,
  DRIFT_LOG_PATH
};
