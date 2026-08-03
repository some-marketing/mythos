'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const {
  createNetwork,
  forward,
  softmax,
  computeEntropy,
  encodeState,
  decide,
  trainStep,
  applyUpkeep,
  mulberry32,
  VERB_ORDER,
  UPKEEP_COST,
  chooseForageTile
} = require('../untrained-network.js');
const { initialWorldState, depositPheromone } = require('../world-state.js');
const { trainTick, computeEntropyBonusWeight, computeControllerWeight } = require('../train-tick.js');
const { setupTwoHives } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');
const { readWorldState } = require('../world-state.js');

function goldenHiveState(overrides = {}) {
  return {
    identity: 'hive-a',
    hive_state: { resources: {}, territory: {}, worker_dispatch_state: {}, stockpile: {} },
    ...overrides
  };
}

function goldenWorldState(overrides = {}) {
  return { resources: { food: 10 }, territory: {}, geometry_log: [], ...overrides };
}

test('createNetwork produces genuinely random (non-zero, non-identical across seeds) small weights', () => {
  const netA = createNetwork(1);
  const netB = createNetwork(2);
  assert.notDeepEqual(netA.W1, netB.W1);
  // Not all-zero -- an untrained-but-inert network would never explore.
  const anyNonZero = netA.W1.some((row) => row.some((w) => w !== 0));
  assert.equal(anyNonZero, true);
});

test('createNetwork is reproducible given the same seed', () => {
  const netA = createNetwork(42);
  const netB = createNetwork(42);
  assert.deepEqual(netA.W1, netB.W1);
  assert.deepEqual(netA.W2, netB.W2);
});

test('an untrained network starts close to uniform-random over the 5 actions', () => {
  const net = createNetwork(7);
  const { probs } = forward(net, encodeState(goldenHiveState(), goldenWorldState()));
  assert.equal(probs.length, 5);
  // Small random init -> logits near 0 -> probs near 0.2 each, not collapsed
  // onto one action already (that would mean it wasn't actually untrained).
  for (const p of probs) {
    assert.ok(p > 0.1 && p < 0.35, `expected near-uniform prob, got ${p}`);
  }
});

test('decide samples stochastically -- repeated calls with different rng draws produce different actions', () => {
  const net = createNetwork(3);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const seen = new Set();
  const rng = mulberry32(99);
  for (let i = 0; i < 20; i++) {
    const action = decide(net, hiveState, worldState, rng);
    seen.add(action.verb);
  }
  assert.ok(seen.size > 1, 'an untrained, unseeded-toward-one-action policy should explore multiple verbs');
});

test('trainStep measurably shifts probability toward a repeatedly-rewarded action', () => {
  const net = createNetwork(5);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const targetActionIndex = VERB_ORDER.indexOf('build');

  const before = forward(net, encodeState(hiveState, worldState)).probs[targetActionIndex];
  for (let i = 0; i < 200; i++) {
    trainStep(net, hiveState, worldState, targetActionIndex, 1); // reward 'build' every time
  }
  const after = forward(net, encodeState(hiveState, worldState)).probs[targetActionIndex];

  assert.ok(after > before, `expected trained probability (${after}) > untrained (${before})`);
  assert.ok(after > 0.5, `expected the repeatedly-rewarded action to dominate after training, got ${after}`);
});

test('trainStep measurably suppresses a repeatedly-punished action', () => {
  const net = createNetwork(6);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const targetActionIndex = VERB_ORDER.indexOf('idle');

  const before = forward(net, encodeState(hiveState, worldState)).probs[targetActionIndex];
  for (let i = 0; i < 200; i++) {
    trainStep(net, hiveState, worldState, targetActionIndex, -1); // punish 'idle' every time
  }
  const after = forward(net, encodeState(hiveState, worldState)).probs[targetActionIndex];

  assert.ok(after < before, `expected suppressed probability (${after}) < untrained (${before})`);
});

test('applyUpkeep decays the stockpile and reports starvation only on the 0-crossing tick', () => {
  const hiveState = goldenHiveState({ hive_state: { resources: {}, territory: {}, worker_dispatch_state: {}, stockpile: { food: UPKEEP_COST } } });
  const first = applyUpkeep(hiveState);
  assert.equal(first.hiveState.hive_state.stockpile.food, 0);
  assert.equal(first.starved, true);

  const second = applyUpkeep(first.hiveState);
  assert.equal(second.hiveState.hive_state.stockpile.food, 0);
  assert.equal(second.starved, false); // already at 0 -- not a NEW starvation event, still starving but not re-flagged as the crossing
});

test('applyUpkeep never goes negative', () => {
  const hiveState = goldenHiveState({ hive_state: { resources: {}, territory: {}, worker_dispatch_state: {}, stockpile: { food: 0 } } });
  const result = applyUpkeep(hiveState);
  assert.equal(result.hiveState.hive_state.stockpile.food, 0);
});

test('encodeState reflects own territory and structures, not the other hive\'s', () => {
  const hiveState = goldenHiveState({ identity: 'hive-a' });
  const worldState = goldenWorldState({
    territory: { 'tile-1': 'hive-a', 'tile-2': 'hive-b', 'tile-3': 'hive-a' },
    geometry_log: [{ hive: 'hive-a', kind: 'chamber' }, { hive: 'hive-b', kind: 'tunnel' }]
  });
  const features = encodeState(hiveState, worldState);
  // [ownFood, ownWood, sharedFood, sharedWood, sharedStone, ownTerritory, ownStructures, foodTrail, woodTrail]
  assert.equal(features[5], 2); // own territory count
  assert.equal(features[6], 1); // own structures count
});

test('encodeState senses the shared pheromone trail field, normalized and capped', () => {
  let worldState = initialWorldState({ food: 10 });
  worldState = depositPheromone(worldState, 'food', 'tile-4', 25); // above TRAIL_SENSE_CAP (10)
  worldState = depositPheromone(worldState, 'wood', 'tile-9', 4);
  const features = encodeState(goldenHiveState(), worldState);
  assert.equal(features[7], 1); // capped at 1.0 (25 clamped to cap of 10, normalized)
  assert.equal(features[8], 0.4); // 4 / 10
});

test('chooseForageTile explores a fresh tile when no trail exists yet -- nothing scripted to follow', () => {
  const worldState = initialWorldState({});
  const rng = mulberry32(42);
  const tileId = chooseForageTile(worldState, 'food', rng);
  assert.ok(/^tile-\d+$/.test(tileId));
});

test('chooseForageTile exploits the strongest known trail most of the time once one exists', () => {
  let worldState = initialWorldState({});
  worldState = depositPheromone(worldState, 'food', 'tile-99', 10);
  const rng = mulberry32(7); // fixed seed with TRAIL_FOLLOW_PROB=0.8 -- deterministic for this draw
  let followed = 0;
  for (let i = 0; i < 50; i++) {
    if (chooseForageTile(worldState, 'food', rng) === 'tile-99') followed++;
  }
  assert.ok(followed > 25, `expected trail-following to dominate over exploration, got ${followed}/50`);
});

