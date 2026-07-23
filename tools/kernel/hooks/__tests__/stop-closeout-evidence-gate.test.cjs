#!/usr/bin/env node
'use strict';

/**
 * Tests for stop-closeout-evidence-gate.cjs and the delegation-altitude-cap
 * add consumer in pretool-delegation-altitude.cjs
 * (tier-enforcement-implementation slice 2, step
 * tier-s2d-closeout-and-delegation-consumers; convene 20260611T130035Z
 * conditions 8, 9, 11).
 *
 * Run: node tools/kernel/hooks/__tests__/stop-closeout-evidence-gate.test.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const closeoutGate = require('../stop-closeout-evidence-gate.cjs');
const enforcementRegistry = require('../../enforcement-home/enforcement-home-registry.cjs');
const { evaluateDelegationCap, DELEGATION_CAP_ADD_ID } = require('../pretool-delegation-altitude.cjs');
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

function makeSandbox({ tier = 'associate', model = 'gpt-5.5', scope = null, ceiling = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-gate-root-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-gate-stamps-'));
  const sessionId = `closeout-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeSessionTier({
    sessionId,
    model,
    tier,
    tierProvenance: 'resolved-model',
    coordinationScope: scope,
    judgmentCeiling: ceiling,
    source: 'test'
  }, { stateDir });
  return { root, stateDir, sessionId };
}

function markAuthored(sb, edits = 3) {
  const dir = path.join(sb.root, '_dev/state/delegation-altitude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sb.sessionId}.json`), JSON.stringify({ spawns: 0, edits }));
}

function writeEvidence(sb, dirRel, name) {
  const dir = path.join(sb.root, dirRel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'evidence\n');
}

// Bind an absolute path into THIS session's delegation-altitude edit log
// (paths[]) — the strongest, zero-friction binding surface (holistic-acceptance
// C2). Mirrors a real session: a file it WROTE lands in its own edit log.
function bindPath(sb, absPath) {
  const dir = path.join(sb.root, '_dev/state/delegation-altitude');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${sb.sessionId}.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none yet */ }
  if (!Array.isArray(st.paths)) st.paths = [];
  if (typeof st.edits !== 'number') st.edits = 0;
  st.paths.push(absPath);
  fs.writeFileSync(f, JSON.stringify(st));
}

// Write evidence AND bind it to the producing session (C2). Use for artifacts
// THIS session authored; use writeEvidence for sibling/unrelated artifacts.
function writeBoundEvidence(sb, dirRel, name) {
  const dir = path.join(sb.root, dirRel);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, 'evidence\n');
  bindPath(sb, abs);
  return abs;
}

function runCloseout(sb, payloadExtra = {}, optsExtra = {}) {
  return closeoutGate.main(
    { session_id: sb.sessionId, ...payloadExtra },
    { root: sb.root, stateDir: sb.stateDir, rule: optsExtra.rule !== undefined ? optsExtra.rule : readRule(), ...optsExtra }
  );
}

function closeoutSoakEvents(sb) {
  const ledger = path.join(sb.root, closeoutGate.SOAK_DIR_REL, `${closeoutGate.ADD_ID}.jsonl`);
  if (!fs.existsSync(ledger)) return [];
  return fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function debriefObservations(sb) {
  const file = path.join(sb.root, '_dev/state/debrief-closeout/span-observations.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// ── closeout-evidence gate ───────────────────────────────────────────────────

check('associate session that authored with no evidence: deficits logged, status 0 (report-only)', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  // The live canonical rule is now `blocking` (promoted report-only -> blocking
  // 2026-06-15), so the report-only non-trapping behavior is pinned via an
  // explicit fixture rather than relying on the live default.
  const reportOnlyRule = JSON.parse(JSON.stringify(readRule()));
  reportOnlyRule.add_registry.adds['closeout-evidence-gate'].mode = 'report-only';
  const res = runCloseout(sb, {}, { rule: reportOnlyRule });
  assert.equal(res.status, 0, 'report-only must never trap the session');
  assert.ok(Array.isArray(res.deficits));
  const names = res.deficits.map((d) => d.deficit);
  assert.ok(names.includes('missing-closeout-evidence-artifact'));
  // associate also carries no-final-status-authority -> distinct review owed
  assert.ok(names.includes('missing-distinct-review-artifact'));
  const events = closeoutSoakEvents(sb);
  assert.equal(events.length, 1);
  assert.equal(events[0].decision, 'would-refuse-closeout');
  assert.match(events[0].message, /\/debrief-run/);
  assert.match(events[0].message, /task-plan-reviews/);
  assert.match(events[0].message, /closeout-evidence-gate\.off/);
});

check('session that authored nothing owes no evidence (no-op)', () => {
  const sb = makeSandbox();
  const res = runCloseout(sb);
  assert.equal(res.status, 0);
  assert.equal(res.reason, 'no-authoring-this-session');
  assert.equal(closeoutSoakEvents(sb).length, 0);
});

check('closeout evidence written this session clears the base deficit; distinct review clears the review deficit', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  // C2: evidence must be BOUND to this session (here via the edit log).
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'session-debrief__fixture.md');
  let res = runCloseout(sb);
  let names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(!names.includes('missing-closeout-evidence-artifact'));
  assert.ok(names.includes('missing-distinct-review-artifact'));
  writeBoundEvidence(sb, '_dev/reports/analysis/task-plan-reviews', 'fixture__review.md');
  res = runCloseout(sb);
  assert.equal(res.status, 0);
  assert.equal(res.deficits, undefined);
});

