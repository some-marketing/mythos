'use strict';

/**
 * jurisdiction-data-ban-gate.js
 *
 * S3 of glm-5.2-hosted-mind-bridge-registration-and-jurisdiction-gate.
 *
 * PURPOSE
 *   A standalone, fail-closed decision LIBRARY. Given a dispatch TARGET
 *   descriptor and a dispatch PAYLOAD, decide whether routing that payload to
 *   that target is ALLOWED or BLOCKED by the cross-jurisdiction data ban.
 *
 *   The ban is narrow and mechanical:
 *     BLOCK iff  (target is PRC-jurisdiction)  AND  (S2 classifier flags the
 *               payload `sensitive`, which by S2's fail-closed contract already
 *               includes the `unknown` case).
 *   Anything that is not a PRC-jurisdiction target is OUTSIDE this gate's remit
 *   and is allowed here (other gates govern non-PRC egress). A non-sensitive
 *   payload to a PRC target is allowed.
 *
 * THREAT MODEL — this gate is a hard guardrail on an irreversible action.
 *   The GLM-5.2 bridge can route a dispatch payload to a PRC-hosted mind. Once a
 *   sensitive payload crosses that border it cannot be un-crossed. So this gate
 *   is FAIL-CLOSED in every direction:
 *     - target descriptor missing / garbled / not an object / no usable labels
 *       => treat as PRC-jurisdiction (cannot prove it is safe).
 *     - classifier throws / returns a non-boolean / garbled shape
 *       => treat the payload as sensitive.
 *     - jurisdiction cannot be determined for any reason => BLOCK.
 *   A false-block is a recoverable annoyance; a false-send is an irreversible
 *   cross-border leak. We always err toward BLOCK.
 *
 * OPERATOR EXCEPTION
 *   Only an explicit, structurally-valid exception overrides a block. It must:
 *     - be a plain object,
 *     - carry non-empty `approval_source`, `reason`, and `timestamp`,
 *     - name THIS target (by id/name) and THIS payload class (the sensitivity
 *       classes it is being granted against).
 *   A malformed / partial / mismatched exception does NOT override (fail-closed).
 *   When honored, the receipt is echoed in the return for the caller to log.
 *
 * ENFORCEMENT IS NOT GUARANTEED BY THIS FILE.
 *   This module is a PURE library: no I/O, no network, no egress, no disk
 *   writes (it does NOT persist the exception receipt — S4 owns the durable
 *   audit log). A library that is never called blocks nothing. The ACTUAL ban
 *   is only enforced when S4 wires `checkJurisdictionDataBan(...)` in front of
 *   every egress caller and refuses to dispatch on `allowed === false`. This
 *   file decides; S4 enforces.
 *
 * PUBLIC API
 *   checkJurisdictionDataBan({ target, payload, exception, classify }) -> {
 *     allowed:     boolean,       // false === BLOCKED
 *     reason:      string,        // machine-stable reason code
 *     sensitivity: object|null,   // the S2 result we acted on (or a synthesized
 *                                 // fail-closed stand-in), null when not evaluated
 *     prcJurisdiction: boolean,   // whether the target was treated as PRC
 *     exceptionReceipt?: object,  // echoed iff an exception overrode a block
 *   }
 */

const {
  classifyPayloadSensitivity,
} = require('./data-sensitivity-classifier.js');

// The label that marks a dispatch target as PRC-jurisdiction.
const PRC_LABEL = 'prc-origin-risk';

// Machine-stable reason codes.
const REASONS = Object.freeze({
  NON_PRC: 'allowed-non-prc-target',
  NOT_SENSITIVE: 'allowed-non-sensitive-payload-to-prc',
  BLOCKED_SENSITIVE: 'blocked-sensitive-payload-to-prc',
  BLOCKED_UNKNOWN_SENSITIVE: 'blocked-unknown-payload-to-prc-fail-closed',
  BLOCKED_GARBLED_TARGET: 'blocked-garbled-target-fail-closed',
  BLOCKED_CLASSIFIER_THREW: 'blocked-classifier-threw-fail-closed',
  EXCEPTION_APPLIED: 'operator-exception-applied',
});

// ---------------------------------------------------------------------------
// Target jurisdiction determination — FAIL-CLOSED.
//   Returns { prc: boolean, garbled: boolean }.
//   `garbled` is true when the descriptor is missing / not an object / has no
//   usable labels array; in that case `prc` is forced true (cannot prove safe).
// ---------------------------------------------------------------------------
function isPrcJurisdiction(target) {
  // Missing / non-object descriptor => cannot prove it is non-PRC => treat PRC.
  if (target == null || typeof target !== 'object' || Array.isArray(target)) {
    return { prc: true, garbled: true };
  }
  const labels = target.labels;
  // No labels array at all => jurisdiction undeterminable => treat PRC.
  if (!Array.isArray(labels)) {
    return { prc: true, garbled: true };
  }
  // A label entry that is not a string is a garbled descriptor => fail-closed.
  let sawNonString = false;
  let hasPrc = false;
  for (const l of labels) {
    if (typeof l !== 'string') {
      sawNonString = true;
      continue;
    }
    if (l.trim().toLowerCase() === PRC_LABEL) hasPrc = true;
  }
  if (sawNonString) {
    // Descriptor is structurally untrustworthy => treat as PRC, fail-closed.
    return { prc: true, garbled: true };
  }
  return { prc: hasPrc, garbled: false };
}

