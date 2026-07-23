'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Bytes, resolveContainedFile } = require('../../verify/lib/run-evidence-index.cjs');
const { evaluatePlanRunGate, hashPlanPair } = require('./plan-run-gate');

/**
 * Relative path (from project root) to the system-scope state-marker directory.
 * Used when no clientCode is provided to resolveStateMarkerPath.
 * @type {string}
 */
const STATE_MARKER_SYSTEM_DIR = '_dev/state/plan-task-review-state';

// Legacy repair/review lifecycle events authored by THIS lib's
// approveRepair/rejectRepair flow. They carry the strict post_repair (and, for
// the terminal pair, post_review) provenance blocks validated below.
const LEGACY_REPAIR_EVENTS = new Set([
  'post_repair',
  'post_review_approved',
  'post_review_rejected'
]);

// Terminal subset of the legacy events that additionally require a post_review
// block mirroring the decision.
const LEGACY_TERMINAL_EVENTS = new Set([
  'post_review_approved',
  'post_review_rejected'
]);

// A4 (plan-approval-surface): the LIVE PlanTaskReviewState/1.0 markers authored
// by the review/convene/stamp flow (NOT by this lib) use a different, richer
// last_event vocabulary and do NOT carry a post_repair block. Before this fix
// readStateMarker/writeStateMarker THREW on every real marker (schema drift /
// writer-gap liability seen all session). These are enumerated (not open-ended)
// so an UNKNOWN last_event still fails validation. Set assembled by observing
// the live markers under _dev/state/plan-task-review-state/** and
// clients/*/state/plan-task-review-state/** on 2026-06-29, plus the events named
// in the plan-approval-surface concept.
const PLAN_TASK_REVIEW_STATE_EVENTS = new Set([
  'convene_complete',
  'convene_review_complete',
  'convene_conditions_integrated',
  'plan_superseded',
  'distinct_review_complete',
  'distinct_review_approved_with_minor',
  'review_approved',
  'review_pending',
  'implementation_review_approved',
  'g2_prompt_review_approved',
  'slice3_review_chain_complete',
  'post_repair_review',
  'operator_approved',
  'operator_stamped',
  'debrief_complete',
  'closed_with_caveats',
  'candidate_fixture_closed_without_run',
  'clean_agent_worktree_verified'
]);

const VALID_LAST_EVENTS = new Set([
  ...LEGACY_REPAIR_EVENTS,
  ...PLAN_TASK_REVIEW_STATE_EVENTS
]);

const VALID_REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected']);
const PLAN_RUN_GATE_MODE_ENV = 'SMOS_PLAN_RUN_GATE_MODE';

// ---------------------------------------------------------------------------
// operator_stamp enforcement (Stage A — plan-approval-surface security floor)
//
// CANONICAL home for the operator_stamp feature flag + presence assessment.
// Consumed by BOTH the userprompt-plan-review-gate.cjs hook (A1) and the
// /run-plan runtime tools/codex/commands/run-plan.js (A2) so the flag name and
// the presence contract have a single source of truth.
//
// BOOTSTRAP SAFETY: enforcement is DEFAULT-OFF. Stage B (not built here) is what
// produces a verifiable operator_stamp; turning enforcement on before a stamp
// can be produced would block EVERY plan's /run-plan. Activation is a deliberate
// one-line flip of SMOS_ENFORCE_OPERATOR_STAMP once Stage B/D land.
//
// ROLLBACK / ESCAPE HATCH (plan-approval-surface grounding adjustment #2):
// this env var IS the kill switch. Unsetting it (or setting it empty/false)
// disables operator-stamp enforcement everywhere it is consulted — A1
// (userprompt-plan-review-gate.cjs), A2 (tools/codex/commands/run-plan.js) and
// D1 (run-time re-verify). That single unset is the documented one-line rollback.
//
// STAGE SCOPE: assessOperatorStamp performs a PRESENCE-only check. It does NOT,
// and cannot, verify the stamp's authenticity (Dart-authorship re-verify / HMAC
// recompute) — that is Stage B/D run-time verification, not built here. A
// hand-written/raw operator_stamp passes presence here but is rejected at run
// time by Stage B/D's stamp-proof verification (see plan A3/D1 notes).
// ---------------------------------------------------------------------------
const OPERATOR_STAMP_ENFORCEMENT_ENV = 'SMOS_ENFORCE_OPERATOR_STAMP';

