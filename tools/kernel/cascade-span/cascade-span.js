'use strict';

/**
 * cascade-span.js — CascadeSpan/1.0 canonical reference lib.
 *
 * CANONICAL CONTRACT. This is the typed enforcement-span contract named in
 * _dev/concepts/sovereign-core-harness.md as "the single non-negotiable contract
 * binding the two enforcement homes" (Claude-Code hook today; forked pi-mono
 * native later; Tool Broker for brokered/external-model action). Every home
 * emits THIS shape with identical node/work lineage so the control plane never
 * bifurcates (the council's #1 ranked risk: "schema bifurcation under urgency").
 *
 * Ownership / consumption (master-program-of-work Phase-1 coordination):
 *   master-program-of-work Phase-1 is the CANONICAL OWNER of the cascade
 *   identity/lineage discipline, whose emergent implementation is
 *   tools/telemetry/dispatches/lib/emit-span.cjs (span_schema_version 3) and its
 *   propagation source tools/telemetry/dispatches/lib/trace-context.cjs. This
 *   contract CONSUMES those identity fields (trace_id, span_id, parent_span_id,
 *   and the scope lineage) with the owner's field names/semantics — it does not
 *   re-author or fork them. What this contract ADDS, on top of the shared
 *   lineage, is the enforcement superstructure the sovereign-core-harness concept
 *   requires: {node, action, enforcement_home, status} typed event classes for
 *   permission-staged/brokered action. The owner's dispatch/spawn span
 *   (emit-span.cjs, dispatches.jsonl) and this enforcement span are two span
 *   TYPES under ONE lineage identity, not two rival identity schemas.
 *
 * This lib gives:
 *   - makeSpan(fields)          assemble a fully-shaped CascadeSpan/1.0 envelope
 *   - validateSpan(span)        validate against cascade-span.schema.json
 *   - fromHookEvent(evt)        adapter: Claude-Code hook event     -> CascadeSpan
 *   - fromSessionClose(evt)     adapter: session close/sweep record -> CascadeSpan
 *   - fromBrokerAction(action)  adapter: Tool Broker action         -> CascadeSpan
 *   - writeSpan(span, opts)     fail-open durable sink (cascade-spans.jsonl)
 *
 * The adapters take the DIFFERENT native inputs of the enforcement homes and land
 * them on ONE identical shape. That convergence is the whole point.
 *
 * Design invariant carried from tools/telemetry/dispatches/lib/emit-span.cjs:
 * the span builder is a PASSIVE SENSOR. It never generates timestamps or ids —
 * the caller passes them in. It never performs an action — it only records one.
 * writeSpan is fail-open: a write failure logs to stderr and returns null; it
 * never throws into, and never blocks, the emitting caller.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_ID = 'CascadeSpan/1.0';
const SCHEMA_VERSION = '1.0';
const SCHEMA_PATH = path.join(__dirname, 'cascade-span.schema.json');

// Durable sink. Sibling of the owner's dispatches.jsonl, under the same
// telemetry convention — a distinct file because this is a distinct span TYPE
// (enforcement span) from the owner's dispatch/spawn span; mixing shapes into
// one file would bifurcate that file's schema.
const SPAN_LOG_ENV = 'MYTHOS_CASCADE_SPAN_LOG';

function defaultSpanLogPath(projectRoot) {
  const root = projectRoot || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(root, '_dev', 'reports', 'telemetry', 'cascade-spans.jsonl');
}

// ---------------------------------------------------------------------------
// Validator — bundled ajv (draft 2020-12). If ajv is unavailable we fall back
// to a minimal structural check so the contract still validates anywhere.
// validateSpan reports which validator ran via result.validator.
// ---------------------------------------------------------------------------
let _validator = null;

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function buildAjvValidator() {
  // eslint-disable-next-line global-require
  const Ajv2020 = require('ajv/dist/2020');
  // eslint-disable-next-line global-require
  const addFormats = tryRequire('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  if (addFormats) addFormats(ajv);
  const validate = ajv.compile(loadSchema());
  return {
    kind: 'ajv-2020',
    run(span) {
      const ok = validate(span);
      return { ok, errors: ok ? [] : (validate.errors || []).map(formatAjvError) };
    }
  };
}

function tryRequire(mod) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(mod);
  } catch (_) {
    return null;
  }
}

function formatAjvError(e) {
  return `${e.instancePath || '(root)'} ${e.message}`.trim();
}

// Minimal fallback: enough shape-checking to keep validation honest if ajv is
// missing. NOT a substitute for the schema; only the required top-level fields,
// the required nested objects, and the closed enums.
function buildFallbackValidator() {
  const ENUMS = {
    'action.classified_layer': ['read-only', 'proposal', 'bounded-patch', 'autonomous'],
    'action.verdict': ['allow', 'deny', 'escalate'],
    enforcement_home: ['claude-hook', 'tool-broker', 'native'],
    status: ['ok', 'denied', 'escalated', 'tombstone']
  };
  return {
    kind: 'fallback-shape-check',
    run(span) {
      const errors = [];
      if (!span || typeof span !== 'object') return { ok: false, errors: ['(root) not an object'] };
      if (span.schema_id !== SCHEMA_ID) errors.push(`schema_id must be ${SCHEMA_ID}`);
      if (span.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
      for (const f of ['span_id']) {
        if (typeof span[f] !== 'string' || !span[f]) errors.push(`${f} required non-empty string`);
      }
      const node = span.node || {};
      for (const f of ['actor', 'harness']) {
        if (typeof node[f] !== 'string' || !node[f]) errors.push(`node.${f} required non-empty string`);
      }
      if (!('model_family' in node)) errors.push('node.model_family required (string|null)');
      const scope = span.scope || {};
      if (!('scope_identity' in scope)) errors.push('scope.scope_identity required');
      if (!('work_unit' in scope)) errors.push('scope.work_unit required');
      const action = span.action || {};
      if (typeof action.proposed !== 'string' || !action.proposed) errors.push('action.proposed required non-empty string');
      if (!ENUMS['action.classified_layer'].includes(action.classified_layer)) errors.push('action.classified_layer invalid enum');
      if (!ENUMS['action.verdict'].includes(action.verdict)) errors.push('action.verdict invalid enum');
      if (!ENUMS.enforcement_home.includes(span.enforcement_home)) errors.push('enforcement_home invalid enum');
      const ts = span.timestamps || {};
      if (typeof ts.started_at !== 'string' || !ts.started_at) errors.push('timestamps.started_at required');
      if (!ENUMS.status.includes(span.status)) errors.push('status invalid enum');
      return { ok: errors.length === 0, errors };
    }
  };
}

function getValidator() {
  if (_validator) return _validator;
  const ajv = tryRequire('ajv/dist/2020');
  _validator = ajv ? buildAjvValidator() : buildFallbackValidator();
  return _validator;
}

/**
 * validateSpan(span) -> { ok, errors, validator }
 * validator is 'ajv-2020' (schema-backed) or 'fallback-shape-check'.
 */