check('codex-last-message bridge return counts as distinct-review evidence when bound to session', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'session-debrief__fixture.md');
  // Bound artifact: content references the session_id (W1 binding rule,
  // amendment tier-enforcement-implementation__amendment__20260611T145003Z).
  const dir = path.join(sb.root, '_dev/reports/analysis');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'codex-last-message__fixture.md'), `session: ${sb.sessionId}\n`);
  const res = runCloseout(sb);
  assert.equal(res.deficits, undefined);
});

check('REVIEWER-ROLE EXEMPTION (G8 fixture): gpt-5 reviewer session is untouched; same model as coordinator is gated', () => {
  // role-keyed: same model, role reviewer -> exempt
  const reviewer = makeSandbox({ tier: 'associate', model: 'gpt-5.5' });
  markAuthored(reviewer);
  const res = runCloseout(reviewer, { session_role: 'reviewer' });
  assert.equal(res.status, 0);
  assert.equal(res.exempt, 'reviewer-role');
  assert.equal(closeoutSoakEvents(reviewer).length, 0, 'reviewer lane must not be soak-logged');

  // same model, no reviewer role -> gated (proves the key is ROLE, not model)
  const coordinator = makeSandbox({ tier: 'associate', model: 'gpt-5.5' });
  markAuthored(coordinator);
  const res2 = runCloseout(coordinator);
  assert.ok((res2.deficits || []).length > 0);
});

check('scaffold session carries the gate; frontier does not', () => {
  const scaffold = makeSandbox({ tier: 'scaffold', model: 'claude-sonnet-4' });
  markAuthored(scaffold);
  assert.ok((runCloseout(scaffold).deficits || []).length > 0);

  const frontier = makeSandbox({ tier: 'frontier', model: 'claude-opus-4' });
  markAuthored(frontier);
  const res = runCloseout(frontier);
  assert.equal(res.status, 0);
  assert.equal(res.deficits, undefined);
  assert.equal(closeoutSoakEvents(frontier).length, 0);
});

check('deficit events are deduped per session (Stop fires every turn)', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  runCloseout(sb);
  const second = runCloseout(sb);
  assert.equal(second.deduped, true);
  assert.equal(second.status, 2, 'dedup may suppress the ledger row, never the blocking decision');
  assert.equal(second.debrief_decision.outcome, 'deny');
  assert.equal(second.debrief_decision.enforced, true);
  assert.equal(closeoutSoakEvents(sb).length, 1, 'one ledger entry per deficit-set');
  assert.equal(debriefObservations(sb).length, 2, 'each evaluated subdecision remains observable');
});

check('debrief allow remains allow when distinct-review enforcement blocks combined Stop', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'session-debrief__fixture.md');
  const res = runCloseout(sb);
  assert.equal(res.status, 2, 'combined Stop remains blocked by missing distinct review');
  assert.equal(res.debrief_decision.outcome, 'allow');
  assert.equal(res.debrief_decision.enforced, false);
  assert.deepEqual((res.deficits || []).map((d) => d.deficit), ['missing-distinct-review-artifact']);
  assert.equal(res.debrief_observation.projection.outcome, 'allow');
});

