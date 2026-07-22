// coverage.cjs — multi-denominator cascade coverage (c6-mind-coverage-repair).
//
// Implements the §1 CANONICAL COVERAGE BASELINE rule from the P3b spec and the
// per-dimension Visibility Contract from
// `_dev/concepts/cascade-observability-dimension-taxonomy.md`.
//
// Two coverage MEASURES (never merged):
//   - identity  : parent_span_id AND (model OR mind_class OR harness) — the
//                 linked-lineage-with-provenance signal the views depend on.
//                 Counting `model` alone suppressed honest C6.2 sentinels.
//   - economics : a WITNESSED model (model present AND model_verified !== false).
//                 Cost/tier derive from this — NEVER from mind_class/harness.
//
// And the multi-denominator HONESTY breakdown so a structurally-unwitnessable or
// legacy-absent row is never counted as a writer failure or as dead schema.
'use strict';

const { FIELD_ADDED_VERSION } = require('./emit-span.cjs');

const REFLEX_COVERAGE_SCHEMA = 'ReflexCoverage/1.0';
const COMPLETION_SCHEMAS = new Set(['SpanCompletion/1.0', 'ReflexOutcome/1.0']);
const DENOMINATOR_FAMILIES = Object.freeze([
  'eligible_invocations_started',
  'physical_trace_linkage',
  'completion_annotation',
  'witnessed_model_identity_and_token_usage',
  'deterministic_handler_receipt',
  'hybrid_or_mechanical_model_fallback',
  'reviewer_bridge_and_fallback_model_calls',
  'retry_correction_reopen_and_rollback_loops',
  'structural_verdict',
  'independent_semantic_verdict',
  'named_operator_or_client_acceptance'
]);
const HONESTY_BUCKETS = Object.freeze([
  'eligible', 'witnessed', 'unknown', 'legacy', 'excluded_with_reason',
  'structurally_unwitnessable'
]);
const GROUP_DIMENSIONS = Object.freeze([
  'command_id', 'framework_id', 'stage_id', 'harness', 'actor_family',
  'trigger_class', 'decision_point_id', 'time_window'
]);
const OWNED_LIMITED_PRODUCERS = new Set(['mythos-command-runner', 'workspace-run-state']);

// A row with no span_schema_version predates versioning => treated as v1.
function effectiveVersion(span) {
  return Number.isInteger(span && span.span_schema_version) ? span.span_schema_version : 1;
}

// A "real" id is non-empty and not an unknown/unverified sentinel string.
function realish(v) {
  if (!v) return false;
  const s = String(v);
  return !s.includes('unknown') && !s.includes('-unverified');
}

// Witnessed model = a model is present and not explicitly marked unverified.
function hasWitnessedModel(span) {
  return !!span.model && span.model_verified !== false;
}

const WITNESS_VALUES = Object.freeze(['witnessed', 'inferred', 'sentinel', 'structurally_unwitnessable', 'legacy_absent']);

// Generic witness bucket for any versioned dimension field (cascade-trigger-dimension
// generalized this from the harness-specific original). A row with NO value for the
// field is `legacy_absent`; otherwise the recorded witness_state enum, defaulting a
// present-but-unlabeled value to 'witnessed'.
function fieldWitnessBucket(span, field, witnessField) {
  if (!span[field]) return 'legacy_absent';
  const ws = span[witnessField];
  return WITNESS_VALUES.includes(ws) ? ws : 'witnessed';
}

function harnessBucket(span) {
  return fieldWitnessBucket(span, 'harness', 'harness_witness_state');
}

// Versioned witness-bearing dimensions, driven by FIELD_ADDED_VERSION (single
// source of truth). Each gets its own witness-bucket set + a per-field gap count.
const VERSIONED_FIELDS = Object.freeze([
  { field: 'harness', witness: 'harness_witness_state', out: 'harness_witness' },
  { field: 'trigger_class', witness: 'trigger_witness_state', out: 'trigger_witness' }
]);

function emptyWitnessBuckets() {
  return { witnessed: 0, inferred: 0, sentinel: 0, structurally_unwitnessable: 0, legacy_absent: 0 };
}

