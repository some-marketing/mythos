'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { atomicWritableProbe } = require('../lib.js');
const { sanitizeMigrationError } = require('../migrate.js');
const { profilePrefix: graphProfilePrefix } = require('../../ms-graph/client.js');

const TOOL_DIR = path.resolve(__dirname, '..');

test('migration filesystem errors never echo private paths', () => {
  const raw = new Error('EACCES: permission denied, open /private/customer-record.csv');
  raw.code = 'EACCES';
  const reason = sanitizeMigrationError(raw, { klass: 'PII-MOVE' });
  assert.equal(reason, 'filesystem operation failed for opaque PII entry (EACCES)');
  assert.equal(reason.includes('/private/'), false);
  assert.equal(reason.includes('customer-record.csv'), false);
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function makeFixture(t, { client = 'TEST', provider = 'onedrive', mountName = 'OneDrive-Test' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const clientRoot = path.join(repo, 'clients', client);
  const mountedPath = path.join(home, 'Library', 'CloudStorage', mountName, client);
  fs.mkdirSync(clientRoot, { recursive: true });
  fs.mkdirSync(mountedPath, { recursive: true });
  fs.writeFileSync(
    path.join(clientRoot, 'client.json'),
    JSON.stringify({
      code: client,
      file_storage: {
        provider,
        mounted_path: mountedPath,
        mount_dir: mountName,
        manifest: 'storage-map.json',
        credential_profile: 'synthetic-test',
        expected_account_identity_sha256: crypto.createHash('sha256').update('synthetic-account').digest('hex'),
        remote_root_id: 'synthetic-root'
      }
    }, null, 2)
  );
  return { root, repo, home, client, clientRoot, mountedPath };
}

function runTool(fixture, script, args, envExtra = {}) {
  let invocation = [path.join(TOOL_DIR, script), ...args];
  if (script === 'preflight.js') {
    const preflightPath = path.join(TOOL_DIR, script);
    const runner = [
      "process.argv.splice(1, 0, 'preflight.js');",
      `require(${JSON.stringify(preflightPath)}).main({`,
      'getLocalFreeDiskGB: () => 100,',
      "credentialSourceProbe: async () => ({ available: true, sources: { synthetic_test: true } }),",
      "providerIdentityProbe: async ({ expectedAccountIdentitySha256, canonicalRemoteRootId }) => ({",
      "authenticated: true, status: 'verified', account_identity_sha256: expectedAccountIdentitySha256, remote_root_id: canonicalRemoteRootId",
      '}),',
      "graphClient: process.env.GRAPH_TEST_MODE ? { getOneDriveFreeBytes: async (options) => {",
      "if (options.profile !== 'synthetic-test' || options.remoteRootId !== 'synthetic-root' || !/^[a-f0-9]{64}$/.test(options.expectedAccountIdentitySha256 || '')) {",
      "throw Object.assign(new Error('synthetic-provider-secret'), { code: 'GRAPH_TEST_BINDING_ERROR' });",
      '}',
      "if (process.env.GRAPH_TEST_MODE === 'wrong-account') throw Object.assign(new Error('synthetic-provider-secret'), { code: 'GRAPH_ACCOUNT_MISMATCH' });",
      'return 1024;',
      '} } : undefined',
      '});'
    ].join('');
    invocation = ['-e', runner, '--', ...args];
  }
  return spawnSync(process.execPath, invocation, {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.home,
      CLAUDE_PROJECT_DIR: fixture.repo,
      MS_GRAPH_CLIENT_ID: '',
      MS_GRAPH_CLIENT_SECRET: '',
      MS_GRAPH_REFRESH_TOKEN: '',
      ...envExtra
    }
  });
}

function refreshSemanticAggregates(report) {
  const counts = {};
  const classBytes = {};
  const semanticCounts = {};
  const semanticBytes = {};
  for (const entry of report.entries) {
    counts[entry.klass] = (counts[entry.klass] || 0) + 1;
    classBytes[entry.klass] = (classBytes[entry.klass] || 0) + entry.size;
    semanticCounts[entry.semantic_bucket] = (semanticCounts[entry.semantic_bucket] || 0) + 1;
    semanticBytes[entry.semantic_bucket] = (semanticBytes[entry.semantic_bucket] || 0) + entry.size;
  }
  report.counts = counts;
  report.bytes = classBytes;
  report.semantic_counts = semanticCounts;
  report.semantic_bytes = semanticBytes;
  report.total_files = report.entries.length;
  report.total_bytes = report.entries.reduce((sum, entry) => sum + entry.size, 0);
  return report;
}

function writeClassify(fixture, entries, bytes, piiMapEntries = []) {
  const semanticDefaults = {
    KEEP: ['REUSABLE-SOURCE', 'synthetic retained source'],
    MOVE: ['HISTORICAL-REFERENCE', 'synthetic reference material'],
    'PII-MOVE': ['HISTORICAL-REFERENCE', 'synthetic private reference material'],
    'DEFERRED-DIRTY': ['REVIEW', 'synthetic dirty state'],
    'SKIP-STUB': ['HISTORICAL-REFERENCE', 'synthetic cloud pointer'],
    REVIEW: ['REVIEW', 'synthetic ambiguous material']
  };
  const semanticEntries = entries.map((entry) => {
    const defaults = semanticDefaults[entry.klass] || ['REVIEW', 'synthetic invalid class'];
    return {
      ...entry,
      semantic_bucket: entry.semantic_bucket || defaults[0],
      basis: entry.basis || defaults[1]
    };
  });
  const semanticReport = refreshSemanticAggregates({ entries: semanticEntries });
  const presentBytes = { ...semanticReport.bytes };
  for (const [klass, value] of Object.entries(bytes)) {
    if (semanticReport.counts[klass] || value !== 0) presentBytes[klass] = value;
  }
  const piiMapPath = path.join(fixture.clientRoot, 'pii-path-map.json');
  fs.writeFileSync(
    piiMapPath,
    JSON.stringify({
      schema: 'ClientStoragePiiPathMap/1.0',
      client: fixture.client,
      generated_at: new Date().toISOString(),
      entries: piiMapEntries
    })
  );
  const reportPath = path.join(fixture.root, 'classify.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      schema: 'ClientStorageClassify/2.0',
      client: fixture.client,
      generated_at: new Date().toISOString(),
      pii_path_map_binding: {
        required: true,
        schema: 'ClientStoragePiiPathMap/1.0',
        client: fixture.client,
        entry_count: piiMapEntries.length,
        sha256: sha256File(piiMapPath)
      },
      entries: semanticEntries,
      counts: semanticReport.counts,
      bytes: presentBytes,
      semantic_counts: semanticReport.semantic_counts,
      semantic_bytes: semanticReport.semantic_bytes,
      total_files: semanticReport.total_files,
      total_bytes: semanticReport.total_bytes
    })
  );
  return reportPath;
}