check('not-applicable early exit is typed and emits no span', () => {
  const sb = makeSandbox();
  const res = runCloseout(sb);
  assert.equal(res.debrief_decision.outcome, 'not_applicable');
  assert.equal(res.debrief_decision.skip_reason, 'no-authoring-this-session');
  assert.equal(debriefObservations(sb).length, 0);
});

check('span sink failure does not alter blocking enforcement and is durably signaled', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  const badSink = path.join(sb.root, 'span-log-directory');
  fs.mkdirSync(badSink);
  const failureLogPath = path.join(sb.root, '_dev/state/debrief-closeout/test-failures.jsonl');
  const res = runCloseout(sb, {}, { spanLogPath: badSink, failureLogPath });
  assert.equal(res.status, 2);
  assert.equal(res.debrief_decision.outcome, 'deny');
  assert.equal(res.debrief_observation.ok, false);
  assert.ok(fs.existsSync(failureLogPath));
});

check('native ownership makes only the Claude debrief subdecision non-owning', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/analysis/task-plan-reviews', 'paired-review.md');
  enforcementRegistry.initializeRegistry(sb.root);
  enforcementRegistry.promoteNative(sb.root, { reason: 'test-native-owner' });
  const res = runCloseout(sb);
  assert.equal(res.status, 0, 'Claude must not block the debrief deficit after native promotion');
  assert.equal(res.debrief_decision.outcome, 'deny');
  assert.equal(res.debrief_decision.enforced, false);
  assert.equal(res.debrief_ownership.blocking_owner, 'native_fork');
  assert.ok((res.deficits || []).some((d) => d.deficit === 'missing-closeout-evidence-artifact'), 'report-only deficit remains observable');
});

check('native ownership preserves unrelated distinct-review Stop enforcement', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'paired-debrief.md');
  enforcementRegistry.initializeRegistry(sb.root);
  enforcementRegistry.promoteNative(sb.root, { reason: 'test-native-owner' });
  const res = runCloseout(sb);
  assert.equal(res.status, 2);
  assert.equal(res.debrief_decision.outcome, 'allow');
  assert.deepEqual((res.deficits || []).map((d) => d.deficit), ['missing-distinct-review-artifact']);
});

check('corrupt registry fails safe to Claude ownership', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/analysis/task-plan-reviews', 'paired-review.md');
  const target = enforcementRegistry.registryPath(sb.root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{bad-json');
  const res = runCloseout(sb);
  assert.equal(res.status, 2);
  assert.equal(res.debrief_decision.enforced, true);
  assert.equal(res.debrief_ownership.blocking_owner, 'claude_hook');
  assert.equal(res.debrief_ownership.fail_safe_active, true);
});

check('rollback restores Claude blocking on the next deduped Stop without restart', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/analysis/task-plan-reviews', 'paired-review.md');
  enforcementRegistry.initializeRegistry(sb.root);
  enforcementRegistry.promoteNative(sb.root, { reason: 'test-native-owner' });
  const before = runCloseout(sb);
  assert.equal(before.status, 0);
  enforcementRegistry.rollbackToClaude(sb.root, { reason: 'test-divergence' });
  const after = runCloseout(sb);
  assert.equal(after.deduped, true);
  assert.equal(after.status, 2);
  assert.equal(after.debrief_decision.enforced, true);
  assert.equal(after.debrief_ownership.blocking_owner, 'claude_hook');
});

check('kill switch disables the closeout gate', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  const kill = path.join(sb.root, '_dev/state/kill-switches/closeout-evidence-gate.off');
  fs.mkdirSync(path.dirname(kill), { recursive: true });
  fs.writeFileSync(kill, '');
  const res = runCloseout(sb);
  assert.equal(res.killed, true);
  assert.equal(closeoutSoakEvents(sb).length, 0);
});

check('blocking mode returns status 2; live rule is now blocking (promoted 2026-06-15)', () => {
  const sb = makeSandbox();
  markAuthored(sb);
  const blockingRule = JSON.parse(JSON.stringify(readRule()));
  blockingRule.add_registry.adds['closeout-evidence-gate'].mode = 'blocking';
  const res = runCloseout(sb, {}, { rule: blockingRule });
  assert.equal(res.status, 2);
  assert.match(res.message, /CLOSEOUT-EVIDENCE GATE/);
  // A blocking trap must explain itself truthfully — never claim "report-only".
  assert.match(res.message, /blocking — closeout refused/);
  assert.doesNotMatch(res.message, /report-only/);
  assert.equal(readRule().add_registry.adds['closeout-evidence-gate'].mode, 'blocking');
});

