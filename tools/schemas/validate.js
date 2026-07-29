#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function typeMatches(expected, value) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

function validateNode(schema, value, pointer, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => {
      const nestedErrors = [];
      validateNode({ ...schema, oneOf: undefined, ...candidate }, value, pointer, nestedErrors);
      return nestedErrors.length === 0;
    });
    if (matches.length !== 1) {
      errors.push(`${pointer} must match exactly one oneOf branch`);
      return;
    }
  }

  if (schema.type !== undefined) {
    const expectedTypes = asArray(schema.type);
    if (!expectedTypes.some((type) => typeMatches(type, value))) {
      errors.push(`${pointer} expected type ${expectedTypes.join('|')}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pointer} must be one of ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${pointer} must be >= ${schema.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pointer} must have at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${pointer} must have at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(schema.items, item, `${pointer}/${index}`, errors));
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${pointer}/${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${pointer}/${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (value[key] !== undefined) validateNode(childSchema, value[key], `${pointer}/${key}`, errors);
    }
  }
}

function main() {
  const [, , schemaPath, dataPath] = process.argv;
  if (!schemaPath || !dataPath) {
    console.error('Usage: node tools/schemas/validate.js <schema.json> <data.json>');
    process.exit(2);
  }

  const schema = readJson(path.resolve(schemaPath));
  const data = readJson(path.resolve(dataPath));
  const errors = [];
  validateNode(schema, data, '', errors);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('valid');
}

if (require.main === module) main();