test('preflight validates semantic REVIEW/schema/counts before any mount probe', async (t) => {
  const fixture = makeFixture(t);
  const probeMarker = path.join(fixture.root, 'mount-probe-attempted');
  const preloadPath = path.join(fixture.root, 'observe-probe.cjs');
  fs.writeFileSync(preloadPath, [
    "'use strict';",
    "const fs = require('node:fs');",
    'const original = fs.linkSync;',
    'fs.linkSync = function (source, target) {',
    "  if (String(source).includes('.client-storage-probe.')) fs.writeFileSync(process.env.PROBE_MARKER, 'attempted');",
    '  return original.apply(this, arguments);',
    '};'
  ].join('\n'));

  const cases = [
    {
      label: 'legacy V1 requires semantic reclassification',
      legacy: true,
      entries: [{ klass: 'MOVE', relpath: 'legacy.txt', size: 1 }]
    },
    {
      label: 'REVIEW class',
      entries: [{ klass: 'REVIEW', semantic_bucket: 'REVIEW', basis: 'ambiguous', relpath: 'ambiguous.html', size: 1 }],
      semantic_counts: { REVIEW: 1 }, semantic_bytes: { REVIEW: 1 }
    },
    {
      label: 'invalid REVIEW bucket mapping',
      entries: [{ klass: 'MOVE', semantic_bucket: 'REVIEW', basis: 'remapped', relpath: 'reference.txt', size: 1 }],
      semantic_counts: { REVIEW: 1 }, semantic_bytes: { REVIEW: 1 }
    },
    {
      label: 'malformed semantic counts',
      entries: [{ klass: 'MOVE', semantic_bucket: 'HISTORICAL-REFERENCE', basis: 'reference', relpath: 'ref.txt', size: 1 }],
      semantic_counts: null, semantic_bytes: { 'HISTORICAL-REFERENCE': 1 }
    },
    {
      label: 'count disagreement',
      entries: [{ klass: 'MOVE', semantic_bucket: 'HISTORICAL-REFERENCE', basis: 'reference', relpath: 'ref.txt', size: 1 }],
      semantic_counts: { 'HISTORICAL-REFERENCE': 2 }, semantic_bytes: { 'HISTORICAL-REFERENCE': 1 }
    }
  ];

  for (const item of cases) {
    await t.test(item.label, () => {
      const moveBytes = item.entries[0].klass === 'MOVE' ? 1 : 0;
      const classifyPath = writeClassify(fixture, item.entries, { MOVE: moveBytes, 'PII-MOVE': 0 });
      const report = JSON.parse(fs.readFileSync(classifyPath, 'utf8'));
      if (item.legacy) {
        report.schema = 'ClientStorageClassify/1.0';
        report.entries = item.entries.map(({ klass, relpath, size }) => ({ klass, relpath, size }));
        delete report.semantic_counts;
        delete report.semantic_bytes;
      } else {
        report.schema = 'ClientStorageClassify/2.0';
        report.counts = { [item.entries[0].klass]: 1 };
        report.bytes = { [item.entries[0].klass]: 1 };
        report.semantic_counts = item.semantic_counts;
        report.semantic_bytes = item.semantic_bytes;
        report.total_files = 1;
        report.total_bytes = 1;
      }
      fs.writeFileSync(classifyPath, JSON.stringify(report));

      const result = runTool(fixture, 'preflight.js', [
        '--client', fixture.client,
        '--classify-report', classifyPath,
        '--attest-headroom-bytes', '100'
      ], { NODE_OPTIONS: `--require=${preloadPath}`, PROBE_MARKER: probeMarker });
      assert.equal(result.status, 20, result.stderr);
      assert.match(result.stderr, /classification-review/);
      if (item.legacy) assert.match(result.stderr, /LEGACY_RECLASSIFICATION_REQUIRED/);
      assert.equal(fs.existsSync(probeMarker), false);
      assert.deepEqual(fs.readdirSync(fixture.mountedPath), []);
      assert.equal(
        fs.existsSync(path.join(fixture.repo, '_dev', 'reports', 'analysis', 'client-storage')),
        false
      );
    });
  }
});

