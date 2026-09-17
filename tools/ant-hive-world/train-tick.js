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
const { decide, trainStep, applyUpkeep, forward, encodeState, computeEntropy, VERB_ORDER, pickClaimTerritoryTile } = require('./untrained-network.js');
// Triad lanes (plan ant-sim-nine-mind-harness-triad-architecture, S3) --
// VERIFIER (zero trainable parameters, ground-truth feasibility) and
// SWEEPER (zero trainable parameters, ring-buffer caution). Both are inert
// unless a caller explicitly passes `laneState` into trainTick() below.
const { verifyFeasibility } = require('./verifier-lane.js');
const { computeCaution, recordOutcome } = require('./sweeper-lane.js');
// PLANNER (plan ant-sim-three-lobe-lane-redesign, L1) -- replaces SWEEPER's
// slot in laneState (`plannerState` instead of `sweeperState`); zero
// trainable parameters, a { currentGoal, ticksRemaining } commitment state
// machine over hive_state thresholds rather than a ring-buffer read.
// sweeperState wiring below is kept intact for callers/tests that still
// exercise it directly -- PLANNER and SWEEPER occupy the same combination
// slot but a caller opts into at most one at a time.
const { computeGoalMultiplier, advancePlanner } = require('./planner-lane.js');
// Dream-as-perception in-tick data path (plan world-mind-dream-communication,
// S4, AMENDMENT v7/v8/v9/v10). A module-level singleton, not a new trainTick()
// parameter -- see dream-lane.js's own header for the full rationale. Default-
// off: checkTriggers()/recordTickOutcome() both check
// Boolean(liveConfig.dream_lane_enabled) FIRST and are complete no-ops when
// it is absent/false, which is every caller today (live-config.js's
// DEFAULT_CONFIG is never touched by this plan).
const dreamLane = require('./dream/dream-lane.js');

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
//
// REWARD CONTRACT v3 (2026-08-11, plan ant-sim-reward-specification-repair S3)
// -- gives the reward a resource gradient it never had, and retunes the table.
//
// WHAT v2 COULD NOT SEE. `gather-food` and `gather-wood` are two DISTINCT policy
// actions (untrained-network.js VERB_ORDER), and decide() has always returned
// them with a distinguishing `resourceKey: 'food' | 'wood'`. trainTick() dropped
// that field when it assembled the applyResult handed to computeReward(), and
// computeReward() scored both at one `verb === 'gather'` branch. The two actions
// were therefore worth exactly the same number. No gradient anywhere in this
// system could express "eat rather than collect timber" -- not because anyone
// chose parity, but because the information never reached the scorer. v3 threads
// `resourceKey` through and scores the two lanes separately.
//
// WHY v2's HEADLINE CLAIM WAS INERT. The v2 block above says "a successful
// gather now weakly dominates idling in every state". That was true in the
// arithmetic and false in practice. At v2's gather yield of 1 against
// upkeep_cost_food of 1, net food per PERFECT gather was 0, so NO policy could
// ever end a tick holding food -- verified against the reference run:
// max(stockpile.food) = 0 and ticks_with_food = 0 across all 600 hive rows.
// Every hive was exhausted every tick, so the -2 exhaustion penalty was a
// CONSTANT every action paid, not a gradient any action could escape. v2's
// third row ("food 1, gather: ends 1, not exhausted, reward +1") described a
// state the world could not produce.
//
// WHAT MAKES v3 TESTABLE. S1's gather_yield_food = 2 makes net food per
// successful gather Y-1 = 1, so one successful gather ends the tick unexhausted
// and the -2 exhaustion penalty becomes EPISODICALLY ESCAPABLE. That -- and only
// that -- is what turns the table below into something a policy can climb.
//
// NOT A CLAIM OF SOLVENCY. Escape is episodic, never sustained. Measured world
// food inflow is ~0.24 food/tick against ~2.0 food/tick of combined hive upkeep
// plus ongoing prey grazing, so this world is in structural food deficit BY
// DESIGN. v3 does not make food surplus reachable and does not make sustained
// break-even reachable; it makes a single successful gather cycle buy a few
// unexhausted ticks. Any reading of v3 results that assumes a hive can learn its
// way to sustained solvency is reading something the world cannot supply.
//
// THE v3 TABLE (shipped defaults; every entry is a named live-config.js key,
// and an absent key reproduces the value below -- see resolveRewardWeights):
//
//   build, applied                  1.5   (was 2.0)
//   gather-food, applied            1.0   (unchanged)
//   claim-territory newly_acquired  0.5   (was 1.5)
//   gather-wood, applied            0.3   (was 1.0, shared with food)
//   idle                            0     (unchanged)
//   any failed action              -0.5   (unchanged)
//   foodExhausted                  -2     (unchanged)
//
// `already_owned` remains EXACTLY 0 -- S2's invariant, undisturbed: an action
// that changed nothing is worth nothing.
//
// THE ORDERING THE TABLE EXISTS TO PRODUCE (pinned as ordering assertions, not
// literal-number assertions, in __tests__/reward-contract-v3.test.cjs, so a
// future retune fails a test instead of passing a review):
//
//   I1  While EXHAUSTED, a successful gather-food strictly dominates everything.
//       At food 0: gather-food succeeds -> ends the tick holding 1 -> not
//       exhausted -> +1.0, against build 1.5-2 = -0.5, a new claim 0.5-2 = -1.5,
//       idle 0-2 = -2.0. Note what carries this: gather-food is only the
//       SECOND-SMALLEST positive weight in the table. The MECHANISM does the
//       work -- a successful gather escapes the penalty -- not the weight. The
//       table's only job here is to not fight the world's own consequence.
//   I2  While FED (food >= 2), build strictly dominates: +1.5 against
//       gather-food's +1.0. Growth is worth more than another meal not yet
//       needed.
//   I3  No action pays for a state change that did not occur: already_owned = 0.
//   I4  The punished state is escapable at all: gather_yield_food -
//       upkeep_cost_food >= 1 at shipped defaults.
//
// PRESERVED FROM v2: a FAILED gather while exhausted still scores -2.5 against
// idle's -2.0. The wasted-turn penalty stacking on exhaustion is the deliberate
// "don't forage an empty patch" signal, and v3 does not reverse it.
//
// NOTE FOR ANALYSIS: v3 changes the weights themselves, so cumulative reward is
// NOT comparable across the v2/v3 boundary -- for the same reason it was not
// comparable across v1/v2, and now additionally because build, gather-wood, and
// territory acquisition all changed value. Every persisted row carries
// reward_contract_version; any summarizer pooling rows must reject mixed or
// missing versions. `starved` is unchanged and remains the published crossing
// metric.
const REWARD_CONTRACT_VERSION = 3;

