'use strict';

/**
 * tool-broker.js — the Tool Broker (sovereign-core-harness concept §"The Tool
 * Broker", layer 3; plan P2 steps 3-4). THE ENFORCEMENT BOUNDARY.
 *
 * The Provider Adapter (transport, zero authority) hands the broker a model's
 * PROPOSED actions. The broker is the only component that maps a proposed action
 * to a real repo/tool primitive, and only after ruling it against the current
 * permission phase (4-phase staging via broker-capabilities.js). It records a
 * CascadeSpan/1.0 for every action — allowed OR denied — and it NEVER applies a
 * change: phase-2 proposals are written to a reviewed-application area, and the
 * application itself is out-of-band through phase 2. Phase 3 admits exactly one
 * review-hash-bound fs.write primitive plus a sandboxed focused test; every
 * other write/command surface remains denied.
 *
 * Lineage discipline (concept: "never fork lineage identity"): every span
 * CONSUMES the ambient cascade trace context (trace-context.cjs) — the broker
 * mints only a fresh span_id per action and inherits trace_id / parent_span_id /
 * scope lineage from the owner. The emitted span therefore joins the same
 * cascade tree as the Claude-hook close-path span (proven by the parity test).
 *
 * Spans are emitted through the canonical fromBrokerAction adapter, so the broker
 * cannot invent a divergent shape (the council's #1 risk: schema bifurcation).
 */

const crypto = require('crypto');
const path = require('path');

const cascadeSpan = require('../../kernel/cascade-span/cascade-span.js');
const { getTraceContext } = require('../../telemetry/dispatches/lib/trace-context.cjs');
const { ruleCapability, getCapability } = require('./broker-capabilities');
const { createPhase3Executor } = require('./phase3-executor');

const BROKER_DECISION_TO_STATUS = { allow: 'ok', deny: 'denied', escalate: 'escalated' };

/**
 * createToolBroker — build a phase-bounded broker.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot     repo root (bounds all reads/writes)
 * @param {number} [opts.phase=1]       broker permission phase (1 read-only, 2 proposal)
 * @param {string} [opts.modelFamily]   mind family of the brokered model (recorded on spans)
 * @param {string} [opts.proposalsDir]  where phase-2 proposals land (default _dev/reports/broker/proposals)
 * @param {string} [opts.spanLogPath]   CascadeSpan sink override (default the canonical sink)
 * @param {function} [opts.traceContext] injectable trace-context getter (tests)
 */
