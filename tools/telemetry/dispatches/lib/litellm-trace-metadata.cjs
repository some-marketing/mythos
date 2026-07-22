'use strict';

/**
 * litellm-trace-metadata.cjs — P1.5 correlation-wiring.
 *
 * The bridge between the two span sources of the cascade observability spine:
 *
 *   S1 (keystone)   — Mythos shell-boundary spans in dispatches.jsonl, keyed by
 *                     the physical `trace_id` (see trace-context.cjs / emit-span.cjs).
 *   S2 (model call) — LiteLLM -> Langfuse generation traces, emitted by LiteLLM's
 *                     `success_callback: ["langfuse"]` for every routed model call.
 *
 * Left alone the two diverge: LiteLLM mints a fresh random Langfuse trace id per
 * request, so a cascade's model calls scatter across unrelated Langfuse traces
 * and never join the Mythos span tree. This module makes every harness->LiteLLM
 * request carry the ACTIVE cascade correlation id as LiteLLM request metadata, so
 * the Langfuse trace id is *pinned* to the Mythos trace_id and the two sources
 * converge on ONE trace.
 *
 * Join mechanism (LiteLLM -> Langfuse, deterministic): LiteLLM's Langfuse logger
 * reads `metadata.trace_id` from the request and uses it verbatim as the Langfuse
 * trace id. We set `metadata.trace_id = correlation_id` (the physical-equivalence
 * alias of trace_id). Therefore:  Langfuse trace.id  ==  Mythos trace_id  ==
 * dispatches.jsonl correlation_id. The join is an equality, not a fuzzy match.
 * `metadata.tags` + `metadata.trace_metadata.*` carry the rest of the lineage so a
 * generation also maps back to the exact emitting Mythos span.
 *
 * Constitutional invariant: PASSIVE SENSOR. This only annotates an outbound
 * request body; it never blocks, retries, or mutates routing. Fully fail-open —
 * any error returns the body unchanged so a telemetry defect can never break a
 * live model call.
 */

const { getTraceContext } = require('./trace-context.cjs');

/**
 * Build the LiteLLM metadata object for the supplied (or ambient) trace context.
 * Returns null when there is no real cascade in scope (trace_id === 'unknown'),
 * so we never pin a Langfuse trace to a meaningless id.
 *
 * @param {object} [ctx] - trace context; defaults to the ambient getTraceContext()
 * @returns {object|null}
 */
function buildLitellmTraceMetadata(ctx) {
  const trace = ctx || getTraceContext();
  const correlationId = trace.correlation_id || trace.trace_id;
  if (!correlationId || correlationId === 'unknown') return null;

  // Lineage carried for the back-join from a Langfuse generation to its exact
  // Mythos span. Only non-empty values are emitted (no null noise in Langfuse).
  const traceMetadata = {};
  const carry = {
    mythos_correlation_id: correlationId,
    mythos_trace_id: trace.trace_id,
    mythos_span_id: trace.span_id,
    mythos_parent_span_id: trace.parent_span_id,
    mythos_scope_identity: trace.scope_identity,
    mythos_step_id: trace.step_id,
    mythos_session_id: trace.session_id,
    mythos_lineage_root_session_id: trace.lineage_root_session_id,
    mythos_host: trace.host,
    mythos_layer_depth: typeof trace.layer_depth === 'number' ? trace.layer_depth : null,
    mythos_command_execution_mode: trace.command_execution_mode
  };
  for (const [k, v] of Object.entries(carry)) {
    if (v !== null && v !== undefined && v !== '') traceMetadata[k] = v;
  }

  const tags = ['mythos_cascade'];
  if (trace.scope_identity) tags.push(`scope:${trace.scope_identity}`);
  if (trace.host) tags.push(`host:${trace.host}`);

  const metadata = {
    // THE join key: LiteLLM uses metadata.trace_id verbatim as the Langfuse trace id.
    trace_id: correlationId,
    trace_name: 'mythos_cascade',
    tags,
    trace_metadata: traceMetadata
  };
  // Group a cascade's model calls under one Langfuse session when we know it.
  const sessionId = trace.session_id || trace.lineage_root_session_id;
  if (sessionId) metadata.session_id = sessionId;
  return metadata;
}

/**
 * Decide whether a given endpoint is the LiteLLM gateway. We must NOT inject this
 * metadata into OpenAI/OpenRouter calls (the same openai-compatible adapter serves
 * them): OpenAI rejects arbitrary metadata keys, and OpenRouter would silently
 * store noise. Detection, in precedence order:
 *   1. explicit opts.litellm === true/false wins (caller knows best);
 *   2. env kill-switch MYTHOS_LITELLM_TRACE_METADATA in {0,false,off,no} -> off;
 *   3. baseUrl equals (host:port of) MYTHOS_LITELLM_BASE;
 *   4. baseUrl host contains "litellm".
 *
 * @param {string} baseUrl
 * @param {object} [opts] - { litellm?: boolean }
 * @returns {boolean}
 */
function isLitellmEndpoint(baseUrl, opts = {}) {
  if (opts && typeof opts.litellm === 'boolean') return opts.litellm;

  const kill = String(process.env.MYTHOS_LITELLM_TRACE_METADATA || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(kill)) return false;
  // Explicit force-on still requires SOME endpoint signal below unless opts said so.
  const forceOn = ['1', 'true', 'on', 'yes'].includes(kill);

  const url = String(baseUrl || '');
  if (!url) return false;

  let host = '';
  try {
    host = new URL(url.replace(/\/+$/, '')).host.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }

  const configured = String(process.env.MYTHOS_LITELLM_BASE || '').trim();
  if (configured) {
    try {
      const cfgHost = new URL(configured.replace(/\/+$/, '')).host.toLowerCase();
      if (cfgHost && cfgHost === host) return true;
    } catch { /* fall through to substring check */ }
  }

  if (host.includes('litellm')) return true;
  return forceOn; // env force-on with no recognizable endpoint -> trust the operator
}

/**
 * Merge cascade trace metadata into an outbound chat-completions body, in place,
 * only when the endpoint is LiteLLM and a real cascade is in scope. Caller-set
 * metadata keys are preserved (never clobbered). Fail-open: returns the body
 * unchanged on any error.
 *
 * @param {object} body - the chat-completions request body (mutated + returned)
 * @param {object} [params] - { baseUrl, opts, ctx }
 * @returns {object} the same body
 */
function applyLitellmTraceMetadata(body, params = {}) {
  try {
    if (!body || typeof body !== 'object') return body;
    if (!isLitellmEndpoint(params.baseUrl, params.opts || {})) return body;

    const meta = buildLitellmTraceMetadata(params.ctx);
    if (!meta) return body;

    const existing = (body.metadata && typeof body.metadata === 'object') ? body.metadata : {};
    // Caller-provided keys win; trace_metadata dicts are shallow-merged so caller
    // annotations and our mythos_* lineage coexist.
    const mergedTraceMetadata = {
      ...meta.trace_metadata,
      ...(existing.trace_metadata && typeof existing.trace_metadata === 'object' ? existing.trace_metadata : {})
    };
    body.metadata = {
      ...meta,
      ...existing,
      trace_metadata: mergedTraceMetadata
    };
    return body;
  } catch (err) {
    process.stderr.write(`[litellm-trace-metadata] fail-open: ${err.message}\n`);
    return body;
  }
}

module.exports = {
  buildLitellmTraceMetadata,
  isLitellmEndpoint,
  applyLitellmTraceMetadata
};
