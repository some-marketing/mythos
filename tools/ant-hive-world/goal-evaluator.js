#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/goal-evaluator.js -- GoalPacket/1.0 evaluation.
//
// WHAT THIS IS: a pure, read-only predicate evaluated over the SANITIZED
// shared world-state. It answers one question -- "does the world currently
// satisfy the goal packet's conditions?" -- and it answers it in the reporting
// path only.
//
// ONE-WAY ISOLATION (plan ant-world-goal-round-1, hard constraint F1). The
// value this module returns flows to reports and to the sanitized projection,
// and NOWHERE else. Nothing in world-mind.js, harness.js, train-tick.js or
// world-train.js requires this file, and no caller may feed an evaluation back
// into a decision, a reward, a parameter update or a world write. Hunger may
// change behavior through the WORLD (stockpiles and food sources the minds
// already perceive); the goal's EVALUATION of that hunger may not. That
// boundary is what makes any observed building emergent rather than
// evaluator-induced. It is enforced by three things, in this order:
//   1. this module exports no mutator and performs no write of any kind;
//   2. run-live.js calls it after every decision and every world write for the
//      tick has already completed (the post-tick reporting path);
//   3. the S1 rehearsal ships a call-graph audit listing every consumer of the
//      return value, and an arm comparison whose PREDICTED behavioral delta is
//      exactly zero. A nonzero delta falsifies the isolation claim.
//
// MIRROR SAFETY. The evaluator may read ecology magnitudes only. Spatial and
// build surfaces -- territory, geometry_log, food_source_coords, pheromones --
// are not readable through this module at all: source fields are resolved
// through an explicit allowlist (SOURCE_FIELDS below) and an unlisted field is
// a packet validation error, not a silent zero. A goal that could read where
// things were built would bribe the mirror exactly the way the learning signal
// is forbidden to.
//
// PURITY. evaluateGoal() touches no filesystem, no clock, no RNG and no
// module-level mutable state, and it mutates neither argument. Packet loading
// (the one read) is a separate, explicitly-named function.

const fs = require('fs');
const crypto = require('node:crypto');

const EVALUATOR_VERSION = 'goal-evaluator/1.0.0';
const PACKET_SCHEMA = 'GoalPacket/1.0';
const EVALUATION_SCHEMA = 'GoalEvaluation/1.0';

// ---------------------------------------------------------------------------
// SOURCE FIELD ALLOWLIST -- the evaluator's entire read surface
// ---------------------------------------------------------------------------
// Each entry names an exact path in the sanitized world-state, how the value is
// aggregated into one number, and its units. A packet may only cite a key of
// this map. DELIBERATELY ABSENT, and never to be added without a fresh mirror
// review: `territory`, `geometry_log`, `food_source_coords`, `pheromones`, and
// every per-hive internal (which does not cross into the shared file at all --
// only the two aggregates world-state.js's summarizeHives publishes do).
const SOURCE_FIELDS = {
  'food_sources': {
    aggregation: 'sum_values',
    units: 'food-units',
    note: 'total food remaining in all discrete food patches; the same quantity encodeWorldState coordinate 0 reads'
  },
  'resources.food': { aggregation: 'scalar', units: 'food-units', note: 'shared food pool mirror of food_sources' },
  'resources.water': { aggregation: 'scalar', units: 'water-units', note: 'shared water pool accumulated by material dynamics' },
  'resources.wood': { aggregation: 'scalar', units: 'wood-units', note: 'shared wood pool' },
  'resources.stone': { aggregation: 'scalar', units: 'stone-units', note: 'shared stone pool' },
  'water_sources': { aggregation: 'sum_values', units: 'water-units', note: 'water remaining in discrete water deposits' },
  'prey_population': { aggregation: 'scalar', units: 'prey-units', note: 'ecosystem prey biomass' },
  'predator_population': { aggregation: 'scalar', units: 'predator-units', note: 'ecosystem predator biomass' },
  'hives.count': { aggregation: 'scalar', units: 'hives', note: 'number of live hives in the shared hives summary' },
  'hives.starvation_pressure': {
    aggregation: 'scalar',
    units: 'hives',
    note: 'count of hives the shared summary reports as starving; the encoder coordinate 7 input'
  }
};

