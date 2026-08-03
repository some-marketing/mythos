'use strict';

/*
 * Reward contract v2 — regression tests for the inverted foraging incentive.
 *
 * v1 penalized the positive-to-zero CROSSING (`starved`). A hive already at
 * zero food never crosses, so v1 scored idling (0) above gathering (-1) in the
 * exact state where foraging is most urgent. These tests pin the invariant that
 * violation broke, so it cannot silently return.
 *
 * Found by a third-family (gemini) review of PR #6 on 2026-08-03, and verified
 * against the code before the fix.
 */

const test = require('node:test');
const assert = require('node:assert');

const { applyUpkeep } = require('../untrained-network.js');
const { computeReward } = require('../train-tick.js');

function hiveWithFood(food) {
  return { hive_state: { stockpile: { food } } };
}

test('applyUpkeep distinguishes the crossing from the exhaustion state', () => {
  // Already at zero: no crossing (nothing to cross from), but exhausted.
  const atZero = applyUpkeep(hiveWithFood(0), 1);
  assert.equal(atZero.starved, false, 'a hive already at zero does not cross');
  assert.equal(atZero.foodExhausted, true, 'but it does end the tick with nothing');

  // Exactly enough to be drained: this is the crossing, and also exhaustion.
  const crossing = applyUpkeep(hiveWithFood(1), 1);
  assert.equal(crossing.starved, true);
  assert.equal(crossing.foodExhausted, true);

  // Comfortable: neither.
  const fed = applyUpkeep(hiveWithFood(5), 1);
  assert.equal(fed.starved, false);
  assert.equal(fed.foodExhausted, false);
});

// SCOPE CORRECTION (codex distinct review, 2026-08-03): the invariant holds for
// SUCCESSFUL gathers only. A FAILED gather at zero food scores -2.5 against
// idle's -2, because the -0.5 wasted-turn penalty stacks on the exhaustion
// penalty. That is arguably a defensible "don't forage at an empty patch"
// signal, but it is NOT the blanket claim originally written here, and failure
// is reachable — world-state.js rejects claims against missing or insufficient
// patches. The blanket phrasing was an overclaim; this is the true invariant.
test('THE INVARIANT: a SUCCESSFUL gather weakly dominates idling in every food state', () => {
  for (const startFood of [0, 1, 2, 5, 20]) {
    // Idle: stockpile untouched by the action, then upkeep.
    const idleUpkeep = applyUpkeep(hiveWithFood(startFood), 1);
    const idleReward = computeReward({ verb: 'idle', applied: true }, idleUpkeep.foodExhausted);

    // Gather: +1 food from the action, then upkeep.
    const gatherUpkeep = applyUpkeep(hiveWithFood(startFood + 1), 1);
    const gatherReward = computeReward({ verb: 'gather', applied: true }, gatherUpkeep.foodExhausted);

    assert.ok(
      gatherReward >= idleReward,
      `at food=${startFood}, gathering (${gatherReward}) must not score below idling (${idleReward})`
    );
  }
});

test('the specific v1 inversion is gone: at zero food, gathering beats idling', () => {
  // This is the exact case v1 got backwards: idle scored 0, gather scored -1.
  const idle = applyUpkeep(hiveWithFood(0), 1);
  const gather = applyUpkeep(hiveWithFood(1), 1); // 0 + 1 gathered

  const idleReward = computeReward({ verb: 'idle', applied: true }, idle.foodExhausted);
  const gatherReward = computeReward({ verb: 'gather', applied: true }, gather.foodExhausted);

  assert.equal(idleReward, -2, 'idling into exhaustion is now penalized');
  assert.equal(gatherReward, -1, 'gathering into exhaustion is still penalized, but less');
  assert.ok(gatherReward > idleReward, 'gathering must strictly beat idling here');
});

test('a gather that escapes exhaustion is unpenalized', () => {
  const gather = applyUpkeep(hiveWithFood(2), 1); // 1 + 1 gathered -> 2, upkeep -> 1
  assert.equal(gather.foodExhausted, false);
  assert.equal(computeReward({ verb: 'gather', applied: true }, gather.foodExhausted), 1);
});

test('DOCUMENTED EXCEPTION: a FAILED gather scores below idling when exhausted', () => {
  // Pinned deliberately so this stays a known, chosen property rather than a
  // surprise. If the -0.5 wasted-turn penalty is ever reconsidered, this test
  // is the record of what the current signal actually says.
  const exhausted = applyUpkeep(hiveWithFood(0), 1);
  assert.equal(exhausted.foodExhausted, true);

  const idleReward = computeReward({ verb: 'idle', applied: true }, exhausted.foodExhausted);
  const failedGather = computeReward({ verb: 'gather', applied: false }, exhausted.foodExhausted);

  assert.equal(idleReward, -2);
  assert.equal(failedGather, -2.5);
  assert.ok(failedGather < idleReward, 'a failed forage costs more than doing nothing');
});

test('failed actions and build/claim rewards are unchanged from v1', () => {
  assert.equal(computeReward({ verb: 'gather', applied: false }, false), -0.5);
  assert.equal(computeReward({ verb: 'build', applied: true }, false), 2);
  assert.equal(computeReward({ verb: 'build', applied: false }, false), -0.5);
  assert.equal(computeReward({ verb: 'claim-territory', applied: true }, false), 1.5);
  assert.equal(computeReward({ verb: 'idle', applied: true }, false), 0);
});

test('the exhaustion penalty applies regardless of which action was taken', () => {
  for (const verb of ['idle', 'gather', 'build', 'claim-territory']) {
    const withPenalty = computeReward({ verb, applied: true }, true);
    const without = computeReward({ verb, applied: true }, false);
    assert.equal(without - withPenalty, 2, `${verb}: exhaustion must cost exactly 2`);
  }
});
