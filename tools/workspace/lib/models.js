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

function validateObjectFields(obj, schema, label) {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((key) => !(key in obj));
  if (missing.length) {
    throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
  }

  const properties = schema.properties || {};
  for (const [key, rule] of Object.entries(properties)) {
    if (!(key in obj)) continue;
    validateSchemaValue(obj[key], rule, `${label}.${key}`);
  }
}

function validateSchemaValue(obj, schema, label) {
  if (Array.isArray(schema.enum) && !schema.enum.includes(obj)) {
    throw new Error(`${label} must be one of: ${schema.enum.join(', ')}`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(obj)) {
      throw new Error(`${label} must be an array`);
    }
    if (schema.items) {
      obj.forEach((item, index) => validateSchemaValue(item, schema.items, `${label}[${index}]`));
    }
  }
  if (schema.type === 'object') {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      throw new Error(`${label} must be an object`);
    }
    validateObjectFields(obj, schema, label);
  }
  if (schema.type === 'string' && typeof obj !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  if (schema.type === 'boolean' && typeof obj !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function validateRequiredFields(obj, schema, label) {
  if (schema.type === 'array') {
    validateSchemaValue(obj, schema, label);
    return;
  }
  validateObjectFields(obj, schema, label);
}

function validateNamedModel(name, obj, label) {
  validateRequiredFields(obj, loadSchema(name), label);
}

module.exports = {
  loadSchema,
  validateNamedModel,
  validateRequiredFields
};
