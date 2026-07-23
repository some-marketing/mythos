#!/usr/bin/env node
/**
 * check-world-spec-approval.js — validates a world-spec and checks human approval.
 *
 * Approval is bound to the exact SHA-256 hash of the spec bytes. This keeps
 * proposed vNext specs from being imported until the operator approves them.
 *
 * SIGNATURE INTEGRATION:
 *   Beyond the exact-hash match, this checker inspects the operator signature
 *   on every matched approval record:
 *
 *     - A record whose signature verifies under the PUBLISHED test key
 *       ('MOCK-TEST-KEY-do-not-use-for-real-approvals') is REJECTED for active
 *       use even if structurally valid — anyone can produce it, so it proves
 *       nothing about operator intent.
 *     - A signed record must verify under the REAL operator key (obtained by the
 *       runner into WORLDFORGE_APPROVAL_HMAC_KEY from the operator's secret
 *       store). When that key is absent/inaccessible, verification of a
 *       signed record FAILS CLOSED: clear diagnostic, non-zero exit, no fallback.
 *
 *   MODE (--mode compat|historical|active, default compat):
 *     - compat (default): backward-compatible. Unsigned exact-hash records are
 *       accepted (this is how every historical import and evidence verifier
 *       works today); signed records are still signature-checked and TEST-key
 *       records are still rejected. This preserves the behavior every existing
 *       caller (import-approved-world-spec.js, the preflight gate) depends on
 *       while strictly improving security for signed records.
 *     - historical: read-only verification of EXISTING historical evidence.
 *       Only hashes explicitly grandfathered via --grandfathered (or the
 *       grandfatheredHashes option) are accepted among unsigned records; any
 *       other unsigned record is rejected.
 *     - active: STRICT new-import posture. Unsigned records are rejected,
 *       INCLUDING any grandfathered hashes (they are read-only history, not
 *       importable). Signed records must verify under the real key and, when a
 *       --target is supplied, must be target-bound to that destination.
 *
 *   Grandfathering is deployment-specific: this package ships with NO hashes
 *   grandfathered by default. A deployer who needs to keep verifying pre-existing
 *   unsigned historical approvals passes them explicitly via
 *   --grandfathered <hash> (repeatable) or a grandfathered-hashes file.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  getSigningKey,
  verifyRecord,
  verifiesUnderTestKey,
  flattenRecord,
} = require('./approval-sign.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_APPROVALS = path.join(REPO_ROOT, 'context/world-spec-approvals.json');
const VALIDATOR = path.join(__dirname, 'validate-world-spec.js');

const VALID_MODES = new Set(['compat', 'historical', 'active']);

function usage() {
  console.error([
    'Usage: node check-world-spec-approval.js <world-spec.json> [options]',
    '',
    'Options:',
    '  --approvals <approvals.json>   Approval manifest path',
    '  --mode compat|historical|active',
    '  --target <project-dir>         Expected destination for a target-bound (v2) signature',
    '  --grandfathered <hash>          A pre-existing unsigned hash to accept (repeatable)',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  if (argv.length < 1) usage();
  const out = { specPath: argv[0], approvalsPath: DEFAULT_APPROVALS, mode: 'compat', target: null, grandfathered: [] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--approvals' && argv[i + 1]) {
      out.approvalsPath = argv[++i];
    } else if (argv[i] === '--mode' && argv[i + 1]) {
      out.mode = argv[++i];
    } else if (argv[i] === '--active-import') {
      out.mode = 'active';
    } else if (argv[i] === '--historical-verification') {
      out.mode = 'historical';
    } else if (argv[i] === '--target' && argv[i + 1]) {
      out.target = argv[++i];
    } else if (argv[i] === '--grandfathered' && argv[i + 1]) {
      out.grandfathered.push(argv[++i].toLowerCase());
    } else {
      usage();
    }
  }
  if (!VALID_MODES.has(out.mode)) usage();
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateSpec(specPath) {
  const result = spawnSync(process.execPath, [VALIDATOR, specPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch {
    parsed = { valid: false, errors: [{ path: '$', message: result.stdout || result.stderr || 'validator output was not JSON' }] };
  }
  return {
    ok: result.status === 0 && parsed.valid === true,
    status: result.status,
    result: parsed,
  };
}

/**
 * Adjudicate the signature/grandfather disposition of a matched approval record
 * under the requested mode. Returns { allowed, reason, signature } and never
 * throws — a fail-closed key error becomes a hard, non-allowed disposition.
 */
