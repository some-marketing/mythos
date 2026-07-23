'use strict';

const crypto = require('crypto');
const { sha256Bytes, stableJson } = require('./run-evidence-index.cjs');

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  return sha256Bytes(key.export({ type: 'spki', format: 'der' }));
}

function validateKeyring(keyring) {
  if (!keyring || keyring.schema !== 'OperatorPublicKeyring/1.0' || !Array.isArray(keyring.keys)) {
    return { ok: false, reason: 'invalid_keyring' };
  }
  const seen = new Set();
  let current = 0;
  for (const entry of keyring.keys) {
    if (!entry || !FINGERPRINT.test(String(entry.fingerprint || '')) || seen.has(entry.fingerprint)) {
      return { ok: false, reason: 'duplicate_or_invalid_key_fingerprint' };
    }
    seen.add(entry.fingerprint);
    try {
      if (publicKeyFingerprint(entry.public_key_pem) !== entry.fingerprint) return { ok: false, reason: 'changed_key_entry' };
    } catch (_) { return { ok: false, reason: 'invalid_public_key' }; }
    if (!['current', 'verification_only'].includes(entry.status)) return { ok: false, reason: 'invalid_key_status' };
    if (entry.status === 'current') current += 1;
  }
  if ((keyring.keys.length === 0 && keyring.current_fingerprint !== null) || current > 1) {
    return { ok: false, reason: 'invalid_current_key_count' };
  }
  if (keyring.keys.length > 0) {
    const selected = keyring.keys.find((entry) => entry.fingerprint === keyring.current_fingerprint);
    if (!selected || selected.status !== 'current' || current !== 1) return { ok: false, reason: 'current_key_mismatch' };
  }
  return { ok: true, reason: null };
}

function acceptanceSubject(receipt) {
  const fields = {
    schema: 'HumanAcceptanceReceipt/1.0',
    task_id: String(receipt.task_id || ''),
    acceptance_scope: String(receipt.acceptance_scope || ''),
    decision: String(receipt.decision || ''),
    structural_index_sha256: String(receipt.structural_index_sha256 || ''),
    semantic_receipt_sha256: String(receipt.semantic_receipt_sha256 || ''),
    semantic_child_index_sha256: receipt.semantic_child_index_sha256 || null,
    public_key_fingerprint: String(receipt.public_key_fingerprint || ''),
    actor_id: String(receipt.actor_id || ''),
    signed_at: String(receipt.signed_at || '')
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === '' && key !== 'semantic_child_index_sha256') throw new Error(`acceptance subject requires ${key}`);
  }
  if (!['accept', 'reject'].includes(fields.decision)) throw new Error('acceptance decision must be accept or reject');
  return stableJson(fields);
}

function signAcceptanceReceipt(unsignedReceipt, privateKeyPem) {
  const subject = acceptanceSubject(unsignedReceipt);
  return { ...unsignedReceipt, signature: crypto.sign(null, Buffer.from(subject), privateKeyPem).toString('base64') };
}

function verifyAcceptanceReceipt(receipt, keyring) {
  const ring = validateKeyring(keyring);
  if (!ring.ok) return ring;
  if (!receipt || receipt.schema !== 'HumanAcceptanceReceipt/1.0') return { ok: false, reason: 'invalid_acceptance_receipt' };
  const entry = keyring.keys.find((item) => item.fingerprint === receipt.public_key_fingerprint);
  if (!entry) return { ok: false, reason: 'unknown_key_fingerprint' };
  let subject;
  try { subject = acceptanceSubject(receipt); }
  catch (_) { return { ok: false, reason: 'invalid_acceptance_subject' }; }
  try {
    const ok = crypto.verify(null, Buffer.from(subject), entry.public_key_pem, Buffer.from(String(receipt.signature || ''), 'base64'));
    return { ok, reason: ok ? null : 'signature_mismatch' };
  } catch (_) { return { ok: false, reason: 'signature_verification_error' }; }
}

function appendPublicKey(keyring, publicKeyPem, createdAt) {
  const valid = validateKeyring(keyring);
  if (!valid.ok) throw new Error(valid.reason);
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (keyring.keys.some((entry) => entry.fingerprint === fingerprint)) throw new Error('public key already exists');
  return {
    schema: 'OperatorPublicKeyring/1.0',
    current_fingerprint: fingerprint,
    keys: keyring.keys.map((entry) => ({ ...entry, status: 'verification_only' })).concat({
      fingerprint, public_key_pem: publicKeyPem, status: 'current', created_at: createdAt || new Date().toISOString()
    })
  };
}

module.exports = { publicKeyFingerprint, validateKeyring, acceptanceSubject, signAcceptanceReceipt, verifyAcceptanceReceipt, appendPublicKey };