test('decide returns a tileId for gather actions so harness.tick can deposit a trail there', () => {
  const net = createNetwork(11);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const rng = mulberry32(1);
  for (let i = 0; i < 30; i++) {
    const action = decide(net, hiveState, worldState, rng);
    if (action.verb === 'gather') {
      assert.ok(typeof action.tileId === 'string' && action.tileId.length > 0);
    }
  }
});

// Exploration-collapse fix -- plan ant-hive-world-exploration-fix, S5.
// Thresholds frozen in the plan BEFORE these tests were written, to
// prevent picking acceptance numbers after seeing results:
//   entropy_bonus_weight=0.3, forced_exploration_interval=75,
//   collapse floor 0.15 nats, fix-enabled floor 0.3 nats,
//   reward-reversal shift >=0.2 within 300 ticks following 500 ticks.

function trainUnderFixedReward(net, targetIndex, steps, liveConfig, rng, startTick = 0) {
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const entropies = [];
  for (let i = 0; i < steps; i++) {
    const tickIndex = startTick + i;
    const action = decide(net, hiveState, worldState, rng, liveConfig, tickIndex);
    const reward = action._action_index === targetIndex ? 1 : -0.1;
    trainStep(net, hiveState, worldState, action._action_index, reward, liveConfig.entropy_bonus_weight);
    entropies.push(action.policy_entropy);
  }
  return entropies;
}

test('CONTROL (entropy_bonus_weight=0, forced_exploration_interval=0): policy entropy collapses below 0.15 nats by step 500 under sustained one-sided reward', () => {
  const net = createNetwork(101);
  const rng = mulberry32(202);
  const targetIndex = VERB_ORDER.indexOf('build');
  const entropies = trainUnderFixedReward(net, targetIndex, 500, { entropy_bonus_weight: 0, forced_exploration_interval: 0 }, rng);
  const final = entropies[entropies.length - 1];
  assert.ok(final < 0.15, `expected the control (no fix) to collapse below 0.15 nats, got ${final}`);
});

test('FIX-ENABLED (entropy_bonus_weight=0.3, forced_exploration_interval=75): policy entropy stays >= 0.3 nats for the entire 500-step run', () => {
  const net = createNetwork(103);
  const rng = mulberry32(204);
  const targetIndex = VERB_ORDER.indexOf('build');
  const entropies = trainUnderFixedReward(net, targetIndex, 500, { entropy_bonus_weight: 0.3, forced_exploration_interval: 75 }, rng);
  const min = Math.min(...entropies);
  assert.ok(min >= 0.3, `expected policy_entropy to never drop below 0.3 nats with the fix enabled, got a minimum of ${min}`);
});

test('every run-log entry carries an explicit forced_exploration field, and forced ticks occur at the configured 75-tick cadence', () => {
  const net = createNetwork(105);
  const rng = mulberry32(206);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const liveConfig = { forced_exploration_interval: 75 };
  const forcedTicks = [];
  for (let i = 0; i < 300; i++) {
    const action = decide(net, hiveState, worldState, rng, liveConfig, i);
    assert.equal(typeof action.forced_exploration, 'boolean');
    if (action.forced_exploration) forcedTicks.push(i);
  }
  assert.deepEqual(forcedTicks, [0, 75, 150, 225]);
});

test('RESPONSE-TO-CHANGE: after a reward-regime reversal, the policy measurably shifts toward the newly-rewarded action within 300 ticks', () => {
  const net = createNetwork(107);
  const rng = mulberry32(208);
  const liveConfig = { entropy_bonus_weight: 0.3, forced_exploration_interval: 75 };
  const actionA = VERB_ORDER.indexOf('build');
  const actionB = VERB_ORDER.indexOf('idle');

  trainUnderFixedReward(net, actionA, 500, liveConfig, rng, 0);
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const probsAtReversal = forward(net, encodeState(hiveState, worldState)).probs[actionB];

  let maxProbB = probsAtReversal;
  for (let i = 0; i < 300; i++) {
    const tickIndex = 500 + i;
    const action = decide(net, hiveState, worldState, rng, liveConfig, tickIndex);
    const reward = action._action_index === actionB ? 1 : -0.1;
    trainStep(net, hiveState, worldState, action._action_index, reward, liveConfig.entropy_bonus_weight);
    const probB = forward(net, encodeState(hiveState, worldState)).probs[actionB];
    if (probB > maxProbB) maxProbB = probB;
  }

  assert.ok(maxProbB - probsAtReversal >= 0.2, `expected P(newly-rewarded action) to rise by >= 0.2 within 300 ticks of the reversal, got a rise of ${maxProbB - probsAtReversal}`);
});

// ---------------------------------------------------------------------------
// Decaying entropy schedule -- plan ant-hive-world-exploration-fix-hiveb-
// collapse, S1/S3. Candidate (b) chosen at the resolved s0-candidate-choice
// operator gate (amendment ant-hive-world-exploration-fix-hiveb-collapse
// __amendment__20260718T181836Z). computeEntropyBonusWeight() in
// train-tick.js is the new, inert-by-default schedule function; trainStep()
// in untrained-network.js is completely unmodified.
// ---------------------------------------------------------------------------

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-hiveb-collapse-'));
}

test('computeEntropyBonusWeight is INERT (byte-identical to liveConfig.entropy_bonus_weight) when entropy_bonus_weight_initial or entropy_bonus_decay_ticks is absent', () => {
  // No schedule fields at all -- the exact liveConfig shape every pre-existing
  // caller (run-live.js, the parent plan's own tests above) passes today.
  const liveConfigNoSchedule = { entropy_bonus_weight: 0.3, forced_exploration_interval: 75 };
  for (const tickIndex of [undefined, 0, 1, 5, 20, 75, 76, 1000]) {
    assert.equal(computeEntropyBonusWeight(tickIndex, liveConfigNoSchedule), 0.3);
  }

  // Only entropy_bonus_weight_initial set, decay_ticks absent -- still inert.
  const liveConfigPartial1 = { entropy_bonus_weight: 0.3, entropy_bonus_weight_initial: 3 };
  assert.equal(computeEntropyBonusWeight(5, liveConfigPartial1), 0.3);

  // Only entropy_bonus_decay_ticks set, initial absent -- still inert.
  const liveConfigPartial2 = { entropy_bonus_weight: 0.3, entropy_bonus_decay_ticks: 75 };
  assert.equal(computeEntropyBonusWeight(5, liveConfigPartial2), 0.3);

  // decay_ticks present but zero/negative -- treated as disabled, not divide-by-zero.
  const liveConfigZeroDecay = { entropy_bonus_weight: 0.3, entropy_bonus_weight_initial: 3, entropy_bonus_decay_ticks: 0 };
  assert.equal(computeEntropyBonusWeight(5, liveConfigZeroDecay), 0.3);

  // tickIndex undefined even with full schedule config supplied -- no elapsed-
  // tick context means the pre-S1 (no-tickIndex) call sites are unaffected.
  const liveConfigFull = { entropy_bonus_weight: 0.3, entropy_bonus_weight_initial: 3, entropy_bonus_decay_ticks: 75 };
  assert.equal(computeEntropyBonusWeight(undefined, liveConfigFull), 0.3);

  // Empty liveConfig -- entropy_bonus_weight itself undefined -> 0, same as
  // trainStep()'s own `entropyBonusWeight === undefined ? 0 : ...` default.
  assert.equal(computeEntropyBonusWeight(5, {}), 0);
});

