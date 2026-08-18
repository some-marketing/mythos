#!/usr/bin/env node
'use strict';

// tools/ticktock/generation-manifest.cjs -- the single writer for
// GenerationManifest/1.0. Plan: ticktock-skill S2, repair of review finding F5 in
// _dev/reports/analysis/review-task-plan__ticktock-s2-review__20260805.md.
//
// The finding was not that inline writing is dishonest -- the skill disclosed it --
// but that "written inline against the schema" has no writer or read-back contract,
// so two inline implementations could drift while both claiming the same schema id.
// This module is that contract, expressed as code rather than as prose about code.
//
// THE WRITE IS FIVE STEPS AND NONE OF THEM ARE OPTIONAL:
//
//   1. CONSTRUCT   manifest_hash is computed by canonical.hashObject over the
//                  document's canonical projection with manifest_hash omitted --
//                  the same self-referential-hash discipline charter.cjs uses. A
//                  caller-supplied manifest_hash is recomputed and must match, or
//                  the write is refused; the writer never trusts a hash it did not
//                  compute.
//   2. VALIDATE    ajv against generation-manifest-schema.json, BEFORE touching
//                  disk. An invalid document is never written, not written-then-
//                  flagged.
//   2b. ROTATION   the mandatory-rotation invariant, read from the document's
//                  contents (the schema can require the object shape; only this
//                  check reads what it says).
//   2c. VERIFY OUTPUTS  (B4 repair, default-on) every outputs[] entry's path,
//                  resolved against the REPO ROOT (never process cwd), is
//                  re-read from disk and its sha256 + byte count compared
//                  against the manifest's own declared values -- confirming the
//                  document's claim about what it produced, not merely the
//                  document's claim about itself. Explicit
//                  opts.skipArtifactVerification bypasses this for fixtures
//                  with no real files; the receipt's artifacts_verified field
//                  is truthful in both modes.
//   3. WRITE       atomically: write a sibling .tmp, fsync, rename into place. A
//                  torn manifest is indistinguishable from a tampered one, so the
//                  file must appear whole or not at all.
//   4. READ BACK   independently: re-read the bytes from disk into a NEW object,
//                  re-validate that object against the schema, recompute its
//                  manifest_hash from the re-read content, and compare against both
//                  the intended hash and the stored field. Verifying the in-memory
//                  object proves self-consistency, not delivery -- the point of the
//                  read-back is that it goes through the filesystem.
//
// The receipt returned by writeGenerationManifest is what the cycle records: it
// names the path, the byte length, the sha256 of the file's bytes, the manifest
// hash, and the fact that each of the four steps passed.

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const Ajv = require('ajv');

const { canonicalize, sha256Hex, hashObject } = require('./canonical.cjs');
const MANIFEST_SCHEMA = require('./generation-manifest-schema.json');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIR = '_dev/state/ticktock/generations';
const SCHEMA_ID = 'GenerationManifest/1.0';

function compileValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return { ajv, validate: ajv.compile(MANIFEST_SCHEMA) };
}

/** The manifest's identity hash: sha256 of the canonical projection without manifest_hash. */
function computeManifestHash(manifest) {
  return hashObject(manifest, ['manifest_hash']);
}

/** Schema validation only. Returns {valid, errors}. Never throws on invalid input. */
function validateGenerationManifest(manifest) {
  const { ajv, validate } = compileValidator();
  const valid = validate(manifest);
  return { valid, errors: valid ? [] : validate.errors, errorText: valid ? null : ajv.errorsText(validate.errors) };
}

