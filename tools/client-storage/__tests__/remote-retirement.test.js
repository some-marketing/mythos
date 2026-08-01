'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { quickXorHashFile } = require('../lib.js');
const { hashBoundPath } = require('../retire-local.js');
const {
  selectReusablePiiMap,
  buildClassificationArtifacts
} = require('../classify.js');
const { resolveSampleCount } = require('../verify-remote.js');
const { profilePrefix: graphProfilePrefix } = require('../../ms-graph/client.js');

const VERIFY_REMOTE = path.resolve(__dirname, '..', 'verify-remote.js');
const VERIFY_MIGRATION = path.resolve(__dirname, '..', 'verify-migration.js');
const RETIRE_LOCAL = path.resolve(__dirname, '..', 'retire-local.js');
const BACKFILL = path.resolve(__dirname, '..', 'backfill-metadata.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeFixture(t, { gitTracked = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-remote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const client = 'TEST';
  const clientRoot = path.join(repo, 'clients', client);
  const mountedPath = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Test', client);
  const publicRel = path.join('reference', 'guide.txt');
  const privateRel = path.join('people', 'private-record.bin');
  const publicContent = 'public reference';
  const privateContent = 'synthetic private record';
  for (const [rel, content] of [[publicRel, publicContent], [privateRel, privateContent]]) {
    fs.mkdirSync(path.dirname(path.join(clientRoot, rel)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(mountedPath, rel)), { recursive: true });
    fs.writeFileSync(path.join(clientRoot, rel), content);
    fs.writeFileSync(path.join(mountedPath, rel), content);
  }
  fs.writeFileSync(path.join(clientRoot, 'client.json'), JSON.stringify({
    code: client,
    file_storage: { provider: 'onedrive', mounted_path: mountedPath, manifest: 'storage-map.json' }
  }));
  const piiId = '88888888-8888-4888-8888-888888888888';
  fs.writeFileSync(path.join(clientRoot, 'pii-path-map.json'), JSON.stringify({
    schema: 'ClientStoragePiiPathMap/1.0',
    client,
    entries: [{
      pii_id: piiId,
      repo_relpath: privateRel,
      size: Buffer.byteLength(privateContent),
      sha256: sha256(privateContent)
    }],
    retained_entries: []
  }));
  const privateMapSha256 = sha256(fs.readFileSync(path.join(clientRoot, 'pii-path-map.json')));
  const classifyReportPath = path.join(root, 'classify.json');
  fs.writeFileSync(classifyReportPath, JSON.stringify({
    schema: 'ClientStorageClassify/1.0',
    client,
    pii_path_map_binding: {
      required: true,
      schema: 'ClientStoragePiiPathMap/1.0',
      client,
      entry_count: 1,
      sha256: privateMapSha256
    },
    entries: [
      { klass: 'MOVE', relpath: publicRel, size: Buffer.byteLength(publicContent) },
      {
        klass: 'PII-MOVE',
        pii_id: piiId,
        size: Buffer.byteLength(privateContent),
        sha256_prefix: sha256(privateContent).slice(0, 8)
      }
    ]
  }));
  const storageMapPath = path.join(clientRoot, 'storage-map.json');
  fs.writeFileSync(storageMapPath, JSON.stringify({
    schema_version: 1,
    client,
    drive: { provider: 'onedrive', mounted_path: mountedPath, mount_dir: 'OneDrive-Test' },
    rules: { moved: [], kept: [] },
    entries: [
      {
        repo_relpath: publicRel,
        drive_relpath: publicRel,
        size: Buffer.byteLength(publicContent),
        sha256: sha256(publicContent),
        drive_mtime: fs.statSync(path.join(mountedPath, publicRel)).mtime.toISOString(),
        local_deleted_at: null
      },
      {
        pii_id: piiId,
        size: Buffer.byteLength(privateContent),
        sha256: sha256(privateContent),
        drive_mtime: fs.statSync(path.join(mountedPath, privateRel)).mtime.toISOString(),
        local_deleted_at: null
      }
    ],
    preserved_snapshots: []
  }));
  const migrationReportPath = path.join(root, 'migration.json');
  fs.writeFileSync(migrationReportPath, JSON.stringify({
    schema: 'ClientStorageManifestVerify/1.0',
    client,
    generated_at: new Date().toISOString(),
    status: 'PASS',
    snapshot_status: 'PASS',
    source_currency_status: 'CURRENT',
    u4_closure_ready: true,
    storage_map_sha256: sha256(fs.readFileSync(storageMapPath)),
    classify_report_sha256: sha256(fs.readFileSync(classifyReportPath)),
    pii_path_map_sha256: privateMapSha256,
    pii_active_identity_count: 1,
    pii_retained_identity_count: 0,
    target_mismatch_count: 0,
    preserved_snapshot_mismatch_count: 0,
    source_drift_count: 0,
    source_missing_count: 0
  }));
  if (gitTracked) {
    for (const args of [
      ['init', '-q'],
      ['add', '.'],
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture']
    ]) {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
  }
  return {
    repo,
    home,
    client,
    clientRoot,
    publicRel,
    privateRel,
    classifyReportPath,
    migrationReportPath,
    attestationPath: path.join(clientRoot, 'remote-attestation.json')
  };
}

function run(script, fixture, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: { ...process.env, HOME: fixture.home, CLAUDE_PROJECT_DIR: fixture.repo, ...env }
  });
}

