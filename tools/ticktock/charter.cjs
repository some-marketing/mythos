#!/usr/bin/env node
'use strict';

// tools/ticktock/charter.cjs -- RunCharter/1.0: create, validate, hash.
//
// Plan: ticktock-skill S0. Schema: ./charter-schema.json.
//
// The charter is the frame a run cannot move. Three operations, and the shape
// of each one follows from that single sentence:
//
//   CREATE    fills in the two derived fields (lane_binding_hash, then
//             charter_hash over everything including it) and refuses to emit a
//             document that does not validate. A charter is written once,
//             before cycle 1, and never rewritten.
//   VALIDATE  is five fail-closed stages, in order, each cheap enough to run at
//             every phase boundary: schema shape, roster-hash recomputation,
//             charter-hash recomputation, roster-coverage, and stopping-rule
//             coherence. The order matters -- a shape-invalid document has no
//             fields worth hashing, so shape goes first.
//   HASH      is the identity function of the run. Every journal record and
//             every generation manifest carries charter_hash, and it is the
//             first term of all five idempotency keys, which is what makes "the
//             same phase under a different charter" a different effect by
//             construction rather than by convention.
//
// The roster hash deserves its own note, because the plan's own risk register
// flags it: a hash over lane NAMES alone would let a model substitution inside
// a "covered" family pass unnoticed, which is precisely the failure it exists
// to catch. So LANE_BINDING_PROJECTION_FIELDS below covers family, model_pin
// and assignment_order, and validateCharter refuses any charter whose
// lane_binding_hash_covers omits one of them -- the coverage claim is checked,
// not trusted.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { canonicalize, sha256Hex, hashObject } = require('./canonical.cjs');
const CHARTER_SCHEMA = require('./charter-schema.json');
const CHARTER_TEMPLATE = require('./charter-template-run.json');

// draft-07, allErrors, strict -- the same ajv configuration
// tools/ant-hive-world/checkpoint.js uses for CheckpointManifest, pointed at
// this schema. Established repo pattern; no new validation dialect introduced.
const ajv = new Ajv({ allErrors: true, strict: true });
const validateShape = ajv.compile(CHARTER_SCHEMA);

const SCHEMA = 'RunCharter/1.0';

// The roster projection. Named as a constant, and cross-checked against the
// charter's own lane_binding_hash_covers array at validate time, so the
// document's claim about what its hash covers can never drift from what this
// code actually hashes.
const LANE_BINDING_PROJECTION_FIELDS = Object.freeze([
  'lane_id', 'family', 'model_pin', 'assignment_order', 'role', 'availability.reachable'
]);
const LANE_BINDING_REQUIRED_FIELDS = Object.freeze(['family', 'model_pin', 'assignment_order']);
const LANE_BINDING_ALGORITHM = 'sha256(canonical-json(roster-projection))';

const NINE_PHASES = Object.freeze([
  'tt.orient', 'tt.tick', 'tt.observe', 'tt.text', 'tt.research', 'tt.tock',
  'tt.improve', 'tt.ship', 'tt.schedule'
]);
const PURE_PHASES = Object.freeze(['tt.orient', 'tt.observe', 'tt.research', 'tt.tock']);
const EFFECTFUL_PHASES = Object.freeze(['tt.tick', 'tt.text', 'tt.improve', 'tt.ship', 'tt.schedule']);

const DEFAULT_NEVER_AUTHORITY = Object.freeze([
  'edit canonical safety or gate policy',
  'edit evaluator or metric definitions',
  'accept its own review as a distinct-mind trial',
  'delete evidence, journal records, or checkpoints',
  'fall back silently to fresh state',
  'export credentials or private mind state',
  'merge outside the locked-roster contract',
  'edit the charter, the reviewer roster, or the benchmark fingerprint reference'
]);

// ---------------------------------------------------------------------------
// Roster projection + hash
// ---------------------------------------------------------------------------

function laneProjection(lane) {
  return {
    lane_id: lane.lane_id,
    family: lane.family,
    model_pin: lane.model_pin,
    assignment_order: lane.assignment_order,
    role: lane.role,
    'availability.reachable': Boolean(lane.availability && lane.availability.reachable)
  };
}

// Lanes are projected in ASSIGNMENT ORDER, not in array order: the array could
// be reordered without changing meaning, but assignment order IS meaning (it is
// what "pre-output assignment" pins down), so the hash sorts by it explicitly.
function computeLaneBindingHash(roster) {
  const lanes = (roster.lanes || []).slice().sort((a, b) => {
    if (a.assignment_order !== b.assignment_order) return a.assignment_order - b.assignment_order;
    return String(a.lane_id).localeCompare(String(b.lane_id));
  });
  return sha256Hex(canonicalize({
    algorithm: LANE_BINDING_ALGORITHM,
    assignment_mode: roster.assignment_mode,
    lanes: lanes.map(laneProjection)
  }));
}

