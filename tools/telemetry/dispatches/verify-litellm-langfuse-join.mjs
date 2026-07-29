#!/usr/bin/env node
'use strict';

/**
 * verify-litellm-langfuse-join.mjs — P1.5 live acceptance check.
 *
 * Proves the S1<->S2 convergence end to end: drives a real model call through the
 * ACTUAL openai-compatible adapter (the centralized harness->LiteLLM path) with a
 * cascade trace seeded in the environment, then queries Langfuse and asserts a
 * trace whose id (or carried metadata) equals the cascade correlation id — i.e.
 * the LiteLLM->Langfuse generation joined the Mythos span tree on ONE id.
 *
 * Secrets are read from the environment only; nothing is printed. Resolve them at
 * call time, e.g. (Mac, over tailnet):
 *   TELEMETRY_LITELLM_BASE=http://${TELEMETRY_HOST}:4000 \
 *   LITELLM_API_KEY="$(ssh ubuntu@<vps> 'grep ^LITELLM_MASTER_KEY ~/stack/.env | cut -d= -f2-')" \
 *   LANGFUSE_HOST=http://${TELEMETRY_HOST}:3000 \
 *   LANGFUSE_PUBLIC_KEY="$(op read 'op://Automation/mythos-langfuse-api/Public Key')" \
 *   LANGFUSE_SECRET_KEY="$(op read 'op://Automation/mythos-langfuse-api/credential')" \
 *   node tools/telemetry/dispatches/verify-litellm-langfuse-join.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LITELLM_BASE = process.env.MYTHOS_LITELLM_BASE || 'http://litellm:4000';
const LITELLM_KEY = process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || '';
const LF_HOST = (process.env.LANGFUSE_HOST || 'http://stack-langfuse-1:3000').replace(/\/+$/, '');
const LF_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY || '';
const LF_SECRET = process.env.LANGFUSE_SECRET_KEY || '';
const MODEL = process.env.MYTHOS_VERIFY_MODEL || 'gemini-2.5-flash';
const TRACE_ID = process.env.MYTHOS_VERIFY_TRACE_ID || `p15-verify-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
const POLL_SECONDS = Number(process.env.MYTHOS_VERIFY_POLL_SECONDS || 40);

function fail(msg, extra = {}) {
  console.log(JSON.stringify({ ok: false, blocker: msg, trace_id: TRACE_ID, ...extra }, null, 2));
  process.exit(1);
}

if (!LITELLM_KEY) fail('LITELLM_API_KEY/LITELLM_MASTER_KEY not set — cannot call the gateway.');
if (!LF_PUBLIC || !LF_SECRET) fail('LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — cannot query Langfuse.');

// Seed the cascade trace into the environment so the adapter inherits it exactly
// the way a live cascade would (correlation_id is the physical alias of trace_id).
process.env.MYTHOS_TRACE_ID = TRACE_ID;
process.env.MYTHOS_SPAN_ID = `span-${crypto.randomUUID().slice(0, 8)}`;
process.env.MYTHOS_WORKSTREAM_SCOPE = process.env.MYTHOS_WORKSTREAM_SCOPE || 'cascade-observability-P1.5';
process.env.MYTHOS_SESSION_ID = process.env.MYTHOS_SESSION_ID || TRACE_ID;
process.env.MYTHOS_LITELLM_BASE = LITELLM_BASE; // so host-detection (not an explicit flag) fires — proves the default path

const { createOpenAICompatibleAdapter } = require('../../ai-bridge/adapters/openai-compatible.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lfGet(route) {
  const auth = Buffer.from(`${LF_PUBLIC}:${LF_SECRET}`).toString('base64');
  const res = await fetch(`${LF_HOST}${route}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

async function main() {
  // 1) Drive the real adapter over the LiteLLM gateway. Detection is by endpoint
  //    (MYTHOS_LITELLM_BASE host-match) — NOT an explicit opts.litellm flag.
  const adapter = createOpenAICompatibleAdapter({
    baseUrl: LITELLM_BASE,
    apiKey: LITELLM_KEY,
    endpointRef: 'MYTHOS_LITELLM_BASE'
  });

  const invokeResult = await adapter.invoke({
    model_id: MODEL,
    system_prompt: 'You are a telemetry probe. Reply with exactly: ok',
    user_prompt: `P1.5 correlation-wiring live check ${TRACE_ID}`,
    options: { temperature: 0, max_output_tokens: 16, timeout_ms: 60000 }
  });

  if (invokeResult.status !== 'success') {
    fail('LiteLLM call did not succeed — cannot verify the join.', {
      invoke_status: invokeResult.status,
      invoke_error: invokeResult.error || null
    });
  }

  // 2) Poll Langfuse for the trace pinned to our correlation id.
  const deadline = Date.now() + POLL_SECONDS * 1000;
  let attempt = 0;
  let matched = null;
  let mechanism = null;
  while (Date.now() < deadline && !matched) {
    attempt += 1;
    // Primary: deterministic trace-id pin (metadata.trace_id -> Langfuse trace.id).
    const direct = await lfGet(`/api/public/traces/${encodeURIComponent(TRACE_ID)}`);
    if (direct.status === 200 && direct.body && direct.body.id === TRACE_ID) {
      matched = direct.body;
      mechanism = 'trace_id-pin';
      break;
    }
    // Fallback: tag/metadata search (robust to LiteLLM honoring a different key).
    const tagged = await lfGet(`/api/public/traces?tags=mythos_cascade&limit=50`);
    if (tagged.status === 200 && tagged.body && Array.isArray(tagged.body.data)) {
      const hit = tagged.body.data.find((t) =>
        t.id === TRACE_ID ||
        (t.metadata && (t.metadata.mythos_correlation_id === TRACE_ID || t.metadata.trace_id === TRACE_ID))
      );
      if (hit) { matched = hit; mechanism = 'tag/metadata-search'; break; }
    }
    await sleep(4000);
  }

  if (!matched) {
    fail('No Langfuse trace carrying the cascade correlation id appeared within the poll window.', {
      polled_seconds: POLL_SECONDS, attempts: attempt, langfuse_host: LF_HOST, model: MODEL
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mechanism,
    cascade_correlation_id: TRACE_ID,
    langfuse_trace_id: matched.id,
    join_equality: matched.id === TRACE_ID,
    langfuse_trace_name: matched.name || null,
    tags: matched.tags || null,
    mythos_correlation_id_in_metadata: matched.metadata ? (matched.metadata.mythos_correlation_id || null) : null,
    attempts: attempt,
    model: MODEL,
    langfuse_host: LF_HOST
  }, null, 2));
}

main().catch((err) => fail(`verifier threw: ${err.message}`));