function authorizeOneDriveFixture(fixture) {
  const base = ['--client', fixture.client, '--migration-report', fixture.migrationReportPath];
  assert.equal(run(VERIFY_REMOTE, fixture, [...base, '--tier', '0', '--prepare-attestation']).status, 0);
  const attestation = JSON.parse(fs.readFileSync(fixture.attestationPath));
  attestation.observed_listing_count = attestation.expected_listing_count;
  attestation.sync_settled_at = new Date().toISOString();
  attestation.operator_confirmed = true;
  for (const sample of attestation.samples) {
    sample.present = true;
    sample.observed_size = sample.expected_size;
    sample.opened = true;
  }
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const verified = run(VERIFY_REMOTE, fixture, [
    ...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'
  ]);
  assert.equal(verified.status, 0, verified.stderr);
  const status = JSON.parse(verified.stderr.trim().split('\n').at(-1));
  return path.join(fixture.repo, status.report_json);
}

test('QuickXorHash matches the published hello-world vector', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quickxor-vector-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'vector.bin');
  fs.writeFileSync(filePath, 'hello world');
  assert.equal(await quickXorHashFile(filePath), 'aCgDG9jwBhDc4Q1yawMZAAAAAAA=');
});

test('empty registered clients pass the default vacuous T1 sample gate only', () => {
  assert.deepEqual(resolveSampleCount(undefined, 0), { ok: true, count: 0 });
  assert.equal(resolveSampleCount(0, 0).ok, false);
  assert.equal(resolveSampleCount(1, 0).ok, false);
  assert.deepEqual(resolveSampleCount(undefined, 3), { ok: true, count: 3 });
});

test('Google credential profiles do not fall back to a different account', () => {
  const { resolveCreds } = require('../../google-drive/config.js');
  const values = {
    GOOGLE_OAUTH_CLIENT_ID: 'wrong-default-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'wrong-default-secret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'wrong-default-token',
    GDRIVE_PROFILE_HUMAN_A_CLIENT_ID: 'profile-id',
    GDRIVE_PROFILE_HUMAN_A_CLIENT_SECRET: 'profile-secret',
    GDRIVE_PROFILE_HUMAN_A_REFRESH_TOKEN: 'profile-token'
  };
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    assert.deepEqual(resolveCreds('human-a'), {
      clientId: 'profile-id',
      clientSecret: 'profile-secret',
      refreshToken: 'profile-token'
    });
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('OneDrive private challenge produces path-free T0 authority and retirement dry-run', (t) => {
  const fixture = makeFixture(t);
  const base = ['--client', fixture.client, '--migration-report', fixture.migrationReportPath];
  const prepare = run(VERIFY_REMOTE, fixture, [...base, '--tier', '0', '--prepare-attestation']);
  assert.equal(prepare.status, 0, prepare.stderr);
  const attestation = JSON.parse(fs.readFileSync(fixture.attestationPath));
  attestation.observed_listing_count = attestation.expected_listing_count;
  attestation.sync_settled_at = new Date().toISOString();
  attestation.operator_confirmed = true;
  for (const sample of attestation.samples) {
    sample.present = true;
    sample.observed_size = sample.expected_size;
    sample.opened = true;
  }
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const attest = run(VERIFY_REMOTE, fixture, [
    ...base,
    '--tier', '0',
    '--attestation', fixture.attestationPath,
    '--attest'
  ]);
  assert.equal(attest.status, 0, attest.stderr);
  const status = JSON.parse(attest.stderr.trim().split('\n').at(-1));
  const remoteReportPath = path.join(fixture.repo, status.report_json);
  const publicText = fs.readFileSync(remoteReportPath, 'utf8');
  assert.equal(publicText.includes(fixture.privateRel), false);
  const remoteReport = JSON.parse(publicText);
  assert.equal(remoteReport.retirement_eligible, true);
  assert.equal(remoteReport.truth_domain, 'provider_remote_operator_attestation');

  const retire = run(RETIRE_LOCAL, fixture, [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', remoteReportPath
  ]);
  assert.equal(retire.status, 0, retire.stderr);
  assert.match(retire.stderr, /"dry_run":true/);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.publicRel)), true);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.privateRel)), true);
});