function computeCharterHash(charter) {
  return hashObject(charter, ['charter_hash']);
}

// ---------------------------------------------------------------------------
// Validation -- five fail-closed stages, in order
// ---------------------------------------------------------------------------

function validateCharter(charter) {
  const errors = [];
  const push = (stage, message) => errors.push({ stage, message });

  // Stage 1: schema shape. Nothing downstream is meaningful without it, so a
  // shape failure returns immediately rather than producing a cascade of
  // derived-field errors about fields that do not exist.
  if (!validateShape(charter)) {
    for (const e of validateShape.errors || []) {
      push('SCHEMA_SHAPE', `${e.instancePath || '(root)'} ${e.message}`);
    }
    return { valid: false, errors, stage_reached: 'SCHEMA_SHAPE' };
  }

  // Stage 2: roster binding hash. Recomputed, never trusted.
  const roster = charter.reviewer_roster;
  if (roster.lane_binding_hash_algorithm !== LANE_BINDING_ALGORITHM) {
    push('ROSTER_HASH', `lane_binding_hash_algorithm is "${roster.lane_binding_hash_algorithm}", expected "${LANE_BINDING_ALGORITHM}"`);
  }
  for (const required of LANE_BINDING_REQUIRED_FIELDS) {
    if (!roster.lane_binding_hash_covers.includes(required)) {
      push('ROSTER_HASH', `lane_binding_hash_covers omits "${required}" -- a roster hash that does not cover it cannot detect a substitution within a covered family`);
    }
  }
  for (const declared of roster.lane_binding_hash_covers) {
    if (!LANE_BINDING_PROJECTION_FIELDS.includes(declared)) {
      push('ROSTER_HASH', `lane_binding_hash_covers claims "${declared}", which this implementation does not hash -- the coverage claim would be false`);
    }
  }
  const recomputedRoster = computeLaneBindingHash(roster);
  if (recomputedRoster !== roster.lane_binding_hash) {
    push('ROSTER_HASH', `lane_binding_hash mismatch: stored ${roster.lane_binding_hash}, recomputed ${recomputedRoster} -- the roster was edited after the charter was committed`);
  }

  // Stage 3: charter hash.
  const recomputedCharter = computeCharterHash(charter);
  if (recomputedCharter !== charter.charter_hash) {
    push('CHARTER_HASH', `charter_hash mismatch: stored ${charter.charter_hash}, recomputed ${recomputedCharter} -- the charter was edited after commit`);
  }

  // Stage 4: roster coverage. Structural facts the schema cannot express.
  const orders = roster.lanes.map((l) => l.assignment_order);
  if (new Set(orders).size !== orders.length) {
    push('ROSTER_COVERAGE', 'duplicate assignment_order values -- pre-output assignment is not well defined');
  }
  const laneIds = roster.lanes.map((l) => l.lane_id);
  if (new Set(laneIds).size !== laneIds.length) {
    push('ROSTER_COVERAGE', 'duplicate lane_id values');
  }
  const families = new Set(roster.lanes.map((l) => l.family));
  if (families.size < 2) {
    push('ROSTER_COVERAGE', `roster spans ${families.size} distinct family/families -- same-family lanes are parallel contexts, not distinct minds, so a single-family roster cannot satisfy distinct-mind review`);
  }
  for (const mandatory of ['timeout', 'substitution', 'pin_mismatch']) {
    if (!roster.merge_contract.not_clean_conditions.includes(mandatory)) {
      push('ROSTER_COVERAGE', `merge_contract.not_clean_conditions omits "${mandatory}" -- a zero-findings verdict from a lane that ${mandatory === 'pin_mismatch' ? 'did not resolve to its pin' : 'was ' + mandatory + 'd'} is a validation failure, not a pass`);
    }
  }

  // Stage 5: stopping-rule coherence.
  const sr = charter.stopping_rules;
  if (sr.until_kind === 'deterministic_milestone' && !sr.until_milestone) {
    push('STOPPING_RULES', 'until_kind is deterministic_milestone but until_milestone is null');
  }
  if (sr.until_kind !== 'deterministic_milestone' && sr.until_milestone) {
    push('STOPPING_RULES', `until_milestone is set but until_kind is "${sr.until_kind}"`);
  }
  const rb = charter.benchmark.rebaseline_detector;
  if (rb.enabled && rb.n_threshold > rb.m_window) {
    push('STOPPING_RULES', `rebaseline_detector n_threshold (${rb.n_threshold}) exceeds m_window (${rb.m_window}) -- the detector could never fire`);
  }

  return {
    valid: errors.length === 0,
    errors,
    stage_reached: errors.length === 0 ? 'ALL_STAGES_PASSED' : errors[errors.length - 1].stage
  };
}

