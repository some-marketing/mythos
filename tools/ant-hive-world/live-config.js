#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/live-config.js -- operator-tunable variables the
// dashboard can modify WHILE the sim is running (operator, 2026-07-16:
// "i need to be able to modify variables in this dashboard"), without
// restarting the process -- a restart would lose the learned network
// weights, which live only in that process's memory.
//
// A plain JSON file, read fresh every round by run-live.js and written by
// the dashboard's /config POST endpoint. No in-memory state here -- the
// file IS the shared, durable source of truth both sides read/write.

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  tick_interval_ms: 250,
  build_cost_wood: 2,
  pheromone_deposit: 1,
  pheromone_decay: 0.9,
  trail_follow_prob: 0.8,
  food_source_spawn_chance: 0.04,
  food_source_spawn_amount: 6,
  max_food_sources: 7,
  prey_growth_rate: 0.05,
  prey_graze_rate: 0.4,
  predation_rate: 0.02,
  predator_growth_rate: 0.15,
  predator_death_rate: 0.08,
  upkeep_cost_food: 1,
  // Exploration-collapse fix (plan ant-hive-world-exploration-fix, S1/S2).
  // Defaults match the frozen fix-enabled thresholds from that plan; 0
  // fully disables either control (needed for the plan's control test).
  entropy_bonus_weight: 0.3,
  forced_exploration_interval: 75,
  // Decaying entropy schedule (plan ant-hive-world-exploration-fix-hiveb-
  // collapse, S1/S2; candidate (b) resolved at the s0-candidate-choice
  // operator gate, amendment __amendment__20260718T181836Z). Activated by
  // default per that resolved gate -- entropy_bonus_weight_initial starts
  // high enough (order 2-3) to rival a fast +2 build-streak's REINFORCE
  // gradient in the ticks 0-20 EARLY window, and linearly decays to the
  // standing entropy_bonus_weight above over entropy_bonus_decay_ticks
  // ticks (75, matching forced_exploration_interval's own cadence), so
  // SUSTAINED-window behavior converges to the parent plan's already-proven
  // configuration. train-tick.js's computeEntropyBonusWeight() treats either
  // field being absent/0 as fully disabled (inert, S1's default).
  entropy_bonus_weight_initial: 3,
  entropy_bonus_decay_ticks: 75,
  // Candidate (c) update-clipping (plan ant-hive-world-exploration-fix-
  // hiveb-collapse, S4 combination-escalation gate, amendment
  // __amendment__20260718T183529Z) -- SUPERSEDED as the S4-gap fix by the
  // s4-normalization-escalation gate (amendment __amendment__20260718T185536Z):
  // the measured ~57x hidden-energy amplification between fixture-scale and
  // RESOURCE_POOL-scale inputs (hiddenNormSq ~=1.97 vs ~=113.47) meant NO
  // fixed dLogits-level clip value worked across both regimes (clip sweep
  // 0.05-50 all failed) -- the amplification happens upstream, in the
  // forward pass, so encodeState() input normalization (see
  // untrained-network.js's RESOURCE_NORM_K) replaces this as the mechanism
  // that keeps gradient magnitude bounded. The trainStep()/train-tick.js
  // code path for update_clip remains present and functional (INERT, not
  // removed, per the resolved gate) -- default flipped to 0 here so it has
  // zero effect unless an operator explicitly re-enables it. 0/undefined
  // fully disables (train-tick.js/untrained-network.js treat any
  // non-positive or absent value as inert).
  update_clip: 0,
  // Reactive entropy controller (plan ant-hive-world-exploration-fix-hiveb-
  // collapse, resolved s4-reactive-controller gate, amendment
  // __amendment__20260718T192154Z) -- ON by default per that gate. When the
  // previous tick's own-hive policy_entropy_post_update falls below
  // entropy_controller_trigger (2x the frozen 0.3-nat floor -- must sit
  // ABOVE the floor so the controller engages before the numerically
  // absorbing zero-force region where the entropy-bonus gradient vanishes),
  // the effective entropy-bonus weight is lifted to
  // max(schedule weight, entropy_controller_boost_weight) until entropy
  // recovers to entropy_controller_release (hysteresis: release > trigger
  // prevents per-tick oscillation at the boundary). Trigger 0.9 = 3x floor:
  // the a-priori force analysis shows the boost keeps a >=2.8x restoring-
  // force margin at H=0.9 (minimal restoring weight there ~1.06), and live
  // S4 runs showed single-tick entropy shocks up to ~0.59 nats (growing
  // unnormalized territory/structure input features amplify late-run
  // gradients), so the trigger-to-floor buffer must exceed that shock scale
  // -- 0.9 gives 0.6 nats of buffer against a one-tick-delayed signal where
  // 0.6 (2x floor) gave only 0.3 and was breached once in 12,000 hive-ticks.
  // The boost value equals
  // entropy_bonus_weight_initial deliberately -- already proven against +2
  // streaks by the fixture v1/v2 early-window batteries. Within-run,
  // per-hive feedback only (state lives in run-live.js's loop, fresh every
  // run). entropy_controller_enabled=0 (or trigger/boost 0) fully disables
  // -- byte-identical to pre-controller behavior. See train-tick.js's
  // computeControllerWeight() for the measured force analysis behind these
  // defaults.
  entropy_controller_enabled: 1,
  entropy_controller_trigger: 0.9,
  entropy_controller_release: 1.2,
  entropy_controller_boost_weight: 3,
  // Richer resource/element model (plan ant-hive-world-richer-resource-model,
  // S1). Same spawn/harvest pattern as the food-source constants above,
  // parameterized across clay/water/ore/fiber; mud has no spawn/harvest of
  // its own -- it only exists via the clay+water conversion rate.
  material_spawn_chance: 0.03,
  material_harvest_rate: 0.15,
  mud_conversion_rate: 0.2
};

function readLiveConfig(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// Atomic write (temp + rename) so a concurrent read from run-live.js's loop
// never sees a torn/partial config file.
function writeLiveConfig(configPath, updates) {
  const current = readLiveConfig(configPath);
  const next = { ...current, ...updates };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, configPath);
  return next;
}

module.exports = { DEFAULT_CONFIG, readLiveConfig, writeLiveConfig };