test('computeEntropyBonusWeight, when enabled, linearly decays from the initial value to the standing entropy_bonus_weight over entropy_bonus_decay_ticks, then holds', () => {
  const liveConfig = { entropy_bonus_weight: 0.3, entropy_bonus_weight_initial: 3, entropy_bonus_decay_ticks: 75 };
  assert.equal(computeEntropyBonusWeight(0, liveConfig), 3);
  assert.ok(Math.abs(computeEntropyBonusWeight(37.5, liveConfig) - ((3 + 0.3) / 2)) < 1e-9, 'expected the midpoint to be the linear average of initial and final');
  assert.ok(Math.abs(computeEntropyBonusWeight(75, liveConfig) - 0.3) < 1e-9);
  assert.ok(Math.abs(computeEntropyBonusWeight(76, liveConfig) - 0.3) < 1e-9); // held at the standing value past decay_ticks, never re-diverges
  assert.ok(Math.abs(computeEntropyBonusWeight(2000, liveConfig) - 0.3) < 1e-9);
});

test('trainTick INERTNESS: with schedule fields absent from liveConfig, the effective entropy-bonus weight and resulting network mutation are byte-identical to a direct trainStep() call using liveConfig.entropy_bonus_weight (the pre-S1 code path)', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-18T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-18T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 10, wood: 10 });

  const network = createNetwork(555);
  const networkClone = JSON.parse(JSON.stringify(network));
  const rng = mulberry32(777);
  const liveConfig = { entropy_bonus_weight: 0.3, forced_exploration_interval: 75 }; // no schedule fields -- disabled

  const hiveStateBefore = JSON.parse(fs.readFileSync(hiveA.hiveStatePath, 'utf8'));
  const worldStateBefore = readWorldState(worldStatePath);

  const result = trainTick(hiveA, worldStatePath, network, rng, liveConfig, 5);

  // Manually replicate the pre-S1 code path on a CLONE of the pre-tick
  // network: the same action taken and reward computed by trainTick, with
  // entropyBonusWeight = liveConfig.entropy_bonus_weight directly (no
  // schedule function involved at all).
  const actionIndex = VERB_ORDER.indexOf(result.action);
  trainStep(networkClone, hiveStateBefore, worldStateBefore, actionIndex, result.reward, liveConfig.entropy_bonus_weight);
  const expectedPostUpdateEntropy = computeEntropy(forward(networkClone, encodeState(hiveStateBefore, worldStateBefore)).probs);

  assert.equal(result.policy_entropy_post_update, expectedPostUpdateEntropy);
  assert.deepEqual(network.W1, networkClone.W1);
  assert.deepEqual(network.b1, networkClone.b1);
  assert.deepEqual(network.W2, networkClone.W2);
  assert.deepEqual(network.b2, networkClone.b2);
});

test('trainTick adds policy_entropy_post_update as a NEW, distinct field without altering the existing pre-update policy_entropy field', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-18T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-18T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 10, wood: 10 });

  const network = createNetwork(9001);
  const rng = mulberry32(9002);
  const liveConfig = { entropy_bonus_weight: 0.3, forced_exploration_interval: 75 };

  const result = trainTick(hiveA, worldStatePath, network, rng, liveConfig, 0);

  assert.equal(typeof result.policy_entropy, 'number');
  assert.equal(typeof result.policy_entropy_post_update, 'number');
  // The two are independently computed (pre- vs. post-trainStep) -- not the
  // same value re-labeled, in the general case.
  assert.notEqual(result.policy_entropy, result.policy_entropy_post_update);
});

// --- S3: frozen early-window fixture, loaded from the resolved S0 gate -----
//
// The fixture bytes are NOT retyped here -- they are loaded directly from
// the resolved amendment's operator_gates[].resolution field (the durable
// artifact the operator actually approved), and fixture_sha256 is recomputed
// over those exact loaded UTF-8 bytes BEFORE any JSON.parse() of them, per
// the plan's S3 gate. If this does not match the frozen checksum, the test
// fails loudly rather than silently trusting a possibly-drifted fixture.

function loadFrozenFixtureJson() {
  const amendmentPath = path.join(
    __dirname, '..', '..', '..',
    '_dev', 'reports', 'analysis', 'task-plans',
    'ant-hive-world-exploration-fix-hiveb-collapse__amendment__20260718T181836Z.json'
  );
  const amendmentRaw = fs.readFileSync(amendmentPath, 'utf8');
  const amendment = JSON.parse(amendmentRaw);
  const gate = (amendment.operator_gates || []).find((g) => g.id === 's0-candidate-choice');
  assert.ok(gate, 'expected the resolved s0-candidate-choice operator gate in the amendment');
  assert.equal(gate.status, 'resolved', 'S1 (and this S3 test) may not run while the gate is still open');
  const resolution = gate.resolution;
  const marker = 'pre-parse): ';
  const markerIdx = resolution.indexOf(marker);
  assert.ok(markerIdx !== -1, 'expected the "...pre-parse): {fixture_json}" convention in the resolution text');
  // The literal fixture_json string runs to the end of the resolution field.
  return resolution.slice(markerIdx + marker.length);
}

const FROZEN_FIXTURE_SHA256 = '44ad0a4ab6e87523ec047b7512f159e0b6bd4e00796bc7232798220e7e63e9c5';

test('S3 fixture integrity: fixture_json loaded from the resolved S0 gate hashes to the frozen fixture_sha256 (checked BEFORE any candidate runs)', () => {
  const fixtureJson = loadFrozenFixtureJson();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_SHA256, 'fixture drifted from what the operator approved at the s0-candidate-choice gate -- stop, do not proceed');
});