// ── W1 binding regression tests (amendment tier-enforcement-implementation__amendment__20260611T145003Z) ──

check('W1-A: unrelated fresh codex-last-message artifact does NOT clear the distinct-review deficit', () => {
  // An unrelated bridge-return artifact (different task, no session_id or
  // plan_id in filename or content) must not satisfy the distinct-review
  // evidence requirement (div-2 case A).
  const sb = makeSandbox();
  markAuthored(sb);
  writeEvidence(sb, '_dev/reports/debriefs', 'session-debrief__fixture.md');
  // Unrelated artifact: filename and content carry no session/plan binding.
  writeEvidence(sb, '_dev/reports/analysis', 'codex-last-message__unrelated-task-xyz__review.md');
  const res = runCloseout(sb);
  const names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(
    names.includes('missing-distinct-review-artifact'),
    `Expected missing-distinct-review-artifact deficit, got: ${JSON.stringify(res.deficits)}`
  );
});

check('W1-B: correctly-bound codex-last-message artifact DOES clear the distinct-review deficit', () => {
  // A bridge-return whose filename contains the session_id is bound (div-2 case B).
  const sb = makeSandbox();
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'session-debrief__fixture.md');
  // Bound via filename containing session_id.
  const dir = path.join(sb.root, '_dev/reports/analysis');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `codex-last-message__${sb.sessionId}__review.md`), 'review content\n');
  const res = runCloseout(sb);
  assert.equal(
    res.deficits,
    undefined,
    `Expected no deficits, got: ${JSON.stringify(res.deficits)}`
  );
});

check('W1-C: binding-indeterminate artifact logs would-block with reason binding_unresolved', () => {
  // A fresh codex-last-message artifact with no session/plan binding logs a
  // would-block soak event with reason: binding_unresolved (div-2 case C).
  const sb = makeSandbox();
  markAuthored(sb);
  writeEvidence(sb, '_dev/reports/debriefs', 'session-debrief__fixture.md');
  // Non-matching filename, no session content — indeterminate binding.
  writeEvidence(sb, '_dev/reports/analysis', 'codex-last-message__other-session-task__fixture.md');
  runCloseout(sb);
  const events = closeoutSoakEvents(sb);
  const bindingEvent = events.find((e) => e.reason === 'binding_unresolved');
  assert.ok(
    bindingEvent,
    `Expected a soak event with reason binding_unresolved; got events: ${JSON.stringify(events)}`
  );
  assert.equal(bindingEvent.decision, 'would-block');
});

// ── delegation-altitude-cap add consumer ─────────────────────────────────────

function runCap(sb, { toolInput = {}, payloadExtra = {}, rule } = {}) {
  return evaluateDelegationCap(
    {
      projectDir: sb.root,
      sessionId: sb.sessionId,
      payload: { session_id: sb.sessionId, ...payloadExtra },
      toolInput
    },
    { stateDir: sb.stateDir, rule: rule !== undefined ? rule : readRule() }
  );
}

function capSoakEvents(sb) {
  const ledger = path.join(sb.root, '_dev/state/tier-gate-soak', `${DELEGATION_CAP_ADD_ID}.jsonl`);
  if (!fs.existsSync(ledger)) return [];
  return fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

check('haiku session-root coordination is reported (blocked-by-report, status 0)', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-haiku-4', scope: 'session-root' });
  const res = runCap(sb, { toolInput: { prompt: 'work' } });
  assert.equal(res.status, 0, 'report-only: never blocks');
  const reasons = (res.events || []).map((e) => e.reason);
  assert.ok(reasons.includes('session-root-coordination-forbidden-for-model'));
  assert.equal(capSoakEvents(sb).length, 1);
});

check('haiku subtree coordination with ceiling + contract artifact passes; missing contract artifact is reported', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-haiku-4', scope: 'subtree', ceiling: 'sentinel' });
  // contract artifact present
  writeEvidence(sb, '_dev/reports/analysis', 'subtree-contract__fixture.md');
  const ok = runCap(sb, { payloadExtra: { subtree_contract: '_dev/reports/analysis/subtree-contract__fixture.md' } });
  assert.equal(ok.status, 0);
  assert.equal(ok.events, undefined, `unexpected events: ${JSON.stringify(ok.events)}`);

  // contract artifact missing
  const sb2 = makeSandbox({ tier: 'scaffold', model: 'claude-haiku-4', scope: 'subtree', ceiling: 'sentinel' });
  const bad = runCap(sb2);
  const reasons = (bad.events || []).map((e) => e.reason);
  assert.ok(reasons.includes('subtree-contract-artifact-missing'));
});

