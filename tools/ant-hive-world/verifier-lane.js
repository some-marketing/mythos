#!/usr/bin/env node
'use strict';

// tools/ant-hive-world/verifier-lane.js — the VERIFIER lane, plan
// ant-sim-nine-mind-harness-triad-architecture, S2. Modelled on Codex's role
// in the Mythos review relay: it does not generate anything, it checks a
// candidate against ACTUAL, CURRENT, ground-truth state, using the same code
// the harness itself will run at commit time -- never a second, independently
// reimplemented copy of that logic, so it cannot drift from what the harness
// actually does.
//
// Zero trainable parameters. This module holds no state across calls and
// has no backward pass -- there is nothing for a checkpoint to serialize and
// nothing for a gradient to leak through, which is what makes "the validator
// never becomes the producer" true by construction for this lane rather than
// by discipline.
// L2 (plan ant-sim-three-lobe-lane-redesign): BREADTH folded into this slot
// per design doc S4's body text as written (OD4-resolved -- the debrief's
// 'factored breadth score' has no concrete spec in the body and is NOT
// implemented here; see the plan's OD4.resolution and its tracked follow-up
// signal). Still zero trainable parameters, still a pure function of the
// arguments -- the added reads (worldState.territory's full board,
// worldState.resources magnitudes) arrive through the arguments this module
// already takes, not new state, weights, or an opponent-hiveState wiring
// (that alternative was named and explicitly not taken, design doc S1/S4).
const { canAffordBuild, BUILD_COST } = require('./harness.js');
const { claimTerritory, parseTileIndex, TILE_GRID_SIZE } = require('./world-state.js');

// OD3-resolved: Chebyshev/Moore radius 1 -- the 8-neighborhood around a
// candidate tile, 9 tiles total including the candidate on an interior
// tile, clipped to the board at edges/corners. Locked at L6's prereg step;
// if the graduated score collapses to effectively-binary at this radius,
// that is reported per acceptance criteria, not silently re-tuned here.
const BREADTH_CONTESTED_RADIUS = 1;

// AUTHOR's 5-verb space (untrained-network.js VERB_ORDER) does not line up
// 1:1 with the harness's own 4-verb VERBS (harness.js:44) -- gather-food and
// gather-wood both map to the harness's single 'gather' verb, disambiguated
// by resourceKey. This mapping is new, plan-owned code (not an existing
// predicate to cite) -- it is a translation layer, not a ground-truth check
// in itself.
const RESOURCE_VERB_MAP = { 'gather-food': 'food', 'gather-wood': 'wood' };

// contested_density (design doc S4, OD3-resolved radius=1): the fraction of
// on-board tiles within Chebyshev radius 1 of the candidate (candidate
// included -- 9 tiles on an interior tile, clipped at edges/corners) that
// are owned by ANOTHER hive. Own-hive and unowned tiles are not contested.
// Returns null when the tile id carries no parsable board index -- the
// caller treats that as "no density computable" and applies no gradation,
// the same honest-gap convention as the missing-claimTileId default above.
function contestedDensity(territory, tileId, ownIdentity) {
  const index = parseTileIndex(tileId);
  if (index === null || index === undefined) return null;
  const cx = index % TILE_GRID_SIZE;
  const cy = Math.floor(index / TILE_GRID_SIZE);
  if (cy >= TILE_GRID_SIZE) return null;
  let total = 0;
  let contested = 0;
  for (let dy = -BREADTH_CONTESTED_RADIUS; dy <= BREADTH_CONTESTED_RADIUS; dy++) {
    for (let dx = -BREADTH_CONTESTED_RADIUS; dx <= BREADTH_CONTESTED_RADIUS; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= TILE_GRID_SIZE || y < 0 || y >= TILE_GRID_SIZE) continue;
      total += 1;
      // The candidate's own slot counts in the denominator but NEVER as
      // contested (codex pre-commit blocker): parseTileIndex accepts alias
      // ids (bare '55', arbitrary '-55' suffixes) whose canonical `tile-55`
      // key can be opponent-owned while the alias key is open -- without
      // this guard that alias would count its own canonical position as
      // contested, density could reach total/total, and the score would hit
      // 0, a de-facto veto. With it, density <= (total-1)/total and
      // never-zero holds by construction for every id parseTileIndex admits.
      if (dx === 0 && dy === 0) continue;
      const owner = territory[`tile-${y * TILE_GRID_SIZE + x}`];
      if (owner !== undefined && owner !== ownIdentity) contested += 1;
    }
  }
  return total > 0 ? contested / total : null;
}