function validateSpan(span) {
  const v = getValidator();
  const { ok, errors } = v.run(span);
  return { ok, errors, validator: v.kind };
}

// ---------------------------------------------------------------------------
// makeSpan — assemble the locked envelope. Caller supplies every value; this
// builder normalizes shape and pins the contract constants. It does NOT invent
// timestamps or ids (passive sensor).
// ---------------------------------------------------------------------------
function makeSpan(fields = {}) {
  const node = fields.node || {};
  const scope = fields.scope || {};
  const action = fields.action || {};
  const timestamps = fields.timestamps || {};
  return {
    schema_id: SCHEMA_ID,
    schema_version: SCHEMA_VERSION,
    span_id: fields.span_id,
    parent_span_id: fields.parent_span_id ?? null,
    trace_id: fields.trace_id ?? null,
    node: {
      actor: node.actor,
      harness: node.harness,
      model_family: node.model_family ?? null
    },
    scope: {
      scope_identity: scope.scope_identity ?? null,
      work_unit: scope.work_unit ?? null,
      lineage_root: scope.lineage_root ?? null
    },
    action: {
      proposed: action.proposed,
      classified_layer: action.classified_layer,
      verdict: action.verdict
    },
    evidence: Array.isArray(fields.evidence) ? fields.evidence : [],
    enforcement_home: fields.enforcement_home,
    timestamps: {
      started_at: timestamps.started_at,
      ended_at: timestamps.ended_at ?? null
    },
    status: fields.status
  };
}

