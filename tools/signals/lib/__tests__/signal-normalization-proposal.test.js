'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validate } = require('../../../verify/lib/schema.cjs');
const {
  planSignalNormalization,
  proposalSha256,
  signalContentSha256,
  validateNormalizationProposal
} = require('../signal-normalization-proposal');

const SCHEMA_DIR = path.resolve(__dirname, '../../schemas');

function signal(overrides = {}) {
  return {
    schema: 'HandoffSignal/1.0',
    signal_type: 'ready-for-clear',
    lifecycle_state: 'live',
    source: 'test',
    signal_scope: 'system:test',
    timestamp: '2026-07-14T20:00:00Z',
    recommended_next_actor: 'codex',
    recommended_next_command: '/next-step',
    artifacts: [],
    decision_context_artifacts: [],
    blocked_by: [],
    ...overrides
  };
}

function plan(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-normalization-'));
  return planSignalNormalization({
    projectRoot: root,
    signal: signal(),
    signalBasename: 'target.json',
    requestedScope: 'system:test',
    actorId: 'codex',
    capabilityGranted: true,
    evaluatedAt: '2026-07-14T20:01:00Z',
    ...overrides
  });
}

test('eligible ready-for-clear proposal validates against both schemas', () => {
  const proposal = plan();
  assert.equal(proposal.authority_decision.status, 'eligible');
  assert.equal(proposal.classification, 'eligible');
  assert.equal(proposal.disposition, 'close');
  assert.equal(proposal.close_reason, 'consumed');
  assert.deepEqual(validateNormalizationProposal(proposal), []);
  const proposalSchema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'signal-normalization-proposal.schema.json')));
  const authoritySchema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'signal-authority-decision.schema.json')));
  assert.deepEqual(validate(proposal, proposalSchema, { rootSchema: proposalSchema }), []);
  assert.deepEqual(validate(proposal.authority_decision, authoritySchema, { rootSchema: authoritySchema }), []);
});

test('planner is pure and acknowledgement-only changes preserve content hash', () => {
  const input = signal({ acknowledgements: [] });
  const before = JSON.stringify(input);
  const first = signalContentSha256(input);
  input.acknowledgements.push({ session_id: 's1', action_taken: 'noted' });
  assert.equal(signalContentSha256(input), first);
  assert.equal(JSON.stringify({ ...input, acknowledgements: [] }), before);
});

test('every sampled authority-bearing change invalidates the signal hash', () => {
  const base = signal({ acknowledgements: [] });
  const expected = signalContentSha256(base);
  for (const mutate of [
    (value) => { value.signal_scope = 'system:other'; },
    (value) => { value.lifecycle_state = 'complete'; },
    (value) => { value.recommended_next_command = '/different'; },
    (value) => { value.artifacts = ['_dev/reports/analysis/result.json']; },
    (value) => { value.blocked_by = ['gate']; },
    (value) => { value.acknowledgement_threshold = { mode: 'all' }; }
  ]) {
    const changed = JSON.parse(JSON.stringify(base));
    mutate(changed);
    assert.notEqual(signalContentSha256(changed), expected);
  }
});

test('explicit unique supersession produces an obligation-preserving proposal', () => {
  const target = signal({ signal_type: 'coordination-request' });
  const proposal = plan({
    signal: target,
    liveSignals: [{ name: 'successor.json', signal: signal({ supersedes_signal: 'target.json' }) }]
  });
  assert.equal(proposal.authority_decision.status, 'eligible');
  assert.equal(proposal.disposition, 'superseded');
  assert.equal(proposal.classification, 'superseded');
  assert.equal(proposal.successor, 'successor.json');
});

test('explicit unique duplicate link produces an obligation-preserving duplicate proposal', () => {
  const target = signal({ signal_type: 'coordination-request' });
  const proposal = plan({
    signal: target,
    liveSignals: [{ name: 'canonical.json', signal: signal({ duplicates_signal: 'target.json' }) }]
  });
  assert.equal(proposal.authority_decision.status, 'eligible');
  assert.equal(proposal.classification, 'duplicate');
  assert.equal(proposal.disposition, 'duplicate');
  assert.equal(proposal.close_reason, 'duplicate');
  assert.equal(proposal.successor, 'canonical.json');
});

test('ambiguous successors, same-scope conflicts, active children, and receipt conflicts require review', () => {
  const target = signal({ signal_type: 'coordination-request' });
  const successors = ['a.json', 'b.json'].map((name) => ({ name, signal: signal({ supersedes_signal: 'target.json' }) }));
  assert.equal(plan({ signal: target, liveSignals: successors }).authority_decision.status, 'review_required');
  assert.equal(plan({ signal: target, liveSignals: successors }).classification, 'ambiguous');
  const conflict = plan({ liveSignals: [{ name: 'peer.json', signal: signal() }] });
  assert.equal(conflict.authority_decision.status, 'review_required');
  assert.equal(conflict.classification, 'ambiguous');
  const mixed = plan({ signal: target, liveSignals: [successors[0], { name: 'duplicate.json', signal: signal({ duplicates_signal: 'target.json' }) }] });
  assert.equal(mixed.classification, 'ambiguous');
  assert.equal(plan({ activeChildren: ['child'] }).authority_decision.status, 'review_required');
  assert.equal(plan({ conflictingReceipts: true }).authority_decision.status, 'review_required');
});

test('unresolved missing evidence never claims that a successor exists', () => {
  const target = signal({ signal_type: 'coordination-request', recommended_next_command: '/reconcile-lessons 2099-01-01' });
  const proposal = plan({ signal: target });
  const evidenceCheck = proposal.authority_decision.checks.find((item) => item.id === 'closure.evidence');
  assert.equal(proposal.authority_decision.status, 'review_required');
  assert.match(evidenceCheck.detail, /semantic review/);
  assert.doesNotMatch(evidenceCheck.detail, /successor preserves/);
});

test('scope, capability, actor, lifecycle, and basename mismatches fail closed', () => {
  assert.equal(plan({ requestedScope: 'system:other' }).authority_decision.status, 'blocked');
  assert.equal(plan({ capabilityGranted: false }).authority_decision.status, 'blocked');
  assert.equal(plan({ actorId: 'gemini' }).authority_decision.status, 'blocked');
  assert.equal(plan({ signal: signal({ lifecycle_state: 'complete' }) }).authority_decision.status, 'blocked');
  assert.equal(plan({ signal: signal({ lifecycle_state: 'complete' }) }).classification, 'stale');
  assert.equal(plan({ signalBasename: '../target.json' }).authority_decision.status, 'blocked');
  assert.equal(plan({ actorId: '' }).authority_decision.status, 'blocked');
});

test('follow-signal and lifecycle consumers expose the same report-only planner', () => {
  assert.equal(require('../follow-signal').planSignalNormalization, planSignalNormalization);
  assert.equal(require('../signal-lifecycle').planSignalNormalization, planSignalNormalization);
});

test('tampering with proposal semantics invalidates the proposal hash', () => {
  const proposal = plan();
  proposal.close_reason = 'closed';
  assert.notEqual(proposalSha256(proposal), proposal.proposal_sha256);
  assert.match(validateNormalizationProposal(proposal).join(' '), /proposal_sha256/);
});
