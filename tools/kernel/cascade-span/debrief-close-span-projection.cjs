'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cascadeSpan = require('./cascade-span.js');

const PROJECTION_SCHEMA_ID = 'DebriefCloseSpanProjection/1.0';
const OBSERVATION_SCHEMA_ID = 'DebriefCloseSpanObservation/1.0';
const TELEMETRY_FAILURE_SCHEMA_ID = 'DebriefCloseTelemetryFailure/1.0';
const EVENT_CLASS = 'debrief-close-decision';
const LOGICAL_CALL_SITE = 'debrief_before_closeout';
const PROJECTION_SCHEMA_PATH = path.join(__dirname, 'debrief-close-span-projection.schema.json');
const PROJECTION_KEYS = Object.freeze([
  'schema_id',
  'span_schema_version',
  'event_class',
  'node_actor',
  'logical_session_id',
  'scope_identity',
  'work_unit',
  'lineage_root',
  'parent_span_id',
  'trace_id',
  'layer_depth',
  'logical_call_site',
  'action_id',
  'outcome',
  'enforced',
  'tombstone'
]);

const FIELD_SOURCE_MAP = Object.freeze({
  schema_id: Object.freeze({ claude_hook: 'projection constant', native: 'projection constant' }),
  span_schema_version: Object.freeze({ claude_hook: 'validated span.schema_version', native: 'validated span.schema_version' }),
  event_class: Object.freeze({ claude_hook: 'projection constant', native: 'projection constant' }),
  node_actor: Object.freeze({ claude_hook: 'span.node.actor', native: 'span.node.actor' }),
  logical_session_id: Object.freeze({ claude_hook: 'production correlation context.logical_session_id', native: 'production correlation context.logical_session_id' }),
  scope_identity: Object.freeze({ claude_hook: 'span.scope.scope_identity', native: 'span.scope.scope_identity' }),
  work_unit: Object.freeze({ claude_hook: 'span.scope.work_unit', native: 'span.scope.work_unit' }),
  lineage_root: Object.freeze({ claude_hook: 'span.scope.lineage_root', native: 'span.scope.lineage_root' }),
  parent_span_id: Object.freeze({ claude_hook: 'span.parent_span_id', native: 'span.parent_span_id' }),
  trace_id: Object.freeze({ claude_hook: 'span.trace_id', native: 'span.trace_id' }),
  layer_depth: Object.freeze({ claude_hook: 'production correlation context.layer_depth', native: 'production correlation context.layer_depth' }),
  logical_call_site: Object.freeze({ claude_hook: 'protocol constant', native: 'protocol constant' }),
  action_id: Object.freeze({ claude_hook: 'production correlation context.action_id', native: 'production correlation context.action_id' }),
  outcome: Object.freeze({ claude_hook: 'span.status/action.verdict', native: 'span.status/action.verdict' }),
  enforced: Object.freeze({ claude_hook: 'evaluated debrief subdecision.enforced', native: 'DebriefCloseDecision.enforced' }),
  tombstone: Object.freeze({ claude_hook: 'span.status === tombstone', native: 'span.status === tombstone' })
});

