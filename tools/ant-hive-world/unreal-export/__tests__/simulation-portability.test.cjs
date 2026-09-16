'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const importer = require('../import-turn.js');
const watcher = require('../watch-imports.js');

test('import and watch reject path-bearing turn IDs before deriving output paths', () => {
  for (const bad of ['../escape', 'nested/turn', 'nested\\turn', '/absolute', '..', '', 42]) {
    assert.throws(() => importer.assertSafeTurnId(bad), /basename-safe/, `importer accepted ${JSON.stringify(bad)}`);
    assert.equal(watcher.assertSafeTurnId(bad), false, `watcher accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(importer.assertSafeTurnId('baseline-3000-r6'), 'baseline-3000-r6');
  assert.throws(() => watcher.outPathForTurn('/tmp/out', '../escape'), /basename-safe/);
});

test('watch completeness probe refuses a path-bearing run_name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unreal-portability-'));
  const harvest = path.join(root, 'harvest');
  const run = path.join(harvest, 'run-1');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(harvest, 'PULL-MANIFEST.txt'), '# fixture\n');
  fs.writeFileSync(path.join(run, 'RESULT-MANIFEST.txt'), '# fixture\n');
  fs.writeFileSync(path.join(run, 'world-state.json'), '{}\n');
  fs.writeFileSync(path.join(run, 'turn-projection.json'), JSON.stringify({ run_name: '../escape', ticks: 1 }) + '\n');
  assert.deepEqual(watcher.inspectHarvestDir(harvest), {
    complete: false,
    reason: 'turn-projection.json run_name is not basename-safe'
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('runtime import output defaults to the ignored state directory', () => {
  assert.match(importer.DEFAULT_OUT_DIR, /_dev[\\/]state[\\/]unreal-import$/);
  assert.match(watcher.DEFAULT_OUT_DIR, /_dev[\\/]state[\\/]unreal-import$/);
});

test('goal projection carries the packet hash without exporting its source path', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../run-live.js'), 'utf8');
  assert.match(source, /packet_path: null/);
  assert.doesNotMatch(source, /packet_path:\s*GOAL_PACKET_PATH/);
  assert.match(source, /commitGenerationEntries\(VAULT_PATH, commitResult\.generation_id, WORLD_STATE_PATH\)/);
});
