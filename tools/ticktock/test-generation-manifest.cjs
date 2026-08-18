#!/usr/bin/env node
'use strict';

// tools/ticktock/test-generation-manifest.cjs -- fixture tests for the
// GenerationManifest/1.0 writer and for the /ticktock preflight precondition.
//
// The writer's whole claim is "write, then prove the write through an independent
// read-back", so the tests have to attack exactly that: a tampered hash, an
// invalid document, and a file mutated after the write must each be caught.
// The preflight's whole claim is "fail closed on anything that is not strictly
// true", so its tests enumerate the argument forms and the missing-artifact case.
//
// Runs against a temp directory. Writes nothing into the repo's state surface.

const fs = require('fs');
const os = require('os');
const path = require('path');

const gm = require('./generation-manifest.cjs');
const pf = require('./preflight-ticktock.cjs');
const charterMod = require('./charter.cjs');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failed += 1;
    process.stdout.write(`  FAIL ${name}: ${err.message}\n`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function expectThrow(fn, fragment) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert(threw, `expected a throw containing ${fragment}`);
  assert(String(threw.message).includes(fragment), `expected ${fragment}, got: ${threw.message}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-manifest-'));
const tmpDir = path.relative(path.resolve(__dirname, '..', '..'), tmpRoot);

function fixture(overrides) {
  return Object.assign({
    schema: 'GenerationManifest/1.0',
    generation_id: 'tt-gen-0-fixture',
    cycle_index: 0,
    created_at: '2026-08-05T00:00:00.000Z',
    charter_id: 'fixture',
    charter_hash: 'a'.repeat(64),
    parent: { parent_generation_id: null, parent_manifest_hash: null },
    inputs: {
      benchmark_fingerprint_hash: 'b'.repeat(64),
      benchmark_identical: true,
      journal_head_record_hash: null,
      artifact_hashes: []
    },
    outputs: [],
    reviews: [],
    merge_decision: { clean: false, reasons: ['fixture'], decided_at: '2026-08-05T00:00:00.000Z' },
    metrics: {},
    rotation: { rotated_lane_id: 'fixture-lane-a', was_untested: true, recorded_in_matrix: true, prior_lane_ids: [] }
  }, overrides || {});
}

process.stdout.write('generation-manifest writer\n');

check('writes, validates, and verifies read-back', () => {
  const receipt = gm.writeGenerationManifest(fixture(), { dir: tmpDir });
  assert(receipt.read_back_verified === true, 'read_back_verified must be true');
  assert(/^[0-9a-f]{64}$/.test(receipt.manifest_hash), 'manifest_hash must be a sha256 hex');
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, 'tt-gen-0-fixture.json'), 'utf8'));
  assert(onDisk.manifest_hash === receipt.manifest_hash, 'stored hash must match the receipt');
});

check('recomputes rather than trusts a supplied manifest_hash', () => {
  expectThrow(
    () => gm.writeGenerationManifest(fixture({ generation_id: 'tt-gen-1-fixture', manifest_hash: 'c'.repeat(64) }), { dir: tmpDir }),
    'MANIFEST-HASH-MISMATCH'
  );
});

check('refuses a schema-invalid document before touching disk', () => {
  const bad = fixture({ generation_id: 'tt-gen-2-fixture', cycle_index: -1 });
  expectThrow(() => gm.writeGenerationManifest(bad, { dir: tmpDir }), 'MANIFEST-SCHEMA-INVALID (pre-write)');
  assert(!fs.existsSync(path.join(tmpRoot, 'tt-gen-2-fixture.json')), 'no file may exist after a pre-write refusal');
});

check('refuses a wrong schema id', () => {
  expectThrow(
    () => gm.writeGenerationManifest(fixture({ schema: 'GenerationManifest/2.0' }), { dir: tmpDir }),
    'MANIFEST-WRITE-REFUSED'
  );
});

check('read-back detects post-write tampering', () => {
  const target = path.join(tmpRoot, 'tt-gen-0-fixture.json');
  const doc = JSON.parse(fs.readFileSync(target, 'utf8'));
  doc.cycle_index = 7;
  fs.writeFileSync(target, JSON.stringify(doc, null, 2));
  const result = gm.readGenerationManifest(path.join(tmpDir, 'tt-gen-0-fixture.json'));
  assert(result.hash_verified === false, 'a mutated manifest must fail hash verification');
});

check('lineage link requires the parent hash', () => {
  // A real parent manifest is always read back from disk after
  // writeGenerationManifest() has injected its manifest_hash field (Codex
  // PR#20 round 2: verifyLineageLink now refuses a parent whose OWN stored
  // manifest_hash does not match its recomputed content hash, to catch a
  // parent silently edited after the fact). Set it here to model that real
  // shape rather than a bare in-memory fixture that was never "written".
  const parent = fixture();
  const parentHash = gm.computeManifestHash(parent);
  parent.manifest_hash = parentHash;
  const childGood = fixture({
    generation_id: 'tt-gen-1-fixture',
    cycle_index: 1,
    parent: { parent_generation_id: 'tt-gen-0-fixture', parent_manifest_hash: parentHash }
  });
  assert(gm.verifyLineageLink(childGood, parent).linked === true, 'a correct link must verify');
  const childBad = fixture({
    generation_id: 'tt-gen-1-fixture',
    cycle_index: 1,
    parent: { parent_generation_id: 'tt-gen-0-fixture', parent_manifest_hash: 'd'.repeat(64) }
  });
  assert(gm.verifyLineageLink(childBad, parent).linked === false, 'a wrong parent hash must not verify');
});

// Codex PR#20 review: writeGenerationManifest() ran schema, rotation, and
// artifact checks but never called verifyLineageLink() -- a non-genesis
// manifest with a null parent was written successfully and received a
// read_back_verified:true receipt even though its lineage could not be
// traversed. These tests exercise the WRITER, not the standalone function.
check('writeGenerationManifest REFUSES a non-genesis manifest with a null parent (LINEAGE-LINK-BROKEN)', () => {
  expectThrow(
    () => gm.writeGenerationManifest(fixture({
      generation_id: 'tt-gen-1-null-parent',
      cycle_index: 1,
      parent: { parent_generation_id: null, parent_manifest_hash: null }
    }), { dir: tmpDir }),
    'LINEAGE-LINK-BROKEN'
  );
  assert(!fs.existsSync(path.join(tmpRoot, 'tt-gen-1-null-parent.json')), 'a refused manifest must not be written to disk');
});
check('writeGenerationManifest REFUSES a non-genesis manifest whose parent_generation_id names a file that does not exist', () => {
  expectThrow(
    () => gm.writeGenerationManifest(fixture({
      generation_id: 'tt-gen-1-missing-parent',
      cycle_index: 1,
      parent: { parent_generation_id: 'tt-gen-0-never-written', parent_manifest_hash: 'c'.repeat(64) }
    }), { dir: tmpDir }),
    'LINEAGE-LINK-BROKEN'
  );
});
check('writeGenerationManifest ACCEPTS a non-genesis manifest whose parent hash correctly links to a real written parent', () => {
  const parentReceipt = gm.writeGenerationManifest(fixture({ generation_id: 'tt-gen-0-real-parent' }), { dir: tmpDir });
  const receipt = gm.writeGenerationManifest(fixture({
    generation_id: 'tt-gen-1-real-child',
    cycle_index: 1,
    parent: { parent_generation_id: 'tt-gen-0-real-parent', parent_manifest_hash: parentReceipt.manifest_hash }
  }), { dir: tmpDir });
  assert(receipt.lineage_link_verified === true, 'the receipt must record lineage verification');
  assert(receipt.read_back_verified === true, JSON.stringify(receipt));
});
check('writeGenerationManifest REFUSES a non-genesis manifest whose parent hash does not match the real parent on disk', () => {
  gm.writeGenerationManifest(fixture({ generation_id: 'tt-gen-0-real-parent-2' }), { dir: tmpDir });
  expectThrow(
    () => gm.writeGenerationManifest(fixture({
      generation_id: 'tt-gen-1-wrong-hash',
      cycle_index: 1,
      parent: { parent_generation_id: 'tt-gen-0-real-parent-2', parent_manifest_hash: 'd'.repeat(64) }
    }), { dir: tmpDir }),
    'LINEAGE-LINK-BROKEN'
  );
});
check('writeGenerationManifest still REFUSES a genesis (cycle_index 0) manifest that declares a non-null parent', () => {
  expectThrow(
    () => gm.writeGenerationManifest(fixture({
      generation_id: 'tt-gen-0-bad-genesis',
      cycle_index: 0,
      parent: { parent_generation_id: 'tt-gen-should-not-exist', parent_manifest_hash: 'e'.repeat(64) }
    }), { dir: tmpDir }),
    'LINEAGE-LINK-BROKEN'
  );
});

check('refuses a generation that skipped rotation (ROTATION-MISSING)', () => {
  const skipped = { rotated_lane_id: null, was_untested: false, recorded_in_matrix: false, prior_lane_ids: [] };
  expectThrow(
    () => gm.writeGenerationManifest(fixture({ generation_id: 'tt-gen-3-fixture', rotation: skipped }), { dir: tmpDir }),
    'ROTATION-MISSING'
  );
  assert(!fs.existsSync(path.join(tmpRoot, 'tt-gen-3-fixture.json')), 'no file may exist after a rotation refusal');
  // each of the three fields is independently sufficient to refuse
  for (const [i, bad] of [
    { rotated_lane_id: null, was_untested: true, recorded_in_matrix: true, prior_lane_ids: [] },
    { rotated_lane_id: 'lane-x', was_untested: false, recorded_in_matrix: true, prior_lane_ids: [] },
    { rotated_lane_id: 'lane-x', was_untested: true, recorded_in_matrix: false, prior_lane_ids: [] }
  ].entries()) {
    expectThrow(
      () => gm.writeGenerationManifest(fixture({ generation_id: `tt-gen-4${i}-fixture`, rotation: bad }), { dir: tmpDir }),
      'ROTATION-MISSING'
    );
  }
});

check('a HALTED generation is exempt from rotation, and says so on the receipt', () => {
  const receipt = gm.writeGenerationManifest(fixture({
    generation_id: 'tt-gen-5-fixture',
    rotation: { rotated_lane_id: null, was_untested: false, recorded_in_matrix: false, prior_lane_ids: [] },
    halt: { halt_state: 'BENCHMARK-DIVERGENCE', detail: 'halted before rotation could run' }
  }), { dir: tmpDir });
  assert(receipt.rotation_exempt === true, 'a halted generation must be recorded as rotation-exempt');
  assert(/halted/.test(receipt.rotation_exempt_reason || ''), 'the exemption must name its reason');
});

// ---------------------------------------------------------------------------
// B4 (F5 repair): default-on output-artifact verification.
// ---------------------------------------------------------------------------
process.stdout.write('generation-manifest artifact verification (B4)\n');

check('default-on: a fabricated attestation (no real file) refuses on the default path', () => {
  const bad = fixture({
    generation_id: 'tt-gen-40-b4-fabricated',
    outputs: [{ path: 'tools/ticktock/__fixtures__/__does-not-exist__.txt', sha256: 'f'.repeat(64), bytes: 10 }]
  });
  expectThrow(() => gm.writeGenerationManifest(bad, { dir: tmpDir }), 'ARTIFACT-VERIFICATION-FAILED');
  assert(!fs.existsSync(path.join(tmpRoot, 'tt-gen-40-b4-fabricated.json')), 'no file may exist after an artifact-verification refusal');
});

check('default-on: a real file whose declared hash does not match refuses', () => {
  const realFile = path.join(tmpRoot, 'b4-real-output.txt');
  fs.writeFileSync(realFile, 'real bytes\n');
  const relOutput = path.relative(path.resolve(__dirname, '..', '..'), realFile);
  const bad = fixture({
    generation_id: 'tt-gen-41-b4-wrong-hash',
    outputs: [{ path: relOutput, sha256: 'e'.repeat(64), bytes: 11 }]
  });
  expectThrow(() => gm.writeGenerationManifest(bad, { dir: tmpDir }), 'ARTIFACT-VERIFICATION-FAILED');
});

check('default-on: a real, correctly hashed file writes and records artifacts_verified true', () => {
  const realFile = path.join(tmpRoot, 'b4-good-output.txt');
  const bytes = Buffer.from('genuine output\n', 'utf8');
  fs.writeFileSync(realFile, bytes);
  const relOutput = path.relative(path.resolve(__dirname, '..', '..'), realFile);
  const sha256 = require('crypto').createHash('sha256').update(bytes).digest('hex');
  const good = fixture({
    generation_id: 'tt-gen-42-b4-good',
    outputs: [{ path: relOutput, sha256, bytes: bytes.length }]
  });
  const receipt = gm.writeGenerationManifest(good, { dir: tmpDir });
  assert(receipt.artifacts_verified === true, 'artifacts_verified must be true on the default (verifying) path');
  assert(receipt.artifacts_verification_skipped === false, 'artifacts_verification_skipped must be false on the default path');
  assert(receipt.artifacts_checked === 1, `expected 1 artifact checked, got ${receipt.artifacts_checked}`);
});

check('opts.skipArtifactVerification bypasses verification and records artifacts_verified false', () => {
  const skipped = fixture({
    generation_id: 'tt-gen-43-b4-skipped',
    outputs: [{ path: 'tools/ticktock/__fixtures__/__still-does-not-exist__.txt', sha256: 'd'.repeat(64), bytes: 3 }]
  });
  const receipt = gm.writeGenerationManifest(skipped, { dir: tmpDir, skipArtifactVerification: true });
  assert(receipt.artifacts_verified === false, 'artifacts_verified must be false when verification was explicitly skipped -- a skip can never masquerade as a pass');
  assert(receipt.artifacts_verification_skipped === true, 'artifacts_verification_skipped must be true');
});

check('existing outputs:[] fixtures (empty array) still write with artifacts_verified true and artifacts_checked 0', () => {
  const receipt = gm.writeGenerationManifest(fixture({ generation_id: 'tt-gen-44-b4-empty-outputs' }), { dir: tmpDir });
  assert(receipt.artifacts_verified === true, 'an empty outputs[] trivially verifies (nothing to check) on the default path');
  assert(receipt.artifacts_checked === 0, `expected 0 artifacts checked for an empty outputs[], got ${receipt.artifacts_checked}`);
});

check('B6 amendment (codex#4): a correct sha256 with NO bytes field refuses by default, not artifacts_verified:true', () => {
  const realFile = path.join(tmpRoot, 'b4-sha-ok-no-bytes.txt');
  const bytes = Buffer.from('genuine output, no declared byte count\n', 'utf8');
  fs.writeFileSync(realFile, bytes);
  const relOutput = path.relative(path.resolve(__dirname, '..', '..'), realFile);
  const sha256 = require('crypto').createHash('sha256').update(bytes).digest('hex');
  const noBytes = fixture({
    generation_id: 'tt-gen-46-b6-sha-ok-no-bytes',
    outputs: [{ path: relOutput, sha256 }] // deliberately no `bytes` field
  });
  expectThrow(() => gm.writeGenerationManifest(noBytes, { dir: tmpDir }), 'ARTIFACT-VERIFICATION-FAILED');
  assert(!fs.existsSync(path.join(tmpRoot, 'tt-gen-46-b6-sha-ok-no-bytes.json')), 'no file may exist after an artifact-verification refusal');

  // Control: the same file, same sha256, WITH the correct bytes field, writes cleanly.
  const withBytes = fixture({
    generation_id: 'tt-gen-47-b6-sha-ok-with-bytes',
    outputs: [{ path: relOutput, sha256, bytes: bytes.length }]
  });
  const receipt = gm.writeGenerationManifest(withBytes, { dir: tmpDir });
  assert(receipt.artifacts_verified === true, 'a correctly declared bytes field must verify and write');
});

check('artifact paths resolve against the repo root, not process.cwd() (convene execution note 2)', () => {
  const originalCwd = process.cwd();
  const realFile = path.join(tmpRoot, 'b4-cwd-output.txt');
  const bytes = Buffer.from('cwd-independent output\n', 'utf8');
  fs.writeFileSync(realFile, bytes);
  const relOutput = path.relative(path.resolve(__dirname, '..', '..'), realFile);
  const sha256 = require('crypto').createHash('sha256').update(bytes).digest('hex');
  try {
    process.chdir(os.tmpdir());
    const good = fixture({
      generation_id: 'tt-gen-45-b4-cwd',
      outputs: [{ path: relOutput, sha256, bytes: bytes.length }]
    });
    const receipt = gm.writeGenerationManifest(good, { dir: tmpDir });
    assert(receipt.artifacts_verified === true, 'verification must succeed regardless of the caller\'s cwd, because paths resolve against the repo root');
  } finally {
    process.chdir(originalCwd);
  }
});

process.stdout.write('preflight-ticktock\n');

const MISSING = { evidencePath: '_dev/state/ticktock/__absent__.json', reviewDecisionPath: '_dev/state/ticktock/__absent__.json' };

check('every remote-capable form refuses while the review decision is absent', () => {
  // Probe-era update (2026-08-11, enforcement-evidence-integrity): pretooluse-live
  // no longer reads stored evidence — it live-probes the registered gate, which
  // passes on this repo. The refusal for a missing decision artifact now comes
  // from G-TICKTOCK-REVIEW (ARTIFACT-ABSENT), and that is the assertion here.
  // Probe behavior itself is covered by test-preflight-live-probe.cjs.
  for (const args of [[], ['deep'], ['quick'], ['3'], ['--until', 'm1']]) {
    const r = pf.preflight(args, MISSING);
    assert(r.verdict === 'REFUSE', `${JSON.stringify(args)} must refuse, got ${r.verdict}`);
    assert(r.refused_by.includes('G-TICKTOCK-REVIEW'), `${JSON.stringify(args)} must cite G-TICKTOCK-REVIEW`);
  }
});

check('attended single cycle is refused too — attendance is not locality', () => {
  const r = pf.preflight([], MISSING);
  assert(r.invocation.attended === true, 'bare /tt is attended');
  assert(r.invocation.remote_capable === true, 'bare /tt resolves tt.tick, so it is remote-capable');
  assert(r.verdict === 'REFUSE', 'an attended remote-capable cycle must still refuse');
});

check('tock-only and --dry-run proceed', () => {
  for (const args of [['tock'], ['--dry-run']]) {
    const r = pf.preflight(args, MISSING);
    assert(r.verdict === 'PROCEED', `${JSON.stringify(args)} must proceed, got ${r.verdict}: ${r.halt_text}`);
  }
});

check('pretooluse-live ignores the retired evidence boolean entirely', () => {
  // Probe-era inversion of the original fixture (which asserted refuse-on-
  // non-true boolean). The stored boolean was the forgeable surface the
  // enforcement-evidence-integrity rewrite removed; the honest assertion now is
  // that NO value written to the old evidence field changes the verdict — the
  // verdict comes from the live probe alone. A hostile `false` (or a hostile
  // `true`) in the artifact must be inert.
  const evidenceFile = path.join(tmpRoot, 'evidence.json');
  const rel = path.join(tmpDir, 'evidence.json');
  const verdicts = new Set();
  for (const value of [false, null, 'true', 1, true]) {
    fs.writeFileSync(evidenceFile, JSON.stringify({ remote_mutation_gate_test: { enforcement_path_observed_live: value } }));
    const g = pf.evaluatePretooluseLive(pf.classifyInvocation([]), { evidencePath: rel });
    verdicts.add(g.verdict);
    assert(g.reason_code !== 'EVIDENCE-BOOLEAN', `${JSON.stringify(value)}: no verdict may cite the retired boolean`);
  }
  assert(verdicts.size === 1, `verdict must be independent of the stored boolean; saw ${[...verdicts].join(',')}`);
});

// Charter-binding fixture (2026-08-12, S4 codex finding 4): evaluateTicktockReview
// now binds every decision to its charter by hash, so review fixtures carry a
// matching charter file passed via opts.charterPath.
// Codex PR#20 review: G-TICKTOCK-REVIEW's charter reads now run
// charterMod.checkImmutability() (recomputes reviewer_roster.lane_binding_hash
// and charter_hash from the ACTUAL loaded content) rather than trusting a
// bare JSON.parse. Every charter fixture below must be internally
// self-consistent for checkImmutability to accept it at all -- the
// "wrongness" these tests exercise is charter-vs-DECISION binding mismatch,
// never charter self-inconsistency (nothing here targets checkImmutability
// itself, so a hand-typed placeholder hash would now be refused before ever
// reaching the logic under test).
function selfConsistentCharter(partial) {
  // Preserve whether reviewer_roster.lanes was explicitly provided (a real
  // empty roster) vs entirely omitted (an ABSENT lanes[] array -- a distinct
  // fail-closed shape preflight-ticktock.cjs's coverage checks specifically
  // test for, ROSTER-COVERAGE-UNRESOLVED vs -MISMATCH). computeLaneBindingHash
  // treats a missing lanes the same as [] for hashing purposes either way, so
  // hashing does not force the field into existence on the output document.
  const inputRoster = partial.reviewer_roster || {};
  const roster = Object.assign({}, inputRoster, { lanes: inputRoster.lanes || [] });
  const lane_binding_hash = charterMod.computeLaneBindingHash(roster);
  const outputRoster = Object.assign({}, inputRoster, { lane_binding_hash });
  const withRoster = Object.assign({}, partial, { reviewer_roster: outputRoster });
  const charter_hash = charterMod.computeCharterHash(withRoster);
  return Object.assign({}, withRoster, { charter_hash });
}

const CHARTER_FIXTURE_FILE = path.join(tmpRoot, 'charter-fixture.json');
const CHARTER_FIXTURE_REL = path.join(tmpDir, 'charter-fixture.json');
const CHARTER_FIXTURE_CONTENT = selfConsistentCharter({
  charter_id: 'fixture',
  // family/model_pin/assignment_order (B3): populated so this fixture also
  // works as the TRIAL charter half of the run-roster-binding tuple
  // comparison, not merely as a lane_id-only coverage fixture.
  reviewer_roster: { lanes: [{ lane_id: 'codex-1', family: 'codex', model_pin: 'x', assignment_order: 0 }] }
});
fs.writeFileSync(CHARTER_FIXTURE_FILE, JSON.stringify(CHARTER_FIXTURE_CONTENT));
const FIXTURE_CHARTER_HASH = CHARTER_FIXTURE_CONTENT.charter_hash;
const FIXTURE_ROSTER_HASH = CHARTER_FIXTURE_CONTENT.reviewer_roster.lane_binding_hash;

check('G-TICKTOCK-REVIEW refuses a cleared flag its roster does not support', () => {
  const file = path.join(tmpRoot, 'review.json');
  const rel = path.join(tmpDir, 'review.json');
  const base = {
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: 'tt-review-20260805T000000Z',
    produced_by_step: 'S4',
    created_at: '2026-08-05T00:00:00.000Z',
    charter_id: 'fixture',
    charter_hash: FIXTURE_CHARTER_HASH,
    roster_hash: FIXTURE_ROSTER_HASH,
    reviewers: [{
      lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
      pin_verified: true, status: 'findings', verdict: 'AMEND_REQUIRED', unresolved_findings: 2,
      review_artifact_path: 'r.md'
    }],
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  };
  fs.writeFileSync(file, JSON.stringify(base));
  const g = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g.verdict === 'REFUSE' && g.reason_code === 'ROSTER-NOT-CLEAN', `expected ROSTER-NOT-CLEAN, got ${g.reason_code}`);

  base.reviewers[0] = Object.assign(base.reviewers[0], { status: 'clean', verdict: 'APPROVE', unresolved_findings: 0 });
  fs.writeFileSync(file, JSON.stringify(base));
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(ok.verdict === 'PROCEED', `expected PROCEED, got ${ok.reason_code}: ${ok.reason}`);
});

check('G-TICKTOCK-REVIEW binds a decision to its charter by hash', () => {
  const file = path.join(tmpRoot, 'review-binding.json');
  const rel = path.join(tmpDir, 'review-binding.json');
  const clean = {
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: 'tt-review-20260805T000000Z',
    produced_by_step: 'S4',
    created_at: '2026-08-05T00:00:00.000Z',
    charter_id: 'fixture',
    charter_hash: FIXTURE_CHARTER_HASH,
    roster_hash: FIXTURE_ROSTER_HASH,
    reviewers: [{
      lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
      pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
      review_artifact_path: 'r.md'
    }],
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  };
  // Arm 1: a fully-clean cleared decision whose charter cannot be resolved refuses.
  fs.writeFileSync(file, JSON.stringify(clean));
  const unresolved = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: path.join(tmpDir, '__no-such-charter__.json') });
  assert(unresolved.verdict === 'REFUSE' && unresolved.reason_code === 'CHARTER-BINDING-UNRESOLVED',
    `unresolvable charter must refuse, got ${unresolved.verdict}/${unresolved.reason_code}`);
  // Arm 2: same decision against a charter with a different charter_hash refuses —
  // this is the "cleared artifact from another charter" laundering shape.
  const wrongCharter = path.join(tmpRoot, 'charter-wrong.json');
  fs.writeFileSync(wrongCharter, JSON.stringify(selfConsistentCharter({ charter_id: 'fixture', reviewer_roster: {} })));
  const mismatch = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: path.join(tmpDir, 'charter-wrong.json') });
  assert(mismatch.verdict === 'REFUSE' && mismatch.reason_code === 'CHARTER-BINDING-MISMATCH',
    `foreign-charter decision must refuse, got ${mismatch.verdict}/${mismatch.reason_code}`);
  // Arm 3: a re-rostered trial (different lane content, hence a naturally
  // different charter_hash AND roster_hash -- checkImmutability now makes the
  // two move together, since roster_hash is nested inside the hashed charter
  // document) may not reuse the old charter's cleared decision.
  const wrongRoster = path.join(tmpRoot, 'charter-wrong-roster.json');
  fs.writeFileSync(wrongRoster, JSON.stringify(selfConsistentCharter({
    charter_id: 'fixture',
    reviewer_roster: { lanes: [{ lane_id: 'codex-1', family: 'codex', model_pin: 'RE-ROSTERED-PIN', assignment_order: 0 }] }
  })));
  const rosterMismatch = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: path.join(tmpDir, 'charter-wrong-roster.json') });
  assert(rosterMismatch.verdict === 'REFUSE' && rosterMismatch.reason_code === 'CHARTER-BINDING-MISMATCH',
    `re-rostered decision must refuse, got ${rosterMismatch.verdict}/${rosterMismatch.reason_code}`);
  // Control: the matching charter clears.
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(ok.verdict === 'PROCEED', `matching charter must clear, got ${ok.reason_code}: ${ok.reason}`);
});

check('G-TICKTOCK-REVIEW requires exact roster coverage and run-charter identity (S4-C findings 1-2)', () => {
  const file = path.join(tmpRoot, 'review-coverage.json');
  const rel = path.join(tmpDir, 'review-coverage.json');
  const cleanReviewer = (laneId) => ({
    lane_id: laneId, family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
    pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
    review_artifact_path: 'r.md'
  });
  const doc = (reviewers, hashes) => ({
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: 'tt-review-20260805T000000Z',
    produced_by_step: 'S4',
    created_at: '2026-08-05T00:00:00.000Z',
    charter_id: 'fixture',
    charter_hash: (hashes && hashes.charter_hash) || FIXTURE_CHARTER_HASH,
    roster_hash: (hashes && hashes.roster_hash) || FIXTURE_ROSTER_HASH,
    reviewers,
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  });
  // Three-lane charter for the coverage arms. Self-binds with its OWN real
  // hashes (a decision testing roster-coverage against a DIFFERENT charter
  // than the main fixture must claim binding to THAT charter, not the
  // single-lane one, or CHARTER-BINDING-MISMATCH fires first and the
  // roster-coverage logic under test is never reached).
  const threeLaneCharter = path.join(tmpRoot, 'charter-three-lane.json');
  const threeLaneCharterRel = path.join(tmpDir, 'charter-three-lane.json');
  const threeLaneCharterContent = selfConsistentCharter({
    charter_id: 'fixture',
    reviewer_roster: { lanes: [{ lane_id: 'codex-1' }, { lane_id: 'gemini-1' }, { lane_id: 'codewhale-1' }] }
  });
  fs.writeFileSync(threeLaneCharter, JSON.stringify(threeLaneCharterContent));
  const THREE_LANE_HASHES = { charter_hash: threeLaneCharterContent.charter_hash, roster_hash: threeLaneCharterContent.reviewer_roster.lane_binding_hash };
  // Arm 1: ONE clean lane against a THREE-lane roster refuses — the partial-artifact
  // laundering shape S4-C finding 2 proved live.
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1')], THREE_LANE_HASHES)));
  const partial = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: threeLaneCharterRel });
  assert(partial.verdict === 'REFUSE' && partial.reason_code === 'ROSTER-COVERAGE-MISMATCH',
    `one-of-three coverage must refuse, got ${partial.verdict}/${partial.reason_code}`);
  // Arm 2: an extra unlocked lane refuses.
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1'), cleanReviewer('rogue-1')])));
  const padded = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(padded.verdict === 'REFUSE' && padded.reason_code === 'ROSTER-COVERAGE-MISMATCH',
    `padded roster must refuse, got ${padded.verdict}/${padded.reason_code}`);
  // Arm 3: duplicate lane entries refuse at read time (mirror of the write-time guard).
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1'), cleanReviewer('codex-1')])));
  const duped = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(duped.verdict === 'REFUSE' && duped.reason_code === 'ROSTER-COVERAGE-MISMATCH',
    `duplicate lanes must refuse, got ${duped.verdict}/${duped.reason_code}`);
  // Arm 4: a charter with no lanes[] cannot prove coverage — fail-closed.
  // Self-binds with its OWN real hashes, same reason as the three-lane charter above.
  const laneless = path.join(tmpRoot, 'charter-laneless.json');
  const lanelessContent = selfConsistentCharter({ charter_id: 'fixture', reviewer_roster: {} });
  fs.writeFileSync(laneless, JSON.stringify(lanelessContent));
  const LANELESS_HASHES = { charter_hash: lanelessContent.charter_hash, roster_hash: lanelessContent.reviewer_roster.lane_binding_hash };
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1')], LANELESS_HASHES)));
  const unprovable = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: path.join(tmpDir, 'charter-laneless.json') });
  assert(unprovable.verdict === 'REFUSE' && unprovable.reason_code === 'ROSTER-COVERAGE-UNRESOLVED',
    `laneless charter must refuse, got ${unprovable.verdict}/${unprovable.reason_code}`);
  // Arm 5: run-roster binding — a decision whose reviewers differ from the RUN
  // charter's lanes by lane_id+family+model_pin refuses (trial charter and run
  // charter may legitimately differ in identity; the MINDS must match).
  // The trial charter (CHARTER_FIXTURE_FILE) locks codex-1/codex/x at
  // assignment_order 0 -- comparisons below hold two of the three fields fixed
  // and vary one at a time.
  const otherCharter = path.join(tmpRoot, 'charter-other-run.json');
  fs.writeFileSync(otherCharter, JSON.stringify(selfConsistentCharter({
    charter_id: 'other-run',
    reviewer_roster: { lanes: [{ lane_id: 'codex-1', family: 'codex', model_pin: 'DIFFERENT-PIN', assignment_order: 0 }] }
  })));
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1')])));
  const wrongRun = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL, runCharterPath: path.join(tmpDir, 'charter-other-run.json') });
  assert(wrongRun.verdict === 'REFUSE' && wrongRun.reason_code === 'RUN-ROSTER-MISMATCH',
    `pin-different run roster must refuse, got ${wrongRun.verdict}/${wrongRun.reason_code}`);
  // B3 (AC3, delta finding 5): an ASSIGNMENT-ORDER-ONLY difference must ALSO
  // refuse -- two charters with an identical lane_id+family+model_pin SET but
  // different assignment_order are NOT the same roster, because
  // assignment_order is exactly what "pre-output assignment" pins down. The
  // pre-B3 comparison (lane_id+family+model_pin only) would have matched this
  // pair; this is the fixture that fails on pre-B3 code and passes after.
  const reorderedRun = path.join(tmpRoot, 'charter-reordered-run.json');
  fs.writeFileSync(reorderedRun, JSON.stringify(selfConsistentCharter({
    charter_id: 'run-fixture-reordered',
    reviewer_roster: { lanes: [{ lane_id: 'codex-1', family: 'codex', model_pin: 'x', assignment_order: 1 }] }
  })));
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1')])));
  const reordered = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL, runCharterPath: path.join(tmpDir, 'charter-reordered-run.json') });
  assert(reordered.verdict === 'REFUSE' && reordered.reason_code === 'RUN-ROSTER-MISMATCH',
    `assignment_order-only mismatch must refuse, got ${reordered.verdict}/${reordered.reason_code}`);
  // Control: same minds (lane_id+family+model_pin+assignment_order) in the run
  // charter clears even though the run charter's identity differs from the
  // trial's.
  const matchingRun = path.join(tmpRoot, 'charter-matching-run.json');
  fs.writeFileSync(matchingRun, JSON.stringify(selfConsistentCharter({
    charter_id: 'run-fixture',
    reviewer_roster: { lanes: [{ lane_id: 'codex-1', family: 'codex', model_pin: 'x', assignment_order: 0 }] }
  })));
  fs.writeFileSync(file, JSON.stringify(doc([cleanReviewer('codex-1')])));
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL, runCharterPath: path.join(tmpDir, 'charter-matching-run.json') });
  assert(ok.verdict === 'PROCEED', `same-minds run roster must clear, got ${ok.reason_code}: ${ok.reason}`);
});

check('B6 amendment (codex#2/codewhale#3): a reviewer entry whose family/pin does not match its locked lane is REFUSED, not laundered past lane_id coverage', () => {
  const file = path.join(tmpRoot, 'review-forged-lane.json');
  const rel = path.join(tmpDir, 'review-forged-lane.json');
  const doc = (reviewer) => ({
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: 'tt-review-20260805T000000Z',
    produced_by_step: 'S4',
    created_at: '2026-08-05T00:00:00.000Z',
    charter_id: 'fixture',
    charter_hash: FIXTURE_CHARTER_HASH,
    roster_hash: FIXTURE_ROSTER_HASH,
    reviewers: [reviewer],
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  });
  // CHARTER_FIXTURE_FILE locks codex-1 / family "codex" / model_pin "x". The
  // reproduced live defect: lane_id matches, coverage passes, but family and
  // pin are forged.
  const forged = {
    lane_id: 'codex-1', family: 'gemini', model_pin_requested: 'forged-pin', model_pin_observed: 'forged-pin',
    pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
    review_artifact_path: 'r.md'
  };
  fs.writeFileSync(file, JSON.stringify(doc(forged)));
  const g = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g.verdict === 'REFUSE' && g.reason_code === 'REVIEWER-LANE-MISMATCH',
    `forged family+pin must refuse REVIEWER-LANE-MISMATCH, got ${g.verdict}/${g.reason_code}: ${g.reason}`);

  // Isolated arm: family forged alone (pin correct) still refuses.
  const forgedFamilyOnly = Object.assign({}, forged, { family: 'gemini', model_pin_requested: 'x', model_pin_observed: 'x' });
  fs.writeFileSync(file, JSON.stringify(doc(forgedFamilyOnly)));
  const g2 = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g2.verdict === 'REFUSE' && g2.reason_code === 'REVIEWER-LANE-MISMATCH',
    `forged family alone must refuse REVIEWER-LANE-MISMATCH, got ${g2.verdict}/${g2.reason_code}`);

  // Isolated arm: model_pin_observed alone drifting from the locked pin (pin
  // requested correct, family correct) still refuses -- this is the
  // pin_mismatch shape codex named explicitly.
  const observedDrift = Object.assign({}, forged, { family: 'codex', model_pin_requested: 'x', model_pin_observed: 'drifted-pin' });
  fs.writeFileSync(file, JSON.stringify(doc(observedDrift)));
  const g3 = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g3.verdict === 'REFUSE' && g3.reason_code === 'REVIEWER-LANE-MISMATCH',
    `drifted model_pin_observed must refuse REVIEWER-LANE-MISMATCH, got ${g3.verdict}/${g3.reason_code}`);

  // Control: a reviewer entry that genuinely matches its locked lane clears.
  const genuine = Object.assign({}, forged, { family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x' });
  fs.writeFileSync(file, JSON.stringify(doc(genuine)));
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(ok.verdict === 'PROCEED', `a genuine family+pin match must clear, got ${ok.reason_code}: ${ok.reason}`);
});

check('B6 round-2 (codex 20260814T0012Z): pin_verified:true with a null observed pin is self-contradictory and REFUSED', () => {
  const file = path.join(tmpRoot, 'review-null-observed.json');
  const rel = path.join(tmpDir, 'review-null-observed.json');
  const doc = (reviewer) => ({
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: 'tt-review-20260805T000000Z',
    produced_by_step: 'S4',
    created_at: '2026-08-05T00:00:00.000Z',
    charter_id: 'fixture',
    charter_hash: FIXTURE_CHARTER_HASH,
    roster_hash: FIXTURE_ROSTER_HASH,
    reviewers: [reviewer],
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  });
  // CHARTER_FIXTURE_FILE locks codex-1 / family "codex" / model_pin "x".
  // Codex's exact reproduced shape: family and model_pin_requested both
  // GENUINELY match the locked lane (so the R2 checks above are silent),
  // model_pin_observed is null (schema-legal), pin_verified is true anyway.
  const nullObservedForged = {
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: null,
    pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
    review_artifact_path: 'r.md'
  };
  fs.writeFileSync(file, JSON.stringify(doc(nullObservedForged)));
  const g = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g.verdict === 'REFUSE' && g.reason_code === 'REVIEWER-LANE-MISMATCH',
    `pin_verified:true with model_pin_observed:null must refuse, got ${g.verdict}/${g.reason_code}: ${g.reason}`);

  // Isolated arm: model_pin_observed absent entirely (undefined, not merely
  // null) with pin_verified:true must ALSO refuse -- but the schema itself
  // (ticktock-review-decision-schema.json) requires the field to be present
  // (string or null, never absent), so an absent field trips
  // DECISION-SCHEMA-INVALID before this function's own checks ever run. Still
  // fail-closed, just at an earlier stage; asserted generically here rather
  // than pinned to REVIEWER-LANE-MISMATCH specifically.
  const undefinedObserved = {
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x',
    pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
    review_artifact_path: 'r.md'
  };
  fs.writeFileSync(file, JSON.stringify(doc(undefinedObserved)));
  const g2 = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g2.verdict === 'REFUSE', `pin_verified:true with model_pin_observed absent must refuse (fail-closed, any reason), got ${g2.verdict}/${g2.reason_code}`);

  // Contrast: pin_verified:false with a null observed pin is UNCHANGED --
  // that shape is already not-clean via the pre-existing pin_verified
  // strict-true check in reviewerNotCleanReasons, and this new rule does not
  // need to (and does not) touch it.
  const honestlyUnverified = {
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: null,
    pin_verified: false, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
    review_artifact_path: 'r.md'
  };
  fs.writeFileSync(file, JSON.stringify(doc(honestlyUnverified)));
  const g3 = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(g3.verdict === 'REFUSE', `pin_verified:false must still refuse (unregressed), got ${g3.verdict}/${g3.reason_code}`);

  // Control: a genuine lane with pin_verified:true AND a correct non-null
  // observed pin still clears -- this rule must not misfire on the honest case.
  const genuine = {
    lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
    pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
    review_artifact_path: 'r.md'
  };
  fs.writeFileSync(file, JSON.stringify(doc(genuine)));
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(ok.verdict === 'PROCEED', `a genuine pin_verified:true + correct observed pin must clear, got ${ok.reason_code}: ${ok.reason}`);
});

check('timeout / substitution / pin_mismatch each independently refuse, even with verdict APPROVE', () => {
  const file = path.join(tmpRoot, 'review-laundered.json');
  const rel = path.join(tmpDir, 'review-laundered.json');
  function doc(reviewerOverrides) {
    return {
      schema: 'TickTockReviewDecision/1.0',
      gate_id: 'G-TICKTOCK-REVIEW',
      decision_id: 'tt-review-20260805T000000Z',
      produced_by_step: 'S4',
      created_at: '2026-08-05T00:00:00.000Z',
      charter_id: 'fixture',
      charter_hash: FIXTURE_CHARTER_HASH,
      roster_hash: FIXTURE_ROSTER_HASH,
      reviewers: [Object.assign({
        lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
        pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
        review_artifact_path: 'r.md'
      }, reviewerOverrides)],
      decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
    };
  }
  // The falsifier arms: the status records the failure, the verdict is laundered
  // to APPROVE with zero findings. Each arm varies ONE thing.
  const arms = {
    timeout: { status: 'timeout' },
    substitution: { status: 'substituted' },
    pin_mismatch: { status: 'pin_mismatch' },
    pin_unverified_alone: { pin_verified: false }
  };
  for (const [name, overrides] of Object.entries(arms)) {
    fs.writeFileSync(file, JSON.stringify(doc(overrides)));
    const g = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
    assert(g.verdict === 'REFUSE' && g.reason_code === 'ROSTER-NOT-CLEAN',
      `${name} with verdict APPROVE must refuse, got ${g.verdict}/${g.reason_code}`);
  }
  // The control: change nothing else and the same document clears.
  fs.writeFileSync(file, JSON.stringify(doc({})));
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: CHARTER_FIXTURE_REL });
  assert(ok.verdict === 'PROCEED', `the clean control must proceed, got ${ok.reason_code}: ${ok.reason}`);
});

check('codex PR#20: a charter roster edited AFTER commit, with the OLD lane_binding_hash left in place, is refused (not silently trusted at read time)', () => {
  // The exact defect: reviewer_roster.lanes is edited (substituting a
  // reviewer) while charter_hash and lane_binding_hash are left as their
  // ORIGINAL (now-stale) values. Before this fix, evaluateTicktockReview read
  // the charter via a bare JSON.parse and never recomputed either hash, so a
  // schema-valid decision self-claiming the ORIGINAL (stale) hashes would
  // clear this gate against the TAMPERED roster.
  const tamperedCharterPath = path.join(tmpRoot, 'charter-tampered-roster.json');
  const tamperedCharterRel = path.join(tmpDir, 'charter-tampered-roster.json');
  const tampered = Object.assign({}, CHARTER_FIXTURE_CONTENT, {
    reviewer_roster: Object.assign({}, CHARTER_FIXTURE_CONTENT.reviewer_roster, {
      // Substitute the locked reviewer for a different one -- the producer
      // being reviewed, in the shape codex's finding names explicitly --
      // while literally copying the OLD lane_binding_hash and charter_hash
      // (this is exactly what "stale hash fields left in place" means).
      lanes: [{ lane_id: 'the-producer-itself', family: 'codex', model_pin: 'x', assignment_order: 0 }]
      // lane_binding_hash intentionally NOT recomputed -- copied verbatim below.
    })
    // charter_hash intentionally NOT recomputed -- copied verbatim below.
  });
  fs.writeFileSync(tamperedCharterPath, JSON.stringify(tampered));

  const file = path.join(tmpRoot, 'review-tampered-roster.json');
  const rel = path.join(tmpDir, 'review-tampered-roster.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'TickTockReviewDecision/1.0',
    gate_id: 'G-TICKTOCK-REVIEW',
    decision_id: 'tt-review-20260817T000000Z',
    produced_by_step: 'S4',
    created_at: '2026-08-17T00:00:00.000Z',
    charter_id: 'fixture',
    // Self-claims the ORIGINAL (stale) hashes -- which is exactly what the
    // tampered charter file still carries too, so a bare-parse self-binding
    // check would have seen them "match".
    charter_hash: FIXTURE_CHARTER_HASH,
    roster_hash: FIXTURE_ROSTER_HASH,
    reviewers: [{
      lane_id: 'the-producer-itself', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
      pin_verified: true, status: 'clean', verdict: 'APPROVE', unresolved_findings: 0,
      review_artifact_path: 'r.md'
    }],
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  }));

  const g = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel, charterPath: tamperedCharterRel });
  assert(g.verdict === 'REFUSE', `a charter whose roster was edited without recomputing its hash must refuse, got ${g.verdict}/${g.reason_code}`);
  assert(g.reason_code === 'CHARTER-BINDING-UNRESOLVED', `expected CHARTER-BINDING-UNRESOLVED (the charter itself fails immutability), got ${g.reason_code}: ${g.reason}`);
});

check('a missing status or missing pin_verified fails closed', () => {
  for (const bad of [{ lane_id: 'l', verdict: 'APPROVE', unresolved_findings: 0, pin_verified: true },
    { lane_id: 'l', verdict: 'APPROVE', unresolved_findings: 0, status: 'clean' }]) {
    const reasons = pf.reviewerNotCleanReasons(bad);
    assert(reasons.length > 0, `expected fail-closed on ${JSON.stringify(bad)}`);
  }
  assert(pf.reviewerNotCleanReasons({ lane_id: 'l', status: 'not-a-real-status', pin_verified: true, verdict: 'APPROVE', unresolved_findings: 0 }).length > 0,
    'an unrecognised status must fail closed');
});

fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
