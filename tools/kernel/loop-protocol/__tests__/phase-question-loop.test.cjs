#!/usr/bin/env node
'use strict';

/**
 * phase-question-loop.test.cjs — node:test acceptance suite for the planning-phase
 * binding of the Loop Convergence Bounding Law v3
 * (tools/kernel/loop-protocol/phase-question-loop.js + its CLI).
 *
 * Proves the v3 planning-phase contract mechanically:
 *   - custody of question closure (only the objecting family or operator closes;
 *     the coordinator/defending side is refused at intake AND at closure);
 *   - the 123|Perplexity|321|Fable leg sequencer runs IN ORDER over >=2 full
 *     cycles and is recommendation-only (zero dispatch authority);
 *   - one full cycle decrements the iteration cap unconditionally; exhaustion while
 *     NOT dry terminates at FAILURE_INCOMPLETE (never success);
 *   - operator-gated questions short-circuit STRAIGHT out of the loop;
 *   - DRY is delegated to the REAL convergence predicate (convergence.isDry) — the
 *     sequencer authors no novel predicate logic.
 *
 * Run: node --test tools/kernel/loop-protocol/__tests__/phase-question-loop.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const qloop = require('../phase-question-loop.js');
const objectionLedger = require('../objection-ledger.js');
const itercap = require('../iteration-cap.js');
const convergence = require('../convergence.js');

const CLI = path.join(__dirname, '..', 'phase-question-loop-cli.cjs');

// ---------------------------------------------------------------------------
// Roster fixtures. Adversary = the objecting family; coordinator = the defending
// side that must never hold or close victory evidence.
const ADV = { actor: 'fable', harness: 'claude-code', family: 'anthropic-apex' };
const GEMINI = { actor: 'gemini', harness: 'gemini-cli', family: 'gemini' };
const COORD = { actor: 'claude-coordinator', harness: 'claude-code', family: 'claude' };
const OPERATOR = { actor: 'sam', harness: 'human', family: 'operator', role: 'operator' };

let counter = 0;
function freshScope(tag) {
  counter += 1;
  return {
    plan_id: `pqltest-${tag}-${process.pid}-${Date.now()}-${counter}`,
    phase_id: `ph${counter}`,
  };
}

function wipe(instance) {
  const files = [
    qloop.statePath(instance),
    objectionLedger.ledgerPath(instance),
    itercap.capPath(instance),
    itercap.auditPath(instance),
    convergence.cyclesPath(instance),
  ];
  for (const f of files) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
}

/** A fully convergence-ready consequence-grade cycle record (mirrors convergence.test). */
function readyCycle(overrides) {
  const PRODUCER = { actor: 'claude-coordinator', harness: 'claude-code', model_family: 'claude' };
  const APEX = { actor: 'fable', harness: 'claude-code', model_family: 'anthropic-apex' };
  const G = { actor: 'gemini', harness: 'gemini-cli', model_family: 'gemini' };
  return Object.assign({
    unit_id: 'u1',
    grade_class: 'consequence',
    produced_by: PRODUCER,
    validated_by: [APEX, G],
    frozen_baseline_sha: 'abcdef1',
    classifier_id: 'clf-1',
    convergence_threshold: 0.1,
    verdict: 'accept',
    roster_distinct_family: true,
    new_material_objections_count: 0,
    new_disconfirming_evidence_count: 0,
    position_delta: 0.05,
    claim_authors: [PRODUCER],
    prior_synthesis_participants: [],
    non_complicit: true,
    seeded_probe: {
      custody: { authorship: 'out-of-band', selection: 'operator', insertion: 'operator', grading: 'out-of-band' },
      caught: true, passed: true, probe_ref: 'sample',
    },
    anchor: { passed: true, falsifiable: true, countersigner: APEX, selection_countersigned: true, domain_appropriate: true },
    pre_freeze_countersign: {
      classifier: true, threshold: true, evidence_query: true, framing: true,
      dedup: true, anchor_selection: true, countersigner: APEX,
      strongest_objection: 'The classifier may under-weight subtle manifold errors.',
    },
  }, overrides || {});
}

