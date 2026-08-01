'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  writeReconciledMapCas
} = require('../reconcile-pii.js');

const TOOL = path.resolve(__dirname, '..', 'reconcile-pii.js');
const VERIFY_TOOL = path.resolve(__dirname, '..', 'verify-migration.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-reconcile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const client = 'TEST';
  const clientRoot = path.join(repo, 'clients', client);
  const mountedPath = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Test', client);
  const relPath = path.join('incoming', 'contact.csv');
  const sourcePath = path.join(clientRoot, relPath);
  const targetPath = path.join(mountedPath, relPath);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
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
  const payload = 'email,phone\nsynthetic@example.com,555-0100\n';
  fs.writeFileSync(sourcePath, payload);
  fs.writeFileSync(targetPath, payload);
  const contentSha256 = sha256(payload);
  const piiId = '11111111-1111-4111-8111-111111111111';
  const piiMapPath = path.join(clientRoot, 'pii-path-map.json');
  fs.writeFileSync(
    piiMapPath,
    JSON.stringify({
      schema: 'ClientStoragePiiPathMap/1.0',
      client,
      generated_at: new Date().toISOString(),
      entries: [{ pii_id: piiId, repo_relpath: relPath, size: Buffer.byteLength(payload), sha256: contentSha256 }]
    })
  );
  const classifyPath = path.join(root, 'classify.json');
  fs.writeFileSync(
    classifyPath,
    JSON.stringify({
      schema: 'ClientStorageClassify/1.0',
      client,
      pii_path_map_binding: {
        required: true,
        schema: 'ClientStoragePiiPathMap/1.0',
        client,
        entry_count: 1,
        sha256: sha256(fs.readFileSync(piiMapPath))
      },
      entries: [{
        klass: 'PII-MOVE',
        pii_id: piiId,
        size: Buffer.byteLength(payload),
        sha256_prefix: contentSha256.slice(0, 8)
      }]
    })
  );
  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  fs.writeFileSync(
    storageMapPath,
    JSON.stringify({
      schema_version: 1,
      client,
      drive: {
        provider: 'onedrive',
        mounted_path: mountedPath,
        mount_dir: 'OneDrive-Test'
      },
      rules: { moved: [], kept: [] },
      entries: [{
        repo_relpath: relPath,
        drive_relpath: relPath,
        size: Buffer.byteLength(payload),
        mtime: new Date().toISOString(),
        sha256: contentSha256,
        batch: 0,
        migrated_at: new Date().toISOString(),
        renamed_to: null,
        local_deleted_at: null
      }]
    })
  );
  return {
    repo,
    home,
    client,
    relPath,
    classifyPath,
    storageMapPath,
    sourcePath,
    targetPath,
    piiId
  };
}

function run(fixture, extra = []) {
  return spawnSync(process.execPath, [
    TOOL,
    '--client',
    fixture.client,
    '--classify-report',
    fixture.classifyPath,
    ...extra
  ], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.home,
      CLAUDE_PROJECT_DIR: fixture.repo
    }
  });
}

function runVerify(fixture) {
  return spawnSync(process.execPath, [
    VERIFY_TOOL,
    '--client',
    fixture.client,
    '--classify-report',
    fixture.classifyPath
  ], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.home,
      CLAUDE_PROJECT_DIR: fixture.repo
    }
  });
}

test('PII reconciliation is dry-run by default and execute hardens identity without cloud mutation', (t) => {
  const fixture = makeFixture(t);
  const mapBefore = fs.readFileSync(fixture.storageMapPath);
  const targetBefore = fs.statSync(fixture.targetPath);

  const dryRun = run(fixture);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stderr, /"dry_run":true/);
  assert.deepEqual(fs.readFileSync(fixture.storageMapPath), mapBefore);

  const execute = run(fixture, ['--execute']);
  assert.equal(execute.status, 0, execute.stderr);
  assert.match(execute.stderr, /"conversions":1/);
  const map = JSON.parse(fs.readFileSync(fixture.storageMapPath, 'utf8'));
  assert.equal(map.entries.length, 1);
  assert.equal(map.entries[0].pii_id, fixture.piiId);
  assert.equal('repo_relpath' in map.entries[0], false);
  assert.equal('drive_relpath' in map.entries[0], false);
  assert.equal('renamed_to' in map.entries[0], false);
  assert.equal(fs.statSync(fixture.targetPath).ino, targetBefore.ino);
  assert.equal(fs.statSync(fixture.targetPath).mtimeMs, targetBefore.mtimeMs);
  assert.equal(fs.existsSync(fixture.sourcePath), true);

  const reportDir = path.join(fixture.repo, '_dev', 'reports', 'analysis', 'client-storage');
  const reportName = fs.readdirSync(reportDir).find((name) => name.includes('__pii-reconcile__') && name.endsWith('.json'));
  const reportText = fs.readFileSync(path.join(reportDir, reportName), 'utf8');
  assert.equal(reportText.includes(fixture.relPath), false);
  const report = JSON.parse(reportText);
  assert.equal(report.status, 'PASS');
  assert.equal(report.cloud_files_copied, 0);
  assert.equal(report.cloud_files_overwritten, 0);
  assert.equal(report.local_files_deleted, 0);
});

