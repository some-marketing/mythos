'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { writeRetainedReconciliationCas } = require('../reconcile-retained.js');

const TOOL = path.resolve(__dirname, '..', 'reconcile-retained.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeFixture(t, { ambiguous = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-retained-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const client = 'TEST';
  const clientRoot = path.join(repo, 'clients', client);
  const mountedPath = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Test', client);
  const privateRelPath = path.join('people', '.gitkeep');
  const publicRelPath = 'next-session-handoff.md';
  for (const relPath of [privateRelPath, publicRelPath]) {
    fs.mkdirSync(path.dirname(path.join(clientRoot, relPath)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(mountedPath, relPath)), { recursive: true });
    fs.writeFileSync(path.join(clientRoot, relPath), '');
    fs.writeFileSync(path.join(mountedPath, relPath), '');
  }
  if (ambiguous) {
    const second = path.join('another-private-area', '.gitkeep');
    fs.mkdirSync(path.dirname(path.join(clientRoot, second)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(mountedPath, second)), { recursive: true });
    fs.writeFileSync(path.join(clientRoot, second), '');
    fs.writeFileSync(path.join(mountedPath, second), '');
  }
  fs.writeFileSync(
    path.join(clientRoot, 'client.json'),
    JSON.stringify({
      code: client,
      file_storage: {
        provider: 'onedrive',
        mounted_path: mountedPath,
        manifest: 'storage-map.json'
      }
    })
  );
  const piiId = '22222222-2222-4222-8222-222222222222';
  const privateMapPath = path.join(clientRoot, 'pii-path-map.json');
  fs.writeFileSync(privateMapPath, JSON.stringify({
    schema: 'ClientStoragePiiPathMap/1.0',
    client,
    generated_at: new Date().toISOString(),
    entries: []
  }));
  const classifyPath = path.join(root, 'classify.json');
  fs.writeFileSync(classifyPath, JSON.stringify({
    schema: 'ClientStorageClassify/1.0',
    client,
    pii_path_map_binding: {
      required: true,
      schema: 'ClientStoragePiiPathMap/1.0',
      client,
      entry_count: 0,
      sha256: sha256(fs.readFileSync(privateMapPath))
    },
    entries: [
      { klass: 'KEEP', relpath: publicRelPath, size: 0 },
      { klass: 'KEEP', report_id: '33333333-3333-4333-8333-333333333333', size: 0, identity_redacted: true }
    ]
  }));
  const baseEntry = {
    size: 0,
    mtime: new Date().toISOString(),
    sha256: sha256(''),
    batch: 0,
    migrated_at: new Date().toISOString(),
    local_deleted_at: null
  };
  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  fs.writeFileSync(storageMapPath, JSON.stringify({
    schema_version: 1,
    client,
    drive: { provider: 'onedrive', mounted_path: mountedPath, mount_dir: 'OneDrive-Test' },
    rules: { moved: [], kept: [] },
    entries: [
      { ...baseEntry, repo_relpath: publicRelPath, drive_relpath: publicRelPath, renamed_to: null },
      { ...baseEntry, pii_id: piiId }
    ]
  }));
  return {
    repo,
    home,
    client,
    clientRoot,
    mountedPath,
    classifyPath,
    storageMapPath,
    privateMapPath,
    privateRelPath,
    publicRelPath,
    piiId
  };
}

function run(fixture, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--client', fixture.client,
    '--classify-report', fixture.classifyPath,
    ...extra
  ], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: { ...process.env, HOME: fixture.home, CLAUDE_PROJECT_DIR: fixture.repo }
  });
}

test('retained reconciliation preserves cloud snapshots and local human-workflow files', (t) => {
  const fixture = makeFixture(t);
  const sourceInodes = [
    fs.statSync(path.join(fixture.clientRoot, fixture.privateRelPath)).ino,
    fs.statSync(path.join(fixture.clientRoot, fixture.publicRelPath)).ino
  ];
  const targetInodes = [
    fs.statSync(path.join(fixture.mountedPath, fixture.privateRelPath)).ino,
    fs.statSync(path.join(fixture.mountedPath, fixture.publicRelPath)).ino
  ];
  const dry = run(fixture);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stderr, /"newly_preserved_snapshots":2/);
  assert.equal(JSON.parse(fs.readFileSync(fixture.storageMapPath)).entries.length, 2);

  const execute = run(fixture, ['--execute']);
  assert.equal(execute.status, 0, execute.stderr);
  const storageMap = JSON.parse(fs.readFileSync(fixture.storageMapPath));
  const privateMap = JSON.parse(fs.readFileSync(fixture.privateMapPath));
  assert.equal(storageMap.entries.length, 0);
  assert.equal(storageMap.preserved_snapshots.length, 2);
  assert.equal(storageMap.preserved_snapshots.find((entry) => entry.pii_id).repo_relpath, undefined);
  assert.equal(privateMap.entries.length, 0);
  assert.equal(privateMap.retained_entries.length, 1);
  assert.equal(privateMap.retained_entries[0].pii_id, fixture.piiId);
  assert.deepEqual([
    fs.statSync(path.join(fixture.clientRoot, fixture.privateRelPath)).ino,
    fs.statSync(path.join(fixture.clientRoot, fixture.publicRelPath)).ino
  ], sourceInodes);
  assert.deepEqual([
    fs.statSync(path.join(fixture.mountedPath, fixture.privateRelPath)).ino,
    fs.statSync(path.join(fixture.mountedPath, fixture.publicRelPath)).ino
  ], targetInodes);
});