// Per-candidate feasibility, computed fresh from the CURRENT state every
// call -- feasible(a) in {0, 1}. `claimTileId`, when supplied, is the tile
// the caller's claim-territory candidate would target (decide()'s own
// candidate-generation already produces one, untrained-network.js:277);
// when absent, claim-territory defaults to feasible=1 rather than
// fabricating a check this module cannot honestly make without a tile.
function verifyFeasibility(candidateVerbs, hiveState, worldState, options = {}) {
  const currentStockpile = (hiveState && hiveState.hive_state && hiveState.hive_state.stockpile) || {};
  const buildCostWood = (options.liveConfig && options.liveConfig.build_cost_wood) ?? BUILD_COST.wood;
  const claimTileId = options.claimTileId;
  const out = {};
  for (const verb of candidateVerbs) {
    if (verb in RESOURCE_VERB_MAP) {
      // L2 breadth: a MAGNITUDE check against the shared pool quantity
      // (worldState.resources.food / .wood), replacing the old food_sources
      // entry-count presence check -- an entry whose summed quantity is 0 is
      // no longer "feasible". resources.food is maintained by world-state.js
      // as sumFoodSources(food_sources), so this reads the same board, at
      // quantity rather than entry granularity.
      const resourceKey = RESOURCE_VERB_MAP[verb];
      const pool = worldState.resources?.[resourceKey] || 0;
      out[verb] = pool > 0 ? 1 : 0;
    } else if (verb === 'build') {
      out[verb] = canAffordBuild(currentStockpile, { wood: buildCostWood }) ? 1 : 0;
    } else if (verb === 'claim-territory') {
      if (!claimTileId) { out[verb] = 1; continue; }
      // Read-only: claimTerritory() returns a NEW state object on success and
      // does not mutate `worldState` -- the returned state is discarded here,
      // only `ok` is read. Feasible means "would not be a hard failure";
      // 'already_owned' still counts as feasible (it is a legitimate no-op
      // claim, scored 0 by the reward contract, not rejected by the harness).
      const result = claimTerritory(worldState, claimTileId, hiveState.identity);
      if (!result.ok) { out[verb] = 0; continue; }
      // L2 breadth (design doc S4): the already-decided cases are unchanged
      // -- a contested tile is still 0 above, re-asserting an already-owned
      // tile is still exactly 1. Only the previously-flat OPEN-tile case
      // (neither hive owns it yet) gains gradation: scale 1.0 down by
      // contested_density, so an open tile ringed by opponent claims scores
      // lower than one in neutral ground. Never zero by construction: the
      // open candidate itself sits in its own neighborhood and is unowned,
      // so density <= (total-1)/total and the score stays >= 1/total.
      // Re-weight, not veto (S6) -- idle is untouched in every path.
      const owner = (worldState.territory || {})[claimTileId];
      if (owner !== undefined) { out[verb] = 1; continue; } // already_owned no-op re-claim
      const density = contestedDensity(worldState.territory || {}, claimTileId, hiveState.identity);
      out[verb] = density === null ? 1 : 1 - density;
    } else {
      out[verb] = 1; // idle, or any verb with no known ground-truth precondition
    }
  }
  return out;
}

module.exports = { verifyFeasibility, contestedDensity, RESOURCE_VERB_MAP, BREADTH_CONTESTED_RADIUS };