// ---------------------------------------------------------------------------
// Rotation acceptance (ROTATION-MISSING)
// ---------------------------------------------------------------------------
//
// POLICY, STATED RATHER THAN ASSUMED.
//
// The plan (.claude/skills/ticktock/SKILL.md, every_cycle_invariants #2) says:
// "Minds AND harnesses rotate per cycle ... A cycle with no rotation fails
// acceptance (ROTATION-MISSING)." It says nothing about which generations are
// exempt. Read conservatively, that is: EVERY generation must carry a real
// rotation record, with exactly one stated exception --
//
//   A generation that HALTED (manifest.halt present) is exempt, because the same
//   section orders the invariants benchmark(1) -> rotation(2) -> manifest(3), so a
//   cycle that halts at the benchmark step halts BEFORE rotation could have
//   happened. Refusing its manifest would make a benchmark-divergence halt
//   unrecordable, which destroys evidence rather than enforcing rotation. The
//   exemption is recorded on the evaluation, never silent.
//
// This exception is DECIDED-IN-PLAN, NOT OPERATOR-RATIFIED. It is derived from the
// SKILL's own ordering of the four invariants; no operator has stamped it. If the
// operator rules that halted generations must also carry rotation, delete the
// `halt` branch below -- nothing else depends on it.
//
// A rotation record is real when ALL THREE hold, per the schema's own description
// ("at least one previously untested mind/harness lane, recorded in the
// capabilities matrix"):
//   rotated_lane_id    a non-empty string (some lane actually rotated)
//   was_untested       strictly true (it was previously untested)
//   recorded_in_matrix strictly true (the outcome reached the capabilities matrix)
//
// Anything else -- null lane, false flags, missing rotation object, wrong types --
// is ROTATION-MISSING. Fail closed: a generation that cannot show rotation has not
// rotated.

const ROTATION_POLICY = {
  policy: 'rotation is required for EVERY generation',
  exception: 'a generation whose manifest carries a halt record is exempt, because the SKILL orders benchmark -> rotation -> manifest and a cycle halting at the benchmark step halted before rotation could occur',
  provenance: 'decided-in-plan-not-operator-ratified',
  derived_from: '.claude/skills/ticktock/SKILL.md every_cycle_invariants #2 + the invariant ordering in that same section'
};

/**
 * Does this manifest's rotation record satisfy the mandatory-rotation invariant?
 * Pure; never throws. Returns {ok, halt_state, reasons, exempt, exempt_reason}.
 */
function evaluateRotation(manifest) {
  const m = manifest || {};
  if (m.halt && typeof m.halt === 'object') {
    return {
      ok: true,
      halt_state: null,
      reasons: [],
      exempt: true,
      exempt_reason: `generation halted (${m.halt.halt_state}); ${ROTATION_POLICY.exception}`,
      policy: ROTATION_POLICY
    };
  }

  const r = m.rotation;
  const reasons = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    reasons.push(`rotation is ${JSON.stringify(r)}; a generation with no rotation record has not rotated`);
  } else {
    if (typeof r.rotated_lane_id !== 'string' || r.rotated_lane_id.length === 0) {
      reasons.push(`rotation.rotated_lane_id is ${JSON.stringify(r.rotated_lane_id)}; no lane was rotated this cycle`);
    }
    if (r.was_untested !== true) {
      reasons.push(`rotation.was_untested is ${JSON.stringify(r.was_untested)}; rotation must reach a PREVIOUSLY UNTESTED mind/harness lane, and only the strict boolean true says it did`);
    }
    if (r.recorded_in_matrix !== true) {
      reasons.push(`rotation.recorded_in_matrix is ${JSON.stringify(r.recorded_in_matrix)}; the rotation outcome must be recorded in the capabilities matrix, and only the strict boolean true says it was`);
    }
  }

  return {
    ok: reasons.length === 0,
    halt_state: reasons.length === 0 ? null : 'ROTATION-MISSING',
    reasons,
    exempt: false,
    exempt_reason: null,
    policy: ROTATION_POLICY
  };
}

/** The canonical filename for a manifest: <generation_id>.json under the generations dir. */
function manifestPath(generationId, dir) {
  return path.join(dir || DEFAULT_DIR, `${generationId}.json`);
}