check('subtree without a declared judgment ceiling is reported', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-haiku-4', scope: 'subtree' });
  const res = runCap(sb);
  const reasons = (res.events || []).map((e) => e.reason);
  assert.ok(reasons.includes('missing-judgment-ceiling'));
});

check('dispatching a mind above the coordinator tier is reported (route acceptance upward)', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-sonnet-4' });
  const res = runCap(sb, { toolInput: { model: 'opus', subagent_type: 'general-purpose' } });
  const reasons = (res.events || []).map((e) => e.reason);
  assert.ok(reasons.includes('dispatch-above-own-tier-route-acceptance-upward'));
});

check('same-tier review-shaped dispatch is reported as self-clear risk; same-tier worker dispatch is not', () => {
  // C5 fixture fix (holistic-acceptance): the product branch at
  // pretool-delegation-altitude.cjs fires same-tier-review-dispatch-self-clear-risk
  // only when the dispatched model's tier RANK EQUALS the coordinator's. The
  // previous fixture paired an 'associate' (rank 3) coordinator with 'opus-mini'
  // which resolves to 'frontier' (rank 4), so it tripped the ABOVE-tier branch
  // instead and the same-tier branch never ran. Use a genuinely same-tier pair:
  // coordinator 'associate' dispatching 'gpt-5.5' (also resolves to 'associate').
  const sb = makeSandbox({ tier: 'associate', model: 'gpt-5.5' });
  const risky = runCap(sb, { toolInput: { model: 'gpt-5.5', subagent_type: 'output-reviewer' } });
  assert.ok((risky.events || []).some((e) => e.reason === 'same-tier-review-dispatch-self-clear-risk'),
    `expected same-tier-review self-clear-risk; got ${JSON.stringify(risky.events)}`);

  // Same tier, but a worker (not review-shaped) dispatch is NOT a self-clear risk.
  const sb2 = makeSandbox({ tier: 'associate', model: 'gpt-5.5' });
  const fine = runCap(sb2, { toolInput: { model: 'gpt-5.5', subagent_type: 'general-purpose' } });
  assert.equal(fine.events, undefined);
});

check('REVIEWER-ROLE EXEMPTION on the cap (G8): gpt-5 reviewer dispatching is untouched', () => {
  const sb = makeSandbox({ tier: 'associate', model: 'gpt-5.5', scope: 'session-root' });
  const res = runCap(sb, { toolInput: { model: 'opus' }, payloadExtra: { session_role: 'reviewer' } });
  assert.equal(res.status, 0);
  assert.equal(res.exempt, 'reviewer-role');
  assert.equal(capSoakEvents(sb).length, 0);
});

check('frontier session does not carry the cap add (no-op); kill switch honored for carriers', () => {
  const frontier = makeSandbox({ tier: 'frontier', model: 'claude-opus-4', scope: 'session-root' });
  assert.deepEqual(runCap(frontier, { toolInput: { model: 'opus' } }), { status: 0 });

  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-haiku-4', scope: 'session-root' });
  const kill = path.join(sb.root, '_dev/state/kill-switches/delegation-altitude-cap.off');
  fs.mkdirSync(path.dirname(kill), { recursive: true });
  fs.writeFileSync(kill, '');
  const res = runCap(sb);
  assert.equal(res.killed, true);
});

check('cap blocking mode (rule fixture) returns status 2; live rule stays report-only', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-haiku-4', scope: 'session-root' });
  const blockingRule = JSON.parse(JSON.stringify(readRule()));
  blockingRule.add_registry.adds['delegation-altitude-cap'].mode = 'blocking';
  const res = runCap(sb, { rule: blockingRule });
  assert.equal(res.status, 2);
  assert.match(res.message, /DELEGATION-ALTITUDE CAP/);
  assert.equal(readRule().add_registry.adds['delegation-altitude-cap'].mode, 'report-only');
});

// ── holistic-acceptance C2: closeout-evidence binding (close the loophole) ────