// ---------------------------------------------------------------------------
// Adapter A — Claude-Code hook event -> CascadeSpan/1.0
//
// Input shape mirrors what tools/claude/lib/hook-telemetry.cjs records plus the
// lineage/verdict a PreToolUse gate hook has in hand (session_id, tool_name,
// permissionDecision). enforcement_home is fixed to 'claude-hook'.
// ---------------------------------------------------------------------------
const HOOK_DECISION_TO_VERDICT = { allow: 'allow', deny: 'deny', ask: 'escalate' };
const HOOK_DECISION_TO_STATUS = { allow: 'ok', deny: 'denied', ask: 'escalated' };

function fromHookEvent(evt = {}) {
  const decision = evt.permissionDecision || 'allow';
  return makeSpan({
    span_id: evt.span_id,
    parent_span_id: evt.parent_span_id ?? null,
    trace_id: evt.trace_id ?? evt.session_id ?? null,
    node: {
      actor: evt.actor_role || 'coordinator',
      harness: 'claude-code-cli',
      model_family: evt.model_family || 'claude'
    },
    scope: {
      scope_identity: evt.scope_identity ?? null,
      work_unit: evt.step_id ?? evt.plan_id ?? null,
      lineage_root: evt.lineage_root_session_id ?? evt.session_id ?? null
    },
    action: {
      proposed: `${evt.tool_name || evt.matcher || 'tool'}: ${evt.event || 'invoke'}`,
      classified_layer: evt.classified_layer || 'bounded-patch',
      verdict: HOOK_DECISION_TO_VERDICT[decision] || 'allow'
    },
    evidence: evt.artifacts || [],
    enforcement_home: 'claude-hook',
    timestamps: {
      started_at: evt.timestamp,
      ended_at: evt.ended_at ?? null
    },
    status: evt.status || HOOK_DECISION_TO_STATUS[decision] || 'ok'
  });
}

// ---------------------------------------------------------------------------
// Adapter B — session close / sweep record -> CascadeSpan/1.0
//
// The Claude-Code session close path (tools/sessions/lib/active-session-registry.js
// closeSession + sweepExpired) is a lifecycle-bookkeeping action, not a brokered
// write — so classified_layer is 'read-only'. enforcement_home is 'claude-hook'
// (the close runs under the Claude-Code runtime). A crashed/TTL-expired session
// swept by sweepExpired writes a lineage-carrying TOMBSTONE (concept adjustment
// #5 + master-program keystone "registry is a coroner, not a guard"): no silent
// loss. The caller supplies lineage from the owner's trace context (consume, not
// fork) and generates span_id/timestamps (passive sensor).
// ---------------------------------------------------------------------------
function fromSessionClose(evt = {}) {
  const crashed = evt.crashed === true;
  const reason = evt.reason || (crashed ? 'ttl-expired' : 'closed');
  const verb = crashed ? 'session-sweep' : 'session-close';
  return makeSpan({
    span_id: evt.span_id,
    parent_span_id: evt.parent_span_id ?? null,
    trace_id: evt.trace_id ?? evt.session_id ?? null,
    node: {
      actor: evt.actor || 'coordinator',
      harness: 'claude-code-cli',
      model_family: evt.model_family ?? null
    },
    scope: {
      scope_identity: evt.scope_identity ?? null,
      work_unit: evt.work_unit ?? null,
      lineage_root: evt.lineage_root ?? evt.session_id ?? null
    },
    action: {
      proposed: `${verb}: ${reason}`,
      classified_layer: 'read-only',
      verdict: 'allow'
    },
    evidence: evt.artifacts || [],
    enforcement_home: 'claude-hook',
    timestamps: {
      started_at: evt.started_at,
      ended_at: evt.ended_at ?? null
    },
    // A crashed/TTL-expired session writes a lineage-carrying tombstone.
    status: crashed ? 'tombstone' : 'ok'
  });
}