// A cheaper, single-purpose check for the phase-boundary hot path: has anything
// about the frame moved since it was committed? Returns the named halt_state a
// caller should write, or null.
//
// ORDER MATTERS, and not for performance. The roster lives inside the charter,
// so ANY roster edit also breaks charter_hash -- checking charter_hash first
// would report every model-pin substitution as a generic
// CHARTER-IMMUTABILITY-VIOLATION and throw away the specific diagnosis the
// roster hash exists to produce. The narrower check runs first so the halt
// names the actual failure: a substituted reviewer is a ROSTER-HASH-MISMATCH,
// which routes to the merge contract, not to a charter re-ratification.
function checkImmutability(charter) {
  const roster = charter.reviewer_roster;
  if (roster && computeLaneBindingHash(roster) !== roster.lane_binding_hash) {
    return { ok: false, halt_state: 'ROSTER-HASH-MISMATCH', detail: 'lane_binding_hash does not match the roster content (family, model pin, or assignment order was edited after commit)' };
  }
  if (computeCharterHash(charter) !== charter.charter_hash) {
    return { ok: false, halt_state: 'CHARTER-IMMUTABILITY-VIOLATION', detail: 'charter_hash does not match the charter content' };
  }
  return { ok: true, halt_state: null, detail: null };
}

// ---------------------------------------------------------------------------
// The charter template (T1, tt-charter-template-and-spend-ledger)
// ---------------------------------------------------------------------------
//
// MECHANICALLY BOUND, not advisory: createCharter() below loads
// charter-template-run.json, stamps its identity into every charter it
// emits, and REFUSES a spec that drops a template-mandated write surface or
// undersizes a template floor. This is what makes "a coordinator copies last
// run's charter" fail at creation unless the copy still satisfies the
// template -- exactly the propagation path that carried gen-1's missing
// tools/ant-hive-world/unreal-export/** surface into gen-2 unnoticed.
//
// template_sha256 is computed over the template's canonical projection with
// its 'derivation' field stripped first: derivation is documentation (the
// measured tuple and the counting rule that produced the floors), not part
// of the binding contract, so editing that prose does not change the
// template's identity hash. Only mandated_write_surfaces,
// min_max_cumulative_diff, and min_max_external_actions are load-bearing.
function computeTemplateHash(template) {
  const { derivation, ...forHash } = template;
  return sha256Hex(canonicalize(forHash));
}

const TEMPLATE_HASH = computeTemplateHash(CHARTER_TEMPLATE);