function writeCycles(instance, cycles) {
  fs.mkdirSync(path.dirname(convergence.cyclesPath(instance)), { recursive: true });
  fs.writeFileSync(convergence.cyclesPath(instance), JSON.stringify({ instance, cycles }, null, 2));
}

/** Drive one full 8-leg cycle through nextLeg/recordLeg, asserting order + authority. */
function driveFullCycle(instance, assertOrder) {
  const minds = [];
  for (let i = 0; i < qloop.LEGS_PER_CYCLE; i += 1) {
    const rec = qloop.nextLeg(instance);
    assert.strictEqual(rec.done, false, 'expected a leg recommendation, got terminal');
    assert.match(rec.authority, /none/, 'leg recommendation must carry ZERO dispatch authority');
    minds.push(rec.mind);
    // Record with the recommended mind (mechanical in-order discipline).
    const done = qloop.recordLeg(instance, { mind: rec.mind });
    if (i < qloop.LEGS_PER_CYCLE - 1) {
      assert.strictEqual(done.cycle_complete, false);
    } else {
      assert.strictEqual(done.cycle_complete, true, 'the 8th leg completes the cycle');
    }
  }
  if (assertOrder) {
    assert.deepStrictEqual(
      minds,
      ['claude', 'codex', 'gemini', 'perplexity', 'gemini', 'codex', 'claude', 'fable-5'],
      'legs must sequence 123|Perplexity|321|Fable'
    );
  }
  return minds;
}

// ===========================================================================
// 1. CUSTODY OF QUESTION CLOSURE
// ===========================================================================
test('custody: coordinator cannot raise (defendant) and cannot close; objecting family / operator can', () => {
  const scope = freshScope('custody');
  const { instance } = qloop.init(scope);
  wipe(instance);
  // A question-accepting loop must declare its defending family (new contract).
  qloop.init({ ...scope, defending_family: 'claude' });
  try {
    // Intake custody: a coordinator/defendant-family question is refused into the loop.
    assert.throws(
      () => qloop.addQuestion(instance, { id: 'Q0', raised_by: COORD }),
      /NON-DEFENDANT custody/,
      'defendant-family question must be refused at intake'
    );

    // Adversary raises a real open question -> enters the objection ledger, blocks DRY.
    const raised = qloop.addQuestion(instance, { id: 'Q1', raised_by: ADV, summary: 'unproven anchor' });
    assert.strictEqual(raised.routed, 'loop');
    assert.strictEqual(objectionLedger.isLedgerClearForDry(instance), false);

    // Closure custody: the coordinator (defending side) cannot close it.
    assert.throws(
      () => qloop.closeQuestion(instance, 'Q1', { closed_by: COORD, close_signature: 'sig' }),
      /closure of "Q1" refused/,
      'coordinator cannot close an objection it did not raise'
    );
    assert.strictEqual(objectionLedger.isLedgerClearForDry(instance), false, 'still blocked after refused close');

    // The objecting family closes it.
    qloop.closeQuestion(instance, 'Q1', { closed_by: ADV, close_signature: 'adv-resolved' });
    assert.strictEqual(objectionLedger.isLedgerClearForDry(instance), true, 'objecting-family close clears it');
  } finally {
    wipe(instance);
  }
});

// ---------------------------------------------------------------------------
// 1b. ADVERSARIAL CUSTODY SMUGGLES (codex distinct review, 20260709T193156Z).
// The quantified classifier must REFUSE intake for each smuggle BEFORE any ledger
// entry exists — an enumerated deny-list let all three through to self-close.
// ---------------------------------------------------------------------------

/** Assert addQuestion refuses AND no objection was ever written to the ledger. */
function assertRefusedBeforeLedger(instance, question, rx) {
  assert.throws(() => qloop.addQuestion(instance, question), rx);
  assert.strictEqual(objectionLedger.read(instance).length, 0, 'intake must be refused BEFORE any ledger entry exists');
  assert.strictEqual(objectionLedger.isLedgerClearForDry(instance), true, 'no smuggled objection may sit in the ledger');
}

