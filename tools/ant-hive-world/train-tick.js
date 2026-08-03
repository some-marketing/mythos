#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/train-tick.js — the actual "sim is the training
// ground" composition: decide (untrained network) -> apply (harness.tick)
// -> upkeep decay -> reward -> learn (trainStep). This REPLACES an
// LLM-decide-based tick for this world; the network's weights are the only
// thing that improves over time, and they improve from nothing but this
// simulation's own outcomes.

const fs = require('fs');
const { tick } = require('./harness.js');
const { decide, trainStep, applyUpkeep, forward, encodeState, computeEntropy } = require('./untrained-network.js');

// Survival/resource-based reward (operator, 2026-07-16). Real consequences,
// not narrated ones: a successful gather/build/claim is rewarded because it
// is what keeps the hive fed and growing; a failed/contested action is a
// mild negative because it wastes a turn without result. `starved` currently
// means upkeep crossed from positive food to zero; persistent zero-food ticks
// are not flagged (the open reward-design gap recorded in the run debrief).
// REWARD CONTRACT v2 (2026-08-03) -- fixes an inverted foraging incentive.
//
// v1 penalized `starved`, the positive-to-zero CROSSING. Because a hive already
// at zero food never crosses, v1 produced this ordering at food === 0:
//
//   idle   : 0 -> 0, no crossing, reward  0
//   gather : 0 -> 1 -> 0, CROSSING fires, reward +1 - 2 = -1
//
// A starving hive was therefore rewarded for staying starved and punished for
// acquiring food -- the strongest possible wrong signal, applied exactly in the
// state where foraging matters most. This is the same coupling that made
// `starve_crossings` track food gathers (fixed there as a metric, 2026-08-02;
// the identical defect survived here in the reward until now). Found by a
// third-family review of PR #6, 2026-08-03.
//
// v2 penalizes `foodExhausted`, the STATE of ending a tick with nothing, which
// the v1 comment already conceded was the real gap ("persistent zero-food ticks
// are not flagged"). Under v2:
//
//   food 0, idle   : ends 0, exhausted, reward  0 - 2 = -2
//   food 0, gather : ends 0, exhausted, reward +1 - 2 = -1   (gather now wins)
//   food 1, gather : ends 1, not exhausted, reward       +1
//
// A SUCCESSFUL gather now weakly dominates idling in every state, which is the
// invariant v1 violated. SCOPE (codex distinct review): this holds for
// successful gathers only — a FAILED gather while exhausted scores -2.5 against
// idle's -2, since the wasted-turn penalty stacks on exhaustion. That is a
// deliberate "don't forage at an empty patch" signal, pinned by test.
//
// NOTE FOR ANALYSIS: v2 changes reward semantics, so cumulative reward is NOT
// comparable across the version boundary — every persisted row carries
// reward_contract_version, and any summarizer pooling rows must reject mixed or
// missing versions. `starved` is unchanged and remains the published crossing
// metric.
//
// UNRESOLVED (codex, requires an experiment not a review): penalizing the
// exhaustion STATE means a persistently starving hive now takes -2 every tick
// rather than once. REINFORCE here has no baseline, so a state-wide penalty
// multiplies directly into the sampled-action gradient; in expectation an
// action-independent penalty cancels, but over finite trajectories it raises
// gradient magnitude and variance. Failed actions now reach -2.5, exceeding the
// +2 build-streak magnitude the entropy schedule and controller were calibrated
// against. Those controls are mechanically unchanged but NOT behaviourally
// revalidated. A seeded starvation-regime comparison is required before v2
// results are trusted for learning-dynamics claims.
const REWARD_CONTRACT_VERSION = 2;

function computeReward(applyResult, foodExhausted) {
  let reward = 0;
  if (applyResult.verb === 'gather') reward += applyResult.applied ? 1 : -0.5;
  else if (applyResult.verb === 'build') reward += applyResult.applied ? 2 : -0.5;
  else if (applyResult.verb === 'claim-territory') reward += applyResult.applied ? 1.5 : -0.5;
  // 'idle' contributes 0 from the action itself -- a genuine choice -- but it
  // no longer escapes the exhaustion penalty by having avoided the crossing.
  if (foodExhausted) reward -= 2;
  return reward;
}

