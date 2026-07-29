'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { appendLineLocked, withFileLock } = require('./append-lock.cjs');
const { logFileFor } = require('./emit-span.cjs');

const MAX_ID_BYTES = 256;
const MAX_ARRAY_ITEMS = 64;
const MAX_EVENT_BYTES = 16 * 1024;
const SHA256_REF = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(prompt|message|client_payload|credential|secret|token_value|raw_error|stdout|stderr)/i;

const COMMON_WITNESS = Object.freeze([
  'witnessed',
  'unknown',
  'legacy',
  'excluded_with_reason',
  'structurally_unwitnessable'
]);

const SCHEMAS = Object.freeze({
  'SpanCompletion/1.0': Object.freeze({
    required: Object.freeze([
      'schema', 'event_id', 'observed_at', 'trace_id', 'span_id', 'run_id',
      'decision_point_id_or_stage_id', 'status', 'emit_source', 'usage_provenance'
    ]),
    optional: Object.freeze([
      'command_id', 'framework_id', 'handler_id', 'handler_version', 'handler_receipt_ref',
      'tokens_in', 'tokens_out', 'total_tokens', 'cost_amount', 'cost_currency',
      'duration_ms', 'tool_count', 'exit_code', 'retry_event_ids', 'correction_event_ids',
      'reopen_event_ids', 'rollback_event_ids', 'prior_event_id', 'conflict_with_event_ids',
      'witness_state'
    ]),
    enums: Object.freeze({
      status: Object.freeze(['complete', 'failed', 'timed_out', 'fallback', 'unknown']),
      usage_provenance: Object.freeze([
        'provider_reported', 'cli_reported', 'local_counter', 'unavailable',
        'structurally_unwitnessable'
      ]),
      witness_state: COMMON_WITNESS
    })
  }),
  'ReflexOutcome/1.0': Object.freeze({
    required: Object.freeze([
      'schema', 'event_id', 'observed_at', 'trace_id', 'span_id', 'run_id',
      'decision_point_id', 'execution_path', 'emit_source'
    ]),
    optional: Object.freeze([
      'command_id', 'framework_id', 'stage_id', 'handler_id', 'handler_version',
      'handler_receipt_ref', 'fallback_reason_code', 'fallback_actor_id',
      'fallback_tokens_in', 'fallback_tokens_out', 'fallback_cost_amount',
      'fallback_cost_currency', 'structural_verdict_ref',
      'independent_semantic_verdict_ref', 'acceptance_ref',
      'correction_reference_event_id', 'retry_event_ids', 'reopen_event_ids',
      'rollback_event_ids', 'prior_event_id', 'conflict_with_event_ids', 'witness_state'
    ]),
    enums: Object.freeze({
      execution_path: Object.freeze(['deterministic', 'model', 'hybrid', 'fallback', 'unknown']),
      fallback_reason_code: Object.freeze([
        'unsupported', 'invalid_scope', 'handler_failed', 'timeout', 'safety_gate',
        'authority_gate', 'operator_override', 'unknown'
      ]),
      witness_state: COMMON_WITNESS
    })
  })
});