test('DEFERRED-DIRTY semantic REVIEW passes safe gates but remains non-migratable', (t) => {
  const fixture = makeFixture(t);
  const classifyPath = writeClassify(
    fixture,
    [{
      klass: 'DEFERRED-DIRTY',
      semantic_bucket: 'REVIEW',
      basis: 'working-tree state is dirty or untracked',
      report_id: '77777777-7777-4777-8777-777777777777',
      identity_redacted: true,
      size: 17
    }],
    { MOVE: 0, 'PII-MOVE': 0 }
  );

  const preflight = runTool(fixture, 'preflight.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath,
    '--attest-headroom-bytes', '100'
  ]);
  assert.equal(preflight.status, 0, preflight.stderr);
  const preflightReport = JSON.parse(fs.readFileSync(latestReport(fixture, '__preflight__'), 'utf8'));
  assert.equal(preflightReport.status, 'PASS');
  assert.equal(preflightReport.computed_batch_bytes, 0);
  assert.equal(preflightReport.rename_proposal_count, 0);
  assert.deepEqual(fs.readdirSync(fixture.mountedPath), []);

  const migrate = runTool(fixture, 'migrate.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath
  ]);
  assert.equal(migrate.status, 0, migrate.stderr);
  const plan = JSON.parse(migrate.stdout);
  assert.equal(plan.dry_run, true);
  assert.deepEqual(plan.plan, []);
  assert.equal(fs.existsSync(path.join(fixture.clientRoot, 'storage-map.json')), false);
  assert.deepEqual(fs.readdirSync(fixture.mountedPath), []);
});

test('non-injected mounted-volume preflight requires explicit volume enrollment before setup', (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(
    path.join(fixture.clientRoot, 'client.json'),
    JSON.stringify({
      code: fixture.client,
      file_storage: {
        provider: 'onedrive',
        mounted_path: fixture.mountedPath,
        manifest: 'storage-map.json'
      }
    })
  );
  const classifyPath = writeClassify(fixture, [], { MOVE: 0, 'PII-MOVE': 0 });
  const classifyReport = JSON.parse(fs.readFileSync(classifyPath, 'utf8'));
  Object.assign(classifyReport, {
    schema: 'ClientStorageClassify/2.0',
    counts: {},
    bytes: {},
    semantic_counts: {},
    semantic_bytes: {},
    total_files: 0,
    total_bytes: 0
  });
  fs.writeFileSync(classifyPath, JSON.stringify(classifyReport));
  const result = runTool(fixture, 'preflight.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath,
    '--attest-headroom-bytes', '100'
  ]);
  assert.equal(result.status, 18, result.stderr);
  assert.match(result.stderr, /VOLUME_ENROLLMENT_REQUIRED/);
  assert.match(result.stderr, /"setup_required":false/);
  assert.deepEqual(fs.readdirSync(fixture.mountedPath), []);
});

test('non-injected mounted-volume preflight grants copy-only readiness after exact enrollment', (t) => {
  const fixture = makeFixture(t);
  const classifyPath = writeClassify(fixture, [], { MOVE: 0, 'PII-MOVE': 0 });
  const result = runTool(fixture, 'preflight.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath,
    '--attest-headroom-bytes', '100'
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(latestReport(fixture, '__preflight__'), 'utf8'));
  assert.equal(report.status, 'PASS');
  assert.equal(report.capability_probe.readiness_mode, 'mounted-volume-copy-only');
  assert.equal(report.capability_probe.copy_authority, true);
  assert.equal(report.capability_probe.provider_remote_truth_established, false);
  assert.equal(report.capability_probe.deletion_authority, false);
  assert.equal(report.checks.find((check) => check.check === 'graph-credentials-probe').configured, false);
  assert.equal(report.checks.find((check) => check.check === 'quota').evidence, 'operator_attestation');
  assert.deepEqual(fs.readdirSync(fixture.mountedPath), []);
});

test('named Graph quota path binds profile, account, and remote root before passing', (t) => {
  const fixture = makeFixture(t);
  const classifyPath = writeClassify(fixture, [], { MOVE: 0, 'PII-MOVE': 0 });
  const result = runTool(fixture, 'preflight.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath
  ], {
    GRAPH_TEST_MODE: 'valid',
    [`${graphProfilePrefix('synthetic-test')}_ACCESS_TOKEN`]: 'synthetic-access-token'
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(latestReport(fixture, '__preflight__'), 'utf8'));
  assert.equal(report.status, 'PASS');
  assert.equal(report.checks.find((check) => check.check === 'graph-credentials-probe').configured, true);
  assert.equal(report.checks.find((check) => check.check === 'quota').provider, 'onedrive');
});

test('named Graph identity failure is QUOTA_UNKNOWN with a secret-safe surface', (t) => {
  const fixture = makeFixture(t);
  const classifyPath = writeClassify(fixture, [], { MOVE: 0, 'PII-MOVE': 0 });
  const result = runTool(fixture, 'preflight.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath
  ], {
    GRAPH_TEST_MODE: 'wrong-account',
    [`${graphProfilePrefix('synthetic-test')}_ACCESS_TOKEN`]: 'synthetic-access-token'
  });
  assert.equal(result.status, 10, result.stderr);
  assert.match(result.stderr, /GRAPH_ACCOUNT_MISMATCH/);
  assert.equal(result.stderr.includes('synthetic-provider-secret'), false);
});

