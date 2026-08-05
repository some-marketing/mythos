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
// THE WRITE IS FOUR STEPS AND NONE OF THEM ARE OPTIONAL:
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

/** The canonical filename for a manifest: <generation_id>.json under the generations dir. */
function manifestPath(generationId, dir) {
  return path.join(dir || DEFAULT_DIR, `${generationId}.json`);
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
