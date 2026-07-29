'use strict';

/**
 * phase-question-loop.js — planning-phase binding of the Loop Convergence
 * Bounding Law v3 (STAGED:
 * _dev/concepts/self-improving-loop-protocol/staging/canonical/loop-convergence-bounding-law-v3.md).
 *
 * WHAT THIS IS. A Layer-1 REVERSIBLE tooling lib that lets a planning-phase
 * execution (e.g. /run-plan over a task-plan phase) mechanically run the v3
 * "until DRY" loop over that phase's OPEN QUESTIONS, using the 123|Perplexity|321|Fable
 * cycle. It REUSES the proven mechanical core — it never forks or re-implements
 * predicate logic:
 *   - open questions       -> objection-ledger.js       (non-defendant custody)
 *   - counted-cycle energy -> iteration-cap.js          (decrement per cycle)
 *   - DRY / termination     -> convergence.js.isDry()    (the real predicate)
 *   - per-cycle readiness   -> loop-grade-record.js      (read-only, out-of-band grade authorship)
 *
 * WHAT THIS IS NOT. It is authority-free bookkeeping. The leg sequencer computes
 * the NEXT dispatch recommendation from durable state and returns it; it NEVER
 * executes a dispatch. The coordinator executes. The sequencer holds zero
 * authority: it cannot close an objection, author a grade record, arm a hook,
 * or promote the law. Law promotion + hook arming remain operator-gated.
 *
 * CUSTODY (Universal Custody Quantifier). Every input to the DRY predicate is
 * "victory evidence" held under non-defendant custody. Concretely here:
 *   - Questions enter the objection ledger; they close ONLY via the objecting
 *     family or the operator (enforced in objection-ledger.js's writer).
 *   - Grade records (anchor, seeded-probe, countersign, position_delta) are NOT
 *     authored by this lib — they are written out-of-band by the grading flow and
 *     merely READ here through convergence.isDry(). The sequencer never authors
 *     the evidence it evaluates.
 *
 * State lives beside the rest of the loop-instance state:
 *   _dev/state/loop-classification-ledger/<instance>.qloop.json
 * keyed to the same <instance> as the objection ledger / iteration cap / cycles
 * file, so one planning-phase loop's state is colocated.
 */

const fs = require('fs');
const path = require('path');

