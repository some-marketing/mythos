'use strict';

const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest('hex');
}

function stableJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number_unsupported');
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object') throw new TypeError('non_json_value_unsupported');
  if (seen.has(value)) throw new TypeError('cyclic_value_unsupported');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError('non_json_object_unsupported');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stableJson(item, seen)).join(',')}]`;
  } else {
    result = `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`)
      .join(',')}}`;
  }
  seen.delete(value);
  return result;
}

function normalizedContentHash(value, options = {}) {
  try {
    if (options.format === 'json') {
      const parsed = typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(value.toString()) : value;
      return { state: 'bound', normalization: 'canonical_json', sha256: sha256(stableJson(parsed)), byte_sha256: sha256(Buffer.isBuffer(value) ? value : String(value)) };
    }
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    return { state: 'bound', normalization: 'opaque_bytes', sha256: sha256(bytes), byte_sha256: sha256(bytes) };
  } catch (error) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    return { state: 'unsupported', normalization: 'opaque_bytes', sha256: sha256(bytes), byte_sha256: sha256(bytes), reason: String(error.message || 'normalization_failed') };
  }
}

module.exports = { normalizedContentHash, sha256, stableJson };