test('personal Google mounted-volume preflight requires and accepts bounded quota attestation', (t) => {
  const fixture = makeFixture(t, {
    client: 'CLIENT_PERSONAL',
    provider: 'gdrive',
    mountName: 'GoogleDrive-personal-account'
  });
  const clientPath = path.join(fixture.clientRoot, 'client.json');
  const client = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
  const mountRoot = path.join(fixture.home, 'Library', 'CloudStorage', 'GoogleDrive-personal-account');
  const canonicalMountedPath = path.join(mountRoot, 'My Drive', 'Mythos', 'Clients', 'CLIENT_PERSONAL');
  fs.mkdirSync(canonicalMountedPath, { recursive: true });
  client.file_storage.mounted_path = canonicalMountedPath;
  client.file_storage.readiness_mode = 'mounted-volume-copy-only';
  fs.writeFileSync(clientPath, JSON.stringify(client));
  fixture.mountedPath = canonicalMountedPath;
  fs.writeFileSync(path.join(fixture.clientRoot, 'payload.bin'), '0123456789');
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'payload.bin', size: 10 }],
    { MOVE: 10 }
  );

  const missing = runTool(fixture, 'preflight.js', ['--client', 'CLIENT_PERSONAL', '--classify-report', classifyPath]);
  assert.equal(missing.status, 12, missing.stderr);
  assert.match(missing.stderr, /ATTESTATION_REQUIRED/);

  const passing = runTool(fixture, 'preflight.js', [
    '--client', 'CLIENT_PERSONAL',
    '--classify-report', classifyPath,
    '--attest-headroom-bytes', '20'
  ]);
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stderr, /"status":"PASS"/);
});

test('preflight resolution failures never persist or emit private absolute paths', (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.clientRoot, 'payload.bin'), 'stable');
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'payload.bin', size: 6 }],
    { MOVE: 6 }
  );
  fs.rmSync(fixture.mountedPath, { recursive: true, force: true });
  const result = runTool(fixture, 'preflight.js', [
    '--client', fixture.client,
    '--classify-report', classifyPath,
    '--attest-headroom-bytes', '12'
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes(fixture.mountedPath), false);
  const reportDir = path.join(fixture.repo, '_dev', 'reports', 'analysis', 'client-storage');
  const report = fs.readdirSync(reportDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => fs.readFileSync(path.join(reportDir, name), 'utf8'))
    .join('\n');
  assert.equal(report.includes(fixture.mountedPath), false);
});

function latestReport(fixture, marker) {
  const dir = path.join(fixture.repo, '_dev', 'reports', 'analysis', 'client-storage');
  const candidate = fs
    .readdirSync(dir)
    .filter((name) => name.includes(marker) && name.endsWith('.json'))
    .sort()
    .at(-1);
  assert.ok(candidate, `expected a ${marker} report`);
  return path.join(dir, candidate);
}

function passPreflight(fixture, classifyPath, extra = []) {
  const result = runTool(fixture, 'preflight.js', [
    '--client',
    fixture.client,
    '--classify-report',
    classifyPath,
    '--attest-headroom-bytes',
    '1000000',
    ...extra
  ]);
  assert.equal(result.status, 0, result.stderr);
  const reportPath = latestReport(fixture, '__preflight__');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'PASS');
  return { result, reportPath, report };
}

test('atomic writable probe exercises hard-link publication and always cleans up', async (t) => {
  await t.test('normal hard-link publication succeeds without artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-storage-probe-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const originalLinkSync = fs.linkSync;
    let linkCalls = 0;
    fs.linkSync = (...args) => {
      linkCalls += 1;
      return originalLinkSync(...args);
    };
    try {
      const result = atomicWritableProbe(root);
      assert.deepEqual(result, { ok: true });
      assert.equal(linkCalls, 1);
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.linkSync = originalLinkSync;
    }
  });

  await t.test('hard-link failure makes preflight fail NOT_WRITABLE without mount artifacts', () => {
    const fixture = makeFixture(t);
    fs.writeFileSync(path.join(fixture.clientRoot, 'payload.bin'), 'payload');
    const classifyPath = writeClassify(
      fixture,
      [{ klass: 'MOVE', relpath: 'payload.bin', size: 7 }],
      { MOVE: 7, 'PII-MOVE': 0 }
    );
    const preloadPath = path.join(fixture.root, 'reject-probe-links.cjs');
    fs.writeFileSync(
      preloadPath,
      [
        "'use strict';",
        "const fs = require('node:fs');",
        'const originalLinkSync = fs.linkSync;',
        'fs.linkSync = function (source, target) {',
        "  if (String(source).includes('.client-storage-probe.')) {",
        "    const err = new Error('hard links unsupported at /private/Legal Name/file.bin');",
        "    err.code = 'ENOTSUP';",
        '    throw err;',
        '  }',
        '  return originalLinkSync.apply(this, arguments);',
        '};',
        ''
      ].join('\n')
    );
    const result = runTool(
      fixture,
      'preflight.js',
      [
        '--client',
        fixture.client,
        '--classify-report',
        classifyPath,
        '--attest-headroom-bytes',
        '100'
      ],
      { NODE_OPTIONS: `--require=${preloadPath}` }
    );
    assert.equal(result.status, 7);
    assert.match(result.stderr, /NOT_WRITABLE/);
    assert.match(result.stderr, /writable check failed without exposing private path details/);
    assert.equal(result.stderr.includes('/private/Legal Name/file.bin'), false);
    const reportDir = path.join(fixture.repo, '_dev', 'reports', 'analysis', 'client-storage');
    const persistedReports = fs.readdirSync(reportDir)
      .filter((name) => name.endsWith('.json') || name.endsWith('.md'))
      .map((name) => fs.readFileSync(path.join(reportDir, name), 'utf8'))
      .join('\n');
    assert.equal(persistedReports.includes('/private/Legal Name/file.bin'), false);
    assert.deepEqual(fs.readdirSync(fixture.mountedPath), []);
  });
});

