#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { validate } = require('../verify/lib/schema.cjs');
const { resolveTaskPlanPaths, validateOperatorGates } = require('./lib/resolve-task-plan');
const { validateTaskPlan } = require('./lib/validate-task-plan');

const SUPPORTED_AMENDMENT_SCHEMAS = new Set(['PlanAmendment/1.0', 'PlanAmendment/1.1']);

/**
 * Validate an amendment artifact directly by file path. Accepts both 1.0
 * (no operator_gates) and 1.1 (operator_gates[] shape-validated). Returns a
 * result object in the same shape as the plan validator so the CLI output
 * stays uniform.
 */
function validateAmendmentFile(jsonPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const schemaId = typeof data.schema === 'string' ? data.schema : '';
  const errors = [];

  if (!SUPPORTED_AMENDMENT_SCHEMAS.has(schemaId)) {
    errors.push({ path: '/schema', message: `Unsupported amendment schema "${schemaId}". Expected one of: ${Array.from(SUPPORTED_AMENDMENT_SCHEMAS).join(', ')}` });
  }

  // Gate validation: 1.1 shape check runs regardless of declared version so
  // authors who add operator_gates to a 1.0 file get a clear signal to bump
  // to 1.1. For 1.0 files with no operator_gates, this is a no-op.
  const gateResult = validateOperatorGates(data);
  for (const e of gateResult.errors) errors.push(e);

  return {
    ok: errors.length === 0,
    contract_id: schemaId || null,
    enforcement: 'amendment',
    errors,
    warnings: []
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TASK_PLAN_SCHEMA_PATH = path.join(PROJECT_ROOT, 'tools', 'planning', 'task-intake.schema.json');

function parseArgs(argv) {
  const result = {
    ref: '',
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      result.json = true;
    } else if (!result.ref) {
      result.ref = arg;
    }
  }

  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ref) {
    console.error('Usage: node tools/planning/validate-task-plan.js <task-id|path> [--json]');
    process.exit(1);
  }

  // Amendment-file fast path: if the argument is an explicit path to an
  // __amendment__*.json file, validate it directly as an amendment artifact.
  const looksLikeAmendmentPath = /__amendment(?:2)?__/.test(args.ref) && args.ref.endsWith('.json');
  if (looksLikeAmendmentPath) {
    const absPath = path.isAbsolute(args.ref) ? args.ref : path.resolve(PROJECT_ROOT, args.ref);
    if (!fs.existsSync(absPath)) {
      console.error(`Amendment file not found: ${args.ref}`);
      process.exit(1);
    }
    const amendResult = validateAmendmentFile(absPath);
    const output = {
      plan_path: path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/'),
      ok: amendResult.ok,
      schema_errors: [],
      route_errors: amendResult.errors,
      warnings: amendResult.warnings,
      contract_id: amendResult.contract_id,
      enforcement: amendResult.enforcement
    };
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Amendment: ${output.plan_path}`);
      console.log(`Schema: ${amendResult.contract_id || '(unknown)'}`);
      console.log(`Validation: ${amendResult.ok ? 'PASS' : 'FAIL'}`);
      if (amendResult.errors.length > 0) {
        console.log('Errors:');
        for (const e of amendResult.errors) console.log(`- ${e.path || '/'} ${e.message}`);
      }
    }
    process.exit(output.ok ? 0 : 1);
  }

  const resolved = resolveTaskPlanPaths(PROJECT_ROOT, args.ref);
  if (!resolved || !fs.existsSync(resolved.jsonPath)) {
    console.error(`Task plan not found: ${args.ref}`);
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(TASK_PLAN_SCHEMA_PATH, 'utf8'));
  const schemaErrors = validate(plan, schema, { rootSchema: schema, path: '' });
  const routeResult = validateTaskPlan(plan, { projectRoot: PROJECT_ROOT });

  const output = {
    plan_path: path.relative(PROJECT_ROOT, resolved.jsonPath).replace(/\\/g, '/'),
    ok: schemaErrors.length === 0 && routeResult.ok,
    schema_errors: schemaErrors,
    route_errors: routeResult.errors,
    warnings: routeResult.warnings,
    contract_id: routeResult.contract_id,
    enforcement: routeResult.enforcement
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Plan: ${output.plan_path}`);
    console.log(`Schema: ${schemaErrors.length === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`Methodology routing: ${routeResult.ok ? 'PASS' : 'FAIL'} (${routeResult.enforcement})`);
    if (schemaErrors.length > 0) {
      console.log('Schema errors:');
      for (const error of schemaErrors) {
        console.log(`- ${error.path || '/'} ${error.message}`);
      }
    }
    if (routeResult.errors.length > 0) {
      console.log('Route errors:');
      for (const error of routeResult.errors) {
        console.log(`- ${error.path || '/'} ${error.message}`);
      }
    }
    if (routeResult.warnings.length > 0) {
      console.log('Warnings:');
      for (const warning of routeResult.warnings) {
        console.log(`- ${warning.path || '/'} ${warning.message}`);
      }
    }
  }

  process.exit(output.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}
