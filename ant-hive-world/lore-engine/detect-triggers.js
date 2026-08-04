#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/lore-engine/detect-triggers.js — plan
// ant-hive-world-lore-wiki-layer, S1. Pure trigger-detection: reads NEW
// audit-log.jsonl entries (already sliced by the caller against a
// checkpoint) plus a read-only world-state snapshot, and returns narrative
// trigger events. Never writes to audit-log.jsonl or world-state.json --
// this module is READ-ONLY over both, per the plan's COSMETIC-ONLY gate.
//
// Event source decision (S0 axis 0): audit-log.jsonl is the only genuinely
// append-only event source in this project; world-state.js's territory/
// food_sources/populations/pheromones are mutable snapshots, consulted here
// ONLY for milestone threshold checks, never as the trigger log itself.

const DEFAULT_TERRITORY_THROTTLE_TICKS = 20;
const DEFAULT_STRUCTURE_MILESTONE_COUNTS = [5, 10, 25, 50];
const DEFAULT_POPULATION_CRASH_FRACTION = 0.15; // population <= 15% of its max counts as a crash
const DEFAULT_POPULATION_BOOM_FRACTION = 0.9;   // population >= 90% of its max counts as a boom
// CODE REVIEW (PR #12, codex P2): the population milestone thresholds are
// fractions of the ecosystem's max population caps, but those caps were only
// ever supplied by test-only callers -- the live watcher CLI passed no
// maxPrey/maxPredators, so every crash/boom check was skipped. Default them
// from world-state.js's own exported caps (the single source of truth for
// the ecosystem) instead of requiring every caller to know about them.
const { DEFAULT_MAX_PREY, DEFAULT_MAX_PREDATORS } = require('../world-state.js');

function freshCheckpoint() {
  return {
    discovered_subjects: [],
    last_territory_trigger_tick: -Infinity,
    structure_milestones_hit: [],
    population_milestones_hit: [] // e.g. 'prey-crash', 'prey-boom', 'predator-crash', 'predator-boom'
  };
}