// SUPERSEDED-BY-V2 (behavior legitimately changed by input normalization,
// resolved s4-normalization-escalation gate, amendment
// __amendment__20260718T185536Z): this test originally asserted the CONTROL
// (no decaying schedule) configuration fails the 0.3-nat floor within ticks
// 0-20 at fixture-v1's own (small, un-normalized-by-construction) input
// scale. encodeState() now normalizes own/shared resource counts
// (normalizeResource(), untrained-network.js), which shrinks this fixture's
// own inputs (own.food/own.wood already 0; shared.food=10 -> 10/30=0.333)
// enough that CONTROL alone now HOLDS the floor within ticks 0-20 at THIS
// fixture's scale too (min observed ~1.29 nats) -- not just at the new
// fixture-v2/RESOURCE_POOL scale (see the S3v2 CONTROL test below, which
// records the equivalent finding at the realistic scale normalization
// actually targets). The fixture, floor, and checksum are UNCHANGED; only
// this test's expected outcome is updated to match observed behavior
// honestly, per plan instruction not to doctor results. Retained (not
// deleted) as the historical/comparison record for the pre-normalization
// input contract's failure shape -- see the original commit history and the
// S3v2 EXTENDED WINDOW test below, which shows the same CONTROL
// configuration still eventually collapses (just delayed past tick 20).
test('S3 EARLY WINDOW (ticks 0-20), fixture-v1 scale, SUPERSEDED-BY-V2: CONTROL (no decaying schedule) now HOLDS the frozen 0.3-nat floor under normalization -- normalization\'s shrinking of fixture-v1-scale inputs is enough on its own at this scale (contrast the fixture-v2/RESOURCE_POOL-scale CONTROL test, where the same conclusion holds for the intended realistic scale)', () => {
  const fixtureJson = loadFrozenFixtureJson();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_SHA256); // re-verify before use, per S3 gate

  const fixture = JSON.parse(fixtureJson); // parsed only AFTER the hash check above
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');
  assert.equal(buildIndex, 2); // fixture's action_reward_sequence hardcodes action_index 2 == 'build'

  const controlLiveConfig = { entropy_bonus_weight: fixture.entropy_bonus_weight }; // no schedule fields -- CONTROL
  let minEntropy = Infinity;
  for (let t = fixture.tick_range[0]; t <= fixture.tick_range[1]; t++) {
    const weight = computeEntropyBonusWeight(t, controlLiveConfig);
    trainStep(net, hiveState, worldState, buildIndex, 2, weight); // reward +2, per fixture.action_reward_sequence
    const postUpdateEntropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    if (postUpdateEntropy < minEntropy) minEntropy = postUpdateEntropy;
  }

  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected the CONTROL mechanism, run against normalized inputs, to now HOLD the ${fixture.entropy_floor_nats}-nat floor within ticks 0-20 (behavior changed by normalization -- see SUPERSEDED-BY-V2 comment above), but the minimum observed was ${minEntropy}`);
});

test('S3 EARLY WINDOW (ticks 0-20): CANDIDATE (b) decaying entropy schedule holds >= the frozen 0.3-nat floor throughout, under the identical fixture', () => {
  const fixtureJson = loadFrozenFixtureJson();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_SHA256); // re-verify before use, per S3 gate

  const fixture = JSON.parse(fixtureJson); // parsed only AFTER the hash check above
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');

  // Chosen decaying-schedule parameterization (S1 implementation choice,
  // empirically verified against this exact fixture; NOT part of the frozen
  // gate resolution, which only froze the candidate choice, the floor, and
  // the fixture itself): entropy_bonus_weight_initial=3, decaying linearly
  // to the parent plan's proven standing value (fixture.entropy_bonus_weight,
  // 0.3) over entropy_bonus_decay_ticks=75 ticks (matching
  // forced_exploration_interval, so both mechanisms reach steady-state at
  // the same tick).
  const candidateLiveConfig = {
    entropy_bonus_weight: fixture.entropy_bonus_weight,
    entropy_bonus_weight_initial: 3,
    entropy_bonus_decay_ticks: 75
  };
  let minEntropy = Infinity;
  const trajectory = [];
  for (let t = fixture.tick_range[0]; t <= fixture.tick_range[1]; t++) {
    const weight = computeEntropyBonusWeight(t, candidateLiveConfig);
    trainStep(net, hiveState, worldState, buildIndex, 2, weight); // reward +2, per fixture.action_reward_sequence
    const postUpdateEntropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    trajectory.push(postUpdateEntropy);
    if (postUpdateEntropy < minEntropy) minEntropy = postUpdateEntropy;
  }

  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected policy_entropy_post_update to stay >= ${fixture.entropy_floor_nats} nats across ticks 0-20 with candidate (b) enabled, but the minimum was ${minEntropy} (trajectory: ${trajectory.map((e) => e.toFixed(4)).join(', ')})`);
});

// ---------------------------------------------------------------------------
// Candidate (c) update-clipping -- S4 combination-escalation gate (amendment
// ant-hive-world-exploration-fix-hiveb-collapse__amendment__20260718T183529Z).
// S4's 2,000-tick live run showed (b) alone eliminates permanent collapse but
// leaves brief self-recovering sub-floor dips under realistic (unnormalized,
// larger-magnitude) resource-count inputs than the frozen S3 fixture uses.
// The operator resolved: keep (b), add (c) as a compositional backstop.
// trainStep()'s new optional 7th parameter (updateClip) L-infinity-clamps
// each output unit's dLogits before backprop. The frozen S3 floor (0.3
// nats) and fixture (fixture_sha256 44ad0a4a...) are UNCHANGED.
// ---------------------------------------------------------------------------

test('trainStep is INERT on updateClip when absent, undefined, 0, or negative -- byte-identical resulting weights vs. calling without the argument at all', () => {
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState({ resources: { food: 40, wood: 30, stone: 15 } });
  const buildIndex = VERB_ORDER.indexOf('build');

  const baseline = createNetwork(555);
  for (let t = 0; t < 30; t++) {
    trainStep(baseline, hiveState, worldState, buildIndex, 2, 0.3); // no 7th arg at all
  }

  for (const inertClip of [undefined, 0, -1, -0.001]) {
    const net = createNetwork(555);
    for (let t = 0; t < 30; t++) {
      trainStep(net, hiveState, worldState, buildIndex, 2, 0.3, inertClip);
    }
    assert.deepEqual(net.W1, baseline.W1, `expected byte-identical W1 for updateClip=${inertClip}`);
    assert.deepEqual(net.b1, baseline.b1, `expected byte-identical b1 for updateClip=${inertClip}`);
    assert.deepEqual(net.W2, baseline.W2, `expected byte-identical W2 for updateClip=${inertClip}`);
    assert.deepEqual(net.b2, baseline.b2, `expected byte-identical b2 for updateClip=${inertClip}`);
  }
});