// The whole reward table in one place, resolved from liveConfig with the
// shipped v3 defaults (plan ant-sim-reward-specification-repair, S3). Written
// as a resolver rather than as `??` operators scattered through computeReward()
// so there is exactly ONE surface where "what is this action worth" is decided,
// and therefore exactly one surface a test has to interrogate.
//
// INERT BY DEFAULT, in the discipline computeEntropyBonusWeight established
// below and S1's resolveGatherYieldFood followed: every key falls back to the
// value the code ships with, so a liveConfig carrying none of these keys --
// every config file written before v3 existed -- reproduces the shipped table
// exactly. `??` and not `||` on purpose: reward_idle is legitimately 0 and the
// failure and exhaustion weights are legitimately negative, and `||` would
// silently discard an explicit 0.
function resolveRewardWeights(liveConfig) {
  const cfg = liveConfig || {};
  return {
    buildApplied: cfg.reward_build_applied ?? 1.5,
    gatherFoodApplied: cfg.reward_gather_food_applied ?? 1,
    gatherWoodApplied: cfg.reward_gather_wood_applied ?? 0.3,
    claimTerritoryNew: cfg.reward_claim_territory_new ?? 0.5,
    idle: cfg.reward_idle ?? 0,
    actionFailed: cfg.reward_action_failed ?? -0.5,
    foodExhausted: cfg.reward_food_exhausted ?? -2
  };
}