// ---------------------------------------------------------------------------
// Artifact verification (B4 repair, F5)
// ---------------------------------------------------------------------------
//
// THE DEFECT. The schema's own language ("outputs: every artifact the cycle
// produced, with the content hash CONFIRMED by an independent re-read")
// promised verification that no code ever performed. writeGenerationManifest()
// verified only the MANIFEST DOCUMENT's own bytes against manifest_hash (step
// 4, READ BACK) -- it never opened a single file named in outputs[] and
// compared its bytes to the hash the manifest claims for it. A caller could
// write a manifest asserting an sha256 for an artifact that does not exist, or
// that was silently altered after the hash was computed, and the writer would
// accept it as long as the MANIFEST's own hash was internally consistent.
// Self-consistency proves nothing about delivery -- the exact lesson recorded
// as "a null that varies two things proves neither" applied to files instead
// of experiments.
//
// THE FIX is default-on: every outputs[] entry's path is resolved AGAINST THE
// REPO ROOT, NEVER THE PROCESS CWD (a cycle invoked from a non-root working
// directory must not silently pass or silently false-refuse depending on
// where it happened to be launched from -- the same rule manifestPath()'s own
// caller-supplied `dir` already follows), re-read from disk, and its sha256
// and byte count compared against the manifest's declared values. A caller
// that intentionally has no real files (fixtures) passes
// opts.skipArtifactVerification explicitly; the receipt's artifacts_verified
// field is truthful in BOTH modes (true only when verification actually ran
// and passed) so a skipped verification can never be read as a passed one.
function verifyOutputArtifacts(outputs) {
  const mismatches = [];
  for (const entry of outputs || []) {
    const absPath = path.resolve(REPO_ROOT, entry.path);
    let buf;
    try {
      buf = fs.readFileSync(absPath);
    } catch (err) {
      mismatches.push({ path: entry.path, resolved_path: absPath, reason: `unreadable: ${err.message}` });
      continue;
    }
    const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
    if (actualSha !== entry.sha256) {
      mismatches.push({ path: entry.path, resolved_path: absPath, reason: `sha256 mismatch: recorded ${entry.sha256}, actual ${actualSha}` });
      continue;
    }
    // B6 amendment (codex finding 4): `bytes` is OPTIONAL in the schema's
    // hashed_path definition (shared with inputs.artifact_hashes, where a
    // byte count is not always meaningful), so the schema cannot be trusted
    // to enforce it for outputs. Before this amendment, an entry with a
    // correct sha256 but NO `bytes` field skipped the byte-count check
    // entirely (`typeof entry.bytes === 'number'` was false) and still
    // returned artifacts_verified:true -- contradicting this schema's own
    // "sha256 AND byte count are CONFIRMED" language. DECISION (stated per
    // plan instruction, code-level rather than a schema change, so
    // inputs.artifact_hashes' looser contract is undisturbed): on the
    // default (non-skipped) output-verification path, a missing `bytes`
    // field is ITSELF a verification failure, not a silently-skipped check.
    if (typeof entry.bytes !== 'number') {
      mismatches.push({ path: entry.path, resolved_path: absPath, reason: `no bytes field recorded -- default-on output verification requires byte count, not sha256 alone` });
      continue;
    }
    if (entry.bytes !== buf.length) {
      mismatches.push({ path: entry.path, resolved_path: absPath, reason: `byte count mismatch: recorded ${entry.bytes}, actual ${buf.length}` });
    }
  }
  return { ok: mismatches.length === 0, checked: (outputs || []).length, mismatches };
}

/**
 * Write one generation manifest under the full four-step contract.
 *
 * @returns {object} a receipt. Throws on any refusal, with a named reason -- a
 *          failed manifest write is a halt, never a warn-and-proceed.
 */
