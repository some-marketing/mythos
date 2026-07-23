#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { resolveArtifact, validatePromotionGate } = require('../kernel/enforcement-home/native-promotion-gate.cjs');
const { protocolView, validateRegistry } = require('../kernel/enforcement-home/enforcement-home-registry.cjs');

const FINAL_RECEIPT_SCHEMA = 'SovereignCoreHarnessCompletion/1.0';

function read(root, rel) {
  try { return fs.readFileSync(resolveArtifact(root, rel, 'completion evidence'), 'utf8'); } catch (_) { return null; }
}

function json(root, rel) {
  try { return JSON.parse(read(root, rel)); } catch (_) { return null; }
}

function jsonLines(root, rel) {
  const text = read(root, rel);
  if (text === null) return [];
  return text.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch (_) { return []; } });
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function validateActorCustody(root) {
  const rel = '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json';
  const receipt = json(root, rel);
  const required = new Set([
    'simultaneous-conflicting-claims', 'conflicting-write-denial-receipt', 'non-overlapping-coexistence',
    'heartbeat-retention', 'heartbeat-expiry', 'completion-release', 'explicit-handoff-lineage',
    'crash-reclamation', 'stale-epoch-write-denial', 'cross-model-provider-agent-takeover',
    'parent-child-no-implied-ownership', 'corrupt-state-fail-closed-reclamation', 'replay-idempotency',
    'durable-transition-lineage'
  ]);
  if (!receipt || receipt.schema !== 'ActorWorkCustodyTestReceipt/1.0' || receipt.status !== 'complete') return { ok: false, detail: 'closed actor-custody receipt missing or incomplete' };
  if (!receipt.result || receipt.result.exit_code !== 0 || receipt.result.fail_count !== 0 || receipt.result.pass_count < 9) return { ok: false, detail: 'actor-custody tests are not green' };
  for (const item of receipt.falsifiers || []) required.delete(item);
  if (required.size) return { ok: false, detail: `actor-custody falsifiers missing: ${[...required].join(', ')}` };
  for (const binding of receipt.source_bindings || []) {
    const bytes = read(root, binding.path);
    if (bytes === null || sha256(bytes) !== binding.sha256) return { ok: false, detail: `actor-custody source hash mismatch: ${binding.path}` };
  }
  const paths = new Set((receipt.source_bindings || []).map((binding) => binding.path));
  for (const requiredPath of ['tools/kernel/work-custody/actor-work-lease.cjs', 'tools/kernel/work-custody/actor-work-lease.schema.json', 'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs']) {
    if (!paths.has(requiredPath)) return { ok: false, detail: `actor-custody receipt lacks source binding: ${requiredPath}` };
  }
  return { ok: true, detail: 'Actor-invocation leases, expiry, handoff, reclamation, stale-writer denial, and cross-family takeover are source-bound and mechanically green.' };
}

function approvedArtifact(root, rel) {
  const text = read(root, rel);
  if (!text) return false;
  let value = text;
  try {
    const parsed = JSON.parse(text);
    value = parsed.response_text || parsed.verdict || parsed.decision || text;
  } catch (_) {}
  const normalized = String(value).trim();
  const disposition = '(APPROVE|APPROVED|BLOCK|BLOCKED|REJECT|REJECTED|NEEDS[-_ ]AMENDMENT)';
  const leading = normalized.match(new RegExp(`^${disposition}\\b`, 'i'));
  if (leading) return /^APPROVE/i.test(leading[1]);
  const explicit = normalized.match(new RegExp(`\\bVerdict:\\s*\\*{0,2}${disposition}\\b`, 'i'));
  return Boolean(explicit && /^APPROVE/i.test(explicit[1]));
}

