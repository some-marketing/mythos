'use strict';

/*
 * Territory re-assertion — the unbounded free-reward pump.
 *
 * plan ant-sim-reward-specification-repair, S2.
 *
 * claimTerritory() returned a bare `{ok: true}` when the tile was ALREADY the
 * claiming hive's. Re-claiming a held tile therefore succeeded, changed
 * nothing, and was paid the full +1.5 acquisition weight — forever, on every
 * tick, with no bound. The policy found it: 198 of 302 claims "applied" over
 * the reference run, and 38 of 70 in the last-50 window while 0 of 10 gathers
 * applied. The hive had learned to farm a no-op.
 *
 * The repair is a specification repair, not a scoring hack. `claimTerritory`
 * now names which of three things actually happened — 'newly_acquired',
 * 'already_owned', 'contested' — and the reward reads THAT instead of
 * inferring value from `ok`. A re-assertion scores exactly 0: not a success
 * (+weight), not a failure (−0.5). It did not fail; it did nothing.
 *
 * `ok` semantics are deliberately UNCHANGED, and so is `applied`. A
 * re-assertion is still ok/applied true. Narrowing a published field to make a
 * downstream criterion pass is the exact class of defect this plan exists to
 * fix — so the fix has to be measurable on its own terms, which is what
 * `territory_outcome` and `territory_reward_contribution` are for.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { claimTerritory, readWorldState } = require('../world-state.js');
const { computeReward, territoryRewardContribution, resolveRewardWeights } = require('../train-tick.js');
const { setupTwoHives, tick } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');
const { architectureDescriptor } = require('../checkpoint.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-territory-reassert-'));
}

function worldWith(territory) {
  return { resources: {}, territory, geometry_log: [], pheromones: {} };
}

// ---------------------------------------------------------------------------
// claimTerritory: the three outcomes
// ---------------------------------------------------------------------------

test('claiming an UNOWNED tile is a genuine acquisition', () => {
  const before = worldWith({});
  const result = claimTerritory(before, 'tile-7', 'hive-a');

  assert.equal(result.ok, true);
  assert.equal(result.territory_outcome, 'newly_acquired');
  assert.equal(result.state.territory['tile-7'], 'hive-a', 'the tile is now owned');
  assert.deepEqual(before.territory, {}, 'the input state is not mutated');
});

test('RE-ASSERTING a tile you already own stays ok:true and changes nothing', () => {
  const before = worldWith({ 'tile-7': 'hive-a' });
  const result = claimTerritory(before, 'tile-7', 'hive-a');

  // `ok` is UNCHANGED — this is load-bearing. Callers map `applied` from it,
  // and a re-assertion did not fail, so it must not report as a failure.
  assert.equal(result.ok, true, 'ok semantics must not move');
  assert.equal(result.territory_outcome, 'already_owned');

  // ...and the world is materially unchanged.
  assert.deepEqual(result.state.territory, { 'tile-7': 'hive-a' });
  assert.deepEqual(result.state, before, 'no field of the world state changed');
});

test("claiming the OTHER hive's tile is contested and does not land", () => {
  const before = worldWith({ 'tile-7': 'hive-b' });
  const result = claimTerritory(before, 'tile-7', 'hive-a');

  assert.equal(result.ok, false);
  assert.equal(result.territory_outcome, 'contested');
  assert.equal(result.contested_by, 'hive-b', 'contested_by is preserved');
  assert.equal(result.state.territory['tile-7'], 'hive-b', 'ownership did not transfer');
});

// ---------------------------------------------------------------------------
// The reward: a re-assertion is worth exactly zero
// ---------------------------------------------------------------------------

test('a re-assertion contributes EXACTLY 0 territory reward', () => {
  const reassert = { verb: 'claim-territory', applied: true, territory_outcome: 'already_owned' };

  assert.equal(territoryRewardContribution(reassert), 0);
  assert.equal(computeReward(reassert, false), 0, 'not +1.5, and not -0.5 either');
});

test('the isolated component is what proves it — the total cannot', () => {
  // The aggregate reward also carries the -2 exhaustion penalty, so a total of
  // -2 is consistent with a territory component of 0 AND with several wrong
  // answers being partially cancelled. Exactly -2 with a separately reported
  // component of exactly 0 is the pair that actually pins it.
  const reassert = { verb: 'claim-territory', applied: true, territory_outcome: 'already_owned' };

  assert.equal(computeReward(reassert, true), -2, 'exhaustion penalty alone, nothing added');
  assert.equal(territoryRewardContribution(reassert), 0, 'and the component is zero, not merely small');
});

// S3 (plan ant-sim-reward-specification-repair) retuned the acquisition
// weight from 1.5 to 0.5. The literal moved; the invariant this test
// protects did not: a genuine acquisition still pays the CONFIGURED
// acquisition weight, and it still pays strictly more than a no-op
// re-assertion or a contested failure. Asserting against
// resolveRewardWeights() instead of a hand-copied literal means this test
// survives the next retune instead of pinning a number that will go stale
// again.
test('a genuine acquisition still pays the configured acquisition weight, and strictly beats no-op and failure', () => {
  const acquire = { verb: 'claim-territory', applied: true, territory_outcome: 'newly_acquired' };
  const reassert = { verb: 'claim-territory', applied: true, territory_outcome: 'already_owned' };
  const contested = { verb: 'claim-territory', applied: false, territory_outcome: 'contested' };
  const acquisitionWeight = resolveRewardWeights().claimTerritoryNew;

  assert.equal(territoryRewardContribution(acquire), acquisitionWeight);
  assert.equal(computeReward(acquire, false), acquisitionWeight);

  // THE ORDERING THAT ACTUALLY MATTERS: whatever the acquisition weight is
  // tuned to, a genuine acquisition must pay strictly more than a
  // re-assertion (exactly 0, S2's invariant) and strictly more than a
  // contested failure.
  assert.equal(territoryRewardContribution(reassert), 0);
  assert.ok(
    territoryRewardContribution(acquire) > territoryRewardContribution(reassert),
    'acquisition must strictly beat a no-op re-assertion'
  );
  assert.ok(
    territoryRewardContribution(acquire) > territoryRewardContribution(contested),
    'acquisition must strictly beat a contested failure'
  );
});

test('a contested claim still scores the wasted-turn penalty', () => {
  const contested = { verb: 'claim-territory', applied: false, territory_outcome: 'contested' };
  assert.equal(territoryRewardContribution(contested), -0.5);
  assert.equal(computeReward(contested, false), -0.5);
});

// S3 (plan ant-sim-reward-specification-repair) deliberately routes this
// absent-outcome fallback through resolveRewardWeights() rather than leaving
// a second hardcoded acquisition weight living outside the config table. The
// invariant this test protects is the SHAPE of the fallback -- an absent
// territory_outcome still scores as applied-vs-failed (it does not crash and
// does not silently collapse to 0) -- not the literal 1.5, which S3 retuned
// to 0.5 along with build's 2.0 -> 1.5. Asserting against
// resolveRewardWeights() keeps this test about the shape, not a snapshot of
// whichever numbers happened to ship at write time.
test('INERTNESS: with territory_outcome absent, scoring routes through the resolved config weight', () => {
  const weights = resolveRewardWeights();

  // Every pre-existing caller that does not opt in must still resolve
  // through the SAME shape: applied ? acquisition weight : failure weight.
  assert.equal(computeReward({ verb: 'claim-territory', applied: true }, false), weights.claimTerritoryNew);
  assert.equal(computeReward({ verb: 'claim-territory', applied: false }, false), weights.actionFailed);
  assert.equal(
    computeReward({ verb: 'claim-territory', applied: true, territory_outcome: null }, false),
    weights.claimTerritoryNew
  );

  // Non-territory verbs are untouched, and contribute no territory component.
  assert.equal(computeReward({ verb: 'gather', applied: true }, false), weights.gatherFoodApplied);
  assert.equal(computeReward({ verb: 'gather', applied: false }, false), weights.actionFailed);
  assert.equal(computeReward({ verb: 'build', applied: true }, false), weights.buildApplied);
  assert.equal(computeReward({ verb: 'build', applied: false }, false), weights.actionFailed);
  assert.equal(computeReward({ verb: 'idle' }, false), 0);
  assert.equal(territoryRewardContribution({ verb: 'gather', applied: true }), 0);
  assert.equal(territoryRewardContribution({ verb: 'idle' }), 0);
});

// ---------------------------------------------------------------------------
// harness.tick(): the outcome is carried through, `applied` is not repurposed
// ---------------------------------------------------------------------------

test('tick() carries territory_outcome through WITHOUT redefining applied', () => {
  const root = freshSandbox();
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(
    root,
    generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z'),
    generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z'),
    worldStatePath,
    { wood: 5 }
  );
  const claim = (tileId) => () => ({ verb: 'claim-territory', tileId });

  const first = tick(hiveA, worldStatePath, claim('tile-3'));
  assert.equal(first.applied, true);
  assert.equal(first.territory_outcome, 'newly_acquired');

  // THE POINT: a re-assertion is STILL applied: true. The raw applied count
  // does not fall when the pump is closed — which is exactly why the outcome
  // has to be published in its own right to be measurable.
  const again = tick(hiveA, worldStatePath, claim('tile-3'));
  assert.equal(again.applied, true, 'applied still maps from ok — unchanged');
  assert.equal(again.territory_outcome, 'already_owned');

  const contested = tick(hiveB, worldStatePath, claim('tile-3'));
  assert.equal(contested.applied, false);
  assert.equal(contested.territory_outcome, 'contested');

  assert.equal(readWorldState(worldStatePath).territory['tile-3'], 'hive-a');
});

// plan ant-sim-reward-specification-repair, S5-a3 field contract (codex
// distinct review fix): the plan's own expected_outcomes declared a FOUR-
// member enum -- ['newly_acquired', 'already_owned', 'contested',
// 'not_applicable'] -- with 'not_applicable' mapped for gather, build, and
// idle. Emitting null/undefined for those verbs is a schema violation of that
// contract, not an equivalent encoding of "doesn't apply." This test used to
// assert null here; that assertion was wrong against the plan and is
// corrected below.
test('non-territory verbs report the literal string "not_applicable" territory_outcome, never null', () => {
  const root = freshSandbox();
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(
    root,
    generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z'),
    generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z'),
    worldStatePath,
    { wood: 5 }
  );

  const idleResult = tick(hiveA, worldStatePath, () => ({ verb: 'idle' }));
  assert.equal(idleResult.territory_outcome, 'not_applicable');
  assert.notEqual(idleResult.territory_outcome, null);
  assert.notEqual(idleResult.territory_outcome, undefined);

  const gatherResult = tick(hiveA, worldStatePath, () => ({ verb: 'gather', resourceKey: 'wood', amount: 1 }));
  assert.equal(gatherResult.territory_outcome, 'not_applicable');

  // build: reuse hiveA's remaining wood stockpile so the build actually
  // applies -- the field contract holds whether or not the build itself
  // succeeds, but exercising the success path is the more faithful check.
  const buildResult = tick(hiveA, worldStatePath, () => ({ verb: 'build', entry: {} }));
  assert.equal(buildResult.territory_outcome, 'not_applicable');

  // Even a rejected verb, which returns early, carries the field.
  const rejectedResult = tick(hiveA, worldStatePath, () => ({ verb: 'not-a-verb' }));
  assert.equal(rejectedResult.territory_outcome, 'not_applicable');
});

test('the four-member territory_outcome enum is exhaustive', () => {
  const ENUM = ['newly_acquired', 'already_owned', 'contested', 'not_applicable'];
  assert.equal(ENUM.length, 4);
  assert.deepEqual([...new Set(ENUM)], ENUM, 'no duplicate members');
});

// ---------------------------------------------------------------------------
// The bound: territory reward is finite because the board is finite
// ---------------------------------------------------------------------------

test('claimTerritory never releases a held tile — ownership is monotone', () => {
  // Read of the code (world-state.js claimTerritory): there is no path that
  // deletes a territory key or reassigns one away from its owner. The
  // 'contested' branch returns the state untouched, 'already_owned' returns
  // the same object, and 'newly_acquired' only ADDS a key. This test is the
  // behavioural proof of that reading.
  let state = worldWith({});
  const owners = {};
  const hives = ['hive-a', 'hive-b'];
  let previousCount = 0;

  for (let round = 0; round < 3; round++) {
    for (let n = 0; n < 100; n++) {
      for (const hive of hives) {
        state = claimTerritory(state, `tile-${n}`, hive).state;
        const count = Object.keys(state.territory).length;
        assert.ok(count >= previousCount, 'territory count never decreases');
        previousCount = count;
        for (const [tileId, owner] of Object.entries(owners)) {
          assert.equal(state.territory[tileId], owner, `${tileId} never changed hands`);
        }
        owners[`tile-${n}`] = state.territory[`tile-${n}`];
      }
    }
  }
});

test('cumulative newly_acquired across BOTH hives can never exceed 100', () => {
  // TILE_GRID_SIZE is 10, so the board is 10x10 = 100 tiles — and it is ONE
  // board SHARED by both hives, not one each. Combined with monotonicity
  // above, 'newly_acquired' fires at most once per tile, ever. That is what
  // makes the territory reward bounded rather than a pump: at most 100
  // acquisitions of +1.5 exist in the whole world, for all hives together.
  const TOTAL_TILES = 100;
  let state = worldWith({});
  let acquisitions = 0;

  // Drive every tile with both hives, three times over — far more claim
  // attempts (600) than there are tiles.
  for (let round = 0; round < 3; round++) {
    for (let n = 0; n < TOTAL_TILES; n++) {
      for (const hive of ['hive-a', 'hive-b']) {
        const result = claimTerritory(state, `tile-${n}`, hive);
        if (result.territory_outcome === 'newly_acquired') acquisitions += 1;
        state = result.state;
      }
    }
  }

  assert.equal(acquisitions, TOTAL_TILES, 'exactly one acquisition per tile, over 600 attempts');
  assert.ok(acquisitions <= TOTAL_TILES, 'and never more than the board holds');
  assert.equal(Object.keys(state.territory).length, TOTAL_TILES);

  // Under the OLD semantics all 600 of those attempts that returned ok:true
  // would have paid the acquisition weight. Under the repair, the total
  // territory reward available in the entire world is bounded by the board:
  // exactly TOTAL_TILES acquisitions, each paying the CURRENT resolved
  // acquisition weight -- not a hand-copied literal (S3 retuned this weight
  // from 1.5 to 0.5; a hardcoded 150 here would have gone stale and stopped
  // meaning anything).
  const acquisitionWeight = resolveRewardWeights().claimTerritoryNew;
  assert.equal(acquisitions * acquisitionWeight, TOTAL_TILES * acquisitionWeight);
});

// ---------------------------------------------------------------------------
// The lineage pin
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// C2 (codex distinct review, second pass): "dead-code-by-contract is not the
// same as null-free". harness.js:207 used to read
// `result.territory_outcome ?? null` -- a defensive fallback whose fallback
// value sits OUTSIDE the four-member enum. claimTerritory() in world-state.js
// is contractually guaranteed to always return a real outcome, so this branch
// is unreachable through the real implementation -- which is exactly why it
// has to be pinned by stubbing claimTerritory rather than driving it through
// the normal seam. The module-cache swap below is the narrowest reachable
// seam: it replaces ONLY claimTerritory, keeps every other world-state export
// real (tick() also calls readWorldState/writeWorldState/decayPheromones/
// etc. in the same pass), and is torn down immediately after the assertion so
// no other test in this file observes the stub.
// ---------------------------------------------------------------------------

test('C2: claim-territory branch coalesces a missing territory_outcome to a valid enum member, never null/undefined', () => {
  const worldStateModulePath = require.resolve('../world-state.js');
  const harnessModulePath = require.resolve('../harness.js');
  const realWorldStateModule = require.cache[worldStateModulePath];
  assert.ok(realWorldStateModule, 'world-state.js must already be cached by the top-of-file require');

  const realWorldStateExports = realWorldStateModule.exports;
  const stubbedExports = Object.assign({}, realWorldStateExports, {
    // Mirrors claimTerritory's real 'ok: true' shape but OMITS
    // territory_outcome entirely -- the exact contract break C2 is about:
    // claimTerritory changing shape without harness.js failing loudly.
    claimTerritory: (state /*, tileId, hiveIdentity */) => ({ ok: true, state })
  });

  // Swap the cached world-state module for the stub, then force a fresh
  // require of harness.js so its top-level
  // `const { claimTerritory } = require('./world-state.js')` destructure
  // picks up the stub instead of the real function.
  require.cache[worldStateModulePath] = { ...realWorldStateModule, exports: stubbedExports };
  delete require.cache[harnessModulePath];

  let stubbedHarness;
  try {
    stubbedHarness = require(harnessModulePath);
  } finally {
    // Restore immediately so any require() after this point -- including a
    // later fresh require of harness.js -- sees the real module again.
    require.cache[worldStateModulePath] = realWorldStateModule;
    delete require.cache[harnessModulePath];
  }

  const root = freshSandbox();
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = stubbedHarness.setupTwoHives(
    root,
    generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z'),
    generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z'),
    worldStatePath,
    { wood: 5 }
  );

  const result = stubbedHarness.tick(hiveA, worldStatePath, () => ({ verb: 'claim-territory', tileId: 'tile-42' }));

  // THE POINT: line 207's fallback fires (the stub's claimTerritory result
  // has no territory_outcome key at all), and what comes out is a valid
  // enum member -- never the null harness.js:207 used to emit.
  assert.notEqual(result.territory_outcome, null, 'must not be null');
  assert.notEqual(result.territory_outcome, undefined, 'must not be undefined');
  assert.equal(result.territory_outcome, 'not_applicable');
  assert.ok(
    ['newly_acquired', 'already_owned', 'contested', 'not_applicable'].includes(result.territory_outcome),
    'must be a member of the declared four-member enum'
  );

  // The anomaly must be visible to the summarizer, not silently swallowed --
  // this is the "defensible third option" (coalesce + record) chosen over a
  // silent `?? 'not_applicable'` or a per-tick-hot-path throw.
  const auditLines = fs.readFileSync(hiveA.auditLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const anomaly = auditLines.find((e) => e.event === 'territory-outcome-contract-violation');
  assert.ok(anomaly, 'the contract violation must be recorded in the audit log');
  assert.equal(anomaly.hive, 'hive-a');

  // Prove the restoration in the `finally` above actually took, rather than
  // merely trusting it. Fetch world-state.js WITHOUT deleting its cache
  // entry first -- that surfaces exactly what the `finally` block left
  // behind, real module or stub. Then delete-and-fresh-require harness.js
  // so its top-level `const { claimTerritory } = require('./world-state.js')`
  // destructure re-binds from whatever is currently cached for world-state.
  // A stub left in place would still coalesce to 'not_applicable' on a
  // missing key, but the real claimTerritory on a truly unowned tile
  // returns 'newly_acquired' -- a value the stub can never produce (it has
  // no territory_outcome logic at all). If restoration silently failed,
  // both assertions below go red.
  const restoredWorldState = require(worldStateModulePath);
  assert.notEqual(restoredWorldState.claimTerritory, stubbedExports.claimTerritory,
    'world-state.js must not still export the stub claimTerritory after restoration');

  delete require.cache[harnessModulePath];
  const restoredHarness = require(harnessModulePath);

  const restoredRoot = freshSandbox();
  const restoredWorldStatePath = path.join(restoredRoot, 'shared', 'world-state.json');
  const { hiveA: restoredHiveA } = restoredHarness.setupTwoHives(
    restoredRoot,
    generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z'),
    generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z'),
    restoredWorldStatePath,
    { wood: 5 }
  );
  const restoredResult = restoredHarness.tick(
    restoredHiveA,
    restoredWorldStatePath,
    () => ({ verb: 'claim-territory', tileId: 'tile-42' })
  );
  assert.equal(restoredResult.territory_outcome, 'newly_acquired',
    'the freshly-required harness.js must run the genuine claimTerritory, which reports newly_acquired on an unowned tile -- the stub cannot produce this value');
});