test('PII reconciliation fails before manifest mutation when the cloud target drifts', (t) => {
  const fixture = makeFixture(t);
  const mapBefore = fs.readFileSync(fixture.storageMapPath);
  fs.writeFileSync(fixture.targetPath, 'different cloud content');
  const result = run(fixture, ['--execute']);
  assert.equal(result.status, 14, result.stderr);
  assert.match(result.stderr, /CHECKSUM_MISMATCH/);
  assert.deepEqual(fs.readFileSync(fixture.storageMapPath), mapBefore);
  assert.equal(fs.existsSync(fixture.sourcePath), true);
});

test('migration snapshot verification separates intact cloud evidence from later source drift', (t) => {
  const fixture = makeFixture(t);
  assert.equal(run(fixture, ['--execute']).status, 0);

  const clean = runVerify(fixture);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stderr, /"source_drift_count":0/);

  fs.writeFileSync(fixture.sourcePath, 'newer local content');
  const drift = runVerify(fixture);
  assert.equal(drift.status, 21, drift.stderr);
  assert.match(drift.stderr, /"status":"DRIFT"/);
  assert.match(drift.stderr, /"source_drift_count":1/);
  const reportDir = path.join(fixture.repo, '_dev', 'reports', 'analysis', 'client-storage');
  const latest = fs
    .readdirSync(reportDir)
    .filter((name) => name.includes('__manifest-verify__') && name.endsWith('.json'))
    .sort()
    .at(-1);
  const reportText = fs.readFileSync(path.join(reportDir, latest), 'utf8');
  assert.equal(reportText.includes(fixture.relPath), false);
  const report = JSON.parse(reportText);
  assert.equal(report.snapshot_status, 'PASS');
  assert.equal(report.source_currency_status, 'DRIFT');
  assert.equal(report.u4_closure_ready, false);
  assert.equal(report.retirement_eligible, false);
});

test('migration snapshot verification fails when the mounted target changes', (t) => {
  const fixture = makeFixture(t);
  assert.equal(run(fixture, ['--execute']).status, 0);
  fs.writeFileSync(fixture.targetPath, 'changed target');
  const result = runVerify(fixture);
  assert.equal(result.status, 14, result.stderr);
  assert.match(result.stderr, /"status":"FAIL"/);
});

test('opaque PII manifest entries with path-bearing fields fail closed', (t) => {
  const fixture = makeFixture(t);
  assert.equal(run(fixture, ['--execute']).status, 0);
  const map = JSON.parse(fs.readFileSync(fixture.storageMapPath, 'utf8'));
  map.entries[0].repo_relpath = fixture.relPath;
  fs.writeFileSync(fixture.storageMapPath, JSON.stringify(map));

  const reconcile = run(fixture);
  assert.equal(reconcile.status, 25, reconcile.stderr);
  assert.match(reconcile.stderr, /PII_MAP_DRIFT/);
  const verify = runVerify(fixture);
  assert.equal(verify.status, 25, verify.stderr);
  assert.match(verify.stderr, /PII_MAP_DRIFT/);
  assert.equal(fs.existsSync(fixture.sourcePath), true);
  assert.equal(fs.existsSync(fixture.targetPath), true);
});

test('PII reconciliation rejects manifest size drift', (t) => {
  const fixture = makeFixture(t);
  const map = JSON.parse(fs.readFileSync(fixture.storageMapPath, 'utf8'));
  map.entries[0].size += 1;
  fs.writeFileSync(fixture.storageMapPath, JSON.stringify(map));
  const result = run(fixture);
  assert.equal(result.status, 25, result.stderr);
  assert.match(result.stderr, /PII_MAP_DRIFT/);
});

test('PII reconciliation compare-and-swap preserves a concurrent manifest update', (t) => {
  const fixture = makeFixture(t);
  const originalMapBytes = fs.readFileSync(fixture.storageMapPath);
  const built = {
    storageMapPath: fixture.storageMapPath,
    originalMapBytes,
    reconciledMap: {
      ...JSON.parse(originalMapBytes.toString('utf8')),
      reconciled_marker: true
    }
  };
  const concurrent = JSON.parse(fs.readFileSync(fixture.storageMapPath, 'utf8'));
  concurrent.concurrent_marker = 'preserve-me';
  fs.writeFileSync(fixture.storageMapPath, JSON.stringify(concurrent));
  const result = writeReconciledMapCas(built);
  assert.equal(result.ok, false);
  assert.equal(result.code, 22);
  const after = JSON.parse(fs.readFileSync(fixture.storageMapPath, 'utf8'));
  assert.equal(after.concurrent_marker, 'preserve-me');
  assert.equal(fs.existsSync(path.join(path.dirname(fixture.storageMapPath), '.storage-map.lock')), false);
});

test('migration verification binds opaque manifest checksum and size to private classification truth', (t) => {
  const fixture = makeFixture(t);
  assert.equal(run(fixture, ['--execute']).status, 0);
  const replacement = 'different but internally matching target';
  fs.writeFileSync(fixture.targetPath, replacement);
  const map = JSON.parse(fs.readFileSync(fixture.storageMapPath, 'utf8'));
  map.entries[0].sha256 = sha256(replacement);
  map.entries[0].size = Buffer.byteLength(replacement);
  fs.writeFileSync(fixture.storageMapPath, JSON.stringify(map));
  const result = runVerify(fixture);
  assert.equal(result.status, 25, result.stderr);
  assert.match(result.stderr, /PII_MAP_DRIFT/);
});
