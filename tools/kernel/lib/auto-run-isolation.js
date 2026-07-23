'use strict';

/**
 * auto-run-isolation.js
 *
 * S2 of plan-execution-autonomy-default-perimeter-gate-and-tracking.
 *
 * PURPOSE
 *   A STANDALONE, fully-tested library that turns the per-step classification
 *   from S1 (consequential-perimeter-classifier) into an auto-run plan and
 *   executes ONLY the safe prefix on an ISOLATED git branch, stopping at the
 *   first step that trips the consequential perimeter (the GREENLIGHT gate).
 *
 *   This module is INERT: it is NOT activated by the live runner. Live
 *   activation + the GREENLIGHT enforcement wiring is S5 (operator-gated).
 *
 * SAFETY POSTURE — "fail safe, fail reversible, fail aloud":
 *   - ISOLATION: every auto-run happens on a fresh, dedicated git branch
 *     (`auto-run/<planId>-<stamp>`), never on the operator's working branch.
 *   - STOP AT THE GATE: the runner runs steps up to (NOT including) the first
 *     gating step. It NEVER runs the gated step — that is left for S5/GREENLIGHT.
 *   - FAIL-CLOSED CLASSIFICATION: if S1 cannot identify a safe step (fail-closed
 *     plan with plan_decision='gate' but no step id), the segment is
 *     'gate-immediately' and nothing auto-runs.
 *   - FAIL ALOUD: on any step error, stop immediately, leave the branch intact
 *     for inspection, and RETURN the error + branch (never swallow).
 *   - KILL SWITCH: an injected isDisabled() is honored both before starting and
 *     before every step; a disabled switch never starts or continues auto-run.
 *   - DETERMINISTIC BRANCH NAMES: the stamp is ALWAYS injected by the caller.
 *     This module NEVER calls Date.now()/Math.random() for branch identity.
 *
 *   git + execStep + isDisabled are all INJECTED so tests can mock them and the
 *   library never touches the real repo or executes real steps under test.
 *
 * PUBLIC API
 *   planAutoRunSegment(planJson) -> {
 *     safe_prefix:    [step_id, ...],  // step ids strictly before the gate
 *     gated_step_id:  <step id>|null,  // first gating step, or null
 *     run_decision:   'auto-run-prefix'|'all-auto-run'|'gate-immediately',
 *     classification: <classifyPlan result>,
 *   }
 *
 *   runOnIsolatedBranch({ planId, planJson, steps, segment, execStep, git,
 *                         isDisabled, stamp }) -> {
 *     started, disabled, branch, ran:[...], stopped_at, gated_step_id,
 *     run_decision, error,
 *   }
 */

const classifier = require('./consequential-perimeter-classifier.js');

const RUN_DECISION = {
  AUTO_RUN_PREFIX: 'auto-run-prefix',
  ALL_AUTO_RUN: 'all-auto-run',
  GATE_IMMEDIATELY: 'gate-immediately',
};

// ---------------------------------------------------------------------------
// Segment planning — consult S1, derive the safe prefix + the gated step.
// ---------------------------------------------------------------------------

/**
 * planAutoRunSegment — decide what may auto-run for a plan.
 *
 * Maps the S1 classification to an auto-run segment:
 *   - No step gates                    -> 'all-auto-run'  (whole plan safe).
 *   - First step gates                 -> 'gate-immediately' (empty prefix).
 *   - Fail-closed plan w/ no step id   -> 'gate-immediately' (empty prefix).
 *   - Otherwise                        -> 'auto-run-prefix' (prefix before gate).
 *
 * @param {object|string} planJson  A TaskPlan artifact (object or JSON string).
 * @returns {{safe_prefix:string[], gated_step_id:(string|null),
 *            run_decision:string, classification:object}}
 */
function planAutoRunSegment(planJson) {
  const classification = classifier.classifyPlan(planJson);
  const stepIds = classification.steps.map((s) => s.step_id);
  const firstGate = classification.first_gate_step_id;

  if (firstGate === null || firstGate === undefined) {
    // No step gated. If the plan itself fail-closed to 'gate' but produced no
    // identifiable gate step (garbled/empty/unparseable plan), that is a
    // gate-immediately, NOT an all-auto-run — never auto-run an unclassifiable
    // plan.
    if (classification.plan_decision === 'gate') {
      return {
        safe_prefix: [],
        gated_step_id: null,
        run_decision: RUN_DECISION.GATE_IMMEDIATELY,
        classification,
      };
    }
    return {
      safe_prefix: stepIds.slice(),
      gated_step_id: null,
      run_decision: RUN_DECISION.ALL_AUTO_RUN,
      classification,
    };
  }

  const idx = stepIds.indexOf(firstGate);
  // idx <= 0 means the first step gates (or the id is somehow not locatable in
  // the ordered list) -> nothing is safe to auto-run.
  if (idx <= 0) {
    return {
      safe_prefix: [],
      gated_step_id: firstGate,
      run_decision: RUN_DECISION.GATE_IMMEDIATELY,
      classification,
    };
  }

  return {
    safe_prefix: stepIds.slice(0, idx),
    gated_step_id: firstGate,
    run_decision: RUN_DECISION.AUTO_RUN_PREFIX,
    classification,
  };
}