function audit(root = process.cwd()) {
  const checks = [];
  const add = (id, ok, evidence, detail) => checks.push({ id, ok: Boolean(ok), evidence, detail });

  const plan = json(root, '_dev/reports/analysis/task-plans/sovereign-core-harness__plan.json');
  add('scope-plan-present', plan && Array.isArray(plan.phases), ['_dev/reports/analysis/task-plans/sovereign-core-harness__plan.json'], 'Resolved P0-P7 plan is readable.');
  const p6 = plan && plan.phases && plan.phases.find((phase) => phase.id === 'P6');
  const p7 = plan && plan.phases && plan.phases.find((phase) => phase.id === 'P7');
  add('scope-p6-p7-excluded', p6 && /OUT OF SCOPE/.test(p6.note || '') && p7 && /OUT OF SCOPE/.test(p7.note || ''), ['_dev/reports/analysis/task-plans/sovereign-core-harness__plan.json'], 'P6 and P7 remain explicitly non-executable.');

  const p0Review = approvedArtifact(root, '_dev/reports/analysis/codex-last-message__20260709T152221Z__sovereign-core-harness-p0-codex-review-20260709.md');
  add('p0-accepted', p0Review, ['_dev/reports/analysis/codex-last-message__20260709T152221Z__sovereign-core-harness-p0-codex-review-20260709.md', 'tools/kernel/cascade-span/cascade-span.schema.json'], 'Canonical span, parity, and tombstone acceptance review exists.');

  const p1 = read(root, '_dev/reports/analysis/sovereign-core-harness-p1/p4-s0-reconciliation-receipt.md');
  add('p1-accepted', p1 && /Status:\s*\*\*PASS\*\*/.test(p1) && /ALL CHECKS PASSED/.test(p1) && /SOVEREIGN_TASK_OK/.test(p1), ['_dev/reports/analysis/sovereign-core-harness-p1/p4-s0-reconciliation-receipt.md'], 'Live hook self-test, recurrence proof, real task, and graceful close are recorded.');

  const p2Review = approvedArtifact(root, '_dev/reports/analysis/codex-last-message__20260709T200310Z__sovereign-core-harness-custody-pass4-20260709.md');
  add('p2-accepted', p2Review, ['_dev/reports/analysis/codex-last-message__20260709T200310Z__sovereign-core-harness-custody-pass4-20260709.md', 'tools/broker/lib/tool-broker.js'], 'P2 broker denial, parity, and custody review is approved.');

  const p3 = read(root, '_dev/reports/analysis/sovereign-core-harness-p3-receipt.md');
  const p3Run = json(root, '_dev/reports/broker/phase3-runs/phase3-20260716200812466-3de2d643-39b0-4a9c-82ee-167088aea2a4/closeout.json');
  add('p3-accepted', p3 && p3Run && p3Run.status === 'complete' && approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-p3-gemini-rereview.json'), ['_dev/reports/analysis/sovereign-core-harness-p3-receipt.md', '_dev/reports/analysis/sovereign-core-harness-p3-gemini-rereview.json'], 'Bounded patch, sandbox, timeout, rollback, lineage, and distinct review are durable.');

  add('p4-s1-accepted', approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-p4-s1-gemini-acceptance.md') && read(root, '_dev/reports/analysis/sovereign-core-harness-p4-s1-receipt.md'), ['_dev/reports/analysis/sovereign-core-harness-p4-s1-receipt.md'], 'Native close decision and loss reconciliation accepted.');
  add('p4-s2-accepted', approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-p4-s2-fable-acceptance.md') && approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-p4-s2-gemini-acceptance.md') && read(root, '_dev/reports/analysis/sovereign-core-harness-p4-s2-receipt.md'), ['_dev/reports/analysis/sovereign-core-harness-p4-s2-receipt.md'], 'Closed native/hook projection and producer-distinct parity reviews accepted.');

  const custody = validateActorCustody(root);
  add('p4-actor-portable-custody', custody.ok, ['tools/kernel/work-custody/actor-work-lease.cjs', 'tools/kernel/work-custody/actor-work-lease.schema.json', 'tools/kernel/work-custody/__tests__/actor-work-lease.test.cjs', '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json'], custody.detail);

  const gateRel = '_dev/state/debrief-closeout/native-promotion-gate.json';
  const promotionGate = validatePromotionGate(root, gateRel);
  add('p4-s3-promotion-gate', promotionGate.ok, [gateRel, '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.json'], promotionGate.ok ? 'Mature soak and required approvals are hash-bound.' : promotionGate.errors.join('; '));

  const registry = protocolView(root);
  add('p4-final-native-owner', registry.source === 'registry' && validateRegistry(registry.registry).ok && registry.protocol.blocking_owner === 'native_fork' && registry.protocol.native_fork.mode === 'blocking' && registry.protocol.claude_hook.mode === 'report-only', ['_dev/state/enforcement-home-registry.json'], 'Exactly one final native blocking owner is required.');
  const transitions = jsonLines(root, '_dev/state/enforcement-home-transitions.jsonl');
  const rollbackReceipt = json(root, '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json');
  const staleEpochProof = rollbackReceipt && rollbackReceipt.stale_owner_epoch_proof;
  const acceptedTransitionIndex = transitions.findIndex((row) => row.to_owner === 'native_fork' && /p4-s3|accepted-gate/.test(row.reason || ''));
  const rollbackIndex = transitions.findIndex((row, index) => index > acceptedTransitionIndex && row.to_owner === 'claude_hook' && /rollback|divergence/.test(row.reason || ''));
  const restoreIndex = transitions.findIndex((row, index) => index > rollbackIndex && row.to_owner === 'native_fork' && /p4-s3|accepted-gate|restore/.test(row.reason || ''));
  add('p4-rollback-proven', acceptedTransitionIndex >= 0 && rollbackIndex > acceptedTransitionIndex && restoreIndex > rollbackIndex && rollbackReceipt && rollbackReceipt.schema === 'NativeRollbackProof/1.0' && rollbackReceipt.status === 'complete' && rollbackReceipt.next_evaluation_without_restart.blocking_owner === 'claude_hook' && rollbackReceipt.final.blocking_owner === 'native_fork' && staleEpochProof && staleEpochProof.native_after_rollback.ok === false && staleEpochProof.native_after_rollback.reason === 'stale-epoch' && staleEpochProof.claude_after_restore.ok === false && staleEpochProof.claude_after_restore.reason === 'stale-epoch' && staleEpochProof.final_native_authorization.ok === true, ['_dev/state/enforcement-home-transitions.jsonl', '_dev/state/enforcement-home-stale-claim-denials.jsonl', '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json', 'tools/kernel/hooks/__tests__/stop-closeout-evidence-gate.test.cjs'], 'Durable native → Claude rollback → native restoration plus stale-epoch owner denial are required.');

  const p5Report = json(root, '_dev/reports/analysis/sovereign-core-harness__hardening-gradient.json');
  add('p5-accepted', p5Report && p5Report.summary && p5Report.summary.flagged_descents >= 1 && approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-p5-gemini-review.json'), ['_dev/reports/analysis/sovereign-core-harness-p5-receipt.md', '_dev/reports/analysis/sovereign-core-harness__hardening-gradient.json'], 'Per-lane tiers and a tooling-flagged completed descent are required.');

  const validation = json(root, '_dev/reports/analysis/sovereign-core-harness-validation__final.json');
  add('full-validation-green', validation && validation.schema === 'SovereignCoreHarnessValidation/1.0' && validation.ok === true && validation.command_count === validation.completed_count && validation.results.every((result) => result.exit_code === 0 && !result.error), ['_dev/reports/analysis/sovereign-core-harness-validation__final.json'], 'All nine P0-P5 validation commands, including focused fork tests and build, must pass in one manifest.');

  const finalReceipt = json(root, '_dev/reports/analysis/sovereign-core-harness-final-receipt.json');
  add('final-receipt', finalReceipt && finalReceipt.schema === FINAL_RECEIPT_SCHEMA && finalReceipt.status === 'complete', ['_dev/reports/analysis/sovereign-core-harness-final-receipt.json'], 'Final acceptance receipt is not self-validating but must exist and declare the closed schema.');
  add('final-fable-review', approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-final-fable-review.md'), ['_dev/reports/analysis/sovereign-core-harness-final-fable-review.md'], 'Fable 5 final adversarial approval is required.');
  add('final-gemini-review', approvedArtifact(root, '_dev/reports/analysis/sovereign-core-harness-final-gemini-review.json'), ['_dev/reports/analysis/sovereign-core-harness-final-gemini-review.json'], 'Gemini final contextual approval is required.');
  add('final-debrief', Boolean(read(root, '_dev/reports/analysis/run-debrief__sovereign-core-harness.md')), ['_dev/reports/analysis/run-debrief__sovereign-core-harness.md'], 'Final debrief is required.');
  const outcome = json(root, '_dev/reports/analysis/task-outcomes/sovereign-core-harness.json');
  add('outcome-reconciled', outcome && outcome.status === 'complete', ['_dev/reports/analysis/task-outcomes/sovereign-core-harness.json'], 'Task outcome must be reconciled as complete.');

  return {
    schema: 'SovereignCoreHarnessCompletionAudit/1.0',
    generated_at: new Date().toISOString(),
    ok: checks.every((check) => check.ok),
    summary: { total: checks.length, passed: checks.filter((check) => check.ok).length, pending: checks.filter((check) => !check.ok).length },
    checks,
    pending: checks.filter((check) => !check.ok).map((check) => check.id)
  };
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
  const report = audit(root);
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0) {
    const output = path.resolve(root, process.argv[outputIndex + 1]);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FINAL_RECEIPT_SCHEMA, approvedArtifact, audit, validateActorCustody };