/**
 * Is operator_stamp enforcement (A1/A2) turned on? DEFAULT FALSE.
 * Only an explicit truthy env value activates it.
 *
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
function isOperatorStampEnforcementEnabled(env) {
  const raw = String(((env || process.env)[OPERATOR_STAMP_ENFORCEMENT_ENV]) || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * PRESENCE-only assessment of a marker's operator_stamp. Stage A enforcement
 * gates on this; Stage B/D re-verify authenticity at run time (not here).
 *
 * @param {object|null} marker - Parsed review-state marker (or null if absent).
 * @returns {{ status: 'present'|'missing', present: boolean, verifiedHere: boolean, detail: string }}
 */
function assessOperatorStamp(marker) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return {
      status: 'missing',
      present: false,
      verifiedHere: false,
      detail: 'no review-state marker present'
    };
  }
  const stamp = marker.operator_stamp;
  const emptyObject =
    stamp && typeof stamp === 'object' && !Array.isArray(stamp) && Object.keys(stamp).length === 0;
  if (stamp === null || stamp === undefined || stamp === '' || emptyObject) {
    return {
      status: 'missing',
      present: false,
      verifiedHere: false,
      detail: 'operator_stamp is null/absent'
    };
  }
  return {
    status: 'present',
    present: true,
    // Stage A does NOT verify authenticity; presence only. Run-time
    // re-verification (Dart-authorship / HMAC) is Stage B/D, not built here.
    verifiedHere: false,
    detail: 'operator_stamp present (presence-only; authenticity re-verified at run time by Stage B/D)'
  };
}

/**
 * Resolve the absolute path for a plan-review state marker.
 *
 * @param {string} projectRoot - Absolute path to the Mythos repo root.
 * @param {string} taskId - Task plan id.
 * @param {object} [opts]
 * @param {string} [opts.clientCode] - When provided, marker is placed under
 *   clients/<clientCode>/state/plan-task-review-state/.
 * @returns {string}
 */
function resolveStateMarkerPath(projectRoot, taskId, opts) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('resolveStateMarkerPath: projectRoot is required');
  }
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('resolveStateMarkerPath: taskId is required');
  }

  const clientCode = opts && opts.clientCode ? String(opts.clientCode) : null;
  const filename = taskId + '.json';

  if (clientCode) {
    return path.join(
      projectRoot,
      'clients',
      clientCode,
      'state',
      'plan-task-review-state',
      filename
    );
  }

  return path.join(projectRoot, STATE_MARKER_SYSTEM_DIR, filename);
}

/**
 * Validate a distinct_reviews / distinct_reviews_pending array (and its entries).
 *
 * These arrays are OPTIONAL and may appear on ANY marker family that carries a
 * distinct-mind review record — including the LEGACY `post_repair` family that
 * /repair-plan writes (the review-before-run gate
 * tools/kernel/hooks/userprompt-plan-review-gate.cjs reads marker.distinct_reviews
 * regardless of last_event). Tolerance contract (A4 doctrine + live-marker survey
 * 2026-06-30):
 *   - the field may be ABSENT, null, or an array (null/absent => "none");
 *   - each array ENTRY must be a plain object;
 *   - the four gate-relevant fields {actor, artifact, at, verdict}, WHEN PRESENT
 *     and non-null, must be strings. Presence is NOT required: live markers
 *     legitimately omit `at`/`artifact` or carry them as null, so we only TYPE the
 *     present fields rather than demand all four (demanding them would make
 *     readStateMarker throw on real markers — the writer-gap this lib already fixed).
 * This tightens the schema enough to reject malformed entries (non-object,
 * non-string actor/verdict, etc.) without loosening the rest of the contract.
 *
 * @param {*} value
 * @param {string} fieldName
 * @param {Array<string>} errors
 */
