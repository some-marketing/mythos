#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveArtifact, validatePromotionGate } = require('../kernel/enforcement-home/native-promotion-gate.cjs');
const { protocolView, validateRegistry } = require('../kernel/enforcement-home/enforcement-home-registry.cjs');
const { approvedArtifact, FINAL_RECEIPT_SCHEMA } = require('./sovereign-core-harness-completion.cjs');

const OUTPUT = '_dev/reports/analysis/sovereign-core-harness-final-receipt.json';
const EVIDENCE = Object.freeze({
  P0: ['_dev/reports/analysis/codex-last-message__20260709T152221Z__sovereign-core-harness-p0-codex-review-20260709.md'],
  P1: ['_dev/reports/analysis/sovereign-core-harness-p1/p4-s0-reconciliation-receipt.md'],
  P2: ['_dev/reports/analysis/codex-last-message__20260709T200310Z__sovereign-core-harness-custody-pass4-20260709.md'],
  P3: ['_dev/reports/analysis/sovereign-core-harness-p3-receipt.md', '_dev/reports/analysis/sovereign-core-harness-p3-gemini-rereview.json'],
  P4: ['_dev/reports/analysis/sovereign-core-harness-p4-s1-receipt.md', '_dev/reports/analysis/sovereign-core-harness-p4-s2-receipt.md', '_dev/reports/analysis/sovereign-core-harness-p4-s3-soak-receipt.json', '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json', '_dev/state/debrief-closeout/native-promotion-gate.json', '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json'],
  P5: ['_dev/reports/analysis/sovereign-core-harness-p5-receipt.md', '_dev/reports/analysis/sovereign-core-harness__hardening-gradient.json', '_dev/reports/analysis/sovereign-core-harness-p5-gemini-review.json'],
  final: ['_dev/reports/analysis/sovereign-core-harness-validation__final.json', '_dev/reports/analysis/sovereign-core-harness-final-fable-review.md', '_dev/reports/analysis/sovereign-core-harness-final-gemini-review.json']
});

function bound(root, rel) {
  let target;
  try { target = resolveArtifact(root, rel, 'final evidence'); }
  catch (error) { throw new Error(`required final evidence invalid: ${rel}: ${error.message}`); }
  const bytes = fs.readFileSync(target);
  return { path: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

function writeAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
  const dir = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function build(root = process.cwd()) {
  const gate = validatePromotionGate(root, '_dev/state/debrief-closeout/native-promotion-gate.json');
  if (!gate.ok) throw new Error(`final receipt requires valid promotion gate: ${gate.errors.join('; ')}`);
  const owner = protocolView(root);
  if (owner.source !== 'registry' || !validateRegistry(owner.registry).ok || owner.protocol.blocking_owner !== 'native_fork' || owner.protocol.native_fork.mode !== 'blocking' || owner.protocol.claude_hook.mode !== 'report-only') throw new Error('final receipt requires native_fork as the sole blocking owner');
  const rollback = JSON.parse(fs.readFileSync(path.join(root, '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json'), 'utf8'));
  const staleEpoch = rollback.stale_owner_epoch_proof;
  if (rollback.schema !== 'NativeRollbackProof/1.0' || rollback.status !== 'complete' || rollback.final.blocking_owner !== 'native_fork' || !staleEpoch || staleEpoch.native_after_rollback.ok !== false || staleEpoch.native_after_rollback.reason !== 'stale-epoch' || staleEpoch.claude_after_restore.ok !== false || staleEpoch.claude_after_restore.reason !== 'stale-epoch' || staleEpoch.final_native_authorization.ok !== true) throw new Error('final receipt requires rollback/restoration with stale-owner epoch denial');
  const validation = JSON.parse(fs.readFileSync(path.join(root, '_dev/reports/analysis/sovereign-core-harness-validation__final.json'), 'utf8'));
  if (validation.schema !== 'SovereignCoreHarnessValidation/1.0' || validation.ok !== true || validation.command_count !== validation.completed_count) throw new Error('final receipt requires a green full validation manifest');
  for (const review of ['_dev/reports/analysis/sovereign-core-harness-final-fable-review.md', '_dev/reports/analysis/sovereign-core-harness-final-gemini-review.json']) if (!approvedArtifact(root, review)) throw new Error(`final review does not assert approval: ${review}`);
  const phases = Object.entries(EVIDENCE).filter(([phase]) => phase !== 'final').map(([phase, artifacts]) => ({ phase, status: 'complete', evidence: artifacts.map((artifact) => bound(root, artifact)) }));
  const repoCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const forkRoot = path.join(root, '_dev/forks/pi-mono');
  const forkCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: forkRoot, encoding: 'utf8' }).trim();
  const changedFiles = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).map((line) => line.slice(3)).filter((file) => /sovereign-core-harness|tools\/kernel\/(?:work-custody|enforcement-home)|tools\/kernel\/cascade-span\/debrief-close-parity-driver|tools\/verify\/(?:sovereign-core|build-sovereign-core|run-sovereign-core)/.test(file)).sort();
  return {
    schema: FINAL_RECEIPT_SCHEMA,
    task_id: 'sovereign-core-harness',
    status: 'complete',
    completed_at: new Date().toISOString(),
    revisions: { repository_commit: repoCommit, fork_commit: forkCommit, fork_branch: execFileSync('git', ['branch', '--show-current'], { cwd: forkRoot, encoding: 'utf8' }).trim() },
    changed_files: changedFiles,
    scope: { included: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'], excluded: ['P6', 'P7', 'native MCP/subagent', 'Broker phase 4'] },
    enforcement_home: { protocol: 'debrief_before_closeout', blocking_owner: owner.protocol.blocking_owner, claude_hook: owner.protocol.claude_hook, native_fork: owner.protocol.native_fork, registry_revision: owner.registry.revision },
    claude_stop_behavior: { retired: 'debrief_before_closeout blocking subdecision only', remains_active: 'all unrelated Claude Stop consumers, including producer-distinct review enforcement', messages: 'Claude Stop messages may remain; only messages originating from the retired debrief subdecision cease' },
    phases,
    final_evidence: EVIDENCE.final.map((artifact) => bound(root, artifact)),
    validation: { command_count: validation.command_count, completed_count: validation.completed_count, all_green: validation.ok },
    actor_custody: bound(root, '_dev/reports/analysis/sovereign-core-harness-actor-custody-tests.json'),
    promotion_gate: bound(root, '_dev/state/debrief-closeout/native-promotion-gate.json'),
    rollback_proof: bound(root, '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json'),
    stale_owner_denials: bound(root, '_dev/state/enforcement-home-stale-claim-denials.jsonl'),
    limitations: ['P6, P7, native MCP/subagent capability, and Broker phase 4 remain excluded.', 'Dart synchronization is reported separately and is not inferred from local evidence.'],
    closed_evidence_schema: { completion_receipt: FINAL_RECEIPT_SCHEMA, audit: 'SovereignCoreHarnessCompletionAudit/1.0' }
  };
}

if (require.main === module) {
  try {
    const rootIndex = process.argv.indexOf('--root');
    const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : process.cwd());
    const receipt = build(root);
    writeAtomic(path.join(root, OUTPUT), receipt);
    process.stdout.write(`${JSON.stringify({ ok: true, output: OUTPUT, owner: receipt.enforcement_home.blocking_owner, phases: receipt.phases.map((phase) => phase.phase) }, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { EVIDENCE, OUTPUT, bound, build, writeAtomic };
