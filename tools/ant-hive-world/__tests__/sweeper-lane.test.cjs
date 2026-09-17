'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSweeperState, recordOutcome, computeCaution, DEFAULT_WINDOW } = require('../sweeper-lane.js');

test('a verb with no occurrences in the window gets caution=0 (cold start, not "safe")', () => {
  const state = createSweeperState(5);
  const out = computeCaution(state, ['build']);
  assert.equal(out.build, 0);
});

test('a verb whose recent occurrences are all above its own mean gets caution=0', () => {
  const state = createSweeperState(5);
  recordOutcome(state, 'build', 1);
  recordOutcome(state, 'build', 1);
  const out = computeCaution(state, ['build']);
  assert.equal(out.build, 0);
});

test('a verb with a declining streak gets caution > 0', () => {
  const state = createSweeperState(10);
  recordOutcome(state, 'claim-territory', 2);
  recordOutcome(state, 'claim-territory', 1);
  recordOutcome(state, 'claim-territory', -3);
  recordOutcome(state, 'claim-territory', -3);
  const out = computeCaution(state, ['claim-territory']);
  assert.ok(out['claim-territory'] > 0, `expected caution > 0, got ${out['claim-territory']}`);
});

test('the buffer is bounded to windowSize -- oldest entries drop first (FIFO)', () => {
  const state = createSweeperState(3);
  recordOutcome(state, 'idle', 100);
  recordOutcome(state, 'idle', 0);
  recordOutcome(state, 'idle', 0);
  recordOutcome(state, 'idle', 0);
  assert.equal(state.buffer.length, 3);
  assert.equal(state.buffer.some((e) => e.reward === 100), false);
});

test('caution is scoped per verb -- one verb declining does not raise caution for another', () => {
  const state = createSweeperState(10);
  recordOutcome(state, 'build', 2);
  recordOutcome(state, 'build', 2);
  recordOutcome(state, 'claim-territory', 2);
  recordOutcome(state, 'claim-territory', -3);
  const out = computeCaution(state, ['build', 'claim-territory']);
  assert.equal(out.build, 0);
  assert.ok(out['claim-territory'] > 0);
});

test('createSweeperState rejects a non-positive-integer window', () => {
  assert.throws(() => createSweeperState(0));
  assert.throws(() => createSweeperState(-1));
  assert.throws(() => createSweeperState(1.5));
});

test('default window size is exported and used when omitted', () => {
  const state = createSweeperState();
  assert.equal(state.windowSize, DEFAULT_WINDOW);
});
