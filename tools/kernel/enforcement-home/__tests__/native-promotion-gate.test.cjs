'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertedVerdict, sha256, validatePromotionGate } = require('../native-promotion-gate.cjs');
const { buildGate } = require('../build-native-promotion-gate.cjs');

function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-promotion-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function artifact(rootDir, rel, value) {
  const target = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(target, bytes);
  return { path: rel, sha256: sha256(bytes) };
}

function validGate(rootDir) {
  const pairedRows = Array.from({ length: 25 }, (_, index) => ({
    schema: 'DebriefCloseSoakEvent/1.0', action_id: `pair-${index + 1}`,
    actual_runtime_session_ids: { claude_hook: `claude-${index + 1}`, native: `native-${index + 1}` },
    native_emit_source: 'pi-fork:AgentSessionRuntime.prepareClose',
    comparison: { ok: true }
  }));
  const paired = artifact(rootDir, 'paired.jsonl', pairedRows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const unpaired = artifact(rootDir, 'unpaired.jsonl', '');
  const spans = artifact(rootDir, 'spans.jsonl', '{}\n');
  const observations = artifact(rootDir, 'observations.jsonl', '{}\n');
  const failures = artifact(rootDir, 'failures.jsonl', '');
  const soak = artifact(rootDir, 'soak.json', {
    schema: 'DebriefCloseSoakReceipt/1.0', soak_schema: 'DebriefCloseSoak/1.0', status: 'complete', ready: true, event_count: 25, elapsed_ms: 86400001,
    unexplained_mismatch_count: 0,
    mismatch_count: 0,
    family_counts: { interactive: 4, replacement: 4, 'print-json': 4, 'sigterm-sighup': 4, 'denied-close': 3, 'allowed-close': 3, 'loss-reconciliation': 3 },
    registry_pre_retirement: { blocking_owner: 'claude_hook' },
    paired_events: { count: 25, evidence: paired, events: pairedRows },
    mismatch_explanations: [],
    unpaired_live_traffic: { count: 0, classification: 'segregated-health-evidence-only', included_in_acceptance_pairs: false, evidence: unpaired },
    telemetry_evidence: { spans, observations, failures }
  });
  const planJson = artifact(rootDir, 'plan.json', { task_id: 'sovereign-core-harness', bounded_plan: { custody: 'exclusive, expiring lease keyed to the actor invocation' } });
  const planMarkdown = artifact(rootDir, 'plan.md', '# Sovereign Core Harness\n');
  const custodyImplementation = artifact(rootDir, 'actor-work-lease.cjs', 'module.exports = {};\n');
  const custodySchema = artifact(rootDir, 'actor-work-lease.schema.json', '{}\n');
  const custodyTests = artifact(rootDir, 'actor-work-lease.test.cjs', 'test();\n');
  const custodyReceipt = artifact(rootDir, 'custody-receipt.json', {
    schema: 'ActorWorkCustodyTestReceipt/1.0', status: 'complete',
    result: { exit_code: 0, fail_count: 0, pass_count: 9 },
    source_bindings: [custodyImplementation, custodySchema, custodyTests]
  });
  const parity = artifact(rootDir, 'parity.md', '# P4-S2 parity accepted\n');
  const gemini = artifact(rootDir, 'gemini.json', { response_text: `APPROVE\nPlan ${planJson.sha256}\nCustody ${custodyReceipt.sha256}\n` });
  const fable = artifact(rootDir, 'fable.md', `APPROVE\nPlan ${planJson.sha256}\nCustody ${custodyReceipt.sha256}\n`);
  const authority = artifact(rootDir, 'authority.json', { last_event: 'post_review_approved', post_review: { decision: 'approved' } });
  const gate = {
    schema: 'NativePromotionGate/1.0',
    protocol: 'debrief_before_closeout',
    generated_at: '2026-07-17T18:00:00.000Z',
    decision: 'approve-native-promotion',
    plan: { json: planJson, markdown: planMarkdown },
    soak_receipt: soak,
    actor_custody: { receipt: custodyReceipt, implementation: custodyImplementation, schema: custodySchema, tests: custodyTests },
    projection_parity: parity,
    reviews: [
      { ...gemini, reviewer_family: 'gemini', producer_family: 'codex', verdict: 'approved' },
      { ...fable, reviewer_family: 'fable', producer_family: 'codex', verdict: 'approved' }
    ],
    operator_authority: { ...authority, status: 'approved' }
  };
  artifact(rootDir, 'gate.json', gate);
  return gate;
}

test('promotion gate requires complete 24-hour diverse soak and hash-bound Gemini/Fable/operator evidence', (t) => {
  const rootDir = root(t);
  validGate(rootDir);
  assert.equal(validatePromotionGate(rootDir, 'gate.json').ok, true);
  const generated = buildGate(rootDir, {
    soak: 'soak.json', gemini: 'gemini.json', fable: 'fable.md', operator: 'authority.json',
    planJson: 'plan.json', planMarkdown: 'plan.md', custodyReceipt: 'custody-receipt.json',
    custodyImplementation: 'actor-work-lease.cjs', custodySchema: 'actor-work-lease.schema.json', custodyTests: 'actor-work-lease.test.cjs',
    projectionParity: 'parity.md', now: '2026-07-17T18:00:00.000Z'
  });
  assert.deepEqual(generated.reviews.map((review) => review.reviewer_family), ['gemini', 'fable']);
});

test('promotion gate rejects immature soak, tampering, missing Fable, and same-family review', (t) => {
  const rootDir = root(t);
  const gate = validGate(rootDir);
  let soak = JSON.parse(fs.readFileSync(path.join(rootDir, 'soak.json')));
  soak.elapsed_ms = 1000;
  fs.writeFileSync(path.join(rootDir, 'soak.json'), JSON.stringify(soak));
  assert.match(validatePromotionGate(rootDir, 'gate.json').errors.join('; '), /sha256 mismatch/);

  validGate(rootDir);
  const gatePath = path.join(rootDir, 'gate.json');
  const missingFable = JSON.parse(fs.readFileSync(gatePath));
  missingFable.reviews = missingFable.reviews.filter((review) => review.reviewer_family !== 'fable');
  fs.writeFileSync(gatePath, JSON.stringify(missingFable));
  assert.match(validatePromotionGate(rootDir, 'gate.json').errors.join('; '), /Fable-family approval is required/);

  artifact(rootDir, 'gate.json', { ...gate, reviews: [{ ...gate.reviews[0], reviewer_family: 'codex' }, gate.reviews[1]] });
  assert.match(validatePromotionGate(rootDir, 'gate.json').errors.join('; '), /reviewer must be producer-distinct/);
});

test('promotion gate rejects symlinked evidence even when the bytes and hash match', (t) => {
  const rootDir = root(t);
  validGate(rootDir);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'native-promotion-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.copyFileSync(path.join(rootDir, 'fable.md'), path.join(outside, 'fable.md'));
  fs.rmSync(path.join(rootDir, 'fable.md'));
  fs.symlinkSync(path.join(outside, 'fable.md'), path.join(rootDir, 'fable.md'));
  assert.match(validatePromotionGate(rootDir, 'gate.json').errors.join('; '), /symbolic link/);
});

test('promotion gate rejects driver-supplied native observations without pi-fork provenance', (t) => {
  const rootDir = root(t);
  validGate(rootDir);
  const pairedPath = path.join(rootDir, 'paired.jsonl');
  const rows = fs.readFileSync(pairedPath, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].native_emit_source = 'paired-workload-driver:native-production-interface';
  const paired = artifact(rootDir, 'paired.jsonl', rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const soakPath = path.join(rootDir, 'soak.json');
  const soak = JSON.parse(fs.readFileSync(soakPath, 'utf8'));
  soak.paired_events.evidence = paired;
  const soakBinding = artifact(rootDir, 'soak.json', soak);
  const gatePath = path.join(rootDir, 'gate.json');
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  gate.soak_receipt = soakBinding;
  artifact(rootDir, 'gate.json', gate);
  assert.match(validatePromotionGate(rootDir, 'gate.json').errors.join('; '), /lacks native production provenance/);
});

test('promotion gate rejects a review that leads with BLOCK even if it later says Verdict: APPROVE', () => {
  assert.equal(assertedVerdict('BLOCK\nFinding remains open.\nVerdict: APPROVE\n'), 'not-approved');
  assert.equal(assertedVerdict(JSON.stringify({ response_text: 'BLOCK\nVerdict: APPROVE\n' })), 'not-approved');
});