test('smuggle (1): alias-spaced coordinator actor "claude coordinator" is refused at intake', () => {
  const scope = freshScope('smuggle-alias');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init(scope);
  try {
    assertRefusedBeforeLedger(
      instance,
      { id: 'S1', raised_by: { actor: 'claude coordinator', harness: 'claude-code', family: 'anthropic-apex' } },
      /coordinator authority/,
    );
  } finally {
    wipe(instance);
  }
});

test('smuggle (2): Claude-family relabel (non-coordinator actor, defending family) is refused', () => {
  const scope = freshScope('smuggle-family');
  const { instance } = qloop.init(scope);
  wipe(instance);
  // The loop DECLARES its defending family; a same-family relabel must be refused
  // even with an innocuous, coordinator-token-free actor.
  qloop.init({ ...scope, defending_family: 'claude' });
  try {
    assertRefusedBeforeLedger(
      instance,
      { id: 'S2', raised_by: { actor: 'helpful-reviewer', harness: 'claude-code', family: 'Claude' } },
      /defending family/,
    );
  } finally {
    wipe(instance);
  }
});

test('smuggle (3): role string carrying coordinator authority is refused', () => {
  const scope = freshScope('smuggle-role');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init(scope);
  try {
    assertRefusedBeforeLedger(
      instance,
      { id: 'S3', raised_by: { actor: 'gemini', harness: 'gemini-cli', family: 'gemini', role: 'lead coordinator' } },
      /coordinator authority/,
    );
  } finally {
    wipe(instance);
  }
});

test('fail-closed: unprovable custody (missing identity field) is refused at intake', () => {
  const scope = freshScope('failclosed');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init(scope);
  try {
    // Missing actor -> non-defendant custody cannot be proven -> refuse (never admit).
    assertRefusedBeforeLedger(
      instance,
      { id: 'FC1', raised_by: { harness: 'x', family: 'gemini' } },
      /unprovable|fail-closed/,
    );
  } finally {
    wipe(instance);
  }
});

// ---------------------------------------------------------------------------
// 1c. CUSTODY PASS 2 (codex rereview, 20260709T194019Z). Three more smuggles the
// pass-1 fold admitted: a separator-broken token, a Unicode confusable, and a
// same-family relabel on a loop with NO declared defending family.
// ---------------------------------------------------------------------------
test('smuggle (4): separator-broken role "lead co-ordinator" is refused (stripped-token match)', () => {
  const scope = freshScope('smuggle-hyphen');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, defending_family: 'claude' });
  try {
    assertRefusedBeforeLedger(
      instance,
      { id: 'S4', raised_by: { actor: 'gemini', harness: 'gemini-cli', family: 'gemini', role: 'lead co-ordinator' } },
      /coordinator authority/,
    );
  } finally {
    wipe(instance);
  }
});

test('smuggle (5): Unicode-confusable actor "claude coordinаtor" (Cyrillic а) is refused', () => {
  const scope = freshScope('smuggle-confusable');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, defending_family: 'claude' });
  try {
    // The 4th char of "coordinаtor" here is U+0430 CYRILLIC SMALL LETTER A.
    const confusable = 'claude coordinаtor';
    assert.ok(/[^\x00-\x7F]/.test(confusable), 'test string must actually carry a non-ASCII code point');
    assertRefusedBeforeLedger(
      instance,
      { id: 'S5', raised_by: { actor: confusable, harness: 'claude-code', family: 'anthropic-apex' } },
      /non-ASCII/,
    );
  } finally {
    wipe(instance);
  }
});

test('smuggle (6): same-family relabel on a loop with NO declared defending_family is refused (fail-closed)', () => {
  const scope = freshScope('smuggle-nodeclare');
  const { instance } = qloop.init(scope);
  wipe(instance);
  // Deliberately NO defending_family — absence must be terminal, not a reduced mode.
  qloop.init(scope);
  try {
    assertRefusedBeforeLedger(
      instance,
      { id: 'S6', raised_by: { actor: 'helpful-reviewer', harness: 'claude-code', family: 'claude' } },
      /no defending_family|fail-closed/,
    );
  } finally {
    wipe(instance);
  }
});

