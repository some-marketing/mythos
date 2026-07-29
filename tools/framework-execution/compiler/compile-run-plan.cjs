'use strict';

const { sha256, stableJson } = require('../transforms/utils.cjs');
const { graphProblems } = require('./validate-run-plan.cjs');

function flattenPromptIds(manifest) {
  const ids = [];
  for (const value of Object.values(manifest.prompt_chain || {})) for (const id of Array.isArray(value) ? value : []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

function compileRunPlan(input = {}) {
  const manifest = input.manifest || {};
  const promptIds = flattenPromptIds(manifest);
  const authorities = new Map((manifest.prompt_authority || []).map((item) => [item.prompt_id, item]));
  const contracts = new Map((input.node_contracts || []).map((item) => [item.prompt_id, item]));
  const mechanical = new Map((input.mechanical_classifications || []).map((item) => [item.prompt_id, item]));
  const blocked = [];
  if (process.env.FRAMEWORK_RUN_COMPILER_OBSERVE === '0') blocked.push('feature_disabled');
  if (promptIds.length === 0) blocked.push('prompt_chain_empty');
  const nodes = promptIds.map((promptId, index) => {
    const source = authorities.get(promptId);
    const contract = contracts.get(promptId) || {};
    if (!source) blocked.push(`missing_prompt_authority:${promptId}`);
    const requested = contract.requested_effects || {};
    for (const effect of ['read', 'write', 'execute', 'dispatch']) if (requested[effect] === true && (!source || !source.effects || source.effects[effect] !== true)) blocked.push(`authority_expansion:${promptId}:${effect}`);
    const classification = mechanical.get(promptId);
    const kind = classification && classification.state === 'accepted_mechanical' && classification.authority === 'classification_only' && /^[a-f0-9]{64}$/.test(classification.evidence_sha256 || '') && /^[a-f0-9]{64}$/.test(classification.review_artifact_sha256 || '') ? 'mechanical' : 'semantic';
    return { id: contract.id || `node_${String(index + 1).padStart(2, '0')}`, prompt_id: promptId, mode: source ? source.mode : 'UNKNOWN', kind, dependencies: contract.dependencies || (index ? [`node_${String(index).padStart(2, '0')}`] : []), writes: contract.writes || [], source_authority_sha256: sha256(stableJson(source || { missing: promptId })) };
  });
  const requirements = (input.requirements || []).map((item) => ({ id: String(item.id), available: item.available === true, receipt_sha256: String(item.receipt_sha256 || '') }));
  for (const item of requirements) {
    if (!/^[a-f0-9]{64}$/.test(item.receipt_sha256)) blocked.push(`requirement_receipt_invalid:${item.id}`);
    if (!item.available) blocked.push(`requirement_unavailable:${item.id}`);
  }
  const boundary = input.boundary_receipt && input.boundary_receipt.state === 'valid' && /^[a-f0-9]{64}$/.test(input.boundary_receipt.receipt_sha256 || '') ? { state: 'valid', receipt_sha256: input.boundary_receipt.receipt_sha256 } : { state: input.boundary_receipt && input.boundary_receipt.state || 'missing', receipt_sha256: input.boundary_receipt && input.boundary_receipt.receipt_sha256 || null };
  if (boundary.state !== 'valid') blocked.push(`boundary_${boundary.state}`);
  blocked.push(...graphProblems(nodes));
  const manifestSha = sha256(stableJson(manifest));
  const inputsSha = sha256(stableJson({ node_contracts: input.node_contracts || [], mechanical_classifications: input.mechanical_classifications || [], requirements, boundary }));
  const core = { framework_id: String(input.framework_id || `${manifest.service_category || 'unknown'}/${manifest.framework_name || 'unknown'}`), run_id: String(input.run_id || 'unknown'), manifest_sha256: manifestSha, inputs_sha256: inputsSha, state: blocked.length ? 'compiled_blocked' : nodes.some((node) => node.kind === 'semantic') ? 'semantic_review_required' : 'compiled_valid', blocked_reasons: [...new Set(blocked)].sort(), nodes, requirements, boundary, authority: { mode: 'observe_only', can_execute: false, can_dispatch: false, can_write_project: false, can_complete: false, executor: 'existing_coordinator_only' }, semantic_acceptance: 'not_evaluated', operator_acceptance: 'not_evaluated' };
  const planId = `frp_${sha256(stableJson(core)).slice(0, 24)}`;
  const compiledSha = sha256(stableJson({ plan_id: planId, ...core }));
  return { schema: 'FrameworkRunPlan/1.0', plan_id: planId, ...core, compiled_sha256: compiledSha };
}

module.exports = { compileRunPlan, flattenPromptIds };
