'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendShadowReceipt, buildShadowReceipt, classifyNextStep, digest, validateCursor, validateReceipt } = require('../plan-execution-cursor.js');

const hash = (char) => `sha256:${char.repeat(64)}`;
function base(step) {
  const gate = { schema: 'PlanRunGateDecision/1.0', task_id: 't', status: 'ready', evaluated_at: '2026-07-15T00:00:00Z', json_sha256: hash('a'), markdown_sha256: hash('b'), plan_pair_sha256: hash('c'), marker_sha256: hash('d'), reason_codes: [], checks: [], authority: 'run_authorization_only' };
  const projection = { sha256: digest(['/run-plan']), commands: ['/run-plan'] };
  const plan = { task_id: 't', bounded_plan: { steps: [step] } };
  const mechanicalToolRefs = ['tool:x'];
  return { task_id: 't', plan, gate_decision: gate, command_projection: projection, exact_evidence: { plan_sha256: gate.json_sha256, plan_content_sha256: digest(plan), plan_pair_sha256: gate.plan_pair_sha256, gate_sha256: digest(gate), evidence_sha256: digest({ completed_step_ids: [], mechanical_tool_refs: mechanicalToolRefs, projection_sha256: projection.sha256 }), projection_sha256: projection.sha256, completed_step_ids: [], mechanical_tool_refs: mechanicalToolRefs } };
}
function step(execution) { return { step_id: 'S1', status: 'pending', depends_on: [], description: 'typed fixture', execution }; }

test('registered native command is proposed without executable command text', () => {
  const result = classifyNextStep(base(step({ kind: 'native_command', command_ref: '/run-plan', mode: 'COORDINATOR', write_scope: 'none' })));
  assert.equal(result.classification, 'native_command');
  assert.equal(result.can_execute, false);
  assert.equal(validateCursor(result), true, JSON.stringify(validateCursor.errors));
  assert.doesNotMatch(JSON.stringify(result.envelope), /run-plan/);
});

test('mechanical tool, bounded actor work, and operator gate remain non-authoritative', () => {
  const tool = classifyNextStep(base(step({ kind: 'mechanical_tool', tool_ref: 'tool:x', mode: 'RUN_ONLY', write_scope: 'reports_only' })));
  const actor = classifyNextStep(base(step({ kind: 'bounded_actor_work', mode: 'COORDINATOR', write_scope: 'reports_only', work_order: { current_state: 'now', question_work: 'one unit', desired_state: 'receipt', model: 'disclosed', mind: 'bounded reviewer' } })));
  const gate = classifyNextStep(base(step({ kind: 'operator_gate', gate_ref: 'human_operator', mode: 'REVIEW_ONLY', write_scope: 'none' })));
  assert.deepEqual([tool.classification, actor.classification, gate.classification], ['mechanical_tool','bounded_actor_work','operator_gate']);
  assert.ok([tool, actor, gate].every((item) => item.can_execute === false && item.can_dispatch === false));
});

test('stale gate, dependency drift, prose command, and missing contracts fail closed', () => {
  const stale = base(step({ kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' })); stale.gate_decision.status = 'blocked';
  const drift = base(step({ kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' })); drift.exact_evidence.plan_sha256 = hash('0');
  const prose = base({ step_id: 'S1', status: 'pending', depends_on: [], description: 'Run /run-plan next' });
  const missing = base(step({ kind: 'mechanical_tool' }));
  assert.deepEqual([stale, drift, prose, missing].map((input) => classifyNextStep(input).classification), ['invalid','invalid','invalid','invalid']);
  assert.equal(classifyNextStep(prose).reason, 'prose_only_command_refused');
});

test('dependencies select one next step and ambiguity remains invalid', () => {
  const input = base(step({ kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' }));
  input.plan.bounded_plan.steps = [{ step_id: 'done', status: 'completed', depends_on: [] }, { ...input.plan.bounded_plan.steps[0], step_id: 'next', depends_on: ['done'] }];
  input.exact_evidence.completed_step_ids = ['done'];
  input.exact_evidence.plan_content_sha256 = digest(input.plan);
  input.exact_evidence.evidence_sha256 = digest({ completed_step_ids: ['done'], mechanical_tool_refs: ['tool:x'], projection_sha256: input.command_projection.sha256 });
  assert.equal(classifyNextStep(input).step_id, 'next');
  input.plan.bounded_plan.steps.push({ ...input.plan.bounded_plan.steps[1], step_id: 'tie', sequence: 0 });
  input.plan.bounded_plan.steps[1].sequence = 0;
  input.exact_evidence.plan_content_sha256 = digest(input.plan);
  assert.equal(classifyNextStep(input).reason, 'ambiguous_next_step');
});

test('plan, projection, completion, and evidence hash swaps fail closed', () => {
  const execution = { kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' };
  const planSwap = base(step(execution)); planSwap.plan.task_id = 'other';
  const projectionSwap = base(step(execution)); projectionSwap.command_projection.commands.push('/invented');
  const completionSwap = base(step(execution)); completionSwap.exact_evidence.completed_step_ids = ['ghost'];
  const evidenceSwap = base(step(execution)); evidenceSwap.exact_evidence.evidence_sha256 = hash('9');
  assert.deepEqual([planSwap, projectionSwap, completionSwap, evidenceSwap].map((item) => classifyNextStep(item).classification), ['invalid','invalid','invalid','invalid']);
});

test('receipt preserves plan-level coordinator observation without inventing a step', () => {
  const cursor = classifyNextStep(base(step({ kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' })));
  const receipt = buildShadowReceipt(cursor, { observed_at: '2026-07-15T00:00:00Z', coordinator_result: 'plan_authorized', trace_id: 'trace', span_id: 'span' });
  assert.equal(receipt.coordinator_step_id, null);
  assert.equal(receipt.disagreement, false);
  assert.equal(receipt.can_execute, false);
  assert.equal(validateReceipt(receipt), true, JSON.stringify(validateReceipt.errors));
});

test('writer appends validated receipts and rejects target symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-shadow-'));
  fs.mkdirSync(path.join(root, '_dev/state'), { recursive: true });
  const cursor = classifyNextStep(base(step({ kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' })));
  const receipt = buildShadowReceipt(cursor, { observed_at: '2026-07-15T00:00:00Z' });
  const target = appendShadowReceipt(root, receipt);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8').trim()).receipt_id, receipt.receipt_id);
  fs.unlinkSync(target); fs.symlinkSync(path.join(root, 'outside'), target);
  assert.throws(() => appendShadowReceipt(root, receipt), /symlink_rejected/);
});

test('invalid receipt cannot be appended', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-shadow-invalid-'));
  fs.mkdirSync(path.join(root, '_dev/state'), { recursive: true });
  assert.throws(() => appendShadowReceipt(root, { schema: 'PlanExecutionShadowReceipt/1.0' }), /shadow_receipt_invalid/);
});

test('invalid observation timestamps fail receipt validation', () => {
  const cursor = classifyNextStep(base(step({ kind: 'operator_gate', mode: 'REVIEW_ONLY', write_scope: 'none' })));
  assert.throws(() => appendShadowReceipt(fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-time-')), buildShadowReceipt(cursor, { observed_at: 'not-a-time' })), /shadow_receipt_invalid/);
});
