'use strict';

/**
 * autonomous-execution-wiring.js
 *
 * S5 of plan-execution-autonomy-default-perimeter-gate-and-tracking.
 *
 * PURPOSE
 *   The thin orchestration layer that WIRES the (already-committed, individually
 *   tested) S1–S4 + GREENLIGHT pieces together for the two live entrypoints:
 *     - tools/codex/commands/run-plan.js
 *     - tools/kernel/hooks/userprompt-plan-review-gate.cjs
 *   so the diff in those audited live files stays tiny.
 *
 *   Two capabilities, BOTH dormant behind the existing DEFAULT-OFF flags. This
 *   module is pure logic + injection points; it flips NO flag and, when the
 *   flags are OFF (default), the live entrypoints never call into the
 *   behavior-changing paths here.
 *
 *     1. PERIMETER SCOPING (gated by SMOS_ENFORCE_OPERATOR_STAMP).
 *        `planTripsPerimeter(planJson)` / `planFileTripsPerimeter(jsonPath)`
 *        consult the S1 classifier so the operator-stamp / GREENLIGHT requirement
 *        is enforced ONLY when a plan trips the consequential perimeter
 *        (classifier => 'gate'). Non-perimeter (auto-run) plans need no stamp.
 *        This is the amendment's "enforce only at the perimeter."
 *
 *     2. AUTONOMOUS EXECUTION (gated by SMOS_AUTONOMOUS_EXECUTION).
 *        `runAutonomously(...)` auto-runs the safe prefix on an ISOLATED git
 *        branch (S2), projecting the plan tree to Dart (S3, observability only)
 *        and honoring the S4 kill switches (global disable flag + per-plan Dart
 *        Blocked). It STOPS at the first gate step (which needs GREENLIGHT).
 *
 * SECURITY INVARIANTS (mirrored from the convene + the S1–S4 module headers):
 *   - GREENLIGHT (operator-approval-verify.js) is the ONLY authority for a
 *     perimeter step. The classifier, the auto-run runner, the Dart projection
 *     and the kill switch are NOT authority surfaces.
 *   - Status reads are HALT-ONLY (kill switch) or OBSERVABILITY-ONLY (projection).
 *     This module exports NO function that turns a Dart status read into an
 *     authorize/resume/start/continue/grant decision. The only "may proceed"
 *     signal is `verifyPerimeterGreenlight`, which is a pure delegate to the
 *     version-bound operator-approval verifier.
 *   - FAIL-CLOSED: any uncertainty in perimeter classification => the plan trips
 *     the perimeter (require the GREENLIGHT proof). It is always safer to gate.
 */

const realFs = require('fs');

const classifier = require('./consequential-perimeter-classifier.js');
const autoRun = require('./auto-run-isolation.js');
const killSwitch = require('./auto-run-kill-switch.js');

// ---------------------------------------------------------------------------
// (1) Perimeter scoping — the classifier is the scoping signal, NOT authority.
// ---------------------------------------------------------------------------

/** Classify a plan, never throwing. FAIL-CLOSED on any error => plan_decision 'gate'. */
function classifyPlanSafely(planJson) {
  try {
    return classifier.classifyPlan(planJson);
  } catch (_) {
    return { decision: 'gate', plan_decision: 'gate', unknown: true, first_gate_step_id: null, tripped: [], steps: [] };
  }
}

/**
 * Does this plan trip the consequential perimeter (=> require GREENLIGHT)?
 * TRUE iff the S1 classifier returns plan_decision 'gate'. FAIL-CLOSED: an
 * unclassifiable plan trips the perimeter.
 *
 * This is the SCOPING signal for stamp/GREENLIGHT enforcement, not an authority:
 * a FALSE here only means "no perimeter trip found" — it never authorizes
 * anything; the GREENLIGHT proof is still the authority for any gated step.
 *
 * @param {object|string} planJson
 * @returns {boolean}
 */
function planTripsPerimeter(planJson) {
  if (planJson === null || planJson === undefined) return true; // nothing to classify => fail-closed
  return classifyPlanSafely(planJson).plan_decision === 'gate';
}

