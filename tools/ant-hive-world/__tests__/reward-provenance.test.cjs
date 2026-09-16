'use strict';

// tools/ant-hive-world/__tests__/reward-provenance.test.cjs
//
// Plan ant-sim-reward-specification-repair, S4. Covers the two provenance holes
// the S1-S3 reward fix OPENED, both of which would make S5's evidence
// untrustworthy if left open:
//
//   (a) MIXED-VERSION POOLING WAS PROSE. train-tick.js's contract comment says
//       "any summarizer pooling rows must reject mixed or missing versions" and
//       until S4 no mechanism enforced it. These tests exercise
//       _dev/sim-runs/summarize-reward-contract.js as a real CLI and as a
//       module: it must REFUSE mixed and absent versions, and its invariant
//       DETECTORS (already_owned pays exactly 0; cumulative newly_acquired
//       within the one shared 10x10 grid) must actually fail on fixtures that
//       violate them -- a detector only tested on clean data is untested.
//
//   (b) REWARD WEIGHTS WERE HOT-EDITABLE MID-RUN. live-config.js is re-read
//       fresh every round and is writable by the dashboard while the sim runs.
//       S3 put the reward weights in it. The guard must refuse a changed reward
//       key and must NOT refuse a changed ecology key -- freezing the whole
//       config would break the operator's actual use of the dashboard.
//
// No real run log is used or needed: every fixture is hand-built here, so each
// expectation is checkable by reading this file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SUMMARIZER = path.join(REPO_ROOT, '_dev', 'sim-runs', 'summarize-reward-contract.js');
const summarizer = require(SUMMARIZER);
const liveConfig = require(path.join(__dirname, '..', 'live-config.js'));

let tmpRoot;
test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reward-provenance-'));
});
test.after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// --- fixture builders -------------------------------------------------------

function hiveRow(overrides) {
  return {
    tick: 1,
    hive: 'hive-a',
    action: 'idle',
    applied: true,
    // plan ant-sim-reward-specification-repair, S5-a3 (codex distinct review
    // fix): the plan's declared field contract is the literal string
    // 'not_applicable' for every non-territory verb, not null. This default
    // fixture defaults to action: 'idle', so its territory_outcome default
    // must match that contract; callers that override `action` to
    // 'claim-territory' always override `territory_outcome` too (see below).
    territory_outcome: 'not_applicable',
    territory_reward_contribution: 0,
    starved: false,
    food_exhausted: false,
    reward: 0,
    reward_contract_version: 3,
    stockpile: { food: 0, wood: 0, stone: 0 },
    ...overrides
  };
}