test('retained PII recovery fails closed when identical local/cloud locators are ambiguous', (t) => {
  const fixture = makeFixture(t, { ambiguous: true });
  const storageBefore = fs.readFileSync(fixture.storageMapPath);
  const privateBefore = fs.readFileSync(fixture.privateMapPath);
  const result = run(fixture, ['--execute']);
  assert.equal(result.status, 25, result.stderr);
  assert.match(result.stderr, /PII_MAP_DRIFT/);
  assert.deepEqual(fs.readFileSync(fixture.storageMapPath), storageBefore);
  assert.deepEqual(fs.readFileSync(fixture.privateMapPath), privateBefore);
});

test('retained reconciliation compare-and-swap preserves concurrent controls', (t) => {
  const fixture = makeFixture(t);
  const originalStorageBytes = fs.readFileSync(fixture.storageMapPath);
  const originalPrivateBytes = fs.readFileSync(fixture.privateMapPath);
  const nextStorageMap = JSON.parse(originalStorageBytes);
  nextStorageMap.marker = 'reconciled';
  const nextPrivateMap = JSON.parse(originalPrivateBytes);
  nextPrivateMap.marker = 'reconciled';
  fs.writeFileSync(fixture.storageMapPath, JSON.stringify({ concurrent: true }));
  const result = writeRetainedReconciliationCas({
    storageMapPath: fixture.storageMapPath,
    privateMapPath: fixture.privateMapPath,
    originalStorageBytes,
    originalPrivateBytes,
    nextStorageMap,
    nextPrivateMap
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(fixture.storageMapPath)).concurrent, true);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, '.storage-map.lock')), false);
});

test('retained reconciliation rolls both controls back when second publication fails', (t) => {
  const fixture = makeFixture(t);
  const originalStorageBytes = fs.readFileSync(fixture.storageMapPath);
  const originalPrivateBytes = fs.readFileSync(fixture.privateMapPath);
  const nextStorageMap = { ...JSON.parse(originalStorageBytes), marker: 'next' };
  const nextPrivateMap = { ...JSON.parse(originalPrivateBytes), marker: 'next' };
  let writes = 0;
  const result = writeRetainedReconciliationCas({
    storageMapPath: fixture.storageMapPath,
    privateMapPath: fixture.privateMapPath,
    originalStorageBytes,
    originalPrivateBytes,
    nextStorageMap,
    nextPrivateMap
  }, (filePath, content) => {
    writes += 1;
    if (writes === 2) throw new Error('synthetic publication failure');
    fs.writeFileSync(filePath, content);
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /restored/);
  assert.deepEqual(fs.readFileSync(fixture.storageMapPath), originalStorageBytes);
  assert.deepEqual(fs.readFileSync(fixture.privateMapPath), originalPrivateBytes);
});

test('missing or deferred manifest identities are never relabeled as preserved', (t) => {
  for (const disposition of ['missing', 'deferred']) {
    const fixture = makeFixture(t);
    const classify = JSON.parse(fs.readFileSync(fixture.classifyPath));
    classify.entries = disposition === 'deferred'
      ? [{ klass: 'DEFERRED-DIRTY', report_id: '77777777-7777-4777-8777-777777777777', size: 0, identity_redacted: true }]
      : [];
    fs.writeFileSync(fixture.classifyPath, JSON.stringify(classify));
    const storageBefore = fs.readFileSync(fixture.storageMapPath);
    const result = run(fixture, ['--execute']);
    assert.equal(result.status, 21, `${disposition}: ${result.stderr}`);
    assert.match(result.stderr, /CLASSIFY_DRIFT/);
    assert.deepEqual(fs.readFileSync(fixture.storageMapPath), storageBefore);
  }
});
