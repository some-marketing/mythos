'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate } = require('../../../verify/lib/schema.cjs');
const { sha256Bytes } = require('../../../verify/lib/run-evidence-index.cjs');
const { evaluatePlanRunGate, hashPlanPair } = require('../plan-run-gate');
const reviewState = require('../plan-review-state');

function fixture(overrides = {}) {
  const json = '{"task_id":"test"}\n';
  const markdown = '# Test\n';
  const pair = hashPlanPair(json, markdown);
  const artifact = '_dev/reports/analysis/test-review.md';
  const artifactHash = sha256Bytes('approved review');
  const marker = {
    plan_id: 'test',
    last_event: 'post_review_approved',
    distinct_reviews: [{
      actor: 'gemini', model: 'gemini-3-pro-preview', reviewer_family: 'gemini', producer_family: 'codex', artifact,
      artifact_sha256: artifactHash, plan_pair_sha256: pair.plan_pair_sha256, at: '2026-07-15T00:00:00Z', verdict: 'approved'
    }]
  };
  return {
    task_id: 'test', evaluated_at: '2026-07-15T00:01:00Z', json_bytes: json, markdown_bytes: markdown,
    pairing_status: 'aligned', marker_present: true, marker_valid: true, marker, review_artifact_hashes: { [artifact]: artifactHash },
    legacy_review_present: false, requires_convene: false, operator_override_present: false,
    operator_stamp_required: false, operator_stamp_verification: 'not_required',
    ...overrides
  };
}

test('ready decision validates and contains no execution instructions', () => {
  const decision = evaluatePlanRunGate(fixture());
  assert.equal(decision.status, 'ready');
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas/plan-run-gate-decision.schema.json')));
  assert.deepEqual(validate(decision, schema, { rootSchema: schema }), []);
  for (const forbidden of ['step', 'command', 'shell', 'dispatch', 'target', 'accepted', 'complete']) assert.equal(Object.hasOwn(decision, forbidden), false);
});

test('exact JSON and Markdown bytes both participate in pair identity', () => {
  const base = fixture();
  const expected = evaluatePlanRunGate(base).plan_pair_sha256;
  assert.notEqual(evaluatePlanRunGate({ ...base, json_bytes: `${base.json_bytes} ` }).plan_pair_sha256, expected);
  assert.notEqual(evaluatePlanRunGate({ ...base, markdown_bytes: `${base.markdown_bytes} ` }).plan_pair_sha256, expected);
});

test('stale, changed, same-family, missing, and rejected reviews block', () => {
  const base = fixture();
  assert.match(evaluatePlanRunGate({ ...base, markdown_bytes: `${base.markdown_bytes} ` }).reason_codes.join(' '), /distinct_review_missing/);
  assert.match(evaluatePlanRunGate({ ...base, review_artifact_hashes: { [base.marker.distinct_reviews[0].artifact]: sha256Bytes('changed') } }).reason_codes.join(' '), /distinct_review_missing/);
  const sameFamily = structuredClone(base.marker);
  sameFamily.distinct_reviews[0].reviewer_family = 'codex';
  assert.match(evaluatePlanRunGate({ ...base, marker: sameFamily }).reason_codes.join(' '), /distinct_review_missing/);
  assert.match(evaluatePlanRunGate({ ...base, marker: { ...base.marker, distinct_reviews: [] } }).reason_codes.join(' '), /distinct_review_missing/);
  const rejected = structuredClone(base.marker);
  rejected.distinct_reviews[0].verdict = 'rejected';
  assert.match(evaluatePlanRunGate({ ...base, marker: rejected }).reason_codes.join(' '), /distinct_review_rejected/);
});

test('legacy glob observation is explicitly unbound and cannot authorize', () => {
  const base = fixture();
  const decision = evaluatePlanRunGate({ ...base, marker: { ...base.marker, distinct_reviews: [] }, legacy_review_present: true });
  assert.equal(decision.status, 'blocked');
  assert.ok(decision.reason_codes.includes('unbound_legacy_review'));
});

test('override bypasses only distinct review and convene', () => {
  const base = fixture({ marker: { plan_id: 'test', last_event: 'post_review_approved', distinct_reviews: [] }, requires_convene: true, operator_override_present: true });
  assert.equal(evaluatePlanRunGate(base).status, 'ready');
  for (const variant of [
    { pairing_status: 'warning' },
    { marker_valid: false },
    { marker: { ...base.marker, last_event: 'post_review_rejected' } },
    { operator_stamp_required: true, operator_stamp_verification: 'missing' },
    { operator_stamp_required: true, operator_stamp_verification: 'unverified' },
    { operator_stamp_required: 'unknown' }
  ]) assert.equal(evaluatePlanRunGate({ ...base, ...variant }).status, 'blocked');
});

