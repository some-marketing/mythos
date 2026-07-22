/**
 * Lightweight JSON Schema validator (draft-2020-12 subset).
 * No external dependencies — uses only Node.js builtins.
 *
 * Supports: type, required, properties, items, enum, const, pattern,
 *           minimum, maximum, minItems, maxItems, minLength, maxLength,
 *           format (date-time only), additionalProperties,
 *           if/then/else, anyOf, allOf, oneOf, $ref (same-file only).
 */

import fs from 'fs';
import path from 'path';

/**
 * @typedef {Object} ValidationError
 * @property {string} path - JSON pointer to the failing location
 * @property {string} message - Human-readable error description
 * @property {string} [schemaPath] - JSON pointer into the schema
 */

/**
 * Validate a value against a JSON Schema.
 * @param {*} data - The value to validate
 * @param {object} schema - JSON Schema object
 * @param {object} [options]
 * @param {object} [options.rootSchema] - Root schema for $ref resolution
 * @param {string} [options.path] - Current data path (for error messages)
 * @returns {ValidationError[]} Array of errors (empty = valid)
 */
export function validate(data, schema, options = {}) {
  const rootSchema = options.rootSchema || schema;
  const dataPath = options.path || '';
  const errors = [];

  if (!schema || typeof schema !== 'object') return errors;

  // $ref resolution (same-file only)
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema);
    if (resolved) {
      return validate(data, resolved, { rootSchema, path: dataPath });
    }
    errors.push({ path: dataPath, message: `Unresolvable $ref: ${schema.$ref}` });
    return errors;
  }

  // allOf
  if (schema.allOf) {
    for (const sub of schema.allOf) {
      errors.push(...validate(data, sub, { rootSchema, path: dataPath }));
    }
  }

  // anyOf
  if (schema.anyOf) {
    const anyValid = schema.anyOf.some(
      sub => validate(data, sub, { rootSchema, path: dataPath }).length === 0
    );
    if (!anyValid) {
      errors.push({ path: dataPath, message: `Value does not match any of the anyOf schemas` });
    }
  }

  // oneOf
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      sub => validate(data, sub, { rootSchema, path: dataPath }).length === 0
    );
    if (matches.length !== 1) {
      errors.push({ path: dataPath, message: `Value must match exactly one of oneOf schemas (matched ${matches.length})` });
    }
  }

  // if/then/else
  if (schema.if) {
    const ifValid = validate(data, schema.if, { rootSchema, path: dataPath }).length === 0;
    if (ifValid && schema.then) {
      errors.push(...validate(data, schema.then, { rootSchema, path: dataPath }));
    }
    if (!ifValid && schema.else) {
      errors.push(...validate(data, schema.else, { rootSchema, path: dataPath }));
    }
  }

  // const
  if (schema.const !== undefined) {
    if (!deepEqual(data, schema.const)) {
      errors.push({ path: dataPath, message: `Expected constant value ${JSON.stringify(schema.const)}` });
    }
  }

  // enum
  if (schema.enum) {
    if (!schema.enum.some(v => deepEqual(data, v))) {
      errors.push({ path: dataPath, message: `Value must be one of: ${schema.enum.map(v => JSON.stringify(v)).join(', ')}` });
    }
  }

  // type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(data);
    // "integer" is a JSON Schema type but jsonType() returns "number"
    const matches = types.some(t => {
      if (t === 'integer') return typeof data === 'number' && Number.isInteger(data);
      return t === actual;
    });
    if (!matches) {
      errors.push({ path: dataPath, message: `Expected type ${types.join('|')}, got ${actual}` });
      return errors; // Type mismatch → skip deeper checks
    }
  }

  // String checks
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({ path: dataPath, message: `String length ${data.length} < minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push({ path: dataPath, message: `String length ${data.length} > maxLength ${schema.maxLength}` });
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern);
      if (!re.test(data)) {
        errors.push({ path: dataPath, message: `String does not match pattern: ${schema.pattern}` });
      }
    }
    if (schema.format === 'date-time') {
      if (isNaN(Date.parse(data))) {
        errors.push({ path: dataPath, message: `Invalid date-time format` });
      }
    }
  }

  // Number checks
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path: dataPath, message: `Value ${data} < minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ path: dataPath, message: `Value ${data} > maximum ${schema.maximum}` });
    }
  }

  // Array checks
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path: dataPath, message: `Array length ${data.length} < minItems ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ path: dataPath, message: `Array length ${data.length} > maxItems ${schema.maxItems}` });
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        errors.push(...validate(data[i], schema.items, { rootSchema, path: `${dataPath}/${i}` }));
      }
    }
  }

  // Object checks
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) {
          errors.push({ path: `${dataPath}/${key}`, message: `Missing required property: ${key}` });
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          errors.push(...validate(data[key], propSchema, { rootSchema, path: `${dataPath}/${key}` }));
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${dataPath}/${key}`, message: `Additional property not allowed: ${key}` });
        }
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const [key, val] of Object.entries(data)) {
        if (!known.has(key)) {
          errors.push(...validate(val, schema.additionalProperties, { rootSchema, path: `${dataPath}/${key}` }));
        }
      }
    }
  }

  return errors;
}

/**
 * Load a schema from disk and validate data against it.
 * @param {*} data
 * @param {string} schemaPath - Absolute path to the .schema.json file
 * @returns {ValidationError[]}
 */
export function validateWithFile(data, schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  return validate(data, schema);
}

/**
 * Load all schemas from the schemas/ directory.
 * @param {string} [schemasDir] - Override path to schemas directory
 * @returns {Map<string, object>} Map of filename → parsed schema
 */
export function loadSchemas(schemasDir) {
  const dir = schemasDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'schemas');
  const map = new Map();
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.schema.json')) {
      map.set(entry, JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf-8')));
    }
  }
  return map;
}

// --- Internal helpers ---

function jsonType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val; // 'string', 'number', 'boolean', 'object'
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let current = root;
  for (const part of parts) {
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current && typeof current === 'object' && decoded in current) {
      current = current[decoded];
    } else {
      return null;
    }
  }
  return current;
}

export default { validate, validateWithFile, loadSchemas };
