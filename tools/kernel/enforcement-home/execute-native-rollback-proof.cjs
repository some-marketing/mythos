#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  authorizeEnforcementClaim,
  issueEnforcementClaim,
  promoteNative,
  protocolView,
  recordStaleClaimDenial,
  rollbackToClaude,
  transitionLedgerPath,
  validateRegistry
} = require('./enforcement-home-registry.cjs');
const { validatePromotionGate } = require('./native-promotion-gate.cjs');

const RECEIPT_SCHEMA = 'NativeRollbackProof/1.0';
const DEFAULT_RECEIPT = '_dev/reports/analysis/sovereign-core-harness-p4-s3-rollback-proof.json';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
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

function executeRollbackProof(root, gateRel, opts = {}) {
  const validateGate = opts.validateGate || validatePromotionGate;
  const gateValidation = validateGate(root, gateRel);
  if (!gateValidation.ok) throw new Error(`rollback proof requires valid promotion gate: ${gateValidation.errors.join('; ')}`);
  const before = protocolView(root);
  if (before.protocol.blocking_owner !== 'native_fork' || before.protocol.native_fork.mode !== 'blocking') throw new Error('rollback proof requires native_fork to be the current blocking owner');
  const gatePath = path.resolve(root, gateRel);
  const gateBytes = fs.readFileSync(gatePath);
  const startedAt = opts.now ? opts.now() : new Date().toISOString();
  const nativeClaimBeforeRollback = issueEnforcementClaim(root, 'native_fork', { now: opts.now ? opts.now() : undefined });
  const rollback = rollbackToClaude(root, { now: opts.now ? opts.now() : undefined, reason: 'p4-s3-rollback-proof' });
  const nextEvaluation = protocolView(root);
  const nextValidation = validateRegistry(nextEvaluation.registry);
  if (!nextValidation.ok || nextEvaluation.protocol.blocking_owner !== 'claude_hook' || nextEvaluation.protocol.claude_hook.mode !== 'blocking' || nextEvaluation.protocol.native_fork.mode !== 'report-only' || nextEvaluation.protocol.native_fork.health !== 'degraded') {
    throw new Error(`rollback was not effective on the next registry evaluation: ${nextValidation.errors.join('; ')}`);
  }
  const staleNativeAuthorization = authorizeEnforcementClaim(root, nativeClaimBeforeRollback);
  if (staleNativeAuthorization.ok || staleNativeAuthorization.reason !== 'stale-epoch') throw new Error('pre-rollback native claim remained authorized after epoch change');
  const staleNativeDenial = recordStaleClaimDenial(root, nativeClaimBeforeRollback, staleNativeAuthorization, { now: opts.now ? opts.now() : undefined });
  const claudeClaimBeforeRestore = issueEnforcementClaim(root, 'claude_hook', { now: opts.now ? opts.now() : undefined });
  const restore = promoteNative(root, { now: opts.now ? opts.now() : undefined, reason: `accepted-gate:${gateRel}:post-rollback-restore` });
  const finalEvaluation = protocolView(root);
  const finalValidation = validateRegistry(finalEvaluation.registry);
  if (!finalValidation.ok || finalEvaluation.protocol.blocking_owner !== 'native_fork' || finalEvaluation.protocol.native_fork.mode !== 'blocking' || finalEvaluation.protocol.claude_hook.mode !== 'report-only') {
    throw new Error(`native restoration failed: ${finalValidation.errors.join('; ')}`);
  }
  const staleClaudeAuthorization = authorizeEnforcementClaim(root, claudeClaimBeforeRestore);
  if (staleClaudeAuthorization.ok || staleClaudeAuthorization.reason !== 'stale-epoch') throw new Error('pre-restore Claude claim remained authorized after epoch change');
  const staleClaudeDenial = recordStaleClaimDenial(root, claudeClaimBeforeRestore, staleClaudeAuthorization, { now: opts.now ? opts.now() : undefined });
  const finalNativeClaim = issueEnforcementClaim(root, 'native_fork', { now: opts.now ? opts.now() : undefined });
  const finalNativeAuthorization = authorizeEnforcementClaim(root, finalNativeClaim);
  if (!finalNativeAuthorization.ok) throw new Error(`restored native claim is not authorized: ${finalNativeAuthorization.reason}`);
  const ledger = fs.readFileSync(transitionLedgerPath(root), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    protocol: 'debrief_before_closeout',
    status: 'complete',
    started_at: startedAt,
    completed_at: opts.now ? opts.now() : new Date().toISOString(),
    promotion_gate: { path: gateRel, sha256: sha256(gateBytes) },
    before: { revision: before.registry.revision, blocking_owner: before.protocol.blocking_owner },
    rollback: { revision: rollback.registry.revision, transition: rollback.transition },
    next_evaluation_without_restart: {
      registry_source: nextEvaluation.source,
      blocking_owner: nextEvaluation.protocol.blocking_owner,
      claude_hook: nextEvaluation.protocol.claude_hook,
      native_fork: nextEvaluation.protocol.native_fork,
      valid: nextValidation.ok
    },
    restore: { revision: restore.registry.revision, transition: restore.transition },
    final: {
      registry_source: finalEvaluation.source,
      blocking_owner: finalEvaluation.protocol.blocking_owner,
      claude_hook: finalEvaluation.protocol.claude_hook,
      native_fork: finalEvaluation.protocol.native_fork,
      valid: finalValidation.ok
    },
    stale_owner_epoch_proof: {
      native_claim_before_rollback: nativeClaimBeforeRollback,
      native_after_rollback: staleNativeAuthorization,
      native_denial_receipt: staleNativeDenial.row,
      claude_claim_before_restore: claudeClaimBeforeRestore,
      claude_after_restore: staleClaudeAuthorization,
      claude_denial_receipt: staleClaudeDenial.row,
      final_native_claim: finalNativeClaim,
      final_native_authorization: finalNativeAuthorization,
      denial_ledger: path.relative(root, staleNativeDenial.path).replace(/\\/g, '/')
    },
    stop_integration_evidence: {
      path: 'tools/kernel/hooks/__tests__/stop-closeout-evidence-gate.test.cjs',
      assertion: 'rollback restores Claude blocking on the next deduped Stop without restart'
    },
    transition_ledger_tail: ledger.slice(-3)
  };
  const receiptRel = opts.receipt || DEFAULT_RECEIPT;
  writeAtomic(path.resolve(root, receiptRel), receipt);
  return { receipt, receipt_path: receiptRel };
}

function value(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (require.main === module) {
  try {
    const root = path.resolve(value('root') || process.cwd());
    const gate = value('gate') || '_dev/state/debrief-closeout/native-promotion-gate.json';
    const result = executeRollbackProof(root, gate, { receipt: value('receipt') || DEFAULT_RECEIPT });
    process.stdout.write(`${JSON.stringify({ ok: true, receipt: result.receipt_path, final_owner: result.receipt.final.blocking_owner }, null, 2)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { RECEIPT_SCHEMA, DEFAULT_RECEIPT, executeRollbackProof, writeAtomic };