test('provider allowlist and macOS-folded hazard checks fail closed', async (t) => {
  await t.test('arbitrary provider is rejected', () => {
    const fixture = makeFixture(t, { provider: 'dropbox' });
    const result = runTool(fixture, 'resolve.js', ['--client', fixture.client]);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /NO_FILE_STORAGE/);
  });

  await t.test('case-variant hazard mount is rejected', () => {
    const fixture = makeFixture(t, { mountName: 'onedrive2-secondary-account' });
    const result = runTool(fixture, 'resolve.js', ['--client', fixture.client]);
    assert.equal(result.status, 6);
    assert.match(result.stderr, /HAZARD_MOUNT/);
  });

  await t.test('registered mount directory mismatch is rejected', () => {
    const fixture = makeFixture(t, { mountName: 'GoogleDrive-registered-account', provider: 'gdrive' });
    const clientPath = path.join(fixture.clientRoot, 'client.json');
    const client = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
    client.file_storage.mount_dir = 'GoogleDrive-other-account';
    fs.writeFileSync(clientPath, JSON.stringify(client));
    const result = runTool(fixture, 'resolve.js', ['--client', fixture.client]);
    assert.equal(result.status, 6);
    assert.match(result.stderr, /HAZARD_MOUNT/);
  });
});

test('A/B/C resolver lanes remain available under the provider allowlist', async (t) => {
  const cases = [
    { client: 'CLIENT_ONEDRIVE', provider: 'onedrive', mountName: 'OneDrive-Organization' },
    { client: 'CLIENT_PERSONAL', provider: 'gdrive', mountName: 'GoogleDrive-personal-account' },
    { client: 'OTHER', provider: 'gdrive', mountName: 'GoogleDrive-organization-account' }
  ];
  for (const lane of cases) {
    await t.test(`${lane.client} ${lane.provider}`, () => {
      const fixture = makeFixture(t, lane);
      const result = runTool(fixture, 'resolve.js', ['--client', fixture.client]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), fixture.mountedPath);
    });
  }
});

test('quota inputs cannot bypass classified byte requirements', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.clientRoot, 'payload.bin'), '0123456789');
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'payload.bin', size: 10 }],
    { MOVE: 10, 'PII-MOVE': 0 }
  );

  for (const [label, args, pattern] of [
    ['negative batch', ['--batch-bytes', '-1', '--attest-headroom-bytes', '100'], /finite, nonnegative/],
    ['reduced batch', ['--batch-bytes', '9', '--attest-headroom-bytes', '100'], /cannot be less/],
    ['nonfinite batch', ['--batch-bytes', 'Infinity', '--attest-headroom-bytes', '100'], /finite, nonnegative/],
    ['negative attestation', ['--attest-headroom-bytes', '-1'], /finite, nonnegative/],
    ['nonfinite attestation', ['--attest-headroom-bytes', 'NaN'], /finite, nonnegative/]
  ]) {
    await t.test(label, () => {
      const result = runTool(fixture, 'preflight.js', [
        '--client',
        fixture.client,
        '--classify-report',
        classifyPath,
        ...args
      ]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, pattern);
    });
  }

  await t.test('negative classified bytes', () => {
    const invalidClassifyPath = writeClassify(
      fixture,
      [{ klass: 'MOVE', relpath: 'payload.bin', size: 10 }],
      { MOVE: -10, 'PII-MOVE': 0 }
    );
    const result = runTool(fixture, 'preflight.js', [
      '--client',
      fixture.client,
      '--classify-report',
      invalidClassifyPath,
      '--attest-headroom-bytes',
      '100'
    ]);
    assert.equal(result.status, 20);
    assert.match(result.stderr, /counts, bytes, or totals/);
  });

  await t.test('aggregate bytes below entry sizes', () => {
    const invalidClassifyPath = writeClassify(
      fixture,
      [{ klass: 'MOVE', relpath: 'payload.bin', size: 10 }],
      { MOVE: 9, 'PII-MOVE': 0 }
    );
    const result = runTool(fixture, 'preflight.js', [
      '--client',
      fixture.client,
      '--classify-report',
      invalidClassifyPath,
      '--attest-headroom-bytes',
      '100'
    ]);
    assert.equal(result.status, 20);
    assert.match(result.stderr, /counts, bytes, or totals/);
  });
});

