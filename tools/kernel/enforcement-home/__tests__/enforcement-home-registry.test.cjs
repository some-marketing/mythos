'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../enforcement-home-registry.cjs');

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'enforcement-home-registry-'));
}

test('missing, corrupt, and unreadable-shaped registry states fail safe to Claude ownership', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let view = registry.protocolView(root);
  assert.equal(view.protocol.blocking_owner, 'claude_hook');
  assert.equal(view.source, 'fail-safe-missing');
  const target = registry.registryPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{bad-json');
  view = registry.protocolView(root);
  assert.equal(view.protocol.blocking_owner, 'claude_hook');
  assert.equal(view.source, 'fail-safe-corrupt-or-unreadable');
  fs.writeFileSync(target, JSON.stringify({ schema: registry.SCHEMA_ID }));
  view = registry.protocolView(root);
  assert.equal(view.protocol.blocking_owner, 'claude_hook');
});

test('initialization and native promotion always validate exactly one blocking owner', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = registry.initializeRegistry(root, { now: '2026-07-16T12:00:00.000Z' });
  assert.equal(initial.created, true);
  assert.equal(registry.validateRegistry(initial.registry).ok, true);
  assert.equal(initial.registry.protocols.debrief_before_closeout.blocking_owner, 'claude_hook');
  const promoted = registry.promoteNative(root, { now: '2026-07-16T12:01:00.000Z', reason: 'test-promotion' });
  assert.equal(registry.validateRegistry(promoted.registry).ok, true);
  assert.equal(promoted.registry.protocols.debrief_before_closeout.blocking_owner, 'native_fork');
  assert.equal(promoted.registry.protocols.debrief_before_closeout.claude_hook.mode, 'report-only');
  assert.equal(promoted.registry.protocols.debrief_before_closeout.native_fork.mode, 'blocking');
});

test('injected crash before rename preserves the prior single-owner state', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  registry.initializeRegistry(root, { now: '2026-07-16T12:00:00.000Z' });
  assert.throws(() => registry.promoteNative(root, {
    now: '2026-07-16T12:01:00.000Z',
    faultInjector(stage) { if (stage === 'before-rename') throw new Error('simulated-mid-flip-crash'); }
  }), /simulated-mid-flip-crash/);
  const after = registry.protocolView(root);
  assert.equal(after.source, 'registry');
  assert.equal(after.protocol.blocking_owner, 'claude_hook');
  assert.equal(registry.validateRegistry(after.registry).ok, true);
});

test('rollback restores Claude, marks native degraded, and records a durable transition', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  registry.initializeRegistry(root, { now: '2026-07-16T12:00:00.000Z' });
  registry.promoteNative(root, { now: '2026-07-16T12:01:00.000Z' });
  const rolledBack = registry.rollbackToClaude(root, { now: '2026-07-16T12:02:00.000Z', reason: 'test-divergence' });
  const protocol = rolledBack.registry.protocols.debrief_before_closeout;
  assert.equal(protocol.blocking_owner, 'claude_hook');
  assert.equal(protocol.claude_hook.mode, 'blocking');
  assert.deepEqual(protocol.native_fork, { mode: 'report-only', health: 'degraded' });
  const transitions = fs.readFileSync(registry.transitionLedgerPath(root), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(transitions.map((row) => row.to_owner), ['native_fork', 'claude_hook']);
  assert.equal(transitions[1].reason, 'test-divergence');
  assert.deepEqual(transitions.map((row) => [row.from_epoch, row.to_epoch]), [[0, 1], [1, 2]]);
});

test('epoch-bound claims prevent stale owners from enforcing or writing after ownership changes', (t) => {
  const root = sandbox();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  registry.initializeRegistry(root, { now: '2026-07-17T12:00:00.000Z' });
  registry.promoteNative(root, { now: '2026-07-17T12:01:00.000Z' });
  const nativeClaim = registry.issueEnforcementClaim(root, 'native_fork', { now: '2026-07-17T12:01:30.000Z' });
  assert.equal(registry.authorizeEnforcementClaim(root, nativeClaim).ok, true);
  registry.rollbackToClaude(root, { now: '2026-07-17T12:02:00.000Z' });
  const staleNative = registry.authorizeEnforcementClaim(root, nativeClaim);
  assert.equal(staleNative.ok, false);
  assert.equal(staleNative.reason, 'stale-epoch');
  const denial = registry.recordStaleClaimDenial(root, nativeClaim, staleNative, { now: '2026-07-17T12:02:01.000Z' });
  assert.equal(fs.existsSync(denial.path), true);
  const claudeClaim = registry.issueEnforcementClaim(root, 'claude_hook', { now: '2026-07-17T12:02:30.000Z' });
  assert.equal(registry.authorizeEnforcementClaim(root, claudeClaim).ok, true);
  registry.promoteNative(root, { now: '2026-07-17T12:03:00.000Z' });
  assert.equal(registry.authorizeEnforcementClaim(root, claudeClaim).reason, 'stale-epoch');
  assert.equal(registry.authorizeEnforcementClaim(root, registry.issueEnforcementClaim(root, 'native_fork')).ok, true);
});

test('closed registry validation rejects extra fields and split-brain modes', () => {
  const valid = registry.defaultRegistry('2026-07-16T12:00:00.000Z');
  assert.equal(registry.validateRegistry({ ...valid, extra: true }).ok, false);
  const split = structuredClone(valid);
  split.protocols.debrief_before_closeout.native_fork.mode = 'blocking';
  assert.equal(registry.validateRegistry(split).ok, false);
});
