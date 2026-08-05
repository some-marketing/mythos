#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/world-state.js — the SHARED, resource-scarce environment
// both hives read from and write to. Confirmed mechanism (operator, 2026-07-16,
// "yes"): a shared world-state file, contested resources as finite entries.
//
// Uses a tear-free envelope (schema_version, monotonic seq, complete,
// atomic temp+rename) so the write-side discipline is a proven pattern, not
// reinvented. The richer payload here (resources/territory/geometry per
// hive) is deliberately just the Node-side write/read discipline; a
// visualization layer is a separate, optional concern.
//
// ISOLATION: this file and its state live entirely under
// tools/ant-hive-world/ and a caller-supplied state path -- no import of, or
// shared module with, any other simulation project's harness code.

const fs = require('fs');
const path = require('path');

// 1.1.0 (plan ant-world-mind-learning-path, S1b): ADDITIVE only -- the shared
// world-state may now carry a `hives` summary, `{ count, starvation_pressure }`,
// written by the driver's world block from the per-hive state it already holds
// in memory. Every 1.0.0 field keeps its meaning and its type, so a 1.0.0 reader
// that ignores unknown keys reads a 1.1.0 file correctly; the version moves
// because a consumer that WANTS the summary needs a way to know whether its
// absence means "old file" or "no hives".
//
// WHY THE SUMMARY AND NOT THE PER-HIVE STATES: the hive states live in their own
// per-hive files behind their own isolation boundary, and copying them into the
// shared file would put one hive's internals in the other hive's read path. The
// summary is the two aggregate numbers the world mind's encoder actually reads
// (see world-mind.js encodeWorldState coordinates 4 and 7) and nothing else.
const SCHEMA_VERSION = '1.1.0';

// Derive the shared world-state's `hives` summary from per-hive states.
// `starvation_pressure` is a COUNT of starving hives (not a ratio), because
// that count is what the encoder normalizes with normalizeWorldResource. A
// hive is starving when its per-hive stockpile is present and its FOOD
// component is at or below zero (D-COORD7-DEAD: the live stockpile shape is
// { food, wood }, an object, not a scalar -- treating it as a bare scalar
// makes `stock <= 0` structurally always false).
// Pure: reads only the object it is handed, touches no file.
function summarizeHives(hiveStates) {
  const ids = Object.keys(hiveStates || {});
  let starving = 0;
  for (const id of ids) {
    const entry = hiveStates[id];
    // Accepts either the per-hive state object ({ hive_state: { stockpile } })
    // or an already-unwrapped hive_state, since run-live holds the first and
    // checkpoint.js holds the second.
    const inner = entry && entry.hive_state ? entry.hive_state : entry;
    const stock = inner && inner.stockpile;
    // Bug fix (D-COORD7-DEAD): stockpile is an object ({ food, wood }), not a
    // scalar -- `stock <= 0` was structurally always false, so
    // starvation_pressure never left 0. A hive is starving when its FOOD
    // stockpile is at or below zero.
    if (stock && typeof stock.food === 'number' && stock.food <= 0) starving += 1;
  }
  return { count: ids.length, starvation_pressure: starving };
}

function readWorldState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.complete !== true) return null;
    return parsed;
  } catch {
    return null; // no state yet, or a torn/partial read -- caller falls back to last-good
  }
}

// Discrete food sources -- operator (2026-07-16): "food sources have to be
// depleted." Food is no longer one abstract shared number; it lives in
// distinct patches at tiles, each with a finite amount. A patch a hive (or
// prey) finishes off is GONE, not silently refilled -- new patches spawn
// elsewhere over time (maybeSpawnFoodSource), same as real forage appearing
// in a new spot rather than the same exhausted one recovering.
const INITIAL_FOOD_SOURCE_COUNT = 5;
const INITIAL_FOOD_SOURCE_AMOUNT = 8;
// Spatial geometry (operator 2026-08-03, three-sided experiment gate):
// tile-N labels map onto a 10x10 grid so the world has real coordinates a
// mirror detector can correlate against. Pure helpers -- no behavior change
// to existing tile semantics.
const TILE_GRID_SIZE = 10;
function tileToCoords(tileId) {
  const m = /(?:^|-)(\d+)$/.exec(String(tileId));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return [n % TILE_GRID_SIZE, Math.floor(n / TILE_GRID_SIZE), 0];
}
function coordsToTile(x, y) {
  return `tile-${y * TILE_GRID_SIZE + x}`;
}
function parseTileIndex(tileId) {
  const m = /(?:^|-)(\d+)$/.exec(String(tileId));
  return m ? parseInt(m[1], 10) : null;
}