// SUPERSEDED-BY-V2 (behavior legitimately changed by input normalization,
// resolved s4-normalization-escalation gate, amendment
// __amendment__20260718T185536Z): this test originally documented that
// update_clip=1.6 (the pre-normalization live-config.js default) reliably
// engages at RESOURCE_POOL scale because unclipped |dLogits| there peaked at
// ~2.57. encodeState() now normalizes resource-count inputs, which shrinks
// that same seed/scale/weight combination's unclipped |dLogits| peak to
// ~1.596 -- just UNDER 1.6, so the OLD clip value/scale combination no
// longer reliably engages (this is exactly the ~57x hidden-energy
// amplification the gate's resolution describes: normalization is now what
// bounds gradient magnitude, not this clip). update_clip's live-config.js
// default is now 0 (fully inert) per that gate; candidate (c)'s code path
// itself is left intact and still functional, which is what this test
// verifies -- re-parameterized with a smaller clip (1.0) that is guaranteed
// to engage against the new, normalization-shrunk dLogits scale, rather than
// asserting a pre-normalization magnitude that no longer holds.
test('trainStep, when updateClip is enabled and small enough to engage at post-normalization scale, produces DIFFERENT (bounded) weight movement than the unclipped call -- verifies candidate (c)\'s clipping code path still functions correctly even though it is INERT by default', () => {
  const hiveState = goldenHiveState();
  // RESOURCE_POOL scale (run-live.js), not the smaller fixture scale --
  // this is exactly the regime S4's original (pre-normalization) live run
  // showed producing brief sub-floor dips under (b) alone.
  const worldState = goldenWorldState({ resources: { food: 40, wood: 30, stone: 15 } });
  const buildIndex = VERB_ORDER.indexOf('build');

  // Seed 20260718 (the frozen S3 fixture's own network_seed) is used here
  // for continuity with the pre-normalization version of this test. At this
  // RESOURCE_POOL scale, WITH normalization now active in encodeState(),
  // this seed/weight combination's unclipped |dLogits| peaks at ~1.596 (down
  // from ~2.57 pre-normalization) -- so a clip of 1.0 (not the old 1.6
  // default) is used here specifically to guarantee engagement.
  const unclipped = createNetwork(20260718);
  trainStep(unclipped, hiveState, worldState, buildIndex, 2, 3); // entropy_bonus_weight_initial-scale weight

  const clipped = createNetwork(20260718);
  trainStep(clipped, hiveState, worldState, buildIndex, 2, 3, 1.0);

  assert.notDeepEqual(clipped.W2, unclipped.W2, 'expected clipping to measurably change the resulting weights at this input scale');
  // The clipped run's total weight movement (L2 across W2) must be smaller.
  const l2 = (a, b) => Math.sqrt(a.flat().reduce((s, v, idx) => s + (v - b.flat()[idx]) ** 2, 0));
  const freshBase = createNetwork(20260718);
  const movedUnclipped = l2(unclipped.W2, freshBase.W2);
  const movedClipped = l2(clipped.W2, freshBase.W2);
  assert.ok(movedClipped < movedUnclipped, `expected clipped per-tick weight movement (${movedClipped}) to be smaller than unclipped (${movedUnclipped})`);
});

test('S3 EARLY WINDOW (ticks 0-20): CANDIDATE (b)+(c) (decaying schedule + update-clipping) still holds >= the frozen 0.3-nat floor throughout, under the identical checksum-verified fixture', () => {
  const fixtureJson = loadFrozenFixtureJson();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_SHA256); // re-verify before use, per S3 gate (floor/fixture UNCHANGED)

  const fixture = JSON.parse(fixtureJson); // parsed only AFTER the hash check above
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');

  // (b) unchanged from the resolved s0-candidate-choice gate; (c)'s
  // update_clip=1.6 is live-config.js's default, derived from this exact
  // fixture's own already-proven regime (see live-config.js's comment).
  const candidateLiveConfig = {
    entropy_bonus_weight: fixture.entropy_bonus_weight,
    entropy_bonus_weight_initial: 3,
    entropy_bonus_decay_ticks: 75,
    update_clip: 1.6
  };
  let minEntropy = Infinity;
  const trajectory = [];
  for (let t = fixture.tick_range[0]; t <= fixture.tick_range[1]; t++) {
    const weight = computeEntropyBonusWeight(t, candidateLiveConfig);
    trainStep(net, hiveState, worldState, buildIndex, 2, weight, candidateLiveConfig.update_clip);
    const postUpdateEntropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    trajectory.push(postUpdateEntropy);
    if (postUpdateEntropy < minEntropy) minEntropy = postUpdateEntropy;
  }

  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected policy_entropy_post_update to stay >= ${fixture.entropy_floor_nats} nats across ticks 0-20 with candidate (b)+(c) enabled, but the minimum was ${minEntropy} (trajectory: ${trajectory.map((e) => e.toFixed(4)).join(', ')})`);
});

// ---------------------------------------------------------------------------
// SUPERSEDED-BY-V2 NOTE: the two S3 fixture-v1 tests above (integrity check,
// CONTROL, candidate-(b) EARLY-WINDOW) and the update-clip tests immediately
// above this note remain valid AS WRITTEN for the pre-normalization
// encodeState() input contract (raw, unnormalized own/shared resource
// counts) -- they are not deleted or altered, and continue to pass because
// trainStep()'s current call sites in those tests still exercise that raw
// contract at the tests' own small fixture-v1 scale (own values effectively
// 0, world food=10). They no longer describe run-live.js's actual runtime
// behavior, though: encodeState() itself now normalizes resource counts (see
// untrained-network.js's RESOURCE_NORM_K/normalizeResource()), and
// update_clip's live-config.js default is now 0 (inert) -- candidate (c) is
// present but off by default; normalization is what closed the S4 gap
// (resolved s4-normalization-escalation gate, superseding
// s4-combination-escalation, amendment __amendment__20260718T185536Z). The
// tests below are the NEW fixture-v2 tests against the REALISTIC
// RESOURCE_POOL scale, which normalization actually targets.
// ---------------------------------------------------------------------------

// --- S3v2: frozen normalization-era fixture, at RESOURCE_POOL scale -------
//
// Loaded from the durable filing location the s4-normalization-escalation
// gate specified: a new section appended to the comparison memo (section 8),
// NOT a new gate amendment -- fixture v2 exists to re-prove the mechanism
// under the changed input contract, not to reopen the operator decision.
// fixture_sha256 is recomputed over the exact loaded UTF-8 bytes BEFORE any
// JSON.parse(), same discipline as the v1 loader above.

function loadFrozenFixtureV2Json() {
  const memoPath = path.join(
    __dirname, '..', '..', '..',
    '_dev', 'reports', 'analysis',
    'ant-hive-world-exploration-fix-hiveb-collapse-candidate-comparison.md'
  );
  const memoText = fs.readFileSync(memoPath, 'utf8');
  const sectionIdx = memoText.indexOf('## 8. Fixture v2');
  assert.ok(sectionIdx !== -1, 'expected a "## 8. Fixture v2" section in the comparison memo');
  const afterSection = memoText.slice(sectionIdx);
  const headingIdx = afterSection.indexOf('Literal `fixture_json`');
  assert.ok(headingIdx !== -1, 'expected a "Literal `fixture_json`" heading in the fixture v2 section');
  const fenceStart = afterSection.indexOf('```\n{', headingIdx);
  assert.ok(fenceStart !== -1, 'expected a fenced ```\\n{...} code block containing the literal fixture v2 JSON');
  const contentStart = fenceStart + 4; // skip the opening "```\n"
  const fenceEnd = afterSection.indexOf('\n```', contentStart);
  assert.ok(fenceEnd !== -1, 'expected a closing fence for the fixture v2 JSON block');
  return afterSection.slice(contentStart, fenceEnd);
}

const FROZEN_FIXTURE_V2_SHA256 = 'f8ee5b840b4bb17c8bb10f15e921409fd8479cbc5cb86f693e277157a98de969';

test('S3v2 fixture integrity: fixture_json loaded from the comparison memo (section 8) hashes to the frozen fixture_sha256, at the REALISTIC RESOURCE_POOL scale (checked BEFORE any candidate runs)', () => {
  const fixtureJson = loadFrozenFixtureV2Json();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_V2_SHA256, 'fixture v2 drifted from what was frozen at the s4-normalization-escalation gate -- stop, do not proceed');
  const fixture = JSON.parse(fixtureJson);
  assert.deepEqual(fixture.world_state.resources, { food: 40, wood: 30, stone: 15 }, 'expected fixture v2 to use the realistic RESOURCE_POOL scale, not fixture v1\'s smaller scale');
});

