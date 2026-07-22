#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/harness.js — one decision loop PER HIVE, workers as
// dispatched subminds (operator, 2026-07-16: "each hive should be one mind
// and all the workers a submind because it's a hive").
//
// Each hive: own isolated sandbox directory (its hive-mind seed + audit log)
// + read/write access to ONE shared world-state file (the resource-scarce
// environment, tools/ant-hive-world/world-state.js). No pre-loaded instinct
// (operator: "let them figure it out through experience") -- the decideFn is
// injected, not hardcoded behavior; the default decideFn used in tests is a
// deliberately simple, non-authoritative placeholder, not a scripted colony
// strategy.
//
// ISOLATION: every path here is caller-supplied and scoped under a sandbox
// root this module creates -- no shared directory, module, or process with
// any other simulation project's harness code.

const fs = require('fs');
const path = require('path');
const {
  readWorldState,
  initialWorldState,
  writeWorldState,
  claimResource,
  claimFoodSource,
  appendGeometry,
  claimTerritory,
  depositPheromone,
  decayPheromones,
  maybeSpawnFoodSource,
  applyEcosystemDynamics,
  applyMaterialDynamics
} = require('./world-state.js');

// One verb set for this tier -- deliberately small, because there is no
// cross-mind negotiation primitive needed (there
// is only one hive-mind per hive; workers are dispatch state, not separate
// callers). Actions a hive's ONE decision loop can take per tick:
const VERBS = ['gather', 'build', 'claim-territory', 'idle'];

// BUILD_COST is an ENVIRONMENTAL rule, not something the mind chooses --
// same category as resource scarcity and territory contention. Without a
// real cost, 'build' was a free, unlimited-reward action with nothing
// connecting it to 'gather' -- discovered empirically (2026-07-16 smoke
// test: an untrained network converged to build-spam-while-starving,
// because nothing made gathering a PREREQUISITE for building). This makes
// gathering materials a genuine dependency for building, not just a
// separately-rewarded action.
const BUILD_COST = { wood: 2 };

// Pheromone deposit per successful gather -- operator (2026-07-16): "we
// wanted an ant based world though an ant based model." A gather deposits
// a trail at the tile it happened at (action.tileId, when the decideFn
// supplies one -- see untrained-network.js's trail-following gather
// choice); this is the stigmergic signal both hives can sense and follow.
// Decay runs every tick (not once per round) so a spot needs continuous
// reinforcement to stay marked -- an unattended trail evaporates.
const PHEROMONE_DEPOSIT = 1;

function ensureSandbox(sandboxRoot, identity) {
  const dir = path.join(sandboxRoot, identity);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    hiveStatePath: path.join(dir, 'hive-state.json'),
    auditLogPath: path.join(dir, 'audit-log.jsonl')
  };
}

