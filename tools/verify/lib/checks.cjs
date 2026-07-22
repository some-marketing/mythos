/**
 * checks.cjs — Reusable verification check factories for Mythos.
 *
 * Each function returns a check-options object for addCheck().
 * The `test` property is a function returning true (pass) or false (fail).
 */

const fs = require('fs');
const path = require('path');
const { validateWithSchemaFile } = require('./schema.cjs');

function fileExists(filePath, { id, category = 'structure', severity = 'critical', message } = {}) {
  return {
    id: id || `file_exists.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `File exists: ${filePath}`,
    evidence: filePath,
    test: () => fs.existsSync(filePath),
    fix_hint: `Create or restore the file at ${filePath}`
  };
}

function dirExists(dirPath, { id, category = 'structure', severity = 'critical', message } = {}) {
  return {
    id: id || `dir_exists.${path.basename(dirPath)}`,
    category,
    severity,
    message: message || `Directory exists: ${dirPath}`,
    evidence: dirPath,
    test: () => { try { return fs.statSync(dirPath).isDirectory(); } catch { return false; } },
    fix_hint: `Create the directory at ${dirPath}`
  };
}

function jsonValid(filePath, { id, category = 'structure', severity = 'critical', message } = {}) {
  return {
    id: id || `json_valid.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `Valid JSON: ${filePath}`,
    evidence: filePath,
    test: () => {
      try { JSON.parse(fs.readFileSync(filePath, 'utf8')); return true; }
      catch { return false; }
    },
    fix_hint: `Fix JSON syntax errors in ${filePath}`
  };
}

function jsonHasKeys(filePath, keys, { id, category = 'manifest', severity = 'critical', message } = {}) {
  return {
    id: id || `json_keys.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `JSON has keys: ${keys.join(', ')}`,
    evidence: filePath,
    test: () => {
      try {
        const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return keys.every(key => {
          const parts = key.split('.');
          let current = obj;
          for (const part of parts) {
            if (current == null || typeof current !== 'object' || !(part in current)) return false;
            current = current[part];
          }
          return true;
        });
      } catch { return false; }
    },
    get detail() {
      try {
        const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const missing = keys.filter(key => {
          const parts = key.split('.');
          let current = obj;
          for (const part of parts) {
            if (current == null || typeof current !== 'object' || !(part in current)) return true;
            current = current[part];
          }
          return false;
        });
        return missing.length ? `Missing: ${missing.join(', ')}` : 'All keys present';
      } catch (e) { return `Parse error: ${e.message}`; }
    },
    fix_hint: `Add missing keys to ${filePath}: ${keys.join(', ')}`
  };
}

function fileMinSize(filePath, minBytes, { id, category = 'structure', severity = 'warning', message } = {}) {
  return {
    id: id || `min_size.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `File >= ${minBytes} bytes: ${filePath}`,
    evidence: filePath,
    test: () => {
      try { return fs.statSync(filePath).size >= minBytes; }
      catch { return false; }
    },
    get detail() {
      try { return `${fs.statSync(filePath).size} bytes`; }
      catch { return 'File not found'; }
    },
    fix_hint: `File ${filePath} is too small (min ${minBytes} bytes)`
  };
}