function createToolBroker(opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const phase = typeof opts.phase === 'number' ? opts.phase : 1;
  const modelFamily = opts.modelFamily || null;
  const proposalsDir = opts.proposalsDir
    || path.join(projectRoot, '_dev', 'reports', 'broker', 'proposals');
  const readTrace = typeof opts.traceContext === 'function' ? opts.traceContext : getTraceContext;
  const phase3Executor = phase === 3
    ? (opts.phase3Executor || createPhase3Executor({ projectRoot, modelFamily, runsDir: opts.phase3RunsDir, signalsPath: opts.phase3SignalsPath, trustedReviewersPath: opts.trustedReviewersPath }))
    : null;

  let capturedAnalysis = null;

  const capabilityCtx = {
    projectRoot,
    proposalsDir,
    recordAnalysis(text) { capturedAnalysis = text; },
    phase3Executor,
    now: null
  };

  function buildSpan(proposal, rule, verdict, nowIso, extraEvidence) {
    const trace = readTrace();
    const traceId = trace.trace_id && trace.trace_id !== 'unknown'
      ? trace.trace_id
      : (trace.correlation_id && trace.correlation_id !== 'unknown' ? trace.correlation_id : (trace.session_id || null));
    const action = cascadeSpan.fromBrokerAction({
      span_id: crypto.randomUUID(),
      parent_span_id: trace.span_id || null,
      trace_id: traceId,
      scope_identity: trace.scope_identity || null,
      work_unit: trace.step_id || null,
      lineage_root: trace.lineage_root_session_id || trace.session_id || null,
      adapter_role: 'tool-broker',
      model_family: modelFamily,
      tool: proposal.tool,
      summary: proposal.summary || proposal.tool,
      proposed_action: `${proposal.tool}: ${proposal.summary || 'invoke'}`,
      permission_phase: phase,
      decision: verdict,
      started_at: nowIso,
      ended_at: nowIso,
      artifacts: Array.isArray(extraEvidence) ? extraEvidence : []
    });
    return action;
  }

  /**
   * handle — rule on ONE proposed action, execute it iff the phase permits, and
   * emit a CascadeSpan (allowed OR denied). Never throws on an execution/read
   * failure; records it and returns.
   *
   * @param {object} proposal - { tool, arguments, summary } from the Provider Adapter
   * @param {object} [ctx]    - { now } ISO timestamp (passive-sensor: caller supplies time)
   * @returns {{ verdict, executed, result, span, valid }}
   */
  function handle(proposal, ctx = {}) {
    const nowIso = ctx.now || new Date().toISOString();
    const rule = ruleCapability(proposal.tool, phase);

    // DENY / ESCALATE -> record the span, do NOT execute, do NOT mutate anything.
    if (rule.verdict !== 'allow') {
      const span = buildSpan(proposal, rule, rule.verdict, nowIso, []);
      const emit = cascadeSpan.writeSpan(span, { projectRoot, logPath: opts.spanLogPath });
      const valid = cascadeSpan.validateSpan(span);
      return {
        verdict: rule.verdict,
        executed: false,
        result: { ok: false, denied: true, reason: rule.reason },
        span,
        span_log: emit,
        valid: valid.ok
      };
    }

    // ALLOW -> execute the read-only / proposal primitive.
    const cap = getCapability(proposal.tool);
    let execResult;
    try {
      capabilityCtx.now = nowIso;
      execResult = cap.execute(capabilityCtx, proposal.arguments || {});
    } catch (err) {
      execResult = { ok: false, reason: `executor threw: ${err.message}` };
    }
    const evidence = [];
    if (execResult && execResult.path) evidence.push(execResult.path);
    if (execResult && execResult.proposal_artifact) evidence.push(execResult.proposal_artifact);
    if (execResult && execResult.closeout_artifact) evidence.push(execResult.closeout_artifact);
    if (execResult && execResult.signal_artifact) evidence.push(execResult.signal_artifact);

    let finalVerdict = phase === 3 && (!execResult || execResult.ok !== true) ? 'deny' : 'allow';
    let span = buildSpan(proposal, rule, finalVerdict, nowIso, evidence);
    if (phase3Executor && execResult && execResult.closeout_artifact) {
      execResult = phase3Executor.attachSpan(execResult, span);
    }
    let emit = cascadeSpan.writeSpan(span, { projectRoot, logPath: opts.spanLogPath });
    if (phase3Executor && execResult && execResult.ok && execResult.span_attached) {
      if (emit) execResult = phase3Executor.commit(execResult, span);
      else {
        execResult = phase3Executor.rollbackPending(execResult, 'CascadeSpan sink failed before phase-3 commit');
        finalVerdict = 'deny';
        span = buildSpan(proposal, rule, finalVerdict, nowIso, evidence);
        const emergencyLog = path.join(projectRoot, '_dev/state/broker/emergency-cascade-spans.jsonl');
        emit = cascadeSpan.writeSpan(span, { projectRoot, logPath: emergencyLog });
        execResult = { ...execResult, emergency_span_log: emit ? path.relative(projectRoot, emit).replace(/\\/g, '/') : null };
      }
    }
    const valid = cascadeSpan.validateSpan(span);
    return {
      verdict: finalVerdict,
      executed: execResult && typeof execResult.executed === 'boolean' ? execResult.executed : true,
      result: execResult,
      span,
      span_log: emit,
      valid: valid.ok
    };
  }

  function handleAll(proposals, ctx = {}) {
    const outcomes = [];
    for (const p of Array.isArray(proposals) ? proposals : []) {
      outcomes.push(handle(p, ctx));
    }
    return outcomes;
  }

  return {
    phase,
    projectRoot,
    proposalsDir,
    handle,
    handleAll,
    capturedAnalysis: () => capturedAnalysis,
    BROKER_DECISION_TO_STATUS
  };
}

module.exports = { createToolBroker };
