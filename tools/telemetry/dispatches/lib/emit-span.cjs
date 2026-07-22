'use strict';

/**
 * emit-span.cjs — The agent-agnostic span writer (correlation-ID keystone, P1).
 *
 * This is the SHARED SHELL-PROCESS-BOUNDARY instrumentation point. Every spawn
 * boundary (actor-auto, codex-auto, dispatch-bridge, follow-signal, launcher)
 * calls into here to write ONE span row to dispatches.jsonl for the child it is
 * about to spawn — because external children (codex/gemini/opencode CLIs) do
 * not run our SubagentStop hook and cannot emit their own span. This is why the
 * keystone lives at the shell boundary, not in Claude's `.claude/settings.json`
 * hook (OMEGA: that path misses Gemini/Pi/Hermes and the in-session Agent/Task
 * path — a declared, named coverage gap, never silent. See README.md).
 *
 * Constitutional invariant: this surface is a PASSIVE SENSOR, never a regulator.
 * Emission is fail-open — a write failure logs to stderr and returns; it never
 * throws into, and never blocks, a dispatch.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getTraceContext, buildRootTraceEnv } = require('./trace-context.cjs');
const { appendLineLocked } = require('./append-lock.cjs');

const ROTATION_THRESHOLD = 50 * 1024 * 1024; // 50MB — mirrors subagent-telemetry-writer

// SCHEMA/VERSION dimension (cascade-schema-version-dimension). A monotonic
// integer stamped on every span so coverage can distinguish a row written
// BEFORE a field existed (legacy) from a current-version row whose writer
// failed to stamp it (a real gap). Bump on each schema change; record what each
// version added in FIELD_ADDED_VERSION (single source of truth for coverage).
//   v1 = pre-harness (mind fields only)
//   v2 = harness + harness_witness_state (c6-mind-coverage-repair)
//   v3 = trigger_class + trigger_witness_state (cascade-trigger-dimension)
// Rows with NO span_schema_version field predate versioning => treated as v1.
const SPAN_SCHEMA_VERSION = 3;
const FIELD_ADDED_VERSION = Object.freeze({
  harness: 2,
  harness_witness_state: 2,
  trigger_class: 3,
  trigger_witness_state: 3
});

function logFileFor(projectRoot) {
  return path.join(projectRoot, '_dev/reports/telemetry/dispatches.jsonl');
}

function rotateLogIfNecessary(logFile) {
  try {
    if (!fs.existsSync(logFile)) return;
    const stats = fs.statSync(logFile);
    if (stats.size >= ROTATION_THRESHOLD) {
      const date = new Date().toISOString().split('T')[0];
      const rotatedPath = logFile.replace(/dispatches\.jsonl$/, `dispatches.${date}.jsonl`);
      fs.renameSync(logFile, rotatedPath);
    }
  } catch (err) {
    process.stderr.write(`[emit-span] rotation failed: ${err.message}\n`);
  }
}

/**
 * deriveModelTier — best-effort process-tier classification of a model string.
 * Used by the never-branched / heavy-work-at-low-tier detectors in P4. Returns
 * null when the model is unknown so a detector can refuse to fire on no data.
 */
function deriveModelTier(model) {
  const m = String(model || '').toLowerCase();
  if (!m) return null;
  if (/fable|opus|gpt-5|gpt5|o[134]|gemini-2\.5-pro|gemini-1\.5-pro|sonnet-4|claude-4|claude-3-?opus/.test(m)) return 'frontier';
  if (/haiku|mini|flash|small|qwen|llama|mistral|gemma|phi|gpt-4o-mini/.test(m)) return 'small';
  return null;
}

/**
 * workClassInferred — deterministic, computed-at-read work classification.
 * OMEGA default rule: `mechanical` iff tokens==0 && tool_uses>0, else `inference`.
 * Detectors trust ONLY this computed field, never any `work_class_declared`
 * (failure mode "work_class gaming").
 */