test('retirement journal recovers every injected transaction crash', async (t) => {
  for (const phase of [
    'after-journal',
    'after-index-removal',
    'after-staging',
    'after-private-map',
    'after-storage-map',
    'after-report-publication',
    'after-published-journal',
    'during-cleanup'
  ]) {
    await t.test(phase, () => {
      const fixture = makeFixture(t, { gitTracked: true });
      const base = ['--client', fixture.client, '--migration-report', fixture.migrationReportPath];
      assert.equal(run(VERIFY_REMOTE, fixture, [...base, '--tier', '0', '--prepare-attestation']).status, 0);
      const attestation = JSON.parse(fs.readFileSync(fixture.attestationPath));
      attestation.observed_listing_count = attestation.expected_listing_count;
      attestation.sync_settled_at = new Date().toISOString();
      attestation.operator_confirmed = true;
      for (const sample of attestation.samples) {
        sample.present = true;
        sample.observed_size = sample.expected_size;
        sample.opened = true;
      }
      fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
      const verified = run(VERIFY_REMOTE, fixture, [
        ...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'
      ]);
      assert.equal(verified.status, 0, verified.stderr);
      const remoteStatus = JSON.parse(verified.stderr.trim().split('\n').at(-1));
      const retireArgs = [
        '--client', fixture.client,
        '--migrate-verify-report', fixture.migrationReportPath,
        '--remote-verify-report', path.join(fixture.repo, remoteStatus.report_json),
        '--approve'
      ];
      const crashed = run(RETIRE_LOCAL, fixture, retireArgs, {
        NODE_ENV: 'test',
        CLIENT_STORAGE_TEST_CRASH_PHASE: phase
      });
      assert.equal(crashed.status, 91, `${phase}: ${crashed.stderr}`);
      const resumed = run(RETIRE_LOCAL, fixture, retireArgs, { NODE_ENV: 'test' });
      assert.equal(resumed.status, 0, `${phase}: ${resumed.stderr}`);
      const resumedStatus = JSON.parse(resumed.stderr.trim().split('\n').at(-1));
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(fixture.repo, resumedStatus.report_json))).schema,
        'ClientStorageRetirement/1.0'
      );
      assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.publicRel)), false);
      assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.privateRel)), false);
      assert.equal(fs.existsSync(path.join(fixture.clientRoot, 'retirement-journal.json')), false);
      assert.equal(fs.existsSync(path.join(fixture.clientRoot, '.retirement-staging')), false);
    });
  }
});

test('mounted T1 report never authorizes retirement', (t) => {
  const fixture = makeFixture(t);
  const tier1 = run(VERIFY_REMOTE, fixture, [
    '--client', fixture.client,
    '--migration-report', fixture.migrationReportPath,
    '--tier', '1'
  ]);
  assert.equal(tier1.status, 0, tier1.stderr);
  const status = JSON.parse(tier1.stderr.trim().split('\n').at(-1));
  const result = run(RETIRE_LOCAL, fixture, [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', path.join(fixture.repo, status.report_json)
  ]);
  assert.equal(result.status, 18, result.stderr);
  assert.match(result.stderr, /PREFLIGHT_FAILED/);
});