function yamlHasFrontmatter(filePath, requiredFields = [], { id, category = 'structure', severity = 'critical', message } = {}) {
  return {
    id: id || `yaml_fm.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `YAML frontmatter with: ${requiredFields.join(', ')}`,
    evidence: filePath,
    test: () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.startsWith('---')) return false;
        const endIdx = content.indexOf('---', 3);
        if (endIdx === -1) return false;
        const frontmatter = content.slice(3, endIdx);
        return requiredFields.every(field => new RegExp(`^${field}:`, 'm').test(frontmatter));
      } catch { return false; }
    },
    fix_hint: `Add YAML frontmatter to ${filePath} with fields: ${requiredFields.join(', ')}`
  };
}

function xmlHasTag(filePath, tagName, { id, category = 'structure', severity = 'critical', message } = {}) {
  return {
    id: id || `xml_tag.${path.basename(filePath)}.${tagName}`,
    category,
    severity,
    message: message || `Has <${tagName}> tag: ${path.basename(filePath)}`,
    evidence: filePath,
    test: () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes(`<${tagName}>`) || content.includes(`<${tagName} `);
      } catch { return false; }
    },
    fix_hint: `Add <${tagName}> section to ${filePath}`
  };
}

function xmlNoMarkdownHeadings(filePath, { id, category = 'quality', severity = 'warning', message } = {}) {
  return {
    id: id || `no_md_headings.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `No markdown headings in body: ${path.basename(filePath)}`,
    evidence: filePath,
    test: () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parts = content.split('---');
        if (parts.length < 3) return true;
        const body = parts.slice(2).join('---');
        return !/^#{2,3}\s/m.test(body);
      } catch { return true; }
    },
    fix_hint: `Replace ## and ### headings in ${filePath} body with XML tags`
  };
}

function countMatches(actual, expected, label, { id, category = 'consistency', severity = 'critical', message } = {}) {
  return {
    id: id || `count.${label.replace(/\s+/g, '_')}`,
    category,
    severity,
    message: message || `${label}: expected ${expected}, actual ${actual}`,
    test: () => actual === expected,
    detail: `Expected: ${expected}, Actual: ${actual}`,
    fix_hint: actual < expected ? `${expected - actual} items missing for ${label}` : `${actual - expected} extra items for ${label}`
  };
}

function referenceResolves(fromPath, toPath, { id, category = 'references', severity = 'critical', message } = {}) {
  return {
    id: id || `ref.${path.basename(fromPath)}_to_${path.basename(toPath)}`,
    category,
    severity,
    message: message || `Reference resolves: ${path.basename(fromPath)} -> ${path.basename(toPath)}`,
    evidence: toPath,
    test: () => fs.existsSync(toPath),
    fix_hint: `Target ${toPath} referenced by ${fromPath} does not exist`
  };
}

function fileContains(filePath, searchString, { id, category = 'content', severity = 'critical', message, caseInsensitive = false } = {}) {
  return {
    id: id || `contains.${path.basename(filePath)}.${searchString.slice(0, 20).replace(/\W/g, '_')}`,
    category,
    severity,
    message: message || `File contains "${searchString.slice(0, 50)}": ${path.basename(filePath)}`,
    evidence: filePath,
    test: () => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (caseInsensitive) {
          return content.toLowerCase().includes(searchString.toLowerCase());
        }
        return content.includes(searchString);
      } catch { return false; }
    },
    fix_hint: `Add "${searchString}" to ${filePath}`
  };
}

function jsonSchemaValid(filePath, schemaPath, { id, category = 'schema', severity = 'critical', message } = {}) {
  return {
    id: id || `schema_valid.${path.basename(filePath)}`,
    category,
    severity,
    message: message || `JSON matches schema: ${path.basename(schemaPath)}`,
    evidence: `${filePath} :: ${schemaPath}`,
    test: () => {
      try {
        return validateWithSchemaFile(filePath, schemaPath).length === 0;
      } catch {
        return false;
      }
    },
    get detail() {
      try {
        const errors = validateWithSchemaFile(filePath, schemaPath);
        if (errors.length === 0) return 'Schema validation passed';
        return errors.slice(0, 5).map((err) => `${err.path || '/'} ${err.message}`).join(' | ');
      } catch (err) {
        return `Schema validation error: ${err.message}`;
      }
    },
    fix_hint: `Update ${filePath} to match ${schemaPath}`
  };
}

module.exports = {
  fileExists,
  dirExists,
  jsonValid,
  jsonHasKeys,
  fileMinSize,
  yamlHasFrontmatter,
  xmlHasTag,
  xmlNoMarkdownHeadings,
  countMatches,
  referenceResolves,
  fileContains,
  jsonSchemaValid
};