function seedFoodSources(count, amount) {
  const sources = {};
  for (let i = 0; i < count; i++) {
    sources[`tile-${(i * 17) % 100}`] = amount;
  }
  return sources;
}

// S2 (spatial geometry, operator 2026-08-03 three-sided experiment gate):
// give each discrete food source an EXPLICIT world coordinate so the mirror
// detector can correlate build positions against real resource positions
// instead of label-only tiles. The food_sources map keeps its `tile-N: amount`
// shape (sumFoodSources / claimFoodSource / depleteFoodSourcesTotal all depend
// on it); the coordinates live in a parallel map keyed by the same tileId.
// Tile labels that do not resolve to grid coords are omitted — no invented
// positions. Deterministic, pure, no behavior change to existing consumers.
function foodSourceCoords(foodSources) {
  const coords = {};
  for (const tileId of Object.keys(foodSources || {})) {
    const c = tileToCoords(tileId);
    if (c) coords[tileId] = c;
  }
  return coords;
}

function sumFoodSources(foodSources) {
  return Object.values(foodSources || {}).reduce((a, b) => a + b, 0);
}

// plan ant-hive-world-richer-resource-model, S1: additional depletable
// materials beyond food/wood/stone. These are deliberately SCRIPTED,
// ENVIRONMENTAL processes (same category as ecosystem dynamics / food-source
// spawn below), NOT a new hive-mind gather target -- untrained-network.js's
// decide()/encodeState() are untouched by this plan (see the plan's S0
// scoping memo for the coordination-risk reasoning against the sibling
// hiveb-collapse plan). Each material accumulates in the SHARED resources
// pool via its own depletable sources, exactly parallel to how `food` is
// already shared-pool-derived from `food_sources` -- not per-hive
// stockpile-credited, since no hive decision drives their discovery.
const MATERIAL_SOURCE_TYPES = ['clay', 'water', 'ore', 'fiber'];
const INITIAL_MATERIAL_SOURCE_COUNTS = { clay: 4, water: 4, ore: 2, fiber: 3 };
const INITIAL_MATERIAL_SOURCE_AMOUNTS = { clay: 6, water: 6, ore: 3, fiber: 4 };

function seedMaterialSources(materialKey, count, amount, offset) {
  const sources = {};
  for (let i = 0; i < count; i++) {
    sources[`${materialKey}-tile-${(i * 13 + offset) % 100}`] = amount;
  }
  return sources;
}

function initialWorldState(resourcePool) {
  const foodSources = seedFoodSources(INITIAL_FOOD_SOURCE_COUNT, INITIAL_FOOD_SOURCE_AMOUNT);
  const materialSources = {};
  const materialResources = {};
  // Materials start UNDISCOVERED: the source patches exist in the world from
  // tick 0, but resources[key] starts at 0 -- applyMaterialDynamics's per-tick
  // harvest is what gradually moves supply from a source patch into the
  // shared pool (the actual "discovery" event), same as the real world not
  // handing a colony a stockpile of a material it hasn't found yet.
  MATERIAL_SOURCE_TYPES.forEach((key, i) => {
    const sources = seedMaterialSources(
      key,
      INITIAL_MATERIAL_SOURCE_COUNTS[key],
      INITIAL_MATERIAL_SOURCE_AMOUNTS[key],
      i * 7
    );
    materialSources[`${key}_sources`] = sources;
    materialResources[key] = 0;
  });
  return {
    schema_version: SCHEMA_VERSION,
    seq: 0,
    written_at: null,
    writer: 'ant-hive-world/world-state',
    complete: true,
    resources: { ...(resourcePool || {}), ...materialResources, mud: 0, food: sumFoodSources(foodSources) },
    food_sources: foodSources,
    food_source_coords: foodSourceCoords(foodSources),
    ...materialSources,
    discovered_types: ['food', 'wood', 'stone'],
    // Population-level predator/prey dynamics -- operator (2026-07-16):
    // "there should be predators and prey animals in this simulation. it
    // can't just be a world of two ants." Scripted/non-mind numeric
    // populations (same category as pheromone decay/food spawn), not
    // individually pathed creatures -- confirmed via AskUserQuestion.
    prey_population: 10,
    predator_population: 3,
    territory: {},
    geometry_log: [],
    pheromones: {}
  };
}

