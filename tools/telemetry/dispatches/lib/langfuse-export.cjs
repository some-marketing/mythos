'use strict';

/**
 * langfuse-export.cjs — P3a Langfuse-ADOPT exporter (orchestrator-span render side).
 *
 * The cascade observability spine has two span sources that already share ONE
 * physical id (`trace_id` === `correlation_id`):
 *
 *   S1 (orchestrator) — Mythos shell-boundary spans in dispatches.jsonl
 *                       (coordinator -> worker -> reviewer dispatch tree).
 *   S2 (model call)   — LiteLLM -> Langfuse *generations* (tokens/cost), already
 *                       pinned to the same Langfuse trace id by P1.5
 *                       (lib/litellm-trace-metadata.cjs). PROVEN live-joined.
 *
 * P1.5 made the model calls land in the right Langfuse trace. What is still
 * MISSING from the Langfuse trace view is the ORCHESTRATOR skeleton — the trace
 * shows generations but no coordinator/worker/reviewer tree to hang them on.
 * This module closes that: it reads the authoritative dispatches.jsonl tree (via
 * lib/assemble-tree.cjs) and pushes each S1 span into Langfuse as a SPAN
 * observation under the SAME trace id, so the Langfuse trace renders as ONE tree:
 * coordinator -> worker -> reviewer, with the S2 generations nested underneath.
 *
 * Constitutional invariants:
 *  - ADOPT, not author. dispatches.jsonl stays the authoritative store; Langfuse
 *    is a render surface. This is a one-way push; it never reads back INTO the
 *    native store and never mutates it.
 *  - OFF by default. The CLI requires an explicit --enable (or MYTHOS_LANGFUSE_EXPORT
 *    truthy); without it the exporter is a pure dry-run (builds + reports, no POST).
 *  - Idempotent. Observation ids are deterministic functions of the span id, and
 *    the ingestion-event envelope id is a content hash, so re-exporting the same
 *    cascade upserts in place and Langfuse de-dups — no duplicate nodes.
 *  - PASSIVE. Fail-open at the edges; a Langfuse outage can never break a cascade
 *    (the exporter runs out-of-band, never inside a live dispatch).
 *  - Secrets via env only. Keys are resolved by the runner (run-export-with-op.sh)
 *    and passed through the environment; this module never reads a vault and never
 *    logs a key.
 */

const crypto = require('crypto');

const TRACE_NAME = 'mythos_cascade';
const OBS_PREFIX = 'mythos'; // observation-id namespace for orchestrator spans

/**
 * stableStringify — deterministic JSON (sorted keys) so a content hash is stable
 * across runs regardless of key insertion order.
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * eventId — deterministic ingestion-event id = hash(type + object-id + body).
 * Same content -> same id -> Langfuse de-dups (idempotent). Changed content ->
 * new id -> the *-update/*-create upserts the changed fields.
 */
function eventId(type, body) {
  const h = crypto.createHash('sha1');
  h.update(type + ':' + (body && body.id != null ? body.id : '') + ':' + stableStringify(body || {}));
  return h.digest('hex').slice(0, 32);
}

/**
 * obsId — deterministic Langfuse observation id for one S1 orchestrator node.
 * Keyed on the span_id (a UUID, see trace-context.cjs). Anonymous rows (null
 * span_id — e.g. legacy subagent-telemetry rows) fall back to a stable key built
 * from the node's synthetic _key so they still upsert idempotently per trace.
 */
function obsId(node, traceId) {
  const span = node.span || node;
  if (span.span_id) return `${OBS_PREFIX}-${span.span_id}`;
  // Anonymous: stable within (trace, synthetic key). _key is assigned by
  // assembleTrace as `__anon_<n>`; combine with trace id for global uniqueness.
  const key = node._key || `anon-${span.timestamp || ''}`;
  return `${OBS_PREFIX}-anon-${traceId}-${key}`;
}

function nodeName(span) {
  const role = span.actor_role || null;
  const sub = span.subagent_type && span.subagent_type !== 'unknown' ? span.subagent_type : null;
  if (role && sub && role !== sub) return `${role}:${sub}`;
  return role || sub || 'actor';
}

function levelFor(span) {
  const s = String(span.status || '').toLowerCase();
  if (!s || s === 'ok' || s === 'done' || s === 'success') return 'DEFAULT';
  if (/(abort|fail|error|critical)/.test(s)) return 'ERROR';
  // corrected / reopened / parked / blocked -> a soft warning, not an error.
  return 'WARNING';
}

function endTimeFor(span) {
  if (span.duration_ms == null || !span.timestamp) return undefined;
  const start = Date.parse(span.timestamp);
  if (!Number.isFinite(start)) return undefined;
  return new Date(start + (Number(span.duration_ms) || 0)).toISOString();
}

