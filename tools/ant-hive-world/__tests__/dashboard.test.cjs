'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { setupTwoHives, tick } = require('../harness.js');
const { generateBlankHiveSeed } = require('../generate-blank-hive-seed.js');

function freshSandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ant-hive-world-dash-'));
}

// dashboard.js resolves SANDBOX_ROOT/WORLD_STATE_PATH from CLI args at module
// load time, so exercise its snapshot logic by re-requiring with env-driven
// paths isn't possible without a subprocess. Instead we import the pure
// functions directly against explicit paths to test the actual computation.
function loadDashboardWithPaths(sandboxRoot, worldStatePath) {
  // dashboard.js reads SANDBOX_ROOT/WORLD_STATE_PATH as module-level consts
  // derived from argv; simplest correctness test is to invoke it as a CLI
  // with --sandbox-root/--world-state and hit the snapshot endpoint, but for
  // a fast unit test we replicate discoverHives'/computeSnapshot's logic
  // surface via a fresh require after setting process.argv, since Node
  // caches modules by resolved path + this test file always gets a fresh
  // require cache per test file run.
  const originalArgv = process.argv;
  process.argv = [...originalArgv, '--sandbox-root', sandboxRoot, '--world-state', worldStatePath];
  delete require.cache[require.resolve('../dashboard.js')];
  const mod = require('../dashboard.js');
  process.argv = originalArgv;
  return mod;
}

test('computeSnapshot reports territory share and structures built per colony', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { hiveA, hiveB } = setupTwoHives(root, seedA, seedB, worldStatePath, { food: 10 });

  tick(hiveA, worldStatePath, () => ({ verb: 'claim-territory', tileId: 'tile-1' }));
  tick(hiveA, worldStatePath, () => ({ verb: 'claim-territory', tileId: 'tile-2' }));
  tick(hiveB, worldStatePath, () => ({ verb: 'claim-territory', tileId: 'tile-3' }));

  // BUILD_COST (harness.js) requires stockpiled wood -- credit it directly
  // since this test exercises structures-built accounting, not the
  // gather-to-build resource dependency.
  const preState = JSON.parse(fs.readFileSync(hiveA.hiveStatePath, 'utf8'));
  preState.hive_state.stockpile = { wood: 2 };
  fs.writeFileSync(hiveA.hiveStatePath, JSON.stringify(preState, null, 2));

  tick(hiveA, worldStatePath, () => ({ verb: 'build', entry: { kind: 'tunnel', coords: [0, 0, 0] } }));

  const { computeSnapshot } = loadDashboardWithPaths(root, worldStatePath);
  const snapshot = computeSnapshot();

  assert.equal(snapshot.world_state_present, true);
  assert.equal(snapshot.total_territory_tiles, 3);

  const a = snapshot.colonies.find((c) => c.identity === 'hive-a');
  const b = snapshot.colonies.find((c) => c.identity === 'hive-b');
  assert.equal(a.territory_tiles_held, 2);
  assert.equal(a.structures_built, 1);
  assert.ok(Math.abs(a.territory_share - 2 / 3) < 1e-9);
  assert.equal(b.territory_tiles_held, 1);
  assert.equal(b.structures_built, 0);
});

test('computeSnapshot handles a not-yet-initialized world gracefully', () => {
  const root = freshSandbox();
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  const { computeSnapshot } = loadDashboardWithPaths(root, worldStatePath);
  const snapshot = computeSnapshot();
  assert.equal(snapshot.world_state_present, false);
  assert.deepEqual(snapshot.colonies, []);
});

test('dashboard declares the culture builds container before rendering the mirror panel', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');
  const renderStart = source.indexOf('function renderCulture(data)');
  const renderEnd = source.indexOf('// --- Wiki view', renderStart);
  assert.ok(renderStart >= 0, 'renderCulture client function should exist');
  assert.ok(renderEnd > renderStart, 'renderCulture client function should have a bounded body');

  const renderBody = source.slice(renderStart, renderEnd);
  const buildsDeclaration = renderBody.indexOf("const buildsEl = document.getElementById('culture-builds');");
  const mirrorBranch = renderBody.indexOf('const mirror = culture.mirror;');
  assert.ok(buildsDeclaration >= 0, 'renderCulture should declare culture-builds');
  assert.ok(mirrorBranch >= 0, 'renderCulture should retain the optional mirror panel');
  assert.ok(buildsDeclaration < mirrorBranch, 'culture-builds must be declared before mirror rendering');
});

