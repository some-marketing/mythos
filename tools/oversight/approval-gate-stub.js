'use strict';

/**
 * approval-gate-stub.js — minimal working demonstration of the gate-check
 * pattern described in README.md.
 *
 * This is a STUB, not a port of the private approval-gate.js. It shows only
 * the smallest useful slice of the pattern: given a plan's declared risk
 * tier (or review lane), decide whether the action needs an explicit
 * operator approval before it proceeds, and record that approval once given.
 *
 * It is intentionally self-contained (no dependency on any other directory
 * in this export target) so it can be copied out and adapted on its own.
 */

const fs = require('fs');
const path = require('path');

/** Risk tiers that are considered "high enough to require approval". */
const HIGH_RISK_TIERS = new Set(['high', 'critical']);

/** Risk tiers that do not require approval on their own. */
const LOW_RISK_TIERS = new Set(['low', 'medium']);

/**
 * Decide whether a plan requires operator approval before it proceeds.
 *
 * Threshold rule: a declared high/critical risk_tier requires approval; a
 * missing risk_tier (and missing review_lane) also requires approval,
 * because "unknown risk" is treated as high risk, not as an exemption.
 * Declared low/medium risk_tier does not require approval.
 *
 * @param {object} plan - Plan-like object. Expected optional fields:
 *   `risk_tier` (string) and/or `review_lane` (string).
 * @returns {{ requiresApproval: boolean, reason: string }}
 */
function requiresApproval(plan) {
  const riskTier = plan && typeof plan.risk_tier === 'string'
    ? plan.risk_tier.toLowerCase().trim()
    : '';
  const reviewLane = plan && typeof plan.review_lane === 'string'
    ? plan.review_lane.toLowerCase().trim()
    : '';

  if (!riskTier && !reviewLane) {
    return {
      requiresApproval: true,
      reason: 'No risk_tier or review_lane declared; treating undeclared risk as high.'
    };
  }
  if (HIGH_RISK_TIERS.has(riskTier)) {
    return {
      requiresApproval: true,
      reason: `Declared risk_tier "${riskTier}" requires operator approval.`
    };
  }
  if (LOW_RISK_TIERS.has(riskTier)) {
    return {
      requiresApproval: false,
      reason: `Declared risk_tier "${riskTier}" does not require operator approval.`
    };
  }
  // Unrecognized risk_tier value: fail closed, same as undeclared.
  return {
    requiresApproval: true,
    reason: `Unrecognized risk_tier "${riskTier}"; treating as high risk.`
  };
}

/**
 * Append an approval record to a local JSON log.
 *
 * @param {string} planId
 * @param {string} approvedBy - Identifier of the approving operator/actor.
 * @param {string} [note]
 * @param {string} [approvalsFile] - Defaults to ./approvals.json next to this file.
 * @returns {object} The recorded approval entry.
 */
function recordApproval(planId, approvedBy, note, approvalsFile) {
  if (!planId) throw new Error('recordApproval requires a planId');
  if (!approvedBy) throw new Error('recordApproval requires approvedBy');

  const filePath = approvalsFile || path.join(__dirname, 'approvals.json');

  let log = { schema: 'ApprovalLog/1.0', approvals: [] };
  if (fs.existsSync(filePath)) {
    try {
      log = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_err) {
      log = { schema: 'ApprovalLog/1.0', approvals: [] };
    }
  }
  if (!Array.isArray(log.approvals)) log.approvals = [];

  const entry = {
    plan_id: planId,
    approved_by: approvedBy,
    note: note || null,
    approved_at: new Date().toISOString()
  };
  log.approvals.push(entry);

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(log, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);

  return entry;
}

module.exports = { requiresApproval, recordApproval, HIGH_RISK_TIERS, LOW_RISK_TIERS };