/**
 * spanMetadata — the lineage + economics + routing carried verbatim onto the
 * Langfuse observation, so a reader who clicks an orchestrator node sees the same
 * facts the native store holds. Null/empty fields are dropped (no noise).
 */
function spanMetadata(span) {
  const meta = {
    mythos_source: 'orchestrator',
    mythos_span_id: span.span_id,
    mythos_parent_span_id: span.parent_span_id,
    mythos_correlation_id: span.correlation_id || span.trace_id,
    scope_identity: span.scope_identity,
    step_id: span.step_id,
    layer_depth: span.layer_depth,
    host: span.host,
    model: span.model,
    model_tier: span.model_tier,
    // Mind + harness provenance (c6-mind-coverage-repair). Carry the honest mind
    // signal (mind_class/mind_relation/model_verified) AND the harness axis so a
    // Langfuse reader sees an honest sentinel as 'claude · parallel-context ·
    // model-unverified' rather than a mind-less blank. Null/empty fields are
    // dropped below; model_verified:false (a real boolean) is preserved.
    mind_class: span.mind_class,
    mind_relation: span.mind_relation,
    model_verified: span.model_verified,
    harness: span.harness,
    harness_witness_state: span.harness_witness_state,
    trigger_class: span.trigger_class,
    trigger_witness_state: span.trigger_witness_state,
    actor_role: span.actor_role,
    subagent_type: span.subagent_type,
    routing_decision: span.routing_decision,
    work_class_inferred: span.work_class_inferred,
    emit_source: span.emit_source,
    status: span.status,
    total_tokens: span.total_tokens,
    cost: span.cost,
    tool_uses: span.tool_uses,
    duration_ms: span.duration_ms,
    command_execution_mode: span.command_execution_mode
  };
  for (const k of Object.keys(meta)) {
    if (meta[k] === null || meta[k] === undefined || meta[k] === '') delete meta[k];
  }
  return meta;
}

/**
 * buildIngestionEvents — PURE. Turn an assembled cascade tree into a Langfuse
 * ingestion batch:
 *   1. one `trace-create` (upserts/merges the trace LiteLLM already created), and
 *   2. one `span-create` per orchestrator node, parented by parentObservationId
 *      to its parent node's observation id (root nodes -> null).
 *
 * @param {object} tree   - result of assembleTrace() ({ roots, stats, orphans })
 * @param {string} traceId
 * @param {object} [ctx]  - { economics, correlates, scope } for trace metadata
 * @returns {{ events: object[], obsIndex: Map<string,string>, nodeCount: number }}
 *          obsIndex maps span_id -> observation id (used by the re-parent join).
 */
function buildIngestionEvents(tree, traceId, ctx = {}) {
  const events = [];
  const obsIndex = new Map(); // span_id -> obsId
  let earliest = null;

  // --- trace-create (idempotent upsert; merges onto the LiteLLM-made trace) ---
  const econ = ctx.economics || {};
  const corr = ctx.correlates || {};
  const traceTags = ['mythos_cascade', 'mythos_orchestrator'];
  if (ctx.scope) traceTags.push(`scope:${ctx.scope}`);
  const traceBody = {
    id: traceId,
    name: TRACE_NAME,
    tags: traceTags,
    metadata: {
      mythos_orchestrator_export: true,
      node_count: tree.stats ? tree.stats.node_count : undefined,
      max_depth: tree.stats ? tree.stats.max_depth : undefined,
      orphan_edges: tree.orphans ? tree.orphans.length : 0,
      model_calls: econ.model_calls,
      total_tokens: econ.tokens,
      cost: econ.cost,
      signals: (corr.signals || []).map((s) => s.file),
      debriefs: (corr.debriefs || []).map((d) => d.file),
      escalations: (corr.escalations || []).length
    }
  };
  for (const k of Object.keys(traceBody.metadata)) {
    const v = traceBody.metadata[k];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete traceBody.metadata[k];
  }

  // --- span-create per orchestrator node (DFS, parent-before-child) ---
  const walk = (node, parentObsId) => {
    const span = node.span;
    const id = obsId(node, traceId);
    if (span.span_id) obsIndex.set(span.span_id, id);
    if (span.timestamp && (!earliest || span.timestamp < earliest)) earliest = span.timestamp;

    const body = {
      id,
      traceId,
      type: 'SPAN',
      name: nodeName(span),
      startTime: span.timestamp || undefined,
      endTime: endTimeFor(span),
      parentObservationId: parentObsId || undefined,
      level: levelFor(span),
      metadata: spanMetadata(span)
    };
    if (span.actor_reason) body.input = { actor_reason: span.actor_reason };
    if (span.status) body.statusMessage = String(span.status);
    if (node._orphan) {
      body.level = body.level === 'DEFAULT' ? 'WARNING' : body.level;
      body.metadata.mythos_orphan = true;
    }
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

    events.push({ type: 'span-create', body });
    for (const child of node.children) walk(child, id);
  };
  for (const root of tree.roots || []) walk(root, null);

  // Stamp the trace timestamp from the earliest span, then prepend it.
  if (earliest) traceBody.timestamp = earliest;
  events.unshift({ type: 'trace-create', body: traceBody });

  // Assign deterministic envelope ids + timestamps last (so body is final).
  const stamped = events.map((e) => ({
    id: eventId(e.type, e.body),
    type: e.type,
    timestamp: e.body.startTime || e.body.timestamp || new Date().toISOString(),
    body: e.body
  }));

  return { events: stamped, obsIndex, nodeCount: obsIndex.size };
}

