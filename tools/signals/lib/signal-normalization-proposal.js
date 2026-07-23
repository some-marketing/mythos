'use strict';

const path = require('path');
const { sha256Bytes, stableJson } = require('../../verify/lib/run-evidence-index.cjs');
const { closureEvidence } = require('./closure-evidence.cjs');

const AUTHORITY_SCHEMA = 'SignalAuthorityDecision/1.0';
const PROPOSAL_SCHEMA = 'SignalNormalizationProposal/1.0';
const HASH_REF = /^sha256:[a-f0-9]{64}$/;

function signalContentValue(signal) {
  const value = JSON.parse(JSON.stringify(signal || {}));
  delete value.acknowledgements;
  return value;
}

function signalContentSha256(signal) {
  return sha256Bytes(stableJson(signalContentValue(signal)));
}

function proposalSha256(proposal) {
  const value = { ...proposal };
  delete value.proposal_sha256;
  return sha256Bytes(stableJson(value));
}

function isSafeBasename(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === path.basename(value)
    && value.endsWith('.json')
    && !value.includes('\\')
    && !value.includes('\0');
}

function signalScope(signal) {
  return String((signal && (signal.signal_scope || signal.scope)) || '').trim();
}

function signalRefMatches(ref, basename) {
  const value = String(ref || '').trim().replace(/\\/g, '/');
  return value === basename || value.endsWith(`/${basename}`);
}

function check(id, status, detail) {
  return { id, status, detail };
}

function planSignalNormalization(options = {}) {
  const signal = options.signal || {};
  const basename = String(options.signalBasename || '').trim();
  const requestedScope = String(options.requestedScope || '').trim();
  const actualScope = signalScope(signal);
  const actorId = String(options.actorId || '').trim().toLowerCase();
  const targetActor = String(signal.recommended_next_actor || '').trim().toLowerCase();
  const evaluatedAt = options.evaluatedAt || new Date().toISOString();
  const contentHash = signalContentSha256(signal);
  const checks = [];

  checks.push(check('signal.basename', isSafeBasename(basename) ? 'PASS' : 'FAIL', isSafeBasename(basename) ? 'Signal basename is canonical.' : 'Signal target must be one JSON basename.'));
  checks.push(check('signal.lifecycle', signal.lifecycle_state === 'live' ? 'PASS' : 'FAIL', signal.lifecycle_state === 'live' ? 'Signal is live.' : 'Only a live signal may receive a normalization proposal.'));
  checks.push(check('authority.capability', options.capabilityGranted === true ? 'PASS' : 'FAIL', options.capabilityGranted === true ? 'Caller supplied an explicit current capability grant.' : 'Current capability grant is missing.'));
  checks.push(check('authority.scope', requestedScope && requestedScope === actualScope ? 'PASS' : 'FAIL', requestedScope === actualScope && requestedScope ? 'Requested scope matches signal scope.' : 'Requested scope is missing or does not match the signal.'));
  checks.push(check('authority.actor', Boolean(actorId && targetActor && actorId === targetActor) ? 'PASS' : 'FAIL', actorId && targetActor && actorId === targetActor ? 'Named actor matches the signal target.' : 'A named actor must exactly match the signal target.'));

  if (options.conflictingReceipts) checks.push(check('receipts.conflict', 'REVIEW', 'Conflicting lifecycle receipts require semantic review.'));
  if (Array.isArray(options.activeChildren) && options.activeChildren.length > 0) checks.push(check('children.active', 'REVIEW', 'Active child work prevents mechanical normalization.'));

  const liveSignals = Array.isArray(options.liveSignals) ? options.liveSignals : [];
  const successors = liveSignals.filter((entry) => {
    const other = entry && (entry.signal || entry);
    const otherName = String((entry && (entry.name || entry.signalBasename)) || '').trim();
    return other !== signal && other && other.lifecycle_state === 'live' && isSafeBasename(otherName) && signalRefMatches(other.supersedes_signal, basename);
  });
  const duplicates = liveSignals.filter((entry) => {
    const other = entry && (entry.signal || entry);
    const otherName = String((entry && (entry.name || entry.signalBasename)) || '').trim();
    return other !== signal && other && other.lifecycle_state === 'live' && isSafeBasename(otherName) && signalRefMatches(other.duplicates_signal, basename);
  });
  const sameScopePeers = liveSignals.filter((entry) => {
    const other = entry && (entry.signal || entry);
    const otherName = String((entry && (entry.name || entry.signalBasename)) || '').trim();
    return other !== signal && other && other.lifecycle_state === 'live' && isSafeBasename(otherName) && signalScope(other) === actualScope;
  });
  if (sameScopePeers.length > 0 && successors.length === 0 && duplicates.length === 0) {
    checks.push(check('scope.unique', 'REVIEW', 'Another live signal shares this scope without an explicit supersession link.'));
  }

  let disposition = 'review_required';
  let closeReason = null;
  let successor = null;
  let deferralReason = null;
  if (successors.length + duplicates.length > 1) {
    checks.push(check('successor.unique', 'REVIEW', 'More than one live signal claims to supersede or duplicate this signal.'));
  } else if (successors.length === 1) {
    successor = String(successors[0].name || successors[0].signalBasename);
    disposition = 'superseded';
    closeReason = 'superseded';
    checks.push(check('successor.unique', 'PASS', `Explicit successor ${successor} preserves the obligation.`));
  } else if (duplicates.length === 1) {
    successor = String(duplicates[0].name || duplicates[0].signalBasename);
    disposition = 'duplicate';
    closeReason = 'duplicate';
    checks.push(check('successor.unique', 'PASS', `Explicit duplicate successor ${successor} preserves the obligation.`));
  } else if (signal.signal_type === 'ready-for-clear' || signal.ready_for_clear === true) {
    disposition = 'close';
    closeReason = 'consumed';
    checks.push(check('disposition.structural', 'PASS', 'Signal explicitly declares ready-for-clear state.'));
  } else {
    checks.push(check('disposition.structural', 'REVIEW', 'No explicit structural close or supersession fact exists.'));
  }

  const evidence = closureEvidence(signal, options.projectRoot || process.cwd());
  if (evidence.required && !evidence.satisfied && disposition === 'close') {
    deferralReason = String(options.deferralReason || '').trim() || null;
    checks.push(check('closure.evidence', deferralReason ? 'PASS' : 'REVIEW', deferralReason ? 'Missing contracted artifacts have a proposed durable deferral reason.' : 'Contracted artifacts are missing and no deferral reason was supplied.'));
  } else {
    const detail = evidence.satisfied
      ? 'Contracted closure evidence is satisfied or not required.'
      : (['superseded', 'duplicate'].includes(disposition)
        ? 'An explicit successor preserves the obligation.'
        : 'Closure evidence remains deferred to semantic review.');
    checks.push(check('closure.evidence', 'PASS', detail));
  }

  const hasFailure = checks.some((item) => item.status === 'FAIL');
  const hasReview = checks.some((item) => item.status === 'REVIEW');
  const status = hasFailure ? 'blocked' : (hasReview ? 'review_required' : 'eligible');
  let classification = status;
  if (signal.lifecycle_state !== 'live') classification = 'stale';
  else if (successors.length + duplicates.length > 1 || (sameScopePeers.length > 0 && successors.length === 0 && duplicates.length === 0)) classification = 'ambiguous';
  else if (status === 'eligible' && disposition === 'superseded') classification = 'superseded';
  else if (status === 'eligible' && disposition === 'duplicate') classification = 'duplicate';
  if (status !== 'eligible') {
    disposition = 'review_required';
    closeReason = null;
    successor = null;
    deferralReason = null;
  }

  const authorityDecision = {
    schema: AUTHORITY_SCHEMA,
    decision_id: `signal-authority:${basename || 'invalid'}:${contentHash.slice(-12)}`,
    evaluated_at: evaluatedAt,
    signal_basename: basename,
    signal_content_sha256: contentHash,
    status,
    requested_scope: requestedScope,
    signal_scope: actualScope,
    actor_id: actorId,
    target_actor: targetActor,
    capability_granted: options.capabilityGranted === true,
    checks,
    evidence_refs: Array.isArray(options.evidenceRefs) ? options.evidenceRefs.map(String) : []
  };
  const proposal = {
    schema: PROPOSAL_SCHEMA,
    proposal_id: `signal-normalization:${basename || 'invalid'}:${contentHash.slice(-12)}`,
    created_at: evaluatedAt,
    signal_basename: basename,
    signal_path: isSafeBasename(basename) ? `_dev/reports/signals/${basename}` : '',
    signal_content_sha256: contentHash,
    classification,
    disposition,
    close_reason: closeReason,
    successor,
    deferral_reason: deferralReason,
    authority_decision: authorityDecision,
    evidence_refs: authorityDecision.evidence_refs,
    proposal_sha256: ''
  };
  proposal.proposal_sha256 = proposalSha256(proposal);
  return proposal;
}

