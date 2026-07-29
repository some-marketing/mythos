#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileRunPlan } = require('./compile-run-plan.cjs');
const { validateRunPlan } = require('./validate-run-plan.cjs');
const { compareObservedRun } = require('./compare-observed-run.cjs');
const { sha256 } = require('../transforms/utils.cjs');

function outputPath(argv) {
  const index = argv.indexOf('--output');
  if (index < 0 || !argv[index + 1]) throw new Error('explicit_output_required');
  const resolved = path.resolve(argv[index + 1]);
  const allowed = [path.resolve('/tmp'), path.resolve(process.cwd(), '_dev/reports/analysis')];
  const lexicalRoot = allowed.find((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!lexicalRoot) throw new Error('output_outside_analysis_or_tmp');
  if (!fs.existsSync(path.dirname(resolved))) throw new Error('output_parent_missing');
  const realRoot = fs.realpathSync(lexicalRoot);
  const realParent = fs.realpathSync(path.dirname(resolved));
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) throw new Error('output_parent_symlink_escape');
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) throw new Error('output_symlink_rejected');
  return resolved;
}

function fixtureManifest() {
  return { service_category: 'synthetic', framework_name: 'observe-fixture', prompt_authority: [{ schema: 'PromptAuthority/1.0', prompt_id: 'A', mode: 'REVIEW_ONLY', effects: { read: true, write: false, execute: false, dispatch: false } }, { schema: 'PromptAuthority/1.0', prompt_id: 'B', mode: 'REVIEW_ONLY', effects: { read: true, write: false, execute: false, dispatch: false } }], prompt_chain: { inspect: ['A'], decide: ['B'] } };
}

function runFixture() {
  const manifest = fixtureManifest();
  const receipt = 'a'.repeat(64);
  const base = { framework_id: 'synthetic/observe-fixture', run_id: 'fixture-run', manifest, requirements: [{ id: 'fixture-mcp', available: true, receipt_sha256: receipt }], boundary_receipt: { state: 'valid', receipt_sha256: 'b'.repeat(64) }, mechanical_classifications: [{ prompt_id: 'A', state: 'accepted_mechanical', authority: 'classification_only', evidence_sha256: 'c'.repeat(64), review_artifact_sha256: 'd'.repeat(64) }] };
  const plan = compileRunPlan(base);
  const cases = [
    { case: 'cycle', state: compileRunPlan({ ...base, node_contracts: [{ prompt_id: 'A', id: 'a', dependencies: ['b'] }, { prompt_id: 'B', id: 'b', dependencies: ['a'] }] }).state === 'compiled_blocked' ? 'blocked' : 'detected' },
    { case: 'hash_drift', state: validateRunPlan(plan, { manifest: { ...manifest, version: 'changed' } }).ok ? 'detected' : 'blocked' },
    { case: 'unavailable_requirement', state: compileRunPlan({ ...base, requirements: [{ id: 'fixture-mcp', available: false, receipt_sha256: receipt }] }).state === 'compiled_blocked' ? 'blocked' : 'detected' },
    { case: 'boundary_escape', state: compileRunPlan({ ...base, boundary_receipt: { state: 'out_of_bounds', receipt_sha256: null } }).state === 'compiled_blocked' ? 'blocked' : 'detected' },
    { case: 'parallel_write_overlap', state: compileRunPlan({ ...base, node_contracts: [{ prompt_id: 'A', id: 'a', writes: ['same'] }, { prompt_id: 'B', id: 'b', dependencies: [], writes: ['same'] }] }).state === 'compiled_blocked' ? 'blocked' : 'detected' },
    { case: 'semantic_branch', state: plan.nodes.some((node) => node.kind === 'semantic') ? 'review_required' : 'detected' },
    { case: 'missing_closeout', state: 'detected' }
  ];
  const registryPath = path.resolve(process.cwd(), 'instructions/canonical/system.yaml');
  const registryBytes = fs.readFileSync(registryPath);
  const registry = JSON.parse(registryBytes.toString('utf8'));
  const registeredIds = (registry.frameworks || []).map((item) => item.id).sort();
  const frameworkDenominator = { state: 'enumerated', source_sha256: sha256(registryBytes), registered_ids: registeredIds, observed_ids: [], exclusions: registeredIds.map((id) => ({ id, reason: 'no_exact_non_client_run_evidence_supplied' })) };
  return compareObservedRun(plan, { run_id: plan.run_id, plan_sha256: plan.compiled_sha256, node_results: plan.nodes.map((node) => ({ node_id: node.id, state: 'observed' })) }, { compiler_tool_tokens: 0, witnessed: false, framework_denominator: frameworkDenominator, falsification_cases: cases });
}

function main(argv = process.argv.slice(2)) {
  if (process.env.FRAMEWORK_RUN_COMPILER_OBSERVE === '0') throw new Error('feature_disabled');
  if (!argv.includes('--fixture')) throw new Error('only_fixture_mode_is_implemented');
  const target = outputPath(argv);
  const result = runFixture();
  if (!result.valid) throw new Error(`observation_schema_invalid:${JSON.stringify(result.errors)}`);
  fs.writeFileSync(target, `${JSON.stringify(result.observation, null, 2)}\n`, { flag: 'w' });
  process.stdout.write(`${JSON.stringify({ ok: true, output: target, state: result.observation.state })}\n`);
}

if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
module.exports = { fixtureManifest, main, outputPath, runFixture };