// ---------------------------------------------------------------------------
// Adapter C — Tool Broker action -> CascadeSpan/1.0
//
// Input shape mirrors the concept's Tool Broker: it receives a model's PROPOSED
// action, classifies it against the 4-phase permission staging, and rules
// allow/deny/escalate. enforcement_home is fixed to 'tool-broker'. A brokered
// external model supplies its own model_family (gemini/gpt/local-*).
// ---------------------------------------------------------------------------
const BROKER_PHASE_TO_LAYER = {
  1: 'read-only',
  2: 'proposal',
  3: 'bounded-patch',
  4: 'autonomous'
};
const BROKER_DECISION_TO_STATUS = { allow: 'ok', deny: 'denied', escalate: 'escalated' };

function fromBrokerAction(action = {}) {
  const decision = action.decision || 'allow';
  const crashed = action.crashed === true;
  return makeSpan({
    span_id: action.span_id,
    parent_span_id: action.parent_span_id ?? null,
    trace_id: action.trace_id ?? action.correlation_id ?? null,
    node: {
      actor: action.adapter_role || 'broker-adapter',
      harness: 'tool-broker',
      model_family: action.model_family || null
    },
    scope: {
      scope_identity: action.scope_identity ?? null,
      work_unit: action.work_unit ?? action.step_id ?? null,
      lineage_root: action.lineage_root ?? null
    },
    action: {
      proposed: action.proposed_action || `${action.tool || 'tool'}: ${action.summary || 'invoke'}`,
      classified_layer: BROKER_PHASE_TO_LAYER[action.permission_phase] || 'read-only',
      verdict: decision
    },
    evidence: action.artifacts || [],
    enforcement_home: 'tool-broker',
    timestamps: {
      started_at: action.started_at,
      ended_at: action.ended_at ?? null
    },
    // A crashed sub-mind writes a lineage-carrying tombstone (concept adj. #5).
    status: crashed ? 'tombstone' : (BROKER_DECISION_TO_STATUS[decision] || 'ok')
  });
}

// ---------------------------------------------------------------------------
// writeSpan — durable, fail-open sink for a fully-shaped span. Mirrors the
// emit-span.cjs invariant: never throws, never blocks the caller. Returns the
// written log path on success, or null on failure. The caller is responsible
// for having shaped/validated the span; this is a passive sink.
// ---------------------------------------------------------------------------
function writeSpan(span, opts = {}) {
  try {
    const logPath = opts.logPath || process.env[SPAN_LOG_ENV] || defaultSpanLogPath(opts.projectRoot);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(span) + '\n');
    return logPath;
  } catch (err) {
    process.stderr.write(`[cascade-span] failed to record span (fail-open): ${err.message}\n`);
    return null;
  }
}

module.exports = {
  SCHEMA_ID,
  SCHEMA_VERSION,
  SCHEMA_PATH,
  SPAN_LOG_ENV,
  defaultSpanLogPath,
  loadSchema,
  makeSpan,
  validateSpan,
  fromHookEvent,
  fromSessionClose,
  fromBrokerAction,
  writeSpan
};