// ---------------------------------------------------------------------------
// Sensitivity evaluation — FAIL-CLOSED around the injected classifier.
//   Any throw, or any non-boolean `sensitive`, collapses to sensitive=true.
//   Returns { result, sensitive, threw }.
// ---------------------------------------------------------------------------
function evaluateSensitivity(payload, classify) {
  const fn = typeof classify === 'function' ? classify : classifyPayloadSensitivity;
  let result;
  try {
    result = fn(payload);
  } catch (err) {
    return {
      result: {
        sensitive: true,
        unknown: true,
        tripped: [{
          predicate: 'classifier_threw',
          evidence: 'classifier threw: ' + (err && err.message ? err.message : String(err)),
        }],
      },
      sensitive: true,
      threw: true,
    };
  }
  // Garbled classifier output (null / no boolean `sensitive`) => fail-closed.
  if (!result || typeof result !== 'object' || typeof result.sensitive !== 'boolean') {
    return {
      result: {
        sensitive: true,
        unknown: true,
        tripped: [{
          predicate: 'classifier_garbled_output',
          evidence: 'classifier returned a non-{sensitive:boolean} shape — fail-closed',
        }],
        rawClassifierOutput: result,
      },
      sensitive: true,
      threw: false,
    };
  }
  return { result, sensitive: result.sensitive === true, threw: false };
}

// ---------------------------------------------------------------------------
// Operator exception validation — FAIL-CLOSED.
//   An exception overrides a block ONLY when it is a plain object carrying
//   non-empty approval_source / reason / timestamp AND it explicitly names this
//   target and this payload class. Anything partial / malformed / mismatched is
//   rejected (does not override).
//   Returns { valid: boolean, reason?: string }.
// ---------------------------------------------------------------------------
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Pull a stable identity for a target descriptor for exception-matching. */
function targetIdentity(target) {
  if (target == null || typeof target !== 'object') return null;
  return (
    (nonEmptyString(target.id) && target.id.trim()) ||
    (nonEmptyString(target.name) && target.name.trim()) ||
    (nonEmptyString(target.target) && target.target.trim()) ||
    null
  );
}

function validateException(exception, target, sensitivityClasses) {
  if (exception == null || typeof exception !== 'object' || Array.isArray(exception)) {
    return { valid: false, reason: 'exception-not-an-object' };
  }
  if (!nonEmptyString(exception.approval_source)) {
    return { valid: false, reason: 'exception-missing-approval_source' };
  }
  if (!nonEmptyString(exception.reason)) {
    return { valid: false, reason: 'exception-missing-reason' };
  }
  if (!nonEmptyString(exception.timestamp)) {
    return { valid: false, reason: 'exception-missing-timestamp' };
  }

  // Must NAME this target. Accept `target` / `target_id` / `target_name` fields.
  const namedTarget =
    (nonEmptyString(exception.target) && exception.target.trim()) ||
    (nonEmptyString(exception.target_id) && exception.target_id.trim()) ||
    (nonEmptyString(exception.target_name) && exception.target_name.trim()) ||
    null;
  if (!namedTarget) {
    return { valid: false, reason: 'exception-does-not-name-a-target' };
  }
  const identity = targetIdentity(target);
  if (!identity || namedTarget !== identity) {
    return { valid: false, reason: 'exception-target-mismatch' };
  }

  // Must NAME this payload class. Accept a string or array of strings under
  // `payload_class` / `payload_classes`. The exception must cover EVERY
  // sensitivity class the payload tripped (fail-closed: a partial grant that
  // does not cover all tripped classes does NOT override).
  const rawClasses =
    exception.payload_classes != null ? exception.payload_classes : exception.payload_class;
  let grantedClasses = [];
  if (nonEmptyString(rawClasses)) {
    grantedClasses = [rawClasses.trim()];
  } else if (Array.isArray(rawClasses)) {
    grantedClasses = rawClasses.filter(nonEmptyString).map((s) => s.trim());
  } else {
    return { valid: false, reason: 'exception-does-not-name-a-payload-class' };
  }
  if (grantedClasses.length === 0) {
    return { valid: false, reason: 'exception-does-not-name-a-payload-class' };
  }

  // If we know which classes tripped, the grant must cover all of them.
  // (`unknown` from a fail-closed classifier surfaces as a sentinel class.)
  const required = Array.isArray(sensitivityClasses) ? sensitivityClasses : [];
  const granted = new Set(grantedClasses);
  // A wildcard grant covers everything.
  if (!granted.has('*') && !granted.has('all')) {
    for (const c of required) {
      if (!granted.has(c)) {
        return { valid: false, reason: 'exception-does-not-cover-class:' + c };
      }
    }
  }

  return { valid: true };
}