// ---------------------------------------------------------------------------
// 1d. CUSTODY PASS 3 (codex pass 3, 20260709T195313Z). Symmetric invariants: a
// confusable defending_family declared at INIT would disarm requirement (b) from
// the opposite direction (its stripped token would no longer match a real "claude"
// claimant). The anchor side now carries the same ASCII/stripped-token invariants
// as the claimant side, validated BEFORE any state/cap artifact is created.
// ---------------------------------------------------------------------------
test('pass-3 (lib): a confusable defending_family "clаude" (Cyrillic а) is refused at init, admitting nothing', () => {
  const scope = freshScope('pass3-lib');
  const instance = qloop.deriveInstance(scope.plan_id, scope.phase_id);
  wipe(instance);
  try {
    const confusable = 'clаude'; // 3rd char is U+0430 CYRILLIC SMALL LETTER A
    assert.ok(/[^\x00-\x7F]/.test(confusable), 'test anchor must actually carry a non-ASCII code point');

    assert.throws(() => qloop.init({ ...scope, defending_family: confusable }), /non-ASCII/);

    // Fail-closed BEFORE any artifact: no qloop state and no iteration-cap file.
    assert.strictEqual(qloop.exists(instance), false, 'no loop state may be written on a rejected init');
    assert.strictEqual(fs.existsSync(itercap.capPath(instance)), false, 'no cap artifact on a rejected init');

    // With no loop established, a "claude" claimant can never be admitted via it.
    assert.throws(
      () => qloop.addQuestion(instance, { id: 'P3', raised_by: { actor: 'x', harness: 'h', family: 'claude' } }),
      /no loop initialized/,
    );
  } finally {
    wipe(instance);
  }
});

test('pass-3 (lib): a no-token defending_family (separators only) is refused at init', () => {
  const scope = freshScope('pass3-notoken');
  const instance = qloop.deriveInstance(scope.plan_id, scope.phase_id);
  wipe(instance);
  try {
    assert.throws(() => qloop.init({ ...scope, defending_family: '---' }), /no comparable token/);
    assert.strictEqual(qloop.exists(instance), false);
  } finally {
    wipe(instance);
  }
});

// ===========================================================================
// 2. LEG SEQUENCING OVER >=2 FULL CYCLES + unconditional cap decrement
// ===========================================================================
test('leg sequencing: two full cycles run in order; cap decrements once per full cycle', () => {
  const scope = freshScope('seq');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, cap: 3 });
  try {
    assert.strictEqual(itercap.remaining(instance), 3);

    driveFullCycle(instance, true);
    assert.strictEqual(itercap.remaining(instance), 2, 'one full cycle consumes exactly one cap unit');

    driveFullCycle(instance, true);
    assert.strictEqual(itercap.remaining(instance), 1, 'second full cycle consumes one more');

    const state = qloop.load(instance);
    assert.strictEqual(state.completed_cycles, 2);
    assert.strictEqual(state.cycle, 3, 'cycle counter advanced to the third');
    assert.strictEqual(state.legs.length, 16, '2 cycles * 8 legs recorded');
  } finally {
    wipe(instance);
  }
});

test('defect-probe: out-of-sequence leg (wrong mind) is rejected', () => {
  const scope = freshScope('order');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init(scope);
  try {
    // Leg 1 expects mind "claude"; recording "codex" must throw.
    assert.throws(
      () => qloop.recordLeg(instance, { mind: 'codex' }),
      /out-of-sequence leg/,
      'a mind mismatch against the expected next leg is rejected'
    );
  } finally {
    wipe(instance);
  }
});