function workClassInferred({ tokens_in, tokens_out, total_tokens, tool_uses }) {
  const inTok = Number(tokens_in) || 0;
  const outTok = Number(tokens_out) || 0;
  const tot = (Number(total_tokens) || 0) || (inTok + outTok);
  const tools = Number(tool_uses) || 0;
  if (tot === 0 && tools > 0) return 'mechanical';
  if (tot > 0) return 'inference';
  return null; // insufficient data — do not assert a class
}

/**
 * buildSpan — assemble a fully-shaped span envelope (the locked schema).
 * Merges the ambient trace context with caller-supplied span fields. Caller
 * fields win over ambient defaults. correlation_id is always pinned to trace_id.
 */
function buildSpan(fields = {}) {
  const trace = getTraceContext();
  const merged = { ...trace, ...fields };
  // correlation_id is the alias of trace_id — never let a caller desync it.
  merged.correlation_id = merged.trace_id;

  const span = {
    timestamp: fields.timestamp || new Date().toISOString(),

    // Schema/version dimension — monotonic; lets coverage tell legacy rows
    // (no/older version) from current-version writer gaps (cascade-schema-version-dimension).
    span_schema_version: SPAN_SCHEMA_VERSION,

    // Identity & lineage (the keystone)
    trace_id: merged.trace_id,
    correlation_id: merged.correlation_id,
    span_id: merged.span_id || null,
    parent_span_id: merged.parent_span_id || null,
    child_span_ids: Array.isArray(fields.child_span_ids) ? fields.child_span_ids : [],
    layer_depth: typeof merged.layer_depth === 'number' ? merged.layer_depth : 0,
    scope_identity: merged.scope_identity || null,
    step_id: merged.step_id || null,
    session_id: merged.session_id || null,
    lineage_root_session_id: merged.lineage_root_session_id || null,

    // Mind & host (allocation map)
    model: fields.model || null,
    model_tier: fields.model_tier || deriveModelTier(fields.model) || null,
    // Mind attribution provenance (C6.2). These persist the honest witnessed-vs-
    // sentinel distinction for the native Claude Agent/Task SubagentStop path:
    //  - mind_class: the kind of mind ('claude' for an in-session parallel context)
    //  - mind_relation: how it relates to the coordinator ('parallel-context' = a
    //    same/coordinator-model subagent the Stop hook cannot independently verify)
    //  - model_verified: false ONLY for the sentinel; true (default) means the
    //    `model` field — when present — was witnessed (e.g. an Agent model override)
    // Defaults (null/true) keep every existing/non-sentinel row unaffected: a row
    // that never sets these stays { mind_class:null, mind_relation:null,
    // model_verified:true }, identical-in-meaning to today's rows.
    mind_class: fields.mind_class != null ? fields.mind_class : null,
    mind_relation: fields.mind_relation != null ? fields.mind_relation : null,
    model_verified: fields.model_verified != null ? fields.model_verified : true,
    // Harness attribution provenance (c6-mind-coverage-repair). The execution
    // RUNTIME that held the tools/permissions/hooks — a third axis distinct from
    // `model` (the mind that generated tokens) and `emit_source` (the boundary
    // that wrote the row). A single mind runs under many harnesses (N:M), and a
    // tool-dispatch failure lives in the harness, not the mind.
    //  - harness: the runtime id (claude-code-cli, codex-cli, gemini-cli,
    //    opencode, opencode-local, launchd, cowork, remote-ssh)
    //  - harness_witness_state: the witness_state ENUM —
    //    witnessed | inferred | sentinel | structurally_unwitnessable | legacy_absent.
    //    NOT a boolean: a writer may witness its own harness even when it cannot
    //    witness the model (the subagent Stop hook is the prototype). Defaults
    //    (null/null) keep every existing/non-harness row unaffected.
    harness: fields.harness != null ? fields.harness : null,
    harness_witness_state: fields.harness_witness_state != null ? fields.harness_witness_state : null,
    // Trigger / autonomy dimension (cascade-trigger-dimension). What ORIGINATED
    // this work: human | autonomous | scheduler | watcher | unknown. The
    // blast-radius signal for runaway autonomous runs. DECLARED only — via
    // fields.trigger_class or the MYTHOS_TRIGGER_CLASS env an entry point sets.
    // NEVER inferred from emit_source (that names the writer, not the origin) —
    // inference would fabricate. Honest null/unknown default until an entry point
    // declares; trigger_witness_state is 'witnessed' iff explicitly declared.
    trigger_class: fields.trigger_class != null
      ? fields.trigger_class
      : (process.env.MYTHOS_TRIGGER_CLASS || null),
    trigger_witness_state: fields.trigger_witness_state != null
      ? fields.trigger_witness_state
      : ((fields.trigger_class != null || process.env.MYTHOS_TRIGGER_CLASS) ? 'witnessed' : null),
    host: merged.host || os.hostname() || null,
    actor_role: fields.actor_role || null,
    subagent_type: fields.subagent_type || 'unknown',
    actor_reason: fields.actor_reason || null,

    // Compute economics — raw objective metrics only
    tokens_in: fields.tokens_in != null ? fields.tokens_in : null,
    tokens_out: fields.tokens_out != null ? fields.tokens_out : null,
    total_tokens: fields.total_tokens != null ? fields.total_tokens : null,
    cost: fields.cost != null ? fields.cost : null,
    duration_ms: fields.duration_ms != null ? fields.duration_ms : null,
    tool_uses: fields.tool_uses != null ? fields.tool_uses : null,
    work_class_inferred: workClassInferred(fields),
    // declared MAY be recorded as provenance but NO detector is permitted to
    // trust it (codex). Only present when the caller explicitly supplied it.
    ...(fields.work_class_declared ? { work_class_declared: fields.work_class_declared } : {}),

    // Provenance & governance inputs
    frameworks_referenced: Array.isArray(fields.frameworks_referenced) ? fields.frameworks_referenced : [],
    frameworks_adopted: Array.isArray(fields.frameworks_adopted) ? fields.frameworks_adopted : [],
    routing_decision: fields.routing_decision || null,
    correction_events: Array.isArray(fields.correction_events) ? fields.correction_events : [],
    reopen_events: Array.isArray(fields.reopen_events) ? fields.reopen_events : [],
    escalations_raised: Array.isArray(fields.escalations_raised) ? fields.escalations_raised : [],
    escalations_received: Array.isArray(fields.escalations_received) ? fields.escalations_received : [],
    status: fields.status || null,

    // Emission provenance — which boundary wrote this row (coverage accounting)
    emit_source: fields.emit_source || null,
    command_execution_mode: merged.command_execution_mode || null
  };

  return span;
}

