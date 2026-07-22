'use strict';

/**
 * assemble-tree.cjs — P2 trace store / query layer (read side).
 *
 * The STORE is the existing append-only `dispatches.jsonl` (+ rotated siblings);
 * P2 adds NO parallel store (concept §"No parallel schema"). This module is the
 * authoritative-truth READER: it loads every span row, assembles the cascade
 * tree for a trace_id, and joins the tree back to the signal / debrief /
 * escalation surfaces by `correlation_id`.
 *
 * Robustness the council named:
 *  - **rotation-without-orphaning**: rotation renames `dispatches.jsonl` ->
 *    `dispatches.<date>.jsonl` at 50MB. A cascade whose root landed in the
 *    rotated file but whose children land in the live file would otherwise have
 *    a broken tree. We fix it on the READ side: `loadAllSpans` merges the live
 *    file with ALL rotated siblings, so a trace spanning a rotation still
 *    assembles into one tree. Cross-file orphans are surfaced explicitly,
 *    never silently dropped.
 *  - **host/session fields**: carried through per node verbatim from the schema.
 *  - **append-locking**: handled on the write side (lib/append-lock.cjs).
 */

const fs = require('fs');
const path = require('path');

function telemetryDir(projectRoot) {
  const root = projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(root, '_dev/reports/telemetry');
}

/**
 * dispatchFiles — the live log plus every rotated sibling
 * (`dispatches.<YYYY-MM-DD>.jsonl`), sorted live-last so the newest rows win on
 * tie. Returns absolute paths that exist.
 */
function dispatchFiles(projectRoot, overrideFile) {
  if (overrideFile) {
    return fs.existsSync(overrideFile) ? [path.resolve(overrideFile)] : [];
  }
  const dir = telemetryDir(projectRoot);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  const rotated = names
    .filter((n) => /^dispatches\.\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .sort(); // date-lexical === chronological
  const files = rotated.map((n) => path.join(dir, n));
  const live = path.join(dir, 'dispatches.jsonl');
  if (fs.existsSync(live)) files.push(live); // live last (newest)
  return files.filter((f) => fs.existsSync(f));
}

/**
 * loadAllSpans — read + parse every span row across the live and rotated files.
 * Returns { spans, files, parseErrors }. Unparseable lines are counted, not
 * thrown (the store is append-only and a torn final line is possible mid-write).
 */
function loadAllSpans(projectRoot, overrideFile) {
  const files = dispatchFiles(projectRoot, overrideFile);
  const spans = [];
  let parseErrors = 0;
  for (const file of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        row.__source_file = path.basename(file);
        spans.push(row);
      } catch (_) {
        parseErrors++;
      }
    }
  }
  return { spans, files, parseErrors };
}

const UNKNOWN = 'unknown';

/**
 * listTraces — distinct real traces (excludes the declared `unknown` coverage
 * gap), each with span_count, root count, and the latest timestamp. Sorted
 * newest-first so `latest` resolution and `--list` share one ordering.
 */
function listTraces(spans) {
  const byTrace = new Map();
  for (const s of spans) {
    const t = s.trace_id || UNKNOWN;
    if (t === UNKNOWN) continue;
    if (!byTrace.has(t)) byTrace.set(t, []);
    byTrace.get(t).push(s);
  }
  const out = [];
  for (const [trace_id, rows] of byTrace) {
    const roots = rows.filter((r) => !r.parent_span_id || (r.layer_depth || 0) === 0);
    let latest = '';
    for (const r of rows) if (r.timestamp && r.timestamp > latest) latest = r.timestamp;
    out.push({
      trace_id,
      span_count: rows.length,
      root_count: roots.length,
      latest_ts: latest || null,
      scope: (rows.find((r) => r.scope_identity) || {}).scope_identity || null
    });
  }
  out.sort((a, b) => String(b.latest_ts || '').localeCompare(String(a.latest_ts || '')));
  return out;
}

/**
 * latestTraceId — the trace_id carrying the most recent span timestamp. Honors
 * the same exclusion of the `unknown` coverage gap.
 */
function latestTraceId(spans) {
  const traces = listTraces(spans);
  return traces.length ? traces[0].trace_id : null;
}