// ---------------------------------------------------------------------------
// Template override (round-2 design decision, coordinator, tt-charter-
// template-and-spend-ledger). STATED HONESTLY, because a silent override path
// would be exactly the kind of "advisory dressed as binding" this plan exists
// to close everywhere else:
//
//   MODULE-LEVEL ONLY. createCharter(spec, opts) accepts an OPTIONAL
//   opts.templatePath naming a different, on-disk TickTockCharterTemplate/1.0
//   document to bind against instead of the canonical charter-template-run.json.
//   It exists for exactly one reason: the canonical template's floors
//   ({36440 lines, 77 files, 9 external actions}) make it IMPOSSIBLE for a
//   test fixture to build a small-ceiling charter through createCharter()
//   itself, which blocks testing over-ceiling behavior through the real
//   readCharter()-validated pipeline (as opposed to ceilings.cjs's own math,
//   which never revalidates a charter and so was never blocked by this).
//   tools/ticktock/__fixtures__/charter-template-test-minimal.json is that
//   alternate template: permissive surfaces, floors of {1,1}/1 -- a real
//   template, hashed and bound exactly the same way, just deliberately
//   undemanding.
//
//   TEST-ONLY BY CONVENTION, NOT BY MECHANISM. Nothing in this module
//   refuses opts.templatePath from production code; the boundary is that NO
//   production call site passes it. cycle-driver.cjs's `create-charter`
//   subcommand -- the ONLY call path a live /tt cycle can reach, per this
//   file's own header comment -- calls createCharter(spec) with no second
//   argument, so it is UNCONDITIONALLY bound to the canonical template. A
//   dedicated test (test-ceilings.cjs, "the create-charter CLI has no
//   template-override argv path") asserts the driver's `create-charter`
//   command signature takes exactly one path argument reaching createCharter,
//   so an override could only reach production by someone editing
//   cycle-driver.cjs itself -- a change that shows up in a diff, not a flag
//   silently threaded through.
function loadTemplate(templatePath) {
  const resolved = path.resolve(templatePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

// Checks a spec's allowed_write_surfaces / ceilings against the template.
// Returns { ok, code, message } -- never throws, so createCharter can decide
// how to surface the refusal.
function checkAgainstTemplate(spec, template) {
  const surfaces = new Set(spec.allowed_write_surfaces || []);
  for (const mandated of template.mandated_write_surfaces) {
    if (!surfaces.has(mandated)) {
      return {
        ok: false,
        code: 'TEMPLATE-SURFACE-DROPPED',
        message: `createCharter: refused -- allowed_write_surfaces drops template-mandated surface "${mandated}" `
          + `(template ${template.template_id}). A run charter may add surfaces beyond the template but may never drop one.`
      };
    }
  }
  const diff = spec.max_cumulative_diff || {};
  const floor = template.min_max_cumulative_diff;
  if (typeof diff.lines_changed !== 'number' || diff.lines_changed < floor.lines_changed) {
    return {
      ok: false,
      code: 'TEMPLATE-CEILING-UNDERSIZED',
      message: `createCharter: refused -- max_cumulative_diff.lines_changed (${diff.lines_changed}) is below the template floor (${floor.lines_changed}, template ${template.template_id}).`
    };
  }
  if (typeof diff.files_changed !== 'number' || diff.files_changed < floor.files_changed) {
    return {
      ok: false,
      code: 'TEMPLATE-CEILING-UNDERSIZED',
      message: `createCharter: refused -- max_cumulative_diff.files_changed (${diff.files_changed}) is below the template floor (${floor.files_changed}, template ${template.template_id}).`
    };
  }
  if (typeof spec.max_external_actions !== 'number' || spec.max_external_actions < template.min_max_external_actions) {
    return {
      ok: false,
      code: 'TEMPLATE-CEILING-UNDERSIZED',
      message: `createCharter: refused -- max_external_actions (${spec.max_external_actions}) is below the template floor (${template.min_max_external_actions}, template ${template.template_id}).`
    };
  }
  return { ok: true, code: null, message: null };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

// Fills the two derived hashes and refuses to return an invalid charter. The
// order is forced: lane_binding_hash must exist before charter_hash, because
// charter_hash covers it. Template binding runs FIRST -- a spec that fails
// the template never reaches hash computation at all.
//
// opts.templatePath: see the "Template override" section above. Defaults to
// the canonical CHARTER_TEMPLATE/TEMPLATE_HASH when omitted -- which is every
// production call, since cycle-driver.cjs's create-charter command never
// passes it.
function createCharter(spec, opts = {}) {
  const template = opts.templatePath ? loadTemplate(opts.templatePath) : CHARTER_TEMPLATE;
  const templateHash = opts.templatePath ? computeTemplateHash(template) : TEMPLATE_HASH;

  const templateCheck = checkAgainstTemplate(spec, template);
  if (!templateCheck.ok) {
    const err = new Error(templateCheck.message);
    err.code = templateCheck.code;
    err.template_id = template.template_id;
    throw err;
  }

  const charter = {
    schema: SCHEMA,
    charter_id: spec.charter_id,
    created_at: spec.created_at || new Date().toISOString(),
    target: spec.target,
    cycle_ceiling: spec.cycle_ceiling,
    evaluator_versions: spec.evaluator_versions,
    allowed_write_surfaces: spec.allowed_write_surfaces,
    max_cumulative_diff: spec.max_cumulative_diff,
    max_external_actions: spec.max_external_actions,
    resource_ceilings: spec.resource_ceilings,
    reviewer_roster: {
      locked_at: spec.reviewer_roster.locked_at || new Date().toISOString(),
      assignment_mode: 'pre-output',
      lanes: spec.reviewer_roster.lanes,
      lane_binding_hash: 'placeholder',
      lane_binding_hash_algorithm: LANE_BINDING_ALGORITHM,
      lane_binding_hash_covers: spec.reviewer_roster.lane_binding_hash_covers
        || LANE_BINDING_PROJECTION_FIELDS.slice(),
      merge_contract: spec.reviewer_roster.merge_contract || {
        zero_unresolved_findings_required: true,
        not_clean_conditions: ['timeout', 'substitution', 'pin_mismatch', 'unavailable', 'findings', 'roster_hash_mismatch']
      }
    },
    stopping_rules: spec.stopping_rules,
    benchmark: spec.benchmark,
    never_authority: spec.never_authority || DEFAULT_NEVER_AUTHORITY.slice(),
    template_id: template.template_id,
    template_sha256: templateHash,
    charter_hash: 'placeholder'
  };

  charter.reviewer_roster.lane_binding_hash = computeLaneBindingHash(charter.reviewer_roster);
  charter.charter_hash = computeCharterHash(charter);

  const result = validateCharter(charter);
  if (!result.valid) {
    const err = new Error('createCharter: refused to emit an invalid charter');
    err.validation = result;
    throw err;
  }
  return charter;
}

function readCharter(filePath) {
  const charter = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  const result = validateCharter(charter);
  if (!result.valid) {
    const err = new Error(`readCharter: ${filePath} failed validation at ${result.stage_reached}`);
    err.validation = result;
    throw err;
  }
  return charter;
}

// ---------------------------------------------------------------------------
// Idempotency keys -- the decision record's five formulas, verbatim
// ---------------------------------------------------------------------------
//
// Each key is sha256 over the STRING CONCATENATION of four terms, in this exact
// order: charter_hash, cycle_index, the phase's literal tag, and one
// phase-specific discriminator. The concatenation is the decision record's own
// specification; it is reproduced here rather than reinterpreted, because a key
// that is computed differently from the way the decision record describes is a
// key that silently stops matching across implementations.

const IDEMPOTENCY_TERMS = Object.freeze({
  'tt.tick': { tag: 'tick', term: 'resume_from_generation' },
  'tt.text': { tag: 'text', term: 'observe_artifact_hash' },
  'tt.improve': { tag: 'improve', term: 'plan_ids_sorted' },
  'tt.ship': { tag: 'ship', term: 'tree_hash_before' },
  'tt.schedule': { tag: 'schedule', term: 'next_trigger_spec' }
});

function effectClass(phaseId) {
  if (PURE_PHASES.includes(phaseId)) return 'PURE';
  if (EFFECTFUL_PHASES.includes(phaseId)) return 'EFFECTFUL';
  throw new Error(`effectClass: unknown phase_id "${phaseId}"`);
}

function idempotencyKey(phaseId, charterHash, cycleIndex, discriminator) {
  const spec = IDEMPOTENCY_TERMS[phaseId];
  if (!spec) {
    throw new Error(`idempotencyKey: ${phaseId} is PURE (or unknown) and has no key -- PURE phases are re-runnable unconditionally`);
  }
  if (discriminator === undefined || discriminator === null) {
    throw new Error(`idempotencyKey: ${phaseId} requires the "${spec.term}" discriminator; refusing to hash a missing term into a key that would then collide with every other missing-term call`);
  }
  // plan_ids_sorted arrives as a list; sort and join so that the same set of
  // plans in a different order is the same effect, which is what "sorted" in
  // the formula name means.
  const term = Array.isArray(discriminator)
    ? discriminator.slice().sort().join(',')
    : String(discriminator);
  return sha256Hex(`${charterHash}${cycleIndex}${spec.tag}${term}`);
}

module.exports = {
  SCHEMA,
  CHARTER_TEMPLATE,
  TEMPLATE_HASH,
  computeTemplateHash,
  checkAgainstTemplate,
  loadTemplate,
  NINE_PHASES,
  PURE_PHASES,
  EFFECTFUL_PHASES,
  LANE_BINDING_PROJECTION_FIELDS,
  LANE_BINDING_ALGORITHM,
  DEFAULT_NEVER_AUTHORITY,
  IDEMPOTENCY_TERMS,
  createCharter,
  readCharter,
  validateCharter,
  checkImmutability,
  computeCharterHash,
  computeLaneBindingHash,
  effectClass,
  idempotencyKey
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [cmd, target] = process.argv.slice(2);
  if (cmd === 'validate' && target) {
    const charter = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
    const result = validateCharter(charter);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.valid ? 0 : 1);
  } else if (cmd === 'hash' && target) {
    const charter = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
    process.stdout.write(JSON.stringify({
      charter_hash_stored: charter.charter_hash,
      charter_hash_recomputed: computeCharterHash(charter),
      lane_binding_hash_stored: charter.reviewer_roster && charter.reviewer_roster.lane_binding_hash,
      lane_binding_hash_recomputed: charter.reviewer_roster && computeLaneBindingHash(charter.reviewer_roster)
    }, null, 2) + '\n');
  } else {
    process.stderr.write('usage: charter.cjs validate|hash <charter.json>\n');
    process.exit(2);
  }
}