function validateDistinctReviewArray(value, fieldName, errors) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push(fieldName + ' must be an array when present');
    return;
  }
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(fieldName + '[' + i + '] must be an object');
      continue;
    }
    for (const key of ['actor', 'artifact', 'at', 'verdict', 'model', 'reviewer_family', 'producer_family', 'plan_pair_sha256', 'artifact_sha256']) {
      const v = entry[key];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string') {
        errors.push(fieldName + '[' + i + '].' + key + ' must be a string when present');
      }
    }
  }
}

/**
 * Validate the shape of a state-marker object.
 *
 * @param {object} marker
 * @returns {{ ok: boolean, errors: Array<string> }}
 */
function validateStateMarkerShape(marker) {
  const errors = [];

  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    errors.push('marker must be a plain object');
    return { ok: false, errors };
  }

  if (typeof marker.plan_id !== 'string' || marker.plan_id.length === 0) {
    errors.push('plan_id must be a non-empty string');
  }

  if (typeof marker.last_event !== 'string' || !VALID_LAST_EVENTS.has(marker.last_event)) {
    errors.push(
      'last_event must be one of: ' + Array.from(VALID_LAST_EVENTS).join(', ')
    );
  }

  // post_repair is required for the LEGACY repair/review events, because the
  // provenance chain (defect-surfacing review_reference + repair identity) must
  // persist through the approval/rejection transition. A4: the live
  // PlanTaskReviewState/1.0 events do NOT carry post_repair and must not be
  // forced to — that requirement was the writer-gap that made this lib throw on
  // every real marker.
  if (LEGACY_REPAIR_EVENTS.has(marker.last_event)) {
    const pr = marker.post_repair;
    if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
      errors.push('post_repair object is required for this last_event');
    } else {
      if (typeof pr.repair_id !== 'string' || pr.repair_id.length === 0) {
        errors.push('post_repair.repair_id must be a non-empty string');
      }
      if (typeof pr.timestamp !== 'string' || pr.timestamp.length === 0) {
        errors.push('post_repair.timestamp must be a non-empty string');
      }
      if (typeof pr.review_status !== 'string' || !VALID_REVIEW_STATUSES.has(pr.review_status)) {
        errors.push(
          'post_repair.review_status must be one of: ' +
            Array.from(VALID_REVIEW_STATUSES).join(', ')
        );
      }
      if (typeof pr.review_reference !== 'string' || pr.review_reference.length === 0) {
        errors.push('post_repair.review_reference must be a non-empty string');
      }
    }
  }

  // A1 two-reference model: post_review is REQUIRED on the legacy terminal events.
  if (LEGACY_TERMINAL_EVENTS.has(marker.last_event)) {
    const prv = marker.post_review;
    const expectedDecision =
      marker.last_event === 'post_review_approved' ? 'approved' : 'rejected';
    if (!prv || typeof prv !== 'object' || Array.isArray(prv)) {
      errors.push(
        'post_review object is required when last_event is post_review_approved or post_review_rejected'
      );
    } else {
      if (prv.decision !== expectedDecision) {
        errors.push(
          'post_review.decision must equal "' +
            expectedDecision +
            '" when last_event === "' +
            marker.last_event +
            '"'
        );
      }
      if (typeof prv.approval_reference !== 'string' || prv.approval_reference.length === 0) {
        errors.push('post_review.approval_reference must be a non-empty string');
      }
      if (typeof prv.decided_at !== 'string' || prv.decided_at.length === 0) {
        errors.push('post_review.decided_at must be a non-empty string');
      }
      if (
        prv.decided_by_actor_id !== undefined &&
        prv.decided_by_actor_id !== null &&
        (typeof prv.decided_by_actor_id !== 'string' || prv.decided_by_actor_id.length === 0)
      ) {
        errors.push(
          'post_review.decided_by_actor_id must be a non-empty string when present'
        );
      }
      // Enforce post_repair.review_status mirrors the terminal decision.
      if (
        marker.post_repair &&
        typeof marker.post_repair === 'object' &&
        !Array.isArray(marker.post_repair) &&
        marker.post_repair.review_status !== expectedDecision
      ) {
        errors.push(
          'post_repair.review_status must equal "' +
            expectedDecision +
            '" when last_event === "' +
            marker.last_event +
            '"'
        );
      }
    }
  }

  // distinct_reviews / distinct_reviews_pending are valid OPTIONAL arrays on ANY
  // marker family that can carry them — NOT just the live PlanTaskReviewState/1.0
  // events. The review-before-run gate reads marker.distinct_reviews on the
  // LEGACY post_repair family too (that is what recordDistinctReview appends to),
  // so their entry-shape validation runs UNCONDITIONALLY here rather than being
  // gated behind PLAN_TASK_REVIEW_STATE_EVENTS (which previously left them
  // unmodelled — and a hand-written entry unvalidated — on post_repair markers).
  validateDistinctReviewArray(marker.distinct_reviews, 'distinct_reviews', errors);
  validateDistinctReviewArray(marker.distinct_reviews_pending, 'distinct_reviews_pending', errors);

  // A4: light, non-weakening validation of the live PlanTaskReviewState/1.0
  // shape (convene_review, operator_stamp). These fields are optional; when
  // present they must be well-typed. We deliberately do NOT require them — the
  // lib is a tolerant reader of markers it does not author.
  if (PLAN_TASK_REVIEW_STATE_EVENTS.has(marker.last_event)) {
    if (
      marker.convene_review !== undefined &&
      marker.convene_review !== null &&
      (typeof marker.convene_review !== 'object' || Array.isArray(marker.convene_review)) &&
      typeof marker.convene_review !== 'string'
    ) {
      errors.push('convene_review must be an object or string when present');
    }
    if (
      marker.operator_stamp !== undefined &&
      marker.operator_stamp !== null &&
      (typeof marker.operator_stamp !== 'object' || Array.isArray(marker.operator_stamp)) &&
      typeof marker.operator_stamp !== 'string'
    ) {
      errors.push('operator_stamp must be an object, string, or null when present');
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Produce a new state-marker reflecting approval of the pending repair.
 *
 * Pure function — does no I/O. Validates both inputs and the resulting marker;
 * throws if inputs are missing or if the produced marker fails shape validation.
 *
 * @param {object} marker - Existing state marker (must be valid).
 * @param {string} approvalRef - Non-empty path/id of the /review-task-plan
 *   artifact that produced the approval.
 * @param {string} decidedAt - ISO 8601 timestamp (with tz) for the approval.
 * @param {string|null} [decidedByActorId] - Optional actor id.
 * @returns {object} New marker with post_review populated and last_event flipped.
 */
function approveRepair(marker, approvalRef, decidedAt, decidedByActorId) {
  return _applyReviewDecision(marker, 'approved', approvalRef, decidedAt, decidedByActorId);
}

/**
 * Produce a new state-marker reflecting rejection of the pending repair.
 *
 * Pure function — does no I/O. Validates both inputs and the resulting marker;
 * throws if inputs are missing or if the produced marker fails shape validation.
 *
 * @param {object} marker
 * @param {string} approvalRef
 * @param {string} decidedAt
 * @param {string|null} [decidedByActorId]
 * @returns {object}
 */
function rejectRepair(marker, approvalRef, decidedAt, decidedByActorId) {
  return _applyReviewDecision(marker, 'rejected', approvalRef, decidedAt, decidedByActorId);
}

/**
 * Resolve the first argument of recordDistinctReview to an absolute marker path.
 * Accepts either a marker PATH (anything path-like: absolute, contains a slash,
 * or ends in .json) or a bare TASK ID (resolved through the EXISTING resolver
 * resolveStateMarkerPath).
 *
 * @param {string} taskIdOrMarkerPath
 * @param {{ projectRoot?: string, clientCode?: string }} opts
 * @returns {string} absolute (or cwd-relative) marker path
 */
function _resolveRecordMarkerPath(taskIdOrMarkerPath, opts) {
  if (typeof taskIdOrMarkerPath !== 'string' || taskIdOrMarkerPath.length === 0) {
    throw new Error('recordDistinctReview: taskIdOrMarkerPath is required');
  }
  const arg = taskIdOrMarkerPath;
  const pathLike =
    path.isAbsolute(arg) || arg.includes('/') || arg.includes(path.sep) || arg.endsWith('.json');
  if (pathLike) {
    if (path.isAbsolute(arg)) return arg;
    return opts.projectRoot ? path.join(opts.projectRoot, arg) : path.resolve(arg);
  }
  const projectRoot = opts.projectRoot || process.cwd();
  return resolveStateMarkerPath(projectRoot, arg, { clientCode: opts.clientCode });
}

/**
 * Append (or upsert) a distinct-mind review entry to a state marker's
 * distinct_reviews[] and persist it through the EXISTING validated writer.
 *
 * SECURITY NOTE: distinct_reviews[] is the AUTHORITY consumed by the mechanical
 * review-before-run gate (tools/kernel/hooks/userprompt-plan-review-gate.cjs): an
 * entry whose verdict matches /approve|pass|accept|lgtm|ok/i SATISFIES that gate.
 * This writer therefore feeds a security floor — it is deliberately conservative:
 *   - it NEVER mutates review_status / last_event / post_repair / post_review.
 *     Recording a distinct review is NOT an approval and must not flip a
 *     post_repair/pending marker toward a terminal/approved state — that
 *     transition is owned exclusively by approveRepair/rejectRepair.
 *   - it does NOT decide what counts as an approving verdict; that classification
 *     lives in the gate and is left there untouched.
 *   - it writes through writeStateMarker (full shape validation), never raw fs.
 * This function records evidence; it does not confer trust. The recorded entry
 * still requires the distinct mind to actually be distinct from the producer —
 * which this writer cannot enforce. Treat as needing distinct-mind review before
 * it is wired into any auto-approval path.
 *
 * Idempotency: entries are keyed on (actor + artifact). Re-recording the same
 * (actor, artifact) upserts in place rather than appending a duplicate, so a
 * repeated record of the same {actor, artifact, verdict} is a no-op on content.
 *
 * @param {string} taskIdOrMarkerPath - Task id OR marker path (see resolver above).
 * @param {{ actor: string, artifact: string, verdict: string, at?: string, note?: string }} review
 * @param {{ projectRoot?: string, clientCode?: string }} [opts]
 * @returns {{ markerPath: string, marker: object, entry: object, action: 'appended'|'upserted' }}
 */
function recordDistinctReview(taskIdOrMarkerPath, review, opts) {
  opts = opts || {};
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    throw new Error('recordDistinctReview: review object is required');
  }
  const { actor, artifact, verdict } = review;
  if (typeof actor !== 'string' || actor.length === 0) {
    throw new Error('recordDistinctReview: review.actor must be a non-empty string');
  }
  if (typeof artifact !== 'string' || artifact.length === 0) {
    throw new Error('recordDistinctReview: review.artifact must be a non-empty string');
  }
  if (typeof verdict !== 'string' || verdict.length === 0) {
    throw new Error('recordDistinctReview: review.verdict must be a non-empty string');
  }
  let at = review.at;
  if (at === undefined || at === null || at === '') {
    at = new Date().toISOString();
  } else if (typeof at !== 'string') {
    throw new Error('recordDistinctReview: review.at must be a string when provided');
  }

  const entry = { actor, artifact, at, verdict };
  for (const key of ['model', 'reviewer_family', 'producer_family']) {
    if (review[key] !== undefined && review[key] !== null) {
      if (typeof review[key] !== 'string' || review[key].length === 0) {
        throw new Error(`recordDistinctReview: review.${key} must be a non-empty string when provided`);
      }
      entry[key] = review[key];
    }
  }
  if (review.note !== undefined && review.note !== null) {
    if (typeof review.note !== 'string') {
      throw new Error('recordDistinctReview: review.note must be a string when provided');
    }
    entry.note = review.note;
  }

  const markerPath = _resolveRecordMarkerPath(taskIdOrMarkerPath, opts);
  const marker = readStateMarker(markerPath);
  if (!marker) {
    throw new Error(
      'recordDistinctReview: no state marker found at ' +
        markerPath +
        ' — a distinct review can only be recorded against an existing marker'
    );
  }

  // New records are byte-bound when both the system plan pair and the review
  // artifact can be resolved safely. Opaque/legacy refs remain recordable but
  // unbound; caller-supplied hash claims are never copied into authority.
  try {
    const projectRoot = opts.projectRoot || process.cwd();
    const resolvedPlan = require('./resolve-task-plan').resolveTaskPlanPaths(projectRoot, marker.plan_id);
    if (resolvedPlan && fs.existsSync(resolvedPlan.jsonPath) && fs.existsSync(resolvedPlan.markdownPath)) {
      const pair = hashPlanPair(fs.readFileSync(resolvedPlan.jsonPath), fs.readFileSync(resolvedPlan.markdownPath));
      const artifactFile = resolveContainedFile(projectRoot, artifact);
      if (artifactFile.exists) {
        entry.plan_pair_sha256 = pair.plan_pair_sha256;
        entry.artifact_sha256 = sha256Bytes(fs.readFileSync(artifactFile.real));
      }
    }
  } catch (_) {
    delete entry.plan_pair_sha256;
    delete entry.artifact_sha256;
  }

  const list = Array.isArray(marker.distinct_reviews) ? marker.distinct_reviews.slice() : [];
  // Dedupe on (actor + artifact): upsert in place to avoid duplicate entries.
  const idx = list.findIndex(
    (r) => r && typeof r === 'object' && r.actor === actor && r.artifact === artifact
  );
  let action;
  if (idx >= 0) {
    // Preserve any extra provenance fields already on the existing entry.
    list[idx] = Object.assign({}, list[idx], entry);
    action = 'upserted';
  } else {
    list.push(entry);
    action = 'appended';
  }

  // PRESERVE review_status / last_event / post_repair / post_review verbatim;
  // only distinct_reviews changes.
  const next = Object.assign({}, marker, { distinct_reviews: list });
  writeStateMarker(markerPath, next);
  return { markerPath, marker: next, entry, action };
}

function _applyReviewDecision(marker, decision, approvalRef, decidedAt, decidedByActorId) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new Error('applyReviewDecision: marker must be a plain object');
  }
  if (typeof approvalRef !== 'string' || approvalRef.length === 0) {
    throw new Error('applyReviewDecision: approvalRef must be a non-empty string');
  }
  if (typeof decidedAt !== 'string' || decidedAt.length === 0) {
    throw new Error('applyReviewDecision: decidedAt must be a non-empty string');
  }
  if (!marker.post_repair || typeof marker.post_repair !== 'object' || Array.isArray(marker.post_repair)) {
    throw new Error('applyReviewDecision: marker.post_repair is required');
  }

  const terminalEvent =
    decision === 'approved' ? 'post_review_approved' : 'post_review_rejected';

  const post_review = {
    decision: decision,
    approval_reference: approvalRef,
    decided_at: decidedAt
  };
  if (decidedByActorId !== undefined && decidedByActorId !== null) {
    if (typeof decidedByActorId !== 'string' || decidedByActorId.length === 0) {
      throw new Error('applyReviewDecision: decidedByActorId must be a non-empty string when provided');
    }
    post_review.decided_by_actor_id = decidedByActorId;
  }

  const next = {
    plan_id: marker.plan_id,
    last_event: terminalEvent,
    post_repair: Object.assign({}, marker.post_repair, { review_status: decision }),
    post_review: post_review
  };

  const validation = validateStateMarkerShape(next);
  if (!validation.ok) {
    throw new Error(
      'applyReviewDecision: produced invalid marker: ' + validation.errors.join('; ')
    );
  }
  return next;
}