/**
 * assembleTrace — build the cascade tree for one trace_id.
 *
 * Edges: child.parent_span_id === parent.span_id. Roots = layer_depth 0 OR a
 * parent_span_id that resolves to no in-trace span. A node whose declared parent
 * is missing from this trace is an ORPHAN — re-parented to a synthetic root and
 * reported (never dropped). De-dups by span_id (idempotent re-emits / rotation
 * overlap), newest-by-timestamp wins.
 *
 * Returns { trace_id, found, roots, nodesById, orphans, stats }.
 *   node = { span, children: [node], depth }
 */
function assembleTrace(spans, traceId) {
  const rows = spans.filter((s) => (s.trace_id || UNKNOWN) === traceId);
  const result = {
    trace_id: traceId,
    found: rows.length > 0,
    roots: [],
    nodesById: new Map(),
    orphans: [],
    stats: { span_count: rows.length, node_count: 0, max_depth: 0, anon_count: 0 }
  };
  if (!rows.length) return result;

  // De-dup by span_id (keep newest). Rows with a null span_id (e.g. legacy
  // subagent-telemetry-writer rows that share a trace) are kept individually
  // under a synthetic key so they still render rather than collapsing into one.
  const bySpanId = new Map();
  let anon = 0;
  for (const r of rows) {
    const key = r.span_id || `__anon_${anon++}`;
    const prev = bySpanId.get(key);
    if (!prev || String(r.timestamp || '') >= String(prev.timestamp || '')) {
      bySpanId.set(key, r);
    }
  }
  result.stats.anon_count = anon;

  // Build node wrappers.
  const nodes = new Map();
  for (const [key, span] of bySpanId) {
    nodes.set(key, { span, children: [], depth: 0, _key: key });
  }
  result.nodesById = nodes;

  // Wire edges. A node is a root when it has no parent_span_id, OR its declared
  // parent is not present in this trace (cross-file / cross-trace orphan).
  const roots = [];
  for (const [key, node] of nodes) {
    const pid = node.span.parent_span_id;
    // Root rule (matches the documented contract): a node with no parent OR
    // layer_depth 0 is a root. The depth-0 override is defensive — by schema a
    // depth-0 span IS a cascade root, so a malformed/repaired row that carries
    // both layer_depth 0 and a present parent_span_id still roots rather than
    // silently attaching mid-tree (codex review: MINOR contract-drift fix).
    if (!pid || (node.span.layer_depth || 0) === 0) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(pid);
    if (parent) {
      parent.children.push(node);
    } else {
      // Declared parent missing from this trace — orphan. Surface it and attach
      // to roots so it still renders (rotation-without-orphaning visibility).
      result.orphans.push({
        span_id: node.span.span_id || null,
        parent_span_id: pid,
        layer_depth: node.span.layer_depth || 0,
        emit_source: node.span.emit_source || null,
        source_file: node.span.__source_file || null
      });
      node._orphan = true;
      roots.push(node);
    }
  }

  // Sort children by timestamp for stable, chronological rendering.
  const tsKey = (n) => String(n.span.timestamp || '');
  const sortRec = (node, depth) => {
    node.depth = depth;
    result.stats.max_depth = Math.max(result.stats.max_depth, depth);
    node.children.sort((a, b) => tsKey(a).localeCompare(tsKey(b)));
    for (const c of node.children) sortRec(c, depth + 1);
  };
  roots.sort((a, b) => tsKey(a).localeCompare(tsKey(b)));
  for (const r of roots) sortRec(r, 0);

  result.roots = roots;
  result.stats.node_count = nodes.size;
  return result;
}

/**
 * sumTree — recursive economics rollup for a node and its subtree.
 * Returns { tokens, cost, model_calls, tool_uses, node_count }.
 * A "model call" = a node with work_class_inferred === 'inference' (tokens > 0).
 */