test('rename map is required, client/schema-bound, and content-bound', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.clientRoot, 'bad:name.txt'), 'rename me');
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'bad:name.txt', size: 9 }],
    { MOVE: 9, 'PII-MOVE': 0 }
  );
  const { reportPath, report } = passPreflight(fixture, classifyPath, ['--renames-approved']);
  const renamePath = path.join(fixture.clientRoot, 'rename-map.json');

  assert.deepEqual(
    {
      required: report.rename_map_binding.required,
      schema: report.rename_map_binding.schema,
      client: report.rename_map_binding.client,
      sha256: report.rename_map_binding.sha256
    },
    {
      required: true,
      schema: 'ClientStorageRenameMap/1.0',
      client: fixture.client,
      sha256: sha256File(renamePath)
    }
  );

  await t.test('changed map is rejected', () => {
    fs.appendFileSync(renamePath, '\n');
    const result = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      reportPath
    ]);
    assert.equal(result.status, 24);
    assert.match(result.stderr, /RENAME_MAP_DRIFT/);
  });

  await t.test('missing map is rejected', () => {
    fs.rmSync(renamePath);
    const result = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      reportPath
    ]);
    assert.equal(result.status, 24);
    assert.match(result.stderr, /missing/);
  });

  await t.test('wrong map schema is rejected', () => {
    fs.writeFileSync(
      renamePath,
      JSON.stringify({ schema: 'ClientStorageRenameMap/0.9', client: fixture.client, renames: [] })
    );
    const result = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      reportPath
    ]);
    assert.equal(result.status, 24);
    assert.match(result.stderr, /schema\/client/);
  });

  await t.test('wrong map client is rejected', () => {
    fs.writeFileSync(
      renamePath,
      JSON.stringify({ schema: 'ClientStorageRenameMap/1.0', client: 'OTHER', renames: [] })
    );
    const result = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      reportPath
    ]);
    assert.equal(result.status, 24);
    assert.match(result.stderr, /schema\/client/);
  });
});

