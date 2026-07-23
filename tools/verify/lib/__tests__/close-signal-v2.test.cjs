'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COORDINATION_SCHEMA_VERSION,
  COORDINATION_SCHEMA_VERSION_2_0,
  closeSignal
} = require('../signal.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertContainedRegularFile,
  assertProposalModeArgs,
  loadNormalizationProposal,
  main: closeSignalMain,
  refreshProposalTarget
} = require('../../../signals/close-signal.js');
const { planSignalNormalization } = require('../../../signals/lib/signal-normalization-proposal');

function makeV1() {
  return {
    schema: COORDINATION_SCHEMA_VERSION,
    signal_type: 'coordination-request',
    lifecycle_state: 'live',
    source: 'test',
    scope: 'test-scope',
    timestamp: '2026-04-29T00:00:00.000Z'
  };
}

function makeV2(state = 'live') {
  return {
    schema: COORDINATION_SCHEMA_VERSION_2_0,
    signal_type: 'coordination-request',
    lifecycle_state: state,
    source: 'test',
    scope: 'test-scope',
    timestamp: '2026-04-29T00:00:00.000Z',
    target_addressees: { mode: 'broadcast' },
    acknowledgement_threshold: { mode: 'all' },
    acknowledgements: [],
    responses: []
  };
}

test('closeSignal still closes 1.0 live → closed', () => {
  const sig = makeV1();
  closeSignal(sig);
  assert.equal(sig.lifecycle_state, 'closed');
  assert.ok(sig.closed_at);
});

test('closeSignal closes 2.0 live → closed', () => {
  const sig = makeV2('live');
  closeSignal(sig);
  assert.equal(sig.lifecycle_state, 'closed');
  assert.ok(sig.closed_at);
});

test('closeSignal closes 2.0 complete → closed', () => {
  const sig = makeV2('complete');
  closeSignal(sig);
  assert.equal(sig.lifecycle_state, 'closed');
  assert.ok(sig.closed_at);
});

test('closeSignal records closed_reason on 2.0 when provided', () => {
  const sig = makeV2('live');
  closeSignal(sig, { reason: 'deadline_passed_operator_review' });
  assert.equal(sig.closed_reason, 'deadline_passed_operator_review');
});

test('closeSignal does NOT record closed_reason on 1.0 (field is 2.0-only)', () => {
  const sig = makeV1();
  closeSignal(sig, { reason: 'whatever' });
  assert.equal(sig.closed_reason, undefined);
});

test('closeSignal trims whitespace-only reason to absent', () => {
  const sig = makeV2('live');
  closeSignal(sig, { reason: '   ' });
  assert.equal(sig.closed_reason, undefined);
});

test('closeSignal rejects already-closed signal', () => {
  const sig = makeV2('closed');
  assert.throws(() => closeSignal(sig), /already closed/);
});

test('closeSignal rejects unknown schema', () => {
  const sig = { schema: 'HandoffSignal/9.9', lifecycle_state: 'live' };
  assert.throws(() => closeSignal(sig), /closeSignal only applies to/);
});

function proposalFixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'close-signal-proposal-'));
  const signalDir = path.join(projectRoot, '_dev/reports/signals');
  const proposalDir = path.join(projectRoot, '_dev/reports/analysis/signal-normalization-proposals');
  fs.mkdirSync(signalDir, { recursive: true });
  fs.mkdirSync(proposalDir, { recursive: true });
  const signal = { ...makeV1(), signal_type: 'ready-for-clear', recommended_next_actor: 'codex', recommended_next_command: '/next-step' };
  fs.writeFileSync(path.join(signalDir, 'target.json'), JSON.stringify(signal));
  const proposal = planSignalNormalization({ projectRoot, signal, signalBasename: 'target.json', requestedScope: 'test-scope', actorId: 'codex', capabilityGranted: true, evaluatedAt: '2026-07-14T20:01:00Z' });
  const proposalRel = '_dev/reports/analysis/signal-normalization-proposals/target.json';
  fs.writeFileSync(path.join(projectRoot, proposalRel), JSON.stringify(proposal));
  return { projectRoot, proposal, proposalRel, signal };
}

test('proposal mode requires one explicit execute target and rejects semantic or bulk flags', () => {
  assert.throws(() => assertProposalModeArgs({ proposal: 'p', file: 'target.json' }), /--execute/);
  for (const conflict of ['all', 'scope', 'reason', 'successor', 'defer']) {
    assert.throws(() => assertProposalModeArgs({ proposal: 'p', file: 'target.json', execute: true, [conflict]: 'x' }), /cannot be combined/);
  }
  assert.doesNotThrow(() => assertProposalModeArgs({ proposal: 'p', file: 'target.json', execute: true }));
});

test('proposal loader rejects traversal, absolute paths, basename mismatch, and symlinks', (t) => {
  const fixture = proposalFixture();
  assert.throws(() => loadNormalizationProposal(fixture.projectRoot, '../target.json', 'target.json'), /repo-relative|remain under/);
  assert.throws(() => loadNormalizationProposal(fixture.projectRoot, path.join(fixture.projectRoot, fixture.proposalRel), 'target.json'), /repo-relative/);
  assert.throws(() => loadNormalizationProposal(fixture.projectRoot, fixture.proposalRel, 'other.json'), /does not match/);
  const linkRel = '_dev/reports/analysis/signal-normalization-proposals/link.json';
  try {
    fs.symlinkSync(path.join(fixture.projectRoot, fixture.proposalRel), path.join(fixture.projectRoot, linkRel));
    assert.throws(() => assertContainedRegularFile(fixture.projectRoot, linkRel, '_dev/reports/analysis/signal-normalization-proposals', 'proposal path'), /symlinks/);
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
    t.skip('symlink creation is not permitted');
  }
});

test('proposal target permits acknowledgement changes but rejects every authority/content change', () => {
  const fixture = proposalFixture();
  const targetPath = path.join(fixture.projectRoot, '_dev/reports/signals/target.json');
  const withAck = { ...fixture.signal, acknowledgements: [{ session_id: 's1', action_taken: 'noted' }] };
  fs.writeFileSync(targetPath, JSON.stringify(withAck));
  const info = { name: 'target.json', filePath: targetPath, signal: withAck, size: 1 };
  assert.doesNotThrow(() => refreshProposalTarget(fixture.projectRoot, info, fixture.proposal, [info]));
  fs.writeFileSync(targetPath, JSON.stringify({ ...withAck, recommended_next_command: '/changed' }));
  assert.throws(() => refreshProposalTarget(fixture.projectRoot, info, fixture.proposal, [info]), /stale/);
});

test('proposal execution closes exactly its bound target with proposal-derived semantics', () => {
  const fixture = proposalFixture();
  const exitCode = closeSignalMain([
    'node',
    'close-signal.js',
    '--project-root', fixture.projectRoot,
    '--file', 'target.json',
    '--proposal', fixture.proposalRel,
    '--execute'
  ]);
  assert.equal(exitCode, 0);
  assert.equal(fs.existsSync(path.join(fixture.projectRoot, '_dev/reports/signals/target.json')), false);
  const closed = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, '_dev/reports/signals/closed/target.json')));
  assert.equal(closed.lifecycle_state, 'closed');
  assert.equal(closed.closed_reason, 'consumed');
});