function sumTree(node) {
  const acc = { tokens: 0, cost: 0, model_calls: 0, tool_uses: 0, node_count: 0 };
  const walk = (n) => {
    acc.node_count++;
    const s = n.span;
    const tot = Number(s.total_tokens) || ((Number(s.tokens_in) || 0) + (Number(s.tokens_out) || 0));
    acc.tokens += tot;
    acc.cost += Number(s.cost) || 0;
    acc.tool_uses += Number(s.tool_uses) || 0;
    if (s.work_class_inferred === 'inference' || tot > 0) acc.model_calls++;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return acc;
}

/**
 * loadCorrelates — join the assembled trace back to the signal / debrief /
 * escalation surfaces by `correlation_id`.
 *
 * Join key (physical-equivalence contract): a span's correlation_id === its
 * trace_id, which inside a coordination loop === the parent signal's
 * `lineage_root_session_id`. So we match any signal/debrief whose
 * lineage_root_session_id / produced_by_session_id / correlation_id equals the
 * trace_id. Pure read; never mutates a surface. Files lacking the key are not a
 * defect — most live signals predate the keystone (a declared join gap).
 */
function loadCorrelates(projectRoot, traceId, opts = {}) {
  const root = projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const out = { signals: [], debriefs: [], escalations: [], join_key: traceId };
  if (!traceId || traceId === UNKNOWN) return out;

  const matchKey = (obj) =>
    obj && (
      obj.lineage_root_session_id === traceId ||
      obj.produced_by_session_id === traceId ||
      obj.correlation_id === traceId ||
      obj.trace_id === traceId
    );

  // Signals (and escalations, which live in the same signal surface).
  const signalsDir = path.join(root, '_dev/reports/signals');
  let signalNames = [];
  try { signalNames = fs.readdirSync(signalsDir); } catch (_) { signalNames = []; }
  for (const name of signalNames) {
    if (!name.endsWith('.json')) continue;
    let obj;
    try { obj = JSON.parse(fs.readFileSync(path.join(signalsDir, name), 'utf8')); }
    catch (_) { continue; }
    if (!matchKey(obj)) continue;
    const rec = {
      file: name,
      signal_type: obj.signal_type || obj.type || null,
      scope: obj.scope || obj.signal_scope || null,
      lifecycle_state: obj.lifecycle_state || null
    };
    if (/escal/i.test(rec.signal_type || '') || /escal/i.test(name)) out.escalations.push(rec);
    else out.signals.push(rec);
  }

  // Debriefs — markdown bodies that may carry the correlation id inline.
  if (opts.scanDebriefs !== false) {
    const debriefDir = path.join(root, '_dev/reports/debriefs');
    let debriefNames = [];
    try { debriefNames = fs.readdirSync(debriefDir); } catch (_) { debriefNames = []; }
    for (const name of debriefNames) {
      if (!/\.(md|json)$/.test(name)) continue;
      let body = '';
      try { body = fs.readFileSync(path.join(debriefDir, name), 'utf8'); }
      catch (_) { continue; }
      if (body.includes(traceId)) {
        out.debriefs.push({ file: name, match: 'correlation_id-in-body' });
      }
    }
  }

  return out;
}

/**
 * queryTrace — the one-call query API. Resolves 'latest' to the newest trace,
 * assembles the tree, attaches correlate joins and a subtree economics rollup.
 */
function queryTrace(projectRoot, traceArg, opts = {}) {
  const { spans, files, parseErrors } = loadAllSpans(projectRoot, opts.file);
  let traceId = traceArg;
  if (!traceArg || traceArg === 'latest') traceId = latestTraceId(spans);
  if (!traceId) {
    return { ok: false, reason: 'no-traces', files, parseErrors, traces: listTraces(spans) };
  }
  const tree = assembleTrace(spans, traceId);
  if (!tree.found) {
    return { ok: false, reason: 'trace-not-found', trace_id: traceId, files, parseErrors, traces: listTraces(spans) };
  }
  const correlates = opts.skipCorrelates ? null : loadCorrelates(projectRoot, traceId, opts);
  const economics = tree.roots.map((r) => sumTree(r)).reduce((a, b) => ({
    tokens: a.tokens + b.tokens, cost: a.cost + b.cost,
    model_calls: a.model_calls + b.model_calls, tool_uses: a.tool_uses + b.tool_uses,
    node_count: a.node_count + b.node_count
  }), { tokens: 0, cost: 0, model_calls: 0, tool_uses: 0, node_count: 0 });
  return { ok: true, trace_id: traceId, tree, correlates, economics, files, parseErrors };
}

module.exports = {
  dispatchFiles,
  loadAllSpans,
  listTraces,
  latestTraceId,
  assembleTrace,
  sumTree,
  loadCorrelates,
  queryTrace
};