// The mind witness bucket for one span. A row with no model AND no mind_class is
// `legacy_absent` (pre-provenance row); otherwise witnessed/sentinel/inferred.
function mindBucket(span) {
  if (hasWitnessedModel(span)) return 'witnessed';
  if (span.model_verified === false && span.mind_class) return 'sentinel';
  if (span.mind_class) return 'inferred';
  return 'legacy_absent';
}

/**
 * computeCoverage — pure. Given an array of span rows, return the two coverage
 * measures plus the multi-denominator honesty breakdown for mind and harness.
 */
function computeCoverage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;

  let identity = 0;
  let economics = 0;
  const mind = { witnessed: 0, inferred: 0, sentinel: 0, legacy_absent: 0 };
  // Per-field witness buckets + gaps, built uniformly from VERSIONED_FIELDS.
  // gaps[field] = current-version row MISSING the field its schema version added
  // (a real writer failure) — NOT legacy_absent, NOT a witness_state enum member.
  // Reported separately so the enum stays clean. (c6 escalation_trigger resolved;
  // generalized per-field by cascade-trigger-dimension.)
  const witness = {};
  const gaps = {};
  for (const vf of VERSIONED_FIELDS) { witness[vf.out] = emptyWitnessBuckets(); gaps[vf.field] = 0; }

  for (const span of list) {
    if (!span || typeof span !== 'object') continue;
    const linked = realish(span.parent_span_id);
    const hasProvenance = !!span.model || !!span.mind_class || !!span.harness;
    if (linked && hasProvenance) identity++;
    if (hasWitnessedModel(span)) economics++;

    mind[mindBucket(span)]++;

    const ver = effectiveVersion(span);
    for (const vf of VERSIONED_FIELDS) {
      // version-aware: a current-version row missing the field is a gap, not legacy.
      if (!span[vf.field] && ver >= FIELD_ADDED_VERSION[vf.field]) {
        gaps[vf.field]++;
      } else {
        witness[vf.out][fieldWitnessBucket(span, vf.field, vf.witness)]++;
      }
    }
  }
  const harness = witness.harness_witness;

  // `eligible` is the explicit denominator the P3b spec §3 names (every span in
  // the store is eligible to carry provenance). Surfaced explicitly so a reader
  // never has to infer the denominator from `total`.
  const eligible = total;
  const pct = (n) => (eligible ? +((n / eligible) * 100).toFixed(2) : 0);

  return {
    total,
    eligible,
    // identity coverage = linked-lineage-with-provenance (the build-gate key)
    identity: { count: identity, eligible, pct: pct(identity) },
    // economics coverage = witnessed model (cost/tier basis)
    economics: { count: economics, eligible, pct: pct(economics) },
    // honesty breakdown — separate denominators (canonical witness_state enum),
    // never merged into one fraction. harness_witness buckets + gaps.harness =
    // eligible (current-version rows missing harness are counted in gaps, not legacy_absent).
    mind_witness: mind,
    harness_witness: harness,
    trigger_witness: witness.trigger_witness,
    // current-version writer gaps per field (NOT witness_state enum members)
    gaps
  };
}

function eventDecision(row) {
  return row.decision_point_id_or_stage_id || row.decision_point_id || row.stage_id || null;
}

function actorFamily(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (text.includes('claude') || text.includes('anthropic')) return 'claude';
  if (text.includes('gemini') || text.includes('google')) return 'gemini';
  if (text.includes('codex') || text.includes('openai') || text.includes('gpt')) return 'codex';
  if (text.includes('qwen') || text.includes('deepseek') || text.includes('ollama') || text.includes('local')) return 'local';
  return text.slice(0, 256);
}