/**
 * resolveGenerationReparents — PURE. Given the orchestrator obsIndex (span_id ->
 * obsId) and the list of existing Langfuse GENERATION observations in the trace
 * (the LiteLLM/S2 model calls), decide a parent observation for each so the
 * generation nests under the orchestrator node that made the call.
 *
 * Layered, deterministic resolver (no silent mis-nesting):
 *   1. metadata-span-id  — the generation carries mythos_span_id (per-generation
 *      lineage) that maps to an orchestrator node -> nest there. (most precise)
 *   2. temporal-model    — the generation's startTime falls inside an orchestrator
 *      span's [start, start+duration] window AND the models match; pick the
 *      DEEPEST such node. (used when only trace-level lineage exists)
 *   3. single-actor      — exactly one orchestrator node is a plausible model
 *      caller (a leaf, or work_class_inferred 'inference') -> nest all otherwise
 *      -unresolved generations there. (unambiguous fallback)
 *   4. unresolved        — left at its current parent (trace root); counted +
 *      surfaced, never force-nested.
 *
 * Only emits an update when the resolved parent DIFFERS from the generation's
 * current parentObservationId (no no-op churn) and never parents a node to itself.
 *
 * @param {Map<string,string>} obsIndex
 * @param {object[]} generations - Langfuse observations (type GENERATION)
 * @param {object[]} nodes       - flat list of orchestrator nodes ({span, depth})
 * @returns {{ updates: object[], report: object }}
 */
/**
 * generationSpanId — dig the emitting Mythos span id out of a Langfuse generation's
 * metadata. LiteLLM nests our P1.5 lineage under
 * `metadata.requester_metadata.trace_metadata.mythos_span_id` (verified live), so a
 * top-level check alone misses it. Checks every known shape, precise-first.
 */
function generationSpanId(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const candidates = [
    meta.mythos_span_id,
    meta.legacyMythosSpanId,
    meta.trace_metadata && meta.trace_metadata.mythos_span_id,
    meta.requester_metadata && meta.requester_metadata.trace_metadata && meta.requester_metadata.trace_metadata.mythos_span_id
  ];
  for (const c of candidates) if (c) return c;
  return null;
}

