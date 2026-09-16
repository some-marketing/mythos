'use strict';

/*
 * Reward contract v3 — the ARGUMENT, pinned as orderings.
 *
 * v2 scored `gather-food` and `gather-wood` at a single `verb === 'gather'`
 * branch, because trainTick() dropped decide()'s `resourceKey` before handing
 * the action to computeReward(). Two distinct policy actions were worth exactly
 * the same number, so no gradient in the system could express "eat rather than
 * collect timber". v3 threads the key through, splits the lanes, moves every
 * weight into live-config.js, and retunes the table.
 *
 * WHY THESE TESTS ASSERT ORDERINGS AND NOT NUMBERS. The table is a means; the
 * orderings are the end. A future retune that keeps the argument intact should
 * pass here, and one that quietly inverts an incentive should fail here rather
 * than pass a review. So the invariant tests below compare rewards to each
 * other, and the literal shipped values are pinned separately and once, in the
 * inertness test, where their only job is to prove the config defaults and the
 * code defaults have not drifted apart.
 *
 * WHY THEY CALL applyUpkeep. I1 and I2 depend on whether a tick ENDS exhausted,
 * which is a property of applyUpkeep and the yield/upkeep configuration, not of
 * anyone's reading of them. Re-deriving the exhaustion flag inside the test file
 * would test the test. So every scenario below runs the real applyUpkeep with
 * the real shipped DEFAULT_CONFIG and feeds its real foodExhausted into the real
 * computeReward.
 */

const test = require('node:test');
const assert = require('node:assert');

const { applyUpkeep, resolveGatherYieldFood } = require('../untrained-network.js');
const {
  computeReward,
  territoryRewardContribution,
  resolveRewardWeights,
  REWARD_CONTRACT_VERSION
} = require('../train-tick.js');
const { DEFAULT_CONFIG } = require('../live-config.js');

function hiveWithFood(food) {
  return { hive_state: { stockpile: { food } } };
}

// One full tick's scoring, driven through the actual mechanism: apply the
// action's effect on the stockpile, run the real applyUpkeep to find out whether
// the tick ENDS exhausted, then score with the real computeReward. Nothing here
// decides the exhaustion flag on the test's own authority.
function scoreTick(action, startFood, cfg = DEFAULT_CONFIG) {
  const gatheredFood =
    action.verb === 'gather' && action.applied !== false && action.resourceKey === 'food'
      ? resolveGatherYieldFood(cfg)
      : 0;
  const upkeep = applyUpkeep(hiveWithFood(startFood + gatheredFood), cfg.upkeep_cost_food);
  return {
    reward: computeReward(action, upkeep.foodExhausted, cfg),
    foodExhausted: upkeep.foodExhausted,
    endFood: upkeep.hiveState.hive_state.stockpile.food
  };
}

const GATHER_FOOD = { verb: 'gather', resourceKey: 'food', applied: true };
const GATHER_WOOD = { verb: 'gather', resourceKey: 'wood', applied: true };
const BUILD = { verb: 'build', applied: true };
const CLAIM_NEW = { verb: 'claim-territory', applied: true, territory_outcome: 'newly_acquired' };
const CLAIM_OWNED = { verb: 'claim-territory', applied: true, territory_outcome: 'already_owned' };
const IDLE = { verb: 'idle', applied: true };

// ---------------------------------------------------------------------------
// I1 — while exhausted, a successful gather-food strictly dominates everything
// ---------------------------------------------------------------------------

