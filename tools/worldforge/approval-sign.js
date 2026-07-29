#!/usr/bin/env node
/**
 * approval-sign.js
 *
 * ============================================================================
 * Operator-held per-hash signing that closes the "approval is forgeable"
 * hole in a spec-approval pipeline. Approval entries carry an HMAC-SHA256
 * signature over the SPECIFIC closure hash they approve, computed with a key
 * that lives ONLY in the operator's secret store (OS keychain, secrets
 * manager, etc.). verifyApproval recomputes the HMAC and compares. A repo
 * write can no longer mint approval: without the operator's key you cannot
 * produce a valid signature.
 * ============================================================================
 *
 * THE HOLE ("approval is forgeable"):
 *   A naive approval checker trusts a PLAIN repo JSON file. Anyone who can
 *   write the repo could add an `{ approved: true }` entry and mint approval —
 *   no operator involvement required. A repo write == an approval.
 *
 * THE CLOSE (per-hash operator-held signature):
 *   Each approval entry carries an HMAC-SHA256 signature over the SPECIFIC
 *   closure hash it approves. Binding the signature to the exact closureHash
 *   makes it NON-REPLAYABLE — a signature for spec A's hash fails verification
 *   against spec B's hash (one approval = one hash = one operator act).
 *
 * TARGET BINDING (worldforge-approval/2.0):
 *   The v2 signature subject additionally binds the NORMALIZED destination
 *   project-dir into the signed message: subject + closureHash + normalized
 *   target. Tampering with the destination (importing an approved spec into a
 *   different project than the operator signed for) changes the bound message,
 *   so the HMAC no longer verifies. This closes a target-agnostic approval
 *   defect: an approval is cryptographically bound to WHERE it may be
 *   written, not only to WHAT bytes are written.
 *
 * ---------------------------------------------------------------------------
 * KEY STORE — where the REAL key lives (FAIL CLOSED, no fallback):
 *   The real signing key is a high-entropy secret held ONLY in the operator's
 *   secret store, never in the repo, never in a dotfile. A runner obtains it
 *   into WORLDFORGE_APPROVAL_HMAC_KEY at SIGN time (operator approving) and at
 *   VERIFY time (active import) from whatever secret store the deployment
 *   uses (OS keychain, a secrets manager, etc.).
 *
 *   approval-sign.js itself NEVER shells out to a secret store — it only reads
 *   the key from the environment the runner prepared. When that key is
 *   absent, inaccessible, or the process is non-interactive, getSigningKey()
 *   FAILS CLOSED: it throws with a clear diagnostic and provides NO plaintext,
 *   .env, TEST-key, or any other fallback. The ONLY escape hatch is an
 *   explicit `{ allowTestKey: true }` opt-in used by unit tests to exercise
 *   the signing math; it is never reachable from a real approval path. The
 *   retrieved key MUST NOT be logged, echoed, or written to an artifact.
 * ---------------------------------------------------------------------------
 *
 * API:
 *   getSigningKey(opts) -> Buffer         (fail-closed unless env key present or opts.allowTestKey)
 *   signApproval(closureHash, key) -> v1 record fields (subject worldforge-approval/1.0)
 *   verifyApproval(entry, key) -> { valid, reason }              (v1)
 *   signApprovalV2(closureHash, target, key) -> v2 record fields (target-bound)
 *   verifyApprovalV2(entry, key) -> { valid, reason }            (v2)
 *   verifyRecord(record, key[, opts]) -> { valid, reason }       (dispatches by subject)
 *   verifiesUnderTestKey(record) -> boolean                      (published TEST key detector)
 *   normalizeTarget(target) -> string                            (canonical destination form)
 *   buildApprovalEntry(closureHash, key, meta) -> v1 signed record
 *   buildApprovalEntryV2(closureHash, target, key, meta) -> v2 target-bound record
 *   PUBLISHED_TEST_KEY -> string                                 (the well-known, rejected test key)
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

const APPROVAL_SUBJECT = 'worldforge-approval/1.0';
const APPROVAL_SUBJECT_V2 = 'worldforge-approval/2.0';
const SIGNATURE_ALG = 'HMAC-SHA256';

// The well-known, PUBLISHED test key. It is intentionally public so checkers can
// detect and REJECT any approval that verifies under it. It is NEVER a valid
// real approval key.
const PUBLISHED_TEST_KEY = 'MOCK-TEST-KEY-do-not-use-for-real-approvals';

const ENV_KEY_NAME = 'WORLDFORGE_APPROVAL_HMAC_KEY';

/**
 * Real signing-key source. FAIL CLOSED by default.
 *
 *   1. If the runner placed the secret-store-backed key in
 *      WORLDFORGE_APPROVAL_HMAC_KEY, use it. This is the ONLY real-approval path.
 *   2. Else, if the caller passes { allowTestKey: true } — the explicit test-only
 *      escape hatch used by unit tests — return a clearly-labelled test key
 *      (the published one by default, or opts.testKey). This never runs from a
 *      real approval path.
 *   3. Otherwise THROW: no plaintext, .env, mock, or any other fallback. A
 *      missing/inaccessible/locked/non-interactive key is a hard, diagnostic,
 *      non-zero-exit failure.
 *
 * The key bytes are never logged, echoed, or returned in a diagnostic.
 */