test('legacy manifest metadata backfill is checksum-gated and cloud-content preserving', (t) => {
  const fixture = makeFixture(t);
  const storageMapPath = path.join(fixture.clientRoot, 'storage-map.json');
  const map = JSON.parse(fs.readFileSync(storageMapPath));
  for (const entry of map.entries) {
    delete entry.drive_mtime;
    delete entry.md5;
    delete entry.quick_xor_hash;
  }
  fs.writeFileSync(storageMapPath, JSON.stringify(map));
  const migration = JSON.parse(fs.readFileSync(fixture.migrationReportPath));
  migration.storage_map_sha256 = sha256(fs.readFileSync(storageMapPath));
  fs.writeFileSync(fixture.migrationReportPath, JSON.stringify(migration));
  const targetBefore = fs.statSync(path.join(fixture.home, 'Library', 'CloudStorage', 'OneDrive-Test', fixture.client, fixture.publicRel));
  const result = run(BACKFILL, fixture, [
    '--client', fixture.client,
    '--migration-report', fixture.migrationReportPath,
    '--execute'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(fs.readFileSync(storageMapPath));
  assert.equal(updated.entries.every((entry) =>
    /^[a-f0-9]{32}$/.test(entry.md5) &&
    typeof entry.quick_xor_hash === 'string' &&
    typeof entry.drive_mtime === 'string'
  ), true);
  const targetAfter = fs.statSync(path.join(fixture.home, 'Library', 'CloudStorage', 'OneDrive-Test', fixture.client, fixture.publicRel));
  assert.equal(targetAfter.ino, targetBefore.ino);
  assert.equal(targetAfter.mtimeMs, targetBefore.mtimeMs);
});

test('old migration schema and incomplete attestation fail closed', (t) => {
  const fixture = makeFixture(t);
  const old = JSON.parse(fs.readFileSync(fixture.migrationReportPath));
  old.schema = 'ClientStorageVerify/1.0';
  fs.writeFileSync(fixture.migrationReportPath, JSON.stringify(old));
  const rejected = run(VERIFY_REMOTE, fixture, [
    '--client', fixture.client,
    '--migration-report', fixture.migrationReportPath,
    '--tier', '0',
    '--prepare-attestation'
  ]);
  assert.equal(rejected.status, 18, rejected.stderr);

  const fresh = makeFixture(t);
  const base = ['--client', fresh.client, '--migration-report', fresh.migrationReportPath, '--tier', '0'];
  assert.equal(run(VERIFY_REMOTE, fresh, [...base, '--prepare-attestation']).status, 0);
  const attestation = JSON.parse(fs.readFileSync(fresh.attestationPath));
  attestation.observed_listing_count = attestation.expected_listing_count - 1;
  attestation.sync_settled_at = new Date().toISOString();
  attestation.operator_confirmed = true;
  for (const sample of attestation.samples) {
    sample.present = true;
    sample.observed_size = sample.expected_size;
    sample.opened = true;
  }
  fs.writeFileSync(fresh.attestationPath, JSON.stringify(attestation));
  const incomplete = run(VERIFY_REMOTE, fresh, [
    ...base,
    '--attestation', fresh.attestationPath,
    '--attest'
  ]);
  assert.equal(incomplete.status, 12, incomplete.stderr);
  assert.match(incomplete.stderr, /ATTESTATION_REQUIRED/);
});

test('future timestamps, invalid samples, forged T0, and Graph downgrade all fail closed', (t) => {
  const fixture = makeFixture(t);
  const base = ['--client', fixture.client, '--migration-report', fixture.migrationReportPath];
  const invalidSample = run(VERIFY_REMOTE, fixture, [...base, '--tier', '2', '--sample-count', 'NaN']);
  assert.equal(invalidSample.status, 1, invalidSample.stderr);

  assert.equal(run(VERIFY_REMOTE, fixture, [...base, '--tier', '0', '--prepare-attestation']).status, 0);
  const attestation = JSON.parse(fs.readFileSync(fixture.attestationPath));
  attestation.observed_listing_count = attestation.expected_listing_count;
  attestation.sync_settled_at = new Date(Date.now() + 60_000).toISOString();
  attestation.operator_confirmed = true;
  for (const sample of attestation.samples) {
    sample.present = true;
    sample.observed_size = sample.expected_size;
    sample.opened = true;
  }
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const future = run(VERIFY_REMOTE, fixture, [
    ...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'
  ]);
  assert.equal(future.status, 12, future.stderr);

  const graphNoDowngrade = run(
    VERIFY_REMOTE,
    fixture,
    [...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'],
    { [`${graphProfilePrefix('work')}_ACCESS_TOKEN`]: 'synthetic-token' }
  );
  assert.equal(graphNoDowngrade.status, 12, graphNoDowngrade.stderr);

  attestation.sync_settled_at = new Date().toISOString();
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const valid = run(VERIFY_REMOTE, fixture, [
    ...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'
  ]);
  assert.equal(valid.status, 0, valid.stderr);
  const status = JSON.parse(valid.stderr.trim().split('\n').at(-1));
  const reportPath = path.join(fixture.repo, status.report_json);
  attestation.operator_confirmed = false;
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const unbound = run(RETIRE_LOCAL, fixture, [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', reportPath
  ]);
  assert.equal(unbound.status, 18, unbound.stderr);
  attestation.operator_confirmed = true;
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const forged = JSON.parse(fs.readFileSync(reportPath));
  forged.method = 'mounted_fake';
  fs.writeFileSync(reportPath, JSON.stringify(forged));
  const retire = run(RETIRE_LOCAL, fixture, [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', reportPath
  ]);
  assert.equal(retire.status, 18, retire.stderr);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.publicRel)), true);
});