// Territory component of the reward, in isolation (plan ant-sim-reward-
// specification-repair, S2). Split out from computeReward so the component can
// be MEASURED, not merely asserted: the row's total reward can never prove the
// territory contribution is zero, because the same aggregate also carries the
// -2 exhaustion penalty (a re-assertion while exhausted totals -2 either way).
//
// Re-asserting a tile this hive already holds scores EXACTLY 0. It is not a
// success (it changed nothing) and not a failure (it did not fail) -- it did
// nothing, and nothing is what it is worth. Before this, `applied` was true for
// a re-assertion and it paid the full acquisition weight forever, an unbounded
// free-reward pump the policy found on its own.
//
// INERT BY DEFAULT on `territory_outcome`: with the outcome absent
// (undefined/null) this falls back to the pre-existing
// applied ? acquisition weight : failure weight scoring, structurally identical
// to every caller that has not opted in. Under v3 the acquisition weight itself
// moved from 1.5 to 0.5, so an opted-out caller scores the v3 number -- the
// weight table is versioned, the opt-in shape is not.
function territoryRewardContribution(applyResult, liveConfig) {
  if (applyResult.verb !== 'claim-territory') return 0;
  const w = resolveRewardWeights(liveConfig);
  const outcome = applyResult.territory_outcome;
  if (outcome === undefined || outcome === null) {
    return applyResult.applied ? w.claimTerritoryNew : w.actionFailed;
  }
  if (outcome === 'already_owned') return 0;
  if (outcome === 'newly_acquired') return w.claimTerritoryNew;
  return w.actionFailed; // 'contested' -- the claim genuinely did not land
}

