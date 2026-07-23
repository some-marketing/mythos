'use strict';

/**
 * retrieval-adapter.cjs — Control Loop's consumer-side seam for the
 * Retrieval lobe's tag contract.
 *
 * HAND-OFF SEAM:
 *   Until the Retrieval lobe ships its authoritative schema module, this
 *   adapter imports the placeholder schema colocated at
 *   tools/kernel/lib/kernel-artifact-tag-schema.placeholder.json. When
 *   Retrieval lands, ONLY the SCHEMA_IMPORT_PATH constant below changes
 *   — no other Control Loop code changes.
 *
 * Contract (stable across the swap):
 *   - getSchema() → returns the JSON schema object
 *   - validateFrontmatter(fm) → { ok: boolean, missing: string[], findings: string[] }
 *
 * No LLM calls. No network. Pure set-compare against the six required
 * fields declared by _dev/concepts/retrieval-lobe/concept.md:46.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_IMPORT_PATH = path.resolve(
  __dirname,
  'kernel-artifact-tag-schema.json'
);

let _schemaCache = null;

function getSchema() {
  if (_schemaCache) return _schemaCache;
  const raw = fs.readFileSync(SCHEMA_IMPORT_PATH, 'utf8');
  _schemaCache = JSON.parse(raw);
  return _schemaCache;
}

/**
 * Validate a frontmatter object against the six required fields.
 * @param {object} fm - parsed YAML frontmatter object
 * @returns {{ ok: boolean, missing: string[], findings: string[] }}
 */
function validateFrontmatter(fm) {
  const schema = getSchema();
  const required = schema.required || [];
  const findings = [];
  const missing = [];
  if (!fm || typeof fm !== 'object') {
    return {
      ok: false,
      missing: required.slice(),
      findings: ['frontmatter_absent_or_non_object']
    };
  }
  for (const key of required) {
    if (!(key in fm)) {
      missing.push(key);
      findings.push(`missing_required_field:${key}`);
      continue;
    }
    const prop = (schema.properties || {})[key];
    if (prop && prop.type === 'array' && !Array.isArray(fm[key])) {
      findings.push(`type_mismatch:${key}:expected_array`);
    }
    if (prop && prop.type === 'string' && typeof fm[key] !== 'string') {
      findings.push(`type_mismatch:${key}:expected_string`);
    }
    if (prop && prop.enum && !prop.enum.includes(fm[key])) {
      findings.push(`enum_mismatch:${key}:${String(fm[key])}`);
    }
  }
  return {
    ok: missing.length === 0 && findings.length === 0,
    missing,
    findings
  };
}

/**
 * Parse YAML frontmatter from a markdown file string. Minimal hand-rolled
 * parser — handles list syntax (inline [a, b] and block `- item`) and
 * scalar key: value. No dependencies. Good enough for the six declared
 * fields; will be replaced when Retrieval lobe ships.
 *
 * @param {string} text
 * @returns {object|null}
 */
function parseFrontmatterFromMarkdown(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!m) return null;
  const body = m[1];
  const obj = {};
  const lines = body.split(/\r?\n/);
  let currentKey = null;
  let currentList = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    // list item under block list
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentList) {
      currentList.push(listItem[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const kv = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    currentKey = kv[1];
    const rawVal = kv[2];
    if (rawVal === '' || rawVal === null) {
      currentList = [];
      obj[currentKey] = currentList;
      continue;
    }
    // inline array
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1).trim();
      if (inner === '') {
        obj[currentKey] = [];
      } else {
        obj[currentKey] = inner
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      }
      currentList = null;
      continue;
    }
    obj[currentKey] = rawVal.trim().replace(/^['"]|['"]$/g, '');
    currentList = null;
  }
  return obj;
}

module.exports = {
  SCHEMA_IMPORT_PATH,
  getSchema,
  validateFrontmatter,
  parseFrontmatterFromMarkdown
};