/** Read + parse a plan JSON file, returning null on any error (caller fail-closes). */
function readPlanJsonSafe(jsonPath, fsImpl) {
  const fs = fsImpl || realFs;
  if (!jsonPath || typeof jsonPath !== 'string') return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Perimeter-scope helper for run-plan.js: load the plan file and classify it.
 * FAIL-CLOSED: an unreadable / unparseable / unclassifiable plan trips the
 * perimeter (require the stamp). Used ONLY inside the already-enforced branch,
 * so the default (flag-OFF) path never reaches here.
 *
 * @param {string} jsonPath
 * @param {object} [fsImpl]
 * @returns {boolean}
 */
function planFileTripsPerimeter(jsonPath, fsImpl) {
  const plan = readPlanJsonSafe(jsonPath, fsImpl);
  if (!plan) return true; // unreadable plan => fail-closed perimeter
  return planTripsPerimeter(plan);
}

// ---------------------------------------------------------------------------
// GREENLIGHT authority delegate — the ONLY "may proceed" signal for a perimeter
// step, and a pure pass-through to the version-bound operator-approval verifier.
// Lazy-required so neither entrypoint pays its load cost unless it is used.
// ---------------------------------------------------------------------------

/**
 * verifyPerimeterGreenlight — re-verify the operator GREENLIGHT proof for a
 * perimeter (gated) step. Pure delegate to operator-approval-verify.js
 * (plan-approval piece 1); this module adds NO authority of its own. Returns the
 * verifier's { verified, reason, mechanism, details } verbatim. Fail-closed: a
 * loader error denies.
 *
 * @param {object} opts - forwarded to verifyOperatorApproval (planId, planText/
 *   planSha256, statusApproval | taskId+citedCommentId+operatorIdentity | hmacStamp, ...).
 * @returns {Promise<{verified:boolean, reason:string, mechanism:(string|null), details:object}>}
 */
async function verifyPerimeterGreenlight(opts) {
  let verifier;
  try {
    verifier = require('../../planning/lib/operator-approval-verify.js');
  } catch (e) {
    return { verified: false, reason: 'could not load GREENLIGHT verifier: ' + (e && e.message ? e.message : String(e)) + ' — fail-closed', mechanism: null, details: {} };
  }
  return verifier.verifyOperatorApproval(opts || {});
}

/**
 * verifyPresentStampSync — SYNCHRONOUS run-time re-verification of a present
 * operator_stamp, for the synchronous /run-plan runner (registered as a sync
 * command handler — it structurally cannot await an async verifier).
 *
 * This is the real D1 run-time re-verification on the CLI path. PRESENCE IS NOT
 * AUTHORITY: a present operator_stamp is RE-VERIFIED here against the CURRENT plan
 * digest, exactly as verifyOperatorApproval()'s Phase-2 HMAC path does — it calls
 * the SAME authority primitive (stamp-plan.verifyHmacStamp), which recomputes the
 * HMAC over plan_id + plan_sha256 + timestamp and timing-safe-compares the MAC.
 * The HMAC `/stamp` proof is the documented offline/CI GREENLIGHT proof and is the
 * only proof a synchronous runner can honor; the Dart-authorship proof requires
 * async network the sync runner cannot perform, so it is NOT reachable here and a
 * non-HMAC present stamp fails closed.
 *
 * FAIL-CLOSED on EVERYTHING: a non-object stamp, an unreadable plan, a missing
 * secret, a digest mismatch (plan edited after stamping), a forged MAC, or any
 * throw => verified:false. The version-bound binding kills ghost-step drift.
 *
 * SECURITY — secret provenance (mirrors operator-approval-verify's injectable-
 * readers constraint): the operator secret is resolved from the TRUSTED on-device
 * store (stamp-plan.resolveOperatorSecret with NO env opt-in) so a caller cannot
 * supply both a forged stamp AND a matching secret. `hmacSecret`/`secretOpts` are
 * injectable HERE ONLY for unit tests; the LIVE /run-plan call passes NEITHER.
 *
 * @param {object} o - { planId, stamp, planText|planJsonPath, fs?, hmacSecret?, secretOpts? }
 * @returns {{verified:boolean, reason:string, mechanism:(string|null)}}
 */
function verifyPresentStampSync(o) {
  const opts = o || {};
  const planId = opts.planId;
  const stamp = opts.stamp;

  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) {
    return { verified: false, reason: 'operator_stamp is not a verifiable proof object — presence alone is NOT authority; fail-closed', mechanism: null };
  }

  let verifier;
  let stampLib;
  try {
    verifier = require('../../planning/lib/operator-approval-verify.js');
    stampLib = require('../../planning/stamp-plan.js');
  } catch (e) {
    return { verified: false, reason: 'could not load GREENLIGHT verifier: ' + (e && e.message ? e.message : String(e)) + ' — fail-closed', mechanism: null };
  }

  // Current plan digest (binds to the exact plan-file bytes; any edit invalidates).
  let planText = opts.planText;
  if (planText === undefined || planText === null) {
    const fs = opts.fs || realFs;
    try { planText = fs.readFileSync(opts.planJsonPath, 'utf8'); }
    catch (e) { return { verified: false, reason: 'cannot read plan to re-verify the stamp (' + (e && e.message ? e.message : String(e)) + ') — fail-closed', mechanism: null }; }
  }
  let planSha256;
  try { planSha256 = verifier.computePlanSha256(planText); }
  catch (e) { return { verified: false, reason: 'cannot compute plan_sha256 — fail-closed', mechanism: null }; }

  // Operator secret from the TRUSTED on-device store by default (no env opt-in).
  let secret;
  try {
    secret = (opts.hmacSecret !== undefined) ? opts.hmacSecret : stampLib.resolveOperatorSecret(opts.secretOpts || {});
  } catch (_) {
    secret = null;
  }

  const res = stampLib.verifyHmacStamp(secret, stamp, { planId, planSha256 });
  return { verified: res.ok === true, reason: res.reason, mechanism: res.ok ? 'hmac' : null };
}

