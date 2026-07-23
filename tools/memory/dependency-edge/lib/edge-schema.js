#!/usr/bin/env node
'use strict';

/**
 * edge-schema.js — MemoryDependencyEdge/1.0 record builder + validator.
 *
 * Implements the schema from _dev/concepts/memory-dependency-edge.md, refined per
 * the memory-dependency-edge-writer-mvp plan (ADJ#2 three-value keystone_status,
 * ADJ#4 criteria_version + generated_at).
 *
 * MEMBRANE PRIME LAW (_dev/concepts/hwfwm-cosmos-memory-membrane.md):
 *   This module records OBJECTIVE STATE only — the edge exists, the file is cited,
 *   the commit happened. It is blind to narrative meaning. It encodes NO continuity,
 *   soul, awakening, ascension, personhood, or heaven semantics, and makes NO
 *   archival or deletion decision.
 *
 * ============================================================================
 * INFERENCE MECHANISM — criteria_version "v1" (FROZEN)
 * ============================================================================
 * A "memory_key" is the filename slug (basename without .md) of a memory note.
 * The LIVE MEMORY UNIVERSE = the union of:
 *   (a) files under Mythos-memories/memory/*.md (excluding MEMORY.md), and
 *   (b) slugs linked from Mythos-memories/memory/MEMORY.md (the recall index).
 * A memory_key referenced by an artifact but absent from this union is treated as
 * not-live (absence rule below).
 *
 * An edge is DETECTED by parsing the following sources and patterns. Each rule
 * reads declared fields or documented textual patterns — none are hardcoded to any
 * specific edge; they are general parsers.
 *
 *  RULE A — referenced_by_plan (task plans).
 *    For each _dev/reports/analysis/task-plans/*__plan.json, read the JSON arrays
 *    grounded_in[] and composes_with[]. For each string entry, extract any memory_key
 *    it names, matched as one of: "Mythos-memories/memory/<slug>", "memory/<slug>",
 *    "memory <slug>", or a bare "<slug>" token that is in the live universe.
 *    Emit: source=memory_key, target={kind:plan_id, id:plan.task_id},
 *    relationship=referenced_by_plan, witness_state=witnessed (declared field),
 *    keystone_status=detected.
 *
 *  RULE B — referenced_by_plan (concept docs).
 *    For each _dev/concepts/*.md, read the YAML frontmatter grounded_in: list AND
 *    scan the body for explicit memory_key citations (path or [[slug]] or bare slug
 *    of a live memory). Target id = the concept's frontmatter plan_id if present,
 *    else the concept slug. relationship=referenced_by_plan.
 *      - If the grounded_in/body reference is an unambiguous memory-surface citation
 *        (path under Mythos-memories/memory/, [[slug]] wikilink, or inline slug of a
 *        live memory) -> witness_state=witnessed, keystone_status=detected.
 *      - AMBIGUITY RULE (non-obvious): if the ONLY match for a live memory slug comes
 *        from a grounded_in path that points at a same-named _dev/concepts/<slug>.md
 *        (a concept doc, NOT the memory path), the reference is ambiguous about
 *        whether the memory surface (vs the concept doc of the same name) is the
 *        keystone -> witness_state=inferred, keystone_status=classification_uncertain.
 *
 *  RULE C — anchors_lesson (run debriefs).
 *    For each _dev/reports/analysis/run-debrief__*.md, scan the body for
 *    "Mythos-memories/memory/<slug>" or "memory/<slug>" references.
 *    Target id = the debrief basename (without .md). relationship=anchors_lesson.
 *      - If <slug> is in the live universe -> witnessed, detected.
 *      - ABSENCE RULE (non-obvious): if <slug> is NOT in the live universe, the
 *        dependency is plausible but the memory is not currently live/load-bearing
 *        -> witness_state=inferred, keystone_status=classification_uncertain.
 *
 *  RULE D — grounds_span (convene-run manifests).
 *    For each _dev/reports/analysis/convene-runs/<run>/manifest.json, read the
 *    context_files[] array; for each entry naming a memory_key, emit
 *    source=memory_key, target={kind:span_id, id:<run dir basename>},
 *    relationship=grounds_span, witness_state=witnessed, keystone_status=detected.
 *
 *  RULE E — gates_archival_of (archival commit anchors) [non-obvious].
 *    Scan git history for commits whose subject matches /^memory[:(].*archiv/i.
 *    For each such commit, for each changed file under Mythos-memories/memory/ other
 *    than MEMORY.md, emit source=that memory_key, target={kind:commit_anchor,
 *    id:<short sha>}, relationship=gates_archival_of, witness_state=witnessed
 *    (commit is git-verifiable), keystone_status=detected. The memory_key is resolved
 *    from the changed file path, NOT from the commit subject (which need not contain
 *    the slug) — this catches a dependency no keyword scan of any single file reveals.
 *
 *  ORPHAN PASS — not_detected.
 *    After the reference rules, every memory_key in the live universe that received
 *    NO reference-type edge (referenced_by_plan | anchors_lesson | grounds_span) gets
 *    one edge: target={kind:plan_id, id:null}, relationship=referenced_by_plan,
 *    witness_state=witnessed (absence verified across the scanned surfaces),
 *    keystone_status=not_detected. "not_detected" means "no dependency found by the
 *    v1 criteria" — it is NOT archival clearance (that is why keystone_status is a
 *    three-value enum and never a bare boolean).
 * ============================================================================
 */

