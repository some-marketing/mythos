#!/usr/bin/env node
'use strict';

/**
 * broker-probe.cjs — a minimal, REAL broker-shaped read-only call-site.
 *
 * This is the P0 "one broker-shaped path (read-only) to emit the same span shape"
 * (sovereign-core-harness plan P0 step 3). It is a genuine executable, not a test
 * fixture: it performs an actual read-only action (stat + line/byte count of a
 * repo file) and emits ONE CascadeSpan/1.0 via the canonical fromBrokerAction
 * adapter, landing it in the same durable sink the Claude-hook close path uses.
 *
 * It is deliberately Tool-Broker-shaped: the "action" is classified at
 * permission phase 1 (read-only) and ruled 'allow' — the starting posture of the
 * 4-phase permission staging. It has ZERO system authority beyond reading one
 * file; it never writes to, or mutates, the target. Lineage is CONSUMED from the
 * owner's trace context (trace-context.cjs), so a probe run inside a live cascade
 * shares span_id/parent/trace/scope with its siblings.
 *
 * Usage:
 *   node tools/kernel/cascade-span/broker-probe.cjs [--path <file>] [--json]
 *   node tools/kernel/cascade-span/broker-probe.cjs --no-emit   # build span, don't persist
 *
 * Exit code is 0 when the read-only action succeeded (verdict allow), 1 on a read
 * error. Emission failure never changes the exit code (fail-open sink).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cascadeSpan = require('./cascade-span.js');
const { getTraceContext } = require('../../telemetry/dispatches/lib/trace-context.cjs');

/**
 * runProbe — build (and optionally emit) a broker-path CascadeSpan for a
 * read-only stat of `targetPath`. Returns { span, observation, logPath }.
 * emit=false builds the span without persisting (used by parity tests that
 * inspect the span object directly).
 */
function runProbe(opts = {}) {
  const targetPath = opts.path
    ? path.resolve(opts.path)
    : cascadeSpan.SCHEMA_PATH;
  const startedAt = opts.now || new Date().toISOString();

  const observation = { target: targetPath, ok: true, size_bytes: null, line_count: null, error: null };
  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    observation.size_bytes = Buffer.byteLength(content, 'utf8');
    observation.line_count = content.length ? content.split('\n').length : 0;
  } catch (err) {
    observation.ok = false;
    observation.error = err.message;
  }

  const trace = getTraceContext();
  const traceId = trace.trace_id && trace.trace_id !== 'unknown'
    ? trace.trace_id
    : (trace.session_id || null);
  const endedAt = opts.now || new Date().toISOString();

  const span = cascadeSpan.fromBrokerAction({
    span_id: opts.span_id || crypto.randomUUID(),
    parent_span_id: trace.span_id || null,
    trace_id: traceId,
    scope_identity: trace.scope_identity || null,
    work_unit: trace.step_id || null,
    lineage_root: trace.lineage_root_session_id || trace.session_id || null,
    adapter_role: 'broker-probe',
    model_family: opts.model_family || null,
    tool: 'fs.readFile',
    summary: `read-only stat of ${path.basename(targetPath)}`,
    proposed_action: `fs.readFile: read-only stat of ${path.basename(targetPath)}`,
    permission_phase: 1,
    // Read-only action at the starting posture is allowed; a real read error is
    // still 'allow' (the broker permitted the read) but the observation records
    // the failure. verdict here is the permission ruling, not the IO outcome.
    decision: 'allow',
    started_at: startedAt,
    ended_at: endedAt,
    artifacts: []
  });

  let logPath = null;
  if (opts.emit !== false) {
    logPath = cascadeSpan.writeSpan(span, { projectRoot: opts.projectRoot });
  }

  return { span, observation, logPath };
}

function parseArgs(argv) {
  const opts = { emit: true, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--path') { opts.path = argv[++i]; }
    else if (a === '--no-emit') { opts.emit = false; }
    else if (a === '--json') { opts.json = true; }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { span, observation, logPath } = runProbe(opts);
  const validation = cascadeSpan.validateSpan(span);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ span, observation, logPath, validation }, null, 2) + '\n');
  } else {
    process.stdout.write(
      `[broker-probe] read-only ${observation.ok ? 'OK' : 'FAILED'} ${observation.target}\n` +
      `  size_bytes=${observation.size_bytes} line_count=${observation.line_count}\n` +
      `  span_id=${span.span_id} trace_id=${span.trace_id} enforcement_home=${span.enforcement_home} ` +
      `layer=${span.action.classified_layer} verdict=${span.action.verdict} status=${span.status}\n` +
      `  span valid=${validation.ok} (validator=${validation.validator})` +
      (validation.ok ? '' : ` errors=${validation.errors.join('; ')}`) + '\n' +
      `  emitted=${logPath || '(not emitted)'}\n`
    );
  }
  process.exit(observation.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { runProbe };