test('existing convene presence is required only when consequential review is required', () => {
  const base = fixture({ requires_convene: true });
  assert.ok(evaluatePlanRunGate(base).reason_codes.includes('convene_review_missing'));
  assert.equal(evaluatePlanRunGate({ ...base, convene_present: true }).status, 'ready');
});

test('pending/rejected repair, divergent pair, malformed marker, and unknown perimeter block', () => {
  const base = fixture();
  const variants = [
    { marker: { ...base.marker, last_event: 'post_repair', post_repair: { review_status: 'pending' } } },
    { marker: { ...base.marker, last_event: 'post_review_rejected', post_repair: { review_status: 'rejected' } } },
    { pairing_status: 'warning' },
    { marker_valid: false },
    { marker_present: false, marker_valid: false, marker: null },
    { marker: { ...base.marker, plan_id: 'other' } },
    { operator_stamp_required: null }
  ];
  for (const variant of variants) assert.equal(evaluatePlanRunGate({ ...base, ...variant }).status, 'blocked');
});

test('later bound review controls while unbound legacy history is ignored', () => {
  const base = fixture();
  const older = { ...base.marker.distinct_reviews[0], at: '2026-07-14T23:00:00Z', verdict: 'rejected' };
  const latest = { ...base.marker.distinct_reviews[0], at: '2026-07-15T00:00:00Z', verdict: 'approved' };
  assert.equal(evaluatePlanRunGate({ ...base, marker: { ...base.marker, distinct_reviews: [{ actor: 'codex', artifact: 'legacy.md', verdict: 'reject' }, older, latest] } }).status, 'ready');
});

test('hook and runner probation receipts agree without leaking receipt JSON to output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gate-parity-'));
  const planDir = path.join(root, '_dev/reports/analysis/task-plans');
  const markerDir = path.join(root, '_dev/state/plan-task-review-state');
  const analysisDir = path.join(root, '_dev/reports/analysis');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  const plan = { task_id: 'parity', source: 'operator', status: 'approved', approval: { status: 'approved' }, routing_expectations: { risk_tier: 'low' } };
  fs.writeFileSync(path.join(planDir, 'parity__plan.json'), JSON.stringify(plan));
  fs.writeFileSync(path.join(planDir, 'parity__plan.md'), '# Parity\n');
  fs.writeFileSync(path.join(analysisDir, 'parity-review.md'), 'APPROVE\n');
  reviewState.writeStateMarker(path.join(markerDir, 'parity.json'), { plan_id: 'parity', last_event: 'review_approved' });
  reviewState.recordDistinctReview('parity', {
    actor: 'gemini', model: 'gemini-3-pro-preview', reviewer_family: 'gemini', producer_family: 'codex',
    artifact: '_dev/reports/analysis/parity-review.md', verdict: 'approved', at: '2026-07-15T00:00:00Z'
  }, { projectRoot: root });

  const hook = require('../../../kernel/hooks/userprompt-plan-review-gate.cjs');
  const hookResult = hook.evaluateGate('/run-plan parity', root, 'session-test');
  assert.doesNotMatch(hookResult.text, /PlanRunGateComparisonReceipt|plan_pair_sha256/);

  const runner = require('../../../codex/commands/run-plan');
  const runnerResult = runner.runPlan(root, 'parity', {});
  assert.doesNotMatch(String(runnerResult.stdout || ''), /PlanRunGateComparisonReceipt|plan_pair_sha256/);

  const receiptPath = path.join(root, '_dev/state/plan-review-gate/probation-receipts.jsonl');
  const receipts = fs.readFileSync(receiptPath, 'utf8').trim().split('\n').map(JSON.parse);
  const hookReceipt = receipts.find((item) => item.adapter === 'userprompt-plan-review-gate');
  const runnerReceipt = receipts.find((item) => item.adapter === 'run-plan');
  assert.equal(hookReceipt.shared_result, 'ready');
  assert.equal(runnerReceipt.shared_result, 'ready');
  assert.equal(hookReceipt.plan_pair_sha256, runnerReceipt.plan_pair_sha256);
  assert.equal(hookReceipt.marker_sha256, runnerReceipt.marker_sha256);
});
