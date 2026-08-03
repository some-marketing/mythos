'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SCHEMA_NAMES,
  createEventContext,
  identifyEventRow
} = require('../event-schema.js');
const { setupHives, tick } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-event-schema-'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function assertContract(row, schemaName, context, eventTick) {
  assert.equal(row.schema_name, schemaName);
  assert.equal(row.schema_version, '1.0.0');
  assert.equal(row.run_id, context.run_id);
  assert.equal(row.episode_id, context.episode_id);
  assert.equal(row.arm_id, context.arm_id);
  assert.equal(row.tick, eventTick);
  assert.equal(typeof row.tick_key, 'string');
}

test('audit and geometry writers emit identity, tick, schema, and embedded build-time state', () => {
  const root = freshSandbox();
  const worldPath = path.join(root, 'shared', 'world-state.json');
  const context = createEventContext({ armId: 'instruction-a', runId: 'run-test', episodeId: 'episode-test' });
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-02T00:00:00Z');
  seed.hive_state.stockpile = { wood: 2 };
  const hives = setupHives(root, [seed], worldPath, { wood: 5 }, context);

  const result = tick(
    hives['hive-a'], worldPath,
    () => ({ verb: 'build', entry: { kind: 'chamber', coords: [4, 0, 0] } }),
    {}, () => 0.5, 7
  );

  const audit = readJsonl(hives['hive-a'].auditLogPath);
  const auditTick = audit.find((row) => row.event === 'tick');
  assert.ok(auditTick);
  for (const row of audit) assertContract(row, SCHEMA_NAMES.audit, context, 7);
  assert.deepEqual(auditTick.stockpile, { ...seed.hive_state.stockpile, wood: 0 });
  assert.deepEqual(auditTick.coords, [4, 0, 0]);
  assert.equal(auditTick.resource_depleted, true);

  const geometry = result.worldState.geometry_log[0];
  assertContract(geometry, SCHEMA_NAMES.geometry, context, 7);
  assert.deepEqual(geometry.state_at_event.stockpile, auditTick.stockpile);
  assert.deepEqual(geometry.state_at_event.coords, [4, 0, 0]);
  assert.equal(geometry.tick_key, auditTick.tick_key);
});

test('material discovery audit rows carry the same required contract and environmental tile context', () => {
  const root = freshSandbox();
  const worldPath = path.join(root, 'shared', 'world-state.json');
  const context = createEventContext({ runId: 'run-material', episodeId: 'episode-material' });
  const seed = generateBlankHiveSeed('hive-a', 'test', '2026-08-02T00:00:00Z');
  const hives = setupHives(root, [seed], worldPath, {}, context);

  tick(hives['hive-a'], worldPath, () => ({ verb: 'idle' }), {
    material_harvest_rate: 1,
    material_spawn_chance: 0
  }, () => 0.5, 3);

  const discoveries = readJsonl(hives['hive-a'].auditLogPath)
    .filter((row) => row.event === 'material-discovered');
  assert.ok(discoveries.length > 0);
  for (const row of discoveries) {
    assertContract(row, SCHEMA_NAMES.audit, context, 3);
    assert.ok(Array.isArray(row.tile_ids) && row.tile_ids.length > 0);
    assert.equal(typeof row.resource_depleted, 'boolean');
    assert.equal(typeof row.stockpile, 'object');
  }
});

test('pre-contract rows are tolerated and explicitly identified', () => {
  const old = { ts: '2026-07-01T00:00:00Z', event: 'tick', verb: 'idle' };
  assert.deepEqual(identifyEventRow(old), { contract_status: 'pre-contract', row: old });
  const current = { schema_name: SCHEMA_NAMES.audit, schema_version: '1.0.0' };
  assert.equal(identifyEventRow(current).contract_status, 'contract');
});

test('run, episode, and arm identity are stable in-process and distinct across processes', () => {
  const moduleA = require('../event-schema.js');
  const moduleB = require('../event-schema.js');
  assert.strictEqual(moduleA.processEventContext, moduleB.processEventContext);
  assert.equal(moduleA.processEventContext.arm_id, 'uninstructed');

  const script = "const c=require('./event-schema.js').processEventContext;process.stdout.write(JSON.stringify(c))";
  const opts = { cwd: path.join(__dirname, '..'), encoding: 'utf8' };
  const childA = spawnSync(process.execPath, ['-e', script], opts);
  const childB = spawnSync(process.execPath, ['-e', script], opts);
  assert.equal(childA.status, 0, childA.stderr);
  assert.equal(childB.status, 0, childB.stderr);
  const a = JSON.parse(childA.stdout);
  const b = JSON.parse(childB.stdout);
  assert.notEqual(a.run_id, b.run_id);
  assert.notEqual(a.episode_id, b.episode_id);
});

test('run-live writes contracted rows with an explicit default arm and resolvable tick keys', () => {
  const root = freshSandbox();
  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'run-live.js'),
    '--ticks', '1', '--sandbox-root', root,
    '--seed-a', '101', '--seed-b', '202'
  ], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);

  const runRows = readJsonl(path.join(root, 'run-log.jsonl'));
  assert.equal(runRows.length, 2);
  const context = {
    run_id: runRows[0].run_id,
    episode_id: runRows[0].episode_id,
    arm_id: 'uninstructed'
  };
  for (const row of runRows) assertContract(row, SCHEMA_NAMES.run, context, 1);
  assert.equal(new Set(runRows.map((row) => row.run_id)).size, 1);
  assert.equal(new Set(runRows.map((row) => row.episode_id)).size, 1);

  for (const row of runRows) {
    const auditPath = path.join(root, row.hive, 'audit-log.jsonl');
    const auditTick = readJsonl(auditPath).find((entry) => entry.event === 'tick');
    assert.ok(auditTick, `missing audit tick for ${row.hive}`);
    assert.equal(auditTick.tick_key, row.tick_key);
  }
});