/** Extract the tripped sensitivity class names from an S2-shaped result. */
function sensitivityClassesOf(sensResult) {
  if (!sensResult || typeof sensResult !== 'object') return [];
  const tripped = Array.isArray(sensResult.tripped) ? sensResult.tripped : [];
  const classes = tripped
    .map((t) => (t && nonEmptyString(t.predicate) ? t.predicate.trim() : null))
    .filter(Boolean);
  // De-dup, preserve order.
  return Array.from(new Set(classes));
}

// ---------------------------------------------------------------------------
// Public entrypoint.
// ---------------------------------------------------------------------------

/**
 * checkJurisdictionDataBan — the S3 gate decision. FAIL-CLOSED.
 *
 * @param {object}   args
 * @param {object}   args.target     dispatch-target descriptor ({ labels: [...] }).
 * @param {*}        args.payload    dispatch payload (passed verbatim to S2).
 * @param {object}  [args.exception] explicit operator exception (optional).
 * @param {Function}[args.classify]  injected classifier (defaults to S2). Tests
 *                                   mock this; production omits it.
 * @returns {{allowed:boolean, reason:string, sensitivity:(object|null),
 *           prcJurisdiction:boolean, exceptionReceipt?:object}}
 */
function checkJurisdictionDataBan(args) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  const { target, payload, exception, classify } = safeArgs;

  // 1) TARGET VALIDITY FIRST (fail-closed, UNCONDITIONAL). If the descriptor is
  //    missing / non-object / has no usable labels array / carries a non-string
  //    label, the jurisdiction is UNDETERMINABLE — we cannot prove the target is
  //    safe, so we BLOCK regardless of payload sensitivity. This MUST precede any
  //    allow branch: a garbled target must NEVER reach an allow, even with a
  //    plainly non-sensitive payload. (codex S3 review — fail-closed ordering bug:
  //    the previous order let a garbled target + non-sensitive payload slip
  //    through as allowed.) An operator exception does NOT rescue a garbled
  //    target — if the descriptor is untrustworthy we cannot trust that an
  //    exception's named target matches the (unknowable) real jurisdiction.
  const { prc, garbled } = isPrcJurisdiction(target);
  if (garbled) {
    return {
      allowed: false,
      reason: REASONS.BLOCKED_GARBLED_TARGET,
      sensitivity: null, // not evaluated — the target descriptor is untrustworthy.
      prcJurisdiction: true, // treated as PRC; cannot prove otherwise.
    };
  }

  // 2) Well-formed but non-PRC target => outside this gate's remit => allowed.
  if (!prc) {
    return {
      allowed: true,
      reason: REASONS.NON_PRC,
      sensitivity: null, // not evaluated — this gate only governs PRC egress.
      prcJurisdiction: false,
    };
  }

  // 3) Well-formed PRC target — evaluate sensitivity (fail-closed around the
  //    classifier).
  const sens = evaluateSensitivity(payload, classify);

  // Non-sensitive payload to a (well-formed) PRC target => allowed.
  if (!sens.sensitive) {
    return {
      allowed: true,
      reason: REASONS.NOT_SENSITIVE,
      sensitivity: sens.result,
      prcJurisdiction: true,
    };
  }

  // 4) BLOCKED by default. Determine the precise block reason for the audit
  //    trail, then see whether a valid operator exception overrides it. (The
  //    garbled-target case has already returned above and cannot reach here.)
  let blockReason;
  if (sens.threw) {
    blockReason = REASONS.BLOCKED_CLASSIFIER_THREW;
  } else if (sens.result && sens.result.unknown === true) {
    blockReason = REASONS.BLOCKED_UNKNOWN_SENSITIVE;
  } else {
    blockReason = REASONS.BLOCKED_SENSITIVE;
  }

  // 5) Operator exception override (only an explicit, structurally-valid,
  //    target+class-matching exception overrides).
  const classes = sensitivityClassesOf(sens.result);
  const exc = validateException(exception, target, classes);
  if (exc.valid) {
    return {
      allowed: true,
      reason: REASONS.EXCEPTION_APPLIED,
      sensitivity: sens.result,
      prcJurisdiction: true,
      exceptionReceipt: {
        approval_source: exception.approval_source,
        reason: exception.reason,
        timestamp: exception.timestamp,
        overrides: blockReason,
        granted_classes:
          exception.payload_classes != null
            ? exception.payload_classes
            : exception.payload_class,
        target: targetIdentity(target),
        // NOTE: this gate does NOT persist this receipt. S4 owns the durable
        // audit log; the caller must record it.
      },
    };
  }

  // 6) No valid override => BLOCK (fail-closed).
  return {
    allowed: false,
    reason: blockReason,
    sensitivity: sens.result,
    prcJurisdiction: true,
    exceptionRejected: exception != null ? exc.reason : undefined,
  };
}

module.exports = {
  checkJurisdictionDataBan,
  // Internals exposed for white-box tests.
  isPrcJurisdiction,
  evaluateSensitivity,
  validateException,
  sensitivityClassesOf,
  targetIdentity,
  PRC_LABEL,
  REASONS,
};