/**
 * Read a state marker from disk. Returns null if the file is absent.
 * Throws if the file exists but is invalid JSON or an invalid shape.
 *
 * @param {string} markerPath
 * @returns {object|null}
 */
function readStateMarker(markerPath) {
  if (!markerPath || typeof markerPath !== 'string') {
    throw new Error('readStateMarker: markerPath is required');
  }
  if (!fs.existsSync(markerPath)) return null;

  const raw = fs.readFileSync(markerPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'readStateMarker: failed to parse JSON at ' + markerPath + ': ' + err.message
    );
  }

  const validation = validateStateMarkerShape(parsed);
  if (!validation.ok) {
    throw new Error(
      'readStateMarker: invalid state-marker shape at ' +
        markerPath +
        ': ' +
        validation.errors.join('; ')
    );
  }

  return parsed;
}

/**
 * Write a state marker to disk atomically. Validates shape before write.
 * Creates missing parent directories.
 *
 * @param {string} markerPath
 * @param {object} markerObject
 * @returns {{ bytesWritten: number }}
 */
function writeStateMarker(markerPath, markerObject) {
  if (!markerPath || typeof markerPath !== 'string') {
    throw new Error('writeStateMarker: markerPath is required');
  }

  const validation = validateStateMarkerShape(markerObject);
  if (!validation.ok) {
    throw new Error(
      'writeStateMarker: invalid state-marker shape: ' + validation.errors.join('; ')
    );
  }

  const dir = path.dirname(markerPath);
  fs.mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify(markerObject, null, 2) + '\n';
  const tmpPath = markerPath + '.tmp';

  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, markerPath);

  return { bytesWritten: Buffer.byteLength(payload, 'utf8') };
}

