#!/usr/bin/env node
'use strict';

/**
 * export-to-langfuse.mjs — P3a CLI. Push ONE cascade's orchestrator spans into
 * the existing Langfuse trace (id === correlation_id) so the trace renders as a
 * single tree: coordinator -> worker -> reviewer WITH the LiteLLM model-call
 * generations (tokens/cost) nested underneath.
 *
 * The native append-only dispatches.jsonl stays authoritative. Langfuse is a
 * render adopt-surface only. This exporter is OFF by default: it dry-runs (builds
 * + reports the batch, no network write) unless you pass --enable (or set
 * MYTHOS_LANGFUSE_EXPORT to a truthy value).
 *
 * Credentials are read from the environment only; nothing is printed. Resolve
 * them with the runner, which never lets key bytes touch argv/stdout/logs:
 *
 *   tools/telemetry/dispatches/run-export-with-op.sh --trace latest --enable
 *
 * Or supply them yourself (e.g. over the tailnet):
 *   LANGFUSE_HOST=http://${TELEMETRY_HOST}:3000 \
 *   LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
 *   node tools/telemetry/dispatches/export-to-langfuse.mjs --trace latest --enable
 *
 * Usage:
 *   node export-to-langfuse.mjs [--trace <id|latest>] [--file <path>]
 *                               [--enable] [--no-reparent] [--json]
 *                               [--passes <n>] [--settle-ms <n>] [--single-pass]
 *
 * C3 delayed later-pass: when --enable'd, the exporter runs 2 passes by default
 * with a 20s settle between them (override --passes / --settle-ms, or env
 * MYTHOS_LANGFUSE_SETTLE_MS), so the generations LiteLLM flushes a few seconds
 * after the call get re-parented/nested WITHOUT a manual second run. Pass
 * --single-pass for the old one-shot behavior. Dry-run is always a single pass.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { queryTrace } = require('./lib/assemble-tree.cjs');
const {
  buildIngestionEvents,
  resolveGenerationReparents,
  flattenNodes,
  postIngestion,
  fetchTraceGenerations,
  computePassPlan,
  sleep
} = require('./lib/langfuse-export.cjs');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function parseArgs(argv) {
  const out = { trace: 'latest', file: null, enable: false, reparent: true, json: false,
    passes: undefined, settleMs: undefined, singlePass: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trace') out.trace = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--enable') out.enable = true;
    else if (a === '--no-reparent') out.reparent = false;
    else if (a === '--reparent') out.reparent = true;
    else if (a === '--json') out.json = true;
    else if (a === '--passes') out.passes = parseInt(argv[++i], 10);
    else if (a === '--settle-ms') out.settleMs = parseInt(argv[++i], 10);
    else if (a === '--single-pass') out.singlePass = true;
  }
  const envEnable = String(process.env.MYTHOS_LANGFUSE_EXPORT || '').trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(envEnable)) out.enable = true;
  // C3: settle delay defaults from env when not passed (the runner / launchd can
  // set MYTHOS_LANGFUSE_SETTLE_MS without changing argv).
  if (out.settleMs === undefined && process.env.MYTHOS_LANGFUSE_SETTLE_MS) {
    out.settleMs = parseInt(process.env.MYTHOS_LANGFUSE_SETTLE_MS, 10);
  }
  return out;
}

function emit(obj, asJson) {
  if (asJson) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); return; }
  process.stdout.write(formatHuman(obj) + '\n');
}

function formatHuman(o) {
  const L = [];
  L.push(`P3a Langfuse export — cascade ${o.trace_id}`);
  L.push(`  mode:        ${o.enabled ? 'LIVE (posting)' : 'DRY-RUN (no write; pass --enable to push)'}`);
  L.push(`  orchestrator nodes: ${o.orchestrator_nodes}  (depth ${o.max_depth}, ${o.orphan_edges} orphan edge(s))`);
  L.push(`  span-create events: ${o.span_events}   trace-create: 1`);
  if (o.reparent) {
    const r = o.reparent_report || {};
    L.push(`  generations in trace: ${r.total != null ? r.total : 'n/a'}  -> re-parent updates: ${o.reparent_updates}`);
    if (r.byMechanism) L.push(`     by mechanism: ${JSON.stringify(r.byMechanism)} (unresolved left at trace root: ${r.unresolved})`);
    // C3: a generation-fetch failure must NOT read as a clean nest (no silent loss).
    if (r.error) L.push(`  !! re-parent SKIPPED — generation fetch failed: ${r.error}  (generations did NOT nest; re-run after the host is reachable)`);
  }
  if (o.passes_planned > 1) L.push(`  passes: ${o.passes_planned} (settle ${o.settle_ms}ms between — automated post-flush later-pass)`);
  L.push(`  total ingestion events: ${o.total_events}`);
  if (o.enabled) {
    L.push(`  POST ${o.ingestion_status}  ${o.ingestion_status >= 200 && o.ingestion_status < 300 ? 'OK' : 'FAILED'}`);
    L.push(`  Langfuse host: ${o.langfuse_host}`);
    L.push(`  Verify:  GET ${o.langfuse_host}/api/public/traces/${o.trace_id}`);
    L.push(`  Open in UI: ${o.langfuse_host}  (find trace id ${o.trace_id})`);
  } else if (o.sample_event) {
    L.push(`  sample event: ${JSON.stringify(o.sample_event)}`);
  }
  return L.join('\n');
}

function fail(msg, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, blocker: msg, ...extra }, null, 2) + '\n');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const res = queryTrace(PROJECT_ROOT, args.trace, { file: args.file });
  if (!res.ok) {
    fail(`no cascade to export: ${res.reason}`, {
      trace_id: res.trace_id || null,
      available: (res.traces || []).slice(0, 10).map((t) => ({ trace_id: t.trace_id, spans: t.span_count, latest: t.latest_ts }))
    });
  }

  const built = buildIngestionEvents(res.tree, res.trace_id, {
    economics: res.economics,
    correlates: res.correlates,
    scope: res.tree.roots.length ? res.tree.roots[0].span.scope_identity : null
  });

  const report = {
    ok: true,
    trace_id: res.trace_id,
    enabled: args.enable,
    reparent: args.reparent,
    orchestrator_nodes: built.nodeCount,
    max_depth: res.tree.stats.max_depth,
    orphan_edges: res.tree.orphans.length,
    span_events: built.events.filter((e) => e.type === 'span-create').length,
    reparent_updates: 0,
    reparent_report: null,
    total_events: built.events.length
  };

  // --- credentials (env only; never printed) ---
  const host = process.env.LANGFUSE_HOST || '';
  const pub = process.env.LANGFUSE_PUBLIC_KEY || '';
  const sec = process.env.LANGFUSE_SECRET_KEY || '';

  if (!args.enable) {
    // DRY-RUN: report what WOULD be pushed; never touch the network.
    report.sample_event = built.events[1] || built.events[0] || null;
    emit(report, args.json);
    process.exit(0);
  }

  // LIVE path requires credentials. Surface the exact one command if missing.
  if (!host || !pub || !sec) {
    fail('LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — cannot POST.', {
      fix: 'Run via the credential runner (resolves keys from 1Password without printing them):\n'
        + `  tools/telemetry/dispatches/run-export-with-op.sh --trace ${args.trace} --enable`,
      trace_id: res.trace_id
    });
  }
  report.langfuse_host = host.replace(/\/+$/, '');

  // C3: schedule the delayed idempotent later-pass automatically. LiteLLM flushes
  // its generations seconds after the call, so pass 1 creates the orchestrator
  // tree but re-parents nothing; pass 2 (after the settle delay) re-fetches the
  // now-flushed generations and nests them. The exporter stays OFF-by-default —
  // this only governs how an already-enabled (--enable) run sequences its passes.
  const plan = computePassPlan({
    enable: args.enable, passes: args.passes, settleMs: args.settleMs, singlePass: args.singlePass
  });
  report.passes_planned = plan.passes;
  report.settle_ms = plan.settleMs;

  // Interruptible: a Ctrl-C during the settle wait exits cleanly (the native
  // store is authoritative; a half-run export is harmless and idempotent).
  process.on('SIGINT', () => {
    process.stdout.write('\n[exporter] interrupted during settle wait — exiting (idempotent; safe to re-run).\n');
    process.exit(130);
  });

  const passReports = [];
  for (let p = 1; p <= plan.passes; p++) {
    if (p > 1 && plan.settleMs > 0) {
      process.stderr.write(`[exporter] pass ${p}/${plan.passes}: waiting ${plan.settleMs}ms for LiteLLM to flush generations…\n`);
      await sleep(plan.settleMs);
    }
    // Rebuild the batch each pass: span-create ids are content-stable so Langfuse
    // de-dups them, and the re-parent is recomputed against the now-current
    // generation set — that is what makes the later pass nest.
    let passEvents = built.events.slice();
    let reparentUpdates = 0;
    let reparentReport = null;
    if (args.reparent) {
      const gens = await fetchTraceGenerations(host, pub, sec, res.trace_id);
      if (gens.ok) {
        const nodes = flattenNodes(res.tree);
        const { updates, report: rr } = resolveGenerationReparents(built.obsIndex, gens.generations, nodes);
        reparentReport = rr;
        reparentUpdates = updates.length;
        passEvents = passEvents.concat(updates);
      } else {
        reparentReport = { error: `observations fetch HTTP ${gens.status}`, total: null };
      }
    }
    const resp = await postIngestion(host, pub, sec, passEvents);
    const passReport = {
      pass: p,
      reparent_updates: reparentUpdates,
      reparent_report: reparentReport,
      total_events: passEvents.length,
      ingestion_status: resp.status,
      ok: resp.status >= 200 && resp.status < 300
    };
    if (resp.body && Array.isArray(resp.body.errors) && resp.body.errors.length) {
      passReport.ingestion_errors = resp.body.errors.slice(0, 5);
    }
    passReports.push(passReport);
  }

  // The LAST pass is the authoritative nested state.
  const finalPass = passReports[passReports.length - 1];
  report.reparent_updates = finalPass.reparent_updates;
  report.reparent_report = finalPass.reparent_report;
  report.total_events = finalPass.total_events;
  report.ingestion_status = finalPass.ingestion_status;
  if (finalPass.ingestion_errors) report.ingestion_errors = finalPass.ingestion_errors;
  report.passes = passReports;
  report.ok = finalPass.ok;

  // C3 (codex MAJOR): a re-parent fetch failure on the FINAL pass means the
  // generations never nested — the whole point of the later-pass. Do not exit 0
  // and look clean; mark the run failed so the operator knows to re-run.
  if (args.reparent && finalPass.reparent_report && finalPass.reparent_report.error) {
    report.reparent_failed = true;
    report.ok = false;
  }

  emit(report, args.json);
  process.exit(report.ok ? 0 : 2);
}

main().catch((err) => fail(`exporter threw: ${err.message}`, { stack: err.stack }));