const FORBIDDEN_FIELD_PREFIXES = ['territory', 'geometry_log', 'food_source_coords', 'pheromones'];

const COMPARATORS = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b
};

class GoalPacketError extends Error {
  constructor(reason, status) {
    super(reason);
    this.name = 'GoalPacketError';
    this.reason = reason;
    // A short, filename-safe token for the runner's STATUS channel. The driver
    // refuses BEFORE constructing any state, exactly like the resume gate.
    this.status = status || `goal-packet-invalid:${String(reason).replace(/[^A-Za-z0-9.:-]+/g, '-').slice(0, 120)}`;
  }
}

// ---------------------------------------------------------------------------
// CANONICAL JSON + HASHING
// ---------------------------------------------------------------------------
// Key-sorted, no insignificant whitespace, so the same packet body always
// hashes to the same digest regardless of how it was serialized. Implemented
// here rather than imported from checkpoint.js on purpose: this module is meant
// to be requirable with zero simulation dependencies, so that "nothing in the
// mind's call graph reaches the evaluator" stays checkable by grep in both
// directions.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// The packet's self-hash covers the packet body with `packet_sha256` removed --
// the same shape the checkpoint manifest uses for manifest_self_checksum, so a
// reviewer only has to learn the rule once.
function computePacketSha256(packet) {
  const body = { ...packet };
  delete body.packet_sha256;
  return sha256Hex(canonicalJson(body));
}