function resolveGenerationReparents(obsIndex, generations, nodes) {
  const report = { total: generations.length, byMechanism: {}, updated: 0, unresolved: 0 };
  const bump = (m) => { report.byMechanism[m] = (report.byMechanism[m] || 0) + 1; };

  // Build the temporal+model index over orchestrator nodes that have a window.
  const windowed = [];
  for (const n of nodes) {
    const s = n.span;
    if (!s.timestamp || s.duration_ms == null) continue;
    const start = Date.parse(s.timestamp);
    if (!Number.isFinite(start)) continue;
    windowed.push({
      start,
      end: start + (Number(s.duration_ms) || 0),
      model: String(s.model || '').toLowerCase(),
      depth: n.depth || 0,
      obs: obsIndex.get(s.span_id)
    });
  }

  // Single-actor candidate: exactly one plausible model-calling orchestrator node.
  const callers = nodes.filter((n) => {
    const s = n.span;
    const isLeaf = !n.children || n.children.length === 0;
    return obsIndex.get(s.span_id) && (s.work_class_inferred === 'inference' || isLeaf);
  });
  const soleCaller = callers.length === 1 ? obsIndex.get(callers[0].span.span_id) : null;

  const updates = [];
  for (const g of generations) {
    const meta = g.metadata || {};
    const current = g.parentObservationId || null;
    let parent = null;
    let mechanism = null;

    // 1. per-generation metadata lineage (incl. LiteLLM's nested shape).
    const spanId = generationSpanId(meta);
    if (spanId && obsIndex.has(spanId)) {
      parent = obsIndex.get(spanId);
      mechanism = 'metadata-span-id';
    }

    // 2. temporal + model containment (deepest match).
    if (!parent && g.startTime) {
      const t = Date.parse(g.startTime);
      const gModel = String(g.model || '').toLowerCase();
      let best = null;
      for (const w of windowed) {
        if (!w.obs) continue;
        if (!(Number.isFinite(t) && t >= w.start && t <= w.end)) continue;
        if (gModel && w.model && !(gModel.includes(w.model) || w.model.includes(gModel))) continue;
        if (!best || w.depth > best.depth) best = w;
      }
      if (best) { parent = best.obs; mechanism = 'temporal-model'; }
    }

    // 3. unambiguous single-actor fallback.
    if (!parent && soleCaller) {
      parent = soleCaller;
      mechanism = 'single-actor';
    }

    if (!parent) { report.unresolved++; bump('unresolved'); continue; }
    if (parent === g.id) { report.unresolved++; bump('self-skip'); continue; } // never self-parent
    bump(mechanism);
    if (parent === current) continue; // already correctly nested — no-op
    updates.push({
      id: eventId('generation-update', { id: g.id, parentObservationId: parent }),
      type: 'generation-update',
      timestamp: g.startTime || new Date().toISOString(),
      body: { id: g.id, traceId: g.traceId || undefined, parentObservationId: parent }
    });
    report.updated++;
  }
  return { updates, report };
}

/** flatten a tree to a list of nodes (depth carried). */
function flattenNodes(tree) {
  const out = [];
  const walk = (n) => { out.push(n); for (const c of n.children) walk(c); };
  for (const r of tree.roots || []) walk(r);
  return out;
}

// ---- network side (kept thin; pure builders above are the tested core) -----

function authHeader(publicKey, secretKey) {
  return 'Basic ' + Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
}

async function postIngestion(host, publicKey, secretKey, events) {
  const url = `${String(host).replace(/\/+$/, '')}/api/public/ingestion`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(publicKey, secretKey)
    },
    body: JSON.stringify({ batch: events })
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-json (e.g. 207 with text) */ }
  return { status: res.status, body };
}

/** Fetch all GENERATION observations for a trace (paginated). */
async function fetchTraceGenerations(host, publicKey, secretKey, traceId, { limit = 100, maxPages = 20 } = {}) {
  const base = String(host).replace(/\/+$/, '');
  const auth = authHeader(publicKey, secretKey);
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/api/public/observations?traceId=${encodeURIComponent(traceId)}&type=GENERATION&limit=${limit}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (res.status !== 200) return { ok: false, status: res.status, generations: out };
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    const data = (body && Array.isArray(body.data)) ? body.data : [];
    out.push(...data);
    const totalPages = body && body.meta ? body.meta.totalPages : 1;
    if (!data.length || page >= (totalPages || 1)) break;
  }
  return { ok: true, status: 200, generations: out };
}

// C3: encode the post-flush delayed later-pass. LiteLLM flushes its model-call
// generations SECONDS AFTER the call returns, so a same-breath export re-parents
// nothing (the generations are not in Langfuse yet); an idempotent later pass
// — after a settle delay — re-fetches them and nests them. This planner lets a
// LIVE run schedule that later pass automatically, so the operator no longer
// runs the exporter twice by hand. It does NOT change OFF-by-default: a dry-run
// is always one no-sleep pass; this only governs how an already-enabled run
// sequences its idempotent passes.
function computePassPlan({ enable = false, passes, settleMs, singlePass = false } = {}) {
  if (!enable || singlePass) return { passes: 1, settleMs: 0 };
  const p = Number.isFinite(passes) && passes >= 1 ? Math.floor(passes) : 2; // default 2 passes
  let s = Number.isFinite(settleMs) ? Math.floor(settleMs) : 20000;          // default 20s settle
  if (s < 0) s = 0;
  // A multi-pass plan with no settle is pointless — the 2nd pass would see the
  // same un-flushed state — so collapse it to a single pass.
  if (p > 1 && s === 0) return { passes: 1, settleMs: 0 };
  return { passes: p, settleMs: s };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

module.exports = {
  // pure (tested)
  computePassPlan,
  sleep,
  spanMetadata,
  buildIngestionEvents,
  resolveGenerationReparents,
  generationSpanId,
  flattenNodes,
  obsId,
  eventId,
  stableStringify,
  nodeName,
  levelFor,
  // network
  authHeader,
  postIngestion,
  fetchTraceGenerations,
  TRACE_NAME
};