/**
 * emitSpan — write one span row. Fail-open: never throws, never blocks.
 * Returns the written span on success, or null on failure.
 */
function emitSpan(projectRoot, fields = {}) {
  try {
    const root = projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const logFile = logFileFor(root);
    const span = buildSpan(fields);
    rotateLogIfNecessary(logFile);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    // Append under a best-effort lock (P2 store-robustness: serialize concurrent
    // boundary writers). appendLineLocked is itself fail-open — it appends even
    // if the lock cannot be taken — so the passive-sensor invariant holds.
    appendLineLocked(logFile, JSON.stringify(span) + '\n');
    return span;
  } catch (err) {
    process.stderr.write(`[emit-span] failed to record span (fail-open): ${err.message}\n`);
    return null;
  }
}

/**
 * emitChildSpan — convenience wrapper for a shell boundary that has already
 * built the child env via buildNextTraceEnv(). Maps the MYTHOS_* env shape onto
 * span identity fields, so the row's lineage reflects the CHILD it is spawning
 * (not the dispatching parent's ambient context).
 */
function emitChildSpan(projectRoot, childEnv = {}, fields = {}) {
  const parsedDepth = childEnv.MYTHOS_LAYER_DEPTH != null
    ? parseInt(childEnv.MYTHOS_LAYER_DEPTH, 10)
    : undefined;
  const traceFields = {
    trace_id: childEnv.MYTHOS_TRACE_ID || undefined,
    span_id: childEnv.MYTHOS_SPAN_ID || null,
    parent_span_id: childEnv.MYTHOS_PARENT_SPAN_ID || null,
    scope_identity: childEnv.MYTHOS_WORKSTREAM_SCOPE || null,
    step_id: childEnv.MYTHOS_STEP_ID || null,
    session_id: childEnv.MYTHOS_SESSION_ID || null,
    lineage_root_session_id: childEnv.MYTHOS_LINEAGE_ROOT_SESSION_ID || null,
    host: childEnv.MYTHOS_HOST || null,
    // Guard NaN (parseInt of a non-numeric env) — NaN serializes to null and
    // would silently drop the depth; omit instead so buildSpan defaults to 0.
    layer_depth: Number.isFinite(parsedDepth) ? parsedDepth : undefined,
    command_execution_mode: childEnv.MYTHOS_COMMAND_EXECUTION_MODE || null
  };
  // Drop undefined so buildSpan falls back to ambient/default where appropriate.
  Object.keys(traceFields).forEach((k) => traceFields[k] === undefined && delete traceFields[k]);
  return emitSpan(projectRoot, { ...traceFields, ...fields });
}