// `newAuditEntries`: array of already-parsed JSONL objects, already sliced
// to just the entries since the last checkpoint (caller's responsibility --
// this module has no file I/O so it stays trivially unit-testable).
// `worldStateSnapshot`: the CURRENT world-state.json contents (read-only),
// or null if unavailable -- milestone checks are skipped, not faked, when null.
function detectTriggers({ hiveId, newAuditEntries, checkpoint, worldStateSnapshot, opts = {} }) {
  const territoryThrottleTicks = opts.territoryThrottleTicks ?? DEFAULT_TERRITORY_THROTTLE_TICKS;
  const structureMilestoneCounts = opts.structureMilestoneCounts ?? DEFAULT_STRUCTURE_MILESTONE_COUNTS;
  const populationCrashFraction = opts.populationCrashFraction ?? DEFAULT_POPULATION_CRASH_FRACTION;
  const populationBoomFraction = opts.populationBoomFraction ?? DEFAULT_POPULATION_BOOM_FRACTION;
  const maxPrey = opts.maxPrey ?? DEFAULT_MAX_PREY;
  const maxPredators = opts.maxPredators ?? DEFAULT_MAX_PREDATORS;

  const next = {
    discovered_subjects: [...(checkpoint?.discovered_subjects || [])],
    last_territory_trigger_tick: checkpoint?.last_territory_trigger_tick ?? -Infinity,
    structure_milestones_hit: [...(checkpoint?.structure_milestones_hit || [])],
    population_milestones_hit: [...(checkpoint?.population_milestones_hit || [])]
  };
  const triggers = [];
  let tickCounter = checkpoint?.last_tick_seen ?? 0;
  let structuresBuiltSoFar = checkpoint?.structures_built_so_far ?? 0;

  for (const entry of newAuditEntries || []) {
    // codex distinct review (2026-07-17): materials discovered passively by
    // world-state.js's applyMaterialDynamics (never via the network's
    // 'gather' verb, since untrained-network.js only ever gathers food/
    // wood) previously produced NO audit event at all, so the lore engine
    // could never narrate them during an actual live run. harness.js now
    // emits a distinct 'material-discovered' event for this -- handled here
    // WITHOUT incrementing tickCounter/structuresBuiltSoFar, since it is a
    // supplementary annotation about the same round, not a separate tick.
    if (entry.event === 'material-discovered' && entry.applied && entry.material) {
      if (!next.discovered_subjects.includes(entry.material)) {
        next.discovered_subjects.push(entry.material);
        triggers.push({
          ts: entry.ts,
          hive: hiveId,
          entry_type: 'discovery',
          subject: entry.material,
          tier: 'routine',
          source_event: entry
        });
      }
      continue;
    }
    if (entry.event !== 'tick') continue; // rejected-verb / build-insufficient-materials / territory-contested are not narration-worthy on their own
    tickCounter += 1;

    if (entry.verb === 'gather' && entry.applied && entry.stockpile_credit) {
      const subject = entry.stockpile_credit.resourceKey;
      if (subject && !next.discovered_subjects.includes(subject)) {
        next.discovered_subjects.push(subject);
        triggers.push({
          ts: entry.ts,
          hive: hiveId,
          entry_type: 'discovery',
          subject,
          tier: 'routine',
          source_event: entry
        });
      }
    } else if (entry.verb === 'build' && entry.applied) {
      structuresBuiltSoFar += 1;
      triggers.push({
        ts: entry.ts,
        hive: hiveId,
        entry_type: 'structure',
        subject: `structure-${structuresBuiltSoFar}`,
        tier: 'routine',
        source_event: entry
      });
      for (const count of structureMilestoneCounts) {
        if (structuresBuiltSoFar === count && !next.structure_milestones_hit.includes(count)) {
          next.structure_milestones_hit.push(count);
          triggers.push({
            ts: entry.ts,
            hive: hiveId,
            entry_type: 'milestone',
            subject: `${count}th-structure`,
            tier: 'milestone',
            source_event: entry
          });
        }
      }
    } else if (entry.verb === 'claim-territory' && entry.applied) {
      if (tickCounter - next.last_territory_trigger_tick >= territoryThrottleTicks) {
        next.last_territory_trigger_tick = tickCounter;
        triggers.push({
          ts: entry.ts,
          hive: hiveId,
          entry_type: 'territory',
          subject: entry.tileId || 'unknown-tile',
          tier: 'routine',
          source_event: entry
        });
      }
    }
  }

  // Milestone population checks -- read-only consult of the CURRENT
  // world-state snapshot, never written back to. Fires at most once per
  // crossing (tracked in population_milestones_hit) so a population
  // hovering near a threshold does not spam milestone entries every poll.
  if (worldStateSnapshot) {
    const checks = [
      { key: 'prey-crash', pop: worldStateSnapshot.prey_population, max: maxPrey, fraction: populationCrashFraction, direction: 'below' },
      { key: 'prey-boom', pop: worldStateSnapshot.prey_population, max: maxPrey, fraction: populationBoomFraction, direction: 'above' },
      { key: 'predator-crash', pop: worldStateSnapshot.predator_population, max: maxPredators, fraction: populationCrashFraction, direction: 'below' },
      { key: 'predator-boom', pop: worldStateSnapshot.predator_population, max: maxPredators, fraction: populationBoomFraction, direction: 'above' }
    ];
    for (const check of checks) {
      if (typeof check.pop !== 'number' || !check.max) continue;
      const threshold = check.max * check.fraction;
      const crossed = check.direction === 'below' ? check.pop <= threshold : check.pop >= threshold;
      if (crossed && !next.population_milestones_hit.includes(check.key)) {
        next.population_milestones_hit.push(check.key);
        triggers.push({
          ts: new Date(worldStateSnapshot.written_at || Date.now()).toISOString(),
          hive: hiveId,
          entry_type: 'milestone',
          subject: check.key,
          tier: 'milestone',
          source_event: { event: 'population-threshold', key: check.key, population: check.pop, max: check.max }
        });
      } else if (!crossed && next.population_milestones_hit.includes(check.key)) {
        // population recovered past the threshold in the other direction --
        // allow the SAME milestone to fire again on a future re-crossing
        // (a real boom/bust cycle can happen more than once over a long run).
        next.population_milestones_hit = next.population_milestones_hit.filter((k) => k !== check.key);
      }
    }
  }

  next.last_tick_seen = tickCounter;
  next.structures_built_so_far = structuresBuiltSoFar;

  return { triggers, checkpoint: next };
}

module.exports = {
  freshCheckpoint,
  detectTriggers,
  DEFAULT_TERRITORY_THROTTLE_TICKS,
  DEFAULT_STRUCTURE_MILESTONE_COUNTS,
  DEFAULT_POPULATION_CRASH_FRACTION,
  DEFAULT_POPULATION_BOOM_FRACTION
};