const ARRAY_FIELDS = new Set([
  'retry_event_ids', 'correction_event_ids', 'reopen_event_ids',
  'rollback_event_ids', 'conflict_with_event_ids'
]);
const REFERENCE_FIELDS = new Set([
  'handler_receipt_ref', 'structural_verdict_ref',
  'independent_semantic_verdict_ref', 'acceptance_ref'
]);
const NUMERIC_FIELDS = new Set([
  'tokens_in', 'tokens_out', 'total_tokens', 'cost_amount', 'duration_ms', 'tool_count',
  'exit_code', 'fallback_tokens_in', 'fallback_tokens_out', 'fallback_cost_amount'
]);
const INTEGER_FIELDS = new Set([
  'tokens_in', 'tokens_out', 'total_tokens', 'duration_ms', 'tool_count',
  'exit_code', 'fallback_tokens_in', 'fallback_tokens_out'
]);

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function isRepoReference(value) {
  if (SHA256_REF.test(value)) return true;
  if (!value || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' && !normalized.startsWith('../');
}

function assertIdentifier(field, value) {
  if (typeof value !== 'string' || !value || byteLength(value) > MAX_ID_BYTES) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_ID_BYTES} bytes`);
  }
  if (/\r|\n|[\u0000-\u001f]/.test(value)) {
    throw new Error(`${field} must not contain control characters or raw prose lines`);
  }
}

function validateValue(field, value, definition) {
  if (ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) {
      throw new Error(`${field} must be an array with at most ${MAX_ARRAY_ITEMS} items`);
    }
    for (const item of value) assertIdentifier(field, item);
    return;
  }
  if (REFERENCE_FIELDS.has(field)) {
    if (typeof value !== 'string' || !isRepoReference(value) || byteLength(value) > MAX_ID_BYTES) {
      throw new Error(`${field} must be a bounded repo-relative path or sha256 reference`);
    }
    return;
  }
  if (NUMERIC_FIELDS.has(field)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${field} must be a finite number`);
    }
    if (field !== 'exit_code' && value < 0) throw new Error(`${field} must be non-negative`);
    if (INTEGER_FIELDS.has(field) && !Number.isInteger(value)) throw new Error(`${field} must be an integer`);
    return;
  }
  if (field === 'observed_at') {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      throw new Error('observed_at must be an ISO-compatible timestamp');
    }
    return;
  }
  if (definition.enums[field]) {
    if (!definition.enums[field].includes(value)) {
      throw new Error(`${field} must be one of: ${definition.enums[field].join(', ')}`);
    }
    return;
  }
  assertIdentifier(field, value);
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('event must be an object');
  }
  const definition = SCHEMAS[event.schema];
  if (!definition) throw new Error(`unsupported completion event schema: ${event.schema}`);
  const allowed = new Set([...definition.required, ...definition.optional]);
  for (const key of Object.keys(event)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`forbidden telemetry key: ${key}`);
    if (!allowed.has(key)) throw new Error(`unknown telemetry key: ${key}`);
  }
  for (const key of definition.required) {
    if (event[key] === undefined || event[key] === null || event[key] === '') {
      throw new Error(`missing required telemetry key: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(event)) validateValue(key, value, definition);
  const serialized = JSON.stringify(event);
  if (byteLength(serialized) > MAX_EVENT_BYTES) {
    throw new Error(`serialized event exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  return event;
}

function buildEvent(schema, fields) {
  const event = {
    ...fields,
    schema,
    event_id: fields && fields.event_id ? fields.event_id : crypto.randomUUID(),
    observed_at: fields && fields.observed_at ? fields.observed_at : new Date().toISOString()
  };
  for (const key of Object.keys(event)) {
    if (event[key] === undefined || event[key] === null) delete event[key];
  }
  if (schema === 'ReflexOutcome/1.0' && event.execution_path === 'deterministic') {
    if (!event.handler_id || !event.handler_version || !event.handler_receipt_ref) {
      event.execution_path = 'unknown';
    }
  }
  return validateEvent(event);
}

function buildSpanCompletion(fields = {}) {
  return buildEvent('SpanCompletion/1.0', fields);
}

function buildReflexOutcome(fields = {}) {
  return buildEvent('ReflexOutcome/1.0', fields);
}

function logicalKey(event) {
  const decision = event.schema === 'SpanCompletion/1.0'
    ? event.decision_point_id_or_stage_id
    : event.decision_point_id;
  return [event.schema, event.trace_id, event.span_id, event.run_id, decision].join('\u001f');
}

function readCompletionEvents(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter((row) => row && SCHEMAS[row.schema]);
}

function appendCompletionEvent(projectRoot, event, options = {}) {
  try {
    const validated = validateEvent({ ...event });
    if (process.env.MYTHOS_COMPLETION_EVENTS === 'off') {
      return { status: 'disabled', event: null, error: null };
    }
    const root = projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const logFile = options.logFile || logFileFor(root);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    let receipt;
    withFileLock(logFile, (locked) => {
      const existing = readCompletionEvents(logFile);
      const sameId = existing.find((row) => row.schema === validated.schema && row.event_id === validated.event_id);
      if (sameId) {
        if (JSON.stringify(sameId) === JSON.stringify(validated)) {
          receipt = { status: 'duplicate', event: sameId, locked, error: null };
        } else {
          receipt = { status: 'rejected', event: null, locked, error: 'event_id already exists with different facts' };
        }
        return;
      }
      const conflicts = existing
        .filter((row) => logicalKey(row) === logicalKey(validated))
        .map((row) => row.event_id)
        .filter(Boolean);
      if (conflicts.length) {
        validated.conflict_with_event_ids = Array.from(new Set([
          ...(validated.conflict_with_event_ids || []),
          ...conflicts
        ])).slice(0, MAX_ARRAY_ITEMS);
        validateEvent(validated);
      }
      fs.appendFileSync(logFile, JSON.stringify(validated) + '\n');
      receipt = { status: 'appended', event: validated, locked, error: null };
    });
    return receipt || { status: 'failed', event: null, error: 'append produced no receipt' };
  } catch (error) {
    if (options.fallbackUnlocked === true && options.logFile) {
      try { appendLineLocked(options.logFile, ''); } catch (_) { /* passive sensor */ }
    }
    return { status: 'rejected', event: null, error: error.message };
  }
}

function sha256Reference(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

module.exports = {
  SCHEMAS,
  MAX_ID_BYTES,
  MAX_ARRAY_ITEMS,
  MAX_EVENT_BYTES,
  buildSpanCompletion,
  buildReflexOutcome,
  validateEvent,
  appendCompletionEvent,
  readCompletionEvents,
  logicalKey,
  isRepoReference,
  sha256Reference
};