function writeLog(name, rows) {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function runCli(args) {
  return spawnSync(process.execPath, [SUMMARIZER, ...args], { encoding: 'utf8' });
}

// --- (a) the version gate ---------------------------------------------------

test('summarizer REFUSES mixed reward_contract_version (module + CLI)', () => {
  const rows = [
    hiveRow({ tick: 1, reward_contract_version: 2 }),
    hiveRow({ tick: 2, reward_contract_version: 3 })
  ];
  assert.throws(
    () => summarizer.summarizeRows(rows),
    (e) => e.name === 'RewardContractRefusal'
      && e.code === 'mixed-reward-contract-version'
      // the refusal must name the versions AND the row counts
      && /2=1 rows/.test(e.message) && /3=1 rows/.test(e.message)
  );

  const file = writeLog('mixed.jsonl', rows);
  const cli = runCli([file]);
  assert.notStrictEqual(cli.status, 0, 'CLI must exit non-zero on mixed versions');
  assert.strictEqual(cli.status, 2);
  assert.match(cli.stderr, /REFUSED: mixed reward_contract_version/);
  assert.match(cli.stderr, /2=1 rows/);
  assert.strictEqual(cli.stdout, '', 'a refusal summarizes nothing');
});

test('summarizer REFUSES rows missing reward_contract_version', () => {
  const rows = [hiveRow({ tick: 1 }), hiveRow({ tick: 2 })].map((r) => {
    delete r.reward_contract_version;
    return r;
  });
  assert.throws(
    () => summarizer.summarizeRows(rows),
    (e) => e.name === 'RewardContractRefusal' && e.code === 'missing-reward-contract-version'
  );

  const cli = runCli([writeLog('absent.jsonl', rows)]);
  assert.strictEqual(cli.status, 2);
  assert.match(cli.stderr, /reward_contract_version is absent/);
});

test('an explicit null version is treated as absent, not as a version', () => {
  const rows = [hiveRow({ reward_contract_version: null })];
  assert.throws(
    () => summarizer.summarizeRows(rows),
    (e) => e.code === 'missing-reward-contract-version'
  );
});

test('world rows and run markers are not counted as missing-version defects', () => {
  const rows = [
    hiveRow({ tick: 1, stockpile: { food: 1, wood: 0, stone: 0 } }),
    { tick: 1, hive: 'world', action: 'seed-wood', applied: true },
    { event: 'run-stopped', tick: 2, reason: 'signal' }
  ];
  const summary = summarizer.summarizeRows(summarizer.selectHiveRows(rows));
  assert.strictEqual(summary.rows, 1);
  assert.strictEqual(summary.ok, true);
});

// --- (a) the acceptance measures -------------------------------------------

test('clean single-version set summarizes, and ticks_with_food is counted exactly', () => {
  // 6 rows, 2 of which end the tick holding food. This is the plan's sharpest
  // acceptance measure -- it was 0 of 600 on the reference run.
  const rows = [
    hiveRow({ tick: 1, hive: 'hive-a', stockpile: { food: 0, wood: 0, stone: 0 }, food_exhausted: true }),
    hiveRow({ tick: 2, hive: 'hive-a', action: 'gather', stockpile: { food: 1, wood: 0, stone: 0 } }),
    hiveRow({ tick: 3, hive: 'hive-a', action: 'build', applied: false, stockpile: { food: 0, wood: 0, stone: 0 }, food_exhausted: true }),
    hiveRow({ tick: 1, hive: 'hive-b', stockpile: { food: 0, wood: 0, stone: 0 }, food_exhausted: true }),
    hiveRow({ tick: 2, hive: 'hive-b', action: 'gather', stockpile: { food: 2, wood: 0, stone: 0 } }),
    hiveRow({ tick: 3, hive: 'hive-b', stockpile: { food: 0, wood: 0, stone: 0 }, food_exhausted: true })
  ];
  const s = summarizer.summarizeRows(rows);
  assert.strictEqual(s.reward_contract_version, '3');
  assert.strictEqual(s.rows, 6);
  assert.strictEqual(s.ticks_with_food, 2);
  assert.strictEqual(s.per_hive['hive-a'].ticks_with_food, 1);
  assert.strictEqual(s.per_hive['hive-b'].ticks_with_food, 1);
  assert.strictEqual(s.food_exhausted, 4);
  assert.strictEqual(s.applied, 5);
  assert.strictEqual(s.applied_rate, 5 / 6);
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.violations, []);
  // The food-gather share is advisory and, with no resource lane on the row,
  // NOT DERIVABLE -- it must say so rather than invent a number.
  assert.strictEqual(s.food_gather_share_of_applied.advisory, true);
  assert.strictEqual(s.food_gather_share_of_applied.share, null);
});

test('applied rate is reported per window as well as overall', () => {
  const rows = [];
  for (let t = 1; t <= 100; t += 1) {
    rows.push(hiveRow({ tick: t, applied: t <= 50 })); // window 0 all applied, window 1 none
  }
  const s = summarizer.summarizeRows(rows, { windowSize: 50 });
  assert.strictEqual(s.applied_rate, 0.5);
  assert.strictEqual(s.applied_rate_by_window.length, 2);
  assert.deepStrictEqual(s.applied_rate_by_window[0].tick_range, [1, 50]);
  assert.strictEqual(s.applied_rate_by_window[0].applied_rate, 1);
  assert.strictEqual(s.applied_rate_by_window[1].applied_rate, 0);
});

test('territory outcomes are counted by name', () => {
  const rows = [
    hiveRow({ tick: 1, action: 'claim-territory', territory_outcome: 'newly_acquired', territory_reward_contribution: 0.5 }),
    hiveRow({ tick: 2, action: 'claim-territory', territory_outcome: 'already_owned', territory_reward_contribution: 0 }),
    hiveRow({ tick: 3, action: 'claim-territory', territory_outcome: 'contested', territory_reward_contribution: -0.5, applied: false })
  ];
  const s = summarizer.summarizeRows(rows);
  assert.strictEqual(s.territory.newly_acquired, 1);
  assert.strictEqual(s.territory.already_owned, 1);
  assert.strictEqual(s.territory.contested, 1);
  assert.strictEqual(s.ok, true);
});

// --- (a) the detectors, tested on data that violates them -------------------

test('DETECTOR: already_owned paying a non-zero territory reward fails the summarizer', () => {
  const rows = [
    hiveRow({ tick: 1, action: 'claim-territory', territory_outcome: 'already_owned', territory_reward_contribution: 0 }),
    hiveRow({ tick: 2, action: 'claim-territory', territory_outcome: 'already_owned', territory_reward_contribution: 0.5 })
  ];
  const s = summarizer.summarizeRows(rows);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.violations.length, 1);
  assert.strictEqual(s.violations[0].kind, 'already_owned_paid_reward');
  assert.strictEqual(s.violations[0].tick, 2);
  assert.strictEqual(s.violations[0].territory_reward_contribution, 0.5);

  const cli = runCli([writeLog('identity-violation.jsonl', rows)]);
  assert.strictEqual(cli.status, 3, 'an invariant violation must exit non-zero');
  assert.match(cli.stdout, /INVARIANT VIOLATIONS \(1\)/);
});

