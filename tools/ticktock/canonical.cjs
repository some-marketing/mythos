'use strict';

// tools/ticktock/canonical.cjs -- deterministic JSON projection and sha256.
//
// Every hash in /ticktock (charter_hash, lane_binding_hash, record_hash,
// manifest_hash, the benchmark fingerprint's dimension digests) is a sha256
// over a CANONICAL projection, and this file is the single definition of what
// "canonical" means. It exists as its own module rather than as a private
// helper inside charter.cjs because three independent surfaces need the same
// answer -- the charter, the journal, and the benchmark -- and a hash that two
// modules compute two slightly different ways is a hash that proves nothing.
//
// The rules, in full:
//   * object keys are emitted in ascending Unicode code-point order, recursively
//   * arrays keep their order (order is meaning: assignment_order, tick order)
//   * undefined-valued keys are dropped; explicit null is KEPT and is distinct
//     from absent, because "checked and found nothing" and "never checked" are
//     different claims and the journal depends on telling them apart
//   * no whitespace, no trailing newline
//   * numbers are emitted by JSON.stringify (IEEE-754 shortest round-trip)
//
// Nothing here reads the filesystem or the clock.

const crypto = require('node:crypto');

function canonicalize(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: non-finite number (${value}) has no canonical form`);
    }
    return JSON.stringify(value);
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t === 'undefined') {
    throw new Error('canonicalize: undefined has no canonical form (drop the key instead)');
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
  }
  if (t === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported type ${t}`);
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// Hash a document with a set of fields removed. Used for every self-referential
// hash: a document cannot contain the hash of itself including that hash, so
// the field being computed is always excluded from its own input.
function hashObject(obj, omitKeys = []) {
  const projection = {};
  for (const k of Object.keys(obj)) {
    if (omitKeys.includes(k)) continue;
    if (obj[k] === undefined) continue;
    projection[k] = obj[k];
  }
  return sha256Hex(canonicalize(projection));
}

function sha256File(fs, filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

module.exports = { canonicalize, sha256Hex, hashObject, sha256File };
