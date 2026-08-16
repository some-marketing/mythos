#!/usr/bin/env node
'use strict';

// tools/ticktock/test-ratification-proposal.cjs -- executable tests for the
// ratification-path proposal producer (S3-c repair).

const fs = require('fs');
const os = require('os');
const path = require('path');

const rp = require('./ratification-proposal.cjs');

let passed = 0;
let failed = 0;

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function check(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`  ok   ${name}\n`); }
  catch (err) { failed += 1; process.stdout.write(`  FAIL ${name}: ${err.message}\n`); }
}
function expectThrow(fn, fragment) {
  let threw = null;
  try { fn(); } catch (err) { threw = err; }
  assert(threw, `expected a throw containing ${fragment}`);
  assert(String(threw.message).includes(fragment), `expected ${fragment}, got: ${threw.message}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-proposal-'));
const tmpDir = path.relative(path.resolve(__dirname, '..', '..'), tmpRoot);

const CHARTER = {
  charter_id: 'tt-proposal-fixture',
  charter_hash: 'a'.repeat(64),
  allowed_write_surfaces: ['tools/ticktock/**', '_dev/state/ticktock/**']
};

function input(overrides) {
  return Object.assign({
    charter: CHARTER,
    cycle_index: 2,
    target_path: '.claude/skills/ticktock/SKILL.md',
    refusal: {
      halt_state: 'META-FILE-EDIT-REFUSED',
      detail: 'the target sits outside the charter allowed_write_surfaces',
      refused_by: 'charter.allowed_write_surfaces bound'
    },
    proposed_change: {
      summary: 'raise the rotation cadence note to mention harness rotation explicitly',
      fields: [{ field: 'every_cycle_invariants#2', current: 'minds rotate', proposed: 'minds AND harnesses rotate' }],
      diff_preview: '- minds rotate\n+ minds AND harnesses rotate'
    },
    rationale: {
      why: 'the observed cycles rotated minds only',
      expected_benefit: 'harness coverage in the capabilities matrix',
      falsifier: 'three consecutive cycles rotate harnesses and the matrix shows no new capability signal',
      evidence_links: ['_dev/state/ticktock/ticktock-dryrun-evidence.json']
    }
  }, overrides || {});
}

process.stdout.write('ratification proposal producer\n');

check('emits an artifact at the path convention, verified by read-back', () => {
  const receipt = rp.emitRatificationProposal(input(), { dir: tmpDir });
  assert(receipt.read_back_verified === true, 'read_back_verified must be true');
  assert(/^_?.*proposals?\//.test(receipt.path) || receipt.path.includes(tmpDir), 'path must sit under the proposals dir');
  assert(fs.existsSync(path.join(tmpRoot, `${receipt.proposal_id}.json`)), 'the file must exist at <proposal_id>.json');
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpRoot, `${receipt.proposal_id}.json`), 'utf8'));
  assert(onDisk.status === 'PROPOSED', 'status must be PROPOSED');
  assert(onDisk.proposal_hash === receipt.proposal_hash, 'stored hash must match the receipt');
  assert(rp.validateProposal(onDisk).valid === true, 'the artifact on disk must validate against its schema');
});

check('the default path convention is _dev/state/ticktock/proposals/<id>.json', () => {
  assert(rp.DEFAULT_DIR === '_dev/state/ticktock/proposals', `unexpected default dir ${rp.DEFAULT_DIR}`);
  assert(rp.proposalPath('tt-proposal-20260805T060000Z-deadbeef') === '_dev/state/ticktock/proposals/tt-proposal-20260805T060000Z-deadbeef.json',
    'the filename stem must be the proposal id');
});

check('classifies every protected surface the SKILL hard-blocks', () => {
  const cases = {
    '.claude/skills/ticktock/SKILL.md': 'meta_file',
    '.claude/skills/go/SKILL.md': 'meta_file',
    '.claude/skills/meditate/SKILL.md': 'meta_file',
    'instructions/canonical/dispatch-routing-rule.yaml': 'dispatch_routing_rule',
    '_dev/reports/analysis/mind-capabilities-matrix.md': 'capabilities_matrix',
    'tools/ticktock/journal.cjs': 'other'
  };
  for (const [p, kind] of Object.entries(cases)) {
    assert(rp.classifyTarget(p) === kind, `${p} should classify as ${kind}, got ${rp.classifyTarget(p)}`);
  }
});

check('records that a meta-file target is outside the charter write surfaces', () => {
  const doc = rp.buildProposal(input());
  assert(doc.target.inside_allowed_write_surfaces === false, 'a meta-file must be recorded as outside the write surfaces');
  const inside = rp.buildProposal(input({ target_path: 'tools/ticktock/journal.cjs' }));
  assert(inside.target.inside_allowed_write_surfaces === true, 'an in-surface path must be recorded as inside');
});

check('refuses an unnamed target, an unnamed change, or a refusal with no halt state', () => {
  expectThrow(() => rp.buildProposal(input({ target_path: null })), 'PROPOSAL-REFUSED');
  expectThrow(() => rp.buildProposal(input({ proposed_change: { summary: '' } })), 'PROPOSAL-REFUSED');
  expectThrow(() => rp.buildProposal(input({ refusal: { detail: 'x', refused_by: 'y' } })), 'PROPOSAL-REFUSED');
});

check('never silently replaces an existing proposal', () => {
  const first = rp.emitRatificationProposal(input({ created_at: '2026-08-05T07:00:00.000Z' }), { dir: tmpDir });
  expectThrow(
    () => rp.emitRatificationProposal(input({ created_at: '2026-08-05T07:00:00.000Z' }), { dir: tmpDir }),
    'PROPOSAL-ALREADY-EXISTS'
  );
  assert(first.proposal_id.startsWith('tt-proposal-20260805T070000Z-'), `unexpected id ${first.proposal_id}`);
});

check('recomputes rather than trusts a supplied proposal_hash', () => {
  expectThrow(
    () => rp.emitRatificationProposal(input({ created_at: '2026-08-05T08:00:00.000Z', proposal_hash: 'c'.repeat(64) }), { dir: tmpDir }),
    'PROPOSAL-HASH-MISMATCH'
  );
});

check('refuseEditWithProposal makes a bare refusal unreachable', () => {
  const out = rp.refuseEditWithProposal(input({ created_at: '2026-08-05T09:00:00.000Z' }), { dir: tmpDir });
  assert(out.refused === true, 'the edit must be refused');
  assert(out.proposal_artifact_path && fs.existsSync(path.join(path.resolve(__dirname, '..', '..'), out.proposal_artifact_path)),
    'the refusal must have produced a proposal artifact on disk');
  assert(out.proposal_receipt.status === 'PROPOSED', 'the produced proposal must be PROPOSED, never ratified');
});

check('an empty falsifier stays visible rather than being invented', () => {
  const doc = rp.buildProposal(input({ rationale: { why: 'because' } }));
  assert(doc.rationale.falsifier === '', 'a missing falsifier must render as an empty string, not as filler prose');
});

fs.rmSync(tmpRoot, { recursive: true, force: true });

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
