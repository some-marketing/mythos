'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFeasibility } = require('../verifier-lane.js');

const VERBS = ['gather-food', 'gather-wood', 'build', 'claim-territory', 'idle'];

test('idle is always feasible', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: {}, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveState, worldState);
  assert.equal(out.idle, 1);
});

test('gather-wood is infeasible when the shared wood pool is empty', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: { wood: 0 }, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveState, worldState);
  assert.equal(out['gather-wood'], 0);
});

test('gather-wood is feasible when the shared wood pool has stock', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: { wood: 5 }, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveState, worldState);
  assert.equal(out['gather-wood'], 1);
});

test('gather-food reads the resources.food magnitude (L2 breadth; was a food_sources presence check pre-L2)', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: { food: 0 }, food_sources: { 'tile-3': {} }, territory: {} };
  const out = verifyFeasibility(VERBS, hiveState, worldState);
  assert.equal(out['gather-food'], 0);
});

test('build is infeasible without enough stockpiled wood (matches harness.js canAffordBuild exactly)', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: { wood: 1 } } };
  const worldState = { resources: {}, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveState, worldState, { liveConfig: { build_cost_wood: 2 } });
  assert.equal(out.build, 0);
});

test('build is feasible with enough stockpiled wood', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: { wood: 2 } } };
  const worldState = { resources: {}, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveState, worldState, { liveConfig: { build_cost_wood: 2 } });
  assert.equal(out.build, 1);
});

test('claim-territory defaults to feasible=1 when no candidate tile is supplied (honest gap, not fabricated)', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: {}, food_sources: {}, territory: { 't1': 'hive-b' } };
  const out = verifyFeasibility(VERBS, hiveState, worldState);
  assert.equal(out['claim-territory'], 1);
});

test('claim-territory is infeasible when the candidate tile is contested by the other hive', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: {}, food_sources: {}, territory: { 't1': 'hive-b' } };
  const out = verifyFeasibility(VERBS, hiveState, worldState, { claimTileId: 't1' });
  assert.equal(out['claim-territory'], 0);
});

test('claim-territory is feasible for an unclaimed tile, and does not mutate worldState (read-only)', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: {}, food_sources: {}, territory: {} };
  const before = JSON.stringify(worldState);
  const out = verifyFeasibility(VERBS, hiveState, worldState, { claimTileId: 't7' });
  assert.equal(out['claim-territory'], 1);
  assert.equal(JSON.stringify(worldState), before);
});

test('claim-territory re-asserting an already-owned tile is feasible (already_owned is not a hard failure)', () => {
  const hiveState = { identity: 'hive-a', hive_state: { stockpile: {} } };
  const worldState = { resources: {}, food_sources: {}, territory: { 't1': 'hive-a' } };
  const out = verifyFeasibility(VERBS, hiveState, worldState, { claimTileId: 't1' });
  assert.equal(out['claim-territory'], 1);
});