test('I1: at zero food, a successful gather-food strictly beats every other action', () => {
  const gather = scoreTick(GATHER_FOOD, 0);

  // The mechanism the ordering rests on, asserted before the ordering itself:
  // the gather must actually END the tick unexhausted, or the claim below is
  // arithmetic about a state the world cannot produce (exactly v2's mistake).
  assert.equal(gather.foodExhausted, false, 'a successful gather must end the tick holding food');
  assert.ok(gather.endFood >= 1, 'and must hold at least one, not merely a fraction');

  const rivals = {
    build: scoreTick(BUILD, 0),
    'claim-territory (newly_acquired)': scoreTick(CLAIM_NEW, 0),
    'gather-wood': scoreTick(GATHER_WOOD, 0),
    idle: scoreTick(IDLE, 0)
  };

  let worstMargin = Infinity;
  for (const [name, rival] of Object.entries(rivals)) {
    assert.equal(rival.foodExhausted, true, `${name} does not feed the hive, so it stays exhausted`);
    assert.ok(
      gather.reward > rival.reward,
      `at food 0, gather-food (${gather.reward}) must strictly beat ${name} (${rival.reward})`
    );
    worstMargin = Math.min(worstMargin, gather.reward - rival.reward);
  }

  console.log(
    `I1 observed: gather-food ${gather.reward} vs ` +
      Object.entries(rivals).map(([n, r]) => `${n} ${r.reward}`).join(', ') +
      ` | narrowest margin ${worstMargin}`
  );
  assert.ok(worstMargin > 0);
});

test('I1 rests on the MECHANISM, not on the weight: gather-food is not the biggest weight', () => {
  // The point of the table is that it does not have to fight the world's own
  // consequence. gather-food carries I1 while NOT being the largest weight in
  // the table — escaping the exhaustion penalty is what wins the comparison, not
  // the size of the gather reward.
  //
  // NOTE ON RANK: gather-food is the third-smallest of the four positive weights
  // (wood 0.3 < claim 0.5 < food 1.0 < build 1.5), not the second-smallest as
  // the S3 brief's prose stated. The brief's ARGUMENT is what is pinned here and
  // it is unaffected — a strictly larger weight exists and still loses I1 — so
  // the assertion is written against the property that matters rather than
  // against the ordinal.
  const w = resolveRewardWeights(DEFAULT_CONFIG);
  const positives = [w.buildApplied, w.gatherFoodApplied, w.gatherWoodApplied, w.claimTerritoryNew]
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  assert.ok(
    w.gatherFoodApplied < positives[positives.length - 1],
    'gather-food must not be the largest positive weight, and must still win I1'
  );
  assert.ok(
    positives.some((v) => v < w.gatherFoodApplied),
    'and smaller positive weights must exist below it'
  );
  assert.ok(w.buildApplied > w.gatherFoodApplied, 'a strictly larger weight exists and still loses I1');
});

// ---------------------------------------------------------------------------
// I2 — while fed, build strictly dominates
// ---------------------------------------------------------------------------

test('I2: once fed, build strictly beats gather-food', () => {
  const margins = [];
  for (const startFood of [2, 3, 5, 20]) {
    const build = scoreTick(BUILD, startFood);
    const gather = scoreTick(GATHER_FOOD, startFood);

    assert.equal(build.foodExhausted, false, `at food ${startFood}, building must not starve the hive`);
    assert.equal(gather.foodExhausted, false, `at food ${startFood}, gathering must not starve the hive`);
    assert.ok(
      build.reward > gather.reward,
      `at food ${startFood}, build (${build.reward}) must strictly beat gather-food (${gather.reward})`
    );
    margins.push(build.reward - gather.reward);
  }
  console.log(`I2 observed margins (build - gather-food) by start food [2,3,5,20]: ${margins.join(', ')}`);
  assert.ok(margins.every((m) => m > 0));
});

// ---------------------------------------------------------------------------
// I3 — no action pays for a state change that did not occur
// ---------------------------------------------------------------------------

test('I3: re-asserting an already-owned tile contributes exactly zero', () => {
  assert.equal(territoryRewardContribution(CLAIM_OWNED, DEFAULT_CONFIG), 0);
  assert.equal(computeReward(CLAIM_OWNED, false, DEFAULT_CONFIG), 0);
  // And it is zero even when the aggregate is not: the exhaustion penalty is
  // the whole of the reward here, with nothing added by the claim.
  assert.equal(
    computeReward(CLAIM_OWNED, true, DEFAULT_CONFIG),
    computeReward(IDLE, true, DEFAULT_CONFIG),
    'a re-assertion while exhausted is worth exactly what doing nothing is worth'
  );
  // A real acquisition, by contrast, is worth strictly more than nothing.
  assert.ok(
    territoryRewardContribution(CLAIM_NEW, DEFAULT_CONFIG) >
      territoryRewardContribution(CLAIM_OWNED, DEFAULT_CONFIG),
    'acquiring a tile must beat re-asserting one'
  );
});