function buildObservationUnits(rows) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
  const physical = list.filter((row) => !COMPLETION_SCHEMAS.has(row.schema));
  const spanContext = new Map();
  for (const span of physical) {
    const key = `${span.trace_id || ''}\u001f${span.span_id || ''}`;
    if (!spanContext.has(key)) spanContext.set(key, span);
  }

  const eventUnits = new Map();
  for (const event of list.filter((row) => COMPLETION_SCHEMAS.has(row.schema))) {
    const decision = eventDecision(event) || 'unknown';
    const key = [event.trace_id, event.span_id, event.run_id, decision].join('\u001f');
    const unit = eventUnits.get(key) || { kind: 'decision', completion: null, reflex: null };
    if (event.schema === 'SpanCompletion/1.0') unit.completion = event;
    if (event.schema === 'ReflexOutcome/1.0') unit.reflex = event;
    eventUnits.set(key, unit);
  }

  const units = [];
  for (const unit of eventUnits.values()) {
    const event = unit.completion || unit.reflex;
    unit.event = event;
    unit.span = spanContext.get(`${event.trace_id || ''}\u001f${event.span_id || ''}`) || null;
    units.push(unit);
  }
  for (const span of physical) units.push({ kind: 'physical', span, event: null, completion: null, reflex: null });
  return units;
}

function isOwnedLimited(unit) {
  const source = unit.event && unit.event.emit_source;
  return OWNED_LIMITED_PRODUCERS.has(source);
}

function hasAnyLoop(event) {
  if (!event) return false;
  return ['retry_event_ids', 'correction_event_ids', 'reopen_event_ids', 'rollback_event_ids']
    .some((field) => Array.isArray(event[field]) && event[field].length > 0) ||
    Boolean(event.prior_event_id || event.correction_reference_event_id);
}

function classifyUnit(unit, family) {
  const span = unit.span;
  const completion = unit.completion;
  const reflex = unit.reflex;
  const event = unit.event;
  if (family === 'eligible_invocations_started') return 'witnessed';
  if (family === 'physical_trace_linkage') {
    const trace = (event && event.trace_id) || (span && span.trace_id);
    const spanId = (event && event.span_id) || (span && span.span_id);
    if (realish(trace) && realish(spanId)) return 'witnessed';
    return unit.kind === 'physical' && effectiveVersion(span) < 3 ? 'legacy' : 'unknown';
  }
  if (family === 'completion_annotation') {
    if (completion) return 'witnessed';
    return unit.kind === 'physical' ? 'legacy' : 'unknown';
  }
  if (family === 'witnessed_model_identity_and_token_usage') {
    if (span && hasWitnessedModel(span) &&
        (span.total_tokens != null || (span.tokens_in != null && span.tokens_out != null))) return 'witnessed';
    if (completion && completion.usage_provenance === 'structurally_unwitnessable') return 'structurally_unwitnessable';
    if (completion && completion.usage_provenance === 'unavailable') return 'unknown';
    return unit.kind === 'physical' && effectiveVersion(span) < 3 ? 'legacy' : 'unknown';
  }
  if (family === 'deterministic_handler_receipt') {
    if (reflex && reflex.execution_path === 'deterministic' && reflex.handler_receipt_ref) return 'witnessed';
    if (reflex && ['model', 'hybrid', 'fallback'].includes(reflex.execution_path)) return 'excluded_with_reason';
    return unit.kind === 'physical' ? 'legacy' : 'unknown';
  }
  if (family === 'hybrid_or_mechanical_model_fallback') {
    if (reflex && ['hybrid', 'fallback'].includes(reflex.execution_path) &&
        (reflex.fallback_actor_id || reflex.fallback_reason_code)) return 'witnessed';
    if (reflex && reflex.execution_path === 'deterministic') return 'excluded_with_reason';
    return isOwnedLimited(unit) ? 'structurally_unwitnessable' : (unit.kind === 'physical' ? 'legacy' : 'unknown');
  }
  if (family === 'reviewer_bridge_and_fallback_model_calls') {
    if ((span && (span.actor_role === 'reviewer' || /bridge/.test(String(span.emit_source || '')))) ||
        (reflex && reflex.fallback_actor_id)) return 'witnessed';
    return isOwnedLimited(unit) ? 'structurally_unwitnessable' : (unit.kind === 'physical' ? 'unknown' : 'unknown');
  }
  if (family === 'retry_correction_reopen_and_rollback_loops') {
    if (hasAnyLoop(completion) || hasAnyLoop(reflex)) return 'witnessed';
    return isOwnedLimited(unit) ? 'structurally_unwitnessable' : (unit.kind === 'physical' ? 'legacy' : 'unknown');
  }
  if (family === 'structural_verdict') {
    if (reflex && reflex.structural_verdict_ref) return 'witnessed';
    return isOwnedLimited(unit) ? 'structurally_unwitnessable' : (unit.kind === 'physical' ? 'legacy' : 'unknown');
  }
  if (family === 'independent_semantic_verdict') {
    if (reflex && reflex.independent_semantic_verdict_ref) return 'witnessed';
    return isOwnedLimited(unit) ? 'structurally_unwitnessable' : (unit.kind === 'physical' ? 'legacy' : 'unknown');
  }
  if (family === 'named_operator_or_client_acceptance') {
    if (reflex && reflex.acceptance_ref) return 'witnessed';
    return isOwnedLimited(unit) ? 'structurally_unwitnessable' : (unit.kind === 'physical' ? 'legacy' : 'unknown');
  }
  return 'unknown';
}

