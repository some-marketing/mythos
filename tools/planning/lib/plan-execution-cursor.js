'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { sha256Bytes, stableJson } = require('../../verify/lib/run-evidence-index.cjs');

const HASH = /^sha256:[a-f0-9]{64}$/;
const cursorSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/plan-execution-cursor.schema.json'), 'utf8'));
const receiptSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schemas/plan-execution-shadow-receipt.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: false, formats: { 'date-time': { type: 'string', validate: (value) => Number.isFinite(Date.parse(value)) } } });
const validateCursor = ajv.compile(cursorSchema);
const validateReceipt = ajv.compile(receiptSchema);

function digest(value) { return sha256Bytes(stableJson(value)); }
function lstatIfPresent(target) {
  try { return fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function invalid(input, reason, stepId = null) { return build(input, { state: 'invalid', step_id: stepId, classification: 'invalid', reason, envelope: null }); }
function build(input, fields) {
  const core = { task_id: String(input.task_id || 'unknown'), ...fields, plan_sha256: String(input.exact_evidence && input.exact_evidence.plan_sha256 || ''), plan_pair_sha256: String(input.gate_decision && input.gate_decision.plan_pair_sha256 || ''), gate_sha256: digest(input.gate_decision || {}), evidence_sha256: String(input.exact_evidence && input.exact_evidence.evidence_sha256 || ''), projection_sha256: String(input.command_projection && input.command_projection.sha256 || ''), authority: 'advisory_only', can_execute: false, can_dispatch: false, can_mutate_state: false, operator_acceptance: 'not_evaluated' };
  return { schema: 'PlanExecutionCursor/1.0', cursor_id: `pec_${digest(core).slice(7, 31)}`, ...core };
}

function classifyNextStep(input = {}) {
  const gate = input.gate_decision || {};
  const evidence = input.exact_evidence || {};
  const plan = input.plan || {};
  const projection = input.command_projection || {};
  if (gate.schema !== 'PlanRunGateDecision/1.0' || gate.status !== 'ready' || gate.authority !== 'run_authorization_only') return invalid(input, 'gate_not_ready');
  if (!HASH.test(gate.json_sha256 || '') || !HASH.test(gate.plan_pair_sha256 || '') || !HASH.test(evidence.evidence_sha256 || '') || !HASH.test(projection.sha256 || '')) return invalid(input, 'required_digest_missing');
  if (evidence.plan_sha256 !== gate.json_sha256 || evidence.plan_pair_sha256 !== gate.plan_pair_sha256 || evidence.gate_sha256 !== digest(gate) || evidence.projection_sha256 !== projection.sha256) return invalid(input, 'dependency_drift');
  if (String(plan.task_id || '') !== String(input.task_id || '')) return invalid(input, 'task_identity_mismatch');
  const steps = Array.isArray(plan.bounded_plan && plan.bounded_plan.steps) ? plan.bounded_plan.steps : [];
  if (evidence.plan_content_sha256 !== digest(plan)) return invalid(input, 'plan_content_drift');
  const projectedCommands = Array.isArray(projection.commands) ? [...new Set(projection.commands)].sort() : [];
  if (projection.sha256 !== digest(projectedCommands)) return invalid(input, 'command_projection_drift');
  const planCompleted = steps.filter((step) => step && step.status === 'completed').map((step) => step.step_id).sort();
  const suppliedCompleted = Array.isArray(evidence.completed_step_ids) ? [...new Set(evidence.completed_step_ids)].sort() : [];
  if (stableJson(planCompleted) !== stableJson(suppliedCompleted)) return invalid(input, 'completed_step_evidence_drift');
  const toolRefs = Array.isArray(evidence.mechanical_tool_refs) ? [...new Set(evidence.mechanical_tool_refs)].sort() : [];
  if (evidence.evidence_sha256 !== digest({ completed_step_ids: suppliedCompleted, mechanical_tool_refs: toolRefs, projection_sha256: projection.sha256 })) return invalid(input, 'evidence_digest_mismatch');
  const knownSteps = new Set(steps.map((step) => step && step.step_id).filter(Boolean));
  if (steps.some((step) => (step.depends_on || []).some((id) => !knownSteps.has(id)))) return invalid(input, 'unknown_step_dependency');
  const completed = new Set(planCompleted);
  const eligible = steps.filter((step) => step && step.status === 'pending' && (step.depends_on || []).every((id) => completed.has(id)));
  if (eligible.length === 0) return invalid(input, 'no_dependency_satisfied_pending_step');
  const ranked = eligible.map((step, index) => ({ step, rank: Number.isSafeInteger(step.sequence) ? step.sequence : index })).sort((a, b) => a.rank - b.rank);
  if (ranked.length > 1 && ranked[0].rank === ranked[1].rank) return invalid(input, 'ambiguous_next_step');
  const step = ranked[0].step;
  const spec = step.execution;
  if (!spec || typeof spec !== 'object') return invalid(input, /\/[a-z][a-z0-9-]*/i.test(String(step.description || '')) ? 'prose_only_command_refused' : 'execution_contract_missing', step.step_id || null);
  if (!spec.mode || !spec.write_scope) return invalid(input, 'mode_or_write_scope_missing', step.step_id || null);
  const classification = spec.kind;
  let reference = null;
  if (classification === 'native_command') {
    if (!/^\/[a-z][a-z0-9-]*$/.test(String(spec.command_ref || '')) || !(projection.commands || []).includes(spec.command_ref)) return invalid(input, 'native_command_not_in_projection', step.step_id || null);
    reference = spec.command_ref;
  } else if (classification === 'mechanical_tool') {
    if (!spec.tool_ref || !toolRefs.includes(spec.tool_ref)) return invalid(input, 'mechanical_tool_evidence_missing', step.step_id || null);
    reference = spec.tool_ref;
  } else if (classification === 'bounded_actor_work') {
    const work = spec.work_order;
    if (!work || !work.current_state || !work.question_work || !work.desired_state || !work.model || !work.mind) return invalid(input, 'bounded_work_order_incomplete', step.step_id || null);
    reference = digest(work);
  } else if (classification === 'operator_gate') {
    reference = spec.gate_ref || 'human_operator';
  } else return invalid(input, 'unknown_execution_kind', step.step_id || null);
  const state = classification === 'operator_gate' ? 'operator_gate' : 'proposed';
  const result = build(input, { state, step_id: step.step_id, classification, reason: `typed_${classification}`, envelope: { ref: digest(reference), mode: spec.mode, write_scope: spec.write_scope } });
  return validateCursor(result) ? result : invalid(input, 'cursor_schema_invalid', step.step_id || null);
}

function buildShadowReceipt(cursor, observation = {}) {
  const coordinatorResult = observation.coordinator_result || 'not_observed';
  const disagreement = coordinatorResult === 'plan_authorized' ? cursor.classification === 'invalid' : null;
  const core = { observed_at: observation.observed_at || new Date().toISOString(), task_id: cursor.task_id, cursor_id: cursor.cursor_id, cursor_sha256: digest(cursor), step_id: cursor.step_id, cursor_result: cursor.classification, classification_reason: cursor.reason, plan_sha256: cursor.plan_sha256, plan_pair_sha256: cursor.plan_pair_sha256, gate_sha256: cursor.gate_sha256, evidence_sha256: cursor.evidence_sha256, projection_sha256: cursor.projection_sha256, coordinator_result: coordinatorResult, coordinator_step_id: observation.coordinator_step_id || null, disagreement, disagreement_reason: disagreement === true ? 'cursor_contract_invalid_while_plan_authorized' : null, trace_id: observation.trace_id || null, span_id: observation.span_id || null, authority: 'observational_only', can_execute: false, savings_claim_allowed: false };
  return { schema: 'PlanExecutionShadowReceipt/1.0', receipt_id: `pesr_${digest(core).slice(7, 31)}`, ...core };
}

function appendShadowReceipt(projectRoot, receipt) {
  if (!validateReceipt(receipt)) throw new Error(`shadow_receipt_invalid:${JSON.stringify(validateReceipt.errors)}`);
  const root = fs.realpathSync(projectRoot);
  const stateRoot = path.join(root, '_dev', 'state');
  const stateReal = fs.realpathSync(stateRoot);
  if (stateReal !== stateRoot || !stateReal.startsWith(`${root}${path.sep}`)) throw new Error('state_root_out_of_bounds');
  const dir = path.join(stateReal, 'plan-execution-cursor');
  const directoryStat = lstatIfPresent(dir);
  if (directoryStat && directoryStat.isSymbolicLink()) throw new Error('shadow_directory_symlink_rejected');
  fs.mkdirSync(dir, { recursive: true });
  const realDir = fs.realpathSync(dir);
  if (realDir !== dir || !realDir.startsWith(`${stateReal}${path.sep}`)) throw new Error('shadow_directory_out_of_bounds');
  const target = path.join(realDir, 'shadow-receipts.jsonl');
  const targetStat = lstatIfPresent(target);
  if (targetStat && targetStat.isSymbolicLink()) throw new Error('shadow_target_symlink_rejected');
  fs.appendFileSync(target, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', flag: 'a' });
  return target;
}

module.exports = { appendShadowReceipt, buildShadowReceipt, classifyNextStep, digest, validateCursor, validateReceipt };
