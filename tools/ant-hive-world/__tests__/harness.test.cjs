'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { setupTwoHives, setupHives, addHive, tick } = require('../harness.js');
const { readWorldState } = require('../world-state.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');
const { validateHiveMind, isBlankSeed } = require('../validate-hive-mind.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-'));
}

test('setupTwoHives creates two isolated sandboxes + one shared world-state file', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 10 });

  assert.notEqual(hiveA.dir, hiveB.dir);
  assert.ok(fs.existsSync(hiveA.hiveStatePath));
  assert.ok(fs.existsSync(hiveB.hiveStatePath));
  assert.ok(fs.existsSync(worldStatePath));

  // Isolation: hive-a's sandbox contains no reference to hive-b's files, and vice versa.
  const hiveAFiles = fs.readdirSync(hiveA.dir);
  const hiveBFiles = fs.readdirSync(hiveB.dir);
  assert.ok(!hiveAFiles.includes('hive-b'));
  assert.ok(!hiveBFiles.includes('hive-a'));
});

test('both blank seeds still validate clean after being written into sandboxes', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 10 });

  const writtenA = JSON.parse(fs.readFileSync(hiveA.hiveStatePath, 'utf8'));
  const writtenB = JSON.parse(fs.readFileSync(hiveB.hiveStatePath, 'utf8'));
  assert.equal(validateHiveMind(writtenA).valid, true);
  assert.equal(validateHiveMind(writtenB).valid, true);
  assert.equal(isBlankSeed(writtenA).valid, true);
  assert.equal(isBlankSeed(writtenB).valid, true);
});

test('gather claims a finite shared resource -- second hive sees it depleted', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  // wood, not food -- food now has its own spoilage/regrowth dynamics
  // (applyFoodDynamics), which would regrow it off an exact 0 and muddy this
  // test's actual point (shared-resource contention, not food mechanics).
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { wood: 5 });

  const gatherAll = () => ({ verb: 'gather', resourceKey: 'wood', amount: 5 });
  const idle = () => ({ verb: 'idle' });

  const afterA = tick(hiveA, worldStatePath, gatherAll);
  assert.equal(afterA.applied, true);
  assert.equal(afterA.worldState.resources.wood, 0);

  // hive-b now contends over the SAME depleted shared resource -- this is the
  // actual circumstance-driven contention mechanism, not a scripted rivalry.
  const afterB = tick(hiveB, worldStatePath, gatherAll);
  assert.equal(afterB.applied, false);

  const finalWorld = readWorldState(worldStatePath);
  assert.equal(finalWorld.resources.wood, 0);
});

test('build appends a geometry entry attributed to the acting hive', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, {});

  // BUILD_COST (harness.js) requires a stockpiled wood amount -- credit it
  // directly here since this test is about geometry-log attribution, not
  // about the wood-to-build resource dependency (covered below).
  const preState = JSON.parse(fs.readFileSync(hiveA.hiveStatePath, 'utf8'));
  preState.hive_state.stockpile = { wood: 2 };
  fs.writeFileSync(hiveA.hiveStatePath, JSON.stringify(preState, null, 2));

  const buildTunnel = () => ({ verb: 'build', entry: { kind: 'tunnel', coords: [0, 0, 1] } });
  const result = tick(hiveA, worldStatePath, buildTunnel);
  assert.equal(result.applied, true);
  assert.equal(result.worldState.geometry_log.length, 1);
  assert.equal(result.worldState.geometry_log[0].hive, 'hive-a');
  assert.equal(result.worldState.geometry_log[0].kind, 'tunnel');
});

test('build requires and consumes two stockpiled wood', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, {});
  const buildTunnel = () => ({ verb: 'build', entry: { kind: 'tunnel', coords: [0, 0, 1] } });

  const rejected = tick(hiveA, worldStatePath, buildTunnel);
  assert.equal(rejected.applied, false);
  assert.equal(rejected.worldState.geometry_log.length, 0);
  assert.ok(fs.readFileSync(hiveA.auditLogPath, 'utf8').includes('build-insufficient-materials'));

  const fundedState = JSON.parse(fs.readFileSync(hiveA.hiveStatePath, 'utf8'));
  fundedState.hive_state.stockpile = { wood: 2 };
  fs.writeFileSync(hiveA.hiveStatePath, JSON.stringify(fundedState, null, 2));

  const applied = tick(hiveA, worldStatePath, buildTunnel);
  assert.equal(applied.applied, true);
  assert.equal(applied.hiveState.hive_state.stockpile.wood, 0);
  assert.equal(applied.worldState.geometry_log.length, 1);
});

test('claiming a tile the other hive already holds is contested, not silently overwritten', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, {});

  const claimTile1 = () => ({ verb: 'claim-territory', tileId: 'tile-1' });
  const afterA = tick(hiveA, worldStatePath, claimTile1);
  assert.equal(afterA.applied, true);
  assert.equal(afterA.worldState.territory['tile-1'], 'hive-a');

  const afterB = tick(hiveB, worldStatePath, claimTile1);
  assert.equal(afterB.applied, false);
  assert.equal(afterB.worldState.territory['tile-1'], 'hive-a'); // unchanged -- not silently overwritten

  const auditB = fs.readFileSync(hiveB.auditLogPath, 'utf8');
  assert.ok(auditB.includes('territory-contested'));
});

test('setupHives supports N colonies, not just 2 (operator: NPC/other colonies introduced as needed)', () => {
  const root = freshSandbox();
  const seeds = [
    generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z'),
    generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z'),
    generateBlankHiveSeed('hive-c-npc', 'test', '2026-07-16T00:00:00Z')
  ];
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const hives = setupHives(root, seeds, worldStatePath, { food: 9 });

  assert.equal(Object.keys(hives).length, 3);
  assert.ok(fs.existsSync(hives['hive-c-npc'].hiveStatePath));

  const idle = () => ({ verb: 'idle' });
  const result = tick(hives['hive-c-npc'], worldStatePath, idle);
  assert.equal(result.hiveState.identity, 'hive-c-npc');
});

