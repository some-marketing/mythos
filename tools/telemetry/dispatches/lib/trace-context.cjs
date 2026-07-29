'use strict';

/**
 * trace-context.cjs — Trace context propagation utilities (the correlation-ID keystone).
 *
 * One physical id flows the whole cascade: `trace_id`. `correlation_id` is a
 * logical *alias* of `trace_id` (physical-equivalence contract) — never a third
 * field kept in sync. When a cascade is seeded inside a coordination loop, the
 * root `trace_id` is the parent signal's `lineage_root_session_id`, giving a 1:1
 * join across telemetry <-> signal/escalation <-> debrief.
 */

const crypto = require('crypto');
const os = require('os');

function generateId() {
  return crypto.randomUUID();
}

function getTraceContext() {
  const trace_id = process.env.MYTHOS_TRACE_ID || 'unknown';
  return {
    trace_id,
    // correlation_id is the logical alias of the physical trace_id — same value,
    // never a separately-synced field (failure mode "correlation drift").
    correlation_id: trace_id,
    span_id: process.env.MYTHOS_SPAN_ID || null,
    parent_span_id: process.env.MYTHOS_PARENT_SPAN_ID || null,
    scope_identity: process.env.MYTHOS_WORKSTREAM_SCOPE || null,
    step_id: process.env.MYTHOS_STEP_ID || null,
    session_id: process.env.MYTHOS_SESSION_ID || null,
    lineage_root_session_id: process.env.MYTHOS_LINEAGE_ROOT_SESSION_ID || null,
    host: process.env.MYTHOS_HOST || os.hostname() || null,
    layer_depth: process.env.MYTHOS_LAYER_DEPTH ? parseInt(process.env.MYTHOS_LAYER_DEPTH, 10) : 0,
    command_execution_mode: process.env.MYTHOS_COMMAND_EXECUTION_MODE || null
  };
}

function buildNextTraceEnv(opts = {}) {
  const current = getTraceContext();
  // "Rooted" = a real parent span exists in the environment. When it does not,
  // this dispatch cannot be a depth-1 child of nothing — emitting it at depth 1
  // with a null parent is exactly the orphan edge the lint flags (codex review).
  // Without a seeded parent it IS a root: depth 0, null parent. Boundaries that
  // want a real two-row tree call ensureRootTraceEnv() first.
  const rooted = current.trace_id !== 'unknown' && current.span_id;
  const next = {
    MYTHOS_TRACE_ID: current.trace_id === 'unknown' ? generateId() : current.trace_id,
    MYTHOS_SPAN_ID: generateId(),
    MYTHOS_PARENT_SPAN_ID: current.span_id,
    MYTHOS_WORKSTREAM_SCOPE: opts.scope || current.scope_identity,
    MYTHOS_STEP_ID: opts.stepId || null,
    MYTHOS_LAYER_DEPTH: String(rooted ? current.layer_depth + 1 : 0),
    MYTHOS_COMMAND_EXECUTION_MODE: opts.executionMode || 'managed'
  };
  // Carry lineage/session/host forward unchanged so the whole subtree shares one
  // join key. Only set when known — never clobber a child's own future seeding.
  if (current.session_id) next.MYTHOS_SESSION_ID = current.session_id;
  if (current.lineage_root_session_id) next.MYTHOS_LINEAGE_ROOT_SESSION_ID = current.lineage_root_session_id;
  if (current.host) next.MYTHOS_HOST = current.host;
  return next;
}

/**
 * buildRootTraceEnv — Seed a *root* span at the cascade top.
 *
 * Roots BOTH MYTHOS_TRACE_ID and MYTHOS_SPAN_ID (NOW catch: trace-only seeding
 * leaves every child's parent_span_id null). When `lineageRootSessionId` is
 * supplied (a parent signal's lineage_root_session_id, read inside a
 * coordination loop), it becomes the physical trace_id — the equivalence
 * contract — so the span's correlation_id joins straight back to the signal.
 *
 * Idempotent: if a real trace context is already in the environment it is
 * returned unchanged, so re-seeding inside an already-seeded cascade is a no-op.
 */
function buildRootTraceEnv(opts = {}) {
  const current = getTraceContext();
  const alreadySeeded = current.trace_id !== 'unknown' && current.span_id;
  if (alreadySeeded) {
    // Re-export the EXISTING context unchanged (idempotent). opts must not
    // override an already-seeded scope/mode/session — re-seeding is a no-op, not
    // an enrichment (codex review). Only host falls back to the real hostname.
    return {
      MYTHOS_TRACE_ID: current.trace_id,
      MYTHOS_SPAN_ID: current.span_id,
      MYTHOS_PARENT_SPAN_ID: current.parent_span_id || '',
      MYTHOS_WORKSTREAM_SCOPE: current.scope_identity || '',
      MYTHOS_LAYER_DEPTH: String(current.layer_depth || 0),
      MYTHOS_SESSION_ID: current.session_id || '',
      MYTHOS_LINEAGE_ROOT_SESSION_ID: current.lineage_root_session_id || '',
      MYTHOS_HOST: current.host || os.hostname() || '',
      MYTHOS_COMMAND_EXECUTION_MODE: current.command_execution_mode || 'managed',
      __already_seeded: true
    };
  }

  const lineageRoot = opts.lineageRootSessionId || '';
  const sessionId = opts.sessionId || lineageRoot || generateId();
  // Physical-equivalence contract: in a coordination loop, the root trace_id IS
  // the parent signal's lineage_root_session_id.
  const traceId = lineageRoot || opts.traceId || sessionId;

  return {
    MYTHOS_TRACE_ID: traceId,
    MYTHOS_SPAN_ID: generateId(),
    MYTHOS_PARENT_SPAN_ID: '',
    MYTHOS_WORKSTREAM_SCOPE: opts.scope || '',
    MYTHOS_LAYER_DEPTH: '0',
    MYTHOS_SESSION_ID: sessionId,
    MYTHOS_LINEAGE_ROOT_SESSION_ID: lineageRoot,
    MYTHOS_HOST: os.hostname() || '',
    MYTHOS_COMMAND_EXECUTION_MODE: opts.executionMode || 'managed',
    __already_seeded: false
  };
}

module.exports = {
  getTraceContext,
  buildNextTraceEnv,
  buildRootTraceEnv,
  generateId
};
