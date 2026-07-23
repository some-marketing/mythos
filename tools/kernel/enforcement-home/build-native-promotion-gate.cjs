#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GATE_SCHEMA, assertedVerdict, resolveArtifact, sha256, validatePromotionGate } = require('./native-promotion-gate.cjs');

function value(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function binding(root, rel) {
  const target = resolveArtifact(root, rel, 'promotion evidence');
  const bytes = fs.readFileSync(target);
  return { path: rel.replace(/\\/g, '/'), sha256: sha256(bytes), text: bytes.toString('utf8') };
}

function writeAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
  const dir = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function buildGate(root, opts = {}) {
  const soak = binding(root, opts.soak);
  const gemini = binding(root, opts.gemini);
  const fable = binding(root, opts.fable);
  const operator = binding(root, opts.operator);
  const planJson = binding(root, opts.planJson);
  const planMarkdown = binding(root, opts.planMarkdown);
  const custodyReceipt = binding(root, opts.custodyReceipt);
  const custodyImplementation = binding(root, opts.custodyImplementation);
  const custodySchema = binding(root, opts.custodySchema);
  const custodyTests = binding(root, opts.custodyTests);
  const projectionParity = binding(root, opts.projectionParity);
  if (assertedVerdict(gemini.text) !== 'approved') throw new Error('Gemini artifact does not assert approval');
  if (assertedVerdict(fable.text) !== 'approved') throw new Error('Fable artifact does not assert approval');
  let operatorApproved = /operator[\s_-]*(approval|approved)|approved[\s_-]*by[\s_-]*(the[\s_-]*)?operator/i.test(operator.text);
  try {
    const marker = JSON.parse(operator.text);
    operatorApproved = operatorApproved || (marker.last_event === 'post_review_approved' && marker.post_review && marker.post_review.decision === 'approved');
  } catch (_) {}
  if (!operatorApproved) throw new Error('operator authority artifact does not record approved plan state');
  for (const [name, review] of [['Gemini', gemini], ['Fable', fable]]) {
    if (!review.text.includes(planJson.sha256)) throw new Error(`${name} artifact does not bind the current plan JSON hash`);
    if (!review.text.includes(custodyReceipt.sha256)) throw new Error(`${name} artifact does not bind the actor-custody test receipt hash`);
  }
  return {
    schema: GATE_SCHEMA,
    protocol: 'debrief_before_closeout',
    generated_at: opts.now || new Date().toISOString(),
    decision: 'approve-native-promotion',
    plan: {
      json: { path: planJson.path, sha256: planJson.sha256 },
      markdown: { path: planMarkdown.path, sha256: planMarkdown.sha256 }
    },
    soak_receipt: { path: soak.path, sha256: soak.sha256 },
    actor_custody: {
      receipt: { path: custodyReceipt.path, sha256: custodyReceipt.sha256 },
      implementation: { path: custodyImplementation.path, sha256: custodyImplementation.sha256 },
      schema: { path: custodySchema.path, sha256: custodySchema.sha256 },
      tests: { path: custodyTests.path, sha256: custodyTests.sha256 }
    },
    projection_parity: { path: projectionParity.path, sha256: projectionParity.sha256 },
    reviews: [
      { path: gemini.path, sha256: gemini.sha256, reviewer_family: 'gemini', producer_family: 'codex', verdict: 'approved' },
      { path: fable.path, sha256: fable.sha256, reviewer_family: 'fable', producer_family: 'codex', verdict: 'approved' }
    ],
    operator_authority: { path: operator.path, sha256: operator.sha256, status: 'approved' }
  };
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.resolve(value(argv, 'root', process.cwd()));
  const output = value(argv, 'output', '_dev/state/debrief-closeout/native-promotion-gate.json');
  const gate = buildGate(root, {
    soak: value(argv, 'soak', '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.json'),
    gemini: value(argv, 'gemini', '_dev/reports/analysis/sovereign-core-harness-p4-s3-gemini-review.json'),
    fable: value(argv, 'fable', '_dev/reports/analysis/sovereign-core-harness-p4-s3-fable-review.md'),
    operator: value(argv, 'operator', '_dev/state/plan-task-review-state/sovereign-core-harness.json'),
    planJson: value(argv, 'plan-json', '_dev/reports/analysis/task-plans/sovereign-core-harness__plan.json'),
    planMarkdown: value(argv, 'plan-markdown', '_dev/reports/analysis/task-plans/sovereign-core-harness__plan.md'),
    custodyReceipt: value(argv, 'custody-receipt', '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json'),
    custodyImplementation: value(argv, 'custody-implementation', 'tools/kernel/work-custody/actor-work-lease.cjs'),
    custodySchema: value(argv, 'custody-schema', 'tools/kernel/work-custody/actor-work-lease.schema.json'),
    custodyTests: value(argv, 'custody-tests', 'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs'),
    projectionParity: value(argv, 'projection-parity', '_dev/reports/analysis/sovereign-core-harness-p4-s2-receipt.md')
  });
  const target = path.resolve(root, output);
  writeAtomic(target, gate);
  const validation = validatePromotionGate(root, output);
  if (!validation.ok) throw new Error(`generated promotion gate failed validation: ${validation.errors.join('; ')}`);
  process.stdout.write(`${JSON.stringify({ ok: true, output, decision: gate.decision, reviews: gate.reviews.map((review) => review.reviewer_family) }, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { binding, buildGate, writeAtomic };