function nonEmpty(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function integer(value, fallback = 0) {
  const parsed = Number.parseInt(String(value == null ? '' : value), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveCorrelationContext(input = {}) {
  const env = input.env || process.env;
  const supplied = input.context && typeof input.context === 'object' ? input.context : {};
  const runtimeSessionId = nonEmpty(input.runtimeSessionId) || 'unknown-runtime-session';
  const actionId = nonEmpty(supplied.action_id) || nonEmpty(env.MYTHOS_DEBRIEF_ACTION_ID) || crypto.randomUUID();
  const logicalSessionId = nonEmpty(supplied.logical_session_id) || nonEmpty(env.MYTHOS_DEBRIEF_LOGICAL_SESSION_ID) || runtimeSessionId;
  const traceId = nonEmpty(supplied.trace_id) || nonEmpty(env.MYTHOS_TRACE_ID);
  return {
    action_id: actionId,
    trace_id: traceId && traceId !== 'unknown' ? traceId : actionId,
    parent_span_id: nonEmpty(supplied.parent_span_id) || nonEmpty(env.MYTHOS_SPAN_ID),
    logical_session_id: logicalSessionId,
    scope_identity: nonEmpty(supplied.scope_identity) || nonEmpty(env.MYTHOS_WORKSTREAM_SCOPE) || nonEmpty(input.scopeIdentity),
    work_unit: nonEmpty(supplied.work_unit) || nonEmpty(env.MYTHOS_STEP_ID) || 'debrief-before-closeout',
    lineage_root: nonEmpty(supplied.lineage_root) || nonEmpty(env.MYTHOS_LINEAGE_ROOT_SESSION_ID) || logicalSessionId,
    layer_depth: integer(supplied.layer_depth, integer(env.MYTHOS_LAYER_DEPTH, 0)),
    logical_call_site: LOGICAL_CALL_SITE
  };
}

function spanOutcome(span) {
  if (span.status === 'tombstone') return 'tombstone';
  return span.action && span.action.verdict === 'deny' ? 'deny' : 'allow';
}

function makeDebriefCloseSpan(input = {}) {
  const home = input.home === 'native' ? 'native' : 'claude-hook';
  const outcome = input.outcome === 'tombstone' ? 'tombstone' : input.outcome === 'deny' ? 'deny' : 'allow';
  const context = resolveCorrelationContext(input);
  const startedAt = nonEmpty(input.startedAt) || new Date().toISOString();
  const verdict = outcome === 'deny' ? 'deny' : 'allow';
  return {
    context,
    span: cascadeSpan.makeSpan({
      span_id: nonEmpty(input.spanId) || crypto.randomUUID(),
      parent_span_id: context.parent_span_id,
      trace_id: context.trace_id,
      node: {
        actor: nonEmpty(input.nodeActor) || 'coordinator',
        harness: home === 'native' ? 'pi-mono' : 'claude-code-cli',
        model_family: null
      },
      scope: {
        scope_identity: context.scope_identity,
        work_unit: context.work_unit,
        lineage_root: context.lineage_root
      },
      action: {
        proposed: `${LOGICAL_CALL_SITE}: ${nonEmpty(input.closeReason) || 'close'}`,
        classified_layer: 'read-only',
        verdict
      },
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      enforcement_home: home,
      timestamps: { started_at: startedAt, ended_at: nonEmpty(input.endedAt) || startedAt },
      status: outcome === 'tombstone' ? 'tombstone' : outcome === 'deny' ? 'denied' : 'ok'
    })
  };
}

function projectDebriefCloseSpan(span, context, decision = {}) {
  return {
    schema_id: PROJECTION_SCHEMA_ID,
    span_schema_version: span.schema_version,
    event_class: EVENT_CLASS,
    node_actor: span.node.actor,
    logical_session_id: context.logical_session_id,
    scope_identity: span.scope.scope_identity,
    work_unit: span.scope.work_unit,
    lineage_root: span.scope.lineage_root,
    parent_span_id: span.parent_span_id,
    trace_id: span.trace_id,
    layer_depth: context.layer_depth,
    logical_call_site: context.logical_call_site,
    action_id: context.action_id,
    outcome: spanOutcome(span),
    enforced: decision.enforced === true,
    tombstone: span.status === 'tombstone'
  };
}

function validateProjection(projection) {
  const errors = [];
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return { ok: false, errors: ['projection must be an object'] };
  }
  const keys = Object.keys(projection).sort();
  const expected = PROJECTION_KEYS.slice().sort();
  for (const key of expected) if (!keys.includes(key)) errors.push(`missing field: ${key}`);
  for (const key of keys) if (!expected.includes(key)) errors.push(`unknown field: ${key}`);
  if (projection.schema_id !== PROJECTION_SCHEMA_ID) errors.push(`schema_id must be ${PROJECTION_SCHEMA_ID}`);
  if (projection.span_schema_version !== cascadeSpan.SCHEMA_VERSION) errors.push(`span_schema_version must be ${cascadeSpan.SCHEMA_VERSION}`);
  if (projection.event_class !== EVENT_CLASS) errors.push(`event_class must be ${EVENT_CLASS}`);
  if (projection.logical_call_site !== LOGICAL_CALL_SITE) errors.push(`logical_call_site must be ${LOGICAL_CALL_SITE}`);
  for (const key of ['node_actor', 'logical_session_id', 'trace_id', 'action_id']) {
    if (!nonEmpty(projection[key])) errors.push(`${key} must be a non-empty string`);
  }
  for (const key of ['scope_identity', 'work_unit', 'lineage_root', 'parent_span_id']) {
    if (!(projection[key] === null || typeof projection[key] === 'string')) errors.push(`${key} must be string|null`);
  }
  if (!Number.isInteger(projection.layer_depth) || projection.layer_depth < 0) errors.push('layer_depth must be a non-negative integer');
  if (!['allow', 'deny', 'tombstone'].includes(projection.outcome)) errors.push('outcome invalid');
  if (typeof projection.enforced !== 'boolean') errors.push('enforced must be boolean');
  if (typeof projection.tombstone !== 'boolean') errors.push('tombstone must be boolean');
  if ((projection.outcome === 'tombstone') !== projection.tombstone) errors.push('outcome/tombstone disagree');
  return { ok: errors.length === 0, errors };
}

function compareProjections(left, right) {
  const leftValidation = validateProjection(left);
  const rightValidation = validateProjection(right);
  const mismatches = [];
  if (!leftValidation.ok) mismatches.push(...leftValidation.errors.map((error) => `left:${error}`));
  if (!rightValidation.ok) mismatches.push(...rightValidation.errors.map((error) => `right:${error}`));
  if (leftValidation.ok && rightValidation.ok) {
    for (const key of PROJECTION_KEYS) {
      if (left[key] !== right[key]) mismatches.push(`${key}: ${JSON.stringify(left[key])} !== ${JSON.stringify(right[key])}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function appendJsonLine(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(value)}\n`, 'utf8');
  return target;
}

function defaultStatePath(root, filename) {
  return path.join(root, '_dev/state/debrief-closeout', filename);
}

function recordTelemetryFailure(input, error) {
  const failure = {
    schema: TELEMETRY_FAILURE_SCHEMA_ID,
    protocol: LOGICAL_CALL_SITE,
    home: input.home === 'native' ? 'native' : 'claude-hook',
    actual_runtime_session_id: nonEmpty(input.runtimeSessionId),
    reason: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString()
  };
  try {
    return appendJsonLine(input.failureLogPath || defaultStatePath(input.root, 'telemetry-failures.jsonl'), failure);
  } catch (_) {
    process.stderr.write(`[debrief-close-span] telemetry failure could not be recorded: ${failure.reason}\n`);
    return null;
  }
}

function emitDebriefCloseObservation(input = {}) {
  try {
    if (!input.root) throw new Error('root is required');
    const { span, context } = makeDebriefCloseSpan(input);
    const spanValidation = cascadeSpan.validateSpan(span);
    if (!spanValidation.ok) throw new Error(`invalid CascadeSpan/1.0: ${spanValidation.errors.join('; ')}`);
    const projection = projectDebriefCloseSpan(span, context, { enforced: input.enforced });
    const projectionValidation = validateProjection(projection);
    if (!projectionValidation.ok) throw new Error(`invalid ${PROJECTION_SCHEMA_ID}: ${projectionValidation.errors.join('; ')}`);
    const spanPath = cascadeSpan.writeSpan(span, {
      projectRoot: input.root,
      logPath: input.spanLogPath || (input.env && input.env.MYTHOS_CASCADE_SPAN_LOG)
    });
    if (!spanPath) throw new Error('CascadeSpan sink failed');
    const observation = {
      schema: OBSERVATION_SCHEMA_ID,
      protocol: LOGICAL_CALL_SITE,
      home: input.home === 'native' ? 'native' : 'claude-hook',
      emit_source: nonEmpty(input.emitSource) || 'unknown',
      actual_runtime_session_id: nonEmpty(input.runtimeSessionId),
      emitted_at: new Date().toISOString(),
      span,
      projection
    };
    const observationPath = appendJsonLine(
      input.observationLogPath || defaultStatePath(input.root, 'span-observations.jsonl'),
      observation
    );
    return { ok: true, span, projection, spanPath, observationPath };
  } catch (error) {
    const failurePath = recordTelemetryFailure(input, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error), failurePath };
  }
}

function observeExistingDebriefCloseSpan(input = {}) {
  try {
    if (!input.root) throw new Error('root is required');
    const spanValidation = cascadeSpan.validateSpan(input.span);
    if (!spanValidation.ok) throw new Error(`invalid CascadeSpan/1.0: ${spanValidation.errors.join('; ')}`);
    const context = resolveCorrelationContext(input);
    const projection = projectDebriefCloseSpan(input.span, context, { enforced: input.enforced });
    const projectionValidation = validateProjection(projection);
    if (!projectionValidation.ok) throw new Error(`invalid ${PROJECTION_SCHEMA_ID}: ${projectionValidation.errors.join('; ')}`);
    const observation = {
      schema: OBSERVATION_SCHEMA_ID,
      protocol: LOGICAL_CALL_SITE,
      home: input.span.enforcement_home,
      emit_source: nonEmpty(input.emitSource) || 'unknown',
      actual_runtime_session_id: nonEmpty(input.runtimeSessionId),
      emitted_at: new Date().toISOString(),
      span: input.span,
      projection
    };
    const observationPath = appendJsonLine(
      input.observationLogPath || defaultStatePath(input.root, 'span-observations.jsonl'),
      observation
    );
    return { ok: true, span: input.span, projection, observationPath };
  } catch (error) {
    const failurePath = recordTelemetryFailure(input, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error), failurePath };
  }
}

module.exports = {
  PROJECTION_SCHEMA_ID,
  OBSERVATION_SCHEMA_ID,
  TELEMETRY_FAILURE_SCHEMA_ID,
  PROJECTION_SCHEMA_PATH,
  PROJECTION_KEYS,
  FIELD_SOURCE_MAP,
  EVENT_CLASS,
  LOGICAL_CALL_SITE,
  resolveCorrelationContext,
  makeDebriefCloseSpan,
  projectDebriefCloseSpan,
  validateProjection,
  compareProjections,
  emitDebriefCloseObservation,
  observeExistingDebriefCloseSpan
};