// ===========================================================================
// 3. CAP EXHAUSTION -> FAILURE_INCOMPLETE (never success)
// ===========================================================================
test('cap exhaustion while NOT dry => FAILURE_INCOMPLETE with an open objection', () => {
  const scope = freshScope('exhaust');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, cap: 1, defending_family: 'claude' });
  try {
    // An open objection means the loop can never be dry.
    qloop.addQuestion(instance, { id: 'X1', raised_by: ADV, summary: 'still standing' });

    // Run the single permitted full cycle -> cap hits 0.
    driveFullCycle(instance, false);
    assert.strictEqual(itercap.remaining(instance), 0, 'cap exhausted after 1 cycle at cap=1');

    // The next-leg recommendation at the cycle boundary must STOP, not spend a cycle.
    const rec = qloop.nextLeg(instance);
    assert.strictEqual(rec.done, true, 'terminal loop recommends STOP');
    assert.strictEqual(rec.terminal_state, 'FAILURE_INCOMPLETE');

    const evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.state, 'FAILURE_INCOMPLETE');
    assert.strictEqual(evalr.terminal, true);
    assert.strictEqual(evalr.cap.exhausted, true);
    assert.strictEqual(evalr.operator_route.required, true);
    // Truthful package: the verbatim ledger travels to the operator.
    assert.ok(Array.isArray(evalr.operator_route.verbatim_ledger));
    assert.strictEqual(evalr.operator_route.verbatim_ledger[0].id, 'X1');
  } finally {
    wipe(instance);
  }
});

test('cap cannot be silently reset to keep looping (interruptability backstop)', () => {
  const scope = freshScope('reset');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, cap: 1 });
  try {
    driveFullCycle(instance, false);
    assert.strictEqual(itercap.isExhausted(instance), true);
    // Re-init without an operator token is refused (resettable counter is theater).
    assert.throws(() => itercap.init(instance, 5), /requires an operator-signed token/);
  } finally {
    wipe(instance);
  }
});

// ===========================================================================
// 4. OPERATOR-GATE SHORT-CIRCUIT
// ===========================================================================
test('operator-gated question routes STRAIGHT to the operator and never enters the loop', () => {
  const scope = freshScope('opgate');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init(scope);
  try {
    const res = qloop.addQuestion(instance, {
      id: 'OG1', raised_by: OPERATOR, summary: 'a genuine operator decision', operator_gated: true,
    });
    assert.strictEqual(res.routed, 'operator');
    // It consumes no ledger slot -> does not block DRY.
    assert.strictEqual(objectionLedger.isLedgerClearForDry(instance), true, 'operator-gated does not enter the ledger');
    assert.strictEqual(objectionLedger.read(instance).length, 0);

    // With M ready cycles + a clear ledger the loop is CONVERGED, but the pending
    // operator-gated question still forces an operator route.
    writeCycles(instance, [readyCycle(), readyCycle()]);
    const evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.state, 'CONVERGED', 'reasons: ' + JSON.stringify(evalr.reasons));
    assert.strictEqual(evalr.operator_route.required, true, 'pending operator-gated question forces a route');
    assert.deepStrictEqual(evalr.operator_route.operator_gated_pending, ['OG1']);

    // Only the operator may resolve it.
    assert.throws(
      () => qloop.resolveOperatorGatedQuestion(instance, 'OG1', { resolved_by: ADV }),
      /ONLY by the operator/,
    );
    const resolved = qloop.resolveOperatorGatedQuestion(instance, 'OG1', { resolved_by: OPERATOR });
    assert.strictEqual(resolved.status, 'resolved');
    const evalr2 = qloop.evaluate(instance);
    assert.strictEqual(evalr2.operator_route.required, false, 'no pending operator questions after resolution');
  } finally {
    wipe(instance);
  }
});

// ===========================================================================
// 5. DRY IS DELEGATED TO THE REAL PREDICATE (convergence.isDry)
// ===========================================================================
test('DRY delegates to convergence.isDry: CONVERGED only when the real predicate is dry', () => {
  const scope = freshScope('dry');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init(scope);
  try {
    // No cycles file -> not dry -> IN_PROGRESS.
    let evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.state, 'IN_PROGRESS');
    assert.strictEqual(evalr.dry, false);

    // M ready consequence cycles -> the real predicate is dry -> CONVERGED.
    writeCycles(instance, [readyCycle(), readyCycle()]);
    evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.state, 'CONVERGED', 'reasons: ' + JSON.stringify(evalr.reasons));
    assert.strictEqual(evalr.dry, true);
    // Cross-check: the lib's verdict equals the standalone predicate's verdict.
    assert.strictEqual(evalr.dry, convergence.isDry(instance).dry);

    // Break one signal -> the predicate goes not-dry -> the lib follows it (no novel logic).
    const bad = readyCycle(); delete bad.position_delta;
    writeCycles(instance, [readyCycle(), bad]);
    evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.dry, false);
    assert.strictEqual(evalr.state, 'IN_PROGRESS');
    assert.strictEqual(evalr.dry, convergence.isDry(instance).dry);
  } finally {
    wipe(instance);
  }
});

