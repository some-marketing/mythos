/**
 * Mythos Trace Writer
 *
 * Append-only trace event writer for the unified event model.
 * Used by runtime controls to emit events into the normalized trace surface.
 *
 * Usage:
 *   const { startTrace, writeEvent, endTrace, writeStandaloneEvent } = require('./lib/trace-writer');
 *
 *   const sessionId = startTrace('verify-framework run', 'wordpress/qa');
 *   writeEvent(sessionId, 'verification_run', 'system', 'wordpress/qa', { verdict: 'PASS' });
 *   endTrace(sessionId, 'pass');
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const TRACES_DIR = path.join(ROOT, '_dev/traces');
const NORMALIZED_LOG = path.join(TRACES_DIR, 'normalized-events.jsonl');

const VALID_EVENT_TYPES = [
  'verification_run', 'signal_lifecycle', 'routing_decision',
  'artifact_lifecycle', 'task_plan', 'task_outcome',
  'framework_execution', 'lessons_capture', 'operator_correction'
];

const VALID_ACTORS = ['system', 'operator', 'codex', 'claude', 'local-model'];

function eventId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function ensureDir() {
  if (!fs.existsSync(TRACES_DIR)) {
    fs.mkdirSync(TRACES_DIR, { recursive: true });
  }
}

/**
 * Start a new trace session. Returns session ID.
 */
function startTrace(description, scope) {
  ensureDir();
  const sessionId = `session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const startEvent = {
    event_id: eventId('ses'),
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'framework_execution',
    source_surface: 'manual',
    actor: 'system',
    scope: scope || 'unknown',
    payload: {
      action: 'session_start',
      description: description || ''
    }
  };
  appendEvent(startEvent);
  return sessionId;
}

/**
 * Write an event to the trace log within a session.
 */
function writeEvent(sessionId, eventType, actor, scope, payload) {
  if (!VALID_EVENT_TYPES.includes(eventType)) {
    console.error(`Invalid event type: ${eventType}. Valid: ${VALID_EVENT_TYPES.join(', ')}`);
    return null;
  }
  if (!VALID_ACTORS.includes(actor)) {
    console.error(`Invalid actor: ${actor}. Valid: ${VALID_ACTORS.join(', ')}`);
    return null;
  }

  const event = {
    event_id: eventId(eventType.substring(0, 3)),
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    source_surface: 'manual',
    actor,
    scope: scope || 'unknown',
    payload: payload || {}
  };

  appendEvent(event);
  return event.event_id;
}

/**
 * End a trace session with an outcome.
 */
function endTrace(sessionId, outcomeClass) {
  const endEvent = {
    event_id: eventId('end'),
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    event_type: 'framework_execution',
    source_surface: 'manual',
    actor: 'system',
    scope: 'session',
    payload: {
      action: 'session_end',
      outcome_class: outcomeClass || 'pass'
    }
  };
  appendEvent(endEvent);
}

/**
 * Write a standalone event (not part of a session).
 */
function writeStandaloneEvent(eventType, actor, scope, sourceSurface, payload) {
  if (!VALID_EVENT_TYPES.includes(eventType)) {
    console.error(`Invalid event type: ${eventType}. Valid: ${VALID_EVENT_TYPES.join(', ')}`);
    return null;
  }
  if (!VALID_ACTORS.includes(actor)) {
    console.error(`Invalid actor: ${actor}. Valid: ${VALID_ACTORS.join(', ')}`);
    return null;
  }

  const event = {
    event_id: eventId(eventType.substring(0, 3)),
    session_id: null,
    timestamp: new Date().toISOString(),
    event_type: eventType,
    source_surface: sourceSurface || 'manual',
    actor,
    scope: scope || 'unknown',
    payload: payload || {}
  };
  appendEvent(event);
  return event.event_id;
}

function appendEvent(event) {
  ensureDir();
  fs.appendFileSync(NORMALIZED_LOG, JSON.stringify(event) + '\n', 'utf8');
}

module.exports = { startTrace, writeEvent, endTrace, writeStandaloneEvent };