const crypto = require('crypto');

const SCHEMA = 'MemoryDependencyEdge/1.0';
const CRITERIA_VERSION = 'v1';
const WRITTEN_BY = 'memory-dependency-edge-writer-mvp';
const DIRECTION = 'memory_to_target';

const RELATIONSHIPS = Object.freeze([
  'grounds_span',
  'referenced_by_plan',
  'anchors_lesson',
  'gates_archival_of',
]);

const SOURCE_KINDS = Object.freeze(['memory_key', 'anchor_sha']);
const TARGET_KINDS = Object.freeze(['span_id', 'commit_anchor', 'plan_id', 'lesson_id']);

// THREE-VALUE keystone status (plan ADJ#2). A low-confidence "not_detected" must
// never be readable as archival clearance, so this is NOT a boolean.
const KEYSTONE_STATUSES = Object.freeze([
  'detected',
  'not_detected',
  'classification_uncertain',
]);

const WITNESS_STATES = Object.freeze([
  'witnessed',
  'inferred',
  'sentinel',
  'structurally_unwitnessable',
  'legacy_absent',
]);

/**
 * FORGOTTEN_SENTINEL — NON-OPERATIVE documented constant.
 *
 * Terminal-unavailability (FORGOTTEN / true-death) has no schema or trigger in
 * Mythos today. This constant exists ONLY so future reviews can name the state and
 * distinguish "archived-recoverable" from "terminal-unavailable". It is never
 * written onto an edge, it gates nothing, it triggers nothing, and no code path
 * acts on it. Defining a FORGOTTEN trigger is a separate operator-gated plan.
 */
const FORGOTTEN_SENTINEL = Object.freeze({
  marker: 'FORGOTTEN',
  operative: false,
  note: 'non-operative sentinel; records nothing, triggers nothing, gates nothing',
});

/** Stable, idempotent edge id: hash of source+target+relationship. */
function edgeId(source, target, relationship) {
  const targetId = target && target.id != null ? String(target.id) : 'null';
  const basis = [
    source.kind, source.id,
    target ? target.kind : 'null', targetId,
    relationship,
  ].join('|');
  return 'mde_' + crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

/**
 * Build a MemoryDependencyEdge/1.0 record. edge_id is derived (idempotent replace);
 * caller supplies the classification fields produced by the v1 inference mechanism.
 */
function buildEdge({
  source,
  target,
  relationship,
  keystone_status,
  keystone_rationale,
  witness_state,
  generated_at,
}) {
  return {
    schema: SCHEMA,
    edge_id: edgeId(source, target, relationship),
    source: { kind: source.kind, id: source.id },
    target: { kind: target.kind, id: target.id != null ? target.id : null },
    relationship,
    direction: DIRECTION,
    keystone_status,
    keystone_rationale: keystone_rationale || '',
    witness_state,
    criteria_version: CRITERIA_VERSION,
    generated_at: generated_at || new Date().toISOString(),
    written_by: WRITTEN_BY,
  };
}

/** Validate a record against MemoryDependencyEdge/1.0 + the refined enums. */
function validateEdge(edge) {
  const errors = [];
  if (!edge || typeof edge !== 'object') {
    return { valid: false, errors: ['edge is not an object'] };
  }
  if (edge.schema !== SCHEMA) errors.push(`schema must be "${SCHEMA}"`);
  if (typeof edge.edge_id !== 'string' || !edge.edge_id) errors.push('edge_id missing');
  if (!edge.source || !SOURCE_KINDS.includes(edge.source.kind)) errors.push('source.kind invalid');
  if (!edge.source || typeof edge.source.id !== 'string' || !edge.source.id) errors.push('source.id missing');
  if (!edge.target || !TARGET_KINDS.includes(edge.target.kind)) errors.push('target.kind invalid');
  if (!edge.target || !('id' in edge.target)) errors.push('target.id missing (null is allowed)');
  if (!RELATIONSHIPS.includes(edge.relationship)) errors.push('relationship invalid');
  if (edge.direction !== DIRECTION) errors.push(`direction must be "${DIRECTION}"`);
  if (!KEYSTONE_STATUSES.includes(edge.keystone_status)) errors.push('keystone_status not in three-value enum');
  if (typeof edge.keystone_rationale !== 'string') errors.push('keystone_rationale must be a string');
  if (!WITNESS_STATES.includes(edge.witness_state)) errors.push('witness_state invalid');
  if (edge.criteria_version !== CRITERIA_VERSION) errors.push(`criteria_version must be "${CRITERIA_VERSION}"`);
  if (typeof edge.generated_at !== 'string' || Number.isNaN(Date.parse(edge.generated_at))) {
    errors.push('generated_at must be an ISO-8601 timestamp');
  }
  if (typeof edge.written_by !== 'string' || !edge.written_by) errors.push('written_by missing');
  // The edge must never carry the non-operative sentinel as an operative value.
  if (edge.witness_state === 'sentinel' && edge.keystone_status === 'detected') {
    errors.push('sentinel witness_state must not be paired with a detected keystone claim');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  SCHEMA,
  CRITERIA_VERSION,
  WRITTEN_BY,
  DIRECTION,
  RELATIONSHIPS,
  SOURCE_KINDS,
  TARGET_KINDS,
  KEYSTONE_STATUSES,
  WITNESS_STATES,
  FORGOTTEN_SENTINEL,
  edgeId,
  buildEdge,
  validateEdge,
};
