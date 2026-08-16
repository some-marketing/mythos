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
  // Fallow/regrowth mechanic (plan sim-replenishment-dynamics, S1/S2/S3):
  // food_source_regrow_rate/food_source_regrow_cap are DELIBERATELY ABSENT
  // from DEFAULT_CONFIG, not merely zeroed. S3's pre-registered ablation ran
  // to completion (7 seeds x 3 arms) and hit the plan's own AC4 FALSIFIER
  // path -- neither treatment arm cleared the eligibility bar, so per AC4
  // "no default/fingerprint change ships." The mechanic itself is not
  // reverted: regrowFoodSources still lives in world-state.js (exported,
  // unit-tested) and harness.js still calls it every tick. See harness.js's
  // wiring comment for the falsy-absent contract this omission relies on.
  // An operator or a future ablation enables it via a sandbox's
  // live-config.json, exactly as tools/scoped/sim-replenishment-dynamics/
  // ablation.cjs already does -- DEFAULT_CONFIG's key set, and therefore the
  // benchmark's world_params_defaults digest, stays exactly what it was
  // before this plan started.
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
  mud_conversion_rate: 0.2,
  // Episodic-escape food-yield fix (plan ant-sim-reward-specification-repair,
  // S1). A gather-food action has always credited amount:1 while
  // upkeep_cost_food is also 1, so net food per PERFECT gather is 0 --
  // verified against the reference run: max(stockpile.food)=0 and
  // ticks_with_food=0 across all 600 hive rows. That makes the -2 starvation
  // ("exhaustion") penalty a constant every hive always pays, not a gradient
  // a hive can learn its way out of even briefly. gather_yield_food=2 makes
  // Y-1 (net food per gather) = 1 instead of 0 -- the smallest integer that
  // makes escape possible at all. It is also the largest that stays safe:
  // claimFoodSource (world-state.js:305-308) is all-or-nothing against a
  // single food source's remaining balance, and sources spawn at
  // food_source_spawn_amount=6 then get grazed down continuously by prey, so
  // any larger fixed yield strands sub-threshold remainders that a hive can
  // no longer claim at all (the source has some food left, just not enough
  // for one full claim). 2 is the smallest value that helps and the largest
  // that doesn't add new failure modes -- same integer either way.
  // NOT a fix for structural food deficit: measured world inflow is only
  // ~0.24 food/tick against ~2.0 food/tick of combined hive upkeep plus
  // ongoing prey grazing, so sustained break-even stays unreachable at any Y
  // -- this only makes a single successful gather cycle escape starvation
  // for a few ticks, not sustained solvency.
  gather_yield_food: 2,
  // REWARD WEIGHT TABLE, contract v3 (plan ant-sim-reward-specification-repair,
  // S3). Every weight computeReward() uses now lives here as a named key rather
  // than as a literal buried in train-tick.js, so the table is one tunable,
  // inspectable surface instead of five scattered constants.
  //
  // INERT BY DEFAULT, in the same discipline as gather_yield_food above and
  // entropy_bonus_weight_initial before it: train-tick.js's
  // resolveRewardWeights() carries an identical copy of these defaults, so a
  // liveConfig lacking any or all of these keys reproduces the shipped table
  // exactly. A config file written before v3 existed scores identically to one
  // written after it.
  //
  // The v3 numbers themselves (and why gather-food and gather-wood are finally
  // distinguishable at all) are argued in train-tick.js's REWARD CONTRACT v3
  // comment block -- read that, not this list, for the reasoning.
  reward_build_applied: 1.5,
  reward_gather_food_applied: 1,
  reward_gather_wood_applied: 0.3,
  reward_claim_territory_new: 0.5,
  reward_idle: 0,
  reward_action_failed: -0.5,
  reward_food_exhausted: -2
};

// REWARD-SEMANTICS FREEZE SET (plan ant-sim-reward-specification-repair, S4,
// hole (b)). This file is re-read fresh EVERY round by run-live.js and is
// writable by the dashboard's /config POST while the sim runs -- that is the
// whole point of it, and it stays the point. But S3 moved the reward weights
// into this file, and a reward weight edited mid-run silently splits one run's
// reward semantics in half with no version bump: the first N ticks were scored
// under one table and the rest under another, and every persisted row still
// claims the same reward_contract_version.
//
// So exactly these keys are frozen for the duration of a run, and nothing else.
// The operator's stated reason for hot-editing is tuning ECOLOGY (prey graze
// rate, spawn chances, upkeep, the entropy controls) while preserving the
// in-memory network weights a restart would destroy. Reward semantics is not
// ecology -- it is the definition of the thing being measured. Every key NOT in
// this list stays as freely hot-editable as it was before S3.
//
// gather_yield_food is in the set for the same hazard, not for symmetry: it is
// the yield term the v3 table's escapability argument (I4) is built on, so
// changing it mid-run moves the reward landscape exactly as changing a weight
// does.
const REWARD_SEMANTIC_KEYS = [
  'gather_yield_food',
  'reward_build_applied',
  'reward_gather_food_applied',
  'reward_gather_wood_applied',
  'reward_claim_territory_new',
  'reward_idle',
  'reward_action_failed',
  'reward_food_exhausted'
];

// The frozen subset of a config, with absent keys resolved to the shipped
// defaults -- so a config that omits a key and a config that states the default
// explicitly are the SAME semantics and do not trip the guard.
function extractRewardSemantics(config) {
  const src = config || {};
  const out = {};
  for (const key of REWARD_SEMANTIC_KEYS) {
    const v = src[key];
    out[key] = (v === undefined || v === null) ? DEFAULT_CONFIG[key] : v;
  }
  return out;
}

// Returns one entry per changed frozen key: { key, from, to }. Object.is and
// not ==: a string "2" arriving from a form POST where a number 2 was snapshot
// IS a change worth naming, not a coincidence worth swallowing.
function diffRewardSemantics(snapshot, current) {
  const a = extractRewardSemantics(snapshot);
  const b = extractRewardSemantics(current);
  return REWARD_SEMANTIC_KEYS
    .filter((key) => !Object.is(a[key], b[key]))
    .map((key) => ({ key, from: a[key], to: b[key] }));
}

// A named error class so a caller can tell this refusal apart from a crash.
class RewardSemanticsChangedError extends Error {
  constructor(changes) {
    super(
      'REWARD SEMANTICS CHANGED MID-RUN: ' +
      changes.map((c) => `${c.key} ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).join('; ')
    );
    this.name = 'RewardSemanticsChangedError';
    this.changes = changes;
    this.status = `reward-semantics-changed-halt:${changes[0].key}`;
  }
}

// REFUSE, do not record. Recording the change and continuing would leave a run
// whose rows all claim one contract version while having been scored under two
// tables -- precisely the provenance hole summarize-reward-contract.js exists to
// catch, reintroduced one level down where the version stamp cannot see it.
function assertRewardSemanticsUnchanged(snapshot, current) {
  const changes = diffRewardSemantics(snapshot, current);
  if (changes.length > 0) throw new RewardSemanticsChangedError(changes);
  return true;
}

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

module.exports = {
  DEFAULT_CONFIG,
  readLiveConfig,
  writeLiveConfig,
  REWARD_SEMANTIC_KEYS,
  extractRewardSemantics,
  diffRewardSemantics,
  assertRewardSemanticsUnchanged,
  RewardSemanticsChangedError
};