function writeGenerationManifest(manifest, opts) {
  const options = opts || {};
  const dir = options.dir || DEFAULT_DIR;

  if (!manifest || typeof manifest !== 'object') {
    throw new Error('MANIFEST-WRITE-REFUSED: manifest must be an object.');
  }
  if (manifest.schema !== SCHEMA_ID) {
    throw new Error(`MANIFEST-WRITE-REFUSED: schema must be "${SCHEMA_ID}", got ${JSON.stringify(manifest.schema)}.`);
  }

  // 1. CONSTRUCT -- the writer computes the hash; a supplied one is checked, not trusted.
  const intendedHash = computeManifestHash(manifest);
  if (manifest.manifest_hash !== undefined && manifest.manifest_hash !== intendedHash) {
    throw new Error(
      `MANIFEST-HASH-MISMATCH: supplied manifest_hash ${manifest.manifest_hash} does not equal the recomputed ${intendedHash}.`
    );
  }
  const document = Object.assign({}, manifest, { manifest_hash: intendedHash });

  // 2. VALIDATE before disk.
  const pre = validateGenerationManifest(document);
  if (!pre.valid) {
    throw new Error(`MANIFEST-SCHEMA-INVALID (pre-write): ${pre.errorText}`);
  }

  // 2b. ACCEPT -- mandatory rotation. The schema can only require the rotation
  // OBJECT; it cannot express "a lane actually rotated". This is the acceptance
  // check that reads its contents. It runs before disk for the same reason the
  // schema check does: a generation that skipped rotation is never written and
  // then flagged, it is refused.
  const rotation = evaluateRotation(document);
  if (!rotation.ok) {
    throw new Error(
      `ROTATION-MISSING: ${rotation.reasons.join('; ')}. `
      + `Policy: ${ROTATION_POLICY.policy} (${ROTATION_POLICY.provenance}); exception: ${ROTATION_POLICY.exception}.`
    );
  }

  // 2b2. VERIFY LINEAGE LINK -- mandatory, before disk. The schema alone can
  // only type parent_generation_id/parent_manifest_hash as ["string","null"];
  // it cannot express "null only at cycle_index 0" (no if/then conditional
  // existed here). Codex PR#20 review: without this call, a non-genesis
  // manifest with a null parent was written successfully and received a
  // read_back_verified:true receipt even though its lineage cannot be
  // traversed -- writeGenerationManifest ran schema, rotation, and artifact
  // checks but never invoked verifyLineageLink(). Refused here, same as
  // rotation and artifact verification: never written and then flagged.
  let parentManifestForLineage = null;
  if (document.cycle_index !== 0) {
    const parentGenId = document.parent && document.parent.parent_generation_id;
    if (parentGenId) {
      const parentAbsPath = path.resolve(REPO_ROOT, manifestPath(parentGenId, dir));
      if (fs.existsSync(parentAbsPath)) {
        try {
          parentManifestForLineage = JSON.parse(fs.readFileSync(parentAbsPath, 'utf8'));
        } catch (_) {
          parentManifestForLineage = null; // unreadable/unparseable parent -- verifyLineageLink below reports it as unlinked
        }
      }
    }
  }
  const lineage = verifyLineageLink(document, parentManifestForLineage);
  if (!lineage.linked) {
    throw new Error(`LINEAGE-LINK-BROKEN: ${lineage.reason}.`);
  }

  // 2c. VERIFY ARTIFACTS -- default-on (B4 repair). Runs before disk for the
  // same reason the rotation check does: a manifest whose declared outputs do
  // not match what is actually on disk is never written and then flagged, it
  // is refused. opts.skipArtifactVerification is the ONLY bypass, and it is
  // explicit -- no implicit skip exists (an empty outputs[] array trivially
  // "passes" with checked:0, which is honest: there is nothing to verify).
  const skipArtifactVerification = options.skipArtifactVerification === true;
  let artifactVerification = null;
  if (!skipArtifactVerification) {
    artifactVerification = verifyOutputArtifacts(document.outputs);
    if (!artifactVerification.ok) {
      throw new Error(
        `ARTIFACT-VERIFICATION-FAILED: ${artifactVerification.mismatches.length} of ${artifactVerification.checked} declared output(s) did not verify against disk (resolved against the repo root): `
        + artifactVerification.mismatches.map((m) => `${m.path} (${m.reason})`).join('; ')
      );
    }
  }

  // 3. WRITE atomically.
  const relPath = manifestPath(document.generation_id, dir);
  const absPath = path.resolve(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  const tmpPath = `${absPath}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, absPath);

  // 4. READ BACK independently, through the filesystem.
  const readBackBytes = fs.readFileSync(absPath);
  let readBack;
  try {
    readBack = JSON.parse(readBackBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`MANIFEST-READBACK-UNPARSEABLE: ${relPath}: ${err.message}`);
  }
  const post = validateGenerationManifest(readBack);
  if (!post.valid) {
    throw new Error(`MANIFEST-SCHEMA-INVALID (read-back): ${post.errorText}`);
  }
  const readBackHash = computeManifestHash(readBack);
  if (readBackHash !== intendedHash) {
    throw new Error(
      `MANIFEST-READBACK-HASH-MISMATCH: on-disk content hashes to ${readBackHash}, intended ${intendedHash}.`
    );
  }
  if (readBack.manifest_hash !== intendedHash) {
    throw new Error(
      `MANIFEST-READBACK-FIELD-MISMATCH: on-disk manifest_hash is ${readBack.manifest_hash}, intended ${intendedHash}.`
    );
  }

  return {
    schema: 'GenerationManifestWriteReceipt/1.0',
    path: relPath,
    generation_id: readBack.generation_id,
    cycle_index: readBack.cycle_index,
    manifest_hash: intendedHash,
    file_sha256: sha256Hex(readBackBytes.toString('utf8')),
    bytes: readBackBytes.length,
    canonical_length: canonicalize(readBack).length,
    constructed: true,
    validated_pre_write: true,
    artifacts_verified: !skipArtifactVerification,
    artifacts_verification_skipped: skipArtifactVerification,
    artifacts_checked: artifactVerification ? artifactVerification.checked : 0,
    lineage_link_verified: true,
    lineage_link_reason: lineage.reason,
    rotation_accepted: true,
    rotation_exempt: rotation.exempt,
    rotation_exempt_reason: rotation.exempt_reason,
    written_atomically: true,
    read_back_verified: true,
    written_at: new Date().toISOString()
  };
}

/** Read a manifest and verify its stored hash against its own content. */
function readGenerationManifest(relPath) {
  const absPath = path.resolve(REPO_ROOT, relPath);
  const doc = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const recomputed = computeManifestHash(doc);
  return {
    manifest: doc,
    hash_verified: recomputed === doc.manifest_hash,
    recomputed_hash: recomputed
  };
}

/**
 * The lineage check: this manifest's parent.parent_manifest_hash must equal the
 * previous generation's manifest_hash. Null parent fields are valid only at cycle 0.
 */
function verifyLineageLink(manifest, parentManifest) {
  const p = manifest.parent || {};
  if (manifest.cycle_index === 0) {
    const ok = p.parent_generation_id === null && p.parent_manifest_hash === null;
    return { linked: ok, reason: ok ? 'genesis generation' : 'cycle 0 must carry null parent fields' };
  }
  if (!parentManifest) {
    return { linked: false, reason: 'no parent manifest supplied for a non-zero cycle_index' };
  }
  const expected = computeManifestHash(parentManifest);
  const ok = p.parent_manifest_hash === expected && p.parent_generation_id === parentManifest.generation_id;
  return {
    linked: ok,
    reason: ok ? 'lineage intact' : `expected parent ${parentManifest.generation_id}/${expected}, found ${p.parent_generation_id}/${p.parent_manifest_hash}`
  };
}

module.exports = {
  SCHEMA_ID,
  DEFAULT_DIR,
  computeManifestHash,
  validateGenerationManifest,
  ROTATION_POLICY,
  evaluateRotation,
  manifestPath,
  writeGenerationManifest,
  readGenerationManifest,
  verifyLineageLink
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [cmd, target] = process.argv.slice(2);
  if (cmd === 'validate' && target) {
    const doc = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
    const result = validateGenerationManifest(doc);
    const recomputed = computeManifestHash(doc);
    process.stdout.write(JSON.stringify({
      valid: result.valid,
      errors: result.errorText,
      manifest_hash_field: doc.manifest_hash,
      manifest_hash_recomputed: recomputed,
      hash_verified: recomputed === doc.manifest_hash
    }, null, 2) + '\n');
    process.exit(result.valid && recomputed === doc.manifest_hash ? 0 : 1);
  } else {
    process.stderr.write('usage: generation-manifest.cjs validate <path>\n');
    process.exit(2);
  }
}
