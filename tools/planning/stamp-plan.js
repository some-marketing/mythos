#!/usr/bin/env node
'use strict';

/**
 * stamp-plan.js — B3 (plan-approval-surface) — the HMAC single-secret `/stamp`
 * FALLBACK approval path for offline / CI / non-Dart contexts.
 *
 * AUTHORITY MODEL (see _dev/concepts/plan-approval-surface/concept.md:95-99,157):
 *   IDENTITY-based proof (an operator-authored, Dart-API-RE-VERIFIED comment) is
 *   PRIMARY. This HMAC `/stamp` is the FALLBACK only — used when Dart authorship
 *   cannot be checked (offline / CI / Dart unreachable, per G-COND-2).
 *
 * THREAT MODEL:
 *   The operator holds a single secret SM_OS_OPERATOR_APPROVAL_SECRET in the
 *   on-device secret store (macOS Keychain / 1Password) that the agent
 *   environment deliberately does NOT receive (same discipline as
 *   tools/dart-integration/lib/dart-api.js token resolution). The agent has
 *   file-write to the marker but NOT the secret, so it cannot forge a stamp.
 *
 *   The MAC is bound to (plan_id + plan_sha256 + timestamp). plan_sha256 binding
 *   kills ghost-step drift: editing the plan changes its digest and invalidates
 *   any prior stamp. The gate/verifier RECOMPUTE and verify the MAC at run time —
 *   they NEVER trust a stored `mac` field as authority on its own.
 *
 * ROLLBACK / ESCAPE HATCH (grounding adjustment #2):
 *   This whole enforcement chain is gated by the DEFAULT-OFF feature flag
 *   SMOS_ENFORCE_OPERATOR_STAMP (canonical home: tools/planning/lib/plan-review-state.js).
 *   To DISABLE operator-stamp enforcement, unset / leave empty that env var:
 *       unset SMOS_ENFORCE_OPERATOR_STAMP        # or never set it (default)
 *   With the flag off, neither the userprompt gate (A1) nor /run-plan (A2) nor
 *   the run-time re-verify (D1) require a stamp. This is the one-line rollback.
 *
 * This module is a LIBRARY (pure HMAC helpers + an injectable secret resolver)
 * plus a TTY-gated CLI. It does NOT wire itself into /run-plan — that is D1,
 * which gates behind the Stage E distinct review.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OPERATOR_APPROVAL_SECRET_ENV = 'SM_OS_OPERATOR_APPROVAL_SECRET';
// On-device secret store coordinates (mirrors the dart-api.js Keychain pattern).
const SECRET_KEYCHAIN_SERVICE = 'SM_OS_OPERATOR_APPROVAL_SECRET';
const SECRET_KEYCHAIN_ACCOUNT = 'smos';

const STAMP_MECHANISM = 'hmac-sha256';

/**
 * Canonical message bound by the MAC. Order + separators are fixed so the
 * operator's /stamp and the gate's re-verify compute byte-identical input.
 * @param {{planId:string, planSha256:string, timestamp:string}} fields
 * @returns {string}
 */
function canonicalMessage(fields) {
  const planId = String((fields && fields.planId) || '');
  const planSha256 = String((fields && fields.planSha256) || '');
  const timestamp = String((fields && fields.timestamp) || '');
  if (!planId || !planSha256 || !timestamp) {
    throw new Error('canonicalMessage: planId, planSha256 and timestamp are all required');
  }
  return planId + '\n' + planSha256 + '\n' + timestamp;
}

/**
 * Compute the HMAC-SHA256 over the canonical message. Pure.
 * @param {string} secret
 * @param {{planId:string, planSha256:string, timestamp:string}} fields
 * @returns {string} lowercase hex digest
 */
function computeHmac(secret, fields) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('computeHmac: a non-empty operator secret is required');
  }
  return crypto.createHmac('sha256', secret).update(canonicalMessage(fields), 'utf8').digest('hex');
}

/**
 * Build a stamp object suitable for writing into marker.operator_stamp.
 * @param {string} secret
 * @param {{planId:string, planSha256:string, timestamp?:string}} fields
 * @returns {{mechanism:string, plan_id:string, plan_sha256:string, at:string, mac:string}}
 */
