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
  validateValue(obj, schema, label);
}

function validateValue(value, rule, label) {
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
    throw new Error(`${label} must be one of: ${rule.enum.join(', ')}`);
  }
  if (rule.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    if (Number.isInteger(rule.minItems) && value.length < rule.minItems) {
      throw new Error(`${label} must contain at least ${rule.minItems} items`);
    }
    if (rule.items) {
      value.forEach((item, index) => validateValue(item, rule.items, `${label}[${index}]`));
    }
    return;
  }
  if (rule.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    const required = Array.isArray(rule.required) ? rule.required : [];
    const missing = required.filter((key) => !(key in value));
    if (missing.length) {
      throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
    }
    for (const [key, childRule] of Object.entries(rule.properties || {})) {
      if (key in value) validateValue(value[key], childRule, `${label}.${key}`);
    }
    return;
  }
  if (rule.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${label} must be a string`);
    if (Number.isInteger(rule.minLength) && value.length < rule.minLength) {
      throw new Error(`${label} must contain at least ${rule.minLength} characters`);
    }
    return;
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  if (rule.type === 'integer' && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
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
