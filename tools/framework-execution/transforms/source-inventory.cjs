'use strict';

const crypto = require('node:crypto');
const { makeRecord, sha256 } = require('./utils.cjs');

function digest(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest('hex');
}

function inventorySources(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const sourceRef = String(entry && entry.source_ref || 'unknown');
    const sourceRefHash = `sha256:${sha256(sourceRef)}`;
    if (!entry || entry.supported === false) {
      return makeRecord({ transform: 'source_inventory', state: 'unsupported', source_refs: [sourceRefHash], reason: 'source_format_unsupported' });
    }
    if (entry.uncertain === true || entry.bytes === undefined || entry.bytes === null) {
      return makeRecord({ transform: 'source_inventory', state: 'unknown', source_refs: [sourceRefHash], reason: entry.uncertain ? 'source_observation_uncertain' : 'source_bytes_missing' });
    }
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(String(entry.bytes));
    const inputSha = digest(bytes);
    return makeRecord({
      transform: 'source_inventory',
      state: 'exact',
      source_refs: [sourceRefHash],
      input_sha256: [inputSha],
      observation: { byte_length: bytes.length, media_type: String(entry.media_type || 'application/octet-stream') }
    });
  });
}

module.exports = { inventorySources };