test('DETECTOR: zero tolerance -- a tiny non-zero contribution still violates', () => {
  const s = summarizer.summarizeRows([
    hiveRow({ action: 'claim-territory', territory_outcome: 'already_owned', territory_reward_contribution: 1e-9 })
  ]);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.violations[0].kind, 'already_owned_paid_reward');
});

test('DETECTOR: an already_owned row missing the contribution field violates', () => {
  const row = hiveRow({ action: 'claim-territory', territory_outcome: 'already_owned' });
  delete row.territory_reward_contribution;
  const s = summarizer.summarizeRows([row]);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.violations[0].territory_reward_contribution, null);
});

test('DETECTOR: cumulative newly_acquired above the shared 100-tile bound trips globally', () => {
  // 60 per hive: neither hive alone exceeds 100, but the grid is ONE grid
  // shared by both, so 120 across the pair is impossible and must be caught.
  const rows = [];
  for (let t = 1; t <= 60; t += 1) {
    for (const hive of ['hive-a', 'hive-b']) {
      rows.push(hiveRow({
        tick: t, hive, action: 'claim-territory',
        territory_outcome: 'newly_acquired', territory_reward_contribution: 0.5
      }));
    }
  }
  const s = summarizer.summarizeRows(rows);
  assert.strictEqual(s.newly_acquired_global, 120);
  assert.strictEqual(s.ok, false);
  const kinds = s.violations.map((v) => v.kind);
  assert.ok(kinds.includes('newly_acquired_exceeds_grid_global'));
  assert.ok(!kinds.includes('newly_acquired_exceeds_grid_per_hive'),
    'neither hive alone exceeded the bound -- only the global invariant did');
});

test('DETECTOR: a single hive above 100 trips the per-hive bound too', () => {
  const rows = [];
  for (let t = 1; t <= 101; t += 1) {
    rows.push(hiveRow({
      tick: t, action: 'claim-territory',
      territory_outcome: 'newly_acquired', territory_reward_contribution: 0.5
    }));
  }
  const s = summarizer.summarizeRows(rows);
  const kinds = s.violations.map((v) => v.kind);
  assert.ok(kinds.includes('newly_acquired_exceeds_grid_per_hive'));
  assert.ok(kinds.includes('newly_acquired_exceeds_grid_global'));
});

// --- (a) the CLI contract ---------------------------------------------------

test('CLI emits machine-readable JSON alongside the human text and exits 0 when clean', () => {
  const file = writeLog('clean.jsonl', [
    hiveRow({ tick: 1, stockpile: { food: 1, wood: 0, stone: 0 } }),
    hiveRow({ tick: 2, food_exhausted: true })
  ]);
  const cli = runCli([file]);
  assert.strictEqual(cli.status, 0);
  assert.match(cli.stdout, /ticks_with_food\s+1 of 2/);
  const lastLine = cli.stdout.trim().split('\n').pop();
  const parsed = JSON.parse(lastLine);
  assert.strictEqual(parsed.schema, 'RewardContractSummary/1.0');
  assert.strictEqual(parsed.ticks_with_food, 1);
  assert.strictEqual(parsed.ok, true);

  const jsonOnly = runCli([file, '--json']);
  assert.strictEqual(jsonOnly.status, 0);
  assert.strictEqual(JSON.parse(jsonOnly.stdout).ticks_with_food, 1);
});

test('CLI --help reports its own tier honestly', () => {
  const cli = runCli(['--help']);
  assert.strictEqual(cli.status, 0);
  assert.match(cli.stdout, /BLOCKING on this path, ADVISORY everywhere else/);
});

test('pooling two files of differing versions is refused, not silently merged', () => {
  const v2 = writeLog('v2.jsonl', [hiveRow({ reward_contract_version: 2 })]);
  const v3 = writeLog('v3.jsonl', [hiveRow({ reward_contract_version: 3 })]);
  const cli = runCli([v2, v3]);
  assert.strictEqual(cli.status, 2);
  assert.match(cli.stderr, /mixed reward_contract_version/);
});

// --- (b) the mid-run reward-weight freeze -----------------------------------