test('private PII path-map binding fails closed and identical contents migrate independently', async (t) => {
  function setupPiiFixture() {
    const fixture = makeFixture(t);
    const content = 'identical synthetic private content';
    const size = Buffer.byteLength(content);
    const firstRelPath = path.join('private', 'first.bin');
    const secondRelPath = path.join('private', 'second.bin');
    fs.mkdirSync(path.join(fixture.clientRoot, 'private'), { recursive: true });
    fs.writeFileSync(path.join(fixture.clientRoot, firstRelPath), content);
    fs.writeFileSync(path.join(fixture.clientRoot, secondRelPath), content);
    const sha256 = sha256File(path.join(fixture.clientRoot, firstRelPath));
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    ];
    const mapEntries = [
      { pii_id: ids[0], repo_relpath: firstRelPath, size, sha256 },
      { pii_id: ids[1], repo_relpath: secondRelPath, size, sha256 }
    ];
    const classifyPath = writeClassify(
      fixture,
      [
        { klass: 'PII-MOVE', pii_id: ids[0], size, sha256_prefix: sha256.slice(0, 8) },
        { klass: 'PII-MOVE', pii_id: ids[1], size, sha256_prefix: sha256.slice(0, 8) }
      ],
      { MOVE: 0, 'PII-MOVE': size * 2 },
      mapEntries
    );
    return {
      fixture,
      classifyPath,
      mapPath: path.join(fixture.clientRoot, 'pii-path-map.json'),
      ids,
      firstRelPath,
      secondRelPath
    };
  }

  function runPreflightFailure(setup, mutateMap, pattern) {
    mutateMap(setup.mapPath);
    const result = runTool(setup.fixture, 'preflight.js', [
      '--client',
      setup.fixture.client,
      '--classify-report',
      setup.classifyPath,
      '--attest-headroom-bytes',
      '1000000'
    ]);
    assert.equal(result.status, 25);
    assert.match(result.stderr, /PII_MAP_DRIFT/);
    assert.match(result.stderr, pattern);
    assert.deepEqual(fs.readdirSync(setup.fixture.mountedPath), []);
  }

  await t.test('missing map blocks preflight', () => {
    runPreflightFailure(setupPiiFixture(), (mapPath) => fs.rmSync(mapPath), /missing/);
  });

  await t.test('tampered map blocks preflight', () => {
    runPreflightFailure(setupPiiFixture(), (mapPath) => fs.appendFileSync(mapPath, '\n'), /content changed/);
  });

  await t.test('wrong-client map blocks preflight', () => {
    runPreflightFailure(
      setupPiiFixture(),
      (mapPath) => {
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        map.client = 'OTHER';
        fs.writeFileSync(mapPath, JSON.stringify(map));
      },
      /schema\/client/
    );
  });

  await t.test('wrong-schema map blocks preflight', () => {
    runPreflightFailure(
      setupPiiFixture(),
      (mapPath) => {
        const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        map.schema = 'ClientStoragePiiPathMap/0.9';
        fs.writeFileSync(mapPath, JSON.stringify(map));
      },
      /schema\/client/
    );
  });

  for (const [label, mutateReport] of [
    ['missing public PII identity', (report) => report.entries.pop()],
    ['extra public PII identity', (report) => report.entries.push({ ...report.entries[0], pii_id: '33333333-3333-4333-8333-333333333333' })],
    ['duplicate public PII identity', (report) => {
      report.entries[1] = { ...report.entries[1], pii_id: report.entries[0].pii_id };
    }],
    ['mismatched public PII attributes', (report) => {
      report.entries[0] = { ...report.entries[0], size: report.entries[0].size + 1 };
    }]
  ]) {
    await t.test(`${label} blocks preflight`, () => {
      const setup = setupPiiFixture();
      const report = JSON.parse(fs.readFileSync(setup.classifyPath, 'utf8'));
      mutateReport(report);
      refreshSemanticAggregates(report);
      fs.writeFileSync(setup.classifyPath, JSON.stringify(report));
      const result = runTool(setup.fixture, 'preflight.js', [
        '--client',
        setup.fixture.client,
        '--classify-report',
        setup.classifyPath,
        '--attest-headroom-bytes',
        '1000000'
      ]);
      assert.equal(result.status, 25);
      assert.match(result.stderr, /PII_MAP_DRIFT/);
      assert.deepEqual(fs.readdirSync(setup.fixture.mountedPath), []);
    });
  }

  await t.test('map changed after PASS blocks migrate before writes', () => {
    const setup = setupPiiFixture();
    const preflight = passPreflight(setup.fixture, setup.classifyPath);
    fs.appendFileSync(setup.mapPath, '\n');
    const result = runTool(setup.fixture, 'migrate.js', [
      '--client',
      setup.fixture.client,
      '--classify-report',
      setup.classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(result.status, 25);
    assert.match(result.stderr, /PII_MAP_DRIFT/);
    assert.deepEqual(fs.readdirSync(setup.fixture.mountedPath), []);
  });

  await t.test('PII source changed after PASS blocks migrate before writes', () => {
    const setup = setupPiiFixture();
    const preflight = passPreflight(setup.fixture, setup.classifyPath);
    fs.appendFileSync(path.join(setup.fixture.clientRoot, setup.firstRelPath), 'changed');
    const result = runTool(setup.fixture, 'migrate.js', [
      '--client',
      setup.fixture.client,
      '--classify-report',
      setup.classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(result.status, 25);
    assert.match(result.stderr, /PII_MAP_DRIFT/);
    assert.match(result.stderr, /source checksum changed/);
    assert.deepEqual(fs.readdirSync(setup.fixture.mountedPath), []);
  });

  await t.test('tampered public membership after PASS blocks migrate before writes', () => {
    const setup = setupPiiFixture();
    const preflight = passPreflight(setup.fixture, setup.classifyPath);
    const classify = JSON.parse(fs.readFileSync(setup.classifyPath, 'utf8'));
    classify.entries[0].size += 1;
    fs.writeFileSync(setup.classifyPath, JSON.stringify(classify));
    const preflightReport = JSON.parse(fs.readFileSync(preflight.reportPath, 'utf8'));
    preflightReport.classify_report_sha256 = sha256File(setup.classifyPath);
    fs.writeFileSync(preflight.reportPath, JSON.stringify(preflightReport));
    const result = runTool(setup.fixture, 'migrate.js', [
      '--client',
      setup.fixture.client,
      '--classify-report',
      setup.classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(result.status, 25);
    assert.match(result.stderr, /PII_MAP_DRIFT/);
    assert.deepEqual(fs.readdirSync(setup.fixture.mountedPath), []);
  });

  await t.test('preflight binding carries through migrate and resume for equal contents', () => {
    const setup = setupPiiFixture();
    const classify = JSON.parse(fs.readFileSync(setup.classifyPath, 'utf8'));
    const preflight = passPreflight(setup.fixture, setup.classifyPath);
    assert.deepEqual(preflight.report.pii_path_map_binding, classify.pii_path_map_binding);

    const first = runTool(setup.fixture, 'migrate.js', [
      '--client',
      setup.fixture.client,
      '--classify-report',
      setup.classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.existsSync(path.join(setup.fixture.mountedPath, setup.firstRelPath)), true);
    assert.equal(fs.existsSync(path.join(setup.fixture.mountedPath, setup.secondRelPath)), true);

    const storageMap = JSON.parse(fs.readFileSync(path.join(setup.fixture.clientRoot, 'storage-map.json'), 'utf8'));
    assert.deepEqual(storageMap.entries.map((entry) => entry.pii_id).sort(), [...setup.ids].sort());
    assert.equal(storageMap.entries.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'repo_relpath')), true);
    assert.equal(storageMap.entries.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'drive_relpath')), true);
    assert.equal(storageMap.entries.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'renamed_to')), true);

    const second = runTool(setup.fixture, 'migrate.js', [
      '--client',
      setup.fixture.client,
      '--classify-report',
      setup.classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stderr, /"migrated":0/);
  });
});

test('a no-rename PASS rejects a subsequently present stale rename map', (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.clientRoot, 'plain.txt'), 'plain');
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'plain.txt', size: 5 }],
    { MOVE: 5, 'PII-MOVE': 0 }
  );
  const preflight = passPreflight(fixture, classifyPath);
  fs.writeFileSync(
    path.join(fixture.clientRoot, 'rename-map.json'),
    JSON.stringify({
      schema: 'ClientStorageRenameMap/1.0',
      client: fixture.client,
      renames: [{ repo_relpath: 'plain.txt', renamed_relpath: 'redirected.txt' }]
    })
  );
  const result = runTool(fixture, 'migrate.js', [
    '--client',
    fixture.client,
    '--classify-report',
    classifyPath,
    '--execute',
    '--preflight-report',
    preflight.reportPath
  ]);
  assert.equal(result.status, 24);
  assert.match(result.stderr, /no-rename run/);
  assert.equal(fs.existsSync(path.join(fixture.mountedPath, 'redirected.txt')), false);
});