// ---------------------------------------------------------------------------
// PACKET VALIDATION -- refusal happens here, before any run
// ---------------------------------------------------------------------------
function validateGoalPacket(packet) {
  const errors = [];
  const push = (e) => errors.push(e);

  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { ok: false, errors: ['packet-not-an-object'], computed_sha256: null };
  }
  if (packet.schema !== PACKET_SCHEMA) push(`schema-must-be-${PACKET_SCHEMA}`);
  if (typeof packet.goal_id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(packet.goal_id)) push('goal_id-shape');
  if (typeof packet.evaluator_version !== 'string') push('evaluator_version-missing');
  else if (packet.evaluator_version !== EVALUATOR_VERSION) {
    push(`evaluator_version-mismatch-packet-${packet.evaluator_version}-runtime-${EVALUATOR_VERSION}`);
  }

  const d = packet.deadline;
  if (!d || typeof d !== 'object') push('deadline-missing');
  else {
    if (!Number.isInteger(d.absolute_tick) || d.absolute_tick < 1) push('deadline.absolute_tick-shape');
    if (!Number.isInteger(d.turns) || d.turns < 1) push('deadline.turns-shape');
    if (!Number.isInteger(d.ticks_per_turn) || d.ticks_per_turn < 1) push('deadline.ticks_per_turn-shape');
    if (Number.isInteger(d.turns) && Number.isInteger(d.ticks_per_turn) && Number.isInteger(d.absolute_tick)
        && d.turns * d.ticks_per_turn !== d.absolute_tick) push('deadline-arithmetic-inconsistent');
  }

  const sb = packet.safety_bounds;
  if (!sb || typeof sb !== 'object') push('safety_bounds-missing');
  else {
    if (sb.evaluator_read_only !== true) push('safety_bounds.evaluator_read_only-must-be-true');
    if (sb.grants_new_verbs !== false) push('safety_bounds.grants_new_verbs-must-be-false');
    if (sb.reads_spatial_or_build_fields !== false) push('safety_bounds.reads_spatial_or_build_fields-must-be-false');
    if (sb.intervenes_on_extinction !== false) push('safety_bounds.intervenes_on_extinction-must-be-false');
  }

  if (!Array.isArray(packet.conditions) || packet.conditions.length === 0) push('conditions-empty');
  else {
    const seen = new Set();
    packet.conditions.forEach((c, i) => {
      const at = `conditions[${i}]`;
      if (!c || typeof c !== 'object') { push(`${at}-not-an-object`); return; }
      if (typeof c.condition_id !== 'string' || !c.condition_id) push(`${at}.condition_id-missing`);
      else if (seen.has(c.condition_id)) push(`${at}.condition_id-duplicate`);
      else seen.add(c.condition_id);
      if (typeof c.description !== 'string' || !c.description) push(`${at}.description-missing`);
      if (!Object.prototype.hasOwnProperty.call(COMPARATORS, c.comparator)) push(`${at}.comparator-unsupported`);

      const t = c.threshold;
      if (!t || typeof t !== 'object') { push(`${at}.threshold-missing`); return; }
      for (const k of ['value', 'units', 'formula', 'source_field', 'aggregation_scope', 'derivation_datum']) {
        if (t[k] === undefined || t[k] === null) push(`${at}.threshold.${k}-missing`);
      }
      if (typeof t.value !== 'number' || !Number.isFinite(t.value)) push(`${at}.threshold.value-not-finite`);
      if (typeof t.source_field === 'string') {
        if (FORBIDDEN_FIELD_PREFIXES.some((p) => t.source_field === p || t.source_field.startsWith(`${p}.`))) {
          push(`${at}.threshold.source_field-forbidden-spatial-or-build`);
        } else if (!Object.prototype.hasOwnProperty.call(SOURCE_FIELDS, t.source_field)) {
          push(`${at}.threshold.source_field-not-allowlisted`);
        }
      }
      const dd = t.derivation_datum;
      if (dd && typeof dd === 'object') {
        if (typeof dd.observed_value !== 'number' && !Array.isArray(dd.observed_values)) {
          push(`${at}.threshold.derivation_datum-needs-observed_value-or-observed_values`);
        }
        if (typeof dd.artifact !== 'string' || !dd.artifact) push(`${at}.threshold.derivation_datum.artifact-missing`);
      } else if (dd !== undefined) {
        push(`${at}.threshold.derivation_datum-not-an-object`);
      }
    });
  }

  const computed = computePacketSha256(packet);
  if (typeof packet.packet_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(packet.packet_sha256)) {
    push('packet_sha256-shape');
  } else if (packet.packet_sha256 !== computed) {
    // THE TAMPER GATE. Any edit to any packet field after the hash was written
    // lands here, and the driver turns it into a refusal before boot.
    push(`packet_sha256-mismatch-recomputed-${computed}`);
  }

  return { ok: errors.length === 0, errors, computed_sha256: computed };
}

// Read + parse + validate. The ONLY function in this module that touches the
// filesystem, and it only ever reads. Throws GoalPacketError, which carries the
// STATUS token the driver publishes on refusal.
function loadGoalPacket(packetPath) {
  let raw;
  try {
    raw = fs.readFileSync(packetPath, 'utf8');
  } catch (e) {
    throw new GoalPacketError(`unreadable-${e.code || 'error'}`, 'goal-packet-unreadable');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GoalPacketError('not-json', 'goal-packet-not-json');
  }
  const v = validateGoalPacket(parsed);
  if (!v.ok) throw new GoalPacketError(v.errors.join(','), `goal-packet-invalid:${v.errors[0]}`);
  return { packet: parsed, sha256: parsed.packet_sha256, bytes: Buffer.byteLength(raw) };
}