function appendAudit(auditLogPath, event) {
  fs.appendFileSync(auditLogPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

// A single tick for ONE hive: sense -> decide -> apply -> log. `decideFn`
// receives { hiveState, worldState } and must return one of VERBS plus args;
// it is the only pluggable "mind" surface -- swap it for an LLM call
// (see llm-decide.js) or a deterministic test stub without touching this loop.
//
// `liveConfig` (optional) overrides the environmental constants below --
// operator (2026-07-16): "i need to be able to modify variables in this
// dashboard." Defaults match the fixed constants when omitted, so every
// existing caller/test is unaffected. `rng` (optional, defaults to
// Math.random) drives the ecosystem's stochastic processes (food-source
// spawn, grazing) -- injectable for deterministic tests.
function tick(hive, worldStatePath, decideFn, liveConfig = {}, rng = Math.random) {
  const buildCostWood = liveConfig.build_cost_wood ?? BUILD_COST.wood;
  const pheromoneDeposit = liveConfig.pheromone_deposit ?? PHEROMONE_DEPOSIT;
  const pheromoneDecay = liveConfig.pheromone_decay; // undefined -> world-state.js's own default

  const hiveState = JSON.parse(fs.readFileSync(hive.hiveStatePath, 'utf8'));
  let worldState = readWorldState(worldStatePath);
  if (!worldState) throw new Error('world-state.json missing or torn -- must be initialized before ticking');

  const action = decideFn({ hiveState, worldState });
  if (!VERBS.includes(action.verb)) {
    appendAudit(hive.auditLogPath, { event: 'rejected-verb', verb: action.verb });
    return { hiveState, worldState, applied: false };
  }

  let applied = false;
  let stockpileCredit = null;
  let stockpileDebit = null;
  const currentStockpile = hiveState.hive_state.stockpile || {};
  if (action.verb === 'gather') {
    // Food is depleted from a SPECIFIC discrete source (action.tileId);
    // wood/stone remain the simpler abstract shared-pool model -- food is
    // the perishable, spatially-located resource, raw material is not.
    const result = action.resourceKey === 'food'
      ? claimFoodSource(worldState, action.tileId, action.amount || 1)
      : claimResource(worldState, action.resourceKey, action.amount || 1);
    applied = result.ok;
    worldState = result.state;
    if (applied) {
      stockpileCredit = { resourceKey: action.resourceKey, amount: action.amount || 1 };
      if (action.tileId) {
        worldState = depositPheromone(worldState, action.resourceKey, action.tileId, pheromoneDeposit);
      }
    }
  } else if (action.verb === 'build') {
    const buildCost = { wood: buildCostWood };
    const canAfford = Object.entries(buildCost).every(([key, amt]) => (currentStockpile[key] || 0) >= amt);
    if (canAfford) {
      worldState = appendGeometry(worldState, { hive: hiveState.identity, ...action.entry, at: new Date().toISOString() });
      applied = true;
      stockpileDebit = buildCost;
    } else {
      appendAudit(hive.auditLogPath, { event: 'build-insufficient-materials', required: buildCost, have: currentStockpile });
    }
  } else if (action.verb === 'claim-territory') {
    const result = claimTerritory(worldState, action.tileId, hiveState.identity);
    applied = result.ok;
    worldState = result.state;
    if (!result.ok) {
      appendAudit(hive.auditLogPath, { event: 'territory-contested', tileId: action.tileId, contested_by: result.contested_by });
    }
  }
  // 'idle' applies nothing -- a genuine no-op is a real, loggable choice.

  const nextStockpile = { ...currentStockpile };
  if (stockpileCredit) {
    nextStockpile[stockpileCredit.resourceKey] = (nextStockpile[stockpileCredit.resourceKey] || 0) + stockpileCredit.amount;
  }
  if (stockpileDebit) {
    for (const [key, amt] of Object.entries(stockpileDebit)) {
      nextStockpile[key] = (nextStockpile[key] || 0) - amt;
    }
  }

  const nextHiveState = {
    ...hiveState,
    hive_state: {
      ...hiveState.hive_state,
      stockpile: nextStockpile,
      worker_dispatch_state: { ...hiveState.hive_state.worker_dispatch_state, last_action: action.verb, last_applied: applied }
    }
  };
  fs.writeFileSync(hive.hiveStatePath, JSON.stringify(nextHiveState, null, 2));
  worldState = decayPheromones(worldState, pheromoneDecay);
  worldState = maybeSpawnFoodSource(worldState, rng, {
    spawnChance: liveConfig.food_source_spawn_chance,
    spawnAmount: liveConfig.food_source_spawn_amount,
    maxSources: liveConfig.max_food_sources
  });
  worldState = applyEcosystemDynamics(worldState, rng, {
    preyGrowthRate: liveConfig.prey_growth_rate,
    preyGrazeRate: liveConfig.prey_graze_rate,
    predationRate: liveConfig.predation_rate,
    predatorGrowthRate: liveConfig.predator_growth_rate,
    predatorDeathRate: liveConfig.predator_death_rate,
    maxPrey: liveConfig.max_prey,
    maxPredators: liveConfig.max_predators
  });
  // codex distinct review (2026-07-17): the new materials (clay/water/ore/
  // fiber/mud) are discovered PASSIVELY by applyMaterialDynamics -- never
  // via the network's 'gather' verb, since the live network's action space
  // only ever gathers food/wood (untrained-network.js). Without an explicit
  // audit event here, the lore engine (which only detects discovery from a
  // successful 'gather' audit entry) can never narrate these discoveries
  // during an actual live run -- they'd only ever show up in hand-authored
  // unit tests. Diff discovered_types before/after and emit one audit event
  // per newly-discovered material, attributed to whichever hive's tick
  // happened to trigger the world-state advance this round.
  const discoveredBefore = new Set(worldState.discovered_types || []);
  worldState = applyMaterialDynamics(worldState, rng, {
    materialSpawnChance: liveConfig.material_spawn_chance,
    materialHarvestRate: liveConfig.material_harvest_rate,
    mudConversionRate: liveConfig.mud_conversion_rate
  });
  const newlyDiscovered = (worldState.discovered_types || []).filter((t) => !discoveredBefore.has(t));

  const nextWorldState = writeWorldState(worldStatePath, worldState);
  appendAudit(hive.auditLogPath, { event: 'tick', verb: action.verb, applied, stockpile_credit: stockpileCredit, tileId: action.tileId });
  for (const material of newlyDiscovered) {
    // A distinct event NAME (not 'tick') -- this is a supplementary
    // annotation about the same round's environmental process, not a
    // separate game tick, so it must not be counted as one by anything
    // that increments a per-tick counter off audit-log 'tick' events
    // (e.g. lore-engine/detect-triggers.js's territory-throttle counter).
    appendAudit(hive.auditLogPath, { event: 'material-discovered', material, applied: true });
  }

  return { hiveState: nextHiveState, worldState: nextWorldState, applied };
}

// Set up N isolated hive sandboxes + one shared world-state file. NOT
// hardcoded to 2 -- operator (2026-07-16): "there can also be npc colonies
// or other things we introduce as needed to see how it resolves." Returns a
// map keyed by identity so any number of hives (2, 3, an NPC colony added
// later) work the same way. Each hive's sandbox is independent;
// the shared world-state file is the only common surface, same as the
// 2-hive case.
function setupHives(sandboxRoot, seeds, worldStatePath, resourcePool) {
  const hives = {};
  for (const seed of seeds) {
    const hive = ensureSandbox(sandboxRoot, seed.identity);
    fs.writeFileSync(hive.hiveStatePath, JSON.stringify(seed, null, 2));
    hives[seed.identity] = hive;
  }
  writeWorldState(worldStatePath, initialWorldState(resourcePool));
  return hives;
}

// Introduce a hive into an ALREADY-RUNNING world (an NPC colony, or a
// something-else colony added mid-run) -- does not touch the shared
// world-state file or any other hive's sandbox; purely additive.
function addHive(sandboxRoot, seed) {
  const hive = ensureSandbox(sandboxRoot, seed.identity);
  fs.writeFileSync(hive.hiveStatePath, JSON.stringify(seed, null, 2));
  return hive;
}

// Backward-compatible 2-hive convenience wrapper over setupHives.
function setupTwoHives(sandboxRoot, seedA, seedB, worldStatePath, resourcePool) {
  const hives = setupHives(sandboxRoot, [seedA, seedB], worldStatePath, resourcePool);
  return { hiveA: hives[seedA.identity], hiveB: hives[seedB.identity] };
}

module.exports = { VERBS, ensureSandbox, appendAudit, tick, setupHives, addHive, setupTwoHives };
