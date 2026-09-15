'use strict';

/**
 * stamp-mac.cjs — Keychain-backed HMAC primitives for RemoteMutationStamp/1.0.
 *
 * Codex PR #20 review finding F1: before this module, a RemoteMutationStamp
 * was an unauthenticated JSON file. Both the stamp sidecar
 * (_dev/state/remote-mutation-stamps/*.json) and its referenced source_doc
 * (_dev/reports/analysis/g-remote-mutation-*.md) live outside the governance
 * perimeter (PROTECTED_PREFIXES in tools/verify/hooks/pre-write-convene-required.cjs) --
 * any agent session could write both files itself and self-grant a remote-
 * mutation stamp. Stamps are now MAC'd with the SAME on-device secret and
 * timing-safe discipline already used for ConveneReceipt/1.0
 * (tools/verify/hooks/lib/receipt-mac.cjs) and operator plan stamps
 * (tools/planning/stamp-plan.js) -- one shared Keychain-backed secret, three
 * domain-separated uses.
 *
 * CANONICALIZATION: unlike receipt-mac.cjs's selective-field message (a
 * receipt only needs its OWN identity fields bound), a stamp MAC covers the
 * ENTIRE stamp object minus the mac field itself -- via
 * tools/ticktock/canonical.cjs's canonicalize(), the same deterministic
 * sorted-key projection journal.cjs already uses for record_hash/anchor_hash.
 * This means ANY post-mint edit to ANY field (scope, voided, superseded_by,
 * expires_at, conditions, source_doc, operator_authorization -- not just an
 * enumerated subset) invalidates the MAC. An operator killing a stamp can
 * still just hand-edit voided:true -- the edit breaks the MAC, the stamp
 * reads as invalid either way, and an agent flipping voided back to false
 * cannot resurrect a valid MAC. No separate signed-revocation flow is needed.
 *
 * DOMAIN SEPARATION: the MAC message carries an explicit 'RemoteMutationStamp/1.0'
 * domain line, so a stamp MAC can never be replayed as a ConveneReceipt MAC
 * or an operator plan stamp (and vice versa) even though all three are
 * computed under the same Keychain secret.
 *
 * FAIL-CLOSED: no secret resolvable => no stamp MAC can be verified => every
 * stamp reads as invalid => every remote-mutating Bash command is denied. A
 * verifier that cannot check a MAC must not pretend the MAC was fine.
 */

const crypto = require('crypto');
const path = require('path');
const { canonicalize } = require('../../../ticktock/canonical.cjs');

const STAMP_MAC_MECHANISM = 'hmac-sha256';
const STAMP_MAC_DOMAIN = 'RemoteMutationStamp/1.0';

/**
 * Canonical message bound by a stamp MAC: the domain line, then the
 * canonicalized JSON projection of the whole stamp object with the `mac`
 * field (and only that field) excluded. Excluding `mac` is required --
 * a document cannot bind the hash of itself including that hash.
 *
 * @param {Object} stamp
 * @returns {string}
 */
function canonicalStampMessage(stamp) {
  if (!stamp || typeof stamp !== 'object') {
    throw new Error('canonicalStampMessage: stamp must be an object');
  }
  const projection = {};
  for (const k of Object.keys(stamp)) {
    if (k === 'mac') continue;
    if (stamp[k] === undefined) continue;
    projection[k] = stamp[k];
  }
  return STAMP_MAC_DOMAIN + '\n' + canonicalize(projection);
}

/**
 * Compute the HMAC-SHA256 over the canonical stamp message. Pure.
 * @param {string} secret
 * @param {Object} stamp
 * @returns {string} lowercase hex digest
 */
function computeStampMac(secret, stamp) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('computeStampMac: a non-empty operator secret is required');
  }
  return crypto.createHmac('sha256', secret).update(canonicalStampMessage(stamp), 'utf8').digest('hex');
}

/**
 * Attach a MAC to a stamp object in place and return it.
 * @param {string} secret
 * @param {Object} stamp
 * @returns {Object}
 */
function signStamp(secret, stamp) {
  stamp.mac = {
    mechanism: STAMP_MAC_MECHANISM,
    domain: STAMP_MAC_DOMAIN,
    value: computeStampMac(secret, stamp)
  };
  return stamp;
}

/**
 * Verify a stamp MAC. RECOMPUTES over the stamp's OWN current content and
 * timing-safe compares; never trusts the stored value as authority. The
 * caller must pass the EXACT object that was read from disk -- verifying a
 * mutated in-memory copy (e.g. one carrying extra caller-added fields not
 * present at mint time) will legitimately fail; strip caller-added fields
 * before calling this, do not add them and expect verification to ignore
 * them.
 *
 * @param {string|null} secret
 * @param {Object} stamp
 * @returns {{ok:boolean, reason:string}}
 */
function verifyStampMac(secret, stamp) {
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'no operator secret available to verify the stamp MAC (fail-closed)' };
  }
  if (!stamp || typeof stamp !== 'object') {
    return { ok: false, reason: 'stamp is not an object' };
  }
  const mac = stamp.mac;
  if (!mac || typeof mac !== 'object' || Array.isArray(mac)) {
    return { ok: false, reason: 'stamp.mac is missing -- unsigned stamps are rejected' };
  }
  if (mac.mechanism !== STAMP_MAC_MECHANISM) {
    return { ok: false, reason: 'stamp.mac.mechanism is not ' + STAMP_MAC_MECHANISM };
  }
  if (mac.domain !== STAMP_MAC_DOMAIN) {
    return { ok: false, reason: 'stamp.mac.domain is not ' + STAMP_MAC_DOMAIN };
  }
  if (typeof mac.value !== 'string' || !mac.value) {
    return { ok: false, reason: 'stamp.mac.value is missing' };
  }
  let recomputed;
  try {
    recomputed = computeStampMac(secret, stamp);
  } catch (e) {
    return { ok: false, reason: 'could not recompute stamp MAC: ' + e.message };
  }
  const a = Buffer.from(recomputed, 'utf8');
  const b = Buffer.from(String(mac.value), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'stamp MAC mismatch -- stamp is forged or edited after minting (fail-closed)' };
  }
  return { ok: true, reason: 'stamp MAC verified over the full stamp content' };
}

/**
 * Resolve the signing/verifying secret. Delegates to the SAME resolver
 * receipt-mac.cjs and stamp-plan.js already use, so there is exactly one
 * Keychain-backed secret primitive in the tree -- not a second credential
 * type introduced for stamps specifically.
 * @param {{allowEnvSecret?:boolean, env?:Object, runSecurity?:Function}} [opts]
 * @returns {string|null}
 */
function resolveStampSecret(opts = {}) {
  try {
    const { resolveOperatorSecret } = require(path.join('..', '..', '..', 'planning', 'stamp-plan.js'));
    return resolveOperatorSecret(opts);
  } catch (_) {
    return null;
  }
}

module.exports = {
  STAMP_MAC_DOMAIN,
  STAMP_MAC_MECHANISM,
  canonicalStampMessage,
  computeStampMac,
  resolveStampSecret,
  signStamp,
  verifyStampMac
};