// Decaying entropy-bonus schedule (plan ant-hive-world-exploration-fix-
// hiveb-collapse, S1; candidate (b) chosen at the resolved s0-candidate-choice
// operator gate, amendment ant-hive-world-exploration-fix-hiveb-collapse
// __amendment__20260718T181836Z). Fixes hive-b's fast-early-streak collapse
// (entropy 0.0026 nats by tick 3 in S6) by making the effective
// entropy_bonus_weight a pure function of tickIndex: start high (order 2-3,
// enough to rival a +2 build-streak's REINFORCE gradient) and linearly decay
// to the parent plan's already-proven standing value (liveConfig
// .entropy_bonus_weight, default 0.3) over entropy_bonus_decay_ticks ticks,
// held at the standing value thereafter. trainStep()'s signature is
// unchanged -- this only changes what weight value trainTick() passes to it.
//
// INERT BY DEFAULT: if either entropy_bonus_weight_initial or
// entropy_bonus_decay_ticks is absent (undefined) from liveConfig, or
// tickIndex is not supplied, this returns liveConfig.entropy_bonus_weight
// (or 0) unchanged -- byte-identical to every pre-existing caller that does
// not opt in. No cross-run state of any kind (fresh-minds compliance): a
// pure function of the within-run tickIndex only.
function computeEntropyBonusWeight(tickIndex, liveConfig = {}) {
  const finalWeight = liveConfig.entropy_bonus_weight === undefined ? 0 : liveConfig.entropy_bonus_weight;
  const initial = liveConfig.entropy_bonus_weight_initial;
  const decayTicks = liveConfig.entropy_bonus_decay_ticks;
  if (initial === undefined || decayTicks === undefined || !(decayTicks > 0) || tickIndex === undefined) {
    return finalWeight;
  }
  const t = Math.min(tickIndex, decayTicks);
  const frac = t / decayTicks;
  return initial + (finalWeight - initial) * frac;
}