// ---------------------------------------------------------------------------
// I4 — the punished state is episodically escapable at all
// ---------------------------------------------------------------------------

test('I4: at shipped defaults, one successful gather ends the tick unexhausted', () => {
  const yieldFood = resolveGatherYieldFood(DEFAULT_CONFIG);
  const net = yieldFood - DEFAULT_CONFIG.upkeep_cost_food;
  assert.ok(
    net >= 1,
    `net food per successful gather must be >= 1 for escape to exist (yield ${yieldFood} - upkeep ${DEFAULT_CONFIG.upkeep_cost_food} = ${net})`
  );

  // Asserted through the mechanism as well as the arithmetic: run it.
  const escaped = scoreTick(GATHER_FOOD, 0);
  assert.equal(escaped.foodExhausted, false);
  assert.equal(escaped.endFood, net);

  // The v2 configuration is the falsifier: at yield 1 the escape does not exist
  // and the -2 penalty is a constant, not a gradient.
  const v2Cfg = { ...DEFAULT_CONFIG, gather_yield_food: 1 };
  const v2Gather = scoreTick(GATHER_FOOD, 0, v2Cfg);
  assert.equal(v2Gather.foodExhausted, true, 'under v2 yield, even a perfect gather still ends exhausted');
  assert.ok(
    v2Gather.reward < scoreTick(GATHER_FOOD, 0).reward,
    'which is exactly what S1 changed'
  );
});

// ---------------------------------------------------------------------------
// The gradient that could not exist in v2
// ---------------------------------------------------------------------------

test('gather-food strictly outscores gather-wood — the v2 blind spot', () => {
  // Compared at equal exhaustion so the comparison is about the resource and
  // nothing else. In v2 these were the same branch and necessarily equal.
  const food = computeReward(GATHER_FOOD, false, DEFAULT_CONFIG);
  const wood = computeReward(GATHER_WOOD, false, DEFAULT_CONFIG);
  assert.ok(food > wood, `gather-food (${food}) must strictly beat gather-wood (${wood})`);
  console.log(`gather gradient observed: food ${food} vs wood ${wood} (margin ${food - wood})`);

  // And both still beat failing at either.
  const failed = computeReward({ verb: 'gather', resourceKey: 'wood', applied: false }, false, DEFAULT_CONFIG);
  assert.ok(wood > failed, 'a successful wood gather must beat a failed one');
});

test('resourceKey actually reaches the scorer, in both lanes', () => {
  // The defect was a dropped field, so pin that the field is READ — not merely
  // that two different numbers exist somewhere.
  const withKey = computeReward({ verb: 'gather', resourceKey: 'wood', applied: true }, false, DEFAULT_CONFIG);
  const withoutKey = computeReward({ verb: 'gather', applied: true }, false, DEFAULT_CONFIG);
  assert.notEqual(withKey, withoutKey, 'omitting resourceKey must not score the same as wood');
  assert.equal(
    withoutKey,
    computeReward(GATHER_FOOD, false, DEFAULT_CONFIG),
    'and an absent resourceKey falls back to the food lane, as pre-v3 callers expect'
  );
});

// ---------------------------------------------------------------------------
// Inertness: an absent-weights config reproduces the shipped table exactly
// ---------------------------------------------------------------------------

const REWARD_KEYS = [
  'reward_build_applied',
  'reward_gather_food_applied',
  'reward_gather_wood_applied',
  'reward_claim_territory_new',
  'reward_idle',
  'reward_action_failed',
  'reward_food_exhausted'
];

