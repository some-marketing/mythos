#!/usr/bin/env node
'use strict';

// tools/ticktock/test-preflight-live-probe.cjs -- S5-REDESIGNED acceptance
// fixtures for the enforcement-evidence-integrity redesign (round 4/4b:
// _dev/reports/analysis/task-plans/enforcement-evidence-integrity__plan.md).
//
// The finding this replaces: preflight-ticktock.cjs used to clear
// pretooluse-live by reading a strict boolean out of an ungoverned JSON file --
// editing the boolean flipped the verdict with nothing re-verified. The fix:
// evaluatePretooluseLive() now re-derives the verdict live, every call, from
// three probe legs against the governance-protected G-REMOTE-MUTATION gate
// module and the .claude/settings.json PreToolUse wiring. Nothing is stored,
// so nothing can be forged by editing a file.
//
// Round 3's rule, carried forward: "a negative fixture that has never been
// observed to fail is not evidence that the thing it guards works." Every
// fixture below is shown capable of BOTH outcomes.

const fs = require('fs');
const path = require('path');

const pf = require('./preflight-ticktock.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  ok   ${name}\n`); }
  catch (err) { failed += 1; process.stdout.write(`  FAIL ${name}: ${err.stack || err.message}\n`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INVOCATION = { unattended: false, remote_capable: true, form: 'bare', phases: ['tt.tick'] };

// ---------------------------------------------------------------------------
// Fixture: the legitimate path, all three legs real, run once for real.
// ---------------------------------------------------------------------------

check('legitimate path: all three legs real -> PROCEED, naming all three denied the canary', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {});
  assert(result.verdict === pf.PROCEED, `expected PROCEED, got ${result.verdict}: ${result.reason}`);
  assert(result.reason_code === 'LIVE-ENFORCEMENT-PROBED', `unexpected reason_code: ${result.reason_code}`);
  assert(result.probe.wiring.ok === true, 'wiring leg must be ok');
  assert(result.probe.direct.ok === true, 'direct-module leg must be ok');
  assert(result.probe.spawn.ok === true, 'spawn leg must be ok');
});

// ---------------------------------------------------------------------------
// Divergent fixtures: each leg run once real (implicitly proven above) and
// once stubbed to fail, with the OTHER two legs held real/short-circuited so
// the assertion isolates exactly one leg's effect. Verdicts must DIFFER.
// ---------------------------------------------------------------------------

check('divergent: wiring stub with no matching PreToolUse entry -> REFUSE naming wiring', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    readSettings: () => ({ ok: true, doc: { hooks: { PreToolUse: [] } } })
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE when wiring cannot be found');
  assert(result.reason_code === 'WIRING-NOT-FOUND', `unexpected reason_code: ${result.reason_code}`);
  assert(result.probe.direct === null, 'direct leg must be short-circuited when wiring fails');
  assert(result.probe.spawn === null, 'spawn leg must be short-circuited when wiring fails');
});

check('divergent: wiring stub with unreadable settings -> REFUSE naming SETTINGS-UNREADABLE', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    readSettings: () => ({ ok: false, error: 'ENOENT (synthetic)' })
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE when settings cannot be read');
  assert(result.reason_code === 'SETTINGS-UNREADABLE', `unexpected reason_code: ${result.reason_code}`);
});

check('near-match: a command that merely MENTIONS the right path but is not an exact `node "<path>"` shape does not satisfy wiring (round-4b F2)', () => {
  const dispatchAbs = require('path').resolve(REPO_ROOT, 'tools/kernel/hooks/dispatch-pretool.cjs');
  const nearMisses = [
    `node "${dispatchAbs}" --extra-flag`,
    `node "${dispatchAbs}" && rm -rf /tmp/whatever`,
    `bash -c 'node "${dispatchAbs}"'`,
    `echo node "${dispatchAbs}"`
  ];
  for (const command of nearMisses) {
    const result = pf.evaluatePretooluseLive(INVOCATION, {
      readSettings: () => ({ ok: true, doc: { hooks: { PreToolUse: [{ hooks: [{ command }] }] } } })
    });
    assert(result.verdict === pf.REFUSE, `near-match command should not satisfy wiring: ${command}`);
    assert(result.reason_code === 'WIRING-NOT-FOUND', `unexpected reason_code for near-match "${command}": ${result.reason_code}`);
  }
});