test('discoverHives finds N colonies including one added after initial setup', () => {
  const { addHive } = require('../harness.js');
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  setupTwoHives(root, seedA, seedB, worldStatePath, {});
  addHive(root, generateBlankHiveSeed('hive-npc', 'test', '2026-07-16T01:00:00Z'));

  const { discoverHives } = loadDashboardWithPaths(root, worldStatePath);
  const found = discoverHives(root).map((h) => h.identity).sort();
  assert.deepEqual(found, ['hive-a', 'hive-b', 'hive-npc']);
});

// Discovery-gated resources (plan ant-hive-world-richer-resource-model, S2).

test('computeSnapshot only shows resources present in discovered_types, not the full underlying pool', () => {
  const { initialWorldState, writeWorldState } = require('../world-state.js');
  const root = freshSandbox();
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  let state = initialWorldState({ wood: 20, stone: 10 });
  writeWorldState(worldStatePath, state);

  const { computeSnapshot } = loadDashboardWithPaths(root, worldStatePath);
  const snapshot = computeSnapshot();
  assert.deepEqual(Object.keys(snapshot.shared_resources).sort(), ['food', 'stone', 'wood']);
  assert.deepEqual(snapshot.discovered_types.sort(), ['food', 'stone', 'wood']);
  assert.equal(snapshot.shared_resources.clay, undefined);
});

// Wiki view (plan ant-hive-world-lore-wiki-layer, S3).

test('computeWikiSnapshot groups a hive\'s wiki-log entries by subject and returns a chronological index', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  setupTwoHives(root, seedA, seedB, worldStatePath, {});

  const wikiLogPath = path.join(root, 'hive-a', 'wiki-log.jsonl');
  fs.writeFileSync(wikiLogPath, [
    JSON.stringify({ ts: '2026-07-17T00:00:00Z', hive: 'hive-a', entry_type: 'discovery', subject: 'clay', narrative_text: 'Clay found.', tier: 'routine' }),
    JSON.stringify({ ts: '2026-07-17T00:01:00Z', hive: 'hive-a', entry_type: 'discovery', subject: 'water', narrative_text: 'Water found.', tier: 'routine' }),
    JSON.stringify({ ts: '2026-07-17T00:02:00Z', hive: 'hive-a', entry_type: 'structure', subject: 'structure-1', narrative_text: 'A tunnel rises.', tier: 'routine' })
  ].join('\n') + '\n');

  const { computeWikiSnapshot } = loadDashboardWithPaths(root, worldStatePath);
  const snapshot = computeWikiSnapshot('hive-a');
  assert.equal(snapshot.subject_count, 3);
  assert.equal(snapshot.pages.clay.entries.length, 1);
  assert.equal(snapshot.chronological.length, 3);
  assert.equal(snapshot.chronological[0].subject, 'clay'); // earliest first
});

test('computeWikiSnapshot returns empty structures (not a crash) for a hive with no wiki log yet', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  setupTwoHives(root, seedA, seedB, worldStatePath, {});

  const { computeWikiSnapshot } = loadDashboardWithPaths(root, worldStatePath);
  const snapshot = computeWikiSnapshot('hive-a');
  assert.equal(snapshot.subject_count, 0);
  assert.deepEqual(snapshot.chronological, []);
  assert.deepEqual(snapshot.pending_milestones, []);
});

test('computeWikiSnapshot surfaces queued pending-milestone entries separately from generated entries', () => {
  const root = freshSandbox();
  const seedA = generateBlankHiveSeed('hive-a', 'test', '2026-07-16T00:00:00Z');
  const seedB = generateBlankHiveSeed('hive-b', 'test', '2026-07-16T00:00:00Z');
  const worldStatePath = path.join(root, 'shared', 'world-state.json');
  setupTwoHives(root, seedA, seedB, worldStatePath, {});

  fs.writeFileSync(
    path.join(root, 'hive-a', 'pending-milestone-narration.jsonl'),
    JSON.stringify({ ts: '2026-07-17T00:00:00Z', hive: 'hive-a', entry_type: 'milestone', subject: 'prey-crash', tier: 'milestone' }) + '\n'
  );

  const { computeWikiSnapshot } = loadDashboardWithPaths(root, worldStatePath);
  const snapshot = computeWikiSnapshot('hive-a');
  assert.equal(snapshot.pending_milestones.length, 1);
  assert.equal(snapshot.pending_milestones[0].subject, 'prey-crash');
  assert.equal(snapshot.subject_count, 0); // milestone queue is separate from the actual wiki log
});
