'use strict';

// Red-then-green coverage for the territory-verifier blind-spot fix (plan
// ant-sim-nine-mind-harness-triad-architecture, S3 follow-up): before this
// fix, trainTick() called verifyFeasibility() for claim-territory with no
// candidate tile, so verifier-lane.js's own documented fallback made
// claim-territory feasible=1 unconditionally -- VERIFIER never actually
// checked this verb against contested territory, even when the tile the
// network was about to target was already owned by the other hive.
//
// This test pins the tile the run will target (via a deterministic rng),
// seeds that exact tile as contested BEFORE the tick runs, and asserts that
// a network overwhelmingly biased toward claim-territory has its argmax
// changed away from it -- which is only possible if VERIFIER's feasibility
// check actually received the real candidate tile.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { setupHives } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');
const { trainTick } = require('../train-tick.js');
const { readWorldState, writeWorldState, claimTerritory } = require('../world-state.js');
const { pickClaimTerritoryTile } = require('../untrained-network.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-territory-verifier-'));
}

// A network hand-crafted so forward() overwhelmingly favors 'claim-territory'
// (VERB_ORDER index 3) regardless of input.
function claimBiasedNetwork() {
  const HIDDEN = 8, INPUT = 9, OUTPUT = 5;
  const W1 = Array.from({ length: HIDDEN }, () => Array.from({ length: INPUT }, () => 0));
  const b1 = Array.from({ length: HIDDEN }, () => 1);
  const W2 = Array.from({ length: OUTPUT }, (_, i) => Array.from({ length: HIDDEN }, () => (i === 3 ? 5 : -5)));
  const b2 = Array.from({ length: OUTPUT }, () => 0);
  return { W1, b1, W2, b2 };
}

test('trainTick wires VERIFIER into claim-territory: a contested candidate tile suppresses the argmax even when AUTHOR strongly prefers claim-territory', () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 10 });
  const hive = hives['hive-a'];

  // Fixed rng -> pickClaimTerritoryTile draws the same tile trainTick will
  // draw for real. Seed that EXACT tile as owned by hive-b before the tick.
  const rng = () => 0.01;
  const candidateTile = pickClaimTerritoryTile(rng);
  const before = readWorldState(worldStatePath);
  const claimed = claimTerritory(before, candidateTile, 'hive-b');
  assert.equal(claimed.ok, true);
  writeWorldState(worldStatePath, claimed.state);

  const network = claimBiasedNetwork();
  const laneState = { verifierEnabled: true, sweeperState: undefined, gammaSweep: 1 };

  const result = trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);

  // The wiring must exist and must have seen the REAL candidate tile: AUTHOR's
  // raw policy overwhelmingly favors claim-territory, but the specific tile it
  // would target is contested -- VERIFIER must change the argmax away from it.
  assert.equal(typeof result.verifier_changed_argmax, 'boolean');
  assert.equal(result.verifier_changed_argmax, true, 'VERIFIER must flag the contested claim-territory candidate as infeasible, not default to feasible=1');
  assert.notEqual(result.action, 'claim-territory', 'the applied action must not be the contested claim-territory candidate once probs\' has zeroed it out before sampling');
});

test('B0-style laneState (verifierEnabled:false, no sweeperState) still draws the candidate tile for RNG parity but never uses it to shape probs', () => {
  const root = freshSandbox();
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-11T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, [seed], worldStatePath, { food: 10, wood: 10 });
  const hive = hives['hive-a'];

  const rng = () => 0.01;
  const candidateTile = pickClaimTerritoryTile(rng);
  const before = readWorldState(worldStatePath);
  const claimed = claimTerritory(before, candidateTile, 'hive-b');
  writeWorldState(worldStatePath, claimed.state);

  const network = claimBiasedNetwork();
  const laneState = { verifierEnabled: false, sweeperState: undefined, gammaSweep: 1 };

  const result = trainTick(hive, worldStatePath, network, rng, {}, 0, undefined, {}, laneState);

  // VERIFIER is disabled for this arm -- the contested tile must NOT suppress
  // the argmax; the applied action is still claim-territory even though it's
  // contested (harness will score it as territory_outcome: 'contested').
  assert.equal(result.verifier_changed_argmax, false);
  assert.equal(result.action, 'claim-territory');
});