// ---------------------------------------------------------------------------
// Isolated-branch execution.
// ---------------------------------------------------------------------------

/** Resolve the ordered raw step objects from whatever the caller provided. */
function resolveRawSteps(planJson, steps) {
  if (Array.isArray(steps)) return steps;
  let plan = planJson;
  if (typeof plan === 'string') {
    try { plan = JSON.parse(plan); } catch (_) { plan = null; }
  }
  const extracted = classifier.extractSteps(plan);
  return Array.isArray(extracted) ? extracted : [];
}

/** Build an id->rawStep map by zipping classification order with raw steps. */
function indexStepsById(classification, rawSteps) {
  const byId = new Map();
  classification.steps.forEach((cs, i) => {
    byId.set(cs.step_id, rawSteps[i]);
  });
  return byId;
}

/**
 * runOnIsolatedBranch — auto-run the safe prefix on a fresh isolated branch.
 *
 * Runs ONLY the safe-prefix steps (via injected execStep), STOPS at the gated
 * step (never runs it), and returns a structured result. On any step error or
 * mid-run kill-switch flip, it stops, leaves the branch for inspection, and
 * reports aloud.
 *
 * @param {object}   args
 * @param {string}   args.planId      Plan id (used in the branch name).
 * @param {object|string} [args.planJson]  The plan (classified if no segment).
 * @param {Array}    [args.steps]     Ordered raw step objects (optional source).
 * @param {object}   [args.segment]   A precomputed planAutoRunSegment() result.
 * @param {Function} args.execStep    (stepObj) => any. Throwing = step failure.
 * @param {object}   args.git         Injected git; must expose createBranch(name).
 * @param {Function} [args.isDisabled] () => boolean kill switch (default: never).
 * @param {string}   args.stamp       Caller-supplied short stamp (NEVER Date.now).
 * @returns {object} structured run result.
 */
function runOnIsolatedBranch(args) {
  const opts = args || {};
  const {
    planId,
    planJson,
    steps,
    execStep,
    git,
    stamp,
  } = opts;
  const isDisabled = typeof opts.isDisabled === 'function' ? opts.isDisabled : () => false;

  // --- Kill switch (before start). A disabled switch never starts auto-run. ---
  if (isDisabled()) {
    return {
      started: false,
      disabled: true,
      branch: null,
      ran: [],
      stopped_at: null,
      gated_step_id: null,
      run_decision: null,
      error: null,
      reason: 'kill-switch-disabled',
    };
  }

  // --- Contract validation (fail aloud on programming errors). ---
  if (!planId || typeof planId !== 'string') {
    throw new TypeError('runOnIsolatedBranch: planId (non-empty string) is required');
  }
  if (!stamp || typeof stamp !== 'string') {
    throw new TypeError('runOnIsolatedBranch: stamp (non-empty string) is required — never Date.now()');
  }
  if (typeof execStep !== 'function') {
    throw new TypeError('runOnIsolatedBranch: execStep must be a function');
  }
  if (!git || typeof git.createBranch !== 'function') {
    throw new TypeError('runOnIsolatedBranch: git.createBranch(name) must be injected');
  }

  const segment = opts.segment || planAutoRunSegment(planJson || { steps });
  const rawSteps = resolveRawSteps(planJson, steps);
  const byId = indexStepsById(segment.classification, rawSteps);

  // --- Create the fresh isolated branch (isolation: never the working branch). ---
  const branch = `auto-run/${planId}-${stamp}`;
  git.createBranch(branch);

  const ran = [];
  for (const id of segment.safe_prefix) {
    // Kill switch (before EVERY step). A switch flipped mid-run stops + reports.
    if (isDisabled()) {
      return {
        started: true,
        disabled: true,
        branch,
        ran,
        stopped_at: id,
        gated_step_id: segment.gated_step_id,
        run_decision: segment.run_decision,
        error: null,
        reason: 'kill-switch-disabled-midrun',
      };
    }

    const stepObj = byId.has(id) ? byId.get(id) : { id };
    try {
      execStep(stepObj);
    } catch (err) {
      // Fail safe / reversible / aloud: stop, leave the branch, report the error.
      return {
        started: true,
        disabled: false,
        branch,
        ran,
        stopped_at: id,
        gated_step_id: segment.gated_step_id,
        run_decision: segment.run_decision,
        error: {
          step_id: id,
          message: err && err.message ? err.message : String(err),
        },
        reason: 'step-error',
      };
    }
    ran.push(id);
  }

  // Completed the safe prefix. We STOP at the gated step (never run it).
  return {
    started: true,
    disabled: false,
    branch,
    ran,
    stopped_at: segment.gated_step_id,
    gated_step_id: segment.gated_step_id,
    run_decision: segment.run_decision,
    error: null,
    reason: 'stopped-at-gate',
  };
}

module.exports = {
  planAutoRunSegment,
  runOnIsolatedBranch,
  RUN_DECISION,
  // Internals exposed for white-box tests.
  resolveRawSteps,
  indexStepsById,
};