test('S3v2 EARLY WINDOW (ticks 0-20), RESOURCE_POOL scale: CONTROL ((b) disabled, normalization active) behavior recorded -- normalization alone HOLDS the frozen 0.3-nat floor within the early window (delays, does not eliminate, the collapse mechanism; contrast fixture v1\'s CONTROL test above, which still fails within ticks 0-20 under the pre-normalization raw-input contract)', () => {
  const fixtureJson = loadFrozenFixtureV2Json();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_V2_SHA256); // re-verify before use

  const fixture = JSON.parse(fixtureJson);
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');

  const controlLiveConfig = { entropy_bonus_weight: fixture.entropy_bonus_weight }; // no schedule fields -- CONTROL
  let minEntropy = Infinity;
  const trajectory = [];
  for (let t = fixture.tick_range[0]; t <= fixture.tick_range[1]; t++) {
    const weight = computeEntropyBonusWeight(t, controlLiveConfig);
    trainStep(net, hiveState, worldState, buildIndex, 2, weight); // reward +2, per fixture.action_reward_sequence
    const postUpdateEntropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    trajectory.push(postUpdateEntropy);
    if (postUpdateEntropy < minEntropy) minEntropy = postUpdateEntropy;
  }

  // Recorded finding, not a doctored expectation: at RESOURCE_POOL scale
  // with normalized inputs, the CONTROL configuration (no decaying
  // schedule) holds >= the frozen floor across ticks 0-20. This is an
  // honest behavior change from fixture v1's CONTROL test, and is expected:
  // normalizeResource()'s saturating map shrinks own/shared resource inputs
  // into [0, 1), which shrinks the forward pass's hidden-layer energy and
  // therefore the REINFORCE gradient magnitude at every tick, slowing (not
  // eliminating) the collapse mechanism relative to the unnormalized
  // fixture-v1-scale inputs used above.
  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected CONTROL (normalization active, (b) disabled) to hold >= ${fixture.entropy_floor_nats} nats across ticks 0-20 at RESOURCE_POOL scale, but the minimum was ${minEntropy} (trajectory: ${trajectory.map((e) => e.toFixed(4)).join(', ')})`);
});

test('S3v2 EXTENDED WINDOW, RESOURCE_POOL scale: CONTROL ((b) disabled, normalization active) still eventually crosses below the frozen 0.3-nat floor under a persistent one-sided streak -- the collapse mechanism persists absent (b), normalization only delays it past the early window (first sub-floor tick observed ~78, well outside ticks 0-20)', () => {
  const fixtureJson = loadFrozenFixtureV2Json();
  const fixture = JSON.parse(fixtureJson);
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');

  let firstSubFloorTick = null;
  for (let t = 0; t < 300; t++) {
    trainStep(net, hiveState, worldState, buildIndex, 2, fixture.entropy_bonus_weight); // constant weight -- CONTROL, no schedule
    const postUpdateEntropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    if (postUpdateEntropy < fixture.entropy_floor_nats) { firstSubFloorTick = t; break; }
  }

  assert.ok(firstSubFloorTick !== null, 'expected the CONTROL configuration to eventually cross below the floor within 300 ticks under a persistent one-sided streak, demonstrating the underlying collapse mechanism is delayed by normalization, not eliminated by it -- (b) remains necessary');
  assert.ok(firstSubFloorTick > fixture.tick_range[1], `expected the first sub-floor tick (${firstSubFloorTick}) to fall outside the frozen EARLY window (ticks 0-${fixture.tick_range[1]}), confirming normalization's effect is a delay, not a level guarantee, on its own`);
});