/**
 * Consumer-facing check: should /run-plan be blocked based on the current
 * state marker?
 *
 * @param {object|null} marker
 * @returns {{ blocked: boolean, reason: string, blocker: string|null }}
 */
function isRunPlanBlockedByPendingRepair(marker) {
  if (marker === null || marker === undefined) {
    return {
      blocked: false,
      reason: 'no state marker present',
      blocker: null
    };
  }

  if (
    marker.last_event === 'post_repair' &&
    marker.post_repair &&
    marker.post_repair.review_status === 'pending'
  ) {
    return {
      blocked: true,
      reason: 'plan was repaired; review-before-run gate is pending',
      blocker: 'repair-pending-review'
    };
  }

  if (marker.last_event === 'post_review_rejected') {
    return {
      blocked: true,
      reason: 'most recent review rejected the repaired plan; re-repair required',
      blocker: 'repair-review-rejected'
    };
  }

  return {
    blocked: false,
    reason: 'state marker does not indicate a blocking condition',
    blocker: null
  };
}

function artifactHashMap(projectRoot, entries) {
  const hashes = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.artifact !== 'string') continue;
    try {
      const resolved = resolveContainedFile(projectRoot, entry.artifact);
      if (resolved.exists) hashes[entry.artifact] = sha256Bytes(fs.readFileSync(resolved.real));
    } catch (_) { /* unbound evidence remains absent */ }
  }
  return hashes;
}

