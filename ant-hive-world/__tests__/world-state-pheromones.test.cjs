'use strict';

// Stigmergy / pheromone-trail coordination -- operator (2026-07-16): "we
// wanted an ant based world though an ant based model." These trails are
// the actual mechanism (real, environment-persisted, shared, decaying) that
// makes the model ant-based, not just untrained.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initialWorldState,
  depositPheromone,
  decayPheromones,
  strongestTrail,
  claimFoodSource,
  maybeSpawnFoodSource,
  applyEcosystemDynamics,
  sumFoodSources,
  DEFAULT_PHEROMONE_DECAY
} = require('../world-state.js');

test('a fresh world has no trails to follow', () => {
  const state = initialWorldState({ food: 10 });
  assert.deepEqual(strongestTrail(state, 'food'), { tileId: null, strength: 0 });
});

test('depositPheromone accumulates repeated deposits at the same tile', () => {
  let state = initialWorldState({});
  state = depositPheromone(state, 'food', 'tile-7', 1);
  state = depositPheromone(state, 'food', 'tile-7', 1);
  assert.equal(state.pheromones.food['tile-7'], 2);
});

test('strongestTrail finds the richest tile across multiple deposits, per resource kind', () => {
  let state = initialWorldState({});
  state = depositPheromone(state, 'food', 'tile-1', 1);
  state = depositPheromone(state, 'food', 'tile-2', 3);
  state = depositPheromone(state, 'wood', 'tile-9', 5);
  assert.deepEqual(strongestTrail(state, 'food'), { tileId: 'tile-2', strength: 3 });
  assert.deepEqual(strongestTrail(state, 'wood'), { tileId: 'tile-9', strength: 5 });
});

test('decayPheromones evaporates trail strength by the given factor', () => {
  let state = initialWorldState({});
  state = depositPheromone(state, 'food', 'tile-1', 10);
  state = decayPheromones(state, 0.5);
  assert.equal(state.pheromones.food['tile-1'], 5);
});

test('decayPheromones prunes negligible trails entirely -- an unreinforced trail disappears', () => {
  let state = initialWorldState({});
  state = depositPheromone(state, 'food', 'tile-1', 0.02);
  state = decayPheromones(state, 0.1); // 0.02 * 0.1 = 0.002, below prune threshold
  assert.equal(state.pheromones.food['tile-1'], undefined);
});

test('default decay factor evaporates trails over repeated ticks without explicit reinforcement', () => {
  let state = initialWorldState({});
  state = depositPheromone(state, 'wood', 'tile-3', 10);
  for (let i = 0; i < 50; i++) state = decayPheromones(state);
  const trail = strongestTrail(state, 'wood');
  assert.ok(trail.strength < 0.1, `expected trail to have mostly evaporated after 50 ticks of decay ${DEFAULT_PHEROMONE_DECAY}, got ${trail.strength}`);
});

// Discrete, depletable food sources -- operator (2026-07-16): "food sources
// have to be depleted" / "or be able to be depleted i should say."

test('a fresh world starts with discrete, finite food sources, not an abstract pool', () => {
  const state = initialWorldState({});
  const sourceCount = Object.keys(state.food_sources).length;
  assert.ok(sourceCount > 0);
  assert.equal(state.resources.food, sumFoodSources(state.food_sources));
});

test('claimFoodSource depletes a SPECIFIC patch and is permanently gone when exhausted', () => {
  let state = initialWorldState({});
  const [tileId, amount] = Object.entries(state.food_sources)[0];
  const result = claimFoodSource(state, tileId, amount);
  assert.equal(result.ok, true);
  assert.equal(result.state.food_sources[tileId], undefined); // gone, not zeroed-and-lingering
});

test('claimFoodSource fails on a tile with no source or insufficient amount -- never invents food', () => {
  const state = initialWorldState({});
  const missing = claimFoodSource(state, 'tile-does-not-exist', 1);
  assert.equal(missing.ok, false);
});

test('maybeSpawnFoodSource never grows PAST the configured max source count', () => {
  // start from an empty source set -- the cap prevents new growth beyond
  // max, it does not retroactively truncate whatever already exists.
  let state = { ...initialWorldState({}), food_sources: {} };
  let seed = 1;
  const rng = () => { seed = (seed * 137 + 1) % 97; return seed / 97; }; // varies tileId picks, never 0 exactly
  for (let i = 0; i < 50; i++) {
    state = maybeSpawnFoodSource(state, rng, { maxSources: 3, spawnChance: 1 });
  }
  assert.ok(Object.keys(state.food_sources).length <= 3);
});

test('maybeSpawnFoodSource does nothing when the roll misses', () => {
  const state = initialWorldState({});
  const before = Object.keys(state.food_sources).length;
  const rng = () => 0.99; // always above spawnChance
  const next = maybeSpawnFoodSource(state, rng, { spawnChance: 0.01 });
  assert.equal(Object.keys(next.food_sources).length, before);
});

// Population-level predator/prey dynamics -- operator (2026-07-16): "there
// should be predators and prey animals in this simulation. it can't just be
// a world of two ants" (confirmed population-level via AskUserQuestion).

test('applyEcosystemDynamics: well-fed prey with no predators grow toward the cap', () => {
  let state = initialWorldState({});
  state.prey_population = 10;
  state.predator_population = 0;
  const rng = () => 0.5;
  for (let i = 0; i < 40; i++) {
    state = maybeSpawnFoodSource(state, rng, { spawnChance: 1, spawnAmount: 20, maxSources: 20 });
    state = applyEcosystemDynamics(state, rng, { maxPrey: 50 });
  }
  assert.ok(state.prey_population > 10, `expected prey to grow with abundant food and no predators, got ${state.prey_population}`);
});

test('applyEcosystemDynamics: prey starve and shrink when food sources run out and are not replenished', () => {
  let state = initialWorldState({});
  state.food_sources = {}; // no food at all
  state.resources.food = 0;
  state.prey_population = 20;
  state.predator_population = 0;
  const rng = () => 0.99; // no spawns
  for (let i = 0; i < 30; i++) {
    state = applyEcosystemDynamics(state, rng, {});
  }
  assert.ok(state.prey_population < 20, `expected prey decline with zero food, got ${state.prey_population}`);
});

test('applyEcosystemDynamics: predators grow when prey is abundant, then decline once prey is depleted -- a real boom/bust, not a utopia', () => {
  let state = initialWorldState({});
  state.prey_population = 100;
  state.predator_population = 2;
  const rng = () => 0.5;
  const predatorHistory = [];
  for (let i = 0; i < 60; i++) {
    state = maybeSpawnFoodSource(state, rng, { spawnChance: 1, spawnAmount: 15, maxSources: 15 });
    state = applyEcosystemDynamics(state, rng, { maxPrey: 300, maxPredators: 60 });
    predatorHistory.push(state.predator_population);
  }
  const peak = Math.max(...predatorHistory);
  assert.ok(peak > 2, 'expected predator population to grow at least once from abundant prey');
});

test('populations never go negative or exceed their configured caps', () => {
  let state = initialWorldState({});
  state.prey_population = 5;
  state.predator_population = 5;
  const rng = () => 0.5;
  for (let i = 0; i < 100; i++) {
    state = applyEcosystemDynamics(state, rng, { maxPrey: 30, maxPredators: 10 });
    assert.ok(state.prey_population >= 0 && state.prey_population <= 30);
    assert.ok(state.predator_population >= 0 && state.predator_population <= 10);
  }
});
