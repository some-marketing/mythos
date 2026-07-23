#!/usr/bin/env node
/**
 * closure-hash.js
 *
 * ============================================================================
 * Closure-hash + operator-held signing closes the classic "approval is
 * forgeable" and TOCTOU (time-of-check/time-of-use) holes in a spec-approval
 * pipeline. Wiring this into an activation path with the real signing key,
 * and recomputing the closure hash at activation time on the target host, is
 * the deployer's responsibility. This file computes hashes only; it
 * activates nothing.
 * ============================================================================
 *
 * THE HOLE (approval-hash TOCTOU):
 *   A naive approval binds approval to sha256 of the SPEC FILE BYTES ONLY.
 *   Every payload the spec *points at* (asset paths / tarballs that a
 *   consumer rebuilds a world from) lives OUTSIDE that hash. An attacker
 *   approves a benign spec, then swaps a referenced payload after approval —
 *   same spec bytes, same approved hash, different world.
 *
 * THE CLOSE:
 *   A CLOSURE hash covers the spec bytes AND a manifest of every referenced
 *   payload with a per-file sha256, folded into one digest. Swap any
 *   referenced payload -> closure hash changes -> the prior approval no longer
 *   matches. The approval is bound to the whole transitive closure, not just
 *   the spec file.
 *
 * API:
 *   computeClosureHash(specPath, opts?) -> {
 *     closureHash,      // hex sha256 over {specSha256, sorted payload manifest}
 *     specSha256,       // hex sha256 of the spec file bytes (legacy hash)
 *     manifest,         // [{ ref, resolvedPath, status, sha256, bytes }]
 *     degraded,         // true when spec references no external payloads
 *     note              // human-readable explanation when degraded
 *   }
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLOSURE_HASH_VERSION = 'closure-hash/1.0';

// Extensions that mark a string value as a referenced binary/asset payload.
// A spec references a world's rebuildable assets by path or tarball; these are
// exactly the bytes the TOCTOU hole says are swappable after a spec-bytes-only
// approval.
const PAYLOAD_EXT = /\.(tgz|tar|tar\.gz|gz|zip|7z|png|jpe?g|webp|glb|gltf|fbx|uasset|umap|pak|bin|obj|stl|wav|mp3|mp4|hdr|exr|dds|ktx2)$/i;

// Object keys whose string values are treated as payload references regardless
// of extension (belt-and-suspenders with PAYLOAD_EXT).
const PAYLOAD_KEY = /^(asset|assets|payload|payloads|payload_ref|payload_refs|tarball|tarballs|artifact|artifacts|file|files|src|source_file|uri|url)$/i;

function sha256Bytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

/**
 * Walk parsed JSON and collect every string value that looks like a reference
 * to an external payload file. Two triggers: the value matches a known payload
 * extension, OR it sits under a payload-ish key. Non-string / primitive values
 * are ignored.
 */
function collectRefs(node, parentKey, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    const looksLikePayload =
      PAYLOAD_EXT.test(node) || (parentKey && PAYLOAD_KEY.test(parentKey));
    // Ignore obvious non-file strings (schema ids, urls without file ext under
    // non-payload keys, bare words). Require either an extension match or an
    // explicit payload key.
    if (looksLikePayload && node.trim().length > 0) {
      out.add(node.trim());
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, parentKey, out);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectRefs(value, key, out);
    }
  }
}

/**
 * Resolve a referenced payload string to an on-disk path. Tries, in order:
 *   1. relative to the spec's own directory
 *   2. relative to an optional baseDir (e.g. an asset root at activation)
 *   3. as an absolute path
 * Returns { resolvedPath, status } where status is 'present' | 'missing'.
 */
function resolveRef(ref, specDir, baseDir) {
  const candidates = [];
  if (path.isAbsolute(ref)) {
    candidates.push(ref);
  } else {
    candidates.push(path.resolve(specDir, ref));
    if (baseDir) candidates.push(path.resolve(baseDir, ref));
  }
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return { resolvedPath: c, status: 'present' };
    } catch {
      /* keep trying */
    }
  }
  // Report the primary (spec-relative or absolute) candidate for the record.
  return { resolvedPath: candidates[0], status: 'missing' };
}

function computeClosureHash(specPath, opts = {}) {
  const fullSpecPath = path.resolve(specPath);
  const specDir = path.dirname(fullSpecPath);
  const baseDir = opts.baseDir ? path.resolve(opts.baseDir) : null;

  const specBytes = fs.readFileSync(fullSpecPath);
  const specSha256 = sha256Bytes(specBytes);

  let parsed;
  try {
    parsed = JSON.parse(specBytes.toString('utf8'));
  } catch (err) {
    throw new Error(`closure-hash: spec is not valid JSON: ${err.message}`);
  }

  const refs = new Set();
  collectRefs(parsed, null, refs);
  // Never treat the spec file itself as one of its own payloads.
  refs.delete(fullSpecPath);

  const manifest = [];
  for (const ref of Array.from(refs).sort()) {
    const { resolvedPath, status } = resolveRef(ref, specDir, baseDir);
    if (resolvedPath === fullSpecPath) continue;
    let sha = null;
    let bytes = null;
    if (status === 'present') {
      sha = sha256File(resolvedPath);
      bytes = fs.statSync(resolvedPath).size;
    }
    manifest.push({
      ref,
      resolvedPath,
      status,
      sha256: sha,
      bytes,
    });
  }

  const degraded = manifest.length === 0;

  // Canonical, stable pre-image. Sorted manifest + spec hash + version.
  // 'absent' stands in for a missing payload's content so that a
  // missing->present swap (or vice-versa) also perturbs the closure hash.
  const preimage = JSON.stringify({
    v: CLOSURE_HASH_VERSION,
    specSha256,
    payloads: manifest.map((m) => ({ ref: m.ref, sha256: m.sha256 || 'absent' })),
  });
  const closureHash = sha256Bytes(Buffer.from(preimage, 'utf8'));

  return {
    version: CLOSURE_HASH_VERSION,
    closureHash,
    specSha256,
    manifest,
    degraded,
    note: degraded
      ? 'No external payloads referenced by this spec; closure hash degrades to spec-bytes-only. Any spec referencing rebuildable assets (paths/*.tgz) will bind them here.'
      : `Closure covers spec bytes + ${manifest.length} referenced payload(s).`,
  };
}

module.exports = {
  CLOSURE_HASH_VERSION,
  computeClosureHash,
  // exported for tests / reuse
  sha256File,
  sha256Bytes,
};

// ---------------------------------------------------------------------------
// CLI: node closure-hash.js <spec.json> [--base-dir <dir>]
// Prints the closure hash + manifest as JSON. Read-only; activates nothing.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: node closure-hash.js <world-spec.json> [--base-dir <asset-root>]');
    process.exit(2);
  }
  const specPath = argv[0];
  let baseDir = null;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--base-dir' && argv[i + 1]) baseDir = argv[++i];
  }
  const result = computeClosureHash(specPath, { baseDir });
  console.log(JSON.stringify(result, null, 2));
}
