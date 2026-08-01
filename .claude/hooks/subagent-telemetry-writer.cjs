#!/usr/bin/env node
'use strict';

/**
 * subagent-telemetry-writer.cjs — SubagentStop hook writer.
 * 
 * Captures distributed tracing context and subagent usage metrics.
 * Fail-open design: errors are logged to stderr but never block dispatches.
 */

const fs = require('fs');
const path = require('path');
const { parseUsageBlock } = require('../../tools/telemetry/dispatches/lib/parse-usage-block.cjs');
const { buildSpan } = require('../../tools/telemetry/dispatches/lib/emit-span.cjs');
const { generateId } = require('../../tools/telemetry/dispatches/lib/trace-context.cjs');
const { withFileLock } = require('../../tools/telemetry/dispatches/lib/append-lock.cjs');
const { readSessionTraceRoot } = require('../../tools/telemetry/dispatches/lib/session-trace-store.cjs');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LOG_FILE = path.join(PROJECT_ROOT, '_dev/reports/telemetry/dispatches.jsonl');
const ROTATION_THRESHOLD = 50 * 1024 * 1024; // 50MB

function rotateLogIfNecessary() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= ROTATION_THRESHOLD) {
      const date = new Date().toISOString().split('T')[0];
      const rotatedPath = path.join(PROJECT_ROOT, `_dev/reports/telemetry/dispatches.${date}.jsonl`);
      // Simple rotation: overwrite if dated file exists for that day (could be improved)
      fs.renameSync(LOG_FILE, rotatedPath);
    }
  } catch (err) {
    process.stderr.write(`[subagent-telemetry-writer] rotation failed: ${err.message}\n`);
  }
}

// Read the hook's stdin JSON payload (session_id, tool_input, tool_output).
// CLAUDE_SESSION_ID is unset in hooks; session_id arrives only on the payload.
// Fail-open: returns {} on any error / empty stdin.
function readPayload() {
  try {
    // Guard the blocking read: an interactive TTY stdin is the only thing that
    // blocks indefinitely waiting for input (pipes/sockets/files/dev-null all
    // reach EOF). Skip the read on a TTY so the hook can never hang.
    if (process.stdin.isTTY) return {};
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function main() {
  try {
    const payload = readPayload();

    // Tool input/output: prefer the payload, fall back to the legacy env vars.
    let toolInput = (payload && typeof payload.tool_input === 'object' && payload.tool_input) || null;
    if (!toolInput) {
      try { toolInput = JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}'); } catch (_) { toolInput = {}; }
    }
    let toolOutput = (payload && typeof payload.tool_output === 'object' && payload.tool_output) || null;
    if (!toolOutput) {
      try { toolOutput = JSON.parse(process.env.CLAUDE_TOOL_OUTPUT || '{}'); } catch (_) { toolOutput = {}; }
    }

    // C1: resolve THIS session's cascade root from the per-session keyed store
    // (written by SessionStart). This is the seam that gives the in-session
    // Agent/Task path real attribution — without it, buildSpan reads ambient env
    // which is `unknown` in this fresh hook process. Fail-open: a missing/corrupt
    // record yields null and we fall back to the ambient (unknown) path, never
    // throwing and never blocking the harness.
    const sessionId = (payload && payload.session_id) || process.env.CLAUDE_SESSION_ID || null;
    const root = sessionId ? readSessionTraceRoot(PROJECT_ROOT, sessionId) : null;
    const traceFields = root
      ? {
          trace_id: root.trace_id,
          span_id: generateId(),          // fresh worker span
          parent_span_id: root.root_span_id, // attribute to the session root
          session_id: root.session_id,
          layer_depth: 1                  // flat 2-level tree (root → workers)
        }
      : {};

    // 1+2. Parse metrics, then assemble a full keystone span via the shared
    // builder so the in-session Claude SubagentStop path carries the same schema
    // (correlation_id, host, model_tier, work_class_inferred, …) as the shell
    // boundary. Rows without a resolved root still surface as the coverage gap
    // in lint-spans (counted, never silently dropped).
    const metrics = parseUsageBlock(toolInput, toolOutput);

    // C6.2: witnessed-model-or-sentinel — the honest two paths.
    // PATH A (witnessed): the Agent tool_input carried an explicit `model`
    //   override, so the dispatched mind IS witnessed. Record that REAL model;
    //   buildSpan's deriveModelTier classifies it correctly. model_verified:true.
    // PATH B (unwitnessed): no override means the subagent ran on the
    //   coordinator's model — a parallel context this Stop hook cannot
    //   independently verify. We must NOT record the coordinator's model as the
    //   subagent's (the fabrication the council forbade). Emit the structured
    //   sentinel: model stays null (so deriveModelTier returns null — NO
    //   fabricated cost/tier), and { mind_class, mind_relation, model_verified }
    //   carry the honest epistemic boundary that print-cascade renders as
    //   'claude · parallel-context · model-unverified'.
    const mindFields = metrics.model
      ? { model: metrics.model, model_verified: true }
      : { model: null, mind_class: 'claude', mind_relation: 'parallel-context', model_verified: false };

    // 3. Assemble Entry (explicit trace fields win over ambient env in buildSpan)
    //    HARNESS ASYMMETRY (c6-mind-coverage-repair): this Stop hook runs INSIDE
    //    the Claude Code CLI, so it can WITNESS its own harness ('claude-code-cli')
    //    even on the sentinel path where it cannot witness the model. Harness and
    //    mind are independent axes — a null/unverified model does not make the
    //    harness unknown. Stamped on BOTH the witnessed-model and sentinel branches.
    const entry = buildSpan({
      ...traceFields,
      ...mindFields,
      harness: 'claude-code-cli',
      harness_witness_state: 'witnessed',
      subagent_type: metrics.subagent_type,
      actor_reason: metrics.actor_reason,
      duration_ms: metrics.duration_ms,
      total_tokens: metrics.total_tokens,
      tool_uses: metrics.tool_uses,
      actor_role: 'worker',
      emit_source: 'subagent-telemetry-writer'
    });

    // 4. Persistence — rotation AND append share ONE critical section so a
    // concurrent writer cannot rotate the file out from under our append (codex
    // MAJOR). withFileLock is fail-open: the body still runs if the lock cannot
    // be taken, so a span is never dropped or blocked.
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    withFileLock(LOG_FILE, () => {
      rotateLogIfNecessary();
      fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    });

  } catch (err) {
    // Fail-open
    process.stderr.write(`[subagent-telemetry-writer] failed to record telemetry: ${err.message}\n`);
  }
}

if (require.main === module) {
  main();
  process.exit(0);
}