// Atomic write: temp file + rename, same discipline as poke-world.js, so a
// reader (this module or, eventually, a separate visualization layer)
// never sees a torn file.
function writeWorldState(statePath, state) {
  const next = {
    ...state,
    schema_version: SCHEMA_VERSION,
    seq: (state.seq || 0) + 1,
    written_at: new Date().toISOString(),
    complete: true
  };
  const tmp = statePath + '.tmp';
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, statePath);
  return next;
}

// Claim a finite resource entry. Returns { ok, state } -- ok is false if the
// resource doesn't exist or has no quantity left; this is the actual
// contention mechanism both hives compete over.
function claimResource(state, resourceKey, amount) {
  const pool = state.resources || {};
  const have = pool[resourceKey] || 0;
  if (have < amount) return { ok: false, state };
  const nextResources = { ...pool, [resourceKey]: have - amount };
  return { ok: true, state: { ...state, resources: nextResources } };
}

// Append a geometry entry a hive has built. This is the "actual world
// geometry" G-WORLD-BUILD requires -- structured data, not narrative text.
function appendGeometry(state, entry) {
  const log = Array.isArray(state.geometry_log) ? state.geometry_log : [];
  return { ...state, geometry_log: [...log, entry] };
}

// Claim territory. A territory tile already claimed by the OTHER hive is a
// genuine contested-resource event -- this is where circumstance-driven
// tension (not scripted rivalry) actually surfaces.
function claimTerritory(state, tileId, hiveIdentity) {
  const territory = state.territory || {};
  const existing = territory[tileId];
  if (existing && existing !== hiveIdentity) {
    return { ok: false, contested_by: existing, state };
  }
  return { ok: true, state: { ...state, territory: { ...territory, [tileId]: hiveIdentity } } };
}

// Pheromone trails -- operator (2026-07-16): "we wanted an ant based world
// though an ant based model" -> stigmergy/pheromone-trail coordination.
// A hive-mind's foraging decisions are mediated through indirect,
// environment-persisted signals (like real ant trails), not a private
// memory or a direct message to the other hive. Both hives read and can
// reinforce the SAME shared trail field -- this is also the honest
// mechanism for circumstance-driven contention (a hive following the
// other's rich trail to the same tile), never scripted rivalry.
const DEFAULT_PHEROMONE_DECAY = 0.9;
const PHEROMONE_PRUNE_THRESHOLD = 0.01;

// Deposit (reinforce) a trail of `kind` (e.g. 'food', 'wood') at `tileId`.
// Repeated deposits at the same tile accumulate -- a well-worked spot
// carries a stronger signal, same as a heavily-walked real ant trail.
function depositPheromone(state, kind, tileId, amount) {
  const trails = state.pheromones || {};
  const kindTrails = { ...(trails[kind] || {}) };
  kindTrails[tileId] = (kindTrails[tileId] || 0) + amount;
  return { ...state, pheromones: { ...trails, [kind]: kindTrails } };
}

// Evaporate all trails by `factor` (default 0.9 per call). Trails below the
// prune threshold are dropped entirely -- an unreinforced trail eventually
// disappears, same as a real one; this is what keeps trail-following an
// ongoing, reinforced signal rather than a permanent scripted waypoint.
function decayPheromones(state, factor) {
  const decay = factor === undefined ? DEFAULT_PHEROMONE_DECAY : factor;
  const trails = state.pheromones || {};
  const nextTrails = {};
  for (const kind of Object.keys(trails)) {
    const kindTrails = trails[kind] || {};
    const nextKindTrails = {};
    for (const [tileId, strength] of Object.entries(kindTrails)) {
      const decayed = strength * decay;
      if (decayed > PHEROMONE_PRUNE_THRESHOLD) nextKindTrails[tileId] = decayed;
    }
    nextTrails[kind] = nextKindTrails;
  }
  return { ...state, pheromones: nextTrails };
}

