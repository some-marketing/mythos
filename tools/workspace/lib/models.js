'use strict';

const path = require('path');
const { exists, readJson } = require('./fs');

const SCHEMA_DIR = path.join(__dirname, '..', 'schemas');

function loadSchema(name) {
  const filePath = path.join(SCHEMA_DIR, name);
  if (!exists(filePath)) {
    throw new Error(`Schema not found: ${filePath}`);
  }
  return readJson(filePath);
}

function validateRequiredFields(obj, schema, label) {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((key) => !(key in obj));
  if (missing.length) {
    throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
  }

  const properties = schema.properties || {};
  for (const [key, rule] of Object.entries(properties)) {
    if (!(key in obj)) continue;
    if (Array.isArray(rule.enum) && !rule.enum.includes(obj[key])) {
      throw new Error(`${label}.${key} must be one of: ${rule.enum.join(', ')}`);
    }
    if (rule.type === 'array' && !Array.isArray(obj[key])) {
      throw new Error(`${label}.${key} must be an array`);
    }
    if (rule.type === 'object' && (typeof obj[key] !== 'object' || obj[key] === null || Array.isArray(obj[key]))) {
      throw new Error(`${label}.${key} must be an object`);
    }
    if (rule.type === 'string' && typeof obj[key] !== 'string') {
      throw new Error(`${label}.${key} must be a string`);
    }
    if (rule.type === 'boolean' && typeof obj[key] !== 'boolean') {
      throw new Error(`${label}.${key} must be a boolean`);
    }
  }
}

function validateNamedModel(name, obj, label) {
  validateRequiredFields(obj, loadSchema(name), label);
}

module.exports = {
  loadSchema,
  validateNamedModel,
  validateRequiredFields
};