function buildStamp(secret, fields) {
  const timestamp = (fields && fields.timestamp) || new Date().toISOString();
  const mac = computeHmac(secret, {
    planId: fields.planId,
    planSha256: fields.planSha256,
    timestamp: timestamp
  });
  return {
    mechanism: STAMP_MECHANISM,
    plan_id: String(fields.planId),
    plan_sha256: String(fields.planSha256),
    at: timestamp,
    mac: mac
  };
}

/**
 * Verify an HMAC stamp object. RECOMPUTES the MAC and timing-safe compares;
 * never trusts the stored `mac` as authority. Also enforces that the stamp is
 * bound to the EXPECTED plan_id + plan_sha256 (an edited plan -> sha mismatch
 * -> verification fails, killing ghost-step drift).
 *
 * @param {string} secret
 * @param {Object} stamp - marker.operator_stamp candidate
 * @param {{planId:string, planSha256:string}} expected
 * @returns {{ok:boolean, reason:string}}
 */
function verifyHmacStamp(secret, stamp, expected) {
  if (typeof secret !== 'string' || secret.length === 0) {
    return { ok: false, reason: 'no operator approval secret available to verify the HMAC stamp (fail-closed)' };
  }
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) {
    return { ok: false, reason: 'operator_stamp is not an HMAC stamp object' };
  }
  if (stamp.mechanism !== STAMP_MECHANISM) {
    return { ok: false, reason: 'operator_stamp.mechanism is not ' + STAMP_MECHANISM };
  }
  const expectedPlanId = String((expected && expected.planId) || '');
  const expectedSha = String((expected && expected.planSha256) || '');
  if (expectedPlanId && String(stamp.plan_id) !== expectedPlanId) {
    return { ok: false, reason: 'stamp plan_id "' + stamp.plan_id + '" != expected "' + expectedPlanId + '"' };
  }
  if (expectedSha && String(stamp.plan_sha256) !== expectedSha) {
    return {
      ok: false,
      reason: 'stamp plan_sha256 "' + String(stamp.plan_sha256).slice(0, 12) +
        '…" != current plan digest "' + expectedSha.slice(0, 12) +
        '…" — the plan was edited after stamping; re-stamp the current plan'
    };
  }
  if (typeof stamp.mac !== 'string' || !stamp.mac) {
    return { ok: false, reason: 'operator_stamp.mac is missing' };
  }
  let recomputed;
  try {
    recomputed = computeHmac(secret, {
      planId: stamp.plan_id,
      planSha256: stamp.plan_sha256,
      timestamp: stamp.at
    });
  } catch (e) {
    return { ok: false, reason: 'could not recompute HMAC: ' + e.message };
  }
  const a = Buffer.from(recomputed, 'utf8');
  const b = Buffer.from(String(stamp.mac), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'HMAC mismatch — stamp is forged or the secret is wrong (fail-closed)' };
  }
  return { ok: true, reason: 'HMAC stamp verified (recomputed over plan_id + plan_sha256 + at)' };
}

/**
 * Resolve the operator approval secret from the on-device secret store.
 *
 * SECURITY (F1 — Stage E repair): the DEFAULT source is the macOS Keychain ONLY.
 * The process environment is NEVER read by default, because an agent sharing the
 * process could otherwise plant SM_OS_OPERATOR_APPROVAL_SECRET in its own env and
 * forge an approval. Reading env requires the EXPLICITLY named `allowEnvSecret:true`
 * option — reserved for the operator-run TTY CLI (and controlled tests). The
 * default run-time verifier path NEVER sets it, so the verifier cannot be fooled
 * by an agent-visible env secret.
 *
 * IMPORTANT: the agent environment must NOT carry this secret. This resolver is
 * for the operator-run /stamp CLI and (later, D1) the run-time verifier, both of
 * which run where the secret store is reachable.
 *
 * @param {{env?:Object, runSecurity?:Function, allowEnvSecret?:boolean}} [opts]
 * @returns {string|null}
 */
