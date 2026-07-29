'use strict';

/**
 * auto-run-kill-switch.js
 *
 * S4 of plan-execution-autonomy-default-perimeter-gate-and-tracking.
 *
 * PURPOSE
 *   The KILL SWITCH for autonomous plan execution. Two independent mechanisms
 *   that can ONLY ever HALT auto-run:
 *
 *     1. GLOBAL disable flag — a single file (`<stateDir>/ambient-router/disabled`)
 *        whose mere existence disables ALL auto-run everywhere. This is the
 *        function S2's `runOnIsolatedBranch` consumes as its injected
 *        `isDisabled()`.
 *     2. PER-PLAN Blocked interrupt — reads the plan's single Dart PARENT card
 *        status (density-collapse model, 2026-07-14 — a plan projects to
 *        exactly one Dart card, not N per-step subtasks) and reports `true` if
 *        it is `Blocked`. The operator flips the one parent card to Blocked to
 *        stop that specific run. The legacy `subtaskIds`/`listSubtasks` reader
 *        shapes are still accepted for callers that have not migrated.
 *
 *   This module is INERT: it is NOT wired into the live `run-plan` path. It is a
 *   standalone, fully-tested library. Live activation is a later operator-gated
 *   step.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITICAL HALT-ONLY INVARIANT (the safe-direction carve-out to the S3 rule)
 * ─────────────────────────────────────────────────────────────────────────────
 *   Reading state here — a flag file OR a Dart status — is ONLY EVER used to
 *   HALT execution. It travels in the fail-safe direction.
 *
 *     • A `true` return means "HALT" (disabled / blocked).
 *     • A `false` return means ONLY "this kill switch found no reason to halt".
 *       It is NOT an authorization, resume, or greenlight. Some OTHER authority
 *       (the GREENLIGHT proof, operator-approval-verify.js) must independently
 *       authorize execution. A `false` from this module never starts, resumes,
 *       continues, or grants a run.
 *
 *   This is the safe-direction carve-out to the S3 observability rule
 *   (plan-dart-projection.js): status→halt is ALLOWED here; status→authorize is
 *   FORBIDDEN everywhere. Accordingly:
 *
 *     • NO function in this module returns an "authorized / may-run / resume /
 *       greenlight / start / continue / grant" decision. The module exposes only
 *       halt signals (booleans whose TRUE meaning is "halt") plus operator/test
 *       helpers to set or clear the flag.
 *     • On ANY uncertainty (the check itself errors, a read fails), the answer is
 *       TRUE — halt. It is always safer to stop than to run.
 *
 *   Adding any function that turns a read into an authorize/resume/start/continue
 *   decision is a security-boundary violation. The test-suite asserts the
 *   exported surface contains no such function.
 *
 * PUBLIC API
 *   isAutoRunDisabled({ stateDir?, fs? }) -> boolean
 *     true iff the global disable flag exists. TRUE (halt) on any error.
 *
 *   isPlanBlocked({ dart?, parentId?, subtaskIds?, listSubtasks?, blockedStatus? })
 *     -> Promise<boolean>
 *     true iff the plan's single Dart parent card (read via `dart.getTask(parentId)`
 *     when no `listSubtasks`/`subtaskIds` reader is supplied) is Blocked. Legacy
 *     `subtaskIds`/`listSubtasks` readers (true iff ANY entry is Blocked) are
 *     still honored for callers that have not migrated. TRUE (halt) on any read
 *     error. Dart reader is injected for tests.
 *
 *   disableAutoRun({ stateDir?, fs? }) -> string   (operator/test helper)
 *   enableAutoRun({ stateDir?, fs? })  -> void      (operator/test helper)
 *     Create / remove the flag file. NEVER called by this module itself.
 *
 *   flagPath({ stateDir? }) -> string               (resolve the flag location)
 */

const realFs = require('fs');
const path = require('path');

// Repo root is three levels up from tools/kernel/lib/.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '_dev', 'state');

// The conventional sub-path under the state dir. Documented in
// _dev/state/ambient-router/README.md.
const AMBIENT_ROUTER_DIR = 'ambient-router';
const DISABLE_FLAG_FILE = 'disabled';

// The canonical Dart status string that means a subtask is blocked. Mirrors the
// S3 LIFECYCLE_TO_DART_STATUS mapping (blocked -> 'Blocked').
const BLOCKED_STATUS = 'Blocked';

/**
 * flagPath — resolve the absolute path of the global disable flag.
 * @param {{stateDir?: string}} [opts]
 * @returns {string}
 */
function flagPath(opts) {
  const stateDir = (opts && opts.stateDir) || DEFAULT_STATE_DIR;
  return path.join(stateDir, AMBIENT_ROUTER_DIR, DISABLE_FLAG_FILE);
}

/**
 * isAutoRunDisabled — GLOBAL kill switch read.
 *
 * Returns TRUE iff the disable flag file exists. HALT-ONLY: a TRUE result stops
 * auto-run; a FALSE result is merely "no global halt found" and authorizes
 * nothing. Fail-safe: if the existence check itself throws, return TRUE — it is
 * safer to halt than to run on an unreadable kill switch.
 *
 * @param {{stateDir?: string, fs?: object}} [opts]
 * @returns {boolean} true = disabled (HALT)
 */
function isAutoRunDisabled(opts) {
  const o = opts || {};
  const fs = o.fs || realFs;
  try {
    return fs.existsSync(flagPath(o));
  } catch (_err) {
    // Fail-safe: an unreadable kill switch must HALT, never silently run.
    return true;
  }
}

/**
 * disableAutoRun — operator/test helper. Create the global disable flag.
 * NOT called by this module; provided for the operator and tests only.
 * @param {{stateDir?: string, fs?: object}} [opts]
 * @returns {string} the flag path written
 */
