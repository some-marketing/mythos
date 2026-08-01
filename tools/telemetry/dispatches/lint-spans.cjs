#!/usr/bin/env node
'use strict';

/**
 * lint-spans.cjs — CI lint over dispatches.jsonl (P1 tripwire).
 *
 * Tripwire (failure mode "root-trace-only seeding"): a non-root span with a null
 * parent_span_id is an orphan — it looks instrumented but has no tree edge. This
 * lint flags every such row.
 *
 * A "non-root" row = layer_depth > 0 (a child of something). A child MUST carry
 * its parent_span_id. A genuine root row (layer_depth 0, parent_span_id null) is
 * fine and is NOT flagged.
 *
 * Coverage gap (NOT a violation — a DECLARED, NAMED gap, never silent): rows with
 * trace_id "unknown" come from uninstrumented paths — the in-harness Agent/Task
 * memory-transition path and pre-keystone legacy rows (OMEGA: Claude SubagentStop
 * and the in-session tool path bypass the shared shell boundary). These are
 * counted and reported, never silently dropped and never counted as instrumented.
 *
 * Default: report-only (exit 0). With --enforce: exit 1 if any violation exists.
 *
 * Usage: node lint-spans.cjs [--enforce] [--json] [--file <path>]
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { enforce: false, json: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--enforce') out.enforce = true;
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--file') out.file = argv[++i];
  }
  return out;
}

function lintSpans(logFile) {
  const result = {
    total: 0,
    instrumented: 0,
    roots: 0,
    coverage_gap_rows: 0, // trace_id "unknown" — declared in-harness/legacy gap
    violations: []        // non-root rows missing parent_span_id
  };

  if (!fs.existsSync(logFile)) {
    return result;
  }

  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  result.total = lines.length;

  lines.forEach((line, idx) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch (_) {
      return; // unparseable line — skip (not a span)
    }

    const traceId = row.trace_id || 'unknown';
    const depth = typeof row.layer_depth === 'number' ? row.layer_depth : 0;

    if (traceId === 'unknown') {
      // Declared, named coverage gap — counted, never flagged, never silent.
      result.coverage_gap_rows++;
      return;
    }

    result.instrumented++;

    const isRoot = depth === 0;
    if (isRoot) {
      result.roots++;
      return;
    }

    // Non-root (a child): MUST carry parent_span_id.
    if (!row.parent_span_id) {
      result.violations.push({
        line: idx + 1,
        trace_id: traceId,
        span_id: row.span_id || null,
        layer_depth: depth,
        emit_source: row.emit_source || null,
        reason: 'non-root span has null parent_span_id (orphan edge)'
      });
    }
  });

  return result;
}

function formatReport(r) {
  const lines = [];
  lines.push('Span Lineage Lint (dispatches.jsonl)');
  lines.push('====================================');
  lines.push(`Total rows:            ${r.total}`);
  lines.push(`Instrumented rows:     ${r.instrumented}`);
  lines.push(`  root spans:          ${r.roots}`);
  lines.push(`Coverage-gap rows:     ${r.coverage_gap_rows}  (trace_id "unknown" — declared in-harness/legacy gap, NOT a violation)`);
  lines.push(`Violations:            ${r.violations.length}  (non-root rows with null parent_span_id)`);
  if (r.violations.length) {
    lines.push('');
    for (const v of r.violations.slice(0, 50)) {
      lines.push(`  ✗ line ${v.line}: trace=${v.trace_id} span=${v.span_id} depth=${v.layer_depth} src=${v.emit_source} — ${v.reason}`);
    }
    if (r.violations.length > 50) lines.push(`  … and ${r.violations.length - 50} more`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const logFile = args.file
    ? path.resolve(args.file)
    : path.join(projectRoot, '_dev/reports/telemetry/dispatches.jsonl');

  const r = lintSpans(logFile);

  if (args.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(r) + '\n');
  }

  if (args.enforce && r.violations.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { lintSpans };