test('migration refuses to run while the shared storage-map mutation lock is held', (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.clientRoot, 'plain.txt'), 'plain');
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'plain.txt', size: 5 }],
    { MOVE: 5, 'PII-MOVE': 0 }
  );
  const preflight = passPreflight(fixture, classifyPath);
  const lockPath = path.join(fixture.clientRoot, '.storage-map.lock');
  fs.writeFileSync(lockPath, 'held by synthetic reconciliation');
  const result = runTool(fixture, 'migrate.js', [
    '--client',
    fixture.client,
    '--classify-report',
    classifyPath,
    '--execute',
    '--preflight-report',
    preflight.reportPath
  ]);
  assert.equal(result.status, 22, result.stderr);
  assert.match(result.stderr, /TARGET_CONFLICT/);
  assert.equal(fs.existsSync(path.join(fixture.mountedPath, 'plain.txt')), false);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), 'held by synthetic reconciliation');
});

test('migration preserves and publishes an intentionally read-only source file', (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.clientRoot, 'read-only-reference.txt');
  fs.writeFileSync(source, 'historical reference');
  fs.chmodSync(source, 0o444);
  const classifyPath = writeClassify(
    fixture,
    [{ klass: 'MOVE', relpath: 'read-only-reference.txt', size: 20 }],
    { MOVE: 20, 'PII-MOVE': 0 }
  );
  const preflight = passPreflight(fixture, classifyPath);
  const result = runTool(fixture, 'migrate.js', [
    '--client',
    fixture.client,
    '--classify-report',
    classifyPath,
    '--execute',
    '--preflight-report',
    preflight.reportPath
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(fixture.mountedPath, 'read-only-reference.txt'), 'utf8'), 'historical reference');
  assert.equal(fs.readFileSync(source, 'utf8'), 'historical reference');
});

test('migration never overwrites targets or temp files and only resumes verified content', async (t) => {
  async function setup() {
    const fixture = makeFixture(t);
    fs.writeFileSync(path.join(fixture.clientRoot, 'plain.txt'), 'source payload');
    const classifyPath = writeClassify(
      fixture,
      [{ klass: 'MOVE', relpath: 'plain.txt', size: 14 }],
      { MOVE: 14, 'PII-MOVE': 0 }
    );
    const preflight = passPreflight(fixture, classifyPath);
    assert.deepEqual(preflight.report.rename_map_binding, {
      required: false,
      schema: null,
      client: fixture.client,
      sha256: null
    });
    return { fixture, classifyPath, preflight };
  }

  await t.test('ordinary existing target is preserved', async () => {
    const { fixture, classifyPath, preflight } = await setup();
    const target = path.join(fixture.mountedPath, 'plain.txt');
    fs.writeFileSync(target, 'ordinary existing content');
    const result = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(result.status, 22, result.stderr);
    assert.equal(fs.readFileSync(target, 'utf8'), 'ordinary existing content');
    assert.equal(fs.readFileSync(path.join(fixture.clientRoot, 'plain.txt'), 'utf8'), 'source payload');
  });

  await t.test('existing tmp is preserved', async () => {
    const { fixture, classifyPath, preflight } = await setup();
    const tmpTarget = path.join(fixture.mountedPath, 'plain.txt.tmp-migrate');
    fs.writeFileSync(tmpTarget, 'operator-owned temp');
    const result = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(result.status, 22, result.stderr);
    assert.equal(fs.readFileSync(tmpTarget, 'utf8'), 'operator-owned temp');
  });

  await t.test('verified manifest resume succeeds without rewriting target', async () => {
    const { fixture, classifyPath, preflight } = await setup();
    const first = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(first.status, 0, first.stderr);
    const target = path.join(fixture.mountedPath, 'plain.txt');
    const before = fs.statSync(target);
    const second = runTool(fixture, 'migrate.js', [
      '--client',
      fixture.client,
      '--classify-report',
      classifyPath,
      '--execute',
      '--preflight-report',
      preflight.reportPath
    ]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stderr, /"migrated":0/);
    assert.equal(fs.statSync(target).ino, before.ino);
    assert.equal(fs.readFileSync(target, 'utf8'), 'source payload');
    assert.equal(fs.readFileSync(path.join(fixture.clientRoot, 'plain.txt'), 'utf8'), 'source payload');
  });
});

test('case-insensitive and sanitized duplicate drive targets halt before writes', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.clientRoot, 'A:B.txt'), 'first');
  fs.writeFileSync(path.join(fixture.clientRoot, 'a?b.txt'), 'second');
  const classifyPath = writeClassify(
    fixture,
    [
      { klass: 'MOVE', relpath: 'A:B.txt', size: 5 },
      { klass: 'MOVE', relpath: 'a?b.txt', size: 6 }
    ],
    { MOVE: 11, 'PII-MOVE': 0 }
  );
  const preflight = passPreflight(fixture, classifyPath, ['--renames-approved']);
  const result = runTool(fixture, 'migrate.js', [
    '--client',
    fixture.client,
    '--classify-report',
    classifyPath,
    '--execute',
    '--preflight-report',
    preflight.reportPath
  ]);
  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stderr, /TARGET_COLLISION/);
  assert.equal(fs.existsSync(path.join(fixture.mountedPath, 'A_B.txt')), false);
});