function computeDenominators(units) {
  const reports = {};
  for (const family of DENOMINATOR_FAMILIES) {
    const report = {
      eligible: units.length,
      witnessed: 0,
      unknown: 0,
      legacy: 0,
      excluded_with_reason: 0,
      structurally_unwitnessable: 0,
      not_measurable: true
    };
    for (const unit of units) report[classifyUnit(unit, family)]++;
    report.not_measurable = report.witnessed === 0;
    reports[family] = report;
  }
  return reports;
}

function groupValue(unit, dimension) {
  const event = unit.event || {};
  const span = unit.span || {};
  if (dimension === 'command_id') return event.command_id || span.command_id || 'unknown';
  if (dimension === 'framework_id') return event.framework_id || span.framework_id || 'unknown';
  if (dimension === 'stage_id') return event.stage_id || eventDecision(event) || span.step_id || 'unknown';
  if (dimension === 'harness') return span.harness || 'unknown';
  if (dimension === 'actor_family') {
    return actorFamily(event.fallback_actor_id || span.mind_class || span.model) || 'unknown';
  }
  if (dimension === 'trigger_class') return span.trigger_class || 'unknown';
  if (dimension === 'decision_point_id') return eventDecision(event) || span.step_id || 'unknown';
  if (dimension === 'time_window') {
    const timestamp = event.observed_at || span.timestamp;
    return typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timestamp)
      ? timestamp.slice(0, 10)
      : 'unknown';
  }
  return 'unknown';
}

function computeReflexCoverage(rows) {
  const units = buildObservationUnits(rows);
  const groups = {};
  for (const dimension of GROUP_DIMENSIONS) {
    const byValue = new Map();
    for (const unit of units) {
      const value = groupValue(unit, dimension);
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push(unit);
    }
    groups[dimension] = Object.fromEntries(
      [...byValue.entries()].map(([value, groupedUnits]) => [value, computeDenominators(groupedUnits)])
    );
  }
  return {
    schema: REFLEX_COVERAGE_SCHEMA,
    prospective_only: true,
    inference_reduction_claim_authorized: false,
    unit_count: units.length,
    honesty_buckets: HONESTY_BUCKETS,
    denominators: computeDenominators(units),
    groups
  };
}

module.exports = {
  computeCoverage,
  computeReflexCoverage,
  buildObservationUnits,
  realish,
  hasWitnessedModel,
  harnessBucket,
  fieldWitnessBucket,
  mindBucket,
  VERSIONED_FIELDS,
  DENOMINATOR_FAMILIES,
  HONESTY_BUCKETS,
  GROUP_DIMENSIONS,
  REFLEX_COVERAGE_SCHEMA
};

// Thin CLI: `node coverage.cjs [path-to-dispatches.jsonl]` — prints the
// multi-denominator coverage of the live store (the §3 coverage-denominator
// query). Fail-open: a parse error on one row is skipped, never fatal.
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const file = process.argv[2] || path.join(root, '_dev/reports/telemetry/dispatches.jsonl');
  let rows = [];
  try {
    rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (err) {
    process.stderr.write(`coverage: cannot read ${file}: ${err.message}\n`);
    process.exit(1);
  }
  const cov = computeCoverage(rows);
  const reflex = computeReflexCoverage(rows);
  process.stdout.write(JSON.stringify({ file, ...cov, reflex }, null, 2) + '\n');
}