function resolveOperatorSecret(opts = {}) {
  // F1: env is consulted ONLY under the explicit operator/test opt-in; the
  // default (verifier) path skips it entirely so an agent's env cannot forge.
  if (opts.allowEnvSecret === true) {
    const env = opts.env || process.env;
    const fromEnv = String(env[OPERATOR_APPROVAL_SECRET_ENV] || '').trim();
    if (fromEnv) return fromEnv;
  }

  const runSecurity = opts.runSecurity || ((cmd) => execSync(cmd, { encoding: 'utf8' }));
  try {
    const out = String(
      runSecurity(`security find-generic-password -s "${SECRET_KEYCHAIN_SERVICE}" -a "${SECRET_KEYCHAIN_ACCOUNT}" -w`)
    ).trim();
    if (out) return out;
  } catch (_) {
    // Secret not present in this environment — fall through to null (fail-closed
    // upstream: the HMAC fallback simply cannot be used here).
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLI — operator-run, TTY-gated. `node tools/planning/stamp-plan.js <plan-id>`
// ---------------------------------------------------------------------------

function _cliMain(argv) {
  const args = argv.slice(2).filter((a) => a && !a.startsWith('--'));
  const planRef = args[0];
  if (!planRef) {
    process.stderr.write('Usage: node tools/planning/stamp-plan.js <plan-id>\n');
    return 1;
  }
  if (!process.stdout.isTTY && !process.env.SMOS_STAMP_ALLOW_NONTTY) {
    process.stderr.write(
      '[stamp-plan] REFUSING to stamp from a non-TTY context. /stamp is operator-run only.\n' +
      'The agent environment must not hold the operator approval secret. Run this in an\n' +
      'interactive operator terminal (or set SMOS_STAMP_ALLOW_NONTTY for a controlled test).\n'
    );
    return 2;
  }

  let verify;
  try {
    verify = require('./lib/operator-approval-verify');
  } catch (e) {
    process.stderr.write('[stamp-plan] could not load operator-approval-verify: ' + e.message + '\n');
    return 1;
  }

  const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
  let resolved;
  try {
    const r = require('./lib/resolve-task-plan');
    resolved = r.resolveTaskPlanPaths(PROJECT_ROOT, planRef);
  } catch (e) {
    process.stderr.write('[stamp-plan] could not resolve plan "' + planRef + '": ' + e.message + '\n');
    return 1;
  }
  const planText = fs.readFileSync(resolved.jsonPath, 'utf8');
  const planSha256 = verify.computePlanSha256(planText);
  const planId = path.basename(resolved.jsonPath).replace(/__plan\.json$/, '');

  // CLI is operator-run + TTY-gated, so the explicit env opt-in is permitted
  // here (and ONLY here) — this is the named operator/CLI context, not the
  // default verifier path.
  const secret = resolveOperatorSecret({ allowEnvSecret: true });
  if (!secret) {
    process.stderr.write(
      '[stamp-plan] no operator approval secret found in the on-device secret store.\n' +
      'Store it first (Keychain service "' + SECRET_KEYCHAIN_SERVICE + '" / account "' +
      SECRET_KEYCHAIN_ACCOUNT + '") or export ' + OPERATOR_APPROVAL_SECRET_ENV + ' in your operator shell.\n'
    );
    return 1;
  }

  const stamp = buildStamp(secret, { planId, planSha256 });
  process.stdout.write(
    '[stamp-plan] computed HMAC operator_stamp for ' + planId + '\n' +
    '  plan_sha256: ' + planSha256 + '\n' +
    '  stamp: ' + JSON.stringify(stamp) + '\n' +
    'Record this object into the plan-task-review-state marker operator_stamp field.\n' +
    'D1 (gated behind Stage E review) re-verifies it at /run-plan time.\n'
  );
  return 0;
}

module.exports = {
  OPERATOR_APPROVAL_SECRET_ENV,
  SECRET_KEYCHAIN_SERVICE,
  SECRET_KEYCHAIN_ACCOUNT,
  STAMP_MECHANISM,
  canonicalMessage,
  computeHmac,
  buildStamp,
  verifyHmacStamp,
  resolveOperatorSecret,
  _cliMain
};

if (require.main === module) {
  process.exit(_cliMain(process.argv));
}