function getSigningKey(opts = {}) {
  const fromEnv = process.env[ENV_KEY_NAME];
  if (fromEnv && fromEnv.length > 0) {
    return Buffer.from(fromEnv, 'utf8');
  }
  if (opts && opts.allowTestKey === true) {
    const testKey = typeof opts.testKey === 'string' && opts.testKey.length > 0
      ? opts.testKey
      : PUBLISHED_TEST_KEY;
    return Buffer.from(testKey, 'utf8');
  }
  const err = new Error(
    `approval-sign: real approval signing key unavailable. Set ${ENV_KEY_NAME} from the ` +
    'operator secret store before signing or verifying an active approval. FAIL CLOSED: no ' +
    'plaintext, .env, TEST-key, or other fallback key is used. (Unit tests must pass ' +
    '{ allowTestKey: true } explicitly.)'
  );
  err.code = 'NO_SIGNING_KEY';
  throw err;
}

/**
 * v1 bound message: subject label + the specific closure hash. A signature is
 * bound to ONE hash and cannot be replayed onto another spec's hash.
 */
function boundMessage(closureHash) {
  if (typeof closureHash !== 'string' || !/^[a-f0-9]{64}$/.test(closureHash)) {
    throw new Error('approval-sign: closureHash must be a 64-char lowercase hex sha256');
  }
  return `${APPROVAL_SUBJECT}\n${closureHash}`;
}

/**
 * Canonical destination form. Approval target binding must be stable and
 * tamper-evident: resolve to an absolute path, use forward slashes, and drop a
 * trailing slash. Two paths that denote the same destination normalize equal;
 * two that denote different destinations normalize differently, so a signature
 * over one does not verify for the other.
 */
function normalizeTarget(target) {
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new Error('approval-sign: target must be a non-empty destination path string');
  }
  const resolved = path.resolve(target.trim());
  const posix = resolved.split(path.sep).join('/');
  return posix.length > 1 && posix.endsWith('/') ? posix.slice(0, -1) : posix;
}

/**
 * v2 bound message: subject label + closure hash + normalized destination. The
 * signature is bound to WHAT bytes AND WHERE they may land.
 */
function boundMessageV2(closureHash, target) {
  if (typeof closureHash !== 'string' || !/^[a-f0-9]{64}$/.test(closureHash)) {
    throw new Error('approval-sign: closureHash must be a 64-char lowercase hex sha256');
  }
  return `${APPROVAL_SUBJECT_V2}\n${closureHash}\n${normalizeTarget(target)}`;
}

function hmacHex(key, message) {
  return crypto.createHmac('sha256', key).update(Buffer.from(message, 'utf8')).digest('hex');
}

function signApproval(closureHash, key) {
  const signature = hmacHex(key, boundMessage(closureHash));
  return {
    alg: SIGNATURE_ALG,
    subject: APPROVAL_SUBJECT,
    closureHash,
    signature,
  };
}

function signApprovalV2(closureHash, target, key) {
  const normalizedTarget = normalizeTarget(target);
  const signature = hmacHex(key, boundMessageV2(closureHash, normalizedTarget));
  return {
    alg: SIGNATURE_ALG,
    subject: APPROVAL_SUBJECT_V2,
    closureHash,
    target: normalizedTarget,
    signature,
  };
}