test('LINEAGE PIN: shape_hash is unchanged by this repair', () => {
  // checkpoint.js shapeDomain() hashes VERB_ORDER, harness VERBS,
  // WORLD_VERB_ORDER, and (as of plan ant-sim-nine-mind-harness-triad-
  // architecture, S2/S3) a `lanes` descriptor into shape_hash, and
  // checkpoint.js REFUSES a restore on a shape_hash mismatch.
  //
  // UPDATED, DELIBERATELY, this session: adding the VERIFIER/SWEEPER `lanes`
  // descriptor to shapeDomain() (checkpoint.js) moves this hash for every
  // generation, hive-B and the world mind included -- this IS the mechanism
  // that forces a fresh lineage root, not a defect. The break is
  // operator-authorized (2026-08-11, "Once this has the shape of the 3x3
  // it'll start from scratch anyway" / "Yes re lineage") and covered by
  // checkpoint-lane-state.test.cjs's own falsifiable assertion that
  // shape_hash moves once `lanes` exists. The gen-150/300/450 lineage is
  // retained read-only; it does not restore against this new hash, by
  // design (plan §3).
  //
  // UPDATED AGAIN, DELIBERATELY, this session (plan world-mind-dream-
  // communication, S4, AMENDMENT v8's shape_hash acknowledgement): the hive
  // network's INPUT_SIZE grows 9->18 (untrained-network.js, the dream-as-
  // perception attachment point), and checkpoint.js's architectureDescriptor()
  // reads INPUT_SIZE live (not hardcoded) -- so shape_hash moves again, for
  // the SAME reason and by the SAME precedented mechanism the VERIFIER/
  // SWEEPER triad's own landing already established (see this test's own
  // comment above): "a genuine, acknowledged network-shape change... forcing
  // a fresh lineage root, by construction, not by convention." Pre-
  // acknowledged in the plan's AC6/AC7, not a defect. The gen-150/300/450
  // (pre-triad) and gen-*/triad lineages are both retained read-only; neither
  // restores against this new hash, by design.
  //
  // Prior control value (VERIFIER/SWEEPER triad, pre-S4):
  // 'ebeea39d956dbcc74de984240dec1f7392aca00afcecfcd78139f037ae2351a5'.
  // Prior-prior control value (pre-triad, commit 756bb0b4407d2d2a481a5db89ba26f2a026f9fbc):
  // '22ebdb6837f129b6977c21a0c92d4bfaf9bad61429cfe54321e67b82ac1037e9'.
  const CONTROL_SHAPE_HASH = '54653f33174c8a26f67ffb522a89720fa7d1ec56253c38c818e4bf6cc1072f3e';

  assert.equal(architectureDescriptor().shape_hash, CONTROL_SHAPE_HASH);
});