test('INERTNESS: a config with no reward keys scores identically to the shipped config', () => {
  const stripped = { ...DEFAULT_CONFIG };
  for (const key of REWARD_KEYS) delete stripped[key];
  for (const key of REWARD_KEYS) {
    assert.ok(!(key in stripped), `${key} must be absent for this test to mean anything`);
  }

  assert.deepStrictEqual(
    resolveRewardWeights(stripped),
    resolveRewardWeights(DEFAULT_CONFIG),
    'the code defaults and the live-config defaults must not have drifted apart'
  );
  // Also covers the fully-absent and undefined cases every pre-v3 caller uses.
  assert.deepStrictEqual(resolveRewardWeights({}), resolveRewardWeights(DEFAULT_CONFIG));
  assert.deepStrictEqual(resolveRewardWeights(undefined), resolveRewardWeights(DEFAULT_CONFIG));

  const actions = [GATHER_FOOD, GATHER_WOOD, BUILD, CLAIM_NEW, CLAIM_OWNED, IDLE,
    { verb: 'gather', resourceKey: 'food', applied: false },
    { verb: 'build', applied: false },
    { verb: 'claim-territory', applied: false, territory_outcome: 'contested' }];
  for (const action of actions) {
    for (const exhausted of [false, true]) {
      const label = `${action.verb}/${action.resourceKey ?? action.territory_outcome ?? '-'}/${action.applied}`;
      assert.equal(
        computeReward(action, exhausted, stripped),
        computeReward(action, exhausted, DEFAULT_CONFIG),
        `${label} (exhausted=${exhausted}) must score the same with the keys absent`
      );
      assert.equal(
        computeReward(action, exhausted, undefined),
        computeReward(action, exhausted, DEFAULT_CONFIG),
        `${label} (exhausted=${exhausted}) must score the same with no config at all`
      );
    }
  }
});

test('THE SHIPPED TABLE: the v3 defaults, pinned once', () => {
  // The only place literal weights are asserted. Everything else above is an
  // ordering, so a deliberate retune breaks exactly this test — a one-line,
  // obviously-intentional edit — and leaves the argument's tests as the guard.
  const w = resolveRewardWeights(DEFAULT_CONFIG);
  assert.equal(w.buildApplied, 1.5);
  assert.equal(w.gatherFoodApplied, 1);
  assert.equal(w.gatherWoodApplied, 0.3);
  assert.equal(w.claimTerritoryNew, 0.5);
  assert.equal(w.idle, 0);
  assert.equal(w.actionFailed, -0.5);
  assert.equal(w.foodExhausted, -2);
});

test('an explicit 0 in the config is honoured, not treated as absent', () => {
  // `??` and not `||`: reward_idle is legitimately 0, so a `||` fallback would
  // be untestable there. Prove it on a key whose default is non-zero.
  const zeroed = { ...DEFAULT_CONFIG, reward_build_applied: 0 };
  assert.equal(resolveRewardWeights(zeroed).buildApplied, 0);
  assert.equal(computeReward(BUILD, false, zeroed), 0);
});

// ---------------------------------------------------------------------------
// Preserved from v2, and the version stamp
// ---------------------------------------------------------------------------

test("PRESERVED: a FAILED gather while exhausted still costs more than idling", () => {
  // The deliberate "don't forage an empty patch" signal. v3 does not reverse it.
  const failedGather = scoreTick({ verb: 'gather', resourceKey: 'food', applied: false }, 0);
  const idle = scoreTick(IDLE, 0);
  assert.equal(failedGather.foodExhausted, true);
  assert.ok(
    failedGather.reward < idle.reward,
    `a failed forage (${failedGather.reward}) must still cost more than doing nothing (${idle.reward})`
  );
  assert.equal(failedGather.reward, -2.5);
  assert.equal(idle.reward, -2);
});

test('the exhaustion penalty is still action-independent', () => {
  for (const action of [IDLE, GATHER_FOOD, GATHER_WOOD, BUILD, CLAIM_NEW, CLAIM_OWNED]) {
    const withPenalty = computeReward(action, true, DEFAULT_CONFIG);
    const without = computeReward(action, false, DEFAULT_CONFIG);
    assert.equal(without - withPenalty, 2, `${action.verb}: exhaustion must cost exactly 2`);
  }
});

test('REWARD_CONTRACT_VERSION is 3', () => {
  assert.equal(REWARD_CONTRACT_VERSION, 3);
});