// Reactive entropy controller (plan ant-hive-world-exploration-fix-hiveb-
// collapse, resolved s4-reactive-controller gate, amendment
// __amendment__20260718T192154Z). Closes the POST-DECAY sustained-streak gap
// the (b) schedule + normalization left open: after the schedule decays to
// the standing weight (t>75), a sustained one-sided streak can push
// policy_entropy_post_update below the frozen 0.3-nat floor and into a
// numerically absorbing region (entropy-bonus gradient w*p*(-log p - H) -> 0
// as p -> 1, so at float scale NO weight can rescue a fully saturated
// policy -- observed: hive-b pinned at exactly 0.0000 nats for 1900+/2000
// ticks in 2 of 3 S4 runs).
//
// Design (a-priori justification measured at fixture-v2/RESOURCE_POOL scale,
// seed 20260718, +2 build streak -- the exact observed failure shape; see
// the plan worker's force analysis):
// - TRIGGER (entropy_controller_trigger, default 0.9 = 3x floor): the
//   controller engages when the PREVIOUS tick's own-hive
//   policy_entropy_post_update falls below this. Two measured constraints
//   set it: (1) recovery-force adequacy -- the minimal restoring weight w*
//   (smallest entropy-bonus weight giving a non-negative one-step entropy
//   delta under a continued +2 streak) is ~0.72 at H~=0.58, ~1.06 at
//   H~=0.90, ~1.73 at H~=1.19, so the default boost of 3 carries a ~2.8x
//   force margin at the 0.9 trigger and remains adequate well above it;
//   (2) shock headroom against the controller's 1-tick reaction latency --
//   on the frozen fixture-v2 streak trajectory band-transit is slow
//   (~0.015-0.03 nats/tick), but LIVE S4 runs showed single-tick
//   policy_entropy_post_update drops up to ~0.59 nats (the unnormalized
//   own-territory/own-structures input features grow over a run and
//   amplify per-tick gradient magnitude; resource normalization
//   deliberately does not cover them), so the trigger-to-floor buffer must
//   exceed that live shock scale. 0.9 gives a 0.6-nat buffer (a 0.6
//   trigger's 0.3-nat buffer was breached exactly once in 12,000 live
//   hive-ticks by a 0.51-nat shock). Healthy convergence is preserved: an
//   uncontrolled policy may still hold p_dominant ~0.75 at H=0.9, well
//   above the floor.
// - BOOST (entropy_controller_boost_weight, default 3): a fixed boost
//   weight, deliberately equal to entropy_bonus_weight_initial -- the value
//   already proven (fixture v1+v2 EARLY-WINDOW batteries) to out-muscle a
//   +2 build streak at both input scales; a proven constant, not a newly
//   tuned one. Measured: from an H~=0.58 snapshot under a CONTINUED +2
//   streak, boost=3 recovers to >=0.9 nats in ~4 ticks and never dips
//   below ~0.67.
// - RELEASE (entropy_controller_release, default 1.2 = 4x floor): the
//   controller disengages only once the previous tick's entropy is back at
//   or above this. The 0.3-nat hysteresis gap prevents chattering at the
//   trigger boundary (one boosted tick lifts entropy past the trigger; a
//   release equal to the trigger would then drop the boost and immediately
//   re-arm next tick, oscillating every tick).
// - COMPOSITION: effective_weight = max(schedule_weight, boost) while
//   engaged, schedule_weight otherwise -- monotone, never below the (b)
//   schedule, so the controller can only ADD exploration pressure.
//
// `controllerState` is a per-hive, WITHIN-RUN mutable object owned by the
// caller's run loop ({ active, prev_post_update_entropy }) and passed
// explicitly -- never a module global (a global would leak the feedback
// signal between hives) and never persisted (fresh-minds rule: state dies
// with the run). INERT unless a state object is passed AND
// entropy_controller_enabled AND entropy_controller_trigger > 0 -- with any
// of those absent the returned weight is exactly scheduleWeight, byte-
// identical to pre-controller behavior.
function computeControllerWeight(controllerState, scheduleWeight, liveConfig = {}) {
  if (!controllerState || !liveConfig.entropy_controller_enabled) return scheduleWeight;
  const trigger = liveConfig.entropy_controller_trigger;
  const boost = liveConfig.entropy_controller_boost_weight;
  if (!(trigger > 0) || !(boost > 0)) return scheduleWeight;
  const release = Math.max(
    liveConfig.entropy_controller_release === undefined ? trigger : liveConfig.entropy_controller_release,
    trigger
  );
  const prev = controllerState.prev_post_update_entropy;
  if (prev !== undefined) {
    if (controllerState.active) {
      if (prev >= release) controllerState.active = false;
    } else if (prev < trigger) {
      controllerState.active = true;
    }
  }
  if (controllerState.active) return Math.max(scheduleWeight, boost);
  return scheduleWeight;
}