// ---------------------------------------------------------------------------
// (2) Autonomous execution — async isolated-branch runner.
//
// This is the async adapter S2 explicitly flagged it could not provide:
// runOnIsolatedBranch (S2) calls execStep SYNCHRONOUSLY and cannot AWAIT the real
// (async) step executor. We delegate the security-relevant SEGMENT PLANNING to S2
// (planAutoRunSegment — what is safe to run and where to stop), and add the async
// execution loop + the S4 kill-switch checks (global disable + per-plan Blocked)
// + the S3 status callback. The branch-name format is mirrored EXACTLY from S2.
// ---------------------------------------------------------------------------

/**
 * runOnIsolatedBranchAsync — auto-run the safe prefix on a fresh isolated branch,
 * AWAITING an async execStep, STOPPING at the gate (never running it).
 *
 * Mirrors S2 runOnIsolatedBranch's contract + result shape exactly, with two
 * additions required for live wiring:
 *   - `execStep` and `isDisabled` are AWAITED (real executor + async kill switch).
 *   - an optional async `isPlanBlocked()` (S4 per-plan Blocked) is checked before
 *     start and before every step; TRUE halts (fail-safe direction only).
 *   - an optional async `onStep(status, stepId, stepObj)` projection callback
 *     (S3) is invoked as steps transition (observability only — its return is
 *     ignored and its errors are swallowed; a projection failure never changes
 *     execution).
 *
 * @returns {Promise<object>} structured run result (started, disabled, branch,
 *   ran, stopped_at, gated_step_id, run_decision, error, reason).
 */
async function runOnIsolatedBranchAsync(args) {
  const opts = args || {};
  const { planId, planJson, steps, execStep, git, stamp } = opts;
  const isDisabled = typeof opts.isDisabled === 'function' ? opts.isDisabled : () => false;
  const isPlanBlocked = typeof opts.isPlanBlocked === 'function' ? opts.isPlanBlocked : null;
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;

  const halted = (reason, extra) => Object.assign({
    started: false, disabled: true, branch: null, ran: [], stopped_at: null,
    gated_step_id: null, run_decision: null, error: null, reason,
  }, extra || {});

  // --- Kill switches (before start). HALT-ONLY: never an authorization. ---
  if (await isDisabled()) return halted('kill-switch-disabled');
  if (isPlanBlocked && (await isPlanBlocked())) return halted('plan-blocked');

  // --- Contract validation (fail aloud on programming errors). ---
  if (!planId || typeof planId !== 'string') {
    throw new TypeError('runOnIsolatedBranchAsync: planId (non-empty string) is required');
  }
  if (!stamp || typeof stamp !== 'string') {
    throw new TypeError('runOnIsolatedBranchAsync: stamp (non-empty string) is required — never Date.now()');
  }
  if (typeof execStep !== 'function') {
    throw new TypeError('runOnIsolatedBranchAsync: execStep must be a function');
  }
  if (!git || typeof git.createBranch !== 'function') {
    throw new TypeError('runOnIsolatedBranchAsync: git.createBranch(name) must be injected');
  }

  const segment = opts.segment || autoRun.planAutoRunSegment(planJson || { steps });
  const rawSteps = autoRun.resolveRawSteps(planJson, steps);
  const byId = autoRun.indexStepsById(segment.classification, rawSteps);

  // --- Fresh isolated branch (never the working branch). ---
  const branch = `auto-run/${planId}-${stamp}`;
  git.createBranch(branch);

  const notify = async (status, id) => {
    if (!onStep) return;
    try { await onStep(status, id, byId.has(id) ? byId.get(id) : { id }); } catch (_) { /* observability only */ }
  };

  const ran = [];
  for (const id of segment.safe_prefix) {
    // Kill switches before EVERY step. A switch flipped mid-run stops + reports.
    if (await isDisabled()) {
      return { started: true, disabled: true, branch, ran, stopped_at: id, gated_step_id: segment.gated_step_id, run_decision: segment.run_decision, error: null, reason: 'kill-switch-disabled-midrun' };
    }
    if (isPlanBlocked && (await isPlanBlocked())) {
      return { started: true, disabled: true, branch, ran, stopped_at: id, gated_step_id: segment.gated_step_id, run_decision: segment.run_decision, error: null, reason: 'plan-blocked-midrun' };
    }

    const stepObj = byId.has(id) ? byId.get(id) : { id };
    await notify('running', id);
    try {
      await execStep(stepObj); // AWAIT the async real executor (the gap S2 flagged).
    } catch (err) {
      // Fail safe / reversible / aloud: stop, leave the branch, report the error.
      await notify('blocked', id);
      return {
        started: true, disabled: false, branch, ran, stopped_at: id,
        gated_step_id: segment.gated_step_id, run_decision: segment.run_decision,
        error: { step_id: id, message: err && err.message ? err.message : String(err) },
        reason: 'step-error',
      };
    }
    await notify('done', id);
    ran.push(id);
  }

  // Completed the safe prefix. We STOP at the gated step (never run it); it is
  // surfaced as Blocked in Dart so the operator sees it needs a GREENLIGHT proof.
  if (segment.gated_step_id) await notify('blocked', segment.gated_step_id);
  return {
    started: true, disabled: false, branch, ran, stopped_at: segment.gated_step_id,
    gated_step_id: segment.gated_step_id, run_decision: segment.run_decision,
    error: null, reason: 'stopped-at-gate',
  };
}

