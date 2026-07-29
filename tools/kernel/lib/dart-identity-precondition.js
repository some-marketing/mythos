'use strict';

/**
 * dart-identity-precondition.js — G-COND-3 (plan-approval-surface) HARD pre-D
 * precondition monitor.
 *
 * WHY (see _dev/concepts/plan-approval-surface/concept.md:111-126,145-148):
 *   The Dart-authorship approval path is un-forgeable ONLY because Mythos operates
 *   Dart under a DISTINCT enforced identity (Mythos <user@example.com>) and
 *   structurally CANNOT author a comment as the operator ({OPERATOR_NAME}). That guarantee
 *   collapses if the OPERATOR's Dart token is resident on THIS machine — then an
 *   agent could post AS the operator and forge an approval.
 *
 *   This monitor asserts that the RESIDENT Dart credential IS the Mythos identity
 *   (verifyDartIdentity ok:true). If it is NOT — or if identity cannot be proven
 *   (Dart unreachable) — the Dart-authorship approval path MUST be FORCED to the
 *   HMAC fallback or BLOCKED entirely. FAIL-CLOSED: unknown ⇒ do not trust Dart
 *   authorship.
 *
 *   "An unmonitored required precondition is a silent-failure psychic-prison-at-
 *   one-remove." This module is the active monitor; D1 (gated behind Stage E
 *   review) consumes `forceFallback` to disable the Dart path when unsafe.
 *
 * ROLLBACK / ESCAPE HATCH (grounding adjustment #2):
 *   The entire operator-stamp enforcement chain is gated by the DEFAULT-OFF flag
 *   SMOS_ENFORCE_OPERATOR_STAMP (canonical home: tools/planning/lib/plan-review-state.js).
 *   Unsetting / leaving it empty disables enforcement, so this precondition is
 *   only consulted once an operator deliberately activates enforcement.
 *
 * This is a LIBRARY (one injectable async assertion). It does NOT wire itself
 * into /run-plan or any hook — that integration is D1, behind Stage E review.
 */

const { verifyDartIdentity, EXPECTED_SMOS_DART_USER } = require('../../dart-integration/lib/identity');

/**
 * Assert the resident Dart token is the Mythos identity (NOT the operator's).
 *
 * @param {Object} [opts]
 * @param {Function} [opts.getConfig] - async () => Dart /config (injectable; default lazily loads dart-api.getConfig).
 * @param {Function} [opts.verifyDartIdentity] - injectable identity check (default identity.verifyDartIdentity).
 * @param {Object}   [opts.expectedUser] - expected Mythos user (default EXPECTED_SMOS_DART_USER).
 * @returns {Promise<{
 *   ok: boolean,
 *   forceFallback: boolean,
 *   dartAuthorshipPermitted: boolean,
 *   identity: {name:string,email:string,label:string}|null,
 *   reason: string
 * }>}
 */
async function assertDartIdentityPrecondition(opts = {}) {
  const verify = opts.verifyDartIdentity || verifyDartIdentity;
  const expectedUser = opts.expectedUser || EXPECTED_SMOS_DART_USER;

  let getConfig = opts.getConfig;
  if (typeof getConfig !== 'function') {
    // Lazy require so the module loads even where dart-api's secret resolution
    // would throw; the actual call is still wrapped fail-closed below.
    getConfig = () => require('../../dart-integration/lib/dart-api').getConfig();
  }

  let config = null;
  let fetchError = null;
  try {
    config = await getConfig();
  } catch (e) {
    fetchError = e;
  }

  if (fetchError || !config) {
    // Cannot prove the resident token is Mythos -> fail-closed: force fallback.
    return {
      ok: false,
      forceFallback: true,
      dartAuthorshipPermitted: false,
      identity: null,
      reason:
        'could not read the resident Dart identity (' +
        (fetchError && fetchError.message ? fetchError.message : 'no /config') +
        ') — FAIL-CLOSED: Dart-authorship approval path FORCED to HMAC fallback/block'
    };
  }

  const v = verify(config, expectedUser);
  if (v.ok) {
    return {
      ok: true,
      forceFallback: false,
      dartAuthorshipPermitted: true,
      identity: v.actual,
      reason: 'resident Dart token is the Mythos identity (' + v.actual.label + '); Dart-authorship approval path PERMITTED'
    };
  }

  return {
    ok: false,
    forceFallback: true,
    dartAuthorshipPermitted: false,
    identity: v.actual,
    reason:
      'resident Dart token is NOT the Mythos identity (got ' + v.actual.label +
      '): Mythos could impersonate the operator — Dart-authorship approval path FORCED to HMAC fallback/block'
  };
}

module.exports = {
  assertDartIdentityPrecondition
};
