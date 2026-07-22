'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { sha256, stableJson } = require('../transforms/utils.cjs');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'compiler-observation.schema.json'), 'utf8'));
const closureSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'framework-closure-receipt.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: false });
const validateObservation = ajv.compile(schema);
const validateClosure = ajv.compile(closureSchema);

function compareObservedRun(plan, observed = {}, options = {}) {
  const exact = observed.run_id === plan.run_id && observed.plan_sha256 === plan.compiled_sha256;
  const divergences = [];
  if (!exact) divergences.push({ type: 'identity_mismatch', node_id: null, expected: `${plan.run_id}:${plan.compiled_sha256}`, observed: observed.run_id && observed.plan_sha256 ? `${observed.run_id}:${observed.plan_sha256}` : null, requires_semantic_review: false });
  const results = new Map((observed.node_results || []).map((item) => [item.node_id, item.state]));
  for (const node of plan.nodes) {
    if (!results.has(node.id)) divergences.push({ type: 'node_evidence_missing', node_id: node.id, expected: 'observed', observed: null, requires_semantic_review: node.kind === 'semantic' });
    else if (node.kind === 'semantic') divergences.push({ type: 'semantic_branch', node_id: node.id, expected: 'independent_review', observed: results.get(node.id), requires_semantic_review: true });
  }
  if (!observed.closure_receipt) divergences.push({ type: 'missing_closeout', node_id: null, expected: 'FrameworkClosureReceipt/1.0', observed: null, requires_semantic_review: false });
  else if (!validateClosure(observed.closure_receipt)) divergences.push({ type: 'closure_receipt_invalid', node_id: null, expected: 'valid FrameworkClosureReceipt/1.0', observed: 'invalid', requires_semantic_review: false });
  const falseBlocks = (observed.false_blocks || []).map((item) => ({ reason: String(item.reason), evidence_sha256: String(item.evidence_sha256), review_status: item.review_status || 'unverified' }));
  const displaced = { existing_path_model_tokens: options.existing_path_model_tokens ?? null, compiler_tool_tokens: options.compiler_tool_tokens ?? 0, fallback_tokens: options.fallback_tokens ?? null, reviewer_tokens: options.reviewer_tokens ?? null, witnessed: options.witnessed === true, savings_claim_allowed: false };
  const state = !exact ? 'evidence_missing' : divergences.some((item) => item.requires_semantic_review) ? 'review_required' : divergences.length || falseBlocks.length ? 'observe_divergence' : 'observe_match';
  const denominator = options.framework_denominator || { state: 'not_supplied', source_sha256: null, registered_ids: [], observed_ids: [], exclusions: [] };
  const core = { plan_id: plan.plan_id, run_id: plan.run_id, plan_sha256: plan.compiled_sha256, state, exact_identity: exact, divergences, false_blocks: falseBlocks, displaced_tokens: displaced, framework_denominator: denominator, falsification_cases: options.falsification_cases || [], semantic_acceptance: 'not_evaluated', operator_acceptance: 'not_evaluated', execution_authority: false };
  const observation = { schema: 'CompilerObservation/1.0', observation_id: `fco_${sha256(stableJson(core)).slice(0, 24)}`, ...core };
  const valid = validateObservation(observation);
  return { observation, valid, errors: valid ? [] : validateObservation.errors };
}

module.exports = { compareObservedRun, validateObservation };