function adjudicateSignature(match, { mode, hash, target, grandfatheredHashes }) {
  const flat = flattenRecord(match);
  const signed = flat !== null;

  const signature = {
    mode,
    signed,
    grandfathered: grandfatheredHashes.has(hash),
    verified_under_test_key: false,
    verified_under_real_key: false,
    target_bound: false,
    target_cross_checked: false,
  };

  // Any record that verifies under the published TEST key is rejected in every
  // mode — it is forgeable and proves nothing about operator intent.
  if (signed && verifiesUnderTestKey(match)) {
    signature.verified_under_test_key = true;
    return { allowed: false, reason: 'test_key_signature_rejected', signature };
  }

  if (signed) {
    // Signed record: must verify under the REAL operator key. getSigningKey()
    // fails closed when the real key is absent/locked.
    let key;
    try {
      key = getSigningKey();
    } catch (err) {
      signature.key_error = err.code || 'NO_SIGNING_KEY';
      return { allowed: false, reason: 'signing_key_unavailable_fail_closed', signature, keyDiagnostic: err.message };
    }
    const verifyOpts = {};
    if (target) verifyOpts.expectedTarget = target;
    const res = verifyRecord(match, key, verifyOpts);
    signature.target_bound = flat.target != null;
    signature.target_cross_checked = Boolean(target) && signature.target_bound;
    if (!res.valid) {
      return { allowed: false, reason: `real_key_verification_failed:${res.reason}`, signature };
    }
    // Active mode requires target binding for a new write.
    if (mode === 'active' && !signature.target_bound) {
      return { allowed: false, reason: 'active_import_requires_target_bound_signature', signature };
    }
    signature.verified_under_real_key = true;
    return { allowed: true, reason: 'valid_real_key_signature', signature };
  }

  // Unsigned record. Disposition depends on mode.
  if (mode === 'active') {
    return {
      allowed: false,
      reason: signature.grandfathered
        ? 'grandfathered_hash_rejected_for_new_import'
        : 'unsigned_approval_rejected_in_active_mode',
      signature,
    };
  }
  if (mode === 'historical') {
    if (signature.grandfathered) {
      return { allowed: true, reason: 'grandfathered_unsigned_historical_read_only', signature };
    }
    return { allowed: false, reason: 'unsigned_non_grandfathered_rejected_in_historical_mode', signature };
  }
  // compat (default): preserve the legacy unsigned exact-hash acceptance.
  return {
    allowed: true,
    reason: signature.grandfathered ? 'grandfathered_unsigned_hash_match' : 'unsigned_legacy_hash_match',
    signature,
  };
}

function main() {
  const { specPath, approvalsPath, mode, target, grandfathered } = parseArgs(process.argv.slice(2));
  const fullSpecPath = path.resolve(specPath);
  const fullApprovalsPath = path.resolve(approvalsPath);
  const grandfatheredHashes = new Set(grandfathered);

  const validation = validateSpec(fullSpecPath);
  if (!validation.ok) {
    console.log(JSON.stringify({
      import_allowed: false,
      reason: 'validation_failed',
      mode,
      validation: validation.result,
    }, null, 2));
    process.exit(1);
  }

  const spec = readJson(fullSpecPath);
  const approvals = readJson(fullApprovalsPath);
  const hash = sha256(fullSpecPath);
  const approvedSpecs = Array.isArray(approvals.approved_specs) ? approvals.approved_specs : [];
  const match = approvedSpecs.find((entry) => (
    entry &&
    entry.schema === spec.schema &&
    entry.world_id === spec.meta?.world_id &&
    entry.sha256 === hash &&
    entry.approved === true
  ));

  const output = {
    import_allowed: false,
    reason: 'missing_approval_for_exact_hash',
    mode,
    world_id: spec.meta?.world_id || null,
    name: spec.meta?.name || null,
    schema: spec.schema || null,
    sha256: hash,
    approvals_path: path.relative(REPO_ROOT, fullApprovalsPath),
    validation: validation.result,
  };

  if (!match) {
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }

  const disposition = adjudicateSignature(match, { mode, hash, target: target ? path.resolve(target) : null, grandfatheredHashes });
  output.import_allowed = disposition.allowed;
  output.reason = disposition.allowed
    ? (disposition.reason || 'approved_exact_hash')
    : disposition.reason;
  output.signature = disposition.signature;
  if (disposition.keyDiagnostic) output.key_diagnostic = disposition.keyDiagnostic;
  if (target) output.target = path.resolve(target);

  if (disposition.allowed) {
    output.approval = {
      approved_by: match.approved_by || null,
      approved_at: match.approved_at || null,
      approval_basis: match.approval_basis || null,
    };
  }

  console.log(JSON.stringify(output, null, 2));
  process.exit(disposition.allowed ? 0 : 1);
}

main();
