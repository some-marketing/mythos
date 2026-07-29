#!/usr/bin/env node
const path = require('path');
const { planOutputs } = require('./lib/engine');
const { exists, readText, readJsonAsYaml } = require('./lib/io');

const rootDir = path.resolve(__dirname, '..', '..');
const compareClaude = process.argv.includes('--compare-claude');
const skipClaude = process.argv.includes('--skip-claude');

if (compareClaude && skipClaude) {
  console.error('Cannot use both --compare-claude and --skip-claude');
  process.exit(1);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

let writeClaude;
if (compareClaude) {
  writeClaude = true;
} else if (skipClaude) {
  writeClaude = false;
}

// --- Manual schema validation for system.yaml ---

/**
 * Validate a single value against a property schema.
 * Returns an array of error strings.
 */
function validateValue(val, propSchema, fieldPath) {
  const errors = [];
  if (!propSchema || !propSchema.type) return errors;

  // Type checks
  if (propSchema.type === 'string' && typeof val !== 'string') {
    errors.push(`Schema: "${fieldPath}" should be string, got ${typeof val}`);
  } else if (propSchema.type === 'array' && !Array.isArray(val)) {
    errors.push(`Schema: "${fieldPath}" should be array, got ${typeof val}`);
  } else if (propSchema.type === 'object' && (typeof val !== 'object' || Array.isArray(val) || val === null)) {
    errors.push(`Schema: "${fieldPath}" should be object, got ${typeof val}`);
  } else if (propSchema.type === 'integer') {
    if (!Number.isInteger(val)) {
      errors.push(`Schema: "${fieldPath}" should be integer, got ${typeof val}`);
    } else if (propSchema.minimum !== undefined && val < propSchema.minimum) {
      errors.push(`Schema: "${fieldPath}" value ${val} is below minimum ${propSchema.minimum}`);
    }
  }

  // Validate array items
  if (propSchema.type === 'array' && Array.isArray(val) && propSchema.items) {
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      const itemSchema = propSchema.items;
      // Check item type
      if (itemSchema.type === 'object' && (typeof item !== 'object' || Array.isArray(item) || item === null)) {
        errors.push(`Schema: "${fieldPath}[${i}]" should be object, got ${typeof item}`);
        continue;
      }
      if (itemSchema.type === 'string' && typeof item !== 'string') {
        errors.push(`Schema: "${fieldPath}[${i}]" should be string, got ${typeof item}`);
        continue;
      }
      // Check required sub-fields on object items
      if (itemSchema.required && typeof item === 'object' && item !== null) {
        for (const subField of itemSchema.required) {
          if (item[subField] === undefined) {
            errors.push(`Schema: "${fieldPath}[${i}]" missing required sub-field "${subField}"`);
          }
        }
      }
      // Check nested property types on object items
      if (itemSchema.properties && typeof item === 'object' && item !== null) {
        for (const [propName, propDef] of Object.entries(itemSchema.properties)) {
          if (item[propName] !== undefined) {
            errors.push(...validateValue(item[propName], propDef, `${fieldPath}[${i}].${propName}`));
          }
        }
      }
    }
  }

  // Validate object sub-fields
  if (propSchema.type === 'object' && typeof val === 'object' && !Array.isArray(val) && val !== null) {
    if (propSchema.required) {
      for (const subField of propSchema.required) {
        if (val[subField] === undefined) {
          errors.push(`Schema: "${fieldPath}" missing required sub-field "${subField}"`);
        }
      }
    }
    // Validate nested property types
    if (propSchema.properties) {
      for (const [propName, propDef] of Object.entries(propSchema.properties)) {
        if (val[propName] !== undefined) {
          errors.push(...validateValue(val[propName], propDef, `${fieldPath}.${propName}`));
        }
      }
    }
  }

  return errors;
}

function validateSystemSchema(system, schemaPath) {
  const schema = JSON.parse(readText(schemaPath));
  let allPass = true;

  // Check required top-level fields
  for (const field of schema.required) {
    if (system[field] === undefined) {
      fail(`Schema: missing required field "${field}" in system.yaml`);
      allPass = false;
    } else {
      const propSchema = schema.properties[field];
      if (propSchema) {
        const errors = validateValue(system[field], propSchema, field);
        for (const err of errors) {
          fail(err);
          allPass = false;
        }
      }
    }
  }

  if (allPass) {
    pass('System schema validation');
  }
}

// Export for testing (validateValue only, without running the main script)
module.exports = { validateValue };

// Only run main validation when executed directly (not when require'd by tests)
if (require.main === module) {
  const schemaPath = path.join(__dirname, 'lib', 'schema', 'canonical-system.schema.json');
  const systemData = readJsonAsYaml(path.join(rootDir, 'instructions', 'canonical', 'system.yaml'));
  validateSystemSchema(systemData, schemaPath);

  const { model, outputs } = planOutputs(rootDir, { writeClaude });

  for (const fw of model.system.frameworks) {
    const manifestPath = path.join(rootDir, fw.manifest);
    if (!exists(manifestPath)) {
      fail(`Missing framework manifest: ${fw.manifest}`);
      continue;
    }
    try {
      JSON.parse(readText(manifestPath));
      pass(`Manifest parses: ${fw.manifest}`);
    } catch (err) {
      fail(`Invalid JSON in ${fw.manifest}: ${err.message}`);
    }
  }

  for (const out of outputs) {
    if (!exists(out.path)) {
      fail(`Missing generated target: ${path.relative(rootDir, out.path)}`);
      continue;
    }
    const current = readText(out.path);
    const expected = `${out.content.trim()}\n`;
    if (current !== expected) {
      fail(`Drift detected: ${path.relative(rootDir, out.path)} (run npm run instructions:generate)`);
    } else {
      pass(`No drift: ${path.relative(rootDir, out.path)}`);
    }
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }

  console.log('Validation complete: no parity/drift errors for managed targets.');
}