/**
 * runAutonomously — compose S2 (isolated-branch run) + S3 (Dart projection) +
 * S4 (kill switches) for one plan. The high-level entrypoint the live runner
 * delegates to once the operator has flipped SMOS_AUTONOMOUS_EXECUTION AND a real
 * executor has been injected.
 *
 * Dart is OBSERVABILITY ONLY: a projection failure never blocks execution, and a
 * Dart Blocked status is consumed ONLY as a halt (S4), never as an authorization.
 *
 * @param {object} o
 * @param {string} o.planId
 * @param {object|string} o.planJson
 * @param {Function} o.execStep   - async (stepObj) => any. The real step executor.
 * @param {object}   o.git        - injected git (createBranch).
 * @param {string}   o.stamp      - caller-supplied short stamp (never Date.now()).
 * @param {object}   [o.dart]     - injected dart-api (for S3 projection + S4 Blocked).
 * @param {string}   [o.dartboard]
 * @param {string}   [o.stateDir] - state dir for the S4 global disable flag.
 * @param {object}   [o.fs]       - injected fs (for the S4 flag read).
 * @param {Function} [o.isDisabled] - override the S4 global disable read (tests).
 * @returns {Promise<object>} the run result, with `.projection` attached.
 */
async function runAutonomously(o) {
  const opts = o || {};
  const { planId, planJson, execStep, git, stamp, dart, dartboard } = opts;
  const stateDir = opts.stateDir;
  const fsImpl = opts.fs;

  // S4 global disable flag — the injected isDisabled the S2-style runner consumes.
  const isDisabled = typeof opts.isDisabled === 'function'
    ? opts.isDisabled
    : () => killSwitch.isAutoRunDisabled({ stateDir, fs: fsImpl });

  // S3 projection (observability only). Fail-open: never block execution on it.
  // DENSITY-COLLAPSE MODEL (2026-07-14): a plan projects to exactly ONE Dart
  // parent card, not N per-step subtasks — projection.subtaskIds is always [].
  // Step-level identity for the comment callback below is resolved locally
  // from the classifier, not from any per-step Dart child.
  let projection = null;
  const decisionByStepId = new Map();
  if (dart && dartboard) {
    try {
      const proj = require('../../dart-integration/lib/plan-dart-projection.js');
      projection = await proj.projectPlanToDart(planJson, { dart, dartboard });
      const c = classifyPlanSafely(planJson);
      (c.steps || []).forEach((s) => {
        if (s && s.step_id) decisionByStepId.set(s.step_id, s.decision);
      });
    } catch (_) {
      projection = null; // observability failure must never halt or authorize anything.
    }
  }

  // S4 per-plan Blocked interrupt over the SINGLE parent card (HALT-ONLY).
  const isPlanBlocked = (dart && projection && projection.parentId)
    ? () => killSwitch.isPlanBlocked({ dart, parentId: projection.parentId })
    : null;

  // S3 live status callback (write-only observability): posts a timestamped
  // comment on the parent card instead of writing a (now nonexistent) subtask.
  const onStep = (dart && projection && projection.parentId)
    ? async (status, stepId, stepObj) => {
        const proj = require('../../dart-integration/lib/plan-dart-projection.js');
        await proj.syncStepStatus({
          dart,
          parentId: projection.parentId,
          step: stepObj,
          decision: decisionByStepId.get(stepId),
          status,
        });
      }
    : null;

  const result = await runOnIsolatedBranchAsync({
    planId, planJson, execStep, git, stamp, isDisabled, isPlanBlocked, onStep,
  });
  result.projection = projection
    ? { parentId: projection.parentId, subtaskIds: projection.subtaskIds }
    : null;
  return result;
}