// The strongest currently-sensed trail of `kind` -- what a foraging mind
// would actually perceive: is there a rich, recently-reinforced spot out
// there, and where. Returns { tileId: null, strength: 0 } when no trail
// exists yet (nothing to follow -- must explore instead).
function strongestTrail(state, kind) {
  const kindTrails = (state.pheromones && state.pheromones[kind]) || {};
  let bestTile = null;
  let bestStrength = 0;
  for (const [tileId, strength] of Object.entries(kindTrails)) {
    if (strength > bestStrength) {
      bestStrength = strength;
      bestTile = tileId;
    }
  }
  return { tileId: bestTile, strength: bestStrength };
}

// Deplete a specific food source patch. Fails if the patch doesn't exist
// or has less than requested -- this is real, local, permanent depletion
// (operator: "food sources have to be depleted" / "or be able to be
// depleted i should say"), not a shared abstract number ticking down.
function claimFoodSource(state, tileId, amount) {
  const sources = state.food_sources || {};
  const have = sources[tileId] || 0;
  if (have < amount) return { ok: false, state };
  const nextSources = { ...sources };
  const remaining = have - amount;
  if (remaining <= 0.0001) delete nextSources[tileId];
  else nextSources[tileId] = remaining;
  return {
    ok: true,
    state: { ...state, food_sources: nextSources, resources: { ...state.resources, food: sumFoodSources(nextSources) } }
  };
}

// New forage appearing over time, bounded -- an exhausted patch does NOT
// come back; a DIFFERENT patch may appear elsewhere. Deliberately not
// generous: this is a pressure valve against total permanent extinction of
// food, not a guarantee of comfortable abundance (operator: "pressures
// similar to our world's physics must exist it cannot just be a utopia").
const DEFAULT_FOOD_SOURCE_SPAWN_CHANCE = 0.04;
const DEFAULT_FOOD_SOURCE_SPAWN_AMOUNT = 6;
const DEFAULT_MAX_FOOD_SOURCES = 7;

function maybeSpawnFoodSource(state, rng, opts = {}) {
  const chance = opts.spawnChance === undefined ? DEFAULT_FOOD_SOURCE_SPAWN_CHANCE : opts.spawnChance;
  const amount = opts.spawnAmount === undefined ? DEFAULT_FOOD_SOURCE_SPAWN_AMOUNT : opts.spawnAmount;
  const max = opts.maxSources === undefined ? DEFAULT_MAX_FOOD_SOURCES : opts.maxSources;
  const sources = state.food_sources || {};
  if (Object.keys(sources).length >= max) return state;
  if (rng() >= chance) return state;
  const tileId = `tile-${Math.floor(rng() * 100)}`;
  if (sources[tileId]) return state; // already occupied this roll -- try again next tick
  const nextSources = { ...sources, [tileId]: amount };
  return { ...state, food_sources: nextSources, resources: { ...state.resources, food: sumFoodSources(nextSources) } };
}

// Spread a total consumption amount across existing patches (largest-first,
// so grazing pressure doesn't wipe out many small patches at once) --
// returns the updated { food_sources } shape, never negative, never
// inventing food that isn't there.
function depleteFoodSourcesTotal(foodSources, totalAmount) {
  let remaining = totalAmount;
  const next = { ...foodSources };
  const ordered = Object.entries(next).sort((a, b) => b[1] - a[1]);
  for (const [tileId, amount] of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(amount, remaining);
    const left = amount - take;
    if (left <= 0.0001) delete next[tileId];
    else next[tileId] = left;
    remaining -= take;
  }
  return next;
}

// Population-level predator/prey dynamics (operator, 2026-07-16: "there
// should be predators and prey animals in this simulation. it can't just
// be a world of two ants" -- confirmed as population-level, not individual
// creatures, via AskUserQuestion). Scripted/non-mind environmental process,
// same category as pheromone decay: prey graze the SAME food sources the
// hives forage from (real competition, not flavor text), predators cull
// prey, both populations are bounded and can genuinely crash -- this is
// meant to be a real pressure, not a self-correcting utopia.
const DEFAULT_PREY_GROWTH_RATE = 0.05;    // per tick, scaled by how well-fed prey were this tick
const DEFAULT_PREY_GRAZE_RATE = 0.4;      // food consumed per unit of prey population per tick
const DEFAULT_PREDATION_RATE = 0.02;      // fraction of prey caught per unit predator population per tick
const DEFAULT_PREDATOR_GROWTH_RATE = 0.15; // predator growth per unit of prey successfully caught
const DEFAULT_PREDATOR_DEATH_RATE = 0.08;  // baseline predator die-off when prey is scarce
const DEFAULT_MAX_PREY = 200;
const DEFAULT_MAX_PREDATORS = 40;