// ---------------------------------------------------------------------------
// MEASUREMENT
// ---------------------------------------------------------------------------
// Resolves ONE allowlisted field of the sanitized world-state to ONE number.
// An absent field measures as 0 and says so via `present:false`, rather than
// throwing: a world-state written before a field existed is a real, reportable
// state, and a goal that crashes on it would destroy the run it was only
// supposed to observe.
function measureField(worldState, field) {
  const spec = SOURCE_FIELDS[field];
  if (!spec) throw new GoalPacketError(`source_field-not-allowlisted-${field}`, 'goal-packet-invalid:source-field');
  const parts = field.split('.');
  let node = worldState;
  for (const p of parts) {
    if (node === null || node === undefined || typeof node !== 'object') { node = undefined; break; }
    node = node[p];
  }
  if (node === undefined || node === null) {
    return { value: 0, present: false, aggregation: spec.aggregation, units: spec.units };
  }
  if (spec.aggregation === 'sum_values') {
    const vals = Object.values(node).filter((v) => typeof v === 'number' && Number.isFinite(v));
    return { value: vals.reduce((a, b) => a + b, 0), present: true, aggregation: spec.aggregation, units: spec.units };
  }
  if (typeof node !== 'number' || !Number.isFinite(node)) {
    return { value: 0, present: false, aggregation: spec.aggregation, units: spec.units };
  }
  return { value: node, present: true, aggregation: spec.aggregation, units: spec.units };
}

// ---------------------------------------------------------------------------
// THE EVALUATION -- pure, read-only, reporting-path only
// ---------------------------------------------------------------------------
// Returns the full evaluation record. `met` is the conjunction of every
// condition AS MEASURED THIS TICK; `met_at_deadline` is null until the deadline
// tick is reached, and is the round's actual verdict. Both are reported because
// "satisfied at some point" and "satisfied when it counted" are different
// claims and pooling them would be a rank-honesty failure.
function evaluateGoal(packet, worldState, absoluteTick) {
  const perCondition = [];
  const inputsRead = {};
  let met = true;
  for (const c of packet.conditions) {
    const m = measureField(worldState, c.threshold.source_field);
    inputsRead[c.threshold.source_field] = m.value;
    const satisfied = COMPARATORS[c.comparator](m.value, c.threshold.value);
    if (!satisfied) met = false;
    perCondition.push({
      condition: c.condition_id,
      description: c.description,
      source_field: c.threshold.source_field,
      source_field_present: m.present,
      aggregation: m.aggregation,
      comparator: c.comparator,
      measured: m.value,
      threshold: c.threshold.value,
      units: c.threshold.units,
      satisfied
    });
  }
  const deadlineTick = packet.deadline.absolute_tick;
  const atOrPastDeadline = absoluteTick >= deadlineTick;
  return {
    schema: EVALUATION_SCHEMA,
    goal_id: packet.goal_id,
    packet_sha256: packet.packet_sha256,
    evaluator_version: EVALUATOR_VERSION,
    evaluated_at_tick: absoluteTick,
    deadline_absolute_tick: deadlineTick,
    at_or_past_deadline: atOrPastDeadline,
    met,
    met_at_deadline: atOrPastDeadline ? met : null,
    per_condition: perCondition,
    inputs_read: inputsRead
  };
}

// Goal identity for the checkpoint manifest's `goal` field. Small on purpose:
// identity plus the verdict, never the packet body, so a lineage can be proven
// goal-bearing without the checkpoint becoming a second copy of the packet.
function goalIdentity(packet, finalEvaluation) {
  return {
    goal_id: packet.goal_id,
    packet_sha256: packet.packet_sha256,
    evaluator_version: EVALUATOR_VERSION,
    deadline_absolute_tick: packet.deadline.absolute_tick,
    final_evaluation: finalEvaluation
      ? {
        evaluated_at_tick: finalEvaluation.evaluated_at_tick,
        met: finalEvaluation.met,
        met_at_deadline: finalEvaluation.met_at_deadline,
        per_condition: finalEvaluation.per_condition.map((p) => ({
          condition: p.condition, measured: p.measured, threshold: p.threshold, satisfied: p.satisfied
        }))
      }
      : null
  };
}

module.exports = {
  EVALUATOR_VERSION,
  PACKET_SCHEMA,
  EVALUATION_SCHEMA,
  SOURCE_FIELDS,
  FORBIDDEN_FIELD_PREFIXES,
  COMPARATORS,
  GoalPacketError,
  canonicalJson,
  sha256Hex,
  computePacketSha256,
  validateGoalPacket,
  loadGoalPacket,
  measureField,
  evaluateGoal,
  goalIdentity
};
