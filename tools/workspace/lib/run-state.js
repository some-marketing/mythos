'use strict';

const path = require('path');
const { exists, readJson, writeJson } = require('./fs');
const { validateRequiredFields, loadSchema } = require('./models');
const { timestampId } = require('./workspace');
const { safeProjectBoundaryReceipt } = require('./project-boundary');

// Telemetry is an optional runtime: resolved lazily so installs without
// tools/telemetry (e.g. the public release) run the capture lane unchanged.
// Run-state bytes and validation authority never depend on it.
function loadTelemetry() {
  try {
    const { getTraceContext } = require('../../telemetry/dispatches/lib/trace-context.cjs');
    const {
      appendCompletionEvent,
      buildReflexOutcome,
      buildSpanCompletion,
      sha256Reference
    } = require('../../telemetry/dispatches/lib/completion-events.cjs');
    return { getTraceContext, appendCompletionEvent, buildReflexOutcome, buildSpanCompletion, sha256Reference };
  } catch (_) {
    return null;
  }
}

function emitRunFinalization(state, options = {}) {
  try {
    const telemetry = loadTelemetry();
    if (!telemetry) return;
    const { getTraceContext, appendCompletionEvent, buildReflexOutcome, buildSpanCompletion, sha256Reference } = telemetry;
    const trace = getTraceContext();
    const startedAt = Date.parse(state.started_at);
    const finishedAt = Date.parse(state.finished_at);
    const durationMs = Number.isFinite(startedAt) && Number.isFinite(finishedAt)
      ? Math.max(0, finishedAt - startedAt)
      : 0;
    const validation = state.output_validation || {};
    const receipt = sha256Reference(JSON.stringify({
      ready: validation.ready === true,
      blocker_count: Number(validation.blocker_count) || 0,
      warning_count: Number(validation.warning_count) || 0,
      finding_count: Array.isArray(validation.findings) ? validation.findings.length : 0
    }));
    const emit = typeof options.completionEventEmitter === 'function'
      ? options.completionEventEmitter
      : appendCompletionEvent;
    const common = {
      trace_id: trace.trace_id,
      span_id: trace.span_id || 'unknown',
      run_id: state.run_id,
      framework_id: state.framework_id,
      handler_id: 'workspace.finalizeRunState',
      handler_version: 'run-state-v1',
      handler_receipt_ref: receipt,
      emit_source: 'workspace-run-state',
      witness_state: 'witnessed'
    };
    emit(options.projectRoot, buildSpanCompletion({
      ...common,
      decision_point_id_or_stage_id: 'run-finalization',
      status: state.status === 'completed' ? 'complete' : 'failed',
      usage_provenance: 'structurally_unwitnessable',
      duration_ms: durationMs
    }));
    emit(options.projectRoot, buildReflexOutcome({
      ...common,
      decision_point_id: 'run-finalization',
      execution_path: 'deterministic'
    }));
  } catch (_) {
    // Run-state bytes and validation authority do not depend on telemetry.
  }
}

/**
 * Initialize a run state file in the output directory.
 */
function initRunState(outputRoot, frameworkId, options = {}) {
  const runId = timestampId('run');
  const state = {
    run_id: runId,
    framework_id: frameworkId,
    status: 'running',
    started_at: new Date().toISOString(),
    finished_at: null,
    prompt_log: [],
    artifacts_produced: [],
    output_validation: null
  };
  if (options.projectBoundary && process.env.PROJECT_BOUNDARY_RECEIPT_V1 !== '0') {
    state.project_boundary_receipt = safeProjectBoundaryReceipt(options.projectBoundary, options.boundaryAdapters);
  }
  const statePath = path.join(outputRoot, 'run_state.json');
  writeJson(statePath, state);
  return { statePath, runId };
}

/**
 * Log a prompt execution result to the run state.
 * Artifacts logged per-prompt are also appended to the top-level
 * `artifacts_produced` array so that field is always the single
 * canonical source of changed-files evidence for completion auditing.
 */
function logPromptResult(runStatePath, promptId, result, artifacts) {
  const state = readJson(runStatePath);
  const arts = Array.isArray(artifacts) ? artifacts : [];
  state.prompt_log.push({
    prompt_id: promptId,
    result: result,
    artifacts: arts
  });
  for (const art of arts) {
    const artPath = typeof art === 'string' ? art : art.path;
    const artType = typeof art === 'string' ? 'prompt_output' : (art.type || 'prompt_output');
    // Avoid duplicates
    if (!state.artifacts_produced.some((a) => a.path === artPath)) {
      state.artifacts_produced.push({ path: artPath, type: artType, source_prompt: promptId });
    }
  }
  writeJson(runStatePath, state);
}

/**
 * Register an artifact produced during the run.
 * Deduplicates by path to stay consistent with logPromptResult behavior.
 */
function registerArtifact(runStatePath, artifactPath, type, sourcePrompt) {
  const state = readJson(runStatePath);
  if (!state.artifacts_produced.some((a) => a.path === artifactPath)) {
    state.artifacts_produced.push({
      path: artifactPath,
      type: type,
      source_prompt: sourcePrompt || null
    });
  }
  writeJson(runStatePath, state);
}

/**
 * Finalize the run state with validation results.
 * Stores detailed findings (command, code, severity, message) so the
 * completion auditor has concrete evidence, not just boolean/count summaries.
 */
function finalizeRunState(runStatePath, validationResult, options = {}) {
  const state = readJson(runStatePath);
  state.finished_at = new Date().toISOString();
  state.status = validationResult.ready ? 'completed' : 'failed';
  state.output_validation = {
    ready: validationResult.ready,
    blocker_count: validationResult.blockerCount,
    warning_count: validationResult.warningCount,
    blockers: validationResult.blockers,
    warnings: validationResult.warnings,
    findings: validationResult.findings || []
  };
  writeJson(runStatePath, state);
  emitRunFinalization(state, options);
}

/**
 * Load and validate an existing run state file.
 */
function loadRunState(runStatePath) {
  if (!exists(runStatePath)) {
    throw new Error(`Run state not found: ${runStatePath}`);
  }
  const state = readJson(runStatePath);
  validateRequiredFields(state, loadSchema('run-state.schema.json'), 'run_state');
  return state;
}

module.exports = {
  initRunState,
  logPromptResult,
  registerArtifact,
  finalizeRunState,
  emitRunFinalization,
  loadRunState
};
