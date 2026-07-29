#!/usr/bin/env node
'use strict';

/**
 * Tests for pretool-mutation-plan-gate.cjs
 * (tier-enforcement-implementation slice 2, step
 * tier-s2c-mutation-plan-gate-report-only; convene 20260611T130035Z
 * conditions 6, 7, 11).
 *
 * Run: node tools/kernel/hooks/__tests__/pretool-mutation-plan-gate.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..', '..');
const gate = require('../pretool-mutation-plan-gate.cjs');
const { readRule, writeSessionTier } = require('../lib/process-tier.cjs');

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

// Isolated sandbox: temp root (soak ledger + plan/review scan + kill switch)
// and temp stamp stateDir, so no repo state is touched.
function makeSandbox({ tier = 'scaffold', model = 'claude-sonnet-4' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-root-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-stamps-'));
  const sessionId = `mutation-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeSessionTier({ sessionId, model, tier, tierProvenance: 'resolved-model', source: 'test' }, { stateDir });
  return { root, stateDir, sessionId };
}

function runGate(sb, tool, toolInput, extra = {}) {
  return gate.main(
    { tool, payload: { session_id: sb.sessionId, tool_input: toolInput } },
    { root: sb.root, stateDir: sb.stateDir, rule: extra.rule !== undefined ? extra.rule : readRule() }
  );
}

function soakEvents(sb) {
  const ledger = path.join(sb.root, gate.SOAK_DIR_REL, `${gate.ADD_ID}.jsonl`);
  if (!fs.existsSync(ledger)) return [];
  return fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Author an operator-stamped plan/review pair in the sandbox covering `entries`.
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

// ── governed-path detection + report-only semantics ─────────────────────────

check('scaffold session Write to instructions/canonical/** logs would-block, status 0 (report-only)', () => {
  const sb = makeSandbox();
  const res = runGate(sb, 'edit', { file_path: 'instructions/canonical/fixture-rule.yaml' });
  assert.equal(res.status, 0, 'report-only must NEVER block');
  const events = soakEvents(sb);
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, 'would-block');
  assert.equal(events[0].severity, 'canonical-kernel-hard');
  assert.equal(events[0].mode, 'report-only');
  // Block message names the exact missing artifact pair and the remedy.
  assert.match(events[0].message, /_dev\/reports\/analysis\/task-plans\/<task>__plan\.json/);
  assert.match(events[0].message, /_dev\/state\/plan-task-review-state\/<task>\.json/);
  assert.match(events[0].message, /\/plan-task/);
  assert.match(events[0].message, /touch _dev\/state\/kill-switches\/mutation-plan-gate\.off/);
});

check('enforcement substrate (_dev/state/session-tier/**) is inside the governed perimeter (condition 7)', () => {
  const sb = makeSandbox();
  const res = runGate(sb, 'edit', { file_path: '_dev/state/session-tier/some-session.json' });
  assert.equal(res.status, 0);
  const events = soakEvents(sb);
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, 'would-block');
  assert.equal(events[0].severity, 'canonical-kernel-hard');
});

check('frameworks/** classifies framework-local-plan-or-workstream severity', () => {
  const sb = makeSandbox();
  runGate(sb, 'edit', { file_path: 'frameworks/wordpress/qa/manifest.json' });
  const events = soakEvents(sb);
  assert.equal(events[0].severity, 'framework-local-plan-or-workstream');
});

check('ungoverned path is a silent no-op (no ledger event)', () => {
  const sb = makeSandbox();
  const res = runGate(sb, 'edit', { file_path: '_dev/reports/analysis/some-report.md' });
  assert.equal(res.status, 0);
  assert.equal(soakEvents(sb).length, 0);
});

check('approved plan + operator-stamped review covering the path satisfies the gate', () => {
  const sb = makeSandbox();
  stampPlan(sb, 'fixture-task', ['tools/kernel/hooks/pretool-mutation-plan-gate.cjs (NEW)']);
  const res = runGate(sb, 'edit', { file_path: 'tools/kernel/hooks/pretool-mutation-plan-gate.cjs' });
  assert.equal(res.status, 0);
  const events = soakEvents(sb);
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, 'satisfied');
  assert.equal(events[0].covering_plan.task, 'fixture-task');
});

check('review state WITHOUT operator_stamp does not satisfy the gate', () => {
  const sb = makeSandbox();
  stampPlan(sb, 'unstamped-task', ['tools/kernel/hooks/pretool-mutation-plan-gate.cjs']);
  const reviewPath = path.join(sb.root, '_dev/state/plan-task-review-state/unstamped-task.json');
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  delete review.operator_stamp;
  fs.writeFileSync(reviewPath, JSON.stringify(review));
  runGate(sb, 'edit', { file_path: 'tools/kernel/hooks/pretool-mutation-plan-gate.cjs' });
  assert.equal(soakEvents(sb)[0].decision, 'would-block');
});

// ── tier scoping: add-ID consumption, never tier names ───────────────────────

check('frontier and associate sessions do not carry the add: gate is a no-op', () => {
  for (const fixture of [
    { tier: 'frontier', model: 'claude-fable-5' },
    { tier: 'associate', model: 'claude-opus-4-5' }
  ]) {
    const sb = makeSandbox(fixture);
    const res = runGate(sb, 'edit', { file_path: 'instructions/canonical/fixture-rule.yaml' });
    assert.equal(res.status, 0);
    assert.equal(soakEvents(sb).length, 0, `${fixture.tier} must not be gated`);
  }
});

check('missing stamp fails open (no add resolution -> no-op)', () => {
  const sb = makeSandbox();
  const res = gate.main(
    { tool: 'edit', payload: { session_id: 'never-stamped-session', tool_input: { file_path: 'instructions/canonical/x.yaml' } } },
    { root: sb.root, stateDir: sb.stateDir, rule: readRule() }
  );
  assert.equal(res.status, 0);
  assert.equal(soakEvents(sb).length, 0);
});

// ── kill switch (condition 11 / enforce-interruptability) ────────────────────

check('kill switch file disables the gate entirely (honored from day one)', () => {
  const sb = makeSandbox();
  const kill = path.join(sb.root, '_dev/state/kill-switches/mutation-plan-gate.off');
  fs.mkdirSync(path.dirname(kill), { recursive: true });
  fs.writeFileSync(kill, '');
  const res = runGate(sb, 'edit', { file_path: 'instructions/canonical/fixture-rule.yaml' });
  assert.equal(res.status, 0);
  assert.equal(res.killed, true);
  assert.equal(soakEvents(sb).length, 0);
});

// ── mutating-Bash classifier fixture set (heredoc, redirect, tee, git apply) ─

check('bash classifier: redirect, heredoc write, append', () => {
  assert.deepEqual(
    gate.extractBashMutationTargets('echo hi > instructions/canonical/x.yaml'),
    [{ target: 'instructions/canonical/x.yaml', via: 'redirect' }]
  );
  const heredoc = gate.extractBashMutationTargets("cat > tools/kernel/hooks/h.cjs <<'EOF'\ncode\nEOF");
  assert.deepEqual(heredoc, [{ target: 'tools/kernel/hooks/h.cjs', via: 'redirect' }]);
  assert.deepEqual(
    gate.extractBashMutationTargets('echo x >> .claude/settings.json'),
    [{ target: '.claude/settings.json', via: 'redirect' }]
  );
});

check('bash classifier: tee, sed -i, perl -i, git apply', () => {
  assert.deepEqual(
    gate.extractBashMutationTargets('echo x | tee -a frameworks/a/b.json'),
    [{ target: 'frameworks/a/b.json', via: 'tee' }]
  );
  assert.deepEqual(
    gate.extractBashMutationTargets("sed -i '' 's/a/b/' instructions/canonical/r.yaml"),
    [{ target: 'instructions/canonical/r.yaml', via: 'sed-i' }]
  );
  assert.deepEqual(
    gate.extractBashMutationTargets("perl -pi -e 's/a/b/' tools/kernel/k.cjs"),
    [{ target: 'tools/kernel/k.cjs', via: 'perl-i' }]
  );
  assert.deepEqual(
    gate.extractBashMutationTargets('git apply /tmp/patch.diff'),
    [{ target: null, via: 'git-apply' }]
  );
});

check('bash classifier: ordinary commands are NOT mutations; fd redirects ignored', () => {
  assert.deepEqual(gate.extractBashMutationTargets('git status'), []);
  assert.deepEqual(gate.extractBashMutationTargets('node tools/kernel/heartbeat.js'), []);
  assert.deepEqual(gate.extractBashMutationTargets('npm test 2>&1'), []);
  assert.deepEqual(gate.extractBashMutationTargets('ls instructions/canonical/'), []);
});

check('bash lane end-to-end: heredoc write to governed path logs would-block; git apply logs unclassifiable', () => {
  const sb = makeSandbox();
  const res = runGate(sb, 'bash', { command: "cat > instructions/canonical/new-rule.yaml <<'EOF'\n{}\nEOF" });
  assert.equal(res.status, 0);
  let events = soakEvents(sb);
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, 'would-block');
  assert.equal(events[0].via, 'redirect');

  runGate(sb, 'bash', { command: 'git apply staged.patch' });
  events = soakEvents(sb);
  assert.equal(events.length, 2);
  assert.equal(events[1].decision, 'unclassifiable-target');
  assert.equal(events[1].via, 'git-apply');
});

// ── blocking MECHANISM (mode flip is operator-only; tested via rule fixture) ─

check('blocking mode (rule fixture, NOT the live rule) returns status 2 with the named-artifact message', () => {
  const sb = makeSandbox();
  const blockingRule = JSON.parse(JSON.stringify(readRule()));
  blockingRule.add_registry.adds['mutation-plan-gate'].mode = 'blocking';
  const res = runGate(sb, 'edit', { file_path: 'instructions/canonical/fixture-rule.yaml' }, { rule: blockingRule });
  assert.equal(res.status, 2);
  assert.match(res.message, /MUTATION-PLAN GATE/);
  assert.match(res.message, /_dev\/reports\/analysis\/task-plans\/<task>__plan\.json/);
  const events = soakEvents(sb);
  assert.equal(events[0].mode, 'blocking');
});

check('live canonical rule keeps mutation-plan-gate.mode = report-only (flip is a separate operator decision)', () => {
  const live = readRule();
  assert.equal(live.add_registry.adds['mutation-plan-gate'].mode, 'report-only');
});

console.log(`\npretool-mutation-plan-gate: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