test('guard REFUSES a changed reward weight, naming key, old value and new value', () => {
  const snapshot = liveConfig.extractRewardSemantics(liveConfig.DEFAULT_CONFIG);
  const edited = { ...liveConfig.DEFAULT_CONFIG, reward_build_applied: 5 };
  assert.throws(
    () => liveConfig.assertRewardSemanticsUnchanged(snapshot, edited),
    (e) => e.name === 'RewardSemanticsChangedError'
      && /reward_build_applied 1\.5 -> 5/.test(e.message)
      && e.status === 'reward-semantics-changed-halt:reward_build_applied'
  );
  assert.deepStrictEqual(
    liveConfig.diffRewardSemantics(snapshot, edited),
    [{ key: 'reward_build_applied', from: 1.5, to: 5 }]
  );
});

test('guard REFUSES a changed gather_yield_food -- same hazard, same freeze', () => {
  const snapshot = liveConfig.extractRewardSemantics(liveConfig.DEFAULT_CONFIG);
  assert.throws(
    () => liveConfig.assertRewardSemanticsUnchanged(snapshot, { ...liveConfig.DEFAULT_CONFIG, gather_yield_food: 3 }),
    (e) => e.name === 'RewardSemanticsChangedError' && /gather_yield_food 2 -> 3/.test(e.message)
  );
});

test('guard does NOT refuse changed ECOLOGY keys -- the dashboard stays usable', () => {
  const snapshot = liveConfig.extractRewardSemantics(liveConfig.DEFAULT_CONFIG);
  const ecologyEdited = {
    ...liveConfig.DEFAULT_CONFIG,
    prey_graze_rate: 0.9,
    food_source_spawn_chance: 0.5,
    upkeep_cost_food: 3,
    tick_interval_ms: 1000,
    entropy_bonus_weight: 1.7,
    max_food_sources: 20
  };
  assert.deepStrictEqual(liveConfig.diffRewardSemantics(snapshot, ecologyEdited), []);
  assert.strictEqual(liveConfig.assertRewardSemanticsUnchanged(snapshot, ecologyEdited), true);
});

test('an omitted reward key resolves to the shipped default, so it is not a change', () => {
  const snapshot = liveConfig.extractRewardSemantics(liveConfig.DEFAULT_CONFIG);
  const withoutRewardKeys = { ...liveConfig.DEFAULT_CONFIG };
  for (const key of liveConfig.REWARD_SEMANTIC_KEYS) delete withoutRewardKeys[key];
  assert.deepStrictEqual(liveConfig.diffRewardSemantics(snapshot, withoutRewardKeys), []);
});

test('an explicit 0 or negative weight is compared by value, not by truthiness', () => {
  const snapshot = liveConfig.extractRewardSemantics(liveConfig.DEFAULT_CONFIG);
  // reward_idle ships as 0; changing it to -1 must be seen.
  assert.deepStrictEqual(
    liveConfig.diffRewardSemantics(snapshot, { ...liveConfig.DEFAULT_CONFIG, reward_idle: -1 }),
    [{ key: 'reward_idle', from: 0, to: -1 }]
  );
  // reward_food_exhausted ships as -2; restating it must NOT be seen.
  assert.deepStrictEqual(
    liveConfig.diffRewardSemantics(snapshot, { ...liveConfig.DEFAULT_CONFIG, reward_food_exhausted: -2 }),
    []
  );
});

test('every frozen key is a real live-config key with a shipped default', () => {
  for (const key of liveConfig.REWARD_SEMANTIC_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(liveConfig.DEFAULT_CONFIG, key),
      `${key} is frozen but has no shipped default`
    );
  }
  assert.strictEqual(liveConfig.REWARD_SEMANTIC_KEYS.length, 8);
});

test('run-live.js actually consults the guard -- the mechanism is wired, not just exported', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'run-live.js'), 'utf8');
  assert.match(src, /diffRewardSemantics/, 'run-live.js must import the guard');
  assert.match(src, /REWARD_SEMANTICS_SNAPSHOT = extractRewardSemantics/,
    'run-live.js must snapshot the reward semantics at run start');
  assert.match(src, /RewardSemanticsManifest\/1\.0/,
    'the snapshot must be durable, not just printed');
  assert.match(src, /reward-semantics-changed-halt/, 'the halt must reach STATUS');
  // The check must sit inside the tick loop, after the fresh read and before
  // the round's first trainTick -- otherwise it is a start-up check wearing a
  // mid-run check's name.
  const loopRead = src.indexOf('const liveConfig = readLiveConfig(CONFIG_PATH);');
  const guard = src.indexOf('const rewardChanges = diffRewardSemantics(');
  const firstTrain = src.indexOf('trainTick(hives[id]');
  assert.ok(loopRead !== -1 && guard !== -1 && firstTrain !== -1);
  assert.ok(loopRead < guard && guard < firstTrain,
    'the guard must run after the per-round config read and before the round is ticked');
});
