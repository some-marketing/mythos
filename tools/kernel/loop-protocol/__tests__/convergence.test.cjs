#!/usr/bin/env node
'use strict';

/**
 * convergence.test.cjs — node:test suite for the v3 DRY predicate (fail-safe +
 * every condition) and the assertConverged gate.
 *   node --test tools/kernel/loop-protocol/__tests__/convergence.test.cjs
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const convergence = require('../convergence.js');
const objectionLedger = require('../objection-ledger.js');

function freshInstance(tag) {
  return `__test-conv-${tag}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
function wipe(inst) {
  for (const f of [objectionLedger.ledgerPath(inst), convergence.cyclesPath(inst)]) {
    try { fs.rmSync(f, { force: true }); } catch (_) {}
  }
}

const PRODUCER = { actor: 'claude-coordinator', harness: 'claude-code', model_family: 'claude' };
const APEX = { actor: 'fable', harness: 'claude-code', model_family: 'anthropic-apex' };
const GEMINI = { actor: 'gemini', harness: 'gemini-cli', model_family: 'gemini' };

/** A fully convergence-ready consequence-grade cycle record. */
function readyCycle(overrides) {
  return Object.assign({
    unit_id: 'u1',
    grade_class: 'consequence',
    produced_by: PRODUCER,
    // distinct family (gemini != claude) AND non-complicit apex.
    validated_by: [APEX, GEMINI],
    frozen_baseline_sha: 'abcdef1',
    classifier_id: 'clf-1',
    convergence_threshold: 0.1,
    verdict: 'accept',
    roster_distinct_family: true,
    // v3 (2) signals
    new_material_objections_count: 0,
    new_disconfirming_evidence_count: 0,
    position_delta: 0.05,
    // v3 (3) non-complicity provenance (present + no validator is a co-author)
    claim_authors: [PRODUCER],
    prior_synthesis_participants: [],
    non_complicit: true,
    // v3 (4) probe
    seeded_probe: {
      custody: { authorship: 'out-of-band', selection: 'operator', insertion: 'operator', grading: 'out-of-band' },
      caught: true,
      passed: true,
      probe_ref: 'sample-off-by-one-preservation',
    },
    // v3 (5) anchor
    anchor: {
      passed: true,
      falsifiable: true,
      countersigner: APEX,
      selection_countersigned: true,
      domain_appropriate: true,
    },
    // v3 (6) countersign
    pre_freeze_countersign: {
      classifier: true, threshold: true, evidence_query: true, framing: true,
      dedup: true, anchor_selection: true, countersigner: APEX,
      strongest_objection: 'The classifier may under-weight subtle manifold errors.',
    },
  }, overrides || {});
}

function writeCycles(inst, cycles) {
  fs.mkdirSync(require('node:path').dirname(convergence.cyclesPath(inst)), { recursive: true });
  fs.writeFileSync(convergence.cyclesPath(inst), JSON.stringify({ instance: inst, cycles }, null, 2));
}

test('DRY: clean ledger + M consecutive ready cycles => dry', () => {
  const inst = freshInstance('dry');
  wipe(inst);
  try {
    writeCycles(inst, [readyCycle(), readyCycle()]); // M=2 for consequence
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, true, 'expected dry; reasons: ' + r.reasons.join(' | '));
    assert.strictEqual(r.M, 2);
    // assertConverged does not throw.
    assert.doesNotThrow(() => convergence.assertConverged(inst));
  } finally {
    wipe(inst);
  }
});

