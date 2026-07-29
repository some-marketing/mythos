'use strict';

/**
 * operator-approval-verify.js — B2 (plan-approval-surface) — the core operator
 * approval VERIFIER. Identity-based Dart proof is PRIMARY; HMAC `/stamp` is the
 * offline/CI FALLBACK (see _dev/concepts/plan-approval-surface/concept.md:95-99,157).
 *
 * CONTRACT — "verify, DON'T trust the marker file":
 *   Given a plan id + the current plan digest + a CITED approval proof, RE-VERIFY
 *   at call time:
 *     (a) the cited Dart comment EXISTS and is authored by the operator identity
 *         ({OPERATOR_NAME}'s Dart duid/email/name), NOT the Mythos Dart identity;
 *     (b) the comment matches the structured approval convention LITERALLY
 *         (exact pattern, NO natural-language judgment — the gate is a SCRIBE,
 *         not an ARBITER);
 *     (c) the plan_sha256 binding matches (an edited plan invalidates a prior
 *         stamp — kills ghost-step drift).
 *   Returns { verified, reason, mechanism }.
 *
 * FAIL-CLOSED (G-COND-2): cannot-verify ⇒ cannot-approve. A Dart-unreachable
 *   condition NEVER silently passes; it denies unless a valid HMAC fallback proof
 *   is present. Undefined-on-unreachable is a forbidden silent bypass.
 *
 * FORCED-FALLBACK (G-COND-3): if the resident Dart token is NOT the Mythos
 *   identity (the operator's token could be on-machine), the caller passes a
 *   precondition with forceFallback:true and the Dart-authorship path is DISABLED
 *   — only the HMAC stamp can authorize. See tools/kernel/lib/dart-identity-precondition.js.
 *
 * STRUCTURED APPROVAL CONVENTION (G-COND-1, defined here as the deterministic
 *   literal authority; mirror this into the concept for the operator UX):
 *
 *       APPROVE-RUN <plan_id> <plan_sha256_prefix>
 *
 *   - One line in the operator's Dart comment, matched case-sensitively on the
 *     literal token `APPROVE-RUN`.
 *   - <plan_id> must equal the plan's id exactly.
 *   - <plan_sha256_prefix> must be a hex prefix (>= 12 chars) of the CURRENT
 *     plan_sha256. A short or stale prefix fails (drift guard).
 *   Worked PASS example (planId={CLIENT_CODE}-x, sha256 starts ab12cd34ef56…):
 *       "APPROVE-RUN {CLIENT_CODE}-x ab12cd34ef56"
 *   Worked FAIL examples: "looks good, approved" (no token, arbiter-bait);
 *       "APPROVE-RUN {CLIENT_CODE}-x 0000" (wrong/short prefix).
 *   On mismatch the returned `reason` includes the EXACT phrase the operator
 *   should have typed (grounding adjustment #1 — legible scribe / sender's
 *   responsibility), not a silent block.
 *
 * ROLLBACK / ESCAPE HATCH (grounding adjustment #2):
 *   Enforcement is gated by the DEFAULT-OFF flag SMOS_ENFORCE_OPERATOR_STAMP
 *   (canonical home: tools/planning/lib/plan-review-state.js). Unset / empty ⇒
 *   enforcement disabled across A1 (userprompt gate), A2 (/run-plan) and D1
 *   (run-time re-verify). That env unset is the one-line rollback.
 *
 * This is a LIBRARY. It does NOT wire itself into /run-plan or any hook — that
 * is D1, which gates behind the Stage E distinct codex code review.
 */

const crypto = require('crypto');

const APPROVAL_TOKEN = 'APPROVE-RUN';
const MIN_SHA_PREFIX = 12;

// Friendly status-move approval path (operator drags the Dart card to this
// status + leaves an approve comment). Status string is the operator-chosen
// gesture; overridable per call but defaults to the live workspace value.
const APPROVED_TO_RUN_STATUS = 'Approved to Run';
const OPERATOR_EMAIL_ENV = 'SMOS_OPERATOR_APPROVAL_EMAIL';
const DEFAULT_OPERATOR_EMAIL = 'get@example-agency.com';
// F2 (Stage E repair): LINE-EXACT. The whole line must be exactly
// `APPROVE-RUN <plan_id> <hex-prefix(>=12)>` (only surrounding whitespace
// tolerated). Anchored ^…$ so instructional/discussion text that merely
// CONTAINS the token (prefixed OR suffixed) is NOT authority. The >=12 hex floor
// lives in the regex itself, so a short prefix can never be accepted.
const APPROVAL_LINE_RE = /^\s*APPROVE-RUN\s+(\S+)\s+([0-9a-fA-F]{12,64})\s*$/;