test('S3v2 EARLY WINDOW (ticks 0-20), RESOURCE_POOL scale: CANDIDATE (b)+normalization holds >= the frozen 0.3-nat floor throughout, under the checksum-verified fixture v2', () => {
  const fixtureJson = loadFrozenFixtureV2Json();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_V2_SHA256); // re-verify before use

  const fixture = JSON.parse(fixtureJson);
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');

  // Same decaying-schedule parameterization as the fixture-v1 test above
  // (entropy_bonus_weight_initial=3, entropy_bonus_decay_ticks=75) --
  // unchanged by the s4-normalization-escalation gate, which kept candidate
  // (b) active as-is. update_clip is NOT passed (candidate (c) is inert by
  // its own new live-config.js default of 0) -- normalization alone is the
  // mechanism under test here, composed with the unchanged (b) schedule.
  const candidateLiveConfig = {
    entropy_bonus_weight: fixture.entropy_bonus_weight,
    entropy_bonus_weight_initial: 3,
    entropy_bonus_decay_ticks: 75
  };
  let minEntropy = Infinity;
  const trajectory = [];
  for (let t = fixture.tick_range[0]; t <= fixture.tick_range[1]; t++) {
    const weight = computeEntropyBonusWeight(t, candidateLiveConfig);
    trainStep(net, hiveState, worldState, buildIndex, 2, weight); // reward +2, per fixture.action_reward_sequence
    const postUpdateEntropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    trajectory.push(postUpdateEntropy);
    if (postUpdateEntropy < minEntropy) minEntropy = postUpdateEntropy;
  }

  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected policy_entropy_post_update to stay >= ${fixture.entropy_floor_nats} nats across ticks 0-20 with candidate (b)+normalization enabled at RESOURCE_POOL scale, but the minimum was ${minEntropy} (trajectory: ${trajectory.map((e) => e.toFixed(4)).join(', ')})`);
});

test('normalizeResource is bounded [0, 1), monotone, deterministic, and a pure function of its single input (no cross-tick or cross-run state)', () => {
  const { normalizeResource, RESOURCE_NORM_K } = require('../untrained-network.js');
  assert.equal(normalizeResource(0), 0);
  assert.equal(normalizeResource(undefined), 0);
  let prev = -1;
  for (const x of [0, 1, 5, 10, 20, 40, 100, 10000]) {
    const v = normalizeResource(x);
    assert.ok(v >= 0 && v < 1, `expected normalizeResource(${x})=${v} to be in [0, 1)`);
    assert.ok(v > prev, `expected normalizeResource to be strictly monotone increasing, but ${v} <= ${prev} at x=${x}`);
    prev = v;
  }
  assert.equal(normalizeResource(RESOURCE_NORM_K), 0.5, 'expected normalizeResource(K) === 0.5 by construction of x/(x+K)');
  // Determinism / purity -- repeated calls with the same input are identical.
  assert.equal(normalizeResource(40), normalizeResource(40));
});

// ---------------------------------------------------------------------------
// Reactive entropy controller -- plan ant-hive-world-exploration-fix-hiveb-
// collapse, resolved s4-reactive-controller gate (amendment
// __amendment__20260718T192154Z). Closes the POST-DECAY sustained-streak gap:
// after the (b) schedule decays (t>75), a sustained one-sided streak drove
// policy_entropy_post_update below the frozen 0.3-nat floor into a
// numerically absorbing region (hive-b at exactly 0.0000 nats for 1900+/2000
// ticks in 2/3 S4 runs). The controller reads the PREVIOUS tick's own-hive
// policy_entropy_post_update (within-run state, passed explicitly) and, below
// entropy_controller_trigger (0.9 = 3x floor, ABOVE the floor so it engages
// before the zero-force region), lifts the effective weight to
// max(schedule, entropy_controller_boost_weight=3) until entropy recovers to
// entropy_controller_release (1.2; hysteresis). Floor and fixtures v1/v2
// UNCHANGED. Measured force analysis behind the defaults: minimal restoring
// weight under a continued +2 build streak is ~1.06 at H~=0.9 (boost=3 =>
// ~2.8x margin); live S4 runs showed single-tick entropy shocks up to ~0.59
// nats (growing unnormalized territory/structure features amplify late-run
// gradients), so the trigger-to-floor buffer (0.6 nats at trigger 0.9) must
// exceed that shock scale -- a 0.6 trigger's 0.3-nat buffer was breached
// once in 12,000 live hive-ticks. See train-tick.js's
// computeControllerWeight() comment for the full analysis.
// ---------------------------------------------------------------------------

const CONTROLLER_LIVE_CONFIG = {
  entropy_bonus_weight: 0.3,
  entropy_bonus_weight_initial: 3,
  entropy_bonus_decay_ticks: 75,
  entropy_controller_enabled: 1,
  entropy_controller_trigger: 0.9,
  entropy_controller_release: 1.2,
  entropy_controller_boost_weight: 3
};

// Mimics trainTick()'s exact composition for direct trainStep-driven test
// legs: schedule -> controller -> trainStep -> post-update entropy fed back.
function controlledStreakStep(net, state, hiveState, worldState, actionIndex, reward, t, cfg) {
  const scheduleWeight = computeEntropyBonusWeight(t, cfg);
  const w = computeControllerWeight(state, scheduleWeight, cfg);
  trainStep(net, hiveState, worldState, actionIndex, reward, w);
  const post = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
  state.prev_post_update_entropy = post;
  return { post, w, scheduleWeight };
}

test('computeControllerWeight is INERT (returns the schedule weight unchanged, state untouched) without a state object, when disabled, or with trigger/boost non-positive', () => {
  const freshState = () => ({ active: false, prev_post_update_entropy: 0.1 }); // well below trigger
  // No state object at all.
  assert.equal(computeControllerWeight(undefined, 0.3, CONTROLLER_LIVE_CONFIG), 0.3);
  // Disabled.
  const s1 = freshState();
  assert.equal(computeControllerWeight(s1, 0.3, { ...CONTROLLER_LIVE_CONFIG, entropy_controller_enabled: 0 }), 0.3);
  assert.equal(s1.active, false, 'a disabled controller must not mutate hysteresis state');
  // Trigger 0 / absent, boost 0 / absent.
  for (const cfg of [
    { ...CONTROLLER_LIVE_CONFIG, entropy_controller_trigger: 0 },
    { ...CONTROLLER_LIVE_CONFIG, entropy_controller_trigger: undefined },
    { ...CONTROLLER_LIVE_CONFIG, entropy_controller_boost_weight: 0 },
    { ...CONTROLLER_LIVE_CONFIG, entropy_controller_boost_weight: undefined }
  ]) {
    const s = freshState();
    assert.equal(computeControllerWeight(s, 0.3, cfg), 0.3);
    assert.equal(s.active, false);
  }
  // No previous measurement yet (first tick of a run) -- never engages.
  const s2 = { active: false, prev_post_update_entropy: undefined };
  assert.equal(computeControllerWeight(s2, 0.3, CONTROLLER_LIVE_CONFIG), 0.3);
  assert.equal(s2.active, false);
});

test('computeControllerWeight hysteresis: engages below the trigger, holds the boost until the release, then disengages -- and never returns less than the schedule weight', () => {
  const state = { active: false, prev_post_update_entropy: undefined };
  const cfg = CONTROLLER_LIVE_CONFIG;
  // Above trigger: inert.
  state.prev_post_update_entropy = 1.0;
  assert.equal(computeControllerWeight(state, 0.3, cfg), 0.3);
  assert.equal(state.active, false);
  // Crosses below trigger: engage, weight lifted to the boost.
  state.prev_post_update_entropy = 0.89;
  assert.equal(computeControllerWeight(state, 0.3, cfg), 3);
  assert.equal(state.active, true);
  // Recovered above trigger but BELOW release: still engaged (hysteresis --
  // a release equal to the trigger would chatter every tick at the boundary).
  state.prev_post_update_entropy = 1.0;
  assert.equal(computeControllerWeight(state, 0.3, cfg), 3);
  assert.equal(state.active, true);
  // At/above release: disengage.
  state.prev_post_update_entropy = 1.2;
  assert.equal(computeControllerWeight(state, 0.3, cfg), 0.3);
  assert.equal(state.active, false);
  // Monotone composition: while engaged, never below the schedule weight
  // (early-window schedule 3.5 > boost 3 -> schedule wins).
  state.prev_post_update_entropy = 0.1;
  assert.equal(computeControllerWeight(state, 3.5, cfg), 3.5);
  assert.equal(state.active, true);
});

test('computeControllerWeight clamps release below trigger up to the trigger', () => {
  const badCfg = { ...CONTROLLER_LIVE_CONFIG, entropy_controller_release: 0.2 };
  const s = { active: true, prev_post_update_entropy: 0.91 }; // >= trigger 0.9 -> releases under the clamp
  assert.equal(computeControllerWeight(s, 0.3, badCfg), 0.3);
  assert.equal(s.active, false);
  const s2 = { active: true, prev_post_update_entropy: 0.5 }; // < trigger -> stays engaged
  assert.equal(computeControllerWeight(s2, 0.3, badCfg), 3);
  assert.equal(s2.active, true);
});

test('trainTick CONTROLLER INERTNESS: with entropy_controller_enabled=0 (state object passed) the resulting network is byte-identical to the pre-controller call shape (no controllerState argument at all)', () => {
  const mk = () => {
    const root = freshSandbox();
    const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-18T00:00:00Z');
    const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-18T00:00:00Z');
    const worldStatePath = path.join(root, 'shared', 'world-state.json');
    const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 40, wood: 30, stone: 15 });
    return { hiveA, worldStatePath };
  };
  const cfgDisabled = { ...CONTROLLER_LIVE_CONFIG, entropy_controller_enabled: 0 };
  const cfgNoControllerFields = {
    entropy_bonus_weight: 0.3, entropy_bonus_weight_initial: 3, entropy_bonus_decay_ticks: 75
  };

  const a = mk();
  const netA = createNetwork(4242);
  const rngA = mulberry32(4243);
  const stateA = { active: false, prev_post_update_entropy: undefined };
  for (let t = 0; t < 40; t++) trainTick(a.hiveA, a.worldStatePath, netA, rngA, cfgDisabled, t, stateA);

  const b = mk();
  const netB = createNetwork(4242);
  const rngB = mulberry32(4243);
  for (let t = 0; t < 40; t++) trainTick(b.hiveA, b.worldStatePath, netB, rngB, cfgNoControllerFields, t);

  assert.deepEqual(netA.W1, netB.W1);
  assert.deepEqual(netA.b1, netB.b1);
  assert.deepEqual(netA.W2, netB.W2);
  assert.deepEqual(netA.b2, netB.b2);
  assert.equal(stateA.active, false, 'a disabled controller must never engage');
  assert.equal(typeof stateA.prev_post_update_entropy, 'number', 'prev entropy is still measured while disabled so a mid-run enable acts on fresh data');
});

test('S3v2 EARLY WINDOW (ticks 0-20), RESOURCE_POOL scale: CANDIDATE (b)+normalization+CONTROLLER holds >= the frozen 0.3-nat floor throughout, under the checksum-verified fixture v2', () => {
  const fixtureJson = loadFrozenFixtureV2Json();
  const actualHash = crypto.createHash('sha256').update(fixtureJson, 'utf8').digest('hex');
  assert.equal(actualHash, FROZEN_FIXTURE_V2_SHA256); // re-verify before use

  const fixture = JSON.parse(fixtureJson);
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');
  const state = { active: false, prev_post_update_entropy: undefined };

  let minEntropy = Infinity;
  const trajectory = [];
  for (let t = fixture.tick_range[0]; t <= fixture.tick_range[1]; t++) {
    const { post } = controlledStreakStep(net, state, hiveState, worldState, buildIndex, 2, t, CONTROLLER_LIVE_CONFIG);
    trajectory.push(post);
    if (post < minEntropy) minEntropy = post;
  }

  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected policy_entropy_post_update to stay >= ${fixture.entropy_floor_nats} nats across ticks 0-20 with (b)+normalization+controller enabled, but the minimum was ${minEntropy} (trajectory: ${trajectory.map((e) => e.toFixed(4)).join(', ')})`);
});

