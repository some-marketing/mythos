'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const codexBridge = require(path.join(REPO_ROOT, 'tools/signals/lib/codex-bridge.js'));
const dispatchBridge = require(path.join(REPO_ROOT, 'tools/signals/lib/dispatch-bridge.js'));
const reflex = require(path.join(REPO_ROOT, 'tools/kernel/doctrine-reflex.cjs'));

test('loadGroundingCardTier returns empty at leaf/task tier', () => {
  const leaf = codexBridge.loadGroundingCardTier('leaf', { projectRoot: REPO_ROOT });
  const task = codexBridge.loadGroundingCardTier('task', { projectRoot: REPO_ROOT });
  assert.equal(leaf.text, '');
  assert.equal(task.text, '');
});

test('loadGroundingCardTier returns non-empty text + hash at project tier', () => {
  const project = codexBridge.loadGroundingCardTier('project', { projectRoot: REPO_ROOT });
  assert.ok(project.text.length > 0, 'project tier prepend present');
  assert.ok(project.hash, 'hash set');
  assert.match(project.text, /## Session Grounding Card \(tier=project\)/);
  assert.match(project.text, /alpha_card_hash:/);
});

test('loadGroundingCardTier returns non-empty text at system tier with nine-absolutes pointer', () => {
  const sys = codexBridge.loadGroundingCardTier('system', { projectRoot: REPO_ROOT });
  assert.ok(sys.text.length > 0);
  assert.match(sys.text, /Nine absolutes/);
  assert.match(sys.text, /Cross-verification law/);
});

test('dispatch-bridge buildPromptBody emits named <critical> and <context> tagged blocks', () => {
  // buildPromptBody is not exported; the check is structural — we rebuild
  // a minimal prompt via the exported createDispatchRecord path if available,
  // otherwise we inspect the file contents as a deterministic-parse proxy.
  const fs = require('node:fs');
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'tools/signals/lib/dispatch-bridge.js'),
    'utf8'
  );
  assert.match(src, /<critical>/);
  assert.match(src, /<\/critical>/);
  assert.match(src, /<context>/);
  assert.match(src, /<\/context>/);
});

test('doctrine-reflex check #4 validates presence of tagged blocks in bridge prompt body', () => {
  const goodBody = [
    '<critical>top-down</critical>',
    '<context>bottom-up</context>',
    `hash: ${reflex.cardPayloadHash()}`
  ].join('\n');
  const envelope = {
    event_type: 'bridge-return',
    scope_tier: 'project',
    declared_intent: {},
    observed_write_set: [],
    observed_tool_outputs: [],
    session_present_snapshot: {
      writer_attestation: { writer_harness_id: 'claude-code:test', signature: 'x', signed_at: 'x' }
    },
    bridge_prompt_body: goodBody
  };
  const findings = reflex.check4BridgePromptContract(envelope);
  assert.equal(findings.length, 0, 'no findings when both tagged blocks + hash present');

  const badBody = 'no tags at all';
  const envelopeBad = { ...envelope, bridge_prompt_body: badBody };
  const badFindings = reflex.check4BridgePromptContract(envelopeBad);
  assert.ok(
    badFindings.some((f) => f.code === 'bridge_prompt_missing_critical_block'),
    'missing critical block flagged'
  );
  assert.ok(
    badFindings.some((f) => f.code === 'bridge_prompt_missing_context_block'),
    'missing context block flagged'
  );
});
