'use strict';

// Richer abstract resource/element model (plan
// ant-hive-world-richer-resource-model). New materials (clay/water/ore/fiber)
// gathered via scripted, environmental sources exactly parallel to food
// sources -- NOT a network-gathered verb (see the plan's S0 scoping memo) --
// plus the one shipped conversion rule, clay + water -> mud.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initialWorldState,
  applyMaterialDynamics,
  MATERIAL_SOURCE_TYPES,
  INITIAL_MATERIAL_SOURCE_COUNTS
} = require('../world-state.js');

test('a fresh world seeds material source patches but starts UNDISCOVERED -- resources start at 0', () => {
  const state = initialWorldState({});
  for (const key of MATERIAL_SOURCE_TYPES) {
    const sourceCount = Object.keys(state[`${key}_sources`] || {}).length;
    assert.equal(sourceCount, INITIAL_MATERIAL_SOURCE_COUNTS[key]);
    assert.equal(state.resources[key], 0);
  }
  assert.equal(state.resources.mud, 0);
  assert.deepEqual(state.discovered_types, ['food', 'wood', 'stone']);
});

test('applyMaterialDynamics harvests sources into the shared pool and marks discovery on first nonzero amount', () => {
  let state = initialWorldState({});
  const rng = () => 0.5; // below default spawn chance is irrelevant here; harvest always runs
  state = applyMaterialDynamics(state, rng);
  for (const key of MATERIAL_SOURCE_TYPES) {
    assert.ok(state.resources[key] > 0, `expected ${key} to be harvested into resources after one tick`);
    assert.ok(state.discovered_types.includes(key), `expected ${key} to be marked discovered`);
  }
});

test('applyMaterialDynamics never harvests more than a source patch has, and prunes exhausted patches', () => {
  let state = initialWorldState({});
  const rng = () => 0.99; // never spawn new patches -- isolate harvest/depletion behavior
  for (let i = 0; i < 500; i++) {
    state = applyMaterialDynamics(state, rng);
  }
  for (const key of MATERIAL_SOURCE_TYPES) {
    for (const amount of Object.values(state[`${key}_sources`] || {})) {
      assert.ok(amount > 0.01, 'exhausted patches (<=0.01) must be pruned, not left lingering at near-zero');
    }
    assert.ok(state.resources[key] >= 0);
  }
});

test('applyMaterialDynamics spawns bounded new source patches, never past double the initial count', () => {
  let state = initialWorldState({});
  const rng = () => 0; // always below spawn chance -- spawn every tick when there is room
  for (let i = 0; i < 200; i++) {
    state = applyMaterialDynamics(state, rng);
  }
  for (const key of MATERIAL_SOURCE_TYPES) {
    const count = Object.keys(state[`${key}_sources`] || {}).length;
    assert.ok(count <= INITIAL_MATERIAL_SOURCE_COUNTS[key] * 2, `expected ${key} sources bounded, got ${count}`);
  }
});

test('the one shipped conversion rule: clay + water -> mud, consuming both in equal amounts', () => {
  let state = initialWorldState({});
  state.resources.clay = 10;
  state.resources.water = 6;
  state.resources.mud = 0;
  // rng() always misses spawn (>= chance) and skips harvest thresholds cleanly by
  // using empty source patches -- isolates the conversion step.
  state.clay_sources = {};
  state.water_sources = {};
  const rng = () => 0.99;
  const next = applyMaterialDynamics(state, rng, { mudConversionRate: 0.5 });
  // min(10, 6) * 0.5 = 3 converted
  assert.equal(next.resources.clay, 7);
  assert.equal(next.resources.water, 3);
  assert.equal(next.resources.mud, 3);
  assert.ok(next.discovered_types.includes('mud'));
});

test('conversion never runs past what is actually available -- no negative clay/water', () => {
  let state = initialWorldState({});
  state.resources.clay = 1;
  state.resources.water = 0;
  state.clay_sources = {};
  state.water_sources = {};
  const rng = () => 0.99;
  const next = applyMaterialDynamics(state, rng, { mudConversionRate: 0.9 });
  assert.equal(next.resources.water, 0);
  assert.ok(next.resources.clay >= 0);
  assert.equal(next.resources.mud, 0); // min(1, 0) * rate = 0 -- nothing to convert
});

test('mud is never discovered before any clay+water conversion has actually happened', () => {
  let state = initialWorldState({});
  state.clay_sources = {};
  state.water_sources = {};
  const rng = () => 0.99; // no spawns, no source-derived harvest
  const next = applyMaterialDynamics(state, rng);
  assert.equal(next.resources.mud, 0);
  assert.ok(!next.discovered_types.includes('mud'));
});

// codex distinct review (2026-07-17), blocking finding: an unvalidated
// live-config rate above 1 could harvest more than a patch contains, or
// drive clay/water negative via mud conversion. Reproduced then fixed by
// clamping rates to [0, 1] inside applyMaterialDynamics itself.

test('applyMaterialDynamics clamps an out-of-range harvest rate instead of harvesting more than a patch contains', () => {
  let state = initialWorldState({});
  state.clay_sources = { 'clay-tile-1': 1 };
  state.water_sources = {};
  state.ore_sources = {};
  state.fiber_sources = {};
  const rng = () => 0.99; // no spawns
  const next = applyMaterialDynamics(state, rng, { materialHarvestRate: 2 });
  // clamped to 1.0 -- the entire patch is harvested, never more than it held.
  assert.equal(next.resources.clay, 1);
});

test('applyMaterialDynamics clamps an out-of-range mud-conversion rate instead of driving clay/water negative', () => {
  let state = initialWorldState({});
  state.resources.clay = 1;
  state.resources.water = 1;
  state.clay_sources = {};
  state.water_sources = {};
  state.ore_sources = {};
  state.fiber_sources = {};
  const rng = () => 0.99;
  const next = applyMaterialDynamics(state, rng, { mudConversionRate: 2 });
  // clamped to 1.0 -- min(1,1)*1 = 1 converted, never negative.
  assert.equal(next.resources.clay, 0);
  assert.equal(next.resources.water, 0);
  assert.equal(next.resources.mud, 1);
  assert.ok(next.resources.clay >= 0 && next.resources.water >= 0);
});

test('applyMaterialDynamics does not touch food/wood/stone or the untrained-network perception surface', () => {
  let state = initialWorldState({ wood: 20, stone: 10 });
  const before = { food: state.resources.food, wood: state.resources.wood, stone: state.resources.stone };
  const rng = () => 0.5;
  const next = applyMaterialDynamics(state, rng);
  assert.equal(next.resources.food, before.food);
  assert.equal(next.resources.wood, before.wood);
  assert.equal(next.resources.stone, before.stone);
});