/**
 * ensureRootTraceEnv — idempotent boundary auto-seed (codex review fix).
 *
 * The SessionStart hook seeds the hook process, but a managed spawn boundary
 * (actor-auto/codex-auto/dispatch-bridge/follow-signal) may still start in a
 * shell that never adopted that context. Calling this before buildNextTraceEnv()
 * guarantees a real root span exists, so the first child is a linked edge — not
 * an orphan with parent_span_id null. Honors the physical-equivalence contract:
 * pass the parent signal's lineage_root_session_id and the root trace_id becomes
 * that value. Fully fail-open — never throws into a dispatch.
 *
 * Returns { seeded, env }: seeded=true when a NEW root was written, false when
 * the environment was already rooted (no duplicate row).
 */
function ensureRootTraceEnv(projectRoot, opts = {}) {
  try {
    const current = getTraceContext();
    if (current.trace_id !== 'unknown' && current.span_id) {
      return { seeded: false, env: null };
    }
    const rootEnv = buildRootTraceEnv({
      lineageRootSessionId: opts.lineageRootSessionId || null,
      sessionId: opts.sessionId || null,
      scope: opts.scope || null,
      executionMode: opts.executionMode || 'managed'
    });
    delete rootEnv.__already_seeded;
    for (const [k, v] of Object.entries(rootEnv)) {
      if (v !== '' && v != null) process.env[k] = String(v);
    }
    emitSpan(projectRoot, {
      actor_role: 'coordinator',
      subagent_type: 'cascade-root',
      routing_decision: 'do-self',
      status: 'ok',
      actor_reason: opts.scope ? `root seed for scope ${opts.scope}` : 'cascade root seed (boundary auto-seed)',
      emit_source: opts.emitSource || 'boundary-auto-seed'
    });
    return { seeded: true, env: rootEnv };
  } catch (err) {
    process.stderr.write(`[ensure-root-trace] fail-open: ${err.message}\n`);
    return { seeded: false, env: null };
  }
}

module.exports = {
  emitSpan,
  emitChildSpan,
  ensureRootTraceEnv,
  buildSpan,
  deriveModelTier,
  workClassInferred,
  logFileFor,
  SPAN_SCHEMA_VERSION,
  FIELD_ADDED_VERSION
};