/** Timing-safe compare of a candidate hex signature against an expected hex. */
function safeEqualHex(candidate, expected) {
  if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate)) {
    return false;
  }
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * v1 verify: recompute the HMAC over entry.closureHash and timing-safe compare
 * to entry.signature. Fails closed on any missing/malformed field.
 */
function verifyApproval(entry, key) {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, reason: 'no_entry' };
  }
  if (entry.alg !== SIGNATURE_ALG) {
    return { valid: false, reason: 'unexpected_or_missing_alg' };
  }
  if (typeof entry.signature !== 'string' || !/^[a-f0-9]{64}$/.test(entry.signature)) {
    return { valid: false, reason: 'missing_or_malformed_signature' };
  }
  let expected;
  try {
    expected = hmacHex(key, boundMessage(entry.closureHash));
  } catch (err) {
    return { valid: false, reason: `bad_closure_hash: ${err.message}` };
  }
  const ok = safeEqualHex(entry.signature, expected);
  return {
    valid: ok,
    reason: ok ? 'valid_operator_signature' : 'signature_mismatch',
  };
}

/**
 * v2 verify: recompute the HMAC over subject + closureHash + normalized target.
 * A missing target, or a target that differs from the one the operator signed,
 * fails closed.
 */
function verifyApprovalV2(entry, key) {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, reason: 'no_entry' };
  }
  if (entry.alg !== SIGNATURE_ALG) {
    return { valid: false, reason: 'unexpected_or_missing_alg' };
  }
  if (typeof entry.signature !== 'string' || !/^[a-f0-9]{64}$/.test(entry.signature)) {
    return { valid: false, reason: 'missing_or_malformed_signature' };
  }
  let expected;
  try {
    expected = hmacHex(key, boundMessageV2(entry.closureHash, entry.target));
  } catch (err) {
    return { valid: false, reason: `bad_bound_message: ${err.message}` };
  }
  const ok = safeEqualHex(entry.signature, expected);
  return {
    valid: ok,
    reason: ok ? 'valid_target_bound_operator_signature' : 'signature_mismatch',
  };
}

/**
 * Convenience: assemble a complete v1 signed approval record from a closure hash.
 */
function buildApprovalEntry(closureHash, key, meta = {}) {
  const { signature, alg, subject } = signApproval(closureHash, key);
  return {
    schema: 'world-spec-closure-approval/1.0',
    closureHash,
    approved: true,
    approved_by: meta.approvedBy || 'operator',
    approved_at: meta.approvedAt || new Date().toISOString(),
    approval_basis: meta.basis || null,
    diff_summary_artifact: meta.diffSummaryArtifact || null,
    signature: { alg, subject, value: signature },
    // Flattened mirror kept in sync so verifyApproval can consume the entry
    // directly (alg + signature at top level).
    alg,
    subject,
  };
}

/**
 * Convenience: assemble a complete v2 (target-bound) signed approval record.
 */
function buildApprovalEntryV2(closureHash, target, key, meta = {}) {
  const { signature, alg, subject, target: normalizedTarget } = signApprovalV2(closureHash, target, key);
  return {
    schema: 'world-spec-closure-approval/2.0',
    closureHash,
    target: normalizedTarget,
    approved: true,
    approved_by: meta.approvedBy || 'operator',
    approved_at: meta.approvedAt || new Date().toISOString(),
    approval_basis: meta.basis || null,
    diff_summary_artifact: meta.diffSummaryArtifact || null,
    signature: { alg, subject, target: normalizedTarget, value: signature },
    // Flattened mirror kept in sync so verify can consume the entry directly.
    alg,
    subject,
  };
}

/**
 * Normalize a record's (possibly nested) signature into the flat shape the
 * verifiers consume. Records built by buildApprovalEntry* nest the signature
 * under `signature.value`; a raw entry carries `signature` at the top level.
 * Returns { alg, subject, closureHash, target, signature } or null.
 */
function flattenRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.signature && typeof record.signature === 'object') {
    return {
      alg: record.signature.alg,
      subject: record.signature.subject || record.subject,
      closureHash: record.closureHash,
      target: record.signature.target || record.target,
      signature: record.signature.value,
    };
  }
  if (typeof record.signature === 'string') {
    return {
      alg: record.alg,
      subject: record.subject,
      closureHash: record.closureHash,
      target: record.target,
      signature: record.signature,
    };
  }
  return null;
}

