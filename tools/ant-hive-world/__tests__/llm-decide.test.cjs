'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { llmDecide, extractJsonAction, SYSTEM_PROMPT } = require('../llm-decide.js');

test('dry-run mode never calls the network and returns idle', () => {
  const action = llmDecide({ hiveState: { identity: 'hive-a', hive_state: {} }, worldState: { resources: {}, territory: {} } });
  assert.equal(action.verb, 'idle');
  assert.equal(action._dry_run, true);
});

test('extractJsonAction parses a clean JSON action', () => {
  const action = extractJsonAction('{"verb":"gather","resourceKey":"food","amount":2}');
  assert.equal(action.verb, 'gather');
  assert.equal(action.resourceKey, 'food');
});

test('extractJsonAction strips deepseek-r1 thinking tags before parsing', () => {
  const content = '<think>I should probably gather food since it seems useful</think>{"verb":"gather","resourceKey":"food","amount":1}';
  const action = extractJsonAction(content);
  assert.equal(action.verb, 'gather');
});

test('extractJsonAction falls back to idle on unparseable content, not a crash', () => {
  const action = extractJsonAction('not json at all');
  assert.equal(action.verb, 'idle');
  assert.ok(action._parse_error);
});

test('extractJsonAction rejects a response with no verb field', () => {
  const action = extractJsonAction('{"resourceKey":"food"}');
  assert.equal(action.verb, 'idle');
  assert.equal(action._parse_error, 'missing_verb');
});

test('SYSTEM_PROMPT contains no scripted-rivalry framing (G-NO-SCRIPTED-RIVALRY check)', () => {
  const lower = SYSTEM_PROMPT.toLowerCase();
  assert.ok(!lower.includes('enemy'));
  assert.ok(!lower.includes('rival'));
  assert.ok(!lower.includes('compete') && !lower.includes('competing'));
});

test('SYSTEM_PROMPT contains no pre-loaded foraging/behavior strategy (G-NO-PRELOADED-INSTINCT check)', () => {
  const lower = SYSTEM_PROMPT.toLowerCase();
  assert.ok(!lower.includes('strategy'));
  assert.ok(!lower.includes('optimal'));
  assert.ok(!lower.includes('should prioritize'));
});