/**
 * Compute the canonical plan digest. Pure.
 *   - Buffer / string input  -> sha256 over the raw UTF-8 bytes (binds to the
 *     exact plan-file bytes; any edit changes the digest).
 *   - object input           -> sha256 over JSON.stringify(object).
 * @param {Buffer|string|Object} input
 * @returns {string} lowercase hex sha256
 */
function computePlanSha256(input) {
  let bytes;
  if (Buffer.isBuffer(input)) {
    bytes = input;
  } else if (typeof input === 'string') {
    bytes = Buffer.from(input, 'utf8');
  } else if (input && typeof input === 'object') {
    bytes = Buffer.from(JSON.stringify(input), 'utf8');
  } else {
    throw new Error('computePlanSha256: input must be a Buffer, string, or object');
  }
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * The exact literal the operator should comment to approve. Used for operator UX
 * AND for the legible-scribe guidance on a convention mismatch.
 * @param {string} planId
 * @param {string} planSha256
 * @returns {string}
 */
function buildApprovalConventionString(planId, planSha256) {
  return APPROVAL_TOKEN + ' ' + String(planId) + ' ' + String(planSha256).slice(0, MIN_SHA_PREFIX);
}

/**
 * Match a comment's text against the structured approval convention LITERALLY.
 * Deterministic pass/fail, NO natural-language judgment.
 *
 * @param {string} text
 * @param {string} planId
 * @param {string} planSha256
 * @returns {{ok:boolean, reason:string, guidance:string}}
 */
function matchApprovalConvention(text, planId, planSha256) {
  const guidance =
    'Comment exactly: "' + buildApprovalConventionString(planId, planSha256) + '" ' +
    '(the literal token ' + APPROVAL_TOKEN + ', the plan id, then the first ' +
    MIN_SHA_PREFIX + '+ hex chars of the current plan_sha256).';
  const sha = String(planSha256 || '').toLowerCase();
  const lines = String(text == null ? '' : text).split(/\r?\n/);

  for (const line of lines) {
    const m = APPROVAL_LINE_RE.exec(line);
    if (!m) continue; // not the exact authority line — instructional/other text.
    const citedPlanId = m[1];
    const citedPrefix = m[2].toLowerCase(); // regex guarantees >= 12 hex chars.
    if (citedPlanId !== String(planId)) {
      return {
        ok: false,
        reason: 'approval line names plan "' + citedPlanId + '" but this plan is "' + planId + '". ' + guidance,
        guidance
      };
    }
    if (!sha.startsWith(citedPrefix)) {
      return {
        ok: false,
        reason: 'approval plan_sha256 prefix "' + citedPrefix + '" is not a prefix of the current plan digest "' +
          sha.slice(0, MIN_SHA_PREFIX) + '…" — the plan was edited after approval; re-approve the current plan. ' + guidance,
        guidance
      };
    }
    return { ok: true, reason: 'approval convention matched literally', guidance };
  }

  return {
    ok: false,
    reason: 'no exact ' + APPROVAL_TOKEN + ' approval line found (a line CONTAINING the token amid other ' +
      'instructional/discussion text is NOT authority). ' + guidance,
    guidance
  };
}

/**
 * Does the comment carry a STRONG author identifier (duid or email)? A bare
 * display-name is NOT a strong identifier — it is spoofable (dart-api.js
 * normalizes a plain string author into authorName), so it can never be
 * authority. F3 (Stage E repair).
 *
 * @param {{authorDuid?:string, authorEmail?:string}} comment
 * @returns {boolean}
 */
function hasStrongAuthorId(comment) {
  return !!(comment && (comment.authorDuid || comment.authorEmail));
}

/**
 * Does a normalized comment's author match the allowlisted operator identity?
 * FAIL-CLOSED and F3-hardened: authority requires a positive match on a STRONG
 * identifier ONLY — duid (preferred) or email. Display-name is NEVER authority
 * (spoofable); it is retained on the normalized comment for DIAGNOSTICS only.
 *
 * @param {{authorDuid?:string, authorEmail?:string}} comment
 * @param {{duid?:string, email?:string}} operator
 * @returns {boolean}
 */
function authorMatchesOperator(comment, operator) {
  if (!comment || !operator) return false;
  const eq = (a, b) => a != null && b != null && String(a) === String(b);
  const ieq = (a, b) => a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  if (operator.duid && comment.authorDuid && eq(operator.duid, comment.authorDuid)) return true;
  if (operator.email && comment.authorEmail && ieq(operator.email, comment.authorEmail)) return true;
  return false;
}

function _describeOperator(op) {
  if (!op) return '(no operator identity supplied)';
  return op.duid || op.email || op.name || '(operator identity has no duid/email/name)';
}

function _describeAuthor(c) {
  if (!c) return '(unknown)';
  return c.authorDuid || c.authorEmail || c.authorName || '(comment carries no author identity)';
}

// ─────────────────────────────────────────────────────────────────────────────
// FRIENDLY APPROVAL PATH — Dart status-move + directory-resolved operator comment
//
// THREAT MODEL (mirror to concept): the un-forgeability of this path does NOT
// come from the strength of the author NAME string. Live Dart comments carry
// ONLY a display-name `author` (e.g. "Mythos" / "{OPERATOR_NAME}") — no email/duid — which
// is exactly why F3's bare name-compare was unsafe. What makes it safe HERE is
// that Dart SERVER-SETS the comment author from the AUTHENTICATED poster: the
// automation identity (singlemindedos / Mythos) literally cannot author a comment
// stamped with the operator's name. The workspace directory lookup only:
//   (1) maps that server-set name to a canonical account email, and
//   (2) guards against name COLLISION (require a UNIQUE directory match) and
//       SELF-APPROVAL (resolved email must NOT equal the automation identity,
//       and MUST equal the configured operator).
// The directory (dartConfig.assignees) and the automation identity
// (dartConfig.user.email) both come from the SAME authenticated getConfig() call,
// so an in-session agent cannot substitute a forged directory either.
//
// Operator identity is CONFIGURABLE via SMOS_OPERATOR_APPROVAL_EMAIL
// (default get@example-agency.com). FAIL-CLOSED throughout: unknown/ambiguous
// name, missing directory, wrong status, hash drift, or any Dart-unreachable
// condition denies (cannot verify ⇒ cannot approve).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configured operator approval email (the human gate identity). Configurable;
 * the automation (Mythos) identity comes separately from dartConfig.user.email.
 * @param {Object} [env=process.env]
 * @returns {string}
 */
function resolveOperatorEmail(env) {
  const v = String(((env || process.env)[OPERATOR_EMAIL_ENV]) || '').trim();
  return v || DEFAULT_OPERATOR_EMAIL;
}

/**
 * Map a server-set comment author NAME to a canonical workspace account via the
 * Dart directory. Requires EXACTLY ONE matching directory user (collision guard).
 *
 * @param {string} authorName
 * @param {Object} dartConfig - { user:{name,email}, assignees:[{name,email},...] }
 * @returns {{ok:boolean, email:string|null, reason:string}}
 */
function resolveAuthorToAccount(authorName, dartConfig) {
  // F3/Q3 (Stage E repair): match case-/whitespace-insensitively so a legit
  // operator is not failed-closed on casing or padding drift between the comment
  // `author` string and the directory `name`. The UNIQUE-match collision guard
  // is preserved — ANY ambiguity (>1 normalized match) still fails closed.
  const display = (typeof authorName === 'string') ? authorName.trim() : '';
  const norm = display.toLowerCase();
  if (!display) {
    return { ok: false, email: null, reason: 'comment carries no author name to resolve — fail closed' };
  }
  const assignees = (dartConfig && Array.isArray(dartConfig.assignees)) ? dartConfig.assignees : [];
  const matches = assignees.filter(
    (a) => a && typeof a.name === 'string' && a.name.trim().toLowerCase() === norm && a.email
  );
  if (matches.length === 0) {
    return { ok: false, email: null, reason: 'author "' + display + '" has 0 unique-email matches in the Dart workspace directory — unknown user, fail closed' };
  }
  if (matches.length > 1) {
    return { ok: false, email: null, reason: 'author "' + display + '" matches ' + matches.length + ' workspace directory users (ambiguous name collision) — fail closed' };
  }
  return { ok: true, email: String(matches[0].email).trim(), reason: 'directory-resolved "' + display + '" -> ' + matches[0].email };
}

/**
 * PRIMARY friendly path: verify approval via a Dart card status MOVE to
 * "Approved to Run" + an operator-authored comment (directory-resolved),
 * bound to the current plan_sha256.
 *
 * @param {Object} opts
 * @param {string} opts.planId
 * @param {string} opts.planSha256   - CURRENT plan digest (expected).
 * @param {string} [opts.boundSha256] - plan_sha256 snapshotted INTO the stamp at the approval gesture; drift guard compares it to planSha256.
 * @param {string} opts.dartTaskId
 * @param {Object} [opts.dartConfig] - directory + automation identity; or supply getConfig.
 * @param {Function} [opts.getConfig] - async () => dartConfig (injectable).
 * @param {Function} opts.getTask    - async (taskId) => { status, ... } (injectable).
 * @param {Function} opts.listComments - async (taskId) => comments payload (injectable).
 * @param {string} [opts.operatorEmail] - configured operator email (default resolveOperatorEmail()).
 * @param {string} [opts.approvedStatus] - default "Approved to Run".
 * @returns {Promise<{ok:boolean, reason:string, unreachable?:boolean, operatorComment?:Object}>}
 */
async function verifyViaDartStatus(opts = {}) {
  const planId = opts.planId;
  const planSha256 = opts.planSha256 ? String(opts.planSha256).toLowerCase() : null;
  const boundSha256 = opts.boundSha256 ? String(opts.boundSha256).toLowerCase() : null;
  const dartTaskId = opts.dartTaskId;
  const approvedStatus = opts.approvedStatus || APPROVED_TO_RUN_STATUS;
  const operatorEmail = String(opts.operatorEmail || resolveOperatorEmail()).trim().toLowerCase();

  if (!dartTaskId) return { ok: false, reason: 'no Dart task id supplied for the status-move approval path — fail closed' };
  if (!planSha256) return { ok: false, reason: 'cannot determine current plan_sha256 — fail closed' };
  if (typeof opts.getTask !== 'function' || typeof opts.listComments !== 'function') {
    return { ok: false, reason: 'Dart readers (getTask/listComments) not available — fail closed' };
  }

  // Directory + automation identity from the authenticated workspace config.
  //
  // D1-WIRING CONSTRAINT (Q4/F2 — NOT wired here, documented for the D1 step):
  // In production the directory (dartConfig) MUST be obtained from a LIVE,
  // authenticated dart-api.getConfig() call — never a caller- or marker-supplied
  // directory object — and getTask/listComments MUST be the real dart-api
  // methods, all under the G-COND-3 precondition (resident token == Mythos).
  // dartConfig/getConfig/getTask/listComments are injectable HERE ONLY for unit
  // tests; an agent-supplied directory would defeat the anti-self-approval guard,
  // so D1 must pass the live readers, not pass-through caller input.
  let dartConfig = opts.dartConfig;
  if (!dartConfig && typeof opts.getConfig === 'function') {
    try { dartConfig = await opts.getConfig(); }
    catch (e) { return { ok: false, reason: 'Dart getConfig unreachable (' + (e && e.message) + ') — fail closed', unreachable: true }; }
  }
  if (!dartConfig) return { ok: false, reason: 'no Dart workspace config/directory available — fail closed' };
  const automationEmail = String((dartConfig.user && dartConfig.user.email) || '').trim().toLowerCase();

  // (c) drift guard: the sha snapshotted at the approval gesture must equal the
  // current plan digest. No bound sha => cannot prove non-drift => fail closed.
  if (!boundSha256) {
    return { ok: false, reason: 'status-move approval is not bound to a plan_sha256 snapshot — cannot prove the approved plan matches the current plan (drift guard); fail closed' };
  }
  if (boundSha256 !== planSha256) {
    return { ok: false, reason: 'approved plan_sha256 "' + boundSha256.slice(0, 12) + '…" != current plan digest "' + planSha256.slice(0, 12) + '…" — plan edited after approval; re-approve' };
  }

  // The deliberate operator gesture: status MOVED to "Approved to Run".
  let task;
  try { task = await opts.getTask(dartTaskId); }
  catch (e) { return { ok: false, reason: 'Dart getTask unreachable (' + (e && e.message) + ') — fail closed', unreachable: true }; }
  const status = task && task.status;
  if (status !== approvedStatus) {
    return { ok: false, reason: 'Dart card status is "' + (status || '(none)') + '", not "' + approvedStatus + '" — not approved' };
  }

  // Un-forgeable authorship proof: an operator-authored comment on the card.
  let resp;
  try { resp = await opts.listComments(dartTaskId); }
  catch (e) { return { ok: false, reason: 'Dart listComments unreachable (' + (e && e.message) + ') — fail closed', unreachable: true }; }
  const dartApi = require('../../dart-integration/lib/dart-api');
  const comments = dartApi.extractCommentList(resp);

  let lastReason = 'no operator-authored comment found on the approved card — fail closed';
  for (const c of comments) {
    const authorName = (c && typeof c.author === 'string')
      ? c.author
      : (c && c.author && c.author.name) || (c && c.authorName) || null;
    const resolved = resolveAuthorToAccount(authorName, dartConfig);
    if (!resolved.ok) { lastReason = resolved.reason; continue; }
    const email = resolved.email.trim().toLowerCase();
    if (automationEmail && email === automationEmail) {
      // Anti-self-approval: the automation identity can never approve itself.
      lastReason = 'comment author "' + authorName + '" resolves to the AUTOMATION identity (' + automationEmail + ') — self-approval blocked';
      continue;
    }
    if (email !== operatorEmail) {
      lastReason = 'comment author "' + authorName + '" resolves to ' + resolved.email + ', not the configured operator (' + operatorEmail + ')';
      continue;
    }
    // F1 (Stage E repair): authorship + status are NOT enough. The operator
    // comment TEXT must be the exact deterministic approval line
    // (APPROVE-RUN <plan_id> <sha12>). Otherwise a stale/casual operator
    // "Approved" comment + a bot status-move would authorize. Binding the text
    // ties this approval to THIS plan version and to deliberate intent.
    const conv = matchApprovalConvention((c && (c.text || c.message || c.body)) || '', planId, planSha256);
    if (!conv.ok) {
      // Preserve the exact-phrase guidance (grounding #1) so the caller can
      // surface the line to paste.
      lastReason = 'operator-authored comment by "' + authorName + '" does NOT carry the exact approval line. ' + conv.reason;
      continue;
    }
    return {
      ok: true,
      reason: 'Dart status "' + approvedStatus + '" + operator-authored EXACT approval line ("' + authorName + '" -> ' + resolved.email + ' via workspace directory) verified; plan_sha256 bound',
      operatorComment: { commentId: (c && (c.id || c.commentId)) || null, author: authorName, email: resolved.email }
    };
  }
  return { ok: false, reason: lastReason };
}

/**
 * RE-VERIFY an operator approval. See module header for the full contract.
 *
 * @param {Object} opts
 * @param {string}  opts.planId
 * @param {string}  [opts.planSha256]   - expected plan digest; computed from planText when absent.
 * @param {Buffer|string|Object} [opts.planText] - plan source to compute the digest from.
 * @param {string}  [opts.taskId]       - Dart parent task id (Dart path).
 * @param {string}  [opts.citedCommentId] - comment id the operator_stamp points at (Dart path).
 * @param {Object}  [opts.operatorIdentity] - { duid?, email?, name? } allowlisted operator ({OPERATOR_NAME}).
 * @param {Object}  [opts.hmacStamp]    - marker.operator_stamp when it is an HMAC stamp (fallback proof).
 * @param {string|null} [opts.hmacSecret] - injectable secret; default resolved from on-device store.
 * @param {Object}  [opts.dartApi]      - injectable dart-api (default require). Needs getCommentAuthor.
 * @param {Object}  [opts.dartPrecondition] - result of assertDartIdentityPrecondition() (G-COND-3).
 * @param {Object}  [opts.statusApproval] - PRIMARY friendly path inputs:
 *   { dartTaskId, boundSha256|stamp, getTask, listComments, dartConfig|getConfig, approvedStatus? }.
 * @param {string}  [opts.operatorEmail] - configured operator email for the status path (default env/get@example-agency.com).
 * @returns {Promise<{verified:boolean, reason:string, mechanism:'dart-status'|'dart'|'hmac'|null, details:Object}>}
 */
async function verifyOperatorApproval(opts = {}) {
  const planId = opts.planId;
  if (!planId) {
    return { verified: false, reason: 'verifyOperatorApproval: planId is required (fail-closed)', mechanism: null, details: {} };
  }

  // (c) determine the expected plan digest.
  let expectedSha = opts.planSha256 ? String(opts.planSha256).toLowerCase() : null;
  if (!expectedSha) {
    if (opts.planText !== undefined && opts.planText !== null) {
      try { expectedSha = computePlanSha256(opts.planText); } catch (e) {
        return { verified: false, reason: 'could not compute plan_sha256: ' + e.message + ' (fail-closed)', mechanism: null, details: {} };
      }
    } else {
      return { verified: false, reason: 'cannot determine plan_sha256 (no planSha256/planText) — fail-closed', mechanism: null, details: {} };
    }
  }

  const details = { planId, planSha256: expectedSha };
  const forceFallback = !!(opts.dartPrecondition && opts.dartPrecondition.forceFallback);
  details.dartPathPermitted = !forceFallback;

  // ── Phase 0: Dart status-move + operator comment (PRIMARY friendly path) ──
  // Honors G-COND-3: forceFallback (resident token != Mythos) disables ALL Dart
  // paths, leaving only HMAC.
  let definitiveStatusFail = null;
  let statusUnreachable = false;
  const sa = opts.statusApproval;
  if (!forceFallback && sa && sa.dartTaskId) {
    const res = await verifyViaDartStatus({
      planId,
      planSha256: expectedSha,
      boundSha256: sa.boundSha256 || (sa.stamp && sa.stamp.plan_sha256) || null,
      dartTaskId: sa.dartTaskId,
      operatorEmail: opts.operatorEmail,
      approvedStatus: sa.approvedStatus,
      dartConfig: sa.dartConfig,
      getConfig: sa.getConfig,
      getTask: sa.getTask,
      listComments: sa.listComments
    });
    if (res.ok) {
      return {
        verified: true,
        reason: 'operator approval RE-VERIFIED via Dart status move: ' + res.reason,
        mechanism: 'dart-status',
        details: Object.assign(details, { dartTaskId: sa.dartTaskId, operatorComment: res.operatorComment })
      };
    }
    if (res.unreachable) statusUnreachable = true;
    else definitiveStatusFail = res.reason;
  }

  // ── Phase 1: typed APPROVE-RUN Dart comment (SECONDARY) ────────────────────
  let definitiveDartFail = null;
  let dartUnreachable = false;
  const dartInputsPresent = !!(opts.taskId && opts.citedCommentId && opts.operatorIdentity);

  if (!forceFallback && dartInputsPresent) {
    const dartApi = opts.dartApi || require('../../dart-integration/lib/dart-api');
    let comment = null;
    try {
      comment = await dartApi.getCommentAuthor(opts.taskId, opts.citedCommentId);
    } catch (e) {
      dartUnreachable = true;
      details.dartError = e && e.message ? e.message : String(e);
    }

    if (!dartUnreachable) {
      if (!comment) {
        // (a) cited comment does not exist — a forged/stale pointer.
        definitiveDartFail = 'cited approval comment "' + opts.citedCommentId + '" was not found on Dart task "' +
          opts.taskId + '" — a hand-written operator_stamp with no backing comment cannot approve';
      } else if (!hasStrongAuthorId(comment)) {
        // (a) F3: a bare display-name author is spoofable and is NEVER authority.
        definitiveDartFail = 'cited comment carries only a display-name author ("' +
          (comment.authorName || 'unknown') + '") with no duid or email — a strong identifier (duid or ' +
          'email) is REQUIRED for un-spoofable operator proof (display name is spoofable; ' +
          'pending live Dart author-field confirmation)';
      } else if (!authorMatchesOperator(comment, opts.operatorIdentity)) {
        // (a) authored by someone other than the operator (e.g. Mythos identity).
        definitiveDartFail = 'cited comment is authored by "' + _describeAuthor(comment) +
          '", not the allowlisted operator "' + _describeOperator(opts.operatorIdentity) + '" — not operator-authored';
      } else {
        // (b) + (c) convention + sha binding.
        const conv = matchApprovalConvention(comment.text, planId, expectedSha);
        if (!conv.ok) {
          definitiveDartFail = conv.reason; // includes the exact-phrase guidance (#1).
        } else {
          return {
            verified: true,
            reason: 'operator approval RE-VERIFIED via Dart authorship: comment "' + comment.commentId +
              '" authored by ' + _describeAuthor(comment) + ', convention matched, plan_sha256 bound',
            mechanism: 'dart',
            details: Object.assign(details, { commentId: comment.commentId, author: _describeAuthor(comment) })
          };
        }
      }
    }
  }

  // ── Phase 2: HMAC fallback (independent sufficient proof; the ONLY pass path
  //    when Dart is unreachable (G-COND-2) or forced off (G-COND-3)) ──────────
  let hmacReason = null;
  if (opts.hmacStamp && typeof opts.hmacStamp === 'object') {
    let stampLib;
    try { stampLib = require('../stamp-plan'); } catch (e) {
      hmacReason = 'could not load HMAC verifier: ' + e.message;
    }
    if (stampLib) {
      const secret = (opts.hmacSecret !== undefined)
        ? opts.hmacSecret
        : stampLib.resolveOperatorSecret();
      const res = stampLib.verifyHmacStamp(secret, opts.hmacStamp, { planId, planSha256: expectedSha });
      if (res.ok) {
        return {
          verified: true,
          reason: 'operator approval verified via HMAC fallback stamp (' + res.reason + ')',
          mechanism: 'hmac',
          details: Object.assign(details, { fallback: 'hmac' })
        };
      }
      hmacReason = res.reason;
    }
  }

  // ── Phase 3: DENY — fail-closed. Compose the most specific reason. ─────────
  // Primary (status) failure is surfaced first; then typed-comment; then
  // unreachable/forceFallback/HMAC.
  let reason;
  if (definitiveStatusFail) {
    reason = definitiveStatusFail +
      (definitiveDartFail ? ' (typed APPROVE-RUN path also failed: ' + definitiveDartFail + ')' : '') +
      (hmacReason ? ' (HMAC fallback also failed: ' + hmacReason + ')' : '');
  } else if (definitiveDartFail) {
    reason = definitiveDartFail + (hmacReason ? ' (HMAC fallback also failed: ' + hmacReason + ')' : '');
  } else if (statusUnreachable || dartUnreachable) {
    reason = 'Dart API unreachable (' + (details.dartError || 'status-path getConfig/getTask/listComments') + ') and no valid HMAC fallback stamp — ' +
      'FAIL-CLOSED (cannot verify ⇒ cannot approve)' + (hmacReason ? ': ' + hmacReason : '');
  } else if (forceFallback) {
    reason = (opts.dartPrecondition && opts.dartPrecondition.reason ? opts.dartPrecondition.reason : 'Dart-authorship path forced off (G-COND-3)') +
      ' — only a valid HMAC stamp can approve, and ' + (hmacReason ? 'it failed: ' + hmacReason : 'none was supplied');
  } else if (hmacReason) {
    reason = hmacReason;
  } else if (!dartInputsPresent) {
    reason = 'no operator approval proof supplied: need either a cited operator-authored Dart comment ' +
      '(taskId + citedCommentId + operatorIdentity) or a valid HMAC stamp — fail-closed';
  } else {
    reason = 'operator approval could not be verified (fail-closed)';
  }

  return { verified: false, reason, mechanism: null, details };
}

module.exports = {
  APPROVAL_TOKEN,
  MIN_SHA_PREFIX,
  APPROVED_TO_RUN_STATUS,
  OPERATOR_EMAIL_ENV,
  DEFAULT_OPERATOR_EMAIL,
  computePlanSha256,
  buildApprovalConventionString,
  matchApprovalConvention,
  authorMatchesOperator,
  hasStrongAuthorId,
  resolveOperatorEmail,
  resolveAuthorToAccount,
  verifyViaDartStatus,
  verifyOperatorApproval
};
