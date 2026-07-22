'use strict';

const fs = require('fs');

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function resolveRef(ref, rootSchema) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;

  const parts = ref.slice(2).split('/');
  let current = rootSchema;

  for (const rawPart of parts) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !(part in current)) return null;
    current = current[part];
  }

  return current;
}

function validate(data, schema, options = {}) {
  const rootSchema = options.rootSchema || schema;
  const dataPath = options.path || '';
  const errors = [];

  if (!schema || typeof schema !== 'object') return errors;

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema);
    if (!resolved) {
      errors.push({ path: dataPath, message: `Unresolvable $ref: ${schema.$ref}` });
      return errors;
    }
    return validate(data, resolved, { rootSchema, path: dataPath });
  }

  if (schema.anyOf) {
    const valid = schema.anyOf.some((sub) => validate(data, sub, { rootSchema, path: dataPath }).length === 0);
    if (!valid) {
      errors.push({ path: dataPath, message: 'Value does not match any allowed schema shape' });
    }
    return errors;
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = jsonType(data);
    const matches = allowedTypes.some((type) => {
      if (type === 'integer') return typeof data === 'number' && Number.isInteger(data);
      return type === actualType;
    });

    if (!matches) {
      errors.push({ path: dataPath, message: `Expected type ${allowedTypes.join('|')}, got ${actualType}` });
      return errors;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push({ path: dataPath, message: `Value must be one of: ${schema.enum.join(', ')}` });
    return errors;
  }

  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push({ path: dataPath, message: `String length ${data.length} < minLength ${schema.minLength}` });
    }
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path: dataPath, message: `Value ${data} < minimum ${schema.minimum}` });
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path: dataPath, message: `Array length ${data.length} < minItems ${schema.minItems}` });
    }

    if (schema.items) {
      for (let i = 0; i < data.length; i += 1) {
        errors.push(...validate(data[i], schema.items, { rootSchema, path: `${dataPath}/${i}` }));
      }
    }
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in data)) {
        errors.push({ path: `${dataPath}/${key}`, message: `Missing required property: ${key}` });
      }
    }

    const properties = schema.properties || {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in data) {
        errors.push(...validate(data[key], propSchema, { rootSchema, path: `${dataPath}/${key}` }));
      }
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${dataPath}/${key}`, message: `Additional property not allowed: ${key}` });
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const known = new Set(Object.keys(properties));
      for (const [key, value] of Object.entries(data)) {
        if (!known.has(key)) {
          errors.push(...validate(value, schema.additionalProperties, { rootSchema, path: `${dataPath}/${key}` }));
        }
      }
    }
  }

  return errors;
}

function validateWithSchemaFile(filePath, schemaPath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return validate(data, schema, { rootSchema: schema, path: '' });
}

module.exports = {
  validate,
  validateWithSchemaFile
};