check('C2: a SIBLING session\'s fresh debrief does NOT clear this session\'s closeout gate', () => {
  const sb = makeSandbox();
  markAuthored(sb); // this session authored, owes evidence — but writes none
  // A different session (or background automation) drops a fresh debrief in the
  // SAME directory: unbound to us (not in our edit log, no session_id/plan_id).
  writeEvidence(sb, '_dev/reports/debriefs', 'someone-elses-debrief.md');
  const res = runCloseout(sb);
  const names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(names.includes('missing-closeout-evidence-artifact'),
    `sibling artifact must NOT clear the gate; got ${JSON.stringify(res.deficits)}`);
  const def = res.deficits.find((d) => d.deficit === 'missing-closeout-evidence-artifact');
  assert.ok(def.binding_note, 'unbound-but-fresh closeout should carry a binding_note');
  const events = closeoutSoakEvents(sb);
  assert.ok(events.some((e) => Array.isArray(e.binding_reasons) && e.binding_reasons.includes('closeout_binding_unresolved')),
    'an unbound fresh closeout must log a would-block soak event (counted, not silently passed)');
});

check('C2 CRITICAL: a sibling debrief whose CONTENT merely mentions this session_id does NOT clear closeout', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-sonnet-4' });
  markAuthored(sb);
  // Not in our edit log, not self-named — only a prose mention. Association, not
  // production. Must NOT bind the PRODUCTION closeout surface (codex C2).
  const dir = path.join(sb.root, '_dev/reports/debriefs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sibling-debrief.md'), `notes about session ${sb.sessionId} from elsewhere\n`);
  const res = runCloseout(sb);
  const names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(names.includes('missing-closeout-evidence-artifact'),
    `content-mention must NOT clear the closeout gate; got ${JSON.stringify(res.deficits)}`);
});

check('C2: an EDIT-LOG-bound closeout artifact (this session wrote it) DOES clear the gate', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-sonnet-4' }); // scaffold: closeout add, no review add
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'my-debrief.md'); // bound via edit-log paths[]
  const res = runCloseout(sb);
  const names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(!names.includes('missing-closeout-evidence-artifact'),
    `edit-log-bound evidence must clear the closeout deficit; got ${JSON.stringify(res.deficits)}`);
});

check('C2: a closeout artifact whose FILENAME carries the session_id DOES clear the gate', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-sonnet-4' });
  markAuthored(sb);
  // No edit-log entry; binding strategy 3 (filename contains session_id).
  writeEvidence(sb, '_dev/reports/debriefs', `debrief__${sb.sessionId}.md`);
  const res = runCloseout(sb);
  const names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(!names.includes('missing-closeout-evidence-artifact'),
    `filename-session_id binding must clear the closeout deficit; got ${JSON.stringify(res.deficits)}`);
});

check('C2: a SIBLING task-plan-review does NOT clear the distinct-review deficit (no trusted-by-directory)', () => {
  const sb = makeSandbox({ tier: 'associate', model: 'gpt-5.5' }); // carries review add
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'my-debrief.md'); // closeout bound
  // Unbound plan-review from another session — must NOT clear under C2.
  writeEvidence(sb, '_dev/reports/analysis/task-plan-reviews', 'someone-elses__review.md');
  const res = runCloseout(sb);
  const names = (res.deficits || []).map((d) => d.deficit);
  assert.ok(!names.includes('missing-closeout-evidence-artifact'), 'closeout was bound');
  assert.ok(names.includes('missing-distinct-review-artifact'),
    `unbound plan-review must NOT clear the review deficit; got ${JSON.stringify(res.deficits)}`);
});

check('C2: gate stays fail-open (status 0) even if the edit log is corrupt', () => {
  const sb = makeSandbox({ tier: 'scaffold', model: 'claude-sonnet-4' });
  markAuthored(sb);
  writeBoundEvidence(sb, '_dev/reports/debriefs', 'my-debrief.md');
  // Corrupt the edit log AFTER binding — loadBindingAnchors must swallow it.
  fs.writeFileSync(path.join(sb.root, '_dev/state/delegation-altitude', `${sb.sessionId}.json`), '{corrupt');
  const res = runCloseout(sb);
  // Corrupt edit log => edit-log strategy yields nothing, but the gate must not
  // throw; sessionAuthored also reads this file, so a corrupt log => no-authoring.
  assert.ok(res.status === 0, `must not throw/trap; got ${JSON.stringify(res)}`);
});

console.log(`\nstop-closeout-evidence-gate + delegation-altitude-cap: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
