#!/usr/bin/env node
'use strict';

/**
 * query.cjs — P2 trace store query interface (machine-facing).
 *
 * Given a trace_id (or 'latest'), returns the assembled cascade tree + per-node
 * fields (actor, command/routing, model, parent, timing, cost/tokens) and the
 * signal/debrief/escalation correlate join. Pure read over the authoritative
 * append-only dispatches.jsonl store (+ rotated siblings).
 *
 * Usage:
 *   node query.cjs --trace <id|latest> [--json] [--file <path>]
 *   node query.cjs --list [--json]
 */

const {
  loadAllSpans, listTraces, queryTrace
} = require('./lib/assemble-tree.cjs');

function parseArgs(argv) {
  const out = { trace: null, list: false, json: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trace') out.trace = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '--json') out.json = true;
    else if (a === '--file') out.file = argv[++i];
  }
  return out;
}

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Flatten a node tree into a list of per-node field records (machine-facing).
function flattenNodes(node, acc = []) {
  const s = node.span;
  acc.push({
    span_id: s.span_id,
    parent_span_id: s.parent_span_id,
    depth: node.depth,
    actor_role: s.actor_role,
    subagent_type: s.subagent_type,
    routing_decision: s.routing_decision,
    model: s.model,
    model_tier: s.model_tier,
    host: s.host,
    session_id: s.session_id,
    scope_identity: s.scope_identity,
    timestamp: s.timestamp,
    duration_ms: s.duration_ms,
    total_tokens: s.total_tokens,
    tokens_in: s.tokens_in,
    tokens_out: s.tokens_out,
    cost: s.cost,
    tool_uses: s.tool_uses,
    work_class_inferred: s.work_class_inferred,
    status: s.status,
    emit_source: s.emit_source,
    actor_reason: s.actor_reason,
    orphan: Boolean(node._orphan),
    child_count: node.children.length
  });
  for (const c of node.children) flattenNodes(c, acc);
  return acc;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const { spans, files, parseErrors } = loadAllSpans(PROJECT_ROOT, args.file);
    const traces = listTraces(spans);
    if (args.json) {
      process.stdout.write(JSON.stringify({ files, parseErrors, traces }, null, 2) + '\n');
    } else {
      process.stdout.write(`Traces (${traces.length}) across ${files.length} file(s):\n`);
      for (const t of traces) {
        process.stdout.write(
          `  ${t.trace_id}  spans=${t.span_count} roots=${t.root_count} latest=${t.latest_ts || '?'}`
          + (t.scope ? ` scope=${t.scope}` : '') + '\n'
        );
      }
    }
    process.exit(0);
  }

  const res = queryTrace(PROJECT_ROOT, args.trace || 'latest', { file: args.file });
  if (!res.ok) {
    if (args.json) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    } else {
      process.stderr.write(`No trace: ${res.reason}` + (res.trace_id ? ` (${res.trace_id})` : '') + '\n');
    }
    process.exit(res.reason === 'no-traces' ? 0 : 1);
  }

  const nodes = res.tree.roots.flatMap((r) => flattenNodes(r));
  const payload = {
    trace_id: res.trace_id,
    files: res.files,
    parse_errors: res.parseErrors,
    stats: res.tree.stats,
    economics: res.economics,
    orphans: res.tree.orphans,
    correlates: res.correlates,
    nodes
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(`trace ${res.trace_id}\n`);
    process.stdout.write(`  nodes=${res.tree.stats.node_count} max_depth=${res.tree.stats.max_depth} `
      + `tokens=${res.economics.tokens} model_calls=${res.economics.model_calls} tool_uses=${res.economics.tool_uses}\n`);
    if (res.tree.orphans.length) process.stdout.write(`  orphans=${res.tree.orphans.length}\n`);
    const c = res.correlates || {};
    process.stdout.write(`  correlates: signals=${(c.signals || []).length} debriefs=${(c.debriefs || []).length} escalations=${(c.escalations || []).length}\n`);
    for (const n of nodes) {
      process.stdout.write(`  ${'  '.repeat(n.depth)}- [${n.actor_role || '?'}/${n.subagent_type || '?'}] `
        + `${n.model || 'no-model'} ${n.routing_decision || ''} tok=${n.total_tokens ?? '·'}\n`);
    }
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { flattenNodes };
