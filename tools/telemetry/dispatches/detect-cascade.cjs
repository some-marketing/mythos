#!/usr/bin/env node
'use strict';

/**
 * detect-cascade.cjs — CLI runner for P4 cascade detectors.
 *
 * Runs the detector taxonomy over a trace (or the latest trace in the store)
 * and prints findings using the Required-Labels format:
 *   Observation:        raw span facts
 *   HYPOTHESIS:         rule-mismatch inference
 *   Evidence Locations: cited policy file:line
 *
 * CONSTITUTIONAL INVARIANT: exit 0 regardless of findings. Findings are
 * evidence, not a failing gate. This tool is a PASSIVE SENSOR — it never
 * blocks, never mutates dispatches.jsonl or any execution state, and never
 * ranks an actor as a verdict.
 *
 * Usage:
 *   node detect-cascade.cjs [--trace <trace_id>|latest] [--file <path>] [--json]
 *
 * Options:
 *   --trace <id>   Specific trace_id or 'latest' (default: latest)
 *   --file <path>  Override dispatches.jsonl path
 *   --json         Output findings as JSON array
 */

const path = require('path');
const { queryTrace } = require('./lib/assemble-tree.cjs');
const { runDetectors, loadCorpusThresholds } = require('./lib/detectors.cjs');

function parseArgs(argv) {
  const out = { trace: 'latest', file: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trace' && argv[i + 1]) out.trace = argv[++i];
    else if (argv[i] === '--file' && argv[i + 1]) out.file = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function renderFinding(f, idx) {
  const lines = [];
  lines.push(`[${idx + 1}] detector=${f.detector} stability=${f.stability_label}`);
  lines.push(`  span: trace_id=${f.span_ref.trace_id || 'null'} span_id=${f.span_ref.span_id || 'null'} model=${f.span_ref.model || 'null'}`);
  lines.push(`  ${f.observation}`);
  lines.push(`  ${f.hypothesis}`);
  lines.push(`  Evidence Locations:`);
  for (const loc of f.evidence_locations) {
    lines.push(`    - ${loc}`);
  }
  return lines.join('\n');
}

function renderReport(findings, traceId, thresholds) {
  const header = [
    'Cascade Detector Report (P4)',
    '============================',
    `trace_id: ${traceId || 'unknown'}`,
    `findings: ${findings.length}`,
    `thresholds: ${thresholds ? `N_spans=${thresholds.N_spans} M_sessions=${thresholds.M_sessions}` : 'UNSET (all findings experimental)'}`,
    ''
  ];

  if (findings.length === 0) {
    return [...header, 'No findings. All detectors returned clean.'].join('\n');
  }

  const sections = findings.map((f, i) => renderFinding(f, i));
  return [...header, ...sections].join('\n\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const queryResult = queryTrace(projectRoot, args.trace, {
    file: args.file || null,
    skipCorrelates: true
  });

  if (!queryResult.ok) {
    const msg = `detect-cascade: ${queryResult.reason} (trace=${args.trace})`;
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, reason: queryResult.reason, findings: [] }, null, 2) + '\n');
    } else {
      process.stdout.write(msg + '\n');
    }
    process.exit(0); // passive — exit 0 even when no trace found
  }

  const thresholds = loadCorpusThresholds(projectRoot);
  const findings = runDetectors(queryResult.tree, { thresholds });

  if (args.json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      trace_id: queryResult.trace_id,
      finding_count: findings.length,
      thresholds_set: thresholds !== null,
      findings
    }, null, 2) + '\n');
  } else {
    process.stdout.write(renderReport(findings, queryResult.trace_id, thresholds) + '\n');
  }

  process.exit(0); // ALWAYS exit 0 — passive sensor, findings are not a gate
}

if (require.main === module) {
  main();
}

module.exports = { renderFinding, renderReport };
