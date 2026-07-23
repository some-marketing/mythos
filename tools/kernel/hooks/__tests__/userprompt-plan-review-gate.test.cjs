#!/usr/bin/env node
'use strict';

/**
 * Unit tests for the plan-review mechanical gate.
 * Stdlib-only assertion harness — run:
 *   node tools/kernel/hooks/__tests__/userprompt-plan-review-gate.test.cjs
 *
 * Builds a throwaway fixture project root in a temp dir; never touches real
 * repo state (the override-log test writes inside the temp root).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parsePrompt, evaluateGate } = require('../userprompt-plan-review-gate.cjs');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.error('  FAIL: ' + label + ' — ' + err.message);
  }
}

// ---------- fixture project root ----------
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-gate-test-'));
const PLAN_DIR = path.join(ROOT, '_dev', 'reports', 'analysis', 'task-plans');
const MARKER_DIR = path.join(ROOT, '_dev', 'state', 'plan-task-review-state');
const CONVENE_DIR = path.join(ROOT, '_dev', 'reports', 'analysis', 'convene-runs');
fs.mkdirSync(PLAN_DIR, { recursive: true });
fs.mkdirSync(MARKER_DIR, { recursive: true });
fs.mkdirSync(CONVENE_DIR, { recursive: true });

function writePlan(id, riskTier) {
  fs.writeFileSync(
    path.join(PLAN_DIR, id + '__plan.json'),
    JSON.stringify({ task_id: id, routing_expectations: { risk_tier: riskTier } }, null, 2)
  );
}
function writeMarker(id, marker) {
  fs.writeFileSync(path.join(MARKER_DIR, id + '.json'), JSON.stringify(marker, null, 2));
}

// Plans:
//   ok-plan       — low risk, satisfying distinct review        => PASS note
//   noreview-plan — low risk, marker without distinct_reviews   => LOUD block
//   pending-plan  — low risk, review in flight (pending)        => LOUD block
//   big-plan      — risk_tier high, satisfied review, NO convene => LOUD block
//   bigok-plan    — risk_tier high, satisfied review + convene  => PASS note
writePlan('ok-plan', 'low');
writeMarker('ok-plan', {
  schema: 'PlanTaskReviewState/1.0', task_id: 'ok-plan', last_event: 'review_approved', verdict: 'APPROVE',
  distinct_reviews: [{ actor: 'codex gpt-5.5', artifact: '_dev/reports/analysis/codex-last-message__x__ok-plan.md', at: '2026-06-10T00:00:00Z', verdict: 'approve' }]
});

writePlan('noreview-plan', 'low');
writeMarker('noreview-plan', {
  schema: 'PlanTaskReviewState/1.0', task_id: 'noreview-plan', last_event: 'review_approved', verdict: 'APPROVE',
  distinct_reviews: []
});

writePlan('pending-plan', 'low');
writeMarker('pending-plan', {
  schema: 'PlanTaskReviewState/1.0', task_id: 'pending-plan', last_event: 'review_approved', verdict: 'APPROVE',
  distinct_reviews: [],
  distinct_reviews_pending: [{ actor: 'codex gpt-5.5', artifact: null, dispatched_at: '2026-06-10T14:13:00Z', note: 'codex review in flight' }]
});

writePlan('big-plan', 'high');
writeMarker('big-plan', {
  schema: 'PlanTaskReviewState/1.0', task_id: 'big-plan', last_event: 'review_approved', verdict: 'APPROVE',
  distinct_reviews: [{ actor: 'codex gpt-5.5', artifact: '_dev/reports/analysis/codex-last-message__x__big-plan.md', at: '2026-06-10T00:00:00Z', verdict: 'approve' }]
});

writePlan('bigok-plan', 'high');
writeMarker('bigok-plan', {
  schema: 'PlanTaskReviewState/1.0', task_id: 'bigok-plan', last_event: 'review_approved', verdict: 'APPROVE',
  distinct_reviews: [{ actor: 'codex gpt-5.5', artifact: '_dev/reports/analysis/codex-last-message__x__bigok-plan.md', at: '2026-06-10T00:00:00Z', verdict: 'approve' }]
});
fs.mkdirSync(path.join(CONVENE_DIR, '20260610T000000Z-bigok-plan-triad'), { recursive: true });

// ---------- parsePrompt ----------
check('non-matching prompt does not match', () => {
  assert.strictEqual(parsePrompt('hey, how does the cadence system work?').matched, false);
});
check('prose mentioning run-plan mid-word does not match', () => {
  assert.strictEqual(parsePrompt('we should rerun-plans later').matched, false);
});
check('/run-plan with id matches and extracts ref', () => {
  const p = parsePrompt('/run-plan ok-plan');
  assert.strictEqual(p.matched, true);
  assert.strictEqual(p.planRef, 'ok-plan');
  assert.strictEqual(p.override, false);
});
check('bare run-plan (no slash) matches with null ref', () => {
  const p = parsePrompt('run-plan');
  assert.strictEqual(p.matched, true);
  assert.strictEqual(p.planRef, null);
});
check('override flag detected and not taken as plan ref', () => {
  const p = parsePrompt('/run-plan --skip-distinct-review ok-plan');
  assert.strictEqual(p.override, true);
  assert.strictEqual(p.planRef, 'ok-plan');
});

// ---------- evaluateGate ----------
check('1. non-matching prompt => silent', () => {
  const r = evaluateGate('thanks, looks good', ROOT, 'test-session');
  assert.strictEqual(r.action, 'silent');
});

check('2. /run-plan with satisfied marker => pass note', () => {
  const r = evaluateGate('/run-plan ok-plan', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/PASS for ok-plan/.test(r.text), 'expected PASS note, got: ' + r.text);
  assert.ok(!/DO NOT EXECUTE/.test(r.text));
});

check('3. /run-plan missing codex review => loud block', () => {
  const r = evaluateGate('/run-plan noreview-plan', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/DO NOT EXECUTE/.test(r.text), 'expected loud block, got: ' + r.text);
  assert.ok(/DISTINCT-MIND \(codex\) REVIEW/.test(r.text));
  assert.ok(/dispatch-bridge/.test(r.text), 'block must name the remediation command');
  assert.ok(/--skip-distinct-review/.test(r.text), 'block must name the operator override');
});

check('3b. pending (in-flight) review does not satisfy => loud block', () => {
  const r = evaluateGate('/run-plan pending-plan', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/DO NOT EXECUTE/.test(r.text));
  assert.ok(/IN FLIGHT/.test(r.text));
});

check('4. BIG plan missing convene => loud block naming /convene', () => {
  const r = evaluateGate('/run-plan big-plan', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/DO NOT EXECUTE/.test(r.text), 'expected loud block, got: ' + r.text);
  assert.ok(/BIG PLAN WITHOUT CONVENE/.test(r.text));
  assert.ok(/\/convene/.test(r.text));
});

check('4b. BIG plan with convene artifact + review => pass', () => {
  const r = evaluateGate('/run-plan bigok-plan', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/PASS for bigok-plan/.test(r.text), 'expected PASS, got: ' + r.text);
  assert.ok(/convene evidence verified/.test(r.text));
});

check('5. override flag => acknowledged pass + logged', () => {
  const r = evaluateGate('/run-plan noreview-plan --skip-distinct-review', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/OPERATOR OVERRIDE acknowledged/.test(r.text), 'expected override ack, got: ' + r.text);
  assert.ok(!/DO NOT EXECUTE/.test(r.text));
  const log = fs.readFileSync(path.join(ROOT, '_dev', 'state', 'plan-review-gate', 'overrides.jsonl'), 'utf8');
  assert.ok(log.includes('noreview-plan'), 'override must be logged');
});

check('6. unresolvable plan => WARN, never crash', () => {
  const r = evaluateGate('/run-plan does-not-exist-anywhere', ROOT, 'test-session');
  assert.strictEqual(r.action, 'inject');
  assert.ok(/WARN: could not resolve plan/.test(r.text), 'expected WARN, got: ' + r.text);
});

check('7. kill switch => silent even on match', () => {
  const gateDir = path.join(ROOT, '_dev', 'state', 'plan-review-gate');
  fs.writeFileSync(path.join(gateDir, 'disabled'), '');
  const r = evaluateGate('/run-plan noreview-plan', ROOT, 'test-session');
  assert.strictEqual(r.action, 'silent');
  fs.unlinkSync(path.join(gateDir, 'disabled'));
});

// ---------- cleanup + report ----------
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* best-effort */ }

console.log('userprompt-plan-review-gate: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