test('FAIL-SAFE: no cycles file => NOT dry', () => {
  const inst = freshInstance('nocycles');
  wipe(inst);
  try {
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.ok(r.reasons.some((x) => /fewer than M/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('open objection blocks dry even with ready cycles', () => {
  const inst = freshInstance('open-obj');
  wipe(inst);
  try {
    writeCycles(inst, [readyCycle(), readyCycle()]);
    objectionLedger.raiseObjection(inst, { id: 'C1', raised_by: { actor: 'fable', harness: 'claude-code', family: 'anthropic-apex' } });
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.ok(r.reasons.some((x) => /open-objection ledger NOT empty/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('FAIL-SAFE: missing per-cycle signal => NOT dry', () => {
  const inst = freshInstance('missing-signal');
  wipe(inst);
  try {
    const bad = readyCycle();
    delete bad.position_delta; // absent signal
    writeCycles(inst, [readyCycle(), bad]);
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.ok(r.reasons.some((x) => /position_delta must be a number/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('non-complicit: a validator who is a claim co-author disqualifies the cycle', () => {
  const inst = freshInstance('complicit');
  wipe(inst);
  try {
    // APEX is now listed as a claim co-author AND still a validator -> complicit.
    const bad = readyCycle({ claim_authors: [PRODUCER, APEX] });
    writeCycles(inst, [readyCycle(), bad]);
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.ok(r.reasons.some((x) => /complicit apex/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('non-complicit fail-safe: absent provenance => invalid unless operator downgrade', () => {
  const inst = freshInstance('nc-absent');
  wipe(inst);
  try {
    const noProv = readyCycle();
    delete noProv.claim_authors;
    delete noProv.prior_synthesis_participants;
    delete noProv.non_complicit;
    writeCycles(inst, [readyCycle(), noProv]);
    let r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false, 'absent complicity provenance fail-safes to NOT dry');
    assert.ok(r.reasons.some((x) => /complicity provenance absent/.test(x)));

    // operator downgrade flag restores dryness (everything else is ready).
    const downgraded = readyCycle();
    delete downgraded.claim_authors;
    delete downgraded.prior_synthesis_participants;
    delete downgraded.non_complicit;
    downgraded.operator_complicity_downgrade = true;
    writeCycles(inst, [readyCycle(), downgraded]);
    r = convergence.isDry(inst);
    assert.strictEqual(r.dry, true, 'operator downgrade permits closure; reasons: ' + r.reasons.join(' | '));
  } finally {
    wipe(inst);
  }
});

test('anchor: non-falsifiable anchor => pure-judgment, CONVERGED prohibited', () => {
  const inst = freshInstance('anchor');
  wipe(inst);
  try {
    const bad = readyCycle({ anchor: { passed: true, falsifiable: false, countersigner: APEX, selection_countersigned: true } });
    writeCycles(inst, [readyCycle(), bad]);
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.strictEqual(r.pureJudgment, true);
    assert.ok(r.reasons.some((x) => /not falsifiability-coupled|CONVERGED prohibited/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('probe: coordinator-custody grading disqualifies the cycle', () => {
  const inst = freshInstance('probe');
  wipe(inst);
  try {
    const bad = readyCycle();
    bad.seeded_probe = { custody: { authorship: 'out-of-band', selection: 'operator', insertion: 'operator', grading: 'coordinator' }, caught: true, passed: true };
    writeCycles(inst, [readyCycle(), bad]);
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.ok(r.reasons.some((x) => /custody\.grading must be non-defendant/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('countersign: empty strongest_objection => not content-bearing => NOT dry', () => {
  const inst = freshInstance('countersign');
  wipe(inst);
  try {
    const bad = readyCycle();
    bad.pre_freeze_countersign = Object.assign({}, bad.pre_freeze_countersign, { strongest_objection: '   ' });
    writeCycles(inst, [readyCycle(), bad]);
    const r = convergence.isDry(inst);
    assert.strictEqual(r.dry, false);
    assert.ok(r.reasons.some((x) => /strongest_objection must be a non-empty string/.test(x)));
  } finally {
    wipe(inst);
  }
});

test('assertConverged throws CONVERGENCE_NOT_DRY when not dry', () => {
  const inst = freshInstance('assert');
  wipe(inst);
  try {
    writeCycles(inst, [readyCycle()]); // only 1 cycle, M=2 -> not dry
    assert.throws(() => convergence.assertConverged(inst), (e) => e.code === 'CONVERGENCE_NOT_DRY');
  } finally {
    wipe(inst);
  }
});