function collectPlanRunGateDecision(projectRoot, taskId, opts = {}) {
  let resolved = null;
  let jsonBytes = null;
  let markdownBytes = null;
  let marker = null;
  let markerValid = false;
  let markerPresent = false;
  try {
    resolved = require('./resolve-task-plan').resolveTaskPlanPaths(projectRoot, taskId);
    jsonBytes = fs.readFileSync(resolved.jsonPath);
    markdownBytes = fs.readFileSync(resolved.markdownPath);
  } catch (_) { /* pure gate reports missing pair */ }
  try {
    const markerPath = resolveStateMarkerPath(projectRoot, taskId, { clientCode: resolved && resolved.clientCode });
    markerPresent = fs.existsSync(markerPath);
    marker = readStateMarker(markerPath);
    markerValid = Boolean(marker);
  } catch (_) {
    marker = null;
    markerValid = false;
  }

  let pairingStatus = 'unknown';
  try {
    const pairing = require('./resolve-task-plan').assessRepairPlanPairingWarning(projectRoot, taskId);
    pairingStatus = pairing.live ? 'warning' : 'aligned';
  } catch (_) { /* unknown fails closed */ }

  const reviews = marker && marker.distinct_reviews;
  return evaluatePlanRunGate({
    task_id: taskId,
    evaluated_at: opts.evaluatedAt || new Date().toISOString(),
    json_bytes: jsonBytes,
    markdown_bytes: markdownBytes,
    pairing_status: pairingStatus,
    marker_present: markerPresent,
    marker_valid: markerValid,
    marker,
    review_artifact_hashes: artifactHashMap(projectRoot, reviews),
    legacy_review_present: opts.legacyReviewPresent === true,
    requires_convene: opts.requiresConvene === true,
    convene_present: opts.convenePresent === true,
    operator_override_present: opts.operatorOverridePresent === true,
    operator_stamp_required: opts.operatorStampRequired,
    operator_stamp_verification: opts.operatorStampVerification
  });
}

