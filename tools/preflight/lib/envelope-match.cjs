'use strict';

// Pure functions for matching a permission envelope against on-disk Claude
// settings. No I/O, no process state — callers pass in parsed JSON and get
// back a deterministic match report.

const ENVELOPE_VERSION = '1.0.0';

const KNOWN_FIELDS = new Set([
  'envelope_version', 'task_id', 'description',
  'bash_prefixes', 'write_surfaces', 'mcp_connections',
  'persistent_safe_subset', 'operator_gated', 'modeled_against'
]);

const MODELED_AGAINST_REQUIRED_KEYS = [
  'harness', 'harness_version', 'anchored_as_of', 'known_behaviors', 'adapter_note'
];

const HARNESS_VERSION_PATTERN = /^[a-z][a-z0-9-]*@observed-\d{4}-\d{2}-\d{2}$/;
const ANCHORED_AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateModeledAgainst(ma, errors) {
  if (ma === undefined) return;
  if (ma === null || typeof ma !== 'object' || Array.isArray(ma)) {
    errors.push('modeled_against must be an object when present');
    return;
  }
  for (const key of MODELED_AGAINST_REQUIRED_KEYS) {
    if (!(key in ma)) {
      errors.push(`modeled_against missing required key: ${JSON.stringify(key)}`);
    }
  }
  for (const key of Object.keys(ma)) {
    if (!MODELED_AGAINST_REQUIRED_KEYS.includes(key)) {
      errors.push(`modeled_against contains unknown key: ${JSON.stringify(key)}`);
    }
  }
  if ('harness' in ma && (typeof ma.harness !== 'string' || ma.harness.length === 0)) {
    errors.push('modeled_against.harness must be a non-empty string');
  }
  if ('harness_version' in ma) {
    if (typeof ma.harness_version !== 'string') {
      errors.push('modeled_against.harness_version must be a string');
    } else if (!HARNESS_VERSION_PATTERN.test(ma.harness_version)) {
      errors.push(`modeled_against.harness_version must match '<harness>@observed-YYYY-MM-DD'; got ${JSON.stringify(ma.harness_version)}`);
    }
  }
  if ('anchored_as_of' in ma) {
    if (typeof ma.anchored_as_of !== 'string' || !ANCHORED_AS_OF_PATTERN.test(ma.anchored_as_of)) {
      errors.push(`modeled_against.anchored_as_of must be ISO-8601 YYYY-MM-DD; got ${JSON.stringify(ma.anchored_as_of)}`);
    }
  }
  if ('known_behaviors' in ma) {
    if (!Array.isArray(ma.known_behaviors)) {
      errors.push('modeled_against.known_behaviors must be an array');
    } else {
      for (let i = 0; i < ma.known_behaviors.length; i++) {
        const item = ma.known_behaviors[i];
        if (typeof item !== 'string' || item.length === 0) {
          errors.push(`modeled_against.known_behaviors[${i}] must be a non-empty string`);
        }
      }
    }
  }
  if ('adapter_note' in ma && typeof ma.adapter_note !== 'string') {
    errors.push('modeled_against.adapter_note must be a string');
  }
}

function validateStringArray(field, arr, errors) {
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== 'string') {
      errors.push(`${field}[${i}] must be a string; got ${typeof item}`);
      continue;
    }
    if (item.length === 0) {
      errors.push(`${field}[${i}] must be a non-empty string`);
      continue;
    }
    if (seen.has(item)) {
      errors.push(`${field} contains duplicate item: ${JSON.stringify(item)}`);
    }
    seen.add(item);
  }
}

function loadAllowSet(settingsDocs) {
  const allow = new Set();
  for (const doc of settingsDocs) {
    if (!doc || typeof doc !== 'object') continue;
    const list = doc.permissions && doc.permissions.allow;
    if (!Array.isArray(list)) continue;
    for (const pattern of list) {
      if (typeof pattern === 'string' && pattern.length > 0) {
        allow.add(pattern);
      }
    }
  }
  return allow;
}

function validateEnvelopeShape(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object') {
    errors.push('envelope must be a JSON object');
    return errors;
  }
  if (envelope.envelope_version !== ENVELOPE_VERSION) {
    errors.push(`envelope_version must be "${ENVELOPE_VERSION}"; got ${JSON.stringify(envelope.envelope_version)}`);
  }
  if (typeof envelope.task_id !== 'string' || envelope.task_id.length === 0) {
    errors.push('task_id must be a non-empty string');
  }
  for (const key of Object.keys(envelope)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push(`unknown field: ${JSON.stringify(key)}`);
    }
  }
  for (const field of ['bash_prefixes', 'write_surfaces', 'mcp_connections']) {
    if (!Array.isArray(envelope[field])) {
      errors.push(`${field} must be an array`);
    } else {
      validateStringArray(field, envelope[field], errors);
    }
  }
  for (const field of ['persistent_safe_subset', 'operator_gated']) {
    if (envelope[field] !== undefined && !Array.isArray(envelope[field])) {
      errors.push(`${field} must be an array when present`);
    } else if (Array.isArray(envelope[field])) {
      validateStringArray(field, envelope[field], errors);
    }
  }
  validateModeledAgainst(envelope.modeled_against, errors);
  if (Array.isArray(envelope.bash_prefixes) && Array.isArray(envelope.persistent_safe_subset)) {
    const declared = new Set(envelope.bash_prefixes);
    for (const p of envelope.persistent_safe_subset) {
      if (typeof p === 'string' && !declared.has(p)) {
        errors.push(`persistent_safe_subset contains pattern not present in bash_prefixes: ${JSON.stringify(p)}`);
      }
    }
  }
  return errors;
}

function matchBashPrefixes(envelope, allowSet) {
  const required = Array.isArray(envelope.bash_prefixes) ? envelope.bash_prefixes : [];
  const present = [];
  const missing = [];
  for (const pattern of required) {
    if (allowSet.has(pattern)) {
      present.push(pattern);
    } else {
      missing.push(pattern);
    }
  }
  return { required: required.length, present, missing };
}

module.exports = {
  ENVELOPE_VERSION,
  KNOWN_FIELDS,
  loadAllowSet,
  validateEnvelopeShape,
  matchBashPrefixes
};
