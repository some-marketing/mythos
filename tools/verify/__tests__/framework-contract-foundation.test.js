'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Ajv2020 = require('ajv/dist/2020');

const { validate } = require('../lib/schema.cjs');
const {
  buildMcpPreflightReceipt,
  evaluatePromptAuthority,
  normalizeMcpRequirements,
  safeFrameworkContractReport
} = require('../verify-framework.cjs');

const ROOT = path.resolve(__dirname, '../../..');

function schema(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/verify/schemas', name), 'utf8'));
}

test('legacy MCP strings and objects normalize without claiming live capability', () => {
  const values = normalizeMcpRequirements(['playwright', { name: 'notion', purpose: 'write docs' }]);
  assert.deepEqual(values.map((item) => item.source_shape), ['legacy_string', 'legacy_object']);
  const receipt = buildMcpPreflightReceipt(['playwright', { name: 'notion', purpose: 'write docs' }], []);
  assert.equal(receipt.state, 'preflight_blocked');
  assert.ok(receipt.checks.every((check) => check.available === false));
});

test('typed optional MCP may degrade only when explicitly declared', () => {
  const optional = [{ schema: 'McpRequirement/1.0', name: 'notion', required: false, degraded_allowed: true }];
  assert.equal(buildMcpPreflightReceipt(optional, []).state, 'degraded');
  assert.equal(buildMcpPreflightReceipt([{ ...optional[0], degraded_allowed: false }], []).state, 'preflight_blocked');
});

test('MCP receipt allowlists facts and records no secrets, environment, or raw configuration', () => {
  const receipt = buildMcpPreflightReceipt(['playwright'], [{
    name: 'playwright', available: true, authorized: true, scope_bounded: true,
    token: 'secret-token', environment: process.env, client_content: 'private'
  }]);
  assert.equal(receipt.state, 'ready');
  const raw = JSON.stringify(receipt);
  assert.doesNotMatch(raw, /secret-token|client_content|HOME|PATH/);
});

test('prompt authority can restrict but cannot expand manifest modes', () => {
  const descriptor = {
    schema: 'PromptAuthority/1.0', prompt_id: '01_INTAKE', mode: 'REVIEW_ONLY',
    effects: { read: true, write: false, execute: false, dispatch: false }
  };
  assert.equal(evaluatePromptAuthority(descriptor, ['REVIEW_ONLY', 'PATCH_ALLOWED']).state, 'ready');
  assert.ok(evaluatePromptAuthority({ ...descriptor, mode: 'COORDINATOR' }, ['REVIEW_ONLY']).errors.includes('authority_expansion'));
});

test('FINDINGS_ONLY and REVIEW_ONLY write or execute effects are denied', () => {
  for (const mode of ['FINDINGS_ONLY', 'REVIEW_ONLY']) {
    const result = evaluatePromptAuthority({
      schema: 'PromptAuthority/1.0', prompt_id: 'x', mode,
      effects: { read: true, write: true, execute: true, dispatch: false }
    }, [mode]);
    assert.equal(result.state, 'invalid');
    assert.ok(result.errors.includes('read_only_mode_effect_denied'));
  }
});

test('RUN_ONLY permits report writes but denies unbounded writes', () => {
  const descriptor = {
    schema: 'PromptAuthority/1.0', prompt_id: 'x', mode: 'RUN_ONLY',
    effects: { read: true, write: true, execute: true, dispatch: false, write_scope: 'reports_only' }
  };
  assert.equal(evaluatePromptAuthority(descriptor, ['RUN_ONLY']).state, 'ready');
  assert.ok(evaluatePromptAuthority({ ...descriptor, effects: { ...descriptor.effects, write_scope: 'scoped' } }, ['RUN_ONLY']).errors.includes('run_only_write_scope_invalid'));
});

test('standalone schemas reject undeclared fields and invalid required degradation', () => {
  const promptSchema = schema('prompt-authority.schema.json');
  const mcpSchema = schema('mcp-requirement.schema.json');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const prompt = { schema: 'PromptAuthority/1.0', prompt_id: 'x', mode: 'REVIEW_ONLY', effects: { read: true, write: false, execute: false, dispatch: false }, extra: true };
  assert.equal(ajv.validate(promptSchema, prompt), false);
  const mcp = { schema: 'McpRequirement/1.0', name: 'x', required: true, degraded_allowed: true };
  assert.equal(ajv.validate(mcpSchema, mcp), false);
  assert.equal(safeFrameworkContractReport({ mcp_requirements: [mcp], execution_modes: [] }).state, 'report_error');
});

test('report errors are contained and declare legacy behavior unchanged', () => {
  const report = safeFrameworkContractReport({ mcp_requirements: [42], execution_modes: [] });
  assert.equal(report.state, 'report_error');
  assert.equal(report.legacy_behavior_changed, false);
});

test('all current two-level framework manifests retain shared-schema validity except the recorded baseline failure', () => {
  const manifestSchema = schema('framework-manifest.schema.json');
  const failures = [];
  for (const service of fs.readdirSync(path.join(ROOT, 'frameworks'), { withFileTypes: true })) {
    if (!service.isDirectory() || service.name.startsWith('_')) continue;
    for (const framework of fs.readdirSync(path.join(ROOT, 'frameworks', service.name), { withFileTypes: true })) {
      if (!framework.isDirectory()) continue;
      const manifestPath = path.join(ROOT, 'frameworks', service.name, framework.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const errors = validate(manifest, manifestSchema, { rootSchema: manifestSchema, path: '' });
      if (errors.length) failures.push(`${service.name}/${framework.name}`);
    }
  }
  assert.deepEqual(failures, ['paid-media/google-ads-account-optimization']);
});

test('execution-normalization pilot restricts every executable prompt-chain entry', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'frameworks/meta/execution-normalization/manifest.json'),
    'utf8'
  ));
  const chainPromptIds = Object.values(manifest.prompt_chain).flat().sort();
  const authorityPromptIds = manifest.prompt_authority.map((descriptor) => descriptor.prompt_id).sort();
  assert.deepEqual(authorityPromptIds, chainPromptIds);

  const report = safeFrameworkContractReport(manifest, []);
  assert.equal(report.state, 'reported');
  assert.equal(report.mcp_preflight.state, 'ready');
  assert.ok(report.prompt_authority.every((entry) => entry.state === 'ready'));
});

test('execution-normalization pilot contract is enforced by the verifier', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'tools/verify/verify-framework.cjs'),
    'meta/execution-normalization',
    '--json'
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const signal = JSON.parse(result.stdout);
  const pilot = signal.findings.find((check) => check.id === 'framework_contract.execution_normalization_pilot');
  assert.equal(pilot.status, 'PASS');
});