const objectionLedger = require('./objection-ledger.js');
const itercap = require('./iteration-cap.js');
const convergence = require('./convergence.js');
const grade = require('../../planning/lib/loop-grade-record.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const STATE_DIR = path.join(PROJECT_ROOT, '_dev', 'state', 'loop-classification-ledger');

const QLOOP_VERSION = 1;
const DEFAULT_CAP = 3; // provenance: v3 forged over 3 apex cycles.

// ---------------------------------------------------------------------------
// The 123|Perplexity|321|Fable cycle (memory: leyline-review-flow —
// "123|Perplexity|321|Fable5-final; Perplexity first stop, Fable 5 final reviewer,
// distinct context"). ONE completed pass over all legs = ONE counted cycle.
//
// Minds 1/2/3 = Claude(synthesize) / Codex(repo-truth) / Gemini(breadth-read).
// External legs = Perplexity (open-web, preferred first stop) and Fable-5 (final
// adversarial, DISTINCT CONTEXT — a parallel Anthropic context, recorded as
// distinct-context, NOT distinct-family; the grade record's distinct-family
// requirement is a separate, out-of-band custody check).
// ---------------------------------------------------------------------------
const CYCLE_LEGS = Object.freeze([
  { seq: 1, phase: 'forward', mind: 'claude', role: 'synthesize', tool: 'agent-subagent', external: false, distinct_context: false },
  { seq: 2, phase: 'forward', mind: 'codex', role: 'repo-truth', tool: 'dispatch-bridge', external: false, distinct_context: false },
  { seq: 3, phase: 'forward', mind: 'gemini', role: 'breadth-read', tool: 'dispatch-bridge', external: false, distinct_context: false },
  { seq: 4, phase: 'external-first', mind: 'perplexity', role: 'open-web', tool: 'perplexity-api', external: true, distinct_context: false },
  { seq: 5, phase: 'reverse', mind: 'gemini', role: 'breadth-read', tool: 'dispatch-bridge', external: false, distinct_context: false },
  { seq: 6, phase: 'reverse', mind: 'codex', role: 'repo-truth', tool: 'dispatch-bridge', external: false, distinct_context: false },
  { seq: 7, phase: 'reverse', mind: 'claude', role: 'synthesize', tool: 'agent-subagent', external: false, distinct_context: false },
  { seq: 8, phase: 'external-final', mind: 'fable-5', role: 'adversarial-final', tool: 'agent-subagent-distinct-context', external: true, distinct_context: true },
]);
const LEGS_PER_CYCLE = CYCLE_LEGS.length;

// Recommended dispatch vehicle per tool (the coordinator executes these; the
// sequencer only names them). Kept cwd-independent — repo-relative paths.
const TOOL_VEHICLE = Object.freeze({
  'dispatch-bridge': 'tools/signals/dispatch-bridge.js',
  'perplexity-api': 'tools/ai-bridge/perplexity-api/query.js (via run-with-op.sh)',
  'agent-subagent': 'Agent tool (parallel Claude context)',
  'agent-subagent-distinct-context': 'Agent tool — Fable subagent (distinct context, not distinct family)',
});

// Non-defendant custody is enforced by a QUANTIFIED identity classifier, not an
// enumerated deny-list. The v3 Universal Custody Quantifier binds "every input to
// the DRY predicate — present or future" under non-defendant custody by
// quantification, not enumeration. Codex distinct review proved multiple smuggle
// classes against weaker forms: an alias-spaced actor ("claude coordinator"), a
// same-family relabel, a role carrying coordinator authority ("lead coordinator"),
// separator-broken tokens ("co-ordinator"), a Unicode confusable ("coordinаtor"
// with Cyrillic а), and a same-family relabel on a loop that never declared its
// defending family. This classifier closes all of them. Closure custody is
// separately (and authoritatively) enforced in objection-ledger.js — this gate
// governs INTAKE.
//
// The coordinator authority token, in any identity field, is "coordinator".

/**
 * True if a string carries any non-ASCII code point. Identity AUTHORITY fields
 * (actor/family/role) must be pure ASCII to be custody-comparable — a Unicode
 * confusable (e.g. Cyrillic 'а' in "coordinаtor") cannot be reliably matched, so
 * per codex's recommendation such fields are REFUSED wholesale rather than
 * confusable-normalized (kills the whole confusable class, simpler and safer).
 * @param {*} s
 * @returns {boolean}
 */
function _hasNonAscii(s) {
  return /[^\x00-\x7F]/.test(String(s == null ? '' : s));
}

/**
 * Strip an identity token to a separator-free authority form: lowercase, then
 * remove every non-alphanumeric ASCII character. This collapses "co-ordinator",
 * "co ordinator", "co_ordinator", and "co.ordinator" all to "coordinator", so the
 * authority-token test cannot be evaded by breaking the token with a separator.
 * @param {*} s
 * @returns {string}
 */
function _stripToken(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Validate a DECLARED defending_family (the loop's own custody anchor) with the
 * SAME identity invariants the claimant side must satisfy — custody comparability
 * is symmetric. A confusable anchor ("clаude" with a Cyrillic а) would fold to a
 * DIFFERENT stripped token than a real "claude" claimant, silently disarming
 * requirement (b) and admitting the same-family relabel from the OTHER direction.
 * So the anchor must be ASCII and must leave a non-empty comparable token.
 *
 * An unset value (undefined/null/'') is NOT invalid here — it is the deliberate
 * operator-gated-only posture, which the intake gate then treats as fail-closed
 * for LOOP questions.
 *
 * @param {*} df
 * @returns {{ ok: boolean, reason: (string|null) }}
 */
function checkDefendingFamily(df) {
  if (df === undefined || df === null || df === '') return { ok: true, reason: null };
  if (typeof df !== 'string') {
    return { ok: false, reason: 'defending_family must be a string when provided' };
  }
  if (_hasNonAscii(df)) {
    return {
      ok: false,
      reason: `defending_family "${df}" carries non-ASCII characters — refused; the declared defending family must be ASCII to be custody-comparable (a confusable anchor would let a look-alike claimant family slip)`,
    };
  }
  if (!_stripToken(df)) {
    return {
      ok: false,
      reason: `defending_family "${df}" has no comparable token after stripping separators — refused (an anchor with no token cannot match any claimant)`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Classify whether a raised_by roster holds DEFENDANT custody — i.e. is the
 * defending / coordinating side and therefore cannot be the custodian of an open
 * question ("victory evidence"). Quantified + fail-closed:
 *   - non-ASCII authority field (actor/family/role) -> REFUSED (confusable class);
 *   - actor or family absent -> REFUSED (non-defendant custody unprovable);
 *   (a) separator-stripped actor OR role contains "coordinator" -> defendant;
 *   - loop declares NO defending_family -> REFUSED (same-family custody cannot be
 *     evaluated; absence is terminal, never a reduced mode);
 *   (b) separator-stripped family equals the loop's declared defending family
 *       (read from state, never hardcoded) -> defendant.
 *
 * @param {object} raisedBy - { actor, harness, family, role? }
 * @param {object} state - the qloop instance state (carries defending_family)
 * @returns {{ defendant: boolean, reason: (string|null) }}
 */
function classifyQuestionCustody(raisedBy, state) {
  const who = _isPlainObject(raisedBy) ? raisedBy : {};

  // Reject non-ASCII authority fields wholesale (confusable class).
  for (const field of ['actor', 'family', 'role']) {
    if (_hasNonAscii(who[field])) {
      return {
        defendant: true,
        reason: `raised_by.${field} carries non-ASCII characters — refused; identity authority fields must be ASCII to be custody-comparable (Unicode-confusable class)`,
      };
    }
  }

  const actor = _stripToken(who.actor);
  const family = _stripToken(who.family);
  const role = _stripToken(who.role);

  // Fail-closed: non-defendant custody must be PROVABLE. Without actor + family we
  // cannot prove the raiser is a non-defendant, so we refuse rather than admit.
  if (!actor) {
    return { defendant: true, reason: 'raised_by.actor is empty/undefined — non-defendant custody is unprovable (fail-closed)' };
  }
  if (!family) {
    return { defendant: true, reason: 'raised_by.family is empty/undefined — non-defendant custody is unprovable (fail-closed)' };
  }

  // (a) coordinator authority token in actor or role, in ANY spelling/spacing.
  if (actor.includes('coordinator') || role.includes('coordinator')) {
    return { defendant: true, reason: `actor/role carries coordinator authority (actor="${who.actor}" role="${who.role || ''}")` };
  }

  // Fail-closed: a question-accepting loop MUST declare its defending family. An
  // undeclared defending family means a same-family relabel cannot be caught, so
  // absence is terminal (the law's "Never the coordinator / defending family"
  // admits no reduced mode). Operator-gated questions bypass this gate entirely.
  const defending = _stripToken(state && state.defending_family);
  if (!defending) {
    return {
      defendant: true,
      reason: 'the loop declares no defending_family — same-family custody cannot be evaluated, so intake is refused (fail-closed; declare defending_family at init)',
    };
  }

  // (b) family matches the loop's declared defending family.
  if (family === defending) {
    return { defendant: true, reason: `raised_by.family matches the loop's defending family ("${state.defending_family}")` };
  }

  return { defendant: false, reason: null };
}

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Sanitize a plan_id / phase_id fragment into an instance-id-safe token (no path
 * separators; the underlying libs reject those).
 * @param {string} s
 * @returns {string}
 */
function _san(s) {
  return String(s).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Derive the durable loop-instance id for a (plan_id, phase_id). Deterministic,
 * so any coordinator session rebuilds the same instance from durable inputs.
 * @param {string} planId
 * @param {string} phaseId
 * @returns {string}
 */
function deriveInstance(planId, phaseId) {
  const p = _san(planId);
  const ph = _san(phaseId);
  if (!p) throw new Error('phase-question-loop: plan_id is required (non-empty after sanitize)');
  if (!ph) throw new Error('phase-question-loop: phase_id is required (non-empty after sanitize)');
  return `pql__${p}__${ph}`;
}

function statePath(instance) {
  if (!instance || typeof instance !== 'string') {
    throw new Error('phase-question-loop: instance id (non-empty string) is required');
  }
  if (/[\\/]/.test(instance)) {
    throw new Error(`phase-question-loop: instance id must not contain path separators: ${instance}`);
  }
  return path.join(STATE_DIR, `${instance}.qloop.json`);
}

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

/**
 * Load the durable qloop state for an instance. Throws if uninitialized.
 * @param {string} instance
 * @returns {object}
 */
function load(instance) {
  const p = statePath(instance);
  if (!fs.existsSync(p)) {
    throw new Error(`phase-question-loop: no loop initialized for instance "${instance}" — call init() first`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`phase-question-loop: corrupt state file ${p}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.legs) || typeof parsed.cycle !== 'number') {
    throw new Error(`phase-question-loop: malformed state file ${p}`);
  }
  return parsed;
}

function _write(instance, state) {
  ensureDir();
  const p = statePath(instance);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
  return state;
}

function exists(instance) {
  return fs.existsSync(statePath(instance));
}

/**
 * Register a planning-phase loop instance scoped to (plan_id, phase_id). Creates
 * the qloop state AND first-time-inits the iteration cap (unconditional-decrement
 * energy governor). First-time only — re-init of an existing loop is refused (the
 * iteration cap already refuses silent re-init without an operator token).
 *
 * @param {{ plan_id:string, phase_id:string, cap?:number, defending_family?:string }} opts
 *   defending_family: the coordinating/defending family for this loop — recorded
 *   durably so the intake custody classifier can refuse a same-family relabel
 *   (custody requirement (b)) without hardcoding a family name.
 * @returns {{ instance:string, cap:number, state:object }}
 */
function init(opts) {
  if (!_isPlainObject(opts)) throw new Error('phase-question-loop.init: opts object is required');
  const instance = deriveInstance(opts.plan_id, opts.phase_id);
  if (exists(instance)) {
    throw new Error(
      `phase-question-loop.init: loop already initialized for instance "${instance}" ` +
        '(plan_id/phase_id). Loops are not silently re-initialized.'
    );
  }
  // Validate the declared defending family BEFORE any state/cap artifact is
  // created, so a confusable/empty anchor never establishes a loop at all.
  const dfCheck = checkDefendingFamily(opts.defending_family);
  if (!dfCheck.ok) {
    throw new Error(`phase-question-loop.init: ${dfCheck.reason}`);
  }

  const cap = Number.isInteger(opts.cap) && opts.cap > 0 ? opts.cap : DEFAULT_CAP;

  // First-time cap init (no operator token needed for first init).
  itercap.init(instance, cap);

  const state = {
    instance,
    version: QLOOP_VERSION,
    scope: { plan_id: String(opts.plan_id), phase_id: String(opts.phase_id) },
    created_at: new Date().toISOString(),
    // The DEFENDING family for this loop — the family that authors the position
    // under test (the coordinator/defending side). Recorded here (ASCII-validated
    // above) so the intake custody classifier reads it from durable state and never
    // hardcodes a family. When unset this is an INTENTIONAL operator-gated-only loop:
    // LOOP-question intake is refused fail-closed (see classifyQuestionCustody), and
    // only operator-gated questions route out — NOT a reduced-enforcement mode.
    defending_family: opts.defending_family ? String(opts.defending_family) : null,
    cycle: 1,
    completed_cycles: 0,
    legs: [],
    operator_gated_questions: [],
  };
  _write(instance, state);
  return { instance, cap, state };
}

/**
 * The stable dispatch scope name for a leg (stable => greppable, collision-free).
 * @param {object} state
 * @param {object} leg
 * @param {number} cycle
 * @returns {string}
 */
function scopeName(state, leg, cycle) {
  const p = _san(state.scope.plan_id);
  const ph = _san(state.scope.phase_id);
  return `pql__${p}__${ph}__c${cycle}__l${leg.seq}-${leg.mind}`;
}

/**
 * Count legs already recorded in the CURRENT cycle.
 * @param {object} state
 * @returns {number}
 */
function _legsInCurrentCycle(state) {
  return state.legs.filter((l) => l && l.cycle === state.cycle).length;
}

/**
 * Register an OPEN QUESTION for the phase.
 *
 * TWO PATHS:
 *  - operator_gated === true  -> the question is TRULY operator-gated: it routes
 *    STRAIGHT to the operator and does NOT enter the loop. It consumes no cycles
 *    and never blocks the DRY predicate for the looped questions. (Per the
 *    operator directive: "...unless they're truly operator gated".)
 *  - otherwise                -> the question enters the EXISTING objection ledger
 *    as a material objection under NON-DEFENDANT custody. It blocks DRY until the
 *    OBJECTING FAMILY or the operator closes it (custody enforced in the ledger
 *    writer). The coordinator cannot close it.
 *
 * @param {string} instance
 * @param {{ id:string, summary?:string, raised_by:{actor,harness,family,role?}, operator_gated?:boolean }} question
 * @returns {{ routed:'loop'|'operator', objection?:object, operator_gated_question?:object }}
 */
function addQuestion(instance, question) {
  if (!_isPlainObject(question)) throw new Error('phase-question-loop.addQuestion: question object is required');
  if (typeof question.id !== 'string' || question.id.length === 0) {
    throw new Error('phase-question-loop.addQuestion: question.id (non-empty string) is required');
  }
  if (!_isPlainObject(question.raised_by)) {
    throw new Error('phase-question-loop.addQuestion: question.raised_by {actor,harness,family} is required');
  }
  const state = load(instance);

  if (question.operator_gated === true) {
    // Truly-operator-gated: route out of the loop immediately.
    if (state.operator_gated_questions.some((q) => q.id === question.id)) {
      throw new Error(`phase-question-loop.addQuestion: operator-gated question id "${question.id}" already registered`);
    }
    const entry = {
      id: question.id,
      summary: question.summary || '',
      raised_by: {
        actor: question.raised_by.actor,
        harness: question.raised_by.harness,
        family: question.raised_by.family,
        role: question.raised_by.role || null,
      },
      routed_at: new Date().toISOString(),
      status: 'routed_to_operator',
    };
    state.operator_gated_questions.push(entry);
    _write(instance, state);
    return { routed: 'operator', operator_gated_question: entry };
  }

  // Loop path: enter the objection ledger under non-defendant custody. The
  // quantified classifier refuses INTAKE (before any ledger entry exists) if the
  // raiser holds defendant custody in any spelling, or if custody is unprovable.
  const custody = classifyQuestionCustody(question.raised_by, state);
  if (custody.defendant) {
    throw new Error(
      `phase-question-loop.addQuestion: refused — an open question must be held under NON-DEFENDANT custody. ` +
        `${custody.reason}. Route it as operator_gated, or attribute it to the objecting (non-defending) family.`
    );
  }
  const objection = objectionLedger.raiseObjection(instance, {
    id: question.id,
    raised_by: {
      actor: question.raised_by.actor,
      harness: question.raised_by.harness,
      family: question.raised_by.family,
    },
    summary: question.summary || '',
  });
  return { routed: 'loop', objection };
}

/**
 * Close a looped question. Pass-through to the objection-ledger writer, which
 * enforces closure custody (objecting family or operator ONLY — the coordinator
 * cannot close). Kept as a thin pass-through so the sequencer never becomes a
 * closure authority.
 * @param {string} instance
 * @param {string} id
 * @param {{ closed_by:{actor,harness,family,role?}, close_signature:string }} closer
 * @returns {object}
 */
function closeQuestion(instance, id, closer) {
  return objectionLedger.closeObjection(instance, id, closer);
}

/**
 * Expire a looped question to UNRESOLVED_OPERATOR_DECISION (loop-terminal; never
 * ledger-clearing). Pass-through to the objection-ledger writer.
 * @param {string} instance
 * @param {string} id
 * @param {{ reason?:string }} [opts]
 * @returns {object}
 */
function expireQuestion(instance, id, opts) {
  return objectionLedger.expireObjection(instance, id, opts);
}

/**
 * Resolve an operator-gated question (operator custody ONLY). These live outside
 * the loop; only the operator may mark one resolved.
 * @param {string} instance
 * @param {string} id
 * @param {{ resolved_by:{actor,harness,family,role?} }} closer
 * @returns {object}
 */
function resolveOperatorGatedQuestion(instance, id, closer) {
  if (!_isPlainObject(closer) || !_isPlainObject(closer.resolved_by)) {
    throw new Error('phase-question-loop.resolveOperatorGatedQuestion: closer.resolved_by is required');
  }
  const role = String(closer.resolved_by.role || '').toLowerCase();
  const fam = String(closer.resolved_by.family || '').toLowerCase();
  if (role !== 'operator' && fam !== 'operator') {
    throw new Error('phase-question-loop.resolveOperatorGatedQuestion: operator-gated questions may be resolved ONLY by the operator');
  }
  const state = load(instance);
  const q = state.operator_gated_questions.find((x) => x.id === id);
  if (!q) throw new Error(`phase-question-loop.resolveOperatorGatedQuestion: no operator-gated question "${id}"`);
  q.status = 'resolved';
  q.resolved_at = new Date().toISOString();
  q.resolved_by = {
    actor: closer.resolved_by.actor,
    harness: closer.resolved_by.harness,
    family: closer.resolved_by.family,
    role: closer.resolved_by.role || 'operator',
  };
  _write(instance, state);
  return q;
}

/**
 * Compute the NEXT leg recommendation for the loop WITHOUT executing anything.
 * Authority-free: the coordinator executes the recommended dispatch. When the
 * loop is at a cycle boundary (about to start a new cycle) the terminal governors
 * (convergence / cap / ledger) are consulted first — if the loop is terminal the
 * recommendation is to STOP, never to spend another cycle.
 *
 * @param {string} instance
 * @returns {object} a recommendation ({done:false, leg fields, scope, ...}) or a
 *   terminal stop ({done:true, terminal_state, evaluation}).
 */
function nextLeg(instance) {
  const state = load(instance);
  const done = _legsInCurrentCycle(state);
  const nextSeq = done + 1;

  // At the start of a cycle, the terminal governors gate whether a NEW cycle is
  // even permitted. This is where cap-exhaustion / convergence short-circuit.
  if (nextSeq === 1) {
    const evalr = evaluate(instance);
    if (evalr.terminal) {
      return {
        done: true,
        instance,
        cycle: state.cycle,
        terminal_state: evalr.state,
        evaluation: evalr,
        authority: 'none — sequencer recommends only; the coordinator routes terminal handling',
      };
    }
  }

  const leg = CYCLE_LEGS[nextSeq - 1];
  const scope = scopeName(state, leg, state.cycle);
  return {
    done: false,
    instance,
    cycle: state.cycle,
    seq: leg.seq,
    legs_per_cycle: LEGS_PER_CYCLE,
    mind: leg.mind,
    role: leg.role,
    phase: leg.phase,
    external: leg.external,
    distinct_context: leg.distinct_context,
    tool: leg.tool,
    vehicle: TOOL_VEHICLE[leg.tool] || null,
    scope,
    recommendation:
      `dispatch leg ${leg.seq}/${LEGS_PER_CYCLE} of cycle ${state.cycle}: mind="${leg.mind}" ` +
      `role="${leg.role}" via ${leg.tool} (${TOOL_VEHICLE[leg.tool] || '?'}), scope="${scope}"` +
      (leg.distinct_context ? ' [DISTINCT CONTEXT — record as distinct-context, not distinct-family]' : ''),
    authority: 'none — this is a recommendation; the coordinator executes the dispatch',
  };
}

/**
 * Record that a leg was executed (the coordinator calls this AFTER dispatching).
 * Mechanical discipline: legs must be recorded IN ORDER; a mind mismatch against
 * the expected next leg is rejected. Completing the final (Fable) leg of a cycle
 * DECREMENTS THE ITERATION CAP UNCONDITIONALLY (one full cycle = one counted
 * cycle, per the law backstop) and advances the cycle counter.
 *
 * @param {string} instance
 * @param {{ mind?:string, note?:string }} [leg]
 * @returns {{ recorded:object, cycle:number, cycle_complete:boolean, cap_remaining:number, cap_exhausted:boolean }}
 */
function recordLeg(instance, leg) {
  leg = leg || {};
  const state = load(instance);
  const done = _legsInCurrentCycle(state);
  const expectedSeq = done + 1;
  if (expectedSeq > LEGS_PER_CYCLE) {
    // Should never happen: completing leg 8 advances the cycle. Defensive.
    throw new Error(`phase-question-loop.recordLeg: current cycle ${state.cycle} already has ${done} legs`);
  }
  const expected = CYCLE_LEGS[expectedSeq - 1];
  if (leg.mind !== undefined && String(leg.mind) !== expected.mind) {
    throw new Error(
      `phase-question-loop.recordLeg: out-of-sequence leg — expected mind "${expected.mind}" ` +
        `(cycle ${state.cycle}, leg ${expectedSeq}), got "${leg.mind}"`
    );
  }

  const recorded = {
    cycle: state.cycle,
    seq: expected.seq,
    mind: expected.mind,
    role: expected.role,
    phase: expected.phase,
    tool: expected.tool,
    external: expected.external,
    distinct_context: expected.distinct_context,
    scope: scopeName(state, expected, state.cycle),
    note: leg.note || '',
    recorded_at: new Date().toISOString(),
  };
  state.legs.push(recorded);

  let cycleComplete = false;
  let capRemaining;
  let capExhausted;
  if (expected.seq === LEGS_PER_CYCLE) {
    // FULL CYCLE COMPLETE — decrement the energy governor UNCONDITIONALLY.
    cycleComplete = true;
    capRemaining = itercap.decrement(instance);
    capExhausted = capRemaining <= 0;
    state.completed_cycles += 1;
    state.cycle += 1;
  } else {
    capRemaining = itercap.remaining(instance);
    capExhausted = capRemaining <= 0;
  }
  _write(instance, state);

  return {
    recorded,
    cycle: recorded.cycle,
    cycle_complete: cycleComplete,
    cap_remaining: capRemaining,
    cap_exhausted: capExhausted,
  };
}

/**
 * Are the last M cycles blocked ONLY because there is no falsifiable non-LLM
 * anchor (pure-judgment domain)? Truthful precision for PROVISIONAL_CONSENSUS:
 * the ledger must be clear AND every remaining per-cycle failure must be an
 * anchor pure-judgment failure. Uses the REAL grade-record readiness assessment.
 * @param {string} instance
 * @param {number} M
 * @returns {boolean}
 */
function _pureJudgmentOnly(instance, M) {
  let cycles;
  try {
    cycles = convergence.loadCycles(instance);
  } catch (_) {
    return false;
  }
  if (cycles.length < M) return false;
  if (!objectionLedger.isLedgerClearForDry(instance)) return false;
  const window = cycles.slice(cycles.length - M);
  return window.every((rec) => {
    const r = grade.assessCycleConvergenceReadiness(rec);
    if (r.ready) return false; // ready => would be dry; not a pure-judgment halt.
    return r.pureJudgment === true && r.reasons.every((x) => x.startsWith('anchor:'));
  });
}

/**
 * EVALUATE the loop's terminal state. DRY is delegated ENTIRELY to the real
 * convergence predicate (convergence.isDry) — this function adds no novel
 * predicate logic; it maps the predicate + ledger + cap governors onto the four
 * law-truthful terminal states, plus IN_PROGRESS.
 *
 * Terminal states (most-restrictive-wins across the three governors):
 *   CONVERGED                     — isDry() true.
 *   UNRESOLVED_OPERATOR_DECISION  — an expired objection exists (loop-terminal;
 *                                   never ledger-clearing). Routes to operator.
 *   FAILURE_INCOMPLETE            — cap exhausted while NOT dry (open objection
 *                                   and/or missing/unfalsifiable anchor and/or
 *                                   non-convergent). Never success.
 *   PROVISIONAL_CONSENSUS         — no falsifiable non-LLM anchor (pure-judgment);
 *                                   CONVERGED prohibited -> route to operator with
 *                                   the VERBATIM adversary-signed ledger + strongest
 *                                   standing dissent (never a coordinator summary).
 * Non-terminal: IN_PROGRESS.
 *
 * @param {string} instance
 * @param {{ M?:number, operatorDowngrade?:boolean }} [opts]
 * @returns {object}
 */
function evaluate(instance, opts) {
  opts = opts || {};
  const state = load(instance);

  const dry = convergence.isDry(instance, {
    M: Number.isInteger(opts.M) && opts.M > 0 ? opts.M : undefined,
    operatorDowngrade: opts.operatorDowngrade === true,
  });

  const allObjections = objectionLedger.read(instance);
  const blocking = objectionLedger.blockingObjections(instance);
  const unresolved = allObjections.filter((o) => o && o.status === objectionLedger.STATUS_UNRESOLVED);
  const ledgerClear = blocking.length === 0;

  let capRemaining = null;
  let capExhausted = false;
  try {
    capRemaining = itercap.remaining(instance);
    capExhausted = capRemaining <= 0;
  } catch (_) {
    // Uninitialized cap should be impossible post-init(); treat as exhausted=false.
  }

  const operatorGatedPending = state.operator_gated_questions.filter((q) => q.status !== 'resolved');

  const base = {
    instance,
    cycle: state.cycle,
    completed_cycles: state.completed_cycles,
    dry: dry.dry,
    M: dry.M,
    cycles_evaluated: dry.cyclesEvaluated,
    pure_judgment: dry.pureJudgment,
    reasons: dry.reasons,
    cap: { remaining: capRemaining, exhausted: capExhausted },
    ledger: {
      clear: ledgerClear,
      blocking: blocking.map((o) => ({ id: o.id, status: o.status })),
      unresolved: unresolved.map((o) => o.id),
    },
    operator_gated_pending: operatorGatedPending.map((q) => q.id),
  };

  // 1. CONVERGED — the real predicate is dry. (Dry wins even if the cap hit 0 on
  //    the same cycle: a converged loop is a success.)
  if (dry.dry) {
    return {
      ...base,
      state: 'CONVERGED',
      terminal: true,
      operator_route: operatorGatedPending.length > 0
        ? { required: true, reason: 'operator-gated questions await the operator (outside the loop)', operator_gated_pending: base.operator_gated_pending }
        : { required: false },
    };
  }

  // 2. UNRESOLVED_OPERATOR_DECISION — an expired objection is loop-terminal and can
  //    never clear; continuing to loop is pointless. Routes to the operator with
  //    the verbatim ledger (never a coordinator summary).
  if (unresolved.length > 0) {
    return {
      ...base,
      state: 'UNRESOLVED_OPERATOR_DECISION',
      terminal: true,
      operator_route: {
        required: true,
        reason: 'expired objection(s) — operator must decide; expiry never clears the ledger',
        verbatim_ledger: allObjections,
        strongest_dissent: null,
        note: 'attach the VERBATIM strongest standing dissent — the sequencer does not fabricate one',
      },
    };
  }

  // 3. FAILURE_INCOMPLETE — energy governor hit while not dry. Never success.
  if (capExhausted) {
    return {
      ...base,
      state: 'FAILURE_INCOMPLETE',
      terminal: true,
      operator_route: {
        required: true,
        reason: 'iteration cap exhausted with the loop not dry (open objection and/or missing/unfalsifiable anchor and/or non-convergent)',
        verbatim_ledger: allObjections,
      },
    };
  }

  // 4. PROVISIONAL_CONSENSUS — pure-judgment domain (no falsifiable anchor).
  //    CONVERGED prohibited; route to operator with verbatim ledger + strongest
  //    standing dissent.
  if (dry.pureJudgment && _pureJudgmentOnly(instance, dry.M)) {
    return {
      ...base,
      state: 'PROVISIONAL_CONSENSUS',
      terminal: true,
      operator_route: {
        required: true,
        reason: 'no falsifiable non-LLM ground-truth anchor (pure-judgment) — CONVERGED prohibited',
        verbatim_ledger: allObjections,
        strongest_dissent: null,
        note: 'route with the VERBATIM adversary-signed ledger + strongest standing dissent, NEVER a coordinator-only summary',
      },
    };
  }

  // Non-terminal: keep looping.
  return { ...base, state: 'IN_PROGRESS', terminal: false, operator_route: { required: false } };
}

/**
 * A compact status snapshot: state + the next-leg recommendation + counts.
 * @param {string} instance
 * @returns {object}
 */
function status(instance) {
  const state = load(instance);
  const evalr = evaluate(instance);
  const next = evalr.terminal ? null : nextLeg(instance);
  return {
    instance,
    scope: state.scope,
    cycle: state.cycle,
    completed_cycles: state.completed_cycles,
    legs_recorded: state.legs.length,
    legs_in_current_cycle: _legsInCurrentCycle(state),
    legs_per_cycle: LEGS_PER_CYCLE,
    open_questions: objectionLedger.blockingObjections(instance).map((o) => ({ id: o.id, status: o.status })),
    operator_gated_questions: state.operator_gated_questions.map((q) => ({ id: q.id, status: q.status })),
    evaluation: { state: evalr.state, terminal: evalr.terminal, dry: evalr.dry, cap: evalr.cap },
    next_leg: next,
  };
}

module.exports = {
  // lifecycle
  init,
  load,
  exists,
  deriveInstance,
  statePath,
  // questions
  addQuestion,
  closeQuestion,
  expireQuestion,
  resolveOperatorGatedQuestion,
  // sequencing + evaluation
  nextLeg,
  recordLeg,
  evaluate,
  status,
  scopeName,
  classifyQuestionCustody,
  checkDefendingFamily,
  // constants
  CYCLE_LEGS,
  LEGS_PER_CYCLE,
  DEFAULT_CAP,
  QLOOP_VERSION,
  STATE_DIR,
};