test('approved retirement deletes only authorized active sources and emits no PII path', (t) => {
  const fixture = makeFixture(t, { gitTracked: true });
  const base = ['--client', fixture.client, '--migration-report', fixture.migrationReportPath];
  assert.equal(run(VERIFY_REMOTE, fixture, [...base, '--tier', '0', '--prepare-attestation']).status, 0);
  const attestation = JSON.parse(fs.readFileSync(fixture.attestationPath));
  attestation.observed_listing_count = attestation.expected_listing_count;
  attestation.sync_settled_at = new Date().toISOString();
  attestation.operator_confirmed = true;
  for (const sample of attestation.samples) {
    sample.present = true;
    sample.observed_size = sample.expected_size;
    sample.opened = true;
  }
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const verified = run(VERIFY_REMOTE, fixture, [
    ...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'
  ]);
  assert.equal(verified.status, 0, verified.stderr);
  const remoteStatus = JSON.parse(verified.stderr.trim().split('\n').at(-1));
  const retired = run(RETIRE_LOCAL, fixture, [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', path.join(fixture.repo, remoteStatus.report_json),
    '--approve'
  ]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.publicRel)), false);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.privateRel)), false);
  const retirementStatus = JSON.parse(retired.stderr.trim().split('\n').at(-1));
  const reportText = fs.readFileSync(path.join(fixture.repo, retirementStatus.report_json), 'utf8');
  assert.equal(reportText.includes(fixture.privateRel), false);
  const storageMap = JSON.parse(fs.readFileSync(path.join(fixture.clientRoot, 'storage-map.json')));
  assert.equal(storageMap.entries.every((entry) => Boolean(entry.local_deleted_at)), true);
  const tracked = spawnSync('git', ['ls-files', '--', `clients/${fixture.client}`], {
    cwd: fixture.repo,
    encoding: 'utf8'
  });
  assert.equal(tracked.status, 0);
  assert.equal(tracked.stdout.includes(fixture.publicRel), false);
  assert.equal(tracked.stdout.includes(fixture.privateRel), false);
  const privateMap = JSON.parse(fs.readFileSync(path.join(fixture.clientRoot, 'pii-path-map.json')));
  assert.equal(privateMap.entries.length, 0);
  assert.equal(privateMap.retired_entries.length, 1);
  assert.equal('repo_relpath' in privateMap.retired_entries[0], false);

  const postVerify = run(VERIFY_MIGRATION, fixture, [
    '--client', fixture.client,
    '--classify-report', fixture.classifyReportPath
  ]);
  assert.equal(postVerify.status, 0, postVerify.stderr);
  const postStatus = JSON.parse(postVerify.stderr.trim().split('\n').at(-1));
  const postReport = JSON.parse(fs.readFileSync(path.join(fixture.repo, postStatus.report_json)));
  assert.equal(postReport.post_retirement_audit_ready, true);
  assert.equal(postReport.source_retired_count, 2);
  const tier1 = run(VERIFY_REMOTE, fixture, [
    '--client', fixture.client,
    '--migration-report', path.join(fixture.repo, postStatus.report_json),
    '--tier', '1'
  ]);
  assert.equal(tier1.status, 0, tier1.stderr);
  const tier1Status = JSON.parse(tier1.stderr.trim().split('\n').at(-1));
  assert.equal(tier1Status.retirement_eligible, false);
  const allTier1 = run(VERIFY_REMOTE, fixture, ['--all', '--tier', '1']);
  assert.equal(allTier1.status, 0, allTier1.stderr);
});