// v3: `gather` is scored by RESOURCE. `resourceKey` comes straight from
// decide()'s action ('food' | 'wood') via trainTick. INERT on its absence: a
// caller that omits resourceKey scores the food lane, which is the single
// gather weight v2 used for both -- so a pre-v3 call site is unchanged by the
// split itself, and only sees the table's own version change.
function computeReward(applyResult, foodExhausted, liveConfig) {
  const w = resolveRewardWeights(liveConfig);
  let reward = 0;
  if (applyResult.verb === 'gather') {
    if (!applyResult.applied) reward += w.actionFailed;
    else if (applyResult.resourceKey === 'wood') reward += w.gatherWoodApplied;
    else reward += w.gatherFoodApplied;
  } else if (applyResult.verb === 'build') {
    reward += applyResult.applied ? w.buildApplied : w.actionFailed;
  } else if (applyResult.verb === 'claim-territory') {
    reward += territoryRewardContribution(applyResult, liveConfig);
  } else if (applyResult.verb === 'idle') {
    // 'idle' contributes its own weight (0 by default) from the action itself
    // -- a genuine choice -- but it no longer escapes the exhaustion penalty by
    // having avoided the crossing.
    reward += w.idle;
  }
  if (foodExhausted) reward += w.foodExhausted;
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
//
// `options.freezeHiveLearning === true` (optional, default false) passes
// trainStep a freeze: the tick decides, acts, decays, and scores exactly as
// always, and then writes no weight. Added for review finding F1 -- the frozen
// benchmark colony needs the hive learning path to actually stop, not merely to
// be deterministic. Threaded as an explicit argument rather than through
// liveConfig on purpose: liveConfig is re-read from disk every round and is
// dashboard-tunable, and a freeze that a running dashboard could switch off
// mid-run is not a freeze.
// `laneState` (optional, plan ant-sim-nine-mind-harness-triad-architecture,
// S3) is `{ verifierEnabled, sweeperState, gammaSweep }` -- undefined for
// every caller not opted into the triad (hive-B, the world mind, and hive-A
// whenever the triad isn't enabled). When present it wires VERIFIER's
// feasible(a) and SWEEPER's caution(a) into decide()'s combine step
// (`pi'(a) = pi(a) * feasible(a) * (1 - gammaSweep*caution(a))`, renormalized
// inside decide()) and threads the SAME laneMultipliers into trainStep() so
// decision-time and training-time shaping are provably one computation (the
// on-policy fix, §4) -- not two independent re-derivations that could drift.
// `sweeperState` absent -> SWEEPER inert (caution(a) === 0 for every verb).
// `verifierEnabled === false` -> VERIFIER inert (feasible(a) === 1 for every
// verb) -- this is how the B1/B2 ablation arms (§7.2) isolate one lane.
function trainTick(hive, worldStatePath, network, rng, liveConfig = {}, tickIndex, controllerState, options = {}, laneState) {
  const hiveState = JSON.parse(fs.readFileSync(hive.hiveStatePath, 'utf8'));
  const worldState = require('./world-state.js').readWorldState(worldStatePath);

  let laneMultipliers;
  let feasibleMap = null;
  let cautionMap = null;
  let plannerMultiplierMap = null;
  let claimTileCandidate = null;
  if (laneState) {
    // Territory-verifier blind-spot fix (found in the B0-B3 ablation's own
    // review leg): VERIFIER's claim-territory feasibility check needs a
    // concrete tile to check `claimTerritory()` against, but decide() used
    // to only pick that tile AFTER sampling a verb -- by which point the
    // shaping this feasibility map feeds is already over. Drawing the SAME
    // candidate decide() would otherwise draw for itself, here, before the
    // shaping step, lets VERIFIER check the real thing instead of defaulting
    // to feasible=1 for the entire verb (verifier-lane.js's documented
    // honest-gap fallback). decide() below is handed this exact value via
    // `precomputedClaimTileId` and reuses it rather than drawing a second,
    // independent tile -- one rng() call either way, just relocated earlier.
    //
    // Drawn unconditionally whenever `laneState` is present -- including
    // when verifierEnabled is false (B2 style arms) -- so every arm that
    // opts into laneState at all consumes the identical rng-draw count per
    // tick, regardless of which lane is actually active. That is what keeps
    // arms mutually comparable (rng_draw_invariant); a caller that never
    // passes laneState (every pre-triad caller: run-live.js, hive-B,
    // world-mind, and the ablation's own B0 control) never draws this and
    // stays byte-identical to before this fix.
    claimTileCandidate = pickClaimTerritoryTile(rng);
    feasibleMap = laneState.verifierEnabled === false
      ? null
      : verifyFeasibility(VERB_ORDER, hiveState, worldState, { liveConfig, claimTileId: claimTileCandidate });
    const gammaSweep = laneState.gammaSweep === undefined ? 1 : laneState.gammaSweep;
    cautionMap = laneState.sweeperState ? computeCaution(laneState.sweeperState, VERB_ORDER) : null;
    // PLANNER's multiplier is read here, BEFORE this tick's decision, from
    // whatever goal is already committed (possibly re-committed at the end
    // of the PREVIOUS tick, possibly still the null/inert bootstrap state on
    // tick 0) -- the state transition itself (decrement/re-select) happens
    // at the post-tick site below, mirroring SWEEPER's read-before/write-
    // after structure with PLANNER's own semantics.
    plannerMultiplierMap = laneState.plannerState ? computeGoalMultiplier(laneState.plannerState, VERB_ORDER) : null;
    laneMultipliers = VERB_ORDER.map((verb) => {
      const f = feasibleMap ? feasibleMap[verb] : 1;
      const c = cautionMap ? cautionMap[verb] : 0;
      const p = plannerMultiplierMap ? plannerMultiplierMap[verb] : 1;
      return f * (1 - gammaSweep * c) * p;
    });
  }

  // COMPUTE STEP (plan world-mind-dream-communication, S4, AMENDMENT v9
  // CAUSALITY RULE): dream-lane's checkTriggers() runs exactly ONCE per
  // tick, BEFORE the first encodeState() consumer (decide(), immediately
  // below), reading history through the PRIOR tick only -- this tick's own
  // outcomes do not exist yet. `hiveState` is the SAME object trainTick()
  // read at the top of this function, before anything this tick does, which
  // is what makes it a valid "current state" input for trigger 3's
  // relevance predicate (dream-lane.js's FOOD_STRESS_THRESHOLD check)
  // without violating the no-lookahead rule. The resulting dreamFeatures
  // value is threaded, unchanged, to every encodeState() call this tick
  // makes -- decide() here, trainStep() below, and the policy_entropy_
  // post_update recomputation -- a single local variable, never recomputed
  // per call site.
  const dreamCheck = dreamLane.checkTriggers(worldStatePath, hiveState.identity, tickIndex, liveConfig, hiveState);
  const dreamFeatures = dreamCheck.dreamFeatures;

  const action = decide(network, hiveState, worldState, rng, liveConfig, tickIndex, laneMultipliers, claimTileCandidate, dreamFeatures);

  // Divergence measure (plan §7.1): did VERIFIER's / SWEEPER's re-weight
  // change which verb has the highest combined probability, relative to the
  // stage before it? Built entirely from action._raw_probs/action._probs,
  // which decide() already computed -- no extra forward() pass, no extra
  // rng() draw, so B0 vs. B1/B2/B3 stay comparable under identical root
  // seeds (a named execution-contract requirement, plan §7.3).
  let verifierChangedArgmax = null;
  let sweeperChangedArgmax = null;
  let plannerChangedArgmax = null;
  if (laneState && laneMultipliers) {
    const argmax = (arr) => arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
    const rawArgmax = argmax(action._raw_probs);
    const feasibleOnlyProbs = feasibleMap
      ? action._raw_probs.map((p, i) => p * feasibleMap[VERB_ORDER[i]])
      : action._raw_probs.slice();
    const feasibleOnlyArgmax = argmax(feasibleOnlyProbs);
    const combinedArgmax = argmax(action._probs);
    verifierChangedArgmax = feasibleOnlyArgmax !== rawArgmax;
    // SWEEPER and PLANNER occupy the same third-lane combination slot
    // (PLANNER replaces SWEEPER's slot, plan ant-sim-three-lobe-lane-
    // redesign S3) -- each reports its own divergence field only when it is
    // the lane actually active this call, against the identical
    // feasibleOnly-vs-combined comparison SWEEPER always used.
    if (cautionMap) sweeperChangedArgmax = combinedArgmax !== feasibleOnlyArgmax;
    if (plannerMultiplierMap) plannerChangedArgmax = combinedArgmax !== feasibleOnlyArgmax;
  }

  const eventTick = tickIndex === undefined ? undefined : tickIndex + 1;
  const result = tick(hive, worldStatePath, () => action, liveConfig, rng, eventTick);
  const { hiveState: afterUpkeep, starved, foodExhausted } = applyUpkeep(result.hiveState, liveConfig.upkeep_cost_food);
  fs.writeFileSync(hive.hiveStatePath, JSON.stringify(afterUpkeep, null, 2));

  // UPDATE STEP (plan world-mind-dream-communication, S4, AMENDMENT v9):
  // AFTER this tick's own decision and its results (applied, starved,
  // territory outcome) already exist -- appends THIS tick's own outcomes to
  // dream-lane's history, extending it to "through this tick." The COMPUTE
  // step for the NEXT tick reads this; this tick's own COMPUTE step (above)
  // never could. `result.worldState` is the POST-tick world state
  // harness.tick() already produced in memory (a deliberate, documented
  // deviation from re-reading WORLD_STATE_PATH from disk a second time --
  // see dream-lane.js's recordTickOutcome() header). No-op (zero registry/
  // history touch) when dream_lane_enabled is falsy-absent.
  //
  // `stockpile` (S4b amendment, operator ratification 2026-08-13T16:46Z;
  // coordinator-pinned trend-gate definition 2026-08-13T17:05Z, plan
  // operator_ratifications[1] call S4b-1): additive field, this tick's own
  // POST-upkeep stockpile (`afterUpkeep`, already computed above and
  // already written to disk) -- the value the trend gate needs at the
  // exact crossing tick. Threading it costs nothing beyond naming a
  // variable this function already holds; not required by any prior S4
  // contract, added specifically to make the ratified trend gate
  // computable without dream-lane.js reaching back into engine state it
  // has no other path to (dream-lane.js stays pure/decoupled otherwise --
  // see its own module header).
  dreamLane.recordTickOutcome(worldStatePath, hiveState.identity, tickIndex, {
    starved, worldStateSnapshot: result.worldState, action, liveConfig,
    stockpile: afterUpkeep.hive_state && afterUpkeep.hive_state.stockpile && typeof afterUpkeep.hive_state.stockpile.food === 'number'
      ? afterUpkeep.hive_state.stockpile.food
      : null
  });

  // Reward keys off the exhaustion STATE, not the crossing (contract v2 --
  // see REWARD_CONTRACT_VERSION above). `starved` is still returned and logged
  // unchanged, so the published crossing metric keeps its meaning.
  // `resourceKey` (contract v3): decide() has always distinguished gather-food
  // from gather-wood here, and this object used to drop the field on the floor,
  // which is why the two actions scored identically. Carried through now.
  const applyResult = {
    verb: action.verb,
    resourceKey: action.resourceKey,
    applied: result.applied,
    territory_outcome: result.territory_outcome
  };
  const reward = computeReward(applyResult, foodExhausted, liveConfig);
  // Reported separately from `reward` on purpose (plan ant-sim-reward-
  // specification-repair, S2): the aggregate also carries the -2 exhaustion
  // penalty, so it can never on its own show that a re-assertion contributed
  // zero. This is the observable that makes the fix falsifiable.
  const territoryRewardContrib = territoryRewardContribution(applyResult, liveConfig);
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
  const freezeHiveLearning = options.freezeHiveLearning === true;
  trainStep(network, hiveState, worldState, action._action_index, reward, entropyBonusWeight, liveConfig.update_clip, { freeze: freezeHiveLearning }, laneMultipliers, dreamFeatures);

  // SWEEPER's ring buffer records THIS tick's outcome for future ticks'
  // caution(a) -- recorded against action._verb5 (the original 5-verb
  // choice, matching VERIFIER's/decide()'s own VERB_ORDER space), after
  // reward is known, never before. No-op when SWEEPER isn't wired in.
  if (laneState && laneState.sweeperState) {
    recordOutcome(laneState.sweeperState, action._verb5, reward);
  }

  // PLANNER's commitment update: decrement ticksRemaining (keep the goal)
  // or re-select and re-commit once it hits 0 -- read from `afterUpkeep`
  // (this tick's post-upkeep hive state) and `result.worldState` (Codex
  // catch, pre-commit review: the pre-tick `worldState` closed over above
  // is stale by the time this runs -- this tick's own territory/geometry
  // mutations already landed in `result.worldState`, and re-selecting
  // against the stale copy would make PLANNER blind to exactly the changes
  // its own tick just caused), so the NEXT tick's pre-tick
  // computeGoalMultiplier() read reflects reality as of after this tick
  // actually happened, not the state from before it. No-op when PLANNER
  // isn't wired in.
  if (laneState && laneState.plannerState) {
    advancePlanner(laneState.plannerState, afterUpkeep, result.worldState);
  }

  // policy_entropy_post_update (plan ant-hive-world-exploration-fix-hiveb-
  // collapse, S1): the entropy of the SAME network/state pair evaluated
  // immediately AFTER trainStep() has applied its weight update for this
  // tick -- distinct from action.policy_entropy above, which decide()
  // computed BEFORE trainStep() ran. This is the quantity the S0 gate froze
  // (sampling_point: "evaluated immediately AFTER each tick's trainStep()
  // returns") and S3's fixture test asserts against; the pre-existing
  // policy_entropy field is left unchanged for backward compatibility.
  const policyEntropyPostUpdate = computeEntropy(forward(network, encodeState(hiveState, worldState, dreamFeatures)).probs);

  // Feed the controller its own hive's just-measured value for NEXT tick's
  // decision -- within-run state only, updated whether or not the controller
  // is currently enabled so a mid-run dashboard enable acts on the latest
  // measurement immediately.
  if (controllerState) controllerState.prev_post_update_entropy = policyEntropyPostUpdate;

  return {
    hiveState: afterUpkeep,
    worldState: result.worldState,
    action: action.verb,
    // The RESOURCE LANE this action addressed ('food' | 'wood'), null for every
    // non-gather verb (plan ant-sim-reward-specification-repair, S4 scope). v3
    // scores gather-food and gather-wood at different weights, so a run row that
    // carries only `action: 'gather'` cannot tell the two lanes apart -- the
    // food-gather share was NOT DERIVABLE from a run log. Returned here so
    // run-live.js can persist it; changes no reward, weight or contract version.
    resource_key: action.resourceKey ?? null,
    applied: result.applied,
    // plan ant-sim-reward-specification-repair, S5-a3 (codex distinct review
    // fix): the plan's declared field contract is the literal string
    // 'not_applicable' for every non-territory verb (gather, build, idle) --
    // not null/absent. `applied` is UNCHANGED -- a re-assertion is still
    // applied: true, because it is still ok: true.
    territory_outcome: result.territory_outcome ?? 'not_applicable',
    territory_reward_contribution: territoryRewardContrib,
    starved,
    food_exhausted: foodExhausted,
    reward,
    reward_contract_version: REWARD_CONTRACT_VERSION,
    policy_entropy: action.policy_entropy,
    policy_entropy_post_update: policyEntropyPostUpdate,
    forced_exploration: action.forced_exploration,
    entropy_controller_active: controllerActive,
    effective_entropy_bonus_weight: entropyBonusWeight,
    // Reported rather than inferred from silence: a reader of a run row should
    // be able to see that this tick wrote no weight, without having to know
    // which flags the driver was started with.
    hive_learning_frozen: freezeHiveLearning,
    // Divergence measure (plan ant-sim-nine-mind-harness-triad-architecture,
    // §7.1) -- null when the triad isn't wired in for this tick (laneState
    // absent), boolean otherwise. Consumed by the B0-B3 ablation runner.
    verifier_changed_argmax: verifierChangedArgmax,
    sweeper_changed_argmax: sweeperChangedArgmax,
    planner_changed_argmax: plannerChangedArgmax,
    // RUN-LOG MARKER (plan world-mind-dream-communication, S4, AC2/AC12,
    // reconciled against v7's dream-as-perception redesign: ADDITIVE fields
    // on this tick's own NORMAL row, never a row replacement -- v7 excludes
    // no tick and freezes no network, so there is no separate "dream-driven"
    // row shape to emit; the 3-rows-per-tick invariant is untouched by
    // construction, since nothing is added or removed, only new fields on
    // the row that was always going to be written. `lane` is the field name
    // AC2 pins ('dream' when a signal fired this tick, null otherwise);
    // dream_lane/dream_trigger_class/dream_forecast_authority are additional
    // observability fields carrying the specifics a bare marker cannot.
    // Reported explicitly (never inferred from field absence) whether or not
    // a signal fired, matching this file's own established convention
    // (hive_learning_frozen, above).
    lane: dreamCheck.signal ? 'dream' : null,
    dream_lane: dreamCheck.signal ? dreamCheck.signal.lane : null,
    dream_trigger_class: dreamCheck.signal ? dreamCheck.signal.trigger_class : null,
    dream_forecast_authority: dreamCheck.signal ? dreamCheck.signal.forecast_authority : null
  };
}

module.exports = { computeReward, territoryRewardContribution, resolveRewardWeights, REWARD_CONTRACT_VERSION, trainTick, computeEntropyBonusWeight, computeControllerWeight };