// ---------------------------------------------------------------------------
// run-plan.js integration helpers — keep the live diff in run-plan.js minimal.
// ---------------------------------------------------------------------------

/**
 * Does the caller supply a real autonomous executor? This guard is what keeps
 * run-plan.js SYNCHRONOUS (and therefore byte-identical) on the default + the
 * flag-on-but-no-executor (live production) paths: only when a real executor is
 * injected does run-plan delegate to the async autonomous path.
 *
 * @param {object} options - the run-plan options object.
 * @returns {boolean}
 */
function hasAutonomousDeps(options) {
  const a = options && options.autonomous;
  return !!(a && typeof a.execStep === 'function' && a.git && typeof a.git.createBranch === 'function' && typeof a.stamp === 'string');
}

/**
 * runAutonomousFromRunPlan — the bridge run-plan.js calls when the operator has
 * flipped SMOS_AUTONOMOUS_EXECUTION AND injected a real executor. Loads the plan,
 * runs the safe prefix autonomously, and returns a command-shaped result.
 *
 * @param {object} args - { projectRoot, taskId, options, traceEnv?, fs? }
 * @returns {Promise<object>} command-shaped { exitCode, stdout, stderr, autonomous }.
 */
async function runAutonomousFromRunPlan(args) {
  const { taskId, options } = args || {};
  const fsImpl = (args && args.fs) || realFs;
  const a = (options && options.autonomous) || {};

  // Resolve the plan file. The caller may pass it directly (tests) or a jsonPath.
  let planJson = a.planJson || null;
  if (!planJson && a.jsonPath) planJson = readPlanJsonSafe(a.jsonPath, fsImpl);
  if (!planJson) {
    return { exitCode: 2, stdout: `[autonomous] could not load plan for ${taskId} — falling back to gated authority path.`, stderr: '', outputs: [], autonomous: null };
  }

  const result = await runAutonomously({
    planId: taskId,
    planJson,
    execStep: a.execStep,
    git: a.git,
    stamp: a.stamp,
    dart: a.dart,
    dartboard: a.dartboard,
    stateDir: a.stateDir,
    fs: fsImpl,
    isDisabled: a.isDisabled,
  });

  const lines = [
    `[autonomous] plan ${taskId}: ${result.run_decision || 'gate-immediately'} on branch ${result.branch || '(none)'}`,
    `[autonomous] ran ${result.ran.length} safe-prefix step(s); stopped at ${result.stopped_at || '(end)'} (${result.reason}).`,
  ];
  if (result.gated_step_id) {
    lines.push(`[autonomous] gate step ${result.gated_step_id} requires the operator GREENLIGHT proof (operator-approval-verify.js); it was NOT run.`);
  }
  if (result.error) {
    lines.push(`[autonomous] step error at ${result.error.step_id}: ${result.error.message} — branch left for inspection.`);
  }
  return { exitCode: result.error ? 2 : 0, stdout: lines.join('\n'), stderr: '', outputs: [], autonomous: result };
}

module.exports = {
  // (1) Perimeter scoping (used by run-plan.js + the gate hook).
  classifyPlanSafely,
  planTripsPerimeter,
  planFileTripsPerimeter,
  readPlanJsonSafe,
  // GREENLIGHT authority delegate (the ONLY may-proceed signal; pure pass-through).
  verifyPerimeterGreenlight,
  // Synchronous run-time re-verification for the sync /run-plan handler (D1).
  verifyPresentStampSync,
  // (2) Autonomous execution.
  runOnIsolatedBranchAsync,
  runAutonomously,
  hasAutonomousDeps,
  runAutonomousFromRunPlan,
};