test('descriptor-bound hashing detects a path replacement', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retirement-inode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'source.bin');
  const replacement = path.join(root, 'replacement.bin');
  fs.writeFileSync(target, 'authorized old bytes');
  fs.writeFileSync(replacement, 'new human work');
  const result = await hashBoundPath(target, () => fs.renameSync(replacement, target));
  assert.equal(result.sha256, sha256('authorized old bytes'));
  assert.equal(result.pathBound, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new human work');

  const inPlace = path.join(root, 'in-place.bin');
  fs.writeFileSync(inPlace, Buffer.alloc(1024 * 1024, 65));
  let changed = false;
  const inPlaceResult = await hashBoundPath(inPlace, {
    onChunk() {
      if (changed) return;
      changed = true;
      const fd = fs.openSync(inPlace, 'r+');
      fs.writeSync(fd, Buffer.from([66]), 0, 1, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
  });
  assert.equal(changed, true);
  assert.equal(inPlaceResult.stable, false);
  assert.equal(fs.readFileSync(inPlace)[0], 66);
});

test('classification preserves validated retired PII tombstones', async () => {
  const retired = {
    pii_id: '77777777-7777-4777-8777-777777777777',
    private_remote_relpath: path.join('people', 'retired.bin'),
    size: 7,
    sha256: 'b'.repeat(64),
    retired_at: new Date().toISOString()
  };
  const priorMap = {
    schema: 'ClientStoragePiiPathMap/1.0',
    client: 'TEST',
    entries: [],
    retained_entries: [],
    retired_entries: [retired]
  };
  const reusable = selectReusablePiiMap(priorMap, {
    entries: [{ pii_id: retired.pii_id }],
    preserved_snapshots: []
  }, 'TEST');
  const artifacts = await buildClassificationArtifacts([], 'TEST', { priorMap: reusable.map });
  assert.deepEqual(artifacts.piiPathMap.retired_entries, [retired]);
});

test('tampered retirement journal paths fail before recovery mutation', (t) => {
  const fixture = makeFixture(t, { gitTracked: true });
  const base = ['--client', fixture.client, '--migration-report', fixture.migrationReportPath];
  assert.equal(run(VERIFY_REMOTE, fixture, [...base, '--tier', '0', '--prepare-attestation']).status, 0);
  const attestation = JSON.parse(fs.readFileSync(fixture.attestationPath));
  attestation.observed_listing_count = attestation.expected_listing_count;
  attestation.sync_settled_at = new Date().toISOString();
  attestation.operator_confirmed = true;
  for (const sample of attestation.samples) {
    sample.present = true;
    sample.observed_size = sample.expected_size;
    sample.opened = true;
  }
  fs.writeFileSync(fixture.attestationPath, JSON.stringify(attestation));
  const verified = run(VERIFY_REMOTE, fixture, [
    ...base, '--tier', '0', '--attestation', fixture.attestationPath, '--attest'
  ]);
  const remoteStatus = JSON.parse(verified.stderr.trim().split('\n').at(-1));
  const retireArgs = [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', path.join(fixture.repo, remoteStatus.report_json),
    '--approve'
  ];
  assert.equal(run(RETIRE_LOCAL, fixture, retireArgs, {
    NODE_ENV: 'test',
    CLIENT_STORAGE_TEST_CRASH_PHASE: 'after-journal'
  }).status, 91);
  const canary = path.join(fixture.repo, 'outside-canary.txt');
  fs.writeFileSync(canary, 'keep me');
  const journalPath = path.join(fixture.clientRoot, 'retirement-journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath));
  journal.entries[0].repo_relpath = path.join('..', 'outside-canary.txt');
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const recovery = run(RETIRE_LOCAL, fixture, retireArgs, { NODE_ENV: 'test' });
  assert.equal(recovery.status, 22, recovery.stderr);
  assert.equal(fs.readFileSync(canary, 'utf8'), 'keep me');
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, fixture.publicRel)), true);
});

