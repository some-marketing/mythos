'use strict';

/**
 * A3 (plan-approval-surface) — pretool-mutation-plan-gate.cjs classifies the
 * plan-task-review-state marker dirs (system + client scope).
 *
 * NO-OVERCLAIM (mirrors the plan's repaired A3 acceptance):
 *   - This step adds the marker dirs to SEVERITY_CLASSES (classification).
 *   - The gate's GOVERNED PERIMETER is add.paths in the canonical rule
 *     (instructions/canonical/process-tier-rule.yaml mutation-plan-gate.paths),
 *     which does NOT yet list the marker dirs. So in production NO soak event
 *     fires for a marker write until that path list is extended — a SEPARATE
 *     governance change outside this step's owned_artifacts (see worker report).
 *     The would-block / sanctioned-writer behaviors below are therefore proven
 *     with a RULE FIXTURE that adds the marker dir to the perimeter — exactly
 *     the established idiom the existing test uses for the blocking-mode flip.
 *   - add.mode stays report-only; this does NOT make the stamp un-forgeable
 *     (that is Stage B/D run-time stamp-proof re-verification, not built here).
 *
 * Run: node --test tools/kernel/hooks/__tests__/pretool-mutation-plan-gate.marker-paths.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gate = require('../pretool-mutation-plan-gate.cjs');
const { readRule, writeSessionTier } = require('../lib/process-tier.cjs');

function makeSandbox({ tier = 'scaffold', model = 'claude-sonnet-4' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-gate-root-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-gate-stamps-'));
  const sessionId = `marker-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeSessionTier({ sessionId, model, tier, tierProvenance: 'resolved-model', source: 'test' }, { stateDir });
  return { root, stateDir, sessionId };
}

// Rule fixture whose mutation-plan-gate perimeter INCLUDES the marker dirs.
function ruleGoverningMarkers() {
  const rule = JSON.parse(JSON.stringify(readRule()));
  rule.add_registry.adds['mutation-plan-gate'].paths.push(
    '_dev/state/plan-task-review-state/**',
    'clients/*/state/plan-task-review-state/**'
  );
  return rule;
}

function runGate(sb, tool, toolInput, rule) {
  return gate.main(
    { tool, payload: { session_id: sb.sessionId, tool_input: toolInput } },
    { root: sb.root, stateDir: sb.stateDir, rule: rule !== undefined ? rule : readRule() }
  );
}

function soakEvents(sb) {
  const ledger = path.join(sb.root, gate.SOAK_DIR_REL, `${gate.ADD_ID}.jsonl`);
  if (!fs.existsSync(ledger)) return [];
  return fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Author an operator-stamped plan/review pair covering `entries`.
function stampPlan(sb, task, entries) {
  const planDir = path.join(sb.root, '_dev/reports/analysis/task-plans');
  const reviewDir = path.join(sb.root, '_dev/state/plan-task-review-state');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, `${task}__plan.json`), JSON.stringify({
    task_id: task,
    bounded_plan: { steps: [{ step_id: `${task}-s1`, files_touched: entries }] }
  }, null, 2));
  fs.writeFileSync(path.join(reviewDir, `${task}.json`), JSON.stringify({
    schema: 'PlanTaskReviewState/1.0',
    plan_id: task,
    operator_stamp: { at: new Date().toISOString(), by: '{OPERATOR_NAME} (human operator)' }
  }, null, 2));
}

// ── classification (in-scope SEVERITY_CLASSES edit) ──────────────────────────

test('classifySeverity governs the system-scope marker dir (non governed-other)', () => {
  const sev = gate.classifySeverity('_dev/state/plan-task-review-state/foo.json');
  assert.strictEqual(sev, 'plan-task-review-state-marker');
  assert.notStrictEqual(sev, 'governed-other');
});

test('classifySeverity governs the client-scope marker dir', () => {
  const sev = gate.classifySeverity('clients/{CLIENT_CODE}/state/plan-task-review-state/bar.json');
  assert.strictEqual(sev, 'plan-task-review-state-marker');
});

// ── governed behavior (proven with a perimeter fixture; see NO-OVERCLAIM) ────

test('with the marker dir in the perimeter, an uncovered marker Edit logs a would-block soak event (report-only, status 0)', () => {
  const sb = makeSandbox();
  const res = runGate(sb, 'edit', { file_path: '_dev/state/plan-task-review-state/uncovered.json' }, ruleGoverningMarkers());
  assert.strictEqual(res.status, 0, 'report-only must NEVER block');
  const events = soakEvents(sb);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].decision, 'would-block');
  assert.strictEqual(events[0].severity, 'plan-task-review-state-marker');
  assert.strictEqual(events[0].mode, 'report-only');
});

test('sanctioned stamp-writer path is NOT blocked (no deadlock): a covering operator-stamped plan satisfies the gate', () => {
  const sb = makeSandbox();
  stampPlan(sb, 'approval-plan', ['_dev/state/plan-task-review-state/approval-plan.json']);
  const res = runGate(
    sb,
    'edit',
    { file_path: '_dev/state/plan-task-review-state/approval-plan.json' },
    ruleGoverningMarkers()
  );
  assert.strictEqual(res.status, 0);
  const events = soakEvents(sb);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].decision, 'satisfied');
  assert.strictEqual(events[0].covering_plan.task, 'approval-plan');
});

// ── honesty guards on the production gap + mode ──────────────────────────────

test('add.mode stays report-only in the live rule (NOT flipped to blocking)', () => {
  assert.strictEqual(readRule().add_registry.adds['mutation-plan-gate'].mode, 'report-only');
});

test('PRODUCTION GAP: the live rule perimeter does NOT yet list the marker dirs (deferred governance change)', () => {
  const paths = readRule().add_registry.adds['mutation-plan-gate'].paths;
  const governs = paths.some((p) => /plan-task-review-state/.test(p));
  assert.strictEqual(
    governs,
    false,
    'If this fails, the canonical rule now lists the marker dir — update the worker-report production-gap note.'
  );
});