function disableAutoRun(opts) {
  const o = opts || {};
  const fs = o.fs || realFs;
  const p = flagPath(o);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    'auto-run disabled by operator kill switch. Remove this file to re-enable.\n'
  );
  return p;
}

/**
 * enableAutoRun — operator/test helper. Remove the global disable flag (if any).
 * NOT called by this module; provided for the operator and tests only.
 * @param {{stateDir?: string, fs?: object}} [opts]
 * @returns {void}
 */
function enableAutoRun(opts) {
  const o = opts || {};
  const fs = o.fs || realFs;
  const p = flagPath(o);
  try {
    fs.rmSync(p, { force: true });
  } catch (_err) {
    // Best-effort removal; absence is the desired end-state.
  }
}

/** Read a subtask status string from a Dart task object, tolerant of shapes. */
function readStatus(task) {
  if (!task || typeof task !== 'object') return null;
  // Dart task `status` is a string ('Blocked'); be tolerant of {status:{title}}.
  const s = task.status;
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object' && typeof s.title === 'string') return s.title;
  return null;
}

/**
 * isPlanBlocked — PER-PLAN kill switch read.
 *
 * DENSITY-COLLAPSE MODEL (2026-07-14): a plan now projects to exactly ONE
 * Dart parent card (see plan-dart-projection.js), not N per-step subtasks.
 * The primary read path is therefore a SINGLE-CARD read: `dart.getTask(parentId)`,
 * returning TRUE iff that one card is Blocked. HALT-ONLY: a TRUE result stops
 * the run; a FALSE result is merely "no Blocked card found" and authorizes
 * nothing — it never resumes or greenlights a run.
 *
 * Resolution order (Dart reader is injected so tests never call live Dart):
 *   1. If `listSubtasks` is a function, it is awaited with
 *      `{ parentId, subtaskIds, dart }` and must return an array of task
 *      objects — legacy multi-card reader shape, still honored.
 *   2. Else if a non-empty `subtaskIds` array is supplied, each id is read via
 *      `dart.getTask(id)` — legacy per-step-subtask reader shape, still honored
 *      for callers that have not migrated to the single-parent-card model.
 *   3. Else if `parentId` is supplied, it alone is read via
 *      `dart.getTask(parentId)` — THE CURRENT single-parent-card path.
 *   4. Else no way to read plan state was provided — fail-safe HALT.
 *
 * Fail-safe: if ANY read throws (including on the single-parent-card path), or
 * the read returns a malformed/unreadable result, return TRUE — an unreadable
 * plan state must HALT, never silently proceed.
 *
 * @param {{dart?: object, parentId?: string, subtaskIds?: string[],
 *          listSubtasks?: Function, blockedStatus?: string}} opts
 * @returns {Promise<boolean>} true = the plan's card(s) show Blocked (HALT)
 */
async function isPlanBlocked(opts) {
  const o = opts || {};
  const blockedStatus = (o.blockedStatus || BLOCKED_STATUS).toLowerCase();
  try {
    let tasks;
    if (typeof o.listSubtasks === 'function') {
      tasks = await o.listSubtasks({
        parentId: o.parentId,
        subtaskIds: o.subtaskIds,
        dart: o.dart,
      });
    } else if (Array.isArray(o.subtaskIds) && o.subtaskIds.length && o.dart && typeof o.dart.getTask === 'function') {
      // Legacy per-step-subtask reader shape (pre-density-collapse callers).
      tasks = [];
      for (const id of o.subtaskIds) {
        // Sequential: any single read error fails safe (caught below -> HALT).
        tasks.push(await o.dart.getTask(id));
      }
    } else if (o.parentId && o.dart && typeof o.dart.getTask === 'function') {
      // CURRENT single-parent-card read path (density-collapse model): the
      // parent IS the one markable object now; read its status directly.
      const parentTask = await o.dart.getTask(o.parentId);
      if (parentTask === null || parentTask === undefined || typeof parentTask !== 'object') {
        // Malformed/unreadable single-card response — fail-safe HALT. Distinct
        // from "read a real card whose status is not Blocked" (that is a
        // legitimate false / no-halt-found result, handled below).
        return true;
      }
      const parentStatus = readStatus(parentTask);
      if (typeof parentStatus !== 'string' || parentStatus === '') {
        // An object-shaped response with NO readable non-empty string status
        // (e.g. {}, { id: 'P' }, { status: {} }, { status: '' }) is just as
        // unreadable as null/undefined for this module's purposes. Treating it
        // as "not Blocked" would silently no-halt on a malformed parent read,
        // violating the file's "ANY uncertainty => TRUE/HALT" contract.
        // Fail-safe: HALT.
        return true;
      }
      tasks = [parentTask];
    } else {
      // No way to read plan state was provided. Fail-safe: HALT.
      return true;
    }

    const list = Array.isArray(tasks) ? tasks : [];
    return list.some((t) => {
      const status = readStatus(t);
      return typeof status === 'string' && status.toLowerCase() === blockedStatus;
    });
  } catch (_err) {
    // Fail-safe: an unreadable plan state must HALT.
    return true;
  }
}

module.exports = {
  // Halt signals (TRUE means HALT). These are the ONLY decision functions and
  // neither can authorize/resume/start/continue/grant a run.
  isAutoRunDisabled,
  isPlanBlocked,
  // Operator/test helpers — set/clear the flag. NOT invoked by this module.
  disableAutoRun,
  enableAutoRun,
  // Path + constant helpers.
  flagPath,
  DEFAULT_STATE_DIR,
  AMBIENT_ROUTER_DIR,
  DISABLE_FLAG_FILE,
  BLOCKED_STATUS,
};