function validateNormalizationProposal(proposal) {
  const errors = [];
  if (!proposal || proposal.schema !== PROPOSAL_SCHEMA) errors.push('schema must be SignalNormalizationProposal/1.0');
  if (!isSafeBasename(proposal && proposal.signal_basename)) errors.push('signal_basename must be one JSON basename');
  if (proposal && proposal.signal_path !== `_dev/reports/signals/${proposal.signal_basename}`) errors.push('signal_path must match signal_basename on the live signal surface');
  if (!HASH_REF.test(String(proposal && proposal.signal_content_sha256 || ''))) errors.push('signal_content_sha256 is invalid');
  if (!HASH_REF.test(String(proposal && proposal.proposal_sha256 || '')) || proposalSha256(proposal) !== proposal.proposal_sha256) errors.push('proposal_sha256 is invalid or stale');
  if (!proposal || !proposal.authority_decision || proposal.authority_decision.status !== 'eligible' || proposal.authority_decision.capability_granted !== true) errors.push('authority decision must be eligible with capability granted');
  if (proposal && proposal.disposition === 'review_required') errors.push('review_required proposals cannot authorize mutation');
  if (proposal && ['duplicate', 'superseded'].includes(proposal.disposition) && !isSafeBasename(proposal.successor)) errors.push(`${proposal.disposition} proposal requires a successor basename`);
  if (proposal && proposal.disposition === 'close' && !['closed', 'consumed'].includes(proposal.close_reason)) errors.push('close proposal requires closed or consumed close_reason');
  if (proposal && proposal.disposition === 'duplicate' && proposal.close_reason !== 'duplicate') errors.push('duplicate disposition requires duplicate close_reason');
  if (proposal && proposal.disposition === 'superseded' && proposal.close_reason !== 'superseded') errors.push('superseded disposition requires superseded close_reason');
  return errors;
}

module.exports = {
  AUTHORITY_SCHEMA,
  PROPOSAL_SCHEMA,
  isSafeBasename,
  planSignalNormalization,
  proposalSha256,
  signalContentSha256,
  validateNormalizationProposal
};