function applyEcosystemDynamics(state, rng, opts = {}) {
  const preyGrowthRate = opts.preyGrowthRate === undefined ? DEFAULT_PREY_GROWTH_RATE : opts.preyGrowthRate;
  const preyGrazeRate = opts.preyGrazeRate === undefined ? DEFAULT_PREY_GRAZE_RATE : opts.preyGrazeRate;
  const predationRate = opts.predationRate === undefined ? DEFAULT_PREDATION_RATE : opts.predationRate;
  const predatorGrowthRate = opts.predatorGrowthRate === undefined ? DEFAULT_PREDATOR_GROWTH_RATE : opts.predatorGrowthRate;
  const predatorDeathRate = opts.predatorDeathRate === undefined ? DEFAULT_PREDATOR_DEATH_RATE : opts.predatorDeathRate;
  const maxPrey = opts.maxPrey === undefined ? DEFAULT_MAX_PREY : opts.maxPrey;
  const maxPredators = opts.maxPredators === undefined ? DEFAULT_MAX_PREDATORS : opts.maxPredators;

  let prey = state.prey_population || 0;
  let predators = state.predator_population || 0;
  const totalFoodBefore = sumFoodSources(state.food_sources);

  // Prey graze on the SAME depletable food sources the hives forage from --
  // real competition, bounded by what's actually there.
  const desiredGraze = prey * preyGrazeRate;
  const actualGraze = Math.min(desiredGraze, totalFoodBefore);
  const grazedSources = depleteFoodSourcesTotal(state.food_sources || {}, actualGraze);
  const foodSufficiency = desiredGraze > 0 ? actualGraze / desiredGraze : (totalFoodBefore > 0 ? 1 : 0);

  // growthFactor ranges -1 (totally starved) to +1 (fully fed) -- scarcity
  // must be able to actively shrink the population, not just halt its
  // growth (operator: "pressures similar to our world's physics must exist
  // it cannot just be a utopia").
  const growthFactor = 2 * foodSufficiency - 1;
  const predated = Math.min(prey, predationRate * prey * predators);
  let nextPrey = prey + prey * preyGrowthRate * growthFactor - predated;
  nextPrey = Math.max(0, Math.min(maxPrey, nextPrey));

  const wellFedPredators = predated > 0.01;
  let nextPredators = predators + predatorGrowthRate * predated - predatorDeathRate * predators * (wellFedPredators ? 0.3 : 1);
  nextPredators = Math.max(0, Math.min(maxPredators, nextPredators));

  return {
    ...state,
    food_sources: grazedSources,
    resources: { ...state.resources, food: sumFoodSources(grazedSources) },
    prey_population: nextPrey,
    predator_population: nextPredators
  };
}

// Scripted per-tick process for the new materials (plan
// ant-hive-world-richer-resource-model, S1): spawn new source patches
// (mirroring maybeSpawnFoodSource's exact pattern, parametrized by
// material), passively deplete a small amount into the shared resources
// pool each tick (the "discovery" event), update discovered_types the
// first time a material's resources value goes above zero, and run the
// one conversion rule (clay + water -> mud) when both are available.
// Entirely environmental/scripted -- no hive-mind decision drives this,
// matching applyEcosystemDynamics's existing category, not the gather verb.
const DEFAULT_MATERIAL_SPAWN_CHANCE = 0.03;
const DEFAULT_MATERIAL_HARVEST_RATE = 0.15; // fraction of remaining source amount harvested into shared pool per tick
const DEFAULT_MUD_CONVERSION_RATE = 0.2; // fraction of min(clay, water) converted to mud per tick

// Clamp a rate/probability input to [0, 1] -- codex distinct review
// (2026-07-17) found that an unvalidated live-config value above 1 (e.g. a
// harvest rate of 2, or a mud-conversion rate of 2) harvests more than a
// source patch actually contains, or drives clay/water negative. live-
// config.js/dashboard.js only enforce HTML input bounds, which are
// trivially bypassed by editing the JSON file or POSTing directly, so the
// real validation boundary must live here, not at the UI layer.
function clampRate(value, fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, n));
}

