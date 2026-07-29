#!/usr/bin/env node
'use strict';

/**
 * verify-p3a-cascade-render.mjs — P3a live acceptance driver.
 *
 * Proves the WHOLE cascade renders as one Langfuse tree end to end:
 *   1. Seed a fresh cascade trace id.
 *   2. Emit a real 3-node orchestrator cascade to dispatches.jsonl
 *        coordinator -> worker -> reviewer  (S1 / orchestrator spans).
 *   3. Drive ONE real LiteLLM model call *in the worker's span context*, so the
 *      Langfuse generation (S2) is pinned to the same trace id AND carries
 *      mythos_span_id = the worker span (P1.5 wiring) — i.e. it belongs under the
 *      worker node.
 *   4. (Operator/caller then runs export-to-langfuse.mjs --enable on this trace.)
 *   5. Re-read Langfuse and assert the trace holds BOTH orchestrator SPAN
 *      observations and the model-call GENERATION, with the generation nested
 *      under the worker orchestrator node.
 *
 * Steps 1-3 need only LiteLLM creds; step 5 needs Langfuse creds. Both come from
 * the environment (never printed). Pass --export to also run the orchestrator-span
 * push inline (so this is a single self-contained live check).
 *
 * Env (resolve via the runner; never inline secrets in argv):
 *   TELEMETRY_LITELLM_BASE default http://litellm:4000 (or http://${TELEMETRY_HOST}:4000 on your own network)
 *   LITELLM_API_KEY / LITELLM_MASTER_KEY
 *   LANGFUSE_HOST       default http://stack-langfuse-1:3000 (tailnet :3000)
 *   LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY
 *   MYTHOS_VERIFY_MODEL   default gemini-2.5-flash
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const LITELLM_BASE = process.env.MYTHOS_LITELLM_BASE || 'http://litellm:4000';
const LITELLM_KEY = process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || '';
const LF_HOST = (process.env.LANGFUSE_HOST || 'http://stack-langfuse-1:3000').replace(/\/+$/, '');
const LF_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY || '';
const LF_SECRET = process.env.LANGFUSE_SECRET_KEY || '';
const MODEL = process.env.MYTHOS_VERIFY_MODEL || 'gemini-2.5-flash';
const POLL_SECONDS = Number(process.env.MYTHOS_VERIFY_POLL_SECONDS || 45);
const DO_EXPORT = process.argv.includes('--export');

const TRACE_ID = process.env.MYTHOS_VERIFY_TRACE_ID
  || `p3a-verify-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;

function fail(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, blocker: msg, trace_id: TRACE_ID, ...extra }, null, 2));
  process.exit(1);
}
if (!LITELLM_KEY) fail('LITELLM_API_KEY/LITELLM_MASTER_KEY not set — cannot drive the model call.');

const { emitSpan } = require('./lib/emit-span.cjs');
const { createOpenAICompatibleAdapter } = require('../../ai-bridge/adapters/openai-compatible.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic span ids for the cascade we are about to emit.
const SROOT = `root-${crypto.randomUUID().slice(0, 8)}`;
const SWORK = `work-${crypto.randomUUID().slice(0, 8)}`;
const SREV = `rev-${crypto.randomUUID().slice(0, 8)}`;

async function lfGet(route) {
  const auth = Buffer.from(`${LF_PUBLIC}:${LF_SECRET}`).toString('base64');
  const res = await fetch(`${LF_HOST}${route}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

function setCtx(spanId, parentId, depth) {
  process.env.MYTHOS_TRACE_ID = TRACE_ID;
  process.env.MYTHOS_SPAN_ID = spanId;
  if (parentId) process.env.MYTHOS_PARENT_SPAN_ID = parentId; else delete process.env.MYTHOS_PARENT_SPAN_ID;
  process.env.MYTHOS_LAYER_DEPTH = String(depth);
  process.env.MYTHOS_WORKSTREAM_SCOPE = 'cascade-observability-P3a';
  process.env.MYTHOS_SESSION_ID = TRACE_ID;
}

async function main() {
  // --- 2) emit the orchestrator cascade (S1) ---
  setCtx(SROOT, null, 0);
  emitSpan(PROJECT_ROOT, { actor_role: 'coordinator', subagent_type: 'cascade-root', routing_decision: 'delegate-down', status: 'ok', actor_reason: 'P3a live verify root', emit_source: 'p3a-verify', duration_ms: 600000 });
  setCtx(SWORK, SROOT, 1);
  emitSpan(PROJECT_ROOT, { actor_role: 'worker', subagent_type: 'framework-executor', routing_decision: 'do-self', status: 'ok', actor_reason: 'worker makes the model call', emit_source: 'p3a-verify', duration_ms: 120000 });
  setCtx(SREV, SWORK, 2);
  emitSpan(PROJECT_ROOT, { actor_role: 'reviewer', subagent_type: 'codex', routing_decision: 'delegate-down', status: 'ok', actor_reason: 'distinct review', emit_source: 'p3a-verify', duration_ms: 90000 });

  // --- 3) real LiteLLM call IN THE WORKER CONTEXT (generation -> nests under worker) ---
  setCtx(SWORK, SROOT, 1);
  const adapter = createOpenAICompatibleAdapter({ baseUrl: LITELLM_BASE, apiKey: LITELLM_KEY, endpointRef: 'MYTHOS_LITELLM_BASE' });
  process.env.MYTHOS_LITELLM_BASE = LITELLM_BASE; // host-detection fires the trace-metadata injection
  const invoke = await adapter.invoke({
    model_id: MODEL,
    system_prompt: 'You are a telemetry probe. Reply with exactly: ok',
    user_prompt: `P3a cascade render live check ${TRACE_ID}`,
    options: { temperature: 0, max_output_tokens: 16, timeout_ms: 60000 }
  });
  if (invoke.status !== 'success') fail('LiteLLM call did not succeed.', { invoke_status: invoke.status, invoke_error: invoke.error || null, worker_span_id: SWORK });

  if (DO_EXPORT && (!LF_PUBLIC || !LF_SECRET)) fail('LANGFUSE_PUBLIC_KEY/SECRET_KEY not set — cannot export/verify.', { worker_span_id: SWORK });

  // --- 4+5) wait for the async-flushed generation, THEN export (so re-parent can
  //          nest it), then re-read and assert the FULL topology claim ---
  //
  // ORDER MATTERS: LiteLLM flushes its generation to Langfuse a few seconds after
  // the call. The exporter re-parents generations it can SEE, so exporting before
  // the generation lands leaves it at trace root (a no-op re-parent). We therefore
  // poll until the generation appears, export once at that point, then assert.
  const workerObsId = `mythos-${SWORK}`;
  const enc = encodeURIComponent(TRACE_ID);
  const deadline = Date.now() + POLL_SECONDS * 1000;
  let trace = null, spanObs = [], genObs = [], genUnderWorker = [], exportOut = null, exported = false;

  while (Date.now() < deadline) {
    const t = await lfGet(`/api/public/traces/${enc}`);
    if (t.status === 200 && t.body && t.body.id === TRACE_ID) trace = t.body;

    const detail = await lfGet(`/api/public/observations?traceId=${enc}&limit=100`);
    const list = (detail.status === 200 && detail.body && Array.isArray(detail.body.data)) ? detail.body.data : [];
    spanObs = list.filter((o) => o.type === 'SPAN');
    genObs = list.filter((o) => o.type === 'GENERATION');
    genUnderWorker = genObs.filter((g) => g.parentObservationId === workerObsId);

    // Export once the generation is present (so the re-parent pass actually nests it).
    if (DO_EXPORT && !exported && genObs.length > 0) {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'export-to-langfuse.mjs'), '--trace', TRACE_ID, '--enable', '--json'], { env: process.env, encoding: 'utf8' });
      try { exportOut = JSON.parse(r.stdout); } catch { exportOut = { raw: (r.stdout || '').slice(0, 500), stderr: (r.stderr || '').slice(0, 300) }; }
      exported = true;
      await sleep(2500); // let ingestion apply the re-parent before re-reading
      continue;
    }

    // Done when every acceptance condition holds (or, with no export, once both
    // observation types are present — there is nothing to nest without a push).
    const topologyProven = trace && trace.id === TRACE_ID && spanObs.length > 0 && genObs.length > 0 && genUnderWorker.length > 0;
    if (DO_EXPORT ? topologyProven : (spanObs.length > 0 && genObs.length > 0)) break;
    await sleep(4000);
  }

  if (!trace) fail('Langfuse trace never appeared.', { worker_span_id: SWORK, langfuse_host: LF_HOST, export: exportOut });

  // result.ok ENCODES the full acceptance claim this verifier exists to prove:
  // ONE trace (id-equality) holding BOTH the orchestrator spans AND the model-call
  // generation, with the generation NESTED UNDER THE WORKER node that made the call
  // (codex MAJOR 2026-06-15: presence-only was under-gated — a generation left at
  // trace root could pass). With --export the nesting is required; without it the
  // orchestrator spans were never pushed, so only join-presence is asserted.
  const checks = {
    trace_id_equals: !!(trace && trace.id === TRACE_ID),
    has_orchestrator_spans: spanObs.length > 0,
    has_model_generations: genObs.length > 0,
    generation_nested_under_worker: genUnderWorker.length > 0
  };
  const ok = DO_EXPORT
    ? (checks.trace_id_equals && checks.has_orchestrator_spans && checks.has_model_generations && checks.generation_nested_under_worker)
    : (checks.has_orchestrator_spans && checks.has_model_generations);

  const result = {
    ok,
    checks,
    export_ran: exported,
    trace_id: TRACE_ID,
    langfuse_trace_id: trace.id,
    join_equality: trace.id === TRACE_ID,
    langfuse_host: LF_HOST,
    orchestrator_span_observations: spanObs.length,
    model_call_generations: genObs.length,
    generations_nested_under_worker: genUnderWorker.length,
    worker_obs_id: workerObsId,
    orchestrator_names: spanObs.map((o) => o.name),
    generation_models: genObs.map((g) => g.model),
    export: exportOut
  };
  if (!ok) {
    const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    result.note = DO_EXPORT
      ? `acceptance NOT proven — failing conditions: [${missing.join(', ')}]. Full claim = one trace (id-equality) holding orchestrator SPANs AND a model-call GENERATION nested under the worker node ${workerObsId}.`
      : `presence NOT proven — failing conditions: [${missing.filter((m) => m !== 'trace_id_equals' && m !== 'generation_nested_under_worker').join(', ')}]. Run with --export to also prove worker-nesting topology.`;
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((err) => fail(`verifier threw: ${err.message}`, { stack: (err.stack || '').split('\n').slice(0, 4) }));