test('addHive introduces a new colony into an already-running world without touching existing hives', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 9 });

  const before = fs.readFileSync(hiveA.hiveStatePath, 'utf8');

  const npcSeed = generateBlankHiveSeed('hive-npc', 'test', '2026-07-16T01:00:00Z');
  const hiveNpc = addHive(root, npcSeed);

  assert.ok(fs.existsSync(hiveNpc.hiveStatePath));
  assert.equal(fs.readFileSync(hiveA.hiveStatePath, 'utf8'), before); // untouched
  assert.equal(fs.readFileSync(hiveB.hiveStatePath, 'utf8'), fs.readFileSync(hiveB.hiveStatePath, 'utf8'));

  const idle = () => ({ verb: 'idle' });
  const result = tick(hiveNpc, worldStatePath, idle);
  assert.equal(result.applied, false); // idle applies nothing, but ticks cleanly
});

test('a successful gather with a tileId deposits a pheromone trail the OTHER hive can sense in the shared world-state', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  // wood, not food -- food gather now depletes a SPECIFIC discrete source
  // (see world-state.js's food_sources model), which would fail on an
  // arbitrary tileId; wood still uses the simple abstract shared pool, so
  // these pheromone-mechanics tests (deposit/decay) stay focused on that.
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, { wood: 10 });

  const gatherAtTile = () => ({ verb: 'gather', resourceKey: 'wood', amount: 1, tileId: 'tile-42' });
  const result = tick(hiveA, worldStatePath, gatherAtTile);
  assert.equal(result.applied, true);
  // decay (harness.js's per-tick evaporation) applies in the SAME tick as the
  // deposit -- time passes within a tick too -- so the sensed strength is
  // deposit * decay-factor (1 * 0.9), not the raw deposit amount.
  assert.ok(result.worldState.pheromones.wood['tile-42'] > 0.85 && result.worldState.pheromones.wood['tile-42'] < 0.95);
});

test('pheromone trails decay every tick -- an unreinforced trail fades rather than staying scripted forever', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, { wood: 10 });

  const gatherAtTile = () => ({ verb: 'gather', resourceKey: 'wood', amount: 1, tileId: 'tile-1' });
  const idle = () => ({ verb: 'idle' });

  const first = tick(hiveA, worldStatePath, gatherAtTile);
  const strengthAfterDeposit = first.worldState.pheromones.wood['tile-1'];
  const second = tick(hiveA, worldStatePath, idle);
  const strengthAfterOneIdleTick = second.worldState.pheromones.wood['tile-1'];
  assert.ok(strengthAfterOneIdleTick < strengthAfterDeposit, 'expected trail strength to decay without reinforcement');
});

// codex distinct review (2026-07-17), blocking finding: a successful
// claim-territory tick's audit entry omitted action.tileId entirely, so the
// lore engine's territory trigger could never know which tile was claimed
// during an actual live run (only hand-authored unit tests supplied one).

test('a successful claim-territory tick records the claimed tileId in its audit entry', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, {});

  tick(hiveA, worldStatePath, () => ({ verb: 'claim-territory', tileId: 'tile-7' }));

  const auditLines = fs.readFileSync(hiveA.auditLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const territoryEntry = auditLines.find((e) => e.verb === 'claim-territory');
  assert.equal(territoryEntry.tileId, 'tile-7');
});

// codex distinct review (2026-07-17), blocking finding: the new materials
// (clay/water/ore/fiber/mud) are discovered PASSIVELY by
// applyMaterialDynamics, never via the network's 'gather' verb (the live
// network only ever gathers food/wood) -- so without an explicit audit
// event, the lore engine could never narrate these discoveries during an
// actual live run.

test('tick emits a material-discovered audit event the first time an environmental material becomes available, without inflating the tick count', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, {});

  // materialHarvestRate: 1 guarantees at least one material fully harvests
  // from its seeded source patches within a handful of ticks.
  const idle = () => ({ verb: 'idle' });
  let sawDiscovery = false;
  for (let i = 0; i < 5 && !sawDiscovery; i++) {
    tick(hiveA, worldStatePath, idle, { material_harvest_rate: 1, material_spawn_chance: 0 }, () => 0.5);
    const auditLines = fs.readFileSync(hiveA.auditLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    sawDiscovery = auditLines.some((e) => e.event === 'material-discovered');
  }
  assert.ok(sawDiscovery, 'expected at least one material-discovered event within 5 ticks at harvestRate=1');

  const auditLines = fs.readFileSync(hiveA.auditLogPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const tickEvents = auditLines.filter((e) => e.event === 'tick');
  const discoveryEvents = auditLines.filter((e) => e.event === 'material-discovered');
  // Exactly one 'tick' event per actual tick() call, regardless of how many
  // material-discovered annotations accompany it -- the discovery events
  // must never be counted as additional ticks by anything consuming this log.
  assert.equal(tickEvents.length, auditLines.length - discoveryEvents.length);
});

test('an unrecognized verb (drift toward something outside the closed set) is rejected and logged, never silently absorbed', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA } = setupTwoHives(root, seedA, seedB, worldStatePath, {});

  const rogue = () => ({ verb: 'self-declare-gnosis' });
  const result = tick(hiveA, worldStatePath, rogue);
  assert.equal(result.applied, false);
  const audit = fs.readFileSync(hiveA.auditLogPath, 'utf8');
  assert.ok(audit.includes('rejected-verb'));
});