test('S3v2 EXTENDED WINDOW, RESOURCE_POOL scale: (b)+normalization+CONTROLLER PASSES where the controller-off configuration crossed sub-floor at ~t78 -- a persistent 300-tick one-sided streak never drops below the frozen 0.3-nat floor, and the controller measurably engages', () => {
  const fixtureJson = loadFrozenFixtureV2Json();
  const fixture = JSON.parse(fixtureJson);
  const net = createNetwork(fixture.network_seed);
  const hiveState = fixture.hive_state;
  const worldState = fixture.world_state;
  const buildIndex = VERB_ORDER.indexOf('build');
  const state = { active: false, prev_post_update_entropy: undefined };

  let minEntropy = Infinity, firstSubFloorTick = null, engagedTicks = 0;
  for (let t = 0; t < 300; t++) {
    const { post, w, scheduleWeight } = controlledStreakStep(net, state, hiveState, worldState, buildIndex, 2, t, CONTROLLER_LIVE_CONFIG);
    if (w > scheduleWeight) engagedTicks++;
    if (post < minEntropy) minEntropy = post;
    if (firstSubFloorTick === null && post < fixture.entropy_floor_nats) firstSubFloorTick = t;
  }

  assert.equal(firstSubFloorTick, null, `expected NO sub-floor tick across the 300-tick sustained streak with the controller on, but entropy first crossed below ${fixture.entropy_floor_nats} at tick ${firstSubFloorTick} (min ${minEntropy})`);
  assert.ok(minEntropy >= fixture.entropy_floor_nats, `expected min entropy >= ${fixture.entropy_floor_nats}, got ${minEntropy}`);
  assert.ok(engagedTicks > 0, 'expected the controller to actually engage during the post-decay streak (otherwise this test proves nothing about the controller)');
});

test('RESPONSE-TO-CHANGE with the CONTROLLER ON: after a reward-regime reversal, the policy still shifts toward the newly-rewarded action by >= 0.2 within 300 ticks -- the controller does not suppress legitimate re-convergence', () => {
  const net = createNetwork(107); // same seed/shape as the parent plan's RESPONSE-TO-CHANGE test
  const rng = mulberry32(208);
  const cfg = { ...CONTROLLER_LIVE_CONFIG, forced_exploration_interval: 75 };
  const actionA = VERB_ORDER.indexOf('build');
  const actionB = VERB_ORDER.indexOf('idle');
  const hiveState = goldenHiveState();
  const worldState = goldenWorldState();
  const state = { active: false, prev_post_update_entropy: undefined };

  // Phase 1: 500 ticks rewarding action A, full pipeline (decide + schedule +
  // controller), controller in the loop the whole time.
  for (let t = 0; t < 500; t++) {
    const action = decide(net, hiveState, worldState, rng, cfg, t);
    const reward = action._action_index === actionA ? 1 : -0.1;
    const scheduleWeight = computeEntropyBonusWeight(t, cfg);
    const w = computeControllerWeight(state, scheduleWeight, cfg);
    trainStep(net, hiveState, worldState, action._action_index, reward, w);
    state.prev_post_update_entropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
  }
  const probsAtReversal = forward(net, encodeState(hiveState, worldState)).probs[actionB];

  // Phase 2: reversal -- reward action B; policy must measurably follow.
  let maxProbB = probsAtReversal;
  for (let i = 0; i < 300; i++) {
    const t = 500 + i;
    const action = decide(net, hiveState, worldState, rng, cfg, t);
    const reward = action._action_index === actionB ? 1 : -0.1;
    const scheduleWeight = computeEntropyBonusWeight(t, cfg);
    const w = computeControllerWeight(state, scheduleWeight, cfg);
    trainStep(net, hiveState, worldState, action._action_index, reward, w);
    state.prev_post_update_entropy = computeEntropy(forward(net, encodeState(hiveState, worldState)).probs);
    const probB = forward(net, encodeState(hiveState, worldState)).probs[actionB];
    if (probB > maxProbB) maxProbB = probB;
  }

  assert.ok(maxProbB - probsAtReversal >= 0.2, `expected P(newly-rewarded action) to rise by >= 0.2 within 300 ticks of the reversal with the controller on, got a rise of ${maxProbB - probsAtReversal}`);
});

test('healthy convergence above the floor remains possible with the controller on: a policy may hold a dominant action at entropy >= the trigger without controller interference', () => {
  // Directly verifies the trigger sits below healthy-convergence territory:
  // any state with prev entropy >= 0.9 is untouched (weight = schedule), so
  // dominance up to p~0.75 (H(0.75, rest uniform) ~= 0.9 nats for 5 actions)
  // is reachable and stable without the controller fighting it.
  const state = { active: false, prev_post_update_entropy: 0.9 };
  assert.equal(computeControllerWeight(state, 0.3, CONTROLLER_LIVE_CONFIG), 0.3);
  assert.equal(state.active, false);
  // And a converged-but-above-trigger policy: p = [0.75, 0.0625, 0.0625, 0.0625, 0.0625]
  const probs = [0.75, 0.0625, 0.0625, 0.0625, 0.0625];
  const H = computeEntropy(probs);
  assert.ok(H >= 0.85 && H < 1.1, `sanity: dominant-action entropy ~${H.toFixed(3)} nats sits at/above the trigger region`);
});
