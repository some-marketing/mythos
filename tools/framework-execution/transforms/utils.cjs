'use strict';

const crypto = require('node:crypto');

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number_unsupported');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('non_json_object_unsupported');
    return `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError('undefined_value_unsupported');
      return `${JSON.stringify(key)}:${stableJson(value[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError('non_json_value_unsupported');
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function makeRecord(fields) {
  const core = {
    transform: fields.transform,
    state: fields.state,
    source_refs: fields.source_refs || [],
    input_sha256: fields.input_sha256 || [],
    observation: fields.observation === undefined ? null : fields.observation,
    reason: fields.reason || null
  };
  return {
    schema: 'MechanicalTransformRecord/1.0',
    record_id: `mtr_${sha256(stableJson(core)).slice(0, 24)}`,
    ...core,
    semantic_acceptance: 'not_evaluated',
    operator_acceptance: 'not_evaluated'
  };
}

module.exports = { makeRecord, sha256, stableJson };