// A stub gate module that behaves correctly for classifyCommand/scopeCovers
// (so the scope-verification leg, round-4b F3, passes through) but overrides
// evaluate() -- isolating exactly the leg each fixture targets.
function stubGateModuleWithEvaluate(evaluateImpl) {
  return {
    classifyCommand: () => ({ mutating: [{ key: 'stub:mutate', raw: 'stub' }] }),
    scopeCovers: () => false,
    evaluate: evaluateImpl
  };
}

check('divergent: direct-module stub that always allows -> REFUSE naming direct-module, spawn short-circuited', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    requireGateModule: () => stubGateModuleWithEvaluate(() => ({ status: 0, reason: 'stubbed-allow' }))
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE when the direct-module leg does not deny');
  assert(result.reason_code === 'DIRECT-PROBE-NOT-DENIED', `unexpected reason_code: ${result.reason_code}`);
  assert(result.probe.wiring.ok === true, 'wiring leg (real) must still have run and passed');
  assert(result.probe.spawn === null, 'spawn leg must be short-circuited when direct-module fails');
});

check('divergent: direct-module stub that throws -> caught as PROBE-INTERNAL-ERROR, not an uncaught throw', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    requireGateModule: () => stubGateModuleWithEvaluate(() => { throw new Error('synthetic evaluate() failure'); })
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE, not a crash');
  assert(result.reason_code === 'PROBE-INTERNAL-ERROR', `unexpected reason_code: ${result.reason_code}`);
});

const liveProbe = require('./lib/live-probe.cjs');

function withScratchStampsDir(stampFiles, fn) {
  const os = require('os');
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-malformed-stamp-'));
  const stampsDir = path.join(scratchRoot, '_dev', 'state', 'remote-mutation-stamps');
  fs.mkdirSync(stampsDir, { recursive: true });
  for (const [name, content] of Object.entries(stampFiles)) {
    fs.writeFileSync(path.join(stampsDir, name), JSON.stringify(content));
  }
  try {
    return fn(scratchRoot);
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

check('malformed stamp sidecar (missing scope) -> REFUSE naming STAMP-SCOPE-UNPARSEABLE, fail-closed rather than treated as empty scope (round-4b F5)', () => {
  const gateModule = pf.defaultRequireGateModule();
  withScratchStampsDir({ 'no-scope.json': { stamp_id: 'no-scope', voided: false } }, (scratchRoot) => {
    const outcome = liveProbe.verifyStampScopes(scratchRoot, gateModule);
    assert(outcome.ok === false, 'a stamp with no scope array must not be treated as ok');
    assert(outcome.reason_code === 'STAMP-SCOPE-UNPARSEABLE', `unexpected reason_code: ${outcome.reason_code}`);
  });
});

check('malformed stamp sidecar (non-array scope) -> REFUSE naming STAMP-SCOPE-UNPARSEABLE (round-4b F5)', () => {
  const gateModule = pf.defaultRequireGateModule();
  withScratchStampsDir({ 'string-scope.json': { stamp_id: 'string-scope', scope: 'not-an-array' } }, (scratchRoot) => {
    const outcome = liveProbe.verifyStampScopes(scratchRoot, gateModule);
    assert(outcome.ok === false, 'a stamp with a non-array scope must not be treated as ok');
    assert(outcome.reason_code === 'STAMP-SCOPE-UNPARSEABLE', `unexpected reason_code: ${outcome.reason_code}`);
  });
});

check('divergent: scope-verification stub reporting canary-covered -> REFUSE naming CANARY-COVERED-BY-STAMP, spawn short-circuited', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    requireGateModule: () => ({
      classifyCommand: () => ({ mutating: [{ key: 'stub:mutate', raw: 'stub' }] }),
      scopeCovers: () => true, // simulates a stamp that (wrongly) covers the canary
      evaluate: () => ({ status: 2, reason: 'no-covering-stamp' })
    })
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE when scope verification finds a covering stamp');
  assert(result.reason_code === 'CANARY-COVERED-BY-STAMP', `unexpected reason_code: ${result.reason_code}`);
  assert(result.probe.spawn === null, 'spawn leg must be short-circuited when scope verification fails');
});

check('divergent: direct-module require() that throws -> caught as GATE-MODULE-LOAD-FAILED', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    requireGateModule: () => { throw new Error('synthetic require() failure'); }
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE, not a crash');
  assert(result.reason_code === 'GATE-MODULE-LOAD-FAILED', `unexpected reason_code: ${result.reason_code}`);
});