/**
 * Verify a record (v1 or v2) under a given key. Dispatches on the signature
 * subject: v2 records are target-bound and require target verification; v1
 * records use the closure-hash-only bound message.
 *
 * For a v2 record, an optional opts.expectedTarget cross-checks the requested
 * destination against the target the operator actually signed — a mismatch is a
 * hard fail even if the record's self-declared target signature is internally
 * valid.
 */
function verifyRecord(record, key, opts = {}) {
  const flat = flattenRecord(record);
  if (!flat) return { valid: false, reason: 'no_signature' };

  const isV2 = flat.subject === APPROVAL_SUBJECT_V2 || (flat.target != null && flat.subject !== APPROVAL_SUBJECT);
  if (isV2) {
    if (opts && typeof opts.expectedTarget === 'string' && opts.expectedTarget.length > 0) {
      let normalizedExpected;
      let normalizedRecord;
      try {
        normalizedExpected = normalizeTarget(opts.expectedTarget);
        normalizedRecord = normalizeTarget(flat.target);
      } catch (err) {
        return { valid: false, reason: `bad_target: ${err.message}` };
      }
      if (normalizedExpected !== normalizedRecord) {
        return { valid: false, reason: 'target_mismatch' };
      }
    }
    return verifyApprovalV2(flat, key);
  }
  return verifyApproval(flat, key);
}

/**
 * Does this record verify under the PUBLISHED test key? Any record for which
 * this returns true was signed with the well-known test key and MUST be rejected
 * for active use — it proves nothing about operator intent because anyone can
 * produce it. Checks both the v1 and v2 bound messages so a forged record cannot
 * dodge detection by claiming the other subject.
 */
function verifiesUnderTestKey(record) {
  const flat = flattenRecord(record);
  if (!flat) return false;
  const testKey = Buffer.from(PUBLISHED_TEST_KEY, 'utf8');
  if (verifyApproval(flat, testKey).valid) return true;
  if (flat.target != null && verifyApprovalV2(flat, testKey).valid) return true;
  return false;
}

module.exports = {
  APPROVAL_SUBJECT,
  APPROVAL_SUBJECT_V2,
  SIGNATURE_ALG,
  PUBLISHED_TEST_KEY,
  ENV_KEY_NAME,
  getSigningKey,
  normalizeTarget,
  signApproval,
  verifyApproval,
  signApprovalV2,
  verifyApprovalV2,
  verifyRecord,
  flattenRecord,
  verifiesUnderTestKey,
  buildApprovalEntry,
  buildApprovalEntryV2,
};

// ---------------------------------------------------------------------------
// CLI: node approval-sign.js sign <closureHash> [--target <dir>]
//      node approval-sign.js verify <closureHash> <signature> [--target <dir>]
//
// FAIL CLOSED: requires the real key in WORLDFORGE_APPROVAL_HMAC_KEY, or an
// explicit --test-key for local/dev exercise (never a real approval). NEVER
// prints key material.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const positionals = [];
  let target = null;
  let allowTestKey = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) target = argv[++i];
    else if (argv[i] === '--test-key') allowTestKey = true;
    else positionals.push(argv[i]);
  }

  let key;
  try {
    key = getSigningKey({ allowTestKey });
  } catch (err) {
    console.error(`[approval-sign] ${err.message}`);
    process.exit(1);
  }

  if (cmd === 'sign' && positionals[0]) {
    const out = target
      ? signApprovalV2(positionals[0], target, key)
      : signApproval(positionals[0], key);
    console.log(JSON.stringify(out, null, 2));
  } else if (cmd === 'verify' && positionals[0] && positionals[1]) {
    const entry = target
      ? { alg: SIGNATURE_ALG, subject: APPROVAL_SUBJECT_V2, closureHash: positionals[0], target, signature: positionals[1] }
      : { alg: SIGNATURE_ALG, subject: APPROVAL_SUBJECT, closureHash: positionals[0], signature: positionals[1] };
    const res = target ? verifyApprovalV2(entry, key) : verifyApproval(entry, key);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.valid ? 0 : 1);
  } else {
    console.error('Usage: node approval-sign.js sign <closureHash> [--target <dir>] [--test-key]');
    console.error('       node approval-sign.js verify <closureHash> <signature> [--target <dir>] [--test-key]');
    process.exit(2);
  }
}
