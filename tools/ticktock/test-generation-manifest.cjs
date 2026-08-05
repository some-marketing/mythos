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
    rotation: { rotated_lane_id: null, was_untested: false, recorded_in_matrix: false, prior_lane_ids: [] }
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
  const parent = fixture();
  const parentHash = gm.computeManifestHash(parent);
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

process.stdout.write('preflight-ticktock\n');

const MISSING = { evidencePath: '_dev/state/ticktock/__absent__.json', reviewDecisionPath: '_dev/state/ticktock/__absent__.json' };

check('every remote-capable form refuses while evidence is absent', () => {
  for (const args of [[], ['deep'], ['quick'], ['3'], ['--until', 'm1']]) {
    const r = pf.preflight(args, MISSING);
    assert(r.verdict === 'REFUSE', `${JSON.stringify(args)} must refuse, got ${r.verdict}`);
    assert(r.refused_by.includes('pretooluse-live'), `${JSON.stringify(args)} must cite pretooluse-live`);
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

check('pretooluse-live fails closed on false, null, and non-boolean', () => {
  const evidenceFile = path.join(tmpRoot, 'evidence.json');
  const rel = path.join(tmpDir, 'evidence.json');
  for (const value of [false, null, 'true', 1]) {
    fs.writeFileSync(evidenceFile, JSON.stringify({ remote_mutation_gate_test: { enforcement_path_observed_live: value } }));
    const g = pf.evaluatePretooluseLive(pf.classifyInvocation([]), { evidencePath: rel });
    assert(g.verdict === 'REFUSE', `${JSON.stringify(value)} must refuse`);
  }
  fs.writeFileSync(evidenceFile, JSON.stringify({ remote_mutation_gate_test: { enforcement_path_observed_live: true } }));
  const ok = pf.evaluatePretooluseLive(pf.classifyInvocation([]), { evidencePath: rel });
  assert(ok.verdict === 'PROCEED', 'strict true must clear');
});

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
    charter_hash: 'a'.repeat(64),
    roster_hash: 'b'.repeat(64),
    reviewers: [{
      lane_id: 'codex-1', family: 'codex', model_pin_requested: 'x', model_pin_observed: 'x',
      pin_verified: true, status: 'findings', verdict: 'AMEND_REQUIRED', unresolved_findings: 2,
      review_artifact_path: 'r.md'
    }],
    decision: { cleared: true, unresolved_findings_total: 0, reasons: [], decided_at: 'now', decided_by: 'operator' }
  };
  fs.writeFileSync(file, JSON.stringify(base));
  const g = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel });
  assert(g.verdict === 'REFUSE' && g.reason_code === 'ROSTER-NOT-CLEAN', `expected ROSTER-NOT-CLEAN, got ${g.reason_code}`);

  base.reviewers[0] = Object.assign(base.reviewers[0], { status: 'clean', verdict: 'APPROVE', unresolved_findings: 0 });
  fs.writeFileSync(file, JSON.stringify(base));
  const ok = pf.evaluateTicktockReview(pf.classifyInvocation([]), { reviewDecisionPath: rel });
  assert(ok.verdict === 'PROCEED', `expected PROCEED, got ${ok.reason_code}: ${ok.reason}`);
});

fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
