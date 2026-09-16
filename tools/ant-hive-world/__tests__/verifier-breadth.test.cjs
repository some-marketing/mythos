'use strict';

// L2 (plan ant-sim-three-lobe-lane-redesign): VERIFIER+BREADTH. Design doc
// S4 body text as written (OD4-resolved): graduated, never-zero scoring of
// OPEN claim-territory tiles by contested_density at radius=1
// (OD3-resolved), and gather-* branches moved from a food_sources presence
// check to a magnitude check against worldState.resources.food/.wood.
// Already-decided cases (contested -> 0, already_owned -> 1) unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFeasibility } = require('../verifier-lane.js');

const VERBS = ['gather-food', 'gather-wood', 'build', 'claim-territory', 'idle'];
const hiveA = { identity: 'hive-a', hive_state: { stockpile: {} } };

test('gather-food is a magnitude check against resources.food, not a food_sources presence check', () => {
  // A source entry exists but its summed quantity is zero -- presence said 1,
  // magnitude says 0. This asymmetry is the point of the L2 change.
  const worldState = { resources: { food: 0 }, food_sources: { 'tile-3': { quantity: 0 } }, territory: {} };
  const out = verifyFeasibility(VERBS, hiveA, worldState);
  assert.equal(out['gather-food'], 0);
});

test('gather-food is feasible when the shared food pool has quantity', () => {
  const worldState = { resources: { food: 7 }, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveA, worldState);
  assert.equal(out['gather-food'], 1);
});

test('open tile with no opponent neighbors scores full 1.0', () => {
  // tile-55 = (5,5), interior; neighborhood all unowned.
  const worldState = { resources: {}, food_sources: {}, territory: {} };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.equal(out['claim-territory'], 1);
});

test('open tile fully surrounded by opponent tiles scores 1/9 -- graduated, never zero', () => {
  // tile-55 = (5,5); all 8 Chebyshev neighbors owned by hive-b; candidate
  // itself open. contested_density = 8/9, score = 1 - 8/9 = 1/9 > 0.
  const territory = {};
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]]) {
    territory[`tile-${y * 10 + x}`] = 'hive-b';
  }
  const worldState = { resources: {}, food_sources: {}, territory };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.ok(Math.abs(out['claim-territory'] - 1 / 9) < 1e-12);
  assert.ok(out['claim-territory'] > 0);
});

test('own-hive neighbors do not count as contested', () => {
  const territory = {};
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]]) {
    territory[`tile-${y * 10 + x}`] = 'hive-a';
  }
  const worldState = { resources: {}, food_sources: {}, territory };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.equal(out['claim-territory'], 1);
});

test('partially contested open tile scores between 0 and 1, monotone in opponent presence', () => {
  const mk = (opponentNeighbors) => {
    const territory = {};
    for (const [x, y] of opponentNeighbors) territory[`tile-${y * 10 + x}`] = 'hive-b';
    const worldState = { resources: {}, food_sources: {}, territory };
    return verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' })['claim-territory'];
  };
  const two = mk([[4, 4], [5, 4]]);        // density 2/9
  const five = mk([[4, 4], [5, 4], [6, 4], [4, 5], [6, 5]]); // density 5/9
  assert.ok(Math.abs(two - 7 / 9) < 1e-12);
  assert.ok(Math.abs(five - 4 / 9) < 1e-12);
  assert.ok(two > five && five > 0);
});

test('corner tile clips the neighborhood to the board (tile-0: 4 tiles incl. candidate)', () => {
  // tile-0 = (0,0); on-board neighbors: (1,0)=tile-1, (0,1)=tile-10, (1,1)=tile-11.
  const territory = { 'tile-1': 'hive-b', 'tile-10': 'hive-b', 'tile-11': 'hive-b' };
  const worldState = { resources: {}, food_sources: {}, territory };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-0' });
  assert.ok(Math.abs(out['claim-territory'] - 0.25) < 1e-12); // 1 - 3/4
});

test('already-owned re-assertion stays exactly 1 even when surrounded by the opponent (already-decided case unchanged)', () => {
  const territory = { 'tile-55': 'hive-a' };
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]]) {
    territory[`tile-${y * 10 + x}`] = 'hive-b';
  }
  const worldState = { resources: {}, food_sources: {}, territory };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.equal(out['claim-territory'], 1);
});

test('opponent-owned candidate tile stays exactly 0 (existing hard-failure semantics unchanged)', () => {
  const worldState = { resources: {}, food_sources: {}, territory: { 'tile-55': 'hive-b' } };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.equal(out['claim-territory'], 0);
});

test('unparsable tile id falls back to ungradated 1 for an open tile (honest gap, not a fabricated density)', () => {
  const worldState = { resources: {}, food_sources: {}, territory: { 't1': 'hive-b' } };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 't7' });
  assert.equal(out['claim-territory'], 1);
});

test('bare-number alias id cannot score 0 even when its canonical tile and all neighbors are opponent-owned (codex blocker regression)', () => {
  // parseTileIndex accepts '55'; territory is keyed canonically. The alias
  // key is open (claimTerritory succeeds on '55') while canonical tile-55
  // AND all 8 neighbors belong to hive-b. The candidate's own slot must not
  // count as contested: density = 8/9, score = 1/9 > 0 -- never a veto.
  const territory = { 'tile-55': 'hive-b' };
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]]) {
    territory[`tile-${y * 10 + x}`] = 'hive-b';
  }
  const worldState = { resources: {}, food_sources: {}, territory };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: '55' });
  assert.ok(out['claim-territory'] > 0);
  assert.ok(Math.abs(out['claim-territory'] - 1 / 9) < 1e-12);
});

test('idle stays unconditionally 1 in a dense contested world (S6 obligation, by test not inspection)', () => {
  const territory = {};
  for (let i = 0; i < 100; i++) territory[`tile-${i}`] = i % 2 ? 'hive-b' : 'hive-a';
  const worldState = { resources: { food: 0, wood: 0 }, food_sources: {}, territory };
  const out = verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.equal(out.idle, 1);
});

test('breadth scoring does not mutate worldState (read-only)', () => {
  const territory = { 'tile-44': 'hive-b' };
  const worldState = { resources: { food: 3 }, food_sources: {}, territory };
  const before = JSON.stringify(worldState);
  verifyFeasibility(VERBS, hiveA, worldState, { claimTileId: 'tile-55' });
  assert.equal(JSON.stringify(worldState), before);
});
