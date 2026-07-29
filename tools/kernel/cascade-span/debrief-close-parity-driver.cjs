'use strict';

const fs = require('node:fs');
const path = require('node:path');
const closeoutGate = require('../hooks/stop-closeout-evidence-gate.cjs');
const {
  compareProjections,
  emitDebriefCloseObservation
} = require('./debrief-close-span-projection.cjs');

const RESULT_SCHEMA = 'DebriefCloseParityResult/1.0';

function runPairedObservation(input = {}) {
  if (!input.root) throw new Error('root is required');
  if (!input.context || !input.context.action_id) throw new Error('context.action_id is required');
  if (!input.nativeDecision && !input.nativeObservation) throw new Error('nativeDecision or nativeObservation is required');
  const claude = closeoutGate.main(
    { ...(input.claudePayload || {}), debrief_close_context: input.context },
    {
      ...(input.claudeOptions || {}),
      root: input.root,
      debriefContext: input.context,
      spanLogPath: input.spanLogPath,
      observationLogPath: input.observationLogPath,
      failureLogPath: input.failureLogPath
    }
  );
  if (!claude.debrief_decision || claude.debrief_decision.outcome === 'not_applicable') {
    throw new Error(`Claude debrief subdecision did not participate: ${JSON.stringify(claude.debrief_decision || null)}`);
  }
  if (!claude.debrief_observation || !claude.debrief_observation.ok) {
    throw new Error(`Claude observation failed: ${JSON.stringify(claude.debrief_observation || null)}`);
  }
  let nativeDecision = input.nativeDecision;
  let native;
  if (input.nativeObservation) {
    native = { ok: true, ...input.nativeObservation };
    if (native.home !== 'native' || !String(native.emit_source || '').startsWith('pi-fork:')) throw new Error('native production observation provenance invalid');
    nativeDecision = {
      runtime_session_id: native.actual_runtime_session_id,
      outcome: native.projection.outcome,
      enforced: native.projection.enforced,
      scope_identity: native.projection.scope_identity,
      close_reason: native.projection.close_reason,
      decided_at: native.span.ended_at
    };
  } else native = emitDebriefCloseObservation({
    root: input.root,
    home: 'native',
    runtimeSessionId: nativeDecision.runtime_session_id,
    scopeIdentity: nativeDecision.scope_identity,
    closeReason: nativeDecision.close_reason || 'close',
    outcome: nativeDecision.outcome,
    enforced: nativeDecision.enforced === true,
    startedAt: nativeDecision.decided_at,
    endedAt: nativeDecision.decided_at,
    emitSource: 'paired-workload-driver:native-production-interface',
    context: input.context,
    spanLogPath: input.spanLogPath,
    observationLogPath: input.observationLogPath,
    failureLogPath: input.failureLogPath,
    env: input.env || process.env
  });
  if (!native.ok) throw new Error(`Native observation failed: ${native.error}`);
  const comparison = compareProjections(claude.debrief_observation.projection, native.projection);
  const result = {
    schema: RESULT_SCHEMA,
    action_id: input.context.action_id,
    workload_family: input.workloadFamily || 'fixture',
    actual_runtime_session_ids: {
      claude_hook: input.claudePayload && input.claudePayload.session_id,
      native: nativeDecision.runtime_session_id
    },
    claude_combined_status: claude.status,
    claude_debrief_outcome: claude.debrief_decision.outcome,
    native_debrief_outcome: nativeDecision.outcome,
    comparison
  };
  if (input.receiptPath) {
    fs.mkdirSync(path.dirname(input.receiptPath), { recursive: true });
    fs.appendFileSync(input.receiptPath, `${JSON.stringify(result)}\n`, 'utf8');
  }
  return { result, claude, native };
}

function joinPairedObservations(rows, actionId) {
  const matching = rows.filter((row) => row && row.projection && row.projection.action_id === actionId);
  const byHome = new Map();
  const duplicates = [];
  for (const row of matching) {
    if (byHome.has(row.home)) duplicates.push(row.home);
    else byHome.set(row.home, row);
  }
  const missingHomes = ['claude-hook', 'native'].filter((home) => !byHome.has(home));
  return {
    ok: duplicates.length === 0 && missingHomes.length === 0,
    duplicates,
    missing_homes: missingHomes,
    observations: Object.fromEntries(byHome)
  };
}

module.exports = { RESULT_SCHEMA, runPairedObservation, joinPairedObservations };