test('recreated human work blocks publication before controls or reports change', (t) => {
  const fixture = makeFixture(t, { gitTracked: true });
  const remoteReportPath = authorizeOneDriveFixture(fixture);
  const storagePath = path.join(fixture.clientRoot, 'storage-map.json');
  const privatePath = path.join(fixture.clientRoot, 'pii-path-map.json');
  const storageBefore = fs.readFileSync(storagePath);
  const privateBefore = fs.readFileSync(privatePath);
  const result = run(RETIRE_LOCAL, fixture, [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', remoteReportPath,
    '--approve'
  ], {
    NODE_ENV: 'test',
    CLIENT_STORAGE_TEST_RECREATE_BEFORE_PUBLICATION: 'new human work'
  });
  assert.equal(result.status, 22, result.stderr);
  assert.equal(fs.readFileSync(path.join(fixture.clientRoot, fixture.publicRel), 'utf8'), 'new human work');
  assert.deepEqual(fs.readFileSync(storagePath), storageBefore);
  assert.deepEqual(fs.readFileSync(privatePath), privateBefore);
  const journal = JSON.parse(fs.readFileSync(path.join(fixture.clientRoot, 'retirement-journal.json')));
  assert.equal(fs.existsSync(path.join(fixture.repo, journal.report_json_relpath)), false);
});

test('published recovery validates staged topology before republishing a report', (t) => {
  const fixture = makeFixture(t, { gitTracked: true });
  const remoteReportPath = authorizeOneDriveFixture(fixture);
  const args = [
    '--client', fixture.client,
    '--migrate-verify-report', fixture.migrationReportPath,
    '--remote-verify-report', remoteReportPath,
    '--approve'
  ];
  assert.equal(run(RETIRE_LOCAL, fixture, args, {
    NODE_ENV: 'test',
    CLIENT_STORAGE_TEST_CRASH_PHASE: 'after-published-journal'
  }).status, 91);
  const journalPath = path.join(fixture.clientRoot, 'retirement-journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath));
  const storagePath = path.join(fixture.clientRoot, 'storage-map.json');
  const privatePath = path.join(fixture.clientRoot, 'pii-path-map.json');
  const storageBeforeRecovery = fs.readFileSync(storagePath);
  const privateBeforeRecovery = fs.readFileSync(privatePath);
  fs.unlinkSync(path.join(fixture.repo, journal.report_json_relpath));
  fs.unlinkSync(path.join(fixture.clientRoot, '.retirement-staging', journal.entries[0].stage_id));
  const recovery = run(RETIRE_LOCAL, fixture, args, { NODE_ENV: 'test' });
  assert.equal(recovery.status, 22, recovery.stderr);
  assert.equal(fs.existsSync(path.join(fixture.repo, journal.report_json_relpath)), false);
  assert.deepEqual(fs.readFileSync(storagePath), storageBeforeRecovery);
  assert.deepEqual(fs.readFileSync(privatePath), privateBeforeRecovery);
});

test('orphan local-deleted stamps cannot become passing retirement audits', (t) => {
  const fixture = makeFixture(t);
  const storagePath = path.join(fixture.clientRoot, 'storage-map.json');
  const storage = JSON.parse(fs.readFileSync(storagePath));
  const orphanedAt = new Date().toISOString();
  for (const entry of storage.entries) entry.local_deleted_at = orphanedAt;
  fs.writeFileSync(storagePath, JSON.stringify(storage));
  const result = run(VERIFY_MIGRATION, fixture, [
    '--client', fixture.client,
    '--classify-report', fixture.classifyReportPath
  ]);
  assert.equal(result.status, 22, result.stderr);
  assert.match(result.stderr, /retirement record|tombstone/i);
});