check('divergent: spawn stub that always allows -> REFUSE naming spawn, wiring and direct both real and ok', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    spawnDispatcher: () => ({ status: 0, stdout: '', stderr: '' })
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE when the spawn leg does not deny');
  assert(result.reason_code === 'SPAWN-PROBE-NOT-DENIED', `unexpected reason_code: ${result.reason_code}`);
  assert(result.probe.wiring.ok === true, 'wiring leg (real) must have passed to reach the spawn leg');
  assert(result.probe.direct.ok === true, 'direct-module leg (real) must have passed to reach the spawn leg');
});

check('divergent: spawn stub that errors -> caught as SPAWN-PROBE-FAILED', () => {
  const result = pf.evaluatePretooluseLive(INVOCATION, {
    spawnDispatcher: () => ({ error: new Error('synthetic spawn failure') })
  });
  assert(result.verdict === pf.REFUSE, 'expected REFUSE, not a crash');
  assert(result.reason_code === 'SPAWN-PROBE-FAILED', `unexpected reason_code: ${result.reason_code}`);
});

// ---------------------------------------------------------------------------
// NOT-APPLICABLE fixture: an invocation that cannot reach the remote surface
// short-circuits every probe leg entirely.
// ---------------------------------------------------------------------------

check('not-applicable: an attended, non-remote-capable invocation skips all three legs -> PROCEED', () => {
  const result = pf.evaluatePretooluseLive({ unattended: false, remote_capable: false, form: 'tock', phases: ['tt.tock'] }, {});
  assert(result.verdict === pf.PROCEED, 'expected PROCEED');
  assert(result.reason_code === 'NOT-APPLICABLE', `unexpected reason_code: ${result.reason_code}`);
  assert(result.probe === null, 'no probe should run when the gate does not apply');
});

// ---------------------------------------------------------------------------
// Invariance fixture: THE direct falsifier of the original finding. Tampering
// the old evidence artifact must produce an IDENTICAL verdict, not a
// differing one, because the new function no longer reads that file at all.
//
// Regression-baseline check first: a minimal, deliberately faithful
// reproduction of the OLD (pre-fix) boolean-reading logic is run against the
// same three evidence states, to prove this fixture is capable of catching a
// regression rather than being a tautology that would pass no matter what the
// implementation did.
// ---------------------------------------------------------------------------

function legacyEvaluatePretooluseLive(evidencePath) {
  // Deliberately faithful to the withdrawn design: read
  // remote_mutation_gate_test.enforcement_path_observed_live and trust it
  // verbatim. Reproduced here ONLY as a regression baseline -- this is not
  // live code, and evaluatePretooluseLive() no longer works this way.
  let value;
  try {
    const doc = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    value = doc && doc.remote_mutation_gate_test && doc.remote_mutation_gate_test.enforcement_path_observed_live;
  } catch (_) {
    return 'REFUSE-ARTIFACT-UNREADABLE';
  }
  return value === true ? 'PROCEED' : 'REFUSE-ENFORCEMENT-NOT-LIVE';
}