function applyMaterialDynamics(state, rng, opts = {}) {
  const spawnChance = clampRate(opts.materialSpawnChance === undefined ? DEFAULT_MATERIAL_SPAWN_CHANCE : opts.materialSpawnChance, DEFAULT_MATERIAL_SPAWN_CHANCE);
  const harvestRate = clampRate(opts.materialHarvestRate === undefined ? DEFAULT_MATERIAL_HARVEST_RATE : opts.materialHarvestRate, DEFAULT_MATERIAL_HARVEST_RATE);
  const mudConversionRate = clampRate(opts.mudConversionRate === undefined ? DEFAULT_MUD_CONVERSION_RATE : opts.mudConversionRate, DEFAULT_MUD_CONVERSION_RATE);

  let next = { ...state };
  const resources = { ...(next.resources || {}) };
  const discovered = new Set(next.discovered_types || []);

  for (const key of MATERIAL_SOURCE_TYPES) {
    const sourceField = `${key}_sources`;
    let sources = { ...(next[sourceField] || {}) };

    // Maybe spawn a new patch (bounded, same shape as maybeSpawnFoodSource).
    const maxSources = INITIAL_MATERIAL_SOURCE_COUNTS[key] * 2;
    if (Object.keys(sources).length < maxSources && rng() < spawnChance) {
      const tileId = `${key}-tile-${Math.floor(rng() * 100)}`;
      if (!sources[tileId]) {
        sources[tileId] = INITIAL_MATERIAL_SOURCE_AMOUNTS[key];
      }
    }

    // Passively harvest a fraction of remaining supply into the shared pool --
    // this IS the "discovery" event; a material with zero sources contributes nothing.
    let harvested = 0;
    const nextSources = {};
    for (const [tileId, amount] of Object.entries(sources)) {
      const take = amount * harvestRate;
      const remaining = amount - take;
      harvested += take;
      if (remaining > 0.01) nextSources[tileId] = remaining;
    }
    sources = nextSources;

    resources[key] = (resources[key] || 0) + harvested;
    next[sourceField] = sources;

    if (resources[key] > 0.0001 && !discovered.has(key)) {
      discovered.add(key);
    }
  }

  // The one conversion rule this plan ships: clay + water -> mud.
  const clay = resources.clay || 0;
  const water = resources.water || 0;
  const convertible = Math.min(clay, water) * mudConversionRate;
  if (convertible > 0.0001) {
    resources.clay = clay - convertible;
    resources.water = water - convertible;
    resources.mud = (resources.mud || 0) + convertible;
    if (resources.mud > 0.0001 && !discovered.has('mud')) discovered.add('mud');
  }

  next.resources = resources;
  next.discovered_types = Array.from(discovered);
  return next;
}

module.exports = {
  SCHEMA_VERSION,
  MATERIAL_SOURCE_TYPES,
  INITIAL_MATERIAL_SOURCE_COUNTS,
  INITIAL_MATERIAL_SOURCE_AMOUNTS,
  DEFAULT_MATERIAL_SPAWN_CHANCE,
  DEFAULT_MATERIAL_HARVEST_RATE,
  DEFAULT_MUD_CONVERSION_RATE,
  applyMaterialDynamics,
  DEFAULT_PHEROMONE_DECAY,
  TILE_GRID_SIZE,
  tileToCoords,
  coordsToTile,
  parseTileIndex,
  INITIAL_FOOD_SOURCE_COUNT,
  INITIAL_FOOD_SOURCE_AMOUNT,
  DEFAULT_FOOD_SOURCE_SPAWN_CHANCE,
  DEFAULT_FOOD_SOURCE_SPAWN_AMOUNT,
  DEFAULT_MAX_FOOD_SOURCES,
  DEFAULT_PREY_GROWTH_RATE,
  DEFAULT_PREY_GRAZE_RATE,
  DEFAULT_PREDATION_RATE,
  DEFAULT_PREDATOR_GROWTH_RATE,
  DEFAULT_PREDATOR_DEATH_RATE,
  DEFAULT_MAX_PREY,
  DEFAULT_MAX_PREDATORS,
  readWorldState,
  initialWorldState,
  writeWorldState,
  summarizeHives,
  foodSourceCoords,
  claimResource,
  appendGeometry,
  claimTerritory,
  depositPheromone,
  decayPheromones,
  strongestTrail,
  sumFoodSources,
  claimFoodSource,
  maybeSpawnFoodSource,
  depleteFoodSourcesTotal,
  applyEcosystemDynamics
};