// One full training tick for ONE hive: sample the action ONCE (decide is
// stochastic -- resampling later would train on a different draw than the
// one actually applied), apply it via harness.tick, decay via upkeep, score
// it, then update the network's weights. `network` is mutated in place by
// trainStep -- this is the actual learning happening, tick by tick.
//
// `liveConfig` (optional) is read fresh by the caller (run-live.js) every
// round from live-config.js and threaded through to decide() (trail_follow_prob,
// forced_exploration_interval), trainStep() (entropy_bonus_weight), and
// harness.tick() (build cost, ecosystem rates) -- operator (2026-07-16):
// "i need to be able to modify variables in this dashboard."
//
// `tickIndex` (optional) is the caller's own elapsed-round counter (plan
// ant-hive-world-exploration-fix S2 -- decide()/trainTick() have no
// internal notion of elapsed ticks, so it must be threaded in explicitly
// from run-live.js's own loop) needed to evaluate forced_exploration_interval.
//
// `controllerState` (optional) is this hive's reactive-entropy-controller
// state object (see computeControllerWeight above) -- per-hive, created
// fresh by the run loop at startup, mutated in place here (hysteresis flag +
// previous tick's own-hive policy_entropy_post_update). Absent -> the
// controller code path is fully inert.
function trainTick(hive, worldStatePath, network, rng, liveConfig = {}, tickIndex, controllerState) {
  const hiveState = JSON.parse(fs.readFileSync(hive.hiveStatePath, 'utf8'));
  const worldState = require('./world-state.js').readWorldState(worldStatePath);
  const action = decide(network, hiveState, worldState, rng, liveConfig, tickIndex);

  const eventTick = tickIndex === undefined ? undefined : tickIndex + 1;
  const result = tick(hive, worldStatePath, () => action, liveConfig, rng, eventTick);
  const { hiveState: afterUpkeep, starved, foodExhausted } = applyUpkeep(result.hiveState, liveConfig.upkeep_cost_food);
  fs.writeFileSync(hive.hiveStatePath, JSON.stringify(afterUpkeep, null, 2));

  // Reward keys off the exhaustion STATE, not the crossing (contract v2 --
  // see REWARD_CONTRACT_VERSION above). `starved` is still returned and logged
  // unchanged, so the published crossing metric keeps its meaning.
  const reward = computeReward({ verb: action.verb, applied: result.applied }, foodExhausted);
  const scheduleWeight = computeEntropyBonusWeight(tickIndex, liveConfig);
  // Reactive controller (resolved s4-reactive-controller gate): reads the
  // PREVIOUS tick's own-hive policy_entropy_post_update from controllerState
  // and, when engaged, lifts the effective weight to the boost value --
  // monotone composition, never below the schedule. Inert without a state
  // object or with the controller disabled in liveConfig.
  const entropyBonusWeight = computeControllerWeight(controllerState, scheduleWeight, liveConfig);
  const controllerActive = Boolean(controllerState && controllerState.active) &&
    Boolean(liveConfig.entropy_controller_enabled) &&
    liveConfig.entropy_controller_trigger > 0 &&
    liveConfig.entropy_controller_boost_weight > 0;
  // Candidate (c) update-clipping (S4 combination-escalation gate,
  // amendment __amendment__20260718T183529Z): liveConfig.update_clip is
  // passed straight through to trainStep()'s new optional last parameter;
  // undefined (absent from liveConfig) leaves trainStep() fully inert on
  // this argument -- see untrained-network.js's trainStep() comment.
  trainStep(network, hiveState, worldState, action._action_index, reward, entropyBonusWeight, liveConfig.update_clip);

  // policy_entropy_post_update (plan ant-hive-world-exploration-fix-hiveb-
  // collapse, S1): the entropy of the SAME network/state pair evaluated
  // immediately AFTER trainStep() has applied its weight update for this
  // tick -- distinct from action.policy_entropy above, which decide()
  // computed BEFORE trainStep() ran. This is the quantity the S0 gate froze
  // (sampling_point: "evaluated immediately AFTER each tick's trainStep()
  // returns") and S3's fixture test asserts against; the pre-existing
  // policy_entropy field is left unchanged for backward compatibility.
  const policyEntropyPostUpdate = computeEntropy(forward(network, encodeState(hiveState, worldState)).probs);

  // Feed the controller its own hive's just-measured value for NEXT tick's
  // decision -- within-run state only, updated whether or not the controller
  // is currently enabled so a mid-run dashboard enable acts on the latest
  // measurement immediately.
  if (controllerState) controllerState.prev_post_update_entropy = policyEntropyPostUpdate;

  return {
    hiveState: afterUpkeep,
    worldState: result.worldState,
    action: action.verb,
    applied: result.applied,
    starved,
    food_exhausted: foodExhausted,
    reward,
    reward_contract_version: REWARD_CONTRACT_VERSION,
    policy_entropy: action.policy_entropy,
    policy_entropy_post_update: policyEntropyPostUpdate,
    forced_exploration: action.forced_exploration,
    entropy_controller_active: controllerActive,
    effective_entropy_bonus_weight: entropyBonusWeight
  };
}

module.exports = { computeReward, trainTick, computeEntropyBonusWeight, computeControllerWeight };
