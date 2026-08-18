#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/planner-lane.js -- the PLANNER lane, plan
// ant-sim-three-lobe-lane-redesign, L1 (replaces SWEEPER's slot per
// _dev/reports/analysis/task-plans/three-lobe-lane-redesign__plan.md S3).
// Where SWEEPER read a rolling window of the entity's own recent (verb,
// reward) outcomes, PLANNER commits to a goal over a fixed horizon --  a
// real plan is a commitment that survives a single bad tick, which is
// exactly what SWEEPER's per-tick reactivity could never do.
//
// Zero trainable parameters: goal selection is threshold logic over
// already-available hive_state/worldState fields (the same construction as
// VERIFIER and SWEEPER) -- no weights, no gradient tape, nothing for a
// checkpoint to serialize or a gradient to leak through.

const { RESOURCE_NORM_K } = require('./untrained-network.js');

const DEFAULT_HORIZON = 30; // OD3-resolved (raised from the design doc's N=15 placeholder)

const GOALS = Object.freeze({
  FORAGE_FOOD: 'FORAGE_FOOD',
  FORAGE_WOOD: 'FORAGE_WOOD',
  EXPAND_TERRITORY: 'EXPAND_TERRITORY',
  BUILD: 'BUILD'
});

// Per-goal boost applied to the verb(s) that serve it; every other verb
// (including idle, always) stays at 1.0 -- re-weight, never veto, per the
// design doc's S6 obligation.
const GOAL_BOOST = 2.0;

// verb(s) each goal boosts, aligned to untrained-network.js's VERB_ORDER.
const GOAL_VERBS = Object.freeze({
  [GOALS.FORAGE_FOOD]: ['gather-food'],
  [GOALS.FORAGE_WOOD]: ['gather-wood'],
  [GOALS.EXPAND_TERRITORY]: ['claim-territory'],
  [GOALS.BUILD]: ['build']
});

function createPlannerState(horizon = DEFAULT_HORIZON) {
  if (!Number.isInteger(horizon) || horizon <= 0) {
    throw new Error(`createPlannerState: horizon must be a positive integer, got ${JSON.stringify(horizon)}`);
  }
  return { horizon, currentGoal: null, ticksRemaining: 0 };
}

// Threshold read over already-available hive_state/worldState fields (own
// stockpile, own territory count, own structure count) -- the same fields
// encodeState() already reads (untrained-network.js:161-181), no new
// plumbing. RESOURCE_NORM_K (untrained-network.js's own half-saturation
// scale for stockpile normalization) is reused here as the "low stockpile"
// threshold rather than inventing a second, independent constant: a
// stockpile below its own normalization scale is the same "still scarce"
// regime the network's own input encoding already treats as such.
//
// Priority order, checked top to bottom (first match wins): food scarcity
// is checked first because food exhaustion carries the harness's own -2
// crossing penalty (train-tick.js's computeReward) -- the sharpest downside
// among the four goals -- then wood (build's own input). Once both
// stockpiles are healthy, BUILD is preferred while claimed territory
// outpaces built structures (own_structures < own_territory, both fields
// encodeState() already reads from worldState); once structures have
// caught up, EXPAND_TERRITORY. `worldState` is optional -- when absent
// (e.g. a caller with no board context yet), own_territory/own_structures
// default to 0 and the goal falls through to EXPAND_TERRITORY, same as
// today's SWEEPER-slot callers that never wired anything wider than
// hive_state.
function selectGoal(hiveState, worldState) {
  const stockpile = (hiveState && hiveState.hive_state && hiveState.hive_state.stockpile) || {};
  const food = stockpile.food || 0;
  const wood = stockpile.wood || 0;
  if (food < RESOURCE_NORM_K) return GOALS.FORAGE_FOOD;
  if (wood < RESOURCE_NORM_K) return GOALS.FORAGE_WOOD;
  const territory = (worldState && worldState.territory) || {};
  const identity = hiveState && hiveState.identity;
  const ownTerritory = Object.values(territory).filter((v) => v === identity).length;
  const geometry = (worldState && worldState.geometry_log) || [];
  const ownStructures = geometry.filter((g) => g.hive === identity).length;
  if (ownStructures < ownTerritory) return GOALS.BUILD;
  return GOALS.EXPAND_TERRITORY;
}

// Each tick: if ticksRemaining > 0, decrement and KEEP the goal (this is
// the actual planning behavior -- a commitment that survives a single bad
// tick). When ticksRemaining hits 0 (including the very first call, where
// state.currentGoal is still null), re-evaluate from current thresholds and
// re-commit for `state.horizon` ticks. Mutates and returns the same state
// object, matching sweeper-lane.js's recordOutcome() convention.
function advancePlanner(state, hiveState, worldState) {
  if (state.currentGoal !== null && state.ticksRemaining > 0) {
    state.ticksRemaining -= 1;
    return state;
  }
  state.currentGoal = selectGoal(hiveState, worldState);
  state.ticksRemaining = state.horizon;
  return state;
}

// multiplier(a) for each candidate verb: GOAL_BOOST for the verb(s) the
// current goal serves, 1.0 (no shaping) for every other verb -- idle
// included, unconditionally, per the design doc's S6 obligation (a
// feasible=0 multiplier is a de-facto per-verb veto; PLANNER must never
// treat idle as a target of goal-alignment boosts). Returns 1.0 for every
// verb when the state has no goal yet, OR when ticksRemaining has already
// reached 0 (Codex catch, pre-commit review: a caller that reads the
// multiplier before calling advancePlanner() on a tick where the
// commitment just expired must not still apply the STALE goal's boost --
// that would silently extend the horizon by one decision beyond
// `state.horizon`, an off-by-one this check exists to close). Callers
// should invoke advancePlanner() before this on every tick, but this stays
// honest (inert, not a fabricated boost) if they don't.
function computeGoalMultiplier(state, candidateVerbs) {
  const out = {};
  const active = Boolean(state && state.currentGoal && state.ticksRemaining > 0);
  const boostedVerbs = active ? (GOAL_VERBS[state.currentGoal] || []) : [];
  for (const verb of candidateVerbs) {
    if (verb === 'idle') { out[verb] = 1; continue; }
    out[verb] = boostedVerbs.includes(verb) ? GOAL_BOOST : 1;
  }
  return out;
}

module.exports = {
  createPlannerState, advancePlanner, computeGoalMultiplier, selectGoal,
  GOALS, GOAL_BOOST, GOAL_VERBS, DEFAULT_HORIZON
};
