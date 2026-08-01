#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { parseArgs } = require('../workspace/lib/args');
const {
  loadCanonicalCommand,
  parseSlashCommand
} = require('./lib/command-registry.cjs');
const { resolveCommandAlias } = require('./lib/command-aliases.cjs');
const { reviewTaskPlan } = require('./handlers/review-task-plan.cjs');
const { reviewProgress } = require('./handlers/review-progress.cjs');
const { routeCommand } = require('./handlers/route.cjs');
const { conceptPromote } = require('./handlers/concept-promote.cjs');
const { debriefRun } = require('./handlers/debrief-run.cjs');
const { shutdown } = require('./handlers/shutdown.cjs');
const { newSession } = require('./handlers/new-session.cjs');
const { telemetryStatus } = require('../codex/commands/telemetry-status');
const { runPlan } = require('../codex/commands/run-plan');
const { runRepairPlanCommand } = require('../codex/commands/repair-plan');
const { orchestrateLoop } = require('../codex/commands/orchestrate-loop');
const { planTask } = require('../codex/commands/plan-task');
const { orchestrate } = require('../codex/commands/orchestrate');
const { amendPlan } = require('../codex/commands/amend-plan');
const { evidenceLoop } = require('../codex/commands/evidence-loop');
const { getTraceContext } = require('../telemetry/dispatches/lib/trace-context.cjs');
const {
  appendCompletionEvent,
  buildReflexOutcome,
  buildSpanCompletion,
  sha256Reference
} = require('../telemetry/dispatches/lib/completion-events.cjs');

const PROJECT_ROOT = process.env.MYTHOS_PROJECT_ROOT
  ? path.resolve(process.env.MYTHOS_PROJECT_ROOT)
  : path.resolve(__dirname, '..', '..');

const HANDLERS = Object.freeze({
  'review-task-plan': reviewTaskPlan,
  'review-progress': reviewProgress,
  'repair-plan': repairPlan,
  'telemetry-status': telemetryStatus,
  'run-plan': runPlan,
  'orchestrate-loop': orchestrateLoop,
  'plan-task': planTask,
  'orchestrate': orchestrate,
  'route': routeCommand,
  'concept-promote': conceptPromote,
  'debrief-run': debriefRun,
  'shutdown': shutdown,
  'new-session': newSession,
  'amend-plan': amendPlan,
  'evidence-loop': evidenceLoop
});

function splitArgs(argsText) {
  return String(argsText || '').match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  }) || [];
}

function repairPlan(projectRoot, argsText) {
  return runRepairPlanCommand(projectRoot, {
    args: splitArgs(argsText)
  });
}

function emitCommandCompletion(projectRoot, commandId, handler, result, durationMs, options = {}) {
  try {
    if (options.write === false && typeof options.completionEventEmitter !== 'function') return;
    const trace = getTraceContext();
    const invocationId = crypto.randomUUID();
    const runId = trace.session_id || (trace.trace_id !== 'unknown' ? trace.trace_id : `command-${invocationId}`);
    const spanId = trace.span_id || 'unknown';
    const decisionPoint = `command:${commandId}`;
    const handlerReceipt = sha256Reference(`${commandId}\n${Function.prototype.toString.call(handler)}`);
    const exitCode = result && Number.isInteger(result.exitCode) ? result.exitCode : null;
    const status = exitCode === null ? 'unknown' : (exitCode === 0 ? 'complete' : 'failed');
    const emit = typeof options.completionEventEmitter === 'function'
      ? options.completionEventEmitter
      : appendCompletionEvent;
    const common = {
      trace_id: trace.trace_id,
      span_id: spanId,
      run_id: runId,
      command_id: commandId,
      handler_id: commandId,
      handler_version: handlerReceipt,
      handler_receipt_ref: handlerReceipt,
      emit_source: 'smos-command-runner',
      witness_state: 'witnessed'
    };
    emit(projectRoot, buildSpanCompletion({
      ...common,
      decision_point_id_or_stage_id: decisionPoint,
      status,
      usage_provenance: 'structurally_unwitnessable',
      duration_ms: durationMs,
      ...(exitCode === null ? {} : { exit_code: exitCode })
    }));
    emit(projectRoot, buildReflexOutcome({
      ...common,
      decision_point_id: decisionPoint,
      execution_path: 'deterministic'
    }));
  } catch (_) {
    // Passive sensor: command behavior is authoritative, telemetry is not.
  }
}

function runHandlerWithTelemetry(projectRoot, commandId, handler, argsText, options = {}) {
  const started = process.hrtime.bigint();
  try {
    const result = handler(projectRoot, argsText, options);
    const durationMs = Number((process.hrtime.bigint() - started) / 1000000n);
    emitCommandCompletion(projectRoot, commandId, handler, result, durationMs, options);
    return result;
  } catch (error) {
    const durationMs = Number((process.hrtime.bigint() - started) / 1000000n);
    emitCommandCompletion(projectRoot, commandId, handler, { exitCode: 1 }, durationMs, options);
    throw error;
  }
}

function runSmosCommand(projectRoot, commandString, options = {}) {
  const parsed = parseSlashCommand(commandString);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  const typedCanonical = loadCanonicalCommand(projectRoot, parsed.commandId);
  const resolution = resolveCommandAlias(projectRoot, parsed.commandId);
  const executionCommand = resolution.executionCommand;
  const canonical = typedCanonical || loadCanonicalCommand(projectRoot, executionCommand);

  if (!canonical) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Unknown Mythos command: /${parsed.commandId}`
    };
  }

  const handler = HANDLERS[executionCommand];
  if (!handler) {
    const aliasNote = resolution.isAlias ? ` Alias /${resolution.typedCommand} resolves to /${executionCommand}.` : '';
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Mythos command /${parsed.commandId} is canonical but has no deterministic executable handler yet.${aliasNote} Canonical spec: ${path.relative(projectRoot, canonical.specPath)}`
    };
  }

  const handlerOptions = {
    ...options,
    commandResolution: resolution
  };
  return runHandlerWithTelemetry(projectRoot, executionCommand, handler, parsed.argsText, handlerOptions);
}

function main() {
  const args = parseArgs(process.argv);
  const commandString = args.command || args._.join(' ');
  const result = runSmosCommand(PROJECT_ROOT, commandString, {
    json: !args.text,
    write: !args.no_write
  });

  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  HANDLERS,
  runSmosCommand,
  runHandlerWithTelemetry,
  emitCommandCompletion
};