test('non-falsifiable anchor (pure-judgment) => PROVISIONAL_CONSENSUS, CONVERGED prohibited', () => {
  const scope = freshScope('provisional');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, cap: 3 });
  try {
    // Every cycle is ready EXCEPT the anchor is not falsifiability-coupled.
    const pj = () => readyCycle({ anchor: { passed: true, falsifiable: false, countersigner: ADV, selection_countersigned: true } });
    writeCycles(instance, [pj(), pj()]);
    const evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.state, 'PROVISIONAL_CONSENSUS', 'reasons: ' + JSON.stringify(evalr.reasons));
    assert.strictEqual(evalr.terminal, true);
    assert.strictEqual(evalr.pure_judgment, true);
    assert.strictEqual(evalr.operator_route.required, true);
    assert.ok(Array.isArray(evalr.operator_route.verbatim_ledger), 'verbatim ledger travels to the operator');
  } finally {
    wipe(instance);
  }
});

test('expired objection => UNRESOLVED_OPERATOR_DECISION (loop-terminal, never ledger-clearing)', () => {
  const scope = freshScope('unresolved');
  const { instance } = qloop.init(scope);
  wipe(instance);
  qloop.init({ ...scope, cap: 3, defending_family: 'claude' });
  try {
    qloop.addQuestion(instance, { id: 'U1', raised_by: ADV });
    qloop.expireQuestion(instance, 'U1', { reason: 'cap pressure' });
    // Even with M ready cycles, the expired objection is loop-terminal.
    writeCycles(instance, [readyCycle(), readyCycle()]);
    const evalr = qloop.evaluate(instance);
    assert.strictEqual(evalr.state, 'UNRESOLVED_OPERATOR_DECISION');
    assert.strictEqual(evalr.terminal, true);
    assert.strictEqual(evalr.dry, false, 'expiry never clears the ledger for DRY');
  } finally {
    wipe(instance);
  }
});

