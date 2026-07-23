#!/usr/bin/env node
'use strict';

// tools/soul-space/validate-soul-space.js — content-addressed identity/
// provenance validator.
//
// Enforces the invariants JSON Schema alone cannot express: subject-record
// content-hash recomputation and immutability, binding hash-binding to a
// subject-record, version/provenance chain shape, and rejection of
// self-claimed attestation.
//
// This is a generic mechanism, not a specific domain vocabulary — see
// schema/subject-record.schema.json and schema/binding.schema.json for the
// extension points (attributes) a concrete deployment fills in.
//
// No network. No external calls. Deterministic.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const SUBJECT_RECORD_SCHEMA = require('./schema/subject-record.schema.json');
const BINDING_SCHEMA = require('./schema/binding.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSubjectRecordShape = ajv.compile(SUBJECT_RECORD_SCHEMA);
const validateBindingShape = ajv.compile(BINDING_SCHEMA);

// Deep-canonical JSON stringify: object keys sorted at every nesting level.
// NOTE: JSON.stringify's array-form replacer filters property names at
// every depth of the tree, not just the top level — passing a top-level key
// list as replacer silently drops any nested field whose name isn't itself
// in that list. Recursing manually avoids that trap.
function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

// content-hash is computed over every field EXCEPT content_hash and
// provenance_chain itself (the chain records hash history; it isn't hashed
// into the value it's tracking, or every append would change the hash it
// just recorded).
function computeContentHash(record) {
  const { content_hash, provenance_chain, ...hashable } = record;
  const canonical = canonicalStringify(hashable);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// IMMUTABILITY: the subject-record's content_hash must equal a fresh
// recomputation over its own fields. A document whose stored hash doesn't
// match its content is either tampered with or an in-place mutation that
// forgot to bump version + recompute — either way, reject.
function checkImmutability(record, errors) {
  const recomputed = computeContentHash(record);
  if (record.content_hash !== recomputed) {
    errors.push({
      invariant: 'IMMUTABILITY',
      message: `content_hash mismatch: stored "${record.content_hash}" does not match recomputed "${recomputed}". In-place mutation without a new version + provenance entry is rejected.`
    });
  }
}

// bindings must bind to a subject-record by a hash that actually matches
// that record's current, freshly-recomputed content_hash — not a stale or
// absent one.
function checkHashBinding(binding, record, errors) {
  const recomputed = computeContentHash(record);
  if (binding.bound_hash !== recomputed) {
    errors.push({
      invariant: 'HASH_BINDING',
      message: `binding.bound_hash "${binding.bound_hash}" does not match the bound subject-record's current content_hash "${recomputed}". Stale or absent hash binding is rejected.`
    });
  }
}

// VERSIONED CONTRACT: every version bump must carry a provenance entry
// recording who/why/when. A version with no matching provenance_chain entry
// is an unprovenanced change.
function checkVersionProvenance(record, errors) {
  const chain = Array.isArray(record.provenance_chain) ? record.provenance_chain : [];
  const hasEntryForVersion = chain.some((entry) => entry && entry.version === record.version);
  if (!hasEntryForVersion) {
    errors.push({
      invariant: 'VERSION_PROVENANCE',
      message: `version "${record.version}" has no matching entry in provenance_chain. A version bump without a recorded who/why/when is rejected.`
    });
  }
}

// ATTESTATION PROVENANCE: if attestation is present at all, it MUST carry
// verifier_provenance with a non-empty eval_id and verifier_id. The
// schema's required-fields-when-present already enforces shape; this check
// additionally rejects the self-claim pattern of a verifier_id equal to the
// subject's own subject_id (e.g. the subject naming itself as its own
// verifier).
function checkAttestationProvenance(record, errors) {
  if (record.attestation === undefined) return;
  const vp = record.attestation.verifier_provenance;
  if (!vp || !vp.eval_id || !vp.verifier_id) {
    errors.push({
      invariant: 'ATTESTATION_PROVENANCE',
      message: 'attestation present without a complete verifier_provenance (eval_id + verifier_id). Self-claimed attestation is rejected.'
    });
    return;
  }
  if (String(vp.verifier_id).trim().toLowerCase() === String(record.subject_id || '').trim().toLowerCase()) {
    errors.push({
      invariant: 'ATTESTATION_PROVENANCE',
      message: 'attestation.verifier_provenance.verifier_id matches the subject\'s own subject_id — a subject cannot attest its own record. Self-claimed attestation is rejected.'
    });
  }
}

// Public: validate a subject-record document. Returns { valid, errors }.
function validateSubjectRecord(record) {
  const errors = [];
  const shapeValid = validateSubjectRecordShape(record);
  if (!shapeValid) {
    for (const e of validateSubjectRecordShape.errors || []) {
      errors.push({ invariant: 'SCHEMA_SHAPE', message: `${e.instancePath || '(root)'} ${e.message}` });
    }
    // Shape errors can make the hash/provenance checks meaningless (e.g.
    // missing content_hash) — still attempt them for a richer error report,
    // but don't let a crash here hide the shape errors already collected.
  }
  try {
    checkImmutability(record, errors);
    checkVersionProvenance(record, errors);
    checkAttestationProvenance(record, errors);
  } catch (e) {
    errors.push({ invariant: 'VALIDATOR_INTERNAL', message: e.message });
  }
  return { valid: errors.length === 0, errors };
}

// Public: validate a binding document against the subject-record it claims
// to bind to. Returns { valid, errors }.
function validateBinding(binding, record) {
  const errors = [];
  const shapeValid = validateBindingShape(binding);
  if (!shapeValid) {
    for (const e of validateBindingShape.errors || []) {
      errors.push({ invariant: 'SCHEMA_SHAPE', message: `${e.instancePath || '(root)'} ${e.message}` });
    }
  }
  try {
    if (record) checkHashBinding(binding, record, errors);
  } catch (e) {
    errors.push({ invariant: 'VALIDATOR_INTERNAL', message: e.message });
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  computeContentHash,
  validateSubjectRecord,
  validateBinding
};

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write('usage: validate-soul-space.js <subject-record.json> [binding.json]\n');
    process.exit(2);
  }
  const record = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
  const recordResult = validateSubjectRecord(record);
  let out = { record: recordResult };
  const bindingPath = process.argv[3];
  if (bindingPath) {
    const binding = JSON.parse(fs.readFileSync(path.resolve(bindingPath), 'utf8'));
    out.binding = validateBinding(binding, record);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  const allValid = out.record.valid && (!out.binding || out.binding.valid);
  process.exit(allValid ? 0 : 1);
}