function planRunGateMode(env = process.env) {
  const value = String(env[PLAN_RUN_GATE_MODE_ENV] || '').trim().toLowerCase();
  if (value === 'enforce' || value === 'off') return value;
  return 'observe';
}

function appendPlanRunGateReceipt(projectRoot, receipt) {
  try {
    const dir = path.join(projectRoot, '_dev', 'state', 'plan-review-gate');
    fs.mkdirSync(dir, { recursive: true });
    const receiptPath = path.join(dir, 'probation-receipts.jsonl');
    if (fs.existsSync(receiptPath) && fs.statSync(receiptPath).size > 1024 * 1024) {
      const retained = fs.readFileSync(receiptPath, 'utf8').trim().split('\n').slice(-499);
      fs.writeFileSync(receiptPath, retained.length > 0 ? `${retained.join('\n')}\n` : '', 'utf8');
    }
    fs.appendFileSync(receiptPath, JSON.stringify(receipt) + '\n', 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  STATE_MARKER_SYSTEM_DIR,
  VALID_LAST_EVENTS,
  LEGACY_REPAIR_EVENTS,
  PLAN_TASK_REVIEW_STATE_EVENTS,
  OPERATOR_STAMP_ENFORCEMENT_ENV,
  PLAN_RUN_GATE_MODE_ENV,
  isOperatorStampEnforcementEnabled,
  assessOperatorStamp,
  resolveStateMarkerPath,
  readStateMarker,
  writeStateMarker,
  isRunPlanBlockedByPendingRepair,
  validateStateMarkerShape,
  approveRepair,
  rejectRepair,
  recordDistinctReview,
  artifactHashMap,
  collectPlanRunGateDecision,
  planRunGateMode,
  appendPlanRunGateReceipt
};