check('invariance regression baseline: the WITHDRAWN boolean-read logic PROCEEDs only on true and refuses (via two distinguishable, pairwise-DIFFERENT reason strings) on false and absent -- proves the fixture below is a real regression test, not a tautology (round-4b F4: the prior wording overclaimed "three different verdicts" without asserting the false-vs-absent pair)', () => {
  const tmpPath = path.join(REPO_ROOT, '_dev', 'state', 'ticktock', '_test-invariance-baseline-evidence.json');
  try {
    fs.writeFileSync(tmpPath, JSON.stringify({ remote_mutation_gate_test: { enforcement_path_observed_live: true } }));
    const vTrue = legacyEvaluatePretooluseLive(tmpPath);

    fs.writeFileSync(tmpPath, JSON.stringify({ remote_mutation_gate_test: { enforcement_path_observed_live: false } }));
    const vFalse = legacyEvaluatePretooluseLive(tmpPath);

    fs.rmSync(tmpPath, { force: true });
    const vAbsent = legacyEvaluatePretooluseLive(tmpPath);

    assert(vTrue === 'PROCEED', `baseline true-case should PROCEED, got ${vTrue}`);
    assert(vFalse !== vTrue, `baseline false-case must differ from true-case, both were ${vFalse}`);
    assert(vAbsent !== vTrue, `baseline absent-case must differ from true-case, both were ${vAbsent}`);
    assert(vFalse !== vAbsent, `baseline false-case and absent-case must be pairwise distinct reason strings too, both were ${vFalse}`);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
});

check('invariance: the FIXED evaluatePretooluseLive verdict is IDENTICAL whether the evidence boolean is true, false, or the file is absent -- and the real evidence file is restored BYTE-IDENTICAL afterward (round-4b F4)', () => {
  const realEvidenceAbs = path.resolve(REPO_ROOT, pf.EVIDENCE_PATH);
  const backup = fs.existsSync(realEvidenceAbs) ? fs.readFileSync(realEvidenceAbs, 'utf8') : null;
  try {
    const mergeBoolean = (value) => {
      let doc = {};
      try { doc = JSON.parse(fs.readFileSync(realEvidenceAbs, 'utf8')); } catch (_) { doc = {}; }
      doc.remote_mutation_gate_test = { ...(doc.remote_mutation_gate_test || {}), enforcement_path_observed_live: value };
      fs.writeFileSync(realEvidenceAbs, JSON.stringify(doc, null, 2) + '\n');
    };

    mergeBoolean(true);
    const rTrue = pf.evaluatePretooluseLive(INVOCATION, {});

    mergeBoolean(false);
    const rFalse = pf.evaluatePretooluseLive(INVOCATION, {});

    fs.rmSync(realEvidenceAbs, { force: true });
    const rAbsent = pf.evaluatePretooluseLive(INVOCATION, {});

    assert(rTrue.verdict === rFalse.verdict && rFalse.verdict === rAbsent.verdict,
      `verdicts must be identical: true=${rTrue.verdict} false=${rFalse.verdict} absent=${rAbsent.verdict}`);
    assert(rTrue.reason_code === rFalse.reason_code && rFalse.reason_code === rAbsent.reason_code,
      `reason_codes must be identical: true=${rTrue.reason_code} false=${rFalse.reason_code} absent=${rAbsent.reason_code}`);
  } finally {
    if (backup === null) fs.rmSync(realEvidenceAbs, { force: true });
    else fs.writeFileSync(realEvidenceAbs, backup);
  }
  // Restore assertion is OUTSIDE the finally block deliberately: the restore
  // itself must have already happened (finally always runs before this line),
  // and this asserts it was byte-identical, not merely attempted.
  if (backup === null) {
    assert(!fs.existsSync(realEvidenceAbs), 'evidence file did not exist before this fixture and must not exist after it');
  } else {
    const restored = fs.readFileSync(realEvidenceAbs, 'utf8');
    assert(restored === backup, 'evidence file must be restored BYTE-IDENTICAL to its pre-fixture content, not merely present');
  }
});

// ---------------------------------------------------------------------------
// Non-goal fixture (F6): the disclosed, unfixed dependency on G-REMOTE-
// MUTATION's own classifier soundness. This is recorded as an observation,
// never scored against this plan's own pass/fail -- fixing the classifier's
// `timeout N` bypass is a separately tracked, operator-owned defect.
// ---------------------------------------------------------------------------

check('non-goal (F6, not scored): observe, do not assert on, how the live gate module currently classifies a timeout-N-prefixed canary', () => {
  const gateModule = pf.defaultRequireGateModule();
  const timeoutCanary = 'timeout 5 ' + pf.CANARY_COMMAND;
  const result = gateModule.evaluate(timeoutCanary, {
    projectDir: REPO_ROOT,
    fs,
    nowMs: Date.now(),
    sessionId: 'ticktock-preflight-probe-nongoal-observation'
  });
  process.stdout.write(
    `       observed (non-goal, not asserted): timeout-N canary classified as status=${result.status} reason=${result.reason} ` +
    `-- G-REMOTE-MUTATION's own classifier soundness is a named, disclosed, unfixed dependency of this plan, tracked separately.\n`
  );
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