// ===========================================================================
// CLI surface (init / add-question / record-leg / status / evaluate, JSON out)
// ===========================================================================
function runCli(args) {
  const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

test('CLI: init -> add-question -> record-leg -> status -> evaluate round-trips as JSON', () => {
  const scope = freshScope('cli');
  let instance;
  try {
    const initRes = runCli(['init', '--plan-id', scope.plan_id, '--phase-id', scope.phase_id, '--cap', '2', '--defending-family', 'claude']);
    assert.strictEqual(initRes.ok, true);
    instance = initRes.instance;
    assert.strictEqual(initRes.cap, 2);

    // add a loop question via the CLI (non-defendant custody).
    const addRes = runCli([
      'add-question', '--instance', instance, '--id', 'CQ1',
      '--actor', ADV.actor, '--harness', ADV.harness, '--family', ADV.family, '--summary', 'cli question',
    ]);
    assert.strictEqual(addRes.result.routed, 'loop');

    // record one leg; status reflects it.
    const recRes = runCli(['record-leg', '--instance', instance, '--mind', 'claude']);
    assert.strictEqual(recRes.result.recorded.mind, 'claude');
    assert.strictEqual(recRes.result.cycle_complete, false);

    const statusRes = runCli(['status', '--instance', instance]);
    assert.strictEqual(statusRes.status.legs_in_current_cycle, 1);
    assert.strictEqual(statusRes.status.open_questions[0].id, 'CQ1');

    // evaluate: open objection + not enough cycles => IN_PROGRESS (truthful, exit 0).
    const evalRes = runCli(['evaluate', '--instance', instance]);
    assert.strictEqual(evalRes.evaluation.state, 'IN_PROGRESS');
  } finally {
    if (instance) wipe(instance);
  }
});

test('CLI: a defendant-custody question is refused (exit non-zero, JSON error)', () => {
  const scope = freshScope('cli-refuse');
  const initRes = runCli(['init', '--plan-id', scope.plan_id, '--phase-id', scope.phase_id, '--defending-family', 'claude']);
  const instance = initRes.instance;
  try {
    let threw = false;
    try {
      execFileSync('node', [
        CLI, 'add-question', '--instance', instance, '--id', 'BAD',
        '--actor', COORD.actor, '--harness', COORD.harness, '--family', COORD.family,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      threw = true;
      assert.match(String(err.stderr), /NON-DEFENDANT custody/);
    }
    assert.strictEqual(threw, true, 'CLI must exit non-zero on a defendant-custody question');
  } finally {
    wipe(instance);
  }
});

// Helper: run the CLI expecting a NON-zero exit; return captured stderr.
function runCliExpectFail(args) {
  try {
    execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return String(err.stderr || '');
  }
  return null; // did NOT fail
}

test('CLI --defending-family: declares a question-accepting loop; fail-closed without it', () => {
  // (1) init WITH --defending-family -> a loop question succeeds.
  const s1 = freshScope('cli-df-yes');
  const r1 = runCli(['init', '--plan-id', s1.plan_id, '--phase-id', s1.phase_id, '--defending-family', 'claude']);
  const inst1 = r1.instance;
  try {
    const add1 = runCli(['add-question', '--instance', inst1, '--id', 'A1', '--actor', ADV.actor, '--harness', ADV.harness, '--family', ADV.family]);
    assert.strictEqual(add1.result.routed, 'loop', 'a declared loop accepts a non-defendant loop question');
  } finally {
    wipe(inst1);
  }

  // (2) init WITHOUT the flag using --operator-gated-only -> operator-gated works,
  //     but a LOOP question is refused fail-closed (the documented bypass contract).
  const s2 = freshScope('cli-df-og');
  const r2 = runCli(['init', '--plan-id', s2.plan_id, '--phase-id', s2.phase_id, '--operator-gated-only']);
  const inst2 = r2.instance;
  try {
    const og = runCli(['add-question', '--instance', inst2, '--id', 'OG', '--actor', OPERATOR.actor, '--harness', OPERATOR.harness, '--family', OPERATOR.family, '--role', 'operator', '--operator-gated']);
    assert.strictEqual(og.result.routed, 'operator', 'operator-gated questions still route out');

    const stderr = runCliExpectFail(['add-question', '--instance', inst2, '--id', 'A2', '--actor', ADV.actor, '--harness', ADV.harness, '--family', ADV.family]);
    assert.ok(stderr !== null, 'a loop question on an operator-gated-only loop must exit non-zero');
    assert.match(stderr, /no defending_family|NON-DEFENDANT custody/);
  } finally {
    wipe(inst2);
  }

  // (3) bare init (neither flag) -> fail-closed JSON error at the init boundary.
  const s3 = freshScope('cli-df-bare');
  const bareErr = runCliExpectFail(['init', '--plan-id', s3.plan_id, '--phase-id', s3.phase_id]);
  assert.ok(bareErr !== null, 'bare init must fail-closed (exit non-zero)');
  assert.match(bareErr, /requires --defending-family/);
});

test('pass-3 (CLI): init --defending-family "clаude" (Cyrillic а) fails before any ledger entry', () => {
  const scope = freshScope('pass3-cli');
  const instance = qloop.deriveInstance(scope.plan_id, scope.phase_id);
  wipe(instance);
  try {
    const stderr = runCliExpectFail(['init', '--plan-id', scope.plan_id, '--phase-id', scope.phase_id, '--defending-family', 'clаude']);
    assert.ok(stderr !== null, 'CLI init with a confusable defending family must exit non-zero');
    assert.match(stderr, /non-ASCII/);
    assert.strictEqual(qloop.exists(instance), false, 'no loop state written on a rejected CLI init');
    assert.strictEqual(objectionLedger.read(instance).length, 0, 'no ledger entry created');
  } finally {
    wipe(instance);
  }
});
